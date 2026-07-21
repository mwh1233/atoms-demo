import { cookies } from "next/headers";
import { Code2, Layers, Rocket, Sparkles } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { HomeCreateForm } from "@/components/home/HomeCreateForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Template } from "@/lib/types";

export const dynamic = "force-dynamic";

const features = [
  {
    title: "需求理解",
    description: "把自然语言想法拆成页面、数据和交互任务。",
    icon: Sparkles
  },
  {
    title: "自动编码",
    description: "生成前端页面、组件结构和基础业务流程。",
    icon: Code2
  },
  {
    title: "实时预览",
    description: "在项目详情中查看生成进度和可运行效果。",
    icon: Layers
  },
  {
    title: "部署准备",
    description: "为后续发布、部署和迭代保留清晰项目状态。",
    icon: Rocket
  }
];

export default async function HomePage() {
  let templates: Template[] = [];
  let userEmail: string | null = null;
  let userId: string | null = null;

  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    const supabase = createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    userEmail = user?.email ?? null;
    userId = user?.id ?? null;

    const { data } = await supabase
      .from("templates")
      .select("*")
      .order("sort_order", { ascending: true });
    templates = (data ?? []) as Template[];
  } else {
    cookies();
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header userEmail={userEmail} />
      <main className="mx-auto w-full max-w-6xl px-6 pb-16">
        <HomeCreateForm templates={templates} userId={userId} />

        <section className="mt-16 space-y-5">
          <div>
            <p className="text-sm text-muted-foreground">Features</p>
            <h2 className="text-2xl font-semibold tracking-normal">从想法到产品的一条直线</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <Card key={feature.title} className="bg-card/80">
                <CardHeader>
                  <feature.icon className="mb-3 h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
