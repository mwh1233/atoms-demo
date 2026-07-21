import asyncio
import json
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.services.task_manager import task_manager


router = APIRouter(prefix="/tasks", tags=["tasks"])


class CreateTaskRequest(BaseModel):
    projectId: str
    userId: str
    prompt: str


def _format_task(task: dict) -> dict:
    return {
        "taskId": task["task_id"],
        "projectId": task["project_id"],
        "userId": task["user_id"],
        "status": task["status"],
        "currentStep": task["current_step"],
        "analysisResult": task["analysis_result"],
        "designResult": task["design_result"],
        "generatedCode": task["generated_code"],
        "deployUrl": task["deploy_url"],
        "error": task["error_message"],
    }


@router.post("")
async def create_task(request: CreateTaskRequest):
    task_id = await task_manager.create_task(
        request.projectId,
        request.userId,
        request.prompt,
    )
    task = task_manager.get_task(task_id)

    return {
        "taskId": task_id,
        "projectId": request.projectId,
        "status": task["status"] if task else "pending",
    }


@router.get("/{task_id}")
async def get_task(task_id: str):
    task = task_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return _format_task(task)


@router.get("/{task_id}/stream")
async def stream_task(task_id: str):
    if not task_manager.get_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")

    queue = await task_manager.subscribe(task_id)

    async def event_generator():
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

    return EventSourceResponse(event_generator())
