from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import chat, todos
from .database import Base, engine


app = FastAPI(title="Fullstack Agent Template")

# 开发模板默认允许所有来源，生产环境应收紧为明确域名。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    # 模板启动时自动创建数据表，便于开箱即用。
    Base.metadata.create_all(bind=engine)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(todos.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
