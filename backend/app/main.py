
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.preview import router as preview_router
from app.api.tasks import router as tasks_router
from app.config import settings
from app.services.task_manager import task_manager


app = FastAPI(title="Atoms Agent Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(
        {
            settings.frontend_url,
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        }
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasks_router, prefix="/api")
app.include_router(preview_router, prefix="/api")


@app.get("/health")
async def health():
    return {"ok": True}


@app.on_event("startup")
async def startup_event():
    task_manager.start_polling()


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.env == "development",
    )
