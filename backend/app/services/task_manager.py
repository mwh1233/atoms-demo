import asyncio
import inspect
import logging
from typing import Callable, Dict, Optional, Set

from app.agents.nodes import analyze_node, code_node, deploy_node, design_node
from app.agents.state import AgentState
from app.db.supabase_client import supabase


NODE_TO_STEP = {
    "analyze": "analyzing",
    "design": "designing",
    "code": "coding",
    "deploy": "deploying",
}

STEP_ORDER = ["analyzing", "designing", "coding", "deploying"]

STEP_MESSAGES = {
    "analyzing": "Analyzing requirements",
    "designing": "Designing solution",
    "coding": "Generating code",
    "deploying": "Deploying project",
}

STEP_RESULT_FIELDS = {
    "analyzing": "analysis_result",
    "designing": "design_result",
    "coding": "generated_code",
    "deploying": "deploy_url",
}

STEP_MESSAGE_TYPES = {
    "analyzing": "analysis",
    "designing": "design",
    "coding": "code",
    "deploying": "system",
}

STEP_NODES: dict[str, Callable[[AgentState], object]] = {
    "analyzing": analyze_node,
    "designing": design_node,
    "coding": code_node,
    "deploying": deploy_node,
}


logger = logging.getLogger(__name__)


class TaskManager:
    def __init__(self):
        self.listeners: Dict[str, Set[asyncio.Queue]] = {}
        self._polling_task: Optional[asyncio.Task] = None
        self._running_projects: Set[str] = set()

    def start_polling(self):
        if self._polling_task and not self._polling_task.done():
            return

        self._polling_task = asyncio.create_task(self._poll_loop())

    async def _poll_loop(self):
        await self._reset_interrupted_projects()

        while True:
            try:
                await self._poll_once()
            except Exception as exc:
                logger.exception("Task polling failed: %s", exc)

            await asyncio.sleep(2)

    async def _reset_interrupted_projects(self):
        try:
            await self._update_project_by_status(
                "generating",
                {
                    "status": "pending",
                    "error_message": None,
                },
            )
        except Exception as exc:
            logger.exception("Failed to reset interrupted projects: %s", exc)

    async def _poll_once(self):
        response = await asyncio.to_thread(
            lambda: supabase.table("projects")
            .select("*")
            .eq("status", "pending")
            .order("created_at", desc=False)
            .limit(3)
            .execute()
        )

        for project in response.data or []:
            project_id = project["id"]
            if project_id in self._running_projects:
                continue

            if await self._claim_project(project_id):
                self._running_projects.add(project_id)
                asyncio.create_task(self.run_project(project_id))

    async def _claim_project(self, project_id: str) -> bool:
        response = await asyncio.to_thread(
            lambda: supabase.table("projects")
            .update(
                {
                    "status": "generating",
                    "error_message": None,
                }
            )
            .eq("id", project_id)
            .eq("status", "pending")
            .execute()
        )
        return len(response.data or []) == 1

    async def create_or_queue_task(self, project_id: str, user_id: str, prompt: str) -> None:
        await asyncio.gather(
            self._update_project(
                project_id,
                {
                    "status": "pending",
                    "initial_prompt": prompt,
                    "current_step": "pending",
                    "error_message": None,
                },
            ),
            self._insert_messages(
                [
                    {
                        "project_id": project_id,
                        "role": "user",
                        "content": prompt,
                        "step": None,
                    }
                ]
            ),
        )

    async def confirm_project(self, project_id: str) -> bool:
        response = await asyncio.to_thread(
            lambda: supabase.table("projects")
            .update(
                {
                    "status": "completed",
                    "current_step": "completed",
                    "error_message": None,
                }
            )
            .eq("id", project_id)
            .eq("status", "awaiting_confirmation")
            .execute()
        )
        return len(response.data or []) == 1

    async def add_user_message(self, project_id: str, content: str) -> bool:
        project = await self._get_project(project_id)
        if not project:
            return False

        await self._insert_messages(
            [
                {
                    "project_id": project_id,
                    "role": "user",
                    "content": content,
                    "step": None,
                }
            ]
        )
        return True

    async def iterate_project(self, project_id: str, prompt: str) -> bool:
        project = await self._get_project(project_id)
        if not project or project.get("status") != "awaiting_confirmation":
            return False

        previous_code = project.get("generated_code") or ""
        await asyncio.gather(
            self._update_project(
                project_id,
                {
                    "status": "generating",
                    "current_step": "coding",
                    "error_message": None,
                },
            ),
            self._insert_messages(
                [
                    {
                        "project_id": project_id,
                        "role": "user",
                        "content": prompt,
                        "step": None,
                    }
                ]
            ),
        )

        if project_id not in self._running_projects:
            self._running_projects.add(project_id)
            asyncio.create_task(
                self.run_project(
                    project_id,
                    is_iteration=True,
                    iteration_prompt=prompt,
                    previous_code=previous_code,
                )
            )

        return True

        await self._broadcast(
            project_id,
            {
                "type": "task_created",
                "data": {
                    "taskId": self._task_id_for_project(project_id),
                    "projectId": project_id,
                    "status": "pending",
                    "currentStep": "pending",
                },
            },
        )

    async def subscribe_project(self, project_id: str) -> Optional[asyncio.Queue]:
        project = await self._get_project(project_id)
        if not project:
            return None

        queue: asyncio.Queue = asyncio.Queue()
        self.listeners.setdefault(project_id, set()).add(queue)

        state = self._state_from_project(project)

        await queue.put(
            {
                "type": "task_created",
                "data": {
                    "taskId": self._task_id_for_project(project_id),
                    "projectId": project_id,
                    "status": state["status"],
                    "currentStep": state["current_step"],
                },
            }
        )
        await self._enqueue_snapshot(queue, state)

        if project.get("status") == "failed" and project.get("error_message"):
            await queue.put(
                {
                    "type": "error",
                    "data": {
                        "message": project["error_message"],
                        "retry": False,
                    },
                }
            )

        return queue

    async def subscribe(self, task_id: str) -> Optional[asyncio.Queue]:
        project_id = self._project_id_from_task_id(task_id)
        if not project_id:
            return None
        return await self.subscribe_project(project_id)

    def get_task(self, task_id: str) -> Optional[AgentState]:
        return None

    async def _enqueue_snapshot(self, queue: asyncio.Queue, state: AgentState):
        for step in STEP_ORDER:
            result = self._step_result_from_state(step, state)
            if result:
                await queue.put(
                    {
                        "type": "step_complete",
                        "data": {
                            "step": step,
                            "result": result,
                        },
                    }
                )

        if state["status"] in {"awaiting_confirmation", "completed"}:
            await queue.put(
                {
                    "type": "completed",
                    "data": {
                        "code": state["generated_code"],
                        "deployUrl": state["deploy_url"],
                    },
                }
            )

    async def _broadcast(self, project_id: str, event: dict):
        dead_queues: Set[asyncio.Queue] = set()

        for queue in self.listeners.get(project_id, set()):
            try:
                await queue.put(event)
            except Exception:
                dead_queues.add(queue)

        for queue in dead_queues:
            self.listeners.get(project_id, set()).discard(queue)

    async def _broadcast_error(self, project_id: str, error_message: str):
        await self._broadcast(
            project_id,
            {
                "type": "error",
                "data": {
                    "message": error_message,
                    "retry": False,
                },
            },
        )

    async def _broadcast_step_start(self, project_id: str, step: str):
        await self._broadcast(
            project_id,
            {
                "type": "step_start",
                "data": {
                    "step": step,
                    "message": STEP_MESSAGES.get(step, f"Running {step}"),
                },
            },
        )

    async def _get_project(self, project_id: str) -> Optional[dict]:
        response = await asyncio.to_thread(
            lambda: supabase.table("projects")
            .select("*")
            .eq("id", project_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return rows[0] if rows else None

    async def _update_project(self, project_id: str, values: dict):
        await asyncio.to_thread(
            lambda: supabase.table("projects")
            .update(values)
            .eq("id", project_id)
            .execute()
        )

    async def _safe_update_project(self, project_id: str, values: dict):
        try:
            await self._update_project(project_id, values)
        except Exception as exc:
            logger.exception("Failed to update project %s: %s", project_id, exc)

    async def _update_project_by_status(self, status: str, values: dict):
        await asyncio.to_thread(
            lambda: supabase.table("projects")
            .update(values)
            .eq("status", status)
            .execute()
        )

    async def _insert_messages(self, messages: list[dict]):
        await asyncio.to_thread(
            lambda: supabase.table("messages").insert(messages).execute()
        )

    async def _safe_insert_messages(self, messages: list[dict]):
        try:
            await self._insert_messages(messages)
        except Exception as exc:
            logger.exception("Failed to insert messages: %s", exc)

    async def _store_step_message(self, state: AgentState, step: str, result: str):
        message_step = STEP_MESSAGE_TYPES.get(step)
        if not result or not message_step:
            return

        await self._safe_insert_messages(
            [
                {
                    "project_id": state["project_id"],
                    "role": "assistant",
                    "content": result,
                    "step": message_step,
                }
            ]
        )

    def _to_frontend_step(self, node_name: str, node_update: dict) -> str:
        current_step = node_update.get("current_step")
        if current_step:
            return current_step
        return NODE_TO_STEP.get(node_name, node_name)

    def _step_result(self, step: str, node_update: dict) -> str:
        result_field = STEP_RESULT_FIELDS.get(step)
        if not result_field:
            return ""

        result = node_update.get(result_field)
        return result if isinstance(result, str) else ""

    def _step_result_from_state(self, step: str, state: AgentState) -> str:
        result_field = STEP_RESULT_FIELDS.get(step)
        if not result_field:
            return ""

        result = state.get(result_field)
        return result if isinstance(result, str) else ""

    def _next_step(self, step: str) -> Optional[str]:
        try:
            next_index = STEP_ORDER.index(step) + 1
        except ValueError:
            return None

        if next_index >= len(STEP_ORDER):
            return None
        return STEP_ORDER[next_index]

    def _first_incomplete_step(self, state: AgentState) -> Optional[str]:
        for step in STEP_ORDER:
            if not self._step_result_from_state(step, state):
                return step
        return None

    def _state_from_project(self, project: dict) -> AgentState:
        return {
            "task_id": self._task_id_for_project(project["id"]),
            "project_id": project["id"],
            "user_id": project.get("user_id") or project.get("owner_id") or "",
            "user_prompt": project.get("initial_prompt") or "",
            "analysis_result": project.get("analysis_result"),
            "design_result": project.get("design_result"),
            "generated_code": project.get("generated_code"),
            "deploy_url": project.get("deploy_url") or project.get("deployed_url"),
            "current_step": project.get("current_step")
            or (
                "completed"
                if project.get("status") in {"awaiting_confirmation", "completed", "failed"}
                else "pending"
            ),
            "status": project.get("status") or "pending",
            "error_message": project.get("error_message"),
            "is_iteration": False,
            "previous_code": None,
        }

    def _task_id_for_project(self, project_id: str) -> str:
        return f"project_{project_id}"

    def _project_id_from_task_id(self, task_id: str) -> Optional[str]:
        if task_id.startswith("project_"):
            return task_id.removeprefix("project_")
        return None

    async def _run_step(self, step: str, state: AgentState) -> dict:
        node = STEP_NODES[step]
        result = node(state)
        if inspect.isawaitable(result):
            result = await result
        return result or {}

    async def run_project(
        self,
        project_id: str,
        is_iteration: bool = False,
        iteration_prompt: Optional[str] = None,
        previous_code: Optional[str] = None,
    ):
        try:
            project = await self._get_project(project_id)
            if not project:
                logger.warning("Project %s not found, skipping", project_id)
                return

            state = self._state_from_project(project)
            state["status"] = "running"
            state["is_iteration"] = is_iteration
            state["previous_code"] = previous_code
            if iteration_prompt:
                state["user_prompt"] = iteration_prompt

            next_step = "coding" if is_iteration else self._first_incomplete_step(state)
            if not next_step:
                await self._safe_update_project(
                    project_id,
                    {
                        "status": "awaiting_confirmation",
                        "current_step": "completed",
                        "error_message": None,
                    },
                )
                await self._broadcast(
                    project_id,
                    {
                        "type": "completed",
                        "data": {
                            "code": state["generated_code"],
                            "deployUrl": state["deploy_url"],
                        },
                    },
                )
                return

            while next_step:
                state["current_step"] = next_step
                await asyncio.gather(
                    self._safe_update_project(
                        project_id,
                        {
                            "status": "generating",
                            "current_step": next_step,
                            "error_message": None,
                        },
                    ),
                    self._broadcast_step_start(project_id, next_step),
                )

                node_update = await self._run_step(next_step, state)
                frontend_step = self._to_frontend_step(next_step, node_update)
                step_result = self._step_result(frontend_step, node_update)

                state.update(node_update)
                state["status"] = node_update.get("status", "running")
                state["current_step"] = frontend_step

                project_values = {
                    "status": "generating",
                    "current_step": frontend_step,
                }
                result_field = STEP_RESULT_FIELDS.get(frontend_step)
                if result_field and result_field in node_update:
                    project_field = (
                        "deployed_url" if result_field == "deploy_url" else result_field
                    )
                    project_values[project_field] = node_update[result_field]

                await asyncio.gather(
                    self._safe_update_project(project_id, project_values),
                    self._broadcast(
                        project_id,
                        {
                            "type": "step_complete",
                            "data": {
                                "step": frontend_step,
                                "result": step_result,
                            },
                        },
                    ),
                    self._store_step_message(state, frontend_step, step_result),
                )

                next_step = self._next_step(frontend_step)

            await self._safe_update_project(
                project_id,
                {
                    "status": "awaiting_confirmation",
                    "generated_code": state["generated_code"],
                    "current_step": "completed",
                    "error_message": None,
                },
            )

            await self._broadcast(
                project_id,
                {
                    "type": "completed",
                    "data": {
                        "code": state["generated_code"],
                        "deployUrl": state["deploy_url"],
                    },
                },
            )
        except Exception as exc:
            error_message = str(exc)
            logger.exception("Project %s failed: %s", project_id, exc)
            await self._safe_update_project(
                project_id,
                {
                    "status": "failed",
                    "current_step": "completed",
                    "error_message": error_message,
                },
            )
            await self._broadcast_error(project_id, error_message)
        finally:
            self._running_projects.discard(project_id)


task_manager = TaskManager()
