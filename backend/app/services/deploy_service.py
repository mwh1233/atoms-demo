import asyncio
from datetime import datetime, timezone

from app.db.supabase_client import supabase


DEPLOY_BUCKET = "deployed-projects"


async def deploy_project(project_id: str, html_code: str) -> str:
    file_path = f"projects/{project_id}/index.html"
    file_content = html_code.encode("utf-8")

    await asyncio.to_thread(
        supabase.storage.from_(DEPLOY_BUCKET).upload,
        file_path,
        file_content,
        {
            "content-type": "text/html",
            "upsert": "true",
        },
    )

    public_url = supabase.storage.from_(DEPLOY_BUCKET).get_public_url(file_path)

    await asyncio.to_thread(
        lambda: supabase.table("projects")
        .update(
            {
                "deploy_status": "success",
                "deployed_url": public_url,
                "deployed_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", project_id)
        .execute()
    )

    return public_url
