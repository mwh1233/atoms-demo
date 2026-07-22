import { ArrowRight, Blocks, Database, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const featureCards = [
  {
    icon: Blocks,
    title: '模块化架构',
    description: 'FastAPI 自动发现 routers/ 目录下的路由，适合 AI 安全增量扩展。',
  },
  {
    icon: ShieldCheck,
    title: '认证骨架',
    description: '保留 OIDC/JWT 认证服务、依赖注入和 AuthContext，方便接入真实用户系统。',
  },
  {
    icon: Database,
    title: '数据库与迁移',
    description: 'SQLAlchemy 异步会话、Alembic 迁移和数据库初始化流程开箱可用。',
  },
];

export default function Index() {
  return (
    <div className="min-h-full bg-background p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="space-y-5">
          <Badge variant="outline">Enterprise Fullstack Template</Badge>
          <div className="max-w-3xl space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight">
              企业级全栈应用模板
            </h1>
            <p className="text-lg leading-8 text-muted-foreground">
              基于 FastAPI、React、TypeScript、TailwindCSS 和 shadcn/ui，保留认证、日志、自动路由、
              数据库初始化和完整组件库，用最小 Todo 示例展示标准开发方式。
            </p>
          </div>
          <Button asChild>
            <Link to="/todos">
              查看 Todo 示例
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {featureCards.map((item) => (
            <Card key={item.title}>
              <CardHeader>
                <item.icon className="mb-3 h-8 w-8 text-violet-500" />
                <CardTitle>{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-1 rounded-full bg-gradient-to-r from-violet-500 to-indigo-500" />
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    </div>
  );
}
