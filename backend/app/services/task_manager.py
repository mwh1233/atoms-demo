import asyncio
import uuid
from typing import Dict, Optional, Set

from app.agents.state import AgentState
from app.agents.workflow import agent_workflow
from app.db.supabase_client import supabase


NODE_TO_STEP = {
    "analyze": "analyzing",
    "design": "designing",
    "code": "coding",
    "deploy": "deploying",
}

STEP_MESSAGES = {
    "analyzing": "正在分析需求",
    "designing": "正在设计方案",
    "coding": "正在生成代码",
    "deploying": "正在部署项目",
}

STEP_RESULT_FIELDS = {
    "analyzing": "analysis_result",
    "designing": "design_result",
    "coding": "generated_code",
    "deploying": "deploy_url",
}

MESSAGE_STEPS = {
    "analysis_result": "analysis",
    "design_result": "design",
    "generated_code": "code",
}


class TaskManager:
    def __init__(self):
        self.tasks: Dict[str, AgentState] = {}
        self.listeners: Dict[str, Set[asyncio.Queue]] = {}

    async def create_task(self, project_id: str, user_id: str, prompt: str) -> str:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        initial_state: AgentState = {
            "task_id": task_id,
            "project_id": project_id,
            "user_id": user_id,
            "user_prompt": prompt,
            "analysis_result": None,
            "design_result": None,
            "generated_code": None,
            "deploy_url": None,
            "current_step": "pending",
            "status": "pending",
            "error_message": None,
        }

        self.tasks[task_id] = initial_state

        try:
            await self._update_project(
                project_id,
                {
                    "status": "generating",
                    "current_step": "pending",
                },
            )
            await self._insert_messages(
                [
                    {
                        "project_id": project_id,
                        "role": "user",
                        "content": prompt,
                        "step": None,
                    }
                ]
            )
        except Exception as exc:
            error_message = str(exc)
            initial_state["status"] = "failed"
            initial_state["error_message"] = error_message
            self.tasks[task_id] = initial_state

            await self._broadcast_error(task_id, error_message)
            return task_id

        asyncio.create_task(self._run_task(task_id))
        return task_id

    def get_task(self, task_id: str) -> Optional[AgentState]:
        return self.tasks.get(task_id)

    async def subscribe(self, task_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()

        if task_id not in self.listeners:
            self.listeners[task_id] = set()
        self.listeners[task_id].add(queue)

        task = self.tasks.get(task_id)
        if task:
            await queue.put(
                {
                    "type": "task_created",
                    "data": {
                        "taskId": task_id,
                        "status": task["status"],
                        "currentStep": task["current_step"],
                    },
                }
            )

            if task["status"] == "failed" and task["error_message"]:
                await queue.put(
                    {
                        "type": "error",
                        "data": {
                            "message": task["error_message"],
                            "retry": False,
                        },
                    }
                )

        return queue

    async def _broadcast(self, task_id: str, event: dict):
        dead_queues: Set[asyncio.Queue] = set()

        for queue in self.listeners.get(task_id, set()):
            try:
                await queue.put(event)
            except Exception:
                dead_queues.add(queue)

        for queue in dead_queues:
            self.listeners.get(task_id, set()).discard(queue)

    async def _broadcast_error(self, task_id: str, error_message: str):
        await self._broadcast(
            task_id,
            {
                "type": "error",
                "data": {
                    "message": error_message,
                    "retry": False,
                },
            },
        )

    async def _update_project(self, project_id: str, values: dict):
        await asyncio.to_thread(
            lambda: supabase.table("projects")
            .update(values)
            .eq("id", project_id)
            .execute()
        )

    async def _insert_messages(self, messages: list[dict]):
        await asyncio.to_thread(
            lambda: supabase.table("messages").insert(messages).execute()
        )

    async def _insert_assistant_messages(self, state: AgentState):
        messages = [
            {
                "project_id": state["project_id"],
                "role": "assistant",
                "content": state[field] or "",
                "step": step,
            }
            for field, step in MESSAGE_STEPS.items()
        ]

        await self._insert_messages(messages)

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

    async def _run_task(self, task_id: str):
        state = self.tasks[task_id]
        project_id = state["project_id"]

        try:
            state["status"] = "running"

            async for chunk in agent_workflow.astream(state):
                node_name, node_update = next(iter(chunk.items()))
                frontend_step = self._to_frontend_step(node_name, node_update)
                step_message = STEP_MESSAGES.get(
                    frontend_step,
                    f"正在执行 {frontend_step}",
                )

                await self._broadcast(
                    task_id,
                    {
                        "type": "step_start",
                        "data": {
                            "step": frontend_step,
                            "message": step_message,
                        },
                    },
                )

                state.update(node_update)
                state["status"] = node_update.get("status", "running")
                self.tasks[task_id] = state

                await self._update_project(
                    project_id,
                    {
                        "status": "generating",
                        "current_step": state["current_step"],
                    },
                )

                await self._broadcast(
                    task_id,
                    {
                        "type": "step_complete",
                        "data": {
                            "step": frontend_step,
                            "result": self._step_result(frontend_step, node_update),
                        },
                    },
                )

            final_state = state
            final_state["status"] = "completed"
            final_state["current_step"] = "completed"
            self.tasks[task_id] = final_state

            await self._update_project(
                project_id,
                {
                    "status": "completed",
                    "generated_code": final_state["generated_code"],
                    "current_step": None,
                },
            )

            await self._insert_assistant_messages(final_state)

            await self._broadcast(
                task_id,
                {
                    "type": "completed",
                    "data": {
                        "code": final_state["generated_code"],
                        "deployUrl": final_state["deploy_url"],
                    },
                },
            )
        except Exception as exc:
            error_message = str(exc)
            state["status"] = "failed"
            state["error_message"] = error_message
            self.tasks[task_id] = state

            try:
                await self._update_project(
                    project_id,
                    {
                        "status": "failed",
                        "current_step": None,
                        "error_message": error_message,
                    },
                )
            except Exception as update_exc:
                error_message = f"{error_message}; failed to update project: {update_exc}"
                state["error_message"] = error_message
                self.tasks[task_id] = state

            await self._broadcast_error(task_id, error_message)


task_manager = TaskManager()
