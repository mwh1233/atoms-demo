import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { CheckSquare, Home } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', icon: Home, label: '首页' },
  { to: '/todos', icon: CheckSquare, label: 'Todo 示例' },
];

const Layout: React.FC = () => {
  return (
    <div className="flex h-screen bg-background">
      <aside className="flex w-64 flex-col border-r border-border bg-card">
        <div className="border-b border-border p-6">
          <h1 className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-xl font-bold text-transparent">
            Enterprise Stack
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            FastAPI + React + shadcn/ui
          </p>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-violet-50 text-violet-700 shadow-sm dark:bg-violet-950/50 dark:text-violet-300'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-4">
          <div className="text-center text-xs text-muted-foreground">
            Built for AI-assisted development
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
