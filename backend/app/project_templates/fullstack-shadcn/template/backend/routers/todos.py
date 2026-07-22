from dependencies.database import DbSession
from fastapi import APIRouter, HTTPException, status
from models.todo import Todo
from schemas.todo import TodoCreate, TodoResponse, TodoUpdate
from sqlalchemy import select


router = APIRouter(prefix="/api/v1/todos", tags=["todos"])


@router.get("", response_model=list[TodoResponse])
async def list_todos(db: DbSession):
    """返回 Todo 列表，按创建时间倒序排列。"""
    result = await db.execute(select(Todo).order_by(Todo.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=TodoResponse, status_code=status.HTTP_201_CREATED)
async def create_todo(payload: TodoCreate, db: DbSession):
    """创建 Todo，展示标准的异步 SQLAlchemy 写法。"""
    todo = Todo(
        title=payload.title.strip(),
        description=payload.description,
        completed=False,
    )
    if not todo.title:
        raise HTTPException(status_code=400, detail="Title is required")

    db.add(todo)
    await db.commit()
    await db.refresh(todo)
    return todo


@router.patch("/{todo_id}", response_model=TodoResponse)
async def update_todo(todo_id: int, payload: TodoUpdate, db: DbSession):
    """局部更新 Todo，可用于修改标题、描述或完成状态。"""
    todo = await db.get(Todo, todo_id)
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "title" in update_data and update_data["title"] is not None:
        update_data["title"] = update_data["title"].strip()
        if not update_data["title"]:
            raise HTTPException(status_code=400, detail="Title is required")

    for key, value in update_data.items():
        setattr(todo, key, value)

    await db.commit()
    await db.refresh(todo)
    return todo


@router.delete("/{todo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_todo(todo_id: int, db: DbSession):
    """删除 Todo。"""
    todo = await db.get(Todo, todo_id)
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")

    await db.delete(todo)
    await db.commit()
