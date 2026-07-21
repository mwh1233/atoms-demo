"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList, type ChatMessage } from "@/components/chat/MessageList";
import { ProjectPreviewDemo } from "@/components/preview/ProjectPreviewDemo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Message, Project } from "@/lib/types";

type AgentStep = "analyzing" | "designing" | "coding" | "deploying";

type ProjectWorkspaceProps = {
  project: Project;
  userId: string;
  initialMessages: Message[];
};

type TaskCreatedEvent = {
  taskId: string;
  status: string;
  currentStep: AgentStep;
};

type StepStartEvent = {
  step: AgentStep;
  message: string;
};

type StepCompleteEvent = {
  step: AgentStep;
  result: string;
};

type CompletedEvent = {
  code: string;
  deployUrl?: string | null;
};

type AgentErrorEvent = {
  message: string;
  retry?: boolean;
};

const stepIndex: Record<AgentStep, number> = {
  analyzing: 0,
  designing: 1,
  coding: 2,
  deploying: 3
};

const messageStep: Record<AgentStep, Message["step"]> = {
  analyzing: "analysis",
  designing: "design",
  coding: "code",
  deploying: "system"
};

const emptyPreviewHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Atoms Preview</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        overflow: hidden;
        background:
          radial-gradient(circle at 50% 28%, rgba(56, 189, 248, 0.14), transparent 34%),
          linear-gradient(135deg, #0f172a 0%, #111827 48%, #1a1a1a 100%);
        color: #e5e7eb;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        max-width: 520px;
        padding: 48px 32px;
        text-align: center;
      }
      .pulse {
        position: relative;
        width: 56px;
        height: 56px;
        margin: 0 auto 28px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.85);
        border: 1px solid rgba(148, 163, 184, 0.26);
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
      }
      .pulse::before,
      .pulse::after {
        content: "";
        position: absolute;
        inset: 13px;
        border-radius: inherit;
        background: #38bdf8;
        box-shadow: 0 0 28px rgba(56, 189, 248, 0.55);
      }
      .pulse::after {
        inset: -1px;
        border: 1px solid rgba(56, 189, 248, 0.36);
        background: transparent;
        animation: breathe 1.8s ease-in-out infinite;
      }
      h1 {
        margin: 0;
        color: #f8fafc;
        font-size: 28px;
        font-weight: 650;
        letter-spacing: 0;
      }
      p {
        margin: 14px auto 0;
        max-width: 380px;
        color: #94a3b8;
        font-size: 15px;
        line-height: 1.7;
      }
      @keyframes breathe {
        0%, 100% { transform: scale(0.86); opacity: 0.5; }
        50% { transform: scale(1.18); opacity: 1; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="pulse"></div>
      <h1>等待生成预览</h1>
      <p>Agent 完成代码生成后，预览会自动刷新到这里。</p>
    </main>
  </body>
</html>`;

export function ProjectWorkspace({
  project,
  userId,
  initialMessages
}: ProjectWorkspaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages.length
      ? initialMessages
      : [
          {
            id: "initial-prompt",
            project_id: project.id,
            role: "user",
            content: project.initial_prompt,
            step: null,
            created_at: project.created_at
          }
        ]
  );
  const [currentStep, setCurrentStep] = useState(
    project.current_step ? stepIndex[project.current_step] : 0
  );
  const [generatedCode, setGeneratedCode] = useState(project.generated_code || "");
  const [deployUrl, setDeployUrl] = useState(project.deployed_url);
  const [isGenerating, setIsGenerating] = useState(
    project.status === "pending" || project.status === "generating"
  );
  const [errorMessage, setErrorMessage] = useState(project.error_message || "");
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasStartedRef = useRef(false);
  const reconnectAttemptedRef = useRef(false);

  const agentBaseUrl = process.env.NEXT_PUBLIC_AGENT_API_URL;
  const previewCode = useMemo(() => generatedCode || emptyPreviewHtml, [generatedCode]);

  useEffect(() => {
    if (!agentBaseUrl || hasStartedRef.current || !isGenerating) {
      return;
    }

    hasStartedRef.current = true;
    const abortController = new AbortController();

    async function startTask() {
      try {
        appendAssistantMessage("正在创建生成任务...", "system", true);

        const response = await fetch(`${agentBaseUrl}/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            projectId: project.id,
            userId,
            prompt: project.initial_prompt
          }),
          signal: abortController.signal
        });

        if (!response.ok) {
          throw new Error(`创建任务失败：${response.status}`);
        }

        const data = (await response.json()) as { taskId: string; status: string };
        connectStream(data.taskId);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        const message = error instanceof Error ? error.message : "创建任务失败";
        setErrorMessage(message);
        setIsGenerating(false);
        appendAssistantMessage(message, "system", false);
      }
    }

    startTask();

    return () => {
      abortController.abort();
      eventSourceRef.current?.close();
    };
  }, [agentBaseUrl, isGenerating, project.id, project.initial_prompt, userId]);

  function connectStream(taskId: string) {
    if (!agentBaseUrl) {
      return;
    }

    eventSourceRef.current?.close();
    const eventSource = new EventSource(`${agentBaseUrl}/tasks/${taskId}/stream`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("task_created", (event) => {
      const data = parseEvent<TaskCreatedEvent>(event);
      if (!data) return;
      setCurrentStep(stepIndex[data.currentStep]);
      appendAssistantMessage(`任务已创建：${data.status}`, "system", false);
    });

    eventSource.addEventListener("step_start", (event) => {
      const data = parseEvent<StepStartEvent>(event);
      if (!data) return;
      setCurrentStep(stepIndex[data.step]);
      appendAssistantMessage(data.message, messageStep[data.step], true);
    });

    eventSource.addEventListener("step_complete", (event) => {
      const data = parseEvent<StepCompleteEvent>(event);
      if (!data) return;
      setCurrentStep(Math.min(stepIndex[data.step] + 1, 3));
      setMessages((current) => current.map((item) => ({ ...item, isStreaming: false })));
      appendAssistantMessage(data.result, messageStep[data.step], false);
    });

    eventSource.addEventListener("completed", (event) => {
      const data = parseEvent<CompletedEvent>(event);
      if (!data) return;
      setGeneratedCode(data.code);
      setDeployUrl(data.deployUrl ?? null);
      setCurrentStep(3);
      setIsGenerating(false);
      appendAssistantMessage("生成完成，预览区已更新。", "system", false);
      void persistProjectCompletion(data);
      eventSource.close();
    });

    eventSource.addEventListener("error", (event) => {
      if ("data" in event && typeof event.data === "string" && event.data) {
        const data = parseEvent<AgentErrorEvent>(event);
        const message = data?.message || "Agent 生成失败";
        setErrorMessage(message);
        setIsGenerating(false);
        appendAssistantMessage(message, "system", false);
        eventSource.close();
        return;
      }

      if (!reconnectAttemptedRef.current) {
        reconnectAttemptedRef.current = true;
        eventSource.close();
        window.setTimeout(() => connectStream(taskId), 1000);
        return;
      }

      setErrorMessage("SSE 连接已断开，请稍后重试。");
      setIsGenerating(false);
      appendAssistantMessage("SSE 连接已断开，请稍后重试。", "system", false);
      eventSource.close();
    });
  }

  async function persistProjectCompletion(data: CompletedEvent) {
    const supabase = createSupabaseBrowserClient();
    await supabase
      .from("projects")
      .update({
        status: "completed",
        current_step: null,
        generated_code: data.code,
        deploy_status: data.deployUrl ? "success" : "not_deployed",
        deployed_url: data.deployUrl ?? null,
        deployed_at: data.deployUrl ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq("id", project.id);
  }

  function handleSend(content: string) {
    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        project_id: project.id,
        role: "user",
        content,
        step: null,
        created_at: new Date().toISOString()
      }
    ]);
  }

  function appendAssistantMessage(
    content: string,
    step: Message["step"],
    isStreaming: boolean
  ) {
    setMessages((current) => [
      ...current.map((item) => ({ ...item, isStreaming: false })),
      {
        id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        project_id: project.id,
        role: "assistant",
        content,
        step,
        created_at: new Date().toISOString(),
        isStreaming
      }
    ]);
  }

  return (
    <div className="grid min-h-[620px] gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <Card className="min-h-0 bg-card/90">
        <CardHeader>
          <CardTitle>对话区</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0">
          <div className="flex h-[620px] min-h-0 flex-col">
            <MessageList currentStep={currentStep} messages={messages} />
            {errorMessage ? (
              <p className="border-t border-border pt-3 text-sm text-destructive-foreground">
                {errorMessage}
              </p>
            ) : null}
            <MessageInput disabled={isGenerating} onSend={handleSend} />
          </div>
        </CardContent>
      </Card>

      <Card className="min-h-0 bg-card/90">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>预览区</CardTitle>
            {deployUrl ? (
              <a
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                href={deployUrl}
                rel="noreferrer"
                target="_blank"
              >
                部署链接
              </a>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="min-h-0">
          <ProjectPreviewDemo code={previewCode} />
        </CardContent>
      </Card>
    </div>
  );
}

function parseEvent<T>(event: Event): T | null {
  if (!("data" in event) || typeof event.data !== "string") {
    return null;
  }

  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}
