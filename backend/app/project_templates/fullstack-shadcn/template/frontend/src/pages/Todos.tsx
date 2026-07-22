import TodoList from '@/components/TodoList';

export default function Todos() {
  return (
    <div className="min-h-full bg-background p-8">
      <div className="mx-auto max-w-5xl">
        <TodoList />
      </div>
    </div>
  );
}
