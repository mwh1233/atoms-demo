import { useEffect, useState } from 'react';

export default function TodoList() {
  const [todos, setTodos] = useState([]);
  const [title, setTitle] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadTodos() {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch('/api/todos');
      if (!response.ok) throw new Error('Failed to load todos');
      setTodos(await response.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadTodos();
  }, []);

  async function addTodo(event) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;

    try {
      setError('');
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: nextTitle }),
      });
      if (!response.ok) throw new Error('Failed to add todo');

      setTitle('');
      await loadTodos();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleTodo(todoId) {
    try {
      setError('');
      const response = await fetch(`/api/todos/${todoId}`, { method: 'PATCH' });
      if (!response.ok) throw new Error('Failed to update todo');

      const updatedTodo = await response.json();
      setTodos((currentTodos) =>
        currentTodos.map((todo) => (todo.id === todoId ? updatedTodo : todo)),
      );
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteTodo(todoId) {
    try {
      setError('');
      const response = await fetch(`/api/todos/${todoId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete todo');

      setTodos((currentTodos) => currentTodos.filter((todo) => todo.id !== todoId));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section>
      <div className="mb-6">
        <p className="text-sm text-atoms-muted">CRUD Example</p>
        <h2 className="mt-1 text-3xl font-semibold">Todo List</h2>
      </div>

      <form onSubmit={addTodo} className="mb-6 flex gap-3">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task"
          className="flex-1 rounded-lg border border-atoms-line bg-atoms-panel px-4 py-3 text-atoms-text outline-none transition placeholder:text-atoms-muted focus:border-atoms-accent"
        />
        <button
          type="submit"
          className="rounded-lg bg-atoms-accent px-5 py-3 font-semibold text-black transition hover:brightness-110"
        >
          Add
        </button>
      </form>

      {error ? <p className="mb-4 text-sm text-red-300">{error}</p> : null}
      {isLoading ? <p className="text-atoms-muted">Loading todos...</p> : null}

      <div className="space-y-3">
        {todos.map((todo) => (
          <article
            key={todo.id}
            className="flex items-center justify-between rounded-lg border border-atoms-line bg-atoms-panel px-4 py-3"
          >
            <button
              type="button"
              onClick={() => toggleTodo(todo.id)}
              className={`text-left transition ${
                todo.completed ? 'text-atoms-muted line-through' : 'text-atoms-text'
              }`}
            >
              {todo.title}
            </button>
            <button
              type="button"
              onClick={() => deleteTodo(todo.id)}
              className="rounded-md border border-atoms-line px-3 py-2 text-sm text-atoms-muted transition hover:border-red-400 hover:text-red-300"
            >
              Delete
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
