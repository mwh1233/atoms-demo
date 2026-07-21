import { notFound, redirect } from "next/navigation";
import { ProjectWorkspace } from "@/components/project/ProjectWorkspace";
import { Badge } from "@/components/ui/badge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Message, Project } from "@/lib/types";

export const dynamic = "force-dynamic";

const statusLabels: Record<Project["status"], string> = {
  pending: "等待中",
  generating: "生成中",
  awaiting_confirmation: "待确认",
  completed: "已完成",
  failed: "失败"
};

type ProjectPageProps = {
  params: {
    id: string;
  };
};

export default async function ProjectPage({ params }: ProjectPageProps) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    redirect("/auth");
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!project) {
    notFound();
  }

  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("project_id", params.id)
    .order("created_at", { ascending: true });

  const typedProject = project as Project;

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">项目详情</p>
          <h1 className="text-3xl font-semibold tracking-normal">{typedProject.name}</h1>
        </div>
        <Badge variant="outline">{statusLabels[typedProject.status]}</Badge>
      </div>

      <ProjectWorkspace
        initialMessages={(messages ?? []) as Message[]}
        project={typedProject}
        userId={user.id}
      />
    </section>
  );
}
