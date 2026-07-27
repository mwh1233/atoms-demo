
import asyncio
from concurrent.futures import ThreadPoolExecutor
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.preview import router as preview_router
from app.api.tasks import router as tasks_router
from app.config import settings
from app.db.supabase_client import supabase
from app.services.task_manager import task_manager


app = FastAPI(title="Atoms Agent Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 开发阶段允许所有来源，部署后可收紧
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasks_router, prefix="/api")
app.include_router(preview_router, prefix="/api")


@app.get("/health")
async def health():
    # 真健康检查：测试数据库连接
    try:
        # 简单查询测试数据库连通性
        await asyncio.to_thread(lambda: supabase.table("projects").select("id").limit(1).execute())
        return {"ok": True, "db": "connected"}
    except Exception as e:
        return {"ok": False, "db": "disconnected", "error": str(e)}, 503


@app.on_event("startup")
async def startup_event():
    # 扩大默认线程池到20，避免线程池耗尽假死
    loop = asyncio.get_running_loop()
    loop.set_default_executor(ThreadPoolExecutor(max_workers=20))
    task_manager.start_polling()


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.env == "development",
    )
