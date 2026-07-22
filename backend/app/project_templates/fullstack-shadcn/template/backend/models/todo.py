from models.base import BaseModel
from sqlalchemy import Boolean, Column, String, Text


class Todo(BaseModel):
    """标准 Todo 示例模型，展示业务模型应如何继承通用 BaseModel。"""

    __tablename__ = "todos"

    title = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    completed = Column(Boolean, nullable=False, default=False)
