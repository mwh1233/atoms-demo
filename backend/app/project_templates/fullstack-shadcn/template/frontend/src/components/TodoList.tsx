import { useEffect, useState, type FormEvent } from 'react';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getAPIBaseURL } from '@/lib/config';
import { cn } from '@/lib/utils';

type Todo = {
  id: number;
  title: string;
  description?: string | null;
  completed: boolean;
  created_at: string;
  updated_at: string;
};

export default function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    // 示例项目直接使用 fetch，真实业务中可以替换为 src/lib/api.ts 中的统一请求封装。
    const response = await fetch(`${getAPIBaseURL()}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Request failed: ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async function loadTodos() {
    setIsLoading(true);
    setError('');
    try {
      setTodos(await request<Todo[]>('/api/v1/todos'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load todos');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadTodos();
  }, []);

  async function createTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;

    try {
      setError('');
      const todo = await request<Todo>('/api/v1/todos', {
        method: 'POST',
        body: JSON.stringify({
          title: nextTitle,
          description: description.trim() || null,
        }),
      });
      setTodos((current) => [todo, ...current]);
      setTitle('');
      setDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create todo');
    }
  }

  async function toggleTodo(todo: Todo) {
    try {
      const updated = await request<Todo>(`/api/v1/todos/${todo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: !todo.completed }),
      });
      setTodos((current) =>
        current.map((item) => (item.id === todo.id ? updated : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update todo');
    }
  }

  async function deleteTodo(todoId: number) {
    try {
      await request<void>(`/api/v1/todos/${todoId}`, { method: 'DELETE' });
      setTodos((current) => current.filter((todo) => todo.id !== todoId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete todo');
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
      <Card>
        <CardHeader>
          <CardTitle>创建 Todo</CardTitle>
          <CardDescription>
            这个示例展示 React + shadcn/ui 如何调用 FastAPI CRUD 接口。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={createTodo}>
            <div className="space-y-2">
              <Label htmlFor="title">标题</Label>
              <Input
                id="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：整理需求文档"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">描述</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="补充任务背景或验收标准"
              />
            </div>
            <Button className="w-full" type="submit">
              <Plus className="h-4 w-4" />
              添加任务
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Todo 列表</CardTitle>
          <CardDescription>
            点击复选框切换状态，或删除不需要的任务。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载任务...
            </div>
          ) : null}

          {!isLoading && todos.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              还没有任务，先创建一个 Todo。
            </div>
          ) : null}

          <div className="space-y-3">
            {todos.map((todo) => (
              <div
                key={todo.id}
                className="flex items-start justify-between gap-3 rounded-lg border p-4"
              >
                <div className="flex gap-3">
                  <Checkbox
                    checked={todo.completed}
                    className="mt-1"
                    onCheckedChange={() => void toggleTodo(todo)}
                  />
                  <div>
                    <div
                      className={cn(
                        'font-medium',
                        todo.completed && 'text-muted-foreground line-through',
                      )}
                    >
                      {todo.title}
                    </div>
                    {todo.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {todo.description}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {todo.completed ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : null}
                  <Button
                    aria-label="删除 Todo"
                    size="icon"
                    variant="ghost"
                    onClick={() => void deleteTodo(todo.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
