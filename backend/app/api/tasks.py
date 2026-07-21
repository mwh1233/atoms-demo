import asyncio
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.services.task_manager import task_manager


router = APIRouter(prefix="/tasks", tags=["tasks"])


class CreateTaskRequest(BaseModel):
    projectId: str
    userId: str
    prompt: str


class IterateTaskRequest(BaseModel):
    prompt: str


class CreateMessageRequest(BaseModel):
    content: str


@router.post("")
async def create_task(request: CreateTaskRequest):
    await task_manager.create_or_queue_task(
        request.projectId,
        request.userId,
        request.prompt,
    )

    return {
        "projectId": request.projectId,
        "status": "pending",
    }


@router.get("/project/{project_id}/stream")
async def stream_project_task(project_id: str):
    queue = await task_manager.subscribe_project(project_id)
    if not queue:
        raise HTTPException(status_code=404, detail="Active task not found")

    return EventSourceResponse(_event_generator(queue))


@router.post("/project/{project_id}/confirm")
async def confirm_project_task(project_id: str):
    confirmed = await task_manager.confirm_project(project_id)
    if not confirmed:
        raise HTTPException(
            status_code=409,
            detail="Project is not awaiting confirmation",
        )

    return {"projectId": project_id, "status": "completed"}


@router.post("/project/{project_id}/messages")
async def create_project_message(project_id: str, request: CreateMessageRequest):
    created = await task_manager.add_user_message(project_id, request.content)
    if not created:
        raise HTTPException(status_code=404, detail="Project not found")

    return {"projectId": project_id, "ok": True}


@router.post("/project/{project_id}/iterate")
async def iterate_project_task(project_id: str, request: IterateTaskRequest):
    queued = await task_manager.iterate_project(project_id, request.prompt)
    if not queued:
        raise HTTPException(
            status_code=409,
            detail="Project is not awaiting confirmation",
        )

    return {"projectId": project_id, "status": "generating"}


@router.get("/{task_id}")
async def get_task(task_id: str):
    raise HTTPException(
        status_code=410,
        detail="Task endpoints are deprecated; use project endpoints instead",
    )


@router.get("/{task_id}/stream")
async def stream_task(task_id: str):
    queue = await task_manager.subscribe(task_id)
    if not queue:
        raise HTTPException(
            status_code=410,
            detail="Task streams are deprecated; use /project/{project_id}/stream",
        )

    return EventSourceResponse(_event_generator(queue))


async def _event_generator(queue: asyncio.Queue):
    while True:
        try:
            event = await asyncio.wait_for(queue.get(), timeout=30)
        except asyncio.TimeoutError:
            yield {
                "event": "ping",
                "data": json.dumps({"ok": True}),
            }
            continue

        event_type = event["type"]
        yield {
            "event": event_type,
            "data": json.dumps(event["data"], ensure_ascii=False),
        }

        if event_type in {"completed", "error"}:
            break
