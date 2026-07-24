"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Template } from "@/lib/types";

type HomeCreateFormProps = {
  templates: Template[];
  userId?: string | null;
};

function normalizeAgentBaseUrl(url: string) {
  const normalizedUrl = url.trim().replace(/\/$/, "");
  if (!normalizedUrl) {
    return "";
  }
  return normalizedUrl.endsWith("/api") ? normalizedUrl : `${normalizedUrl}/api`;
}

export function HomeCreateForm({ templates, userId }: HomeCreateFormProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  async function createProject(nextPrompt = prompt) {
    const trimmedPrompt = nextPrompt.trim();

    if (!trimmedPrompt) {
      setError("请先输入你的产品想法。");
      return;
    }

    if (!userId) {
      router.push(`/auth?prompt=${encodeURIComponent(trimmedPrompt)}`);
      return;
    }

    setError("");
    setIsCreating(true);
    const supabase = createSupabaseBrowserClient();
    const { data, error: insertError } = await supabase
      .from("projects")
      .insert({
        user_id: userId,
        name: trimmedPrompt.slice(0, 20),
        description: null,
        initial_prompt: trimmedPrompt,
        status: "pending",
        current_step: null,
        generated_code: null,
        error_message: null,
        deploy_status: "not_deployed",
        deployed_url: null,
        deployed_at: null
      })
      .select("id")
      .single();

    if (insertError) {
      setIsCreating(false);
      setError(insertError.message);
      return;
    }

    await supabase.from("messages").insert({
      project_id: data.id,
      role: "user",
      content: trimmedPrompt,
      step: "",
      created_at: new Date().toISOString()
    });

    const agentBaseUrl = normalizeAgentBaseUrl(process.env.NEXT_PUBLIC_AGENT_API_URL || "");
    if (agentBaseUrl) {
      let taskResponse: Response;
      try {
        taskResponse = await fetch(`${agentBaseUrl}/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            projectId: data.id,
            userId,
            prompt: trimmedPrompt
          })
        });
      } catch (error) {
        setIsCreating(false);
        setError(error instanceof Error ? error.message : "Failed to create generation task");
        return;
      }

      if (!taskResponse.ok) {
        setIsCreating(false);
        setError(`Failed to create generation task: ${taskResponse.status}`);
        return;
      }
    }

    setIsCreating(false);

    router.push(`/project/${data.id}`);
    router.refresh();
  }

  return (
    <div className="relative space-y-10">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute -top-20 -left-20 h-96 w-96 rounded-full bg-blue-500/5 blur-3xl" />
      <div className="pointer-events-none absolute top-40 -right-20 h-96 w-96 rounded-full bg-purple-500/5 blur-3xl" />

      <section id="create" className="relative grid min-h-[520px] items-center gap-8 py-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">AI 产品生成工作台</p>
          <h1 className="max-w-3xl text-5xl font-semibold tracking-normal">
            把想法变成可运行的产品
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            AI 多智能体团队为你自动构建全栈应用，从需求理解到代码生成与预览，一路推进。
          </p>
          <div className="rounded-lg border border-border/80 bg-card/80 p-3 shadow-xl shadow-black/5">
            <textarea
              className="min-h-32 w-full resize-none rounded-md border border-input bg-background px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
              placeholder="例如：帮我做一个面向独立开发者的 SaaS 收款数据看板..."
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {userId ? "将直接创建项目并进入详情页。" : "登录后会继续创建你的项目。"}
              </p>
              <Button disabled={isCreating} onClick={() => createProject()}>
                {isCreating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="mr-2 h-4 w-4" />
                )}
                开始生成
              </Button>
            </div>
            {error ? <p className="mt-3 text-sm text-destructive-foreground">{error}</p> : null}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/10">
          {/* 浏览器顶栏 */}
          <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-3">
            <div className="flex gap-1.5">
              <div className="h-3 w-3 rounded-full bg-red-500/80" />
              <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
              <div className="h-3 w-3 rounded-full bg-green-500/80" />
            </div>
            <div className="ml-4 flex-1 rounded-md bg-background px-3 py-1 text-xs text-muted-foreground">
              atoms.app/dashboard
            </div>
          </div>
          {/* 预览内容 */}
          <div className="bg-gradient-to-br from-slate-50 to-blue-50 p-4 dark:from-slate-900 dark:to-slate-800">
            <div className="mb-3 flex items-center justify-between">
              <div className="h-6 w-24 rounded bg-blue-500/20" />
              <div className="flex gap-2">
                <div className="h-6 w-16 rounded bg-muted" />
                <div className="h-6 w-16 rounded bg-blue-500" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="h-20 rounded-lg border border-border bg-white p-3 shadow-sm dark:bg-slate-800">
                <div className="mb-2 h-3 w-12 rounded bg-muted" />
                <div className="h-5 w-16 rounded bg-blue-500/30" />
              </div>
              <div className="h-20 rounded-lg border border-border bg-white p-3 shadow-sm dark:bg-slate-800">
                <div className="mb-2 h-3 w-12 rounded bg-muted" />
                <div className="h-5 w-20 rounded bg-green-500/30" />
              </div>
              <div className="h-20 rounded-lg border border-border bg-white p-3 shadow-sm dark:bg-slate-800">
                <div className="mb-2 h-3 w-12 rounded bg-muted" />
                <div className="h-5 w-14 rounded bg-purple-500/30" />
              </div>
            </div>
            <div className="mt-3 h-32 rounded-lg border border-border bg-white p-3 shadow-sm dark:bg-slate-800">
              <div className="mb-2 h-3 w-20 rounded bg-muted" />
              <div className="space-y-2">
                <div className="h-2 w-full rounded bg-muted/70" />
                <div className="h-2 w-5/6 rounded bg-muted/70" />
                <div className="h-2 w-4/6 rounded bg-muted/70" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-5">
        <div>
          <p className="text-sm text-muted-foreground">Templates</p>
          <h2 className="text-2xl font-semibold tracking-normal">从模板开始</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {templates.length ? (
            templates.map((template) => (
              <button
                key={template.id}
                className="rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-ring/60 hover:bg-accent"
                type="button"
                onClick={() => {
                  setPrompt(template.default_prompt);
                  void createProject(template.default_prompt);
                }}
              >
                <span className="mb-4 inline-flex rounded-md border px-2 py-1 text-xs text-muted-foreground">
                  {template.category}
                </span>
                <h3 className="font-semibold">{template.name}</h3>
                <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                  {template.description || template.default_prompt}
                </p>
              </button>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card/60 p-6 text-sm text-muted-foreground md:col-span-2 lg:col-span-4">
              暂无模板数据。配置 Supabase 后，可从 templates 表读取模板。
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
