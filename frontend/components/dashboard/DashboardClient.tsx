"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Project } from "@/lib/types";

const statusLabels: Record<Project["status"], string> = {
  pending: "等待中",
  generating: "生成中",
  awaiting_features_confirmation: "待确认功能",
  awaiting_confirmation: "待确认",
  completed: "已完成",
  failed: "失败"
};

const statusClasses: Record<Project["status"], string> = {
  pending: "border-zinc-600 bg-zinc-800 text-zinc-200",
  generating: "border-sky-500/40 bg-sky-500/15 text-sky-200",
  awaiting_features_confirmation: "border-violet-500/40 bg-violet-500/15 text-violet-200",
  awaiting_confirmation: "border-amber-500/40 bg-amber-500/15 text-amber-200",
  completed: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  failed: "border-red-500/40 bg-red-500/15 text-red-200"
};

type DashboardClientProps = {
  projects: Project[];
};

export function DashboardClient({ projects }: DashboardClientProps) {
  const router = useRouter();
  const [items, setItems] = useState(projects);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    if (!projectToDelete) {
      return;
    }

    const target = projectToDelete;
    const previousItems = items;
    setItems((current) => current.filter((project) => project.id !== target.id));
    setProjectToDelete(null);
    setIsDeleting(true);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("projects").delete().eq("id", target.id);

    setIsDeleting(false);

    if (error) {
      setItems(previousItems);
      window.alert(error.message);
      return;
    }

    router.refresh();
  }

  return (
    <>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">工作台</p>
          <h1 className="text-3xl font-semibold tracking-normal">我的项目</h1>
        </div>
        <Button asChild>
          <Link href="/#create">
            <Plus className="mr-2 h-4 w-4" />
            新建项目
          </Link>
        </Button>
      </div>

      {items.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((project) => (
            <Card
              key={project.id}
              className="group relative border-border/80 bg-card/90 transition-colors hover:border-ring/50"
            >
              <Link href={`/project/${project.id}`} className="block">
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="line-clamp-2 text-lg">{project.name}</CardTitle>
                    <Badge className={statusClasses[project.status]} variant="outline">
                      {statusLabels[project.status]}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {project.description || project.initial_prompt}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    创建于 {formatDate(project.created_at)}
                  </p>
                </CardContent>
              </Link>
              <Button
                aria-label="删除项目"
                className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100"
                size="icon"
                variant="destructive"
                onClick={() => setProjectToDelete(project)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState />
      )}

      <Dialog open={Boolean(projectToDelete)} onOpenChange={() => setProjectToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除项目</DialogTitle>
            <DialogDescription>
              删除后无法恢复。确定要删除“{projectToDelete?.name}”吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProjectToDelete(null)}>
              取消
            </Button>
            <Button variant="destructive" disabled={isDeleting} onClick={handleDelete}>
              {isDeleting ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-lg bg-secondary">
        <Plus className="h-9 w-9 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold">还没有项目</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        输入一个产品想法，Atoms 会为你创建项目并进入生成流程。
      </p>
      <Button asChild className="mt-6">
        <Link href="/#create">创建第一个项目</Link>
      </Button>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
