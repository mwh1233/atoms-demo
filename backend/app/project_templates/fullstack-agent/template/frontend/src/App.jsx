import { useState } from 'react';

import ChatBox from './components/ChatBox.jsx';
import TodoList from './components/TodoList.jsx';

const navItems = [
  { id: 'todos', label: 'Todo List' },
  { id: 'chat', label: 'Chat Agent' },
];

export default function App() {
  const [activePage, setActivePage] = useState('todos');

  return (
    <div className="min-h-screen bg-atoms-bg text-atoms-text">
      <div className="flex min-h-screen">
        <aside className="w-64 border-r border-atoms-line bg-atoms-panel px-5 py-6">
          <div className="mb-8">
            <p className="text-sm uppercase tracking-wider text-atoms-muted">Atoms Template</p>
            <h1 className="mt-2 text-xl font-semibold">Agent Workspace</h1>
          </div>

          <nav className="space-y-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActivePage(item.id)}
                className={`w-full rounded-lg px-4 py-3 text-left text-sm font-medium transition ${
                  activePage === item.id
                    ? 'bg-atoms-accent text-black'
                    : 'text-atoms-muted hover:bg-white/5 hover:text-atoms-text'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 px-8 py-7">
          <div className="mx-auto max-w-5xl">
            {activePage === 'todos' ? <TodoList /> : <ChatBox />}
          </div>
        </main>
      </div>
    </div>
  );
}
