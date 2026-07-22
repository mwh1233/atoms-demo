import asyncio
import inspect
import logging
import time
from datetime import datetime, timezone
from typing import Callable, Dict, Optional, Set

from app.agents.nodes import analyze_node, code_node, deploy_node, design_node
from app.agents.state import AgentState
from app.db.supabase_client import supabase
from app.services.template_service import template_service


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

WAITING_FOR_FEATURES_STATUS = "awaiting_features_confirmation"

STEP_RESULT_FIELDS = {
    "analyzing": ("analysis_result",),
    "designing": ("architecture_doc", "design_result", "file_tree_plan"),
    "coding": ("generated_code", "generated_files"),
    "deploying": ("deploy_url",),
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

USER_MESSAGE_STEP = ""
PROJECT_TIMEOUT_SECONDS = 10 * 60
MAX_POLL_INTERVAL_SECONDS = 5
MIN_ACTIVE_POLL_INTERVAL_SECONDS = 1
DEFAULT_POLL_INTERVAL_SECONDS = 2
STEP_RETRY_ATTEMPTS = 3
STEP_RETRY_DELAY_SECONDS = 2
OPTIONAL_PROJECT_FIELDS = {
    "architecture_doc",
    "file_tree_plan",
    "generated_files",
    "template_id",
    "template_code",
}


class TaskManager:
    def __init__(self):
        self.listeners: Dict[str, Set[asyncio.Queue]] = {}
        self._polling_task: Optional[asyncio.Task] = None
        self._running_projects: Set[str] = set()
        # 稳定性优化：记录运行中项目的开始时间，避免异常退出后永久占用运行锁。
        self._project_start_times: Dict[str, float] = {}
        # 稳定性优化：轮询间隔根据任务活跃度动态调整，空闲时减少数据库压力。
        self._poll_interval = DEFAULT_POLL_INTERVAL_SECONDS

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

            await asyncio.sleep(self._poll_interval)

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
        await self._cleanup_timed_out_projects()

        response = await asyncio.to_thread(
            lambda: supabase.table("projects")
            .select("*")
            .eq("status", "pending")
            .order("created_at", desc=False)
            .limit(3)
            .execute()
        )

        claimed_any = False
        for project in response.data or []:
            project_id = project["id"]
            if project_id in self._running_projects:
                continue

            if await self._claim_project(project_id):
                self._running_projects.add(project_id)
                claimed_any = True
                logger.info("Claimed project %s for generation", project_id)
                asyncio.create_task(self.run_project(project_id))

        if claimed_any:
            self._poll_interval = MIN_ACTIVE_POLL_INTERVAL_SECONDS
        else:
            self._poll_interval = min(
                self._poll_interval + 1,
                MAX_POLL_INTERVAL_SECONDS,
            )

    async def _cleanup_timed_out_projects(self):
        now = time.monotonic()
        timed_out_project_ids = [
            project_id
            for project_id in self._running_projects
            if now - self._project_start_times.get(project_id, now)
            > PROJECT_TIMEOUT_SECONDS
        ]

        for project_id in timed_out_project_ids:
            logger.warning("Project %s timed out; resetting to pending", project_id)
            self._running_projects.discard(project_id)
            self._project_start_times.pop(project_id, None)
            await self._safe_update_project(
                project_id,
                {
                    "status": "pending",
                    "current_step": "pending",
                    "error_message": None,
                },
            )

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

    async def create_or_queue_task(self, project_id: str, user_id: str, prompt: str) -> bool:
        # 鉴权加固：MVP 阶段按 project.user_id 做简单归属校验。
        if not await self._project_belongs_to_user(project_id, user_id):
            logger.warning("User %s attempted to queue project %s without access", user_id, project_id)
            return False

        await asyncio.gather(
            self._update_project(
                project_id,
                {
                    "status": "pending",
                    "initial_prompt": prompt,
                    "template_id": "fullstack-shadcn",
                    "current_step": "pending",
                    "error_message": None,
                },
            ),
            self._insert_user_message_once(project_id, prompt),
        )
        return True

    async def confirm_project(self, project_id: str, user_id: str) -> bool:
        # 鉴权加固：确认项目时必须校验项目归属，防止仅凭 project_id 操作。
        project = await self._get_project_for_user(project_id, user_id)
        if not project or project.get("status") != "awaiting_confirmation":
            return False

        response, _ = await asyncio.gather(
            asyncio.to_thread(
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
            ),
            self._safe_insert_messages(
                [
                    {
                        "project_id": project_id,
                        "role": "user",
                        "content": "满意，确认完成",
                        "step": None,
                    }
                ]
            ),
        )
        return len(response.data or []) == 1

    async def add_user_message(self, project_id: str, user_id: str, content: str) -> bool:
        # 鉴权加固：用户消息只能写入自己的项目。
        project = await self._get_project_for_user(project_id, user_id)
        if not project:
            return False

        await self._insert_messages(
            [
                {
                    "project_id": project_id,
                    "role": "user",
                    "content": content,
                    "step": USER_MESSAGE_STEP,
                }
            ]
        )
        return True

    async def iterate_project(self, project_id: str, user_id: str, prompt: str) -> bool:
        # 鉴权加固：迭代请求只能操作当前用户拥有的项目。
        project = await self._get_project_for_user(project_id, user_id)
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
                        "step": USER_MESSAGE_STEP,
                    }
                ]
            ),
        )

        if project_id not in self._running_projects:
            self._running_projects.add(project_id)
            self._project_start_times[project_id] = time.monotonic()
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

    async def confirm_project_features(
        self,
        project_id: str,
        user_id: str,
        confirmed_features: list[dict],
    ) -> bool:
        project = await self._get_project_for_user(project_id, user_id)
        if not project or project.get("status") != WAITING_FOR_FEATURES_STATUS:
            return False

        confirmed_features = self._filter_confirmed_features(
            project.get("features_list") or [],
            confirmed_features,
        )
        state_overrides = self._select_template_values(
            project.get("initial_prompt") or "",
            confirmed_features,
        )
        state_overrides["confirmed_features"] = confirmed_features

        await self._safe_update_project(
            project_id,
            {
                "status": "generating",
                "current_step": "designing",
                "confirmed_features": confirmed_features,
                "template_id": state_overrides["template_id"],
                "template_code": state_overrides["template_code"],
                "error_message": None,
            },
        )

        self._running_projects.discard(project_id)
        self._project_start_times.pop(project_id, None)
        self._running_projects.add(project_id)
        self._project_start_times[project_id] = time.monotonic()
        asyncio.create_task(
            self.run_project(
                project_id,
                state_overrides=state_overrides,
            )
        )

        return True

    def _select_template_values(
        self,
        user_prompt: str,
        confirmed_features: list[dict],
    ) -> dict:
        template = template_service.match_template(user_prompt, confirmed_features)
        template_id = template["id"]
        return {
            "template_id": template_id,
            "template_code": template_service.get_template_code(template_id),
        }

    def _filter_confirmed_features(
        self,
        available_features: list[dict],
        confirmed_features: list[dict],
    ) -> list[dict]:
        if not available_features:
            return confirmed_features

        available_by_id = {
            feature.get("id"): feature
            for feature in available_features
            if isinstance(feature, dict) and feature.get("id")
        }
        if not available_by_id:
            return confirmed_features

        filtered_features: list[dict] = []
        for feature in confirmed_features:
            if not isinstance(feature, dict):
                continue

            feature_id = feature.get("id")
            if feature_id in available_by_id:
                filtered_features.append(
                    {
                        **available_by_id[feature_id],
                        **feature,
                    }
                )

        return filtered_features

    async def subscribe_project(self, project_id: str, user_id: str) -> Optional[asyncio.Queue]:
        # 鉴权加固：SSE 订阅同样校验项目归属，避免泄露生成过程。
        project = await self._get_project_for_user(project_id, user_id)
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

    async def subscribe(self, task_id: str, user_id: str) -> Optional[asyncio.Queue]:
        project_id = self._project_id_from_task_id(task_id)
        if not project_id:
            return None
        return await self.subscribe_project(project_id, user_id)

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

        if state["status"] == WAITING_FOR_FEATURES_STATUS:
            await queue.put(
                {
                    "type": "features_confirmation",
                    "data": {
                        "features": state["features_list"],
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

    async def _get_project_for_user(self, project_id: str, user_id: str) -> Optional[dict]:
        project = await self._get_project(project_id)
        if not project or not self._project_matches_user(project, user_id):
            return None
        return project

    async def user_can_access_project(self, project_id: str, user_id: str) -> bool:
        # 鉴权加固：接口层可先调用此方法，明确返回 403，而业务状态错误仍返回 409。
        return await self._project_belongs_to_user(project_id, user_id)

    async def _project_belongs_to_user(self, project_id: str, user_id: str) -> bool:
        project = await self._get_project(project_id)
        return bool(project and self._project_matches_user(project, user_id))

    def _project_matches_user(self, project: dict, user_id: str) -> bool:
        owner_id = project.get("user_id") or project.get("owner_id")
        return bool(user_id and owner_id == user_id)

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
            optional_fields = OPTIONAL_PROJECT_FIELDS & set(values)
            if optional_fields:
                retry_values = {
                    key: value
                    for key, value in values.items()
                    if key not in optional_fields
                }
                logger.warning(
                    "Skipping optional project fields for %s: %s. Original update failed: %s",
                    project_id,
                    sorted(optional_fields),
                    exc,
                )
                if retry_values:
                    try:
                        await self._update_project(project_id, retry_values)
                    except Exception as retry_exc:
                        logger.exception(
                            "Failed to update project %s without optional fields: %s",
                            project_id,
                            retry_exc,
                        )
                return

            logger.exception("Failed to update project %s: %s", project_id, exc)

    async def _update_project_by_status(self, status: str, values: dict):
        await asyncio.to_thread(
            lambda: supabase.table("projects")
            .update(values)
            .eq("status", status)
            .execute()
        )

    async def _insert_messages(self, messages: list[dict]):
        prepared_messages = [self._prepare_message_for_insert(message) for message in messages]
        await asyncio.to_thread(
            lambda: supabase.table("messages").insert(prepared_messages).execute()
        )

    async def _insert_user_message_once(self, project_id: str, content: str):
        existing_message = await self._get_user_message(project_id, content)
        if existing_message:
            return

        await self._insert_messages(
            [
                {
                    "project_id": project_id,
                    "role": "user",
                    "content": content,
                    "step": USER_MESSAGE_STEP,
                }
            ]
        )

    async def _get_user_message(self, project_id: str, content: str) -> Optional[dict]:
        response = await asyncio.to_thread(
            lambda: supabase.table("messages")
            .select("id")
            .eq("project_id", project_id)
            .eq("role", "user")
            .eq("content", content)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return rows[0] if rows else None

    def _prepare_message_for_insert(self, message: dict) -> dict:
        prepared_message = {
            **message,
            "created_at": message.get("created_at")
            or datetime.now(timezone.utc).isoformat(),
        }

        if prepared_message.get("role") == "user":
            # messages.step 在部分 Supabase 表结构中可能是 NOT NULL；
            # 普通用户消息用空字符串表示“无步骤”，刷新读取后仍按用户气泡展示。
            prepared_message["step"] = prepared_message.get("step") or USER_MESSAGE_STEP

        return prepared_message

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
        for result_field in STEP_RESULT_FIELDS.get(step, ()):
            result = node_update.get(result_field)
            if isinstance(result, str) and result:
                return result
        return ""

    def _step_result_from_state(self, step: str, state: AgentState) -> str:
        for result_field in STEP_RESULT_FIELDS.get(step, ()):
            result = state.get(result_field)
            if isinstance(result, str) and result:
                return result
        return ""

    def _project_values_from_node_update(self, step: str, node_update: dict) -> dict:
        values: dict = {}
        for result_field in STEP_RESULT_FIELDS.get(step, ()):
            if result_field not in node_update:
                continue

            project_field = "deployed_url" if result_field == "deploy_url" else result_field
            values[project_field] = node_update[result_field]

        return values

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
            "design_result": project.get("design_result") or project.get("architecture_doc"),
            "architecture_doc": project.get("architecture_doc") or project.get("design_result") or "",
            "file_tree_plan": project.get("file_tree_plan") or [],
            "generated_code": project.get("generated_code"),
            "template_id": project.get("template_id") or "fullstack-shadcn",
            "template_code": project.get("template_code") or {},
            "generated_files": project.get("generated_files") or {},
            "features_list": project.get("features_list") or [],
            "confirmed_features": project.get("confirmed_features") or [],
            "deploy_url": project.get("deploy_url") or project.get("deployed_url"),
            "current_step": project.get("current_step")
            or (
                "completed"
                if project.get("status") in {
                    "awaiting_confirmation",
                    WAITING_FOR_FEATURES_STATUS,
                    "completed",
                    "failed",
                }
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
        loop = asyncio.get_running_loop()

        def on_token(delta: str, full_content: str):
            loop.call_soon_threadsafe(
                lambda: asyncio.create_task(
                    self._broadcast(
                        state["project_id"],
                        {
                            "type": "token",
                            "data": {
                                "step": step,
                                "delta": delta,
                                "content": full_content,
                            },
                        },
                    )
                )
            )

        # 稳定性优化：LLM/网络型临时错误重试，业务错误保持快速失败。
        for attempt in range(STEP_RETRY_ATTEMPTS):
            try:
                if inspect.iscoroutinefunction(node):
                    result = node(state)
                    result = await result
                else:
                    result = await asyncio.to_thread(node, state, on_token)
                return result or {}
            except Exception as exc:
                is_last_attempt = attempt >= STEP_RETRY_ATTEMPTS - 1
                if is_last_attempt or not self._is_retriable_step_error(exc):
                    raise

                logger.warning(
                    "Step %s failed with retriable error on attempt %s/%s: %s",
                    step,
                    attempt + 1,
                    STEP_RETRY_ATTEMPTS,
                    exc,
                )
                await asyncio.sleep(STEP_RETRY_DELAY_SECONDS)

        return {}

    def _is_retriable_step_error(self, exc: Exception) -> bool:
        if isinstance(exc, (TimeoutError, ConnectionError, OSError, asyncio.TimeoutError)):
            return True

        status_code = getattr(exc, "status_code", None) or getattr(exc, "http_status", None)
        response = getattr(exc, "response", None)
        if status_code is None and response is not None:
            status_code = getattr(response, "status_code", None)

        return isinstance(status_code, int) and status_code >= 500

    async def run_project(
        self,
        project_id: str,
        is_iteration: bool = False,
        iteration_prompt: Optional[str] = None,
        previous_code: Optional[str] = None,
        state_overrides: Optional[dict] = None,
    ):
        self._project_start_times[project_id] = time.monotonic()
        try:
            project = await self._get_project(project_id)
            if not project:
                logger.warning("Project %s not found, skipping", project_id)
                return

            if not is_iteration and project.get("initial_prompt"):
                await self._insert_user_message_once(
                    project_id,
                    project["initial_prompt"],
                )

            state = self._state_from_project(project)
            if state_overrides:
                state.update(state_overrides)
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
                            "generatedFiles": state.get("generated_files") or {},
                            "templateId": state.get("template_id"),
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
                if "features_list" in node_update:
                    project_values["features_list"] = node_update["features_list"]

                project_values.update(
                    self._project_values_from_node_update(frontend_step, node_update)
                )

                await asyncio.gather(
                    self._safe_update_project(project_id, project_values),
                    self._broadcast(
                        project_id,
                        {
                            "type": "step_complete",
                            "data": {
                                "step": frontend_step,
                                "result": step_result,
                                "generatedFiles": state.get("generated_files") or {},
                                "templateId": state.get("template_id"),
                            },
                        },
                    ),
                    self._store_step_message(state, frontend_step, step_result),
                )

                if frontend_step == "analyzing" and not is_iteration:
                    features_list = state.get("features_list") or []
                    if features_list:
                        await self._safe_update_project(
                            project_id,
                            {
                                "status": WAITING_FOR_FEATURES_STATUS,
                                "current_step": "analyzing",
                                "features_list": features_list,
                                "error_message": None,
                            },
                        )
                        await self._broadcast(
                            project_id,
                            {
                                "type": "features_confirmation",
                                "data": {
                                    "features": features_list,
                                },
                            },
                        )
                        return

                    template_values = self._select_template_values(
                        state["user_prompt"],
                        [],
                    )
                    state.update(template_values)
                    await self._safe_update_project(
                        project_id,
                        {
                            **template_values,
                            "current_step": "designing",
                            "error_message": None,
                        },
                    )

                next_step = self._next_step(frontend_step)

            await self._safe_update_project(
                project_id,
                {
                    "status": "awaiting_confirmation",
                    "generated_code": state["generated_code"],
                    "generated_files": state.get("generated_files") or {},
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
                        "generatedFiles": state.get("generated_files") or {},
                        "templateId": state.get("template_id"),
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
            self._project_start_times.pop(project_id, None)


task_manager = TaskManager()
