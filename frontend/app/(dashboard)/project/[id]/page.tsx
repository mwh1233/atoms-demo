import { notFound, redirect } from "next/navigation";
import { ProjectWorkspace } from "@/components/project/ProjectWorkspace";
import { getCurrentUser } from "@/lib/supabase/server";
import type { Message, Project } from "@/lib/types";

export const dynamic = "force-dynamic";

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

  const { user, supabase } = await getCurrentUser();

  if (!user) {
    redirect("/auth");
  }

  // 并行查询project和messages，节省一半时间
  const [projectResult, messagesResult] = await Promise.all([
    supabase
      .from("projects")
      .select("*")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("messages")
      .select("*")
      .eq("project_id", params.id)
      .order("created_at", { ascending: true }),
  ]);

  const project = projectResult.data;
  const messages = messagesResult.data;

  if (!project) {
    notFound();
  }

  const typedProject = project as Project;

  return (
    <section className="relative left-1/2 -mb-10 -mt-10 w-screen -translate-x-1/2 overflow-hidden">
      <ProjectWorkspace
        initialMessages={(messages ?? []) as Message[]}
        project={typedProject}
        userId={user.id}
      />
    </section>
  );
}
