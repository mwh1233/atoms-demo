import asyncio
import mimetypes

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.db.supabase_client import supabase
from app.services.deploy_service import DEPLOY_BUCKET


router = APIRouter(prefix="/preview", tags=["preview"])

MIME_MAP = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json; charset=utf-8",
}


def _get_content_type(filename: str) -> str:
    normalized = filename.lower()
    for ext, mime in MIME_MAP.items():
        if normalized.endswith(ext):
            return mime

    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


@router.get("/{project_id}/{file_path:path}")
async def preview_file(project_id: str, file_path: str) -> Response:
    """Proxy preview files from Storage while forcing the correct MIME type."""
    storage_path = f"projects/{project_id}/{file_path}"

    try:
        content = await asyncio.to_thread(
            supabase.storage.from_(DEPLOY_BUCKET).download,
            storage_path,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=404,
            detail=f"File not found: {storage_path}",
        ) from exc

    content_type = _get_content_type(file_path)
    return Response(
        content=content,
        media_type=content_type.split(";", 1)[0],
        headers={
            "Content-Type": content_type,
            "Cache-Control": "no-cache",
        },
    )
