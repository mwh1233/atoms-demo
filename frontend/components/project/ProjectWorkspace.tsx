"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList, type ChatMessage } from "@/components/chat/MessageList";
import { StepProgress } from "@/components/chat/StepProgress";
import { ProjectPreviewDemo } from "@/components/preview/ProjectPreviewDemo";
import { Button } from "@/components/ui/button";
import type { Feature, Message, Project } from "@/lib/types";

type WorkflowStep =
  | "analyzing"
  | "designing"
  | "coding"
  | "reviewing"
  | "building"
  | "deploying";
type AgentStep = "pending" | WorkflowStep | "completed";

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
  step: WorkflowStep;
  message: string;
};

type StepCompleteEvent = {
  step: WorkflowStep;
  result: string;
  generatedFiles?: Record<string, string>;
  templateId?: string | null;
};

type TokenEvent = {
  step: WorkflowStep;
  delta: string;
  content: string;
};

type CompletedEvent = {
  code: string;
  deployUrl?: string | null;
  generatedFiles?: Record<string, string>;
  templateId?: string | null;
};

type FeaturesConfirmationEvent = {
  features: Feature[];
};

type AgentErrorEvent = {
  message: string;
  retry?: boolean;
};

const stepIndex: Record<WorkflowStep, number> = {
  analyzing: 0,
  designing: 1,
  coding: 2,
  reviewing: 2,
  building: 3,
  deploying: 3
};

const messageStep: Record<WorkflowStep, Message["step"]> = {
  analyzing: "analysis",
  designing: "design",
  coding: "code",
  reviewing: "system",
  building: "system",
  deploying: "system"
};

const emptyPreviewHtml = `<!doctype html>
<html lang="en">
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
        background:
          radial-gradient(circle at 50% 28%, rgba(56, 189, 248, 0.14), transparent 34%),
          linear-gradient(135deg, #0f172a 0%, #111827 48%, #1a1a1a 100%);
        color: #e5e7eb;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main { max-width: 520px; padding: 48px 32px; text-align: center; }
      .pulse {
        position: relative;
        width: 56px;
        height: 56px;
        margin: 0 auto 28px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.85);
        border: 1px solid rgba(148, 163, 184, 0.26);
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
      h1 { margin: 0; color: #f8fafc; font-size: 28px; font-weight: 650; }
      p { margin: 14px auto 0; max-width: 380px; color: #94a3b8; font-size: 15px; line-height: 1.7; }
      @keyframes breathe {
        0%, 100% { transform: scale(0.86); opacity: 0.5; }
        50% { transform: scale(1.18); opacity: 1; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="pulse"></div>
      <h1>Waiting for preview</h1>
      <p>The generated page will appear here when the workflow produces code.</p>
    </main>
  </body>
</html>`;

function getStepIndex(step?: string | null) {
  if (!step || step === "pending") {
    return 0;
  }
  if (step === "completed") {
    return 4;
  }
  return stepIndex[step as WorkflowStep] ?? 0;
}

function getInitialStepIndex(project: Project) {
  if (project.status === "awaiting_features_confirmation") {
    return 1;
  }

  if (
    project.status === "awaiting_confirmation" ||
    project.status === "completed" ||
    project.status === "failed"
  ) {
    return 4;
  }
  return getStepIndex(project.current_step);
}

function normalizeAgentBaseUrl(url: string) {
  const normalizedUrl = url.trim().replace(/\/$/, "");
  if (!normalizedUrl) {
    return "";
  }
  return normalizedUrl.endsWith("/api") ? normalizedUrl : `${normalizedUrl}/api`;
}

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
  const [currentStep, setCurrentStep] = useState(() => getInitialStepIndex(project));
  const [generatedCode, setGeneratedCode] = useState(project.generated_code || "");
  const [generatedFiles, setGeneratedFiles] = useState<Record<string, string>>(
    project.generated_files || {}
  );
  const [templateId, setTemplateId] = useState(project.template_id || "fullstack-shadcn");
  const [deployUrl, setDeployUrl] = useState(project.deployed_url);
  const [projectStatus, setProjectStatus] = useState<Project["status"]>(project.status);
  const [errorMessage, setErrorMessage] = useState(project.error_message || "");
  const [isConfirming, setIsConfirming] = useState(false);
  const [isConfirmingFeatures, setIsConfirmingFeatures] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [features, setFeatures] = useState<Feature[]>(project.features_list || []);
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<Set<string>>(
    () =>
      new Set(
        (project.confirmed_features?.length
          ? project.confirmed_features
          : project.features_list || []
        )
          .filter((feature) => feature.defaultSelected !== false)
          .map((feature) => feature.id),
      ),
  );
  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const projectStatusRef = useRef<Project["status"]>(project.status);
  const sseConnectedRef = useRef(false);
  const taskCreationStartedRef = useRef(false);
  const reconnectAttemptedRef = useRef(false);

  const agentBaseUrl = useMemo(
    () => normalizeAgentBaseUrl(process.env.NEXT_PUBLIC_AGENT_API_URL || ""),
    []
  );
  const previewCode = useMemo(() => generatedCode || emptyPreviewHtml, [generatedCode]);
  const isGenerating = projectStatus === "pending" || projectStatus === "generating";
  const isAwaitingFeaturesConfirmation =
    projectStatus === "awaiting_features_confirmation";
  const isAwaitingConfirmation = projectStatus === "awaiting_confirmation";
  const isInputDisabled =
    projectStatus === "generating" ||
    projectStatus === "awaiting_features_confirmation" ||
    projectStatus === "completed";

  useEffect(() => {
    projectStatusRef.current = project.status;
  }, [project.status]);

  useEffect(() => {
    projectStatusRef.current = projectStatus;
  }, [projectStatus]);

  useEffect(() => {
    const shouldConnectStream =
      projectStatusRef.current === "pending" || projectStatusRef.current === "generating";

    if (!agentBaseUrl && shouldConnectStream) {
      setErrorMessage("Agent API URL is not configured.");
      return;
    }

    if (!agentBaseUrl || !shouldConnectStream) {
      return;
    }

    const abortController = new AbortController();

    async function startTask() {
      if (taskCreationStartedRef.current || abortController.signal.aborted) {
        return;
      }
      if (projectStatusRef.current !== "pending") {
        return;
      }

      taskCreationStartedRef.current = true;
      try {
        appendAssistantMessage("Creating generation task...", "system", false);

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
          throw new Error(`Failed to create task: ${response.status}`);
        }

        const data = (await response.json()) as {
          projectId: string;
          status: Project["status"];
        };

        if (data.status === "failed") {
          setProjectStatus("failed");
        }

        setProjectStatus(data.status);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        taskCreationStartedRef.current = false;

        const message = error instanceof Error ? error.message : "Failed to create task";
        setErrorMessage(message);
        setProjectStatus("failed");
        appendAssistantMessage(message, "system", false);
      }
    }

    const eventSource = connectProjectStream(() => {
      sseConnectedRef.current = true;
      if (projectStatusRef.current === "pending") {
        void startTask();
      }
    });

    return () => {
      abortController.abort();
      sseConnectedRef.current = false;
      eventSource?.close();
    };
  }, [
    agentBaseUrl,
    project.id,
    project.initial_prompt,
    userId
  ]);

  function connectProjectStream(onOpen?: () => void) {
    if (!agentBaseUrl) {
      return null;
    }

    eventSourceRef.current?.close();
    const streamUrl = new URL(
      `${agentBaseUrl}/tasks/project/${project.id}/stream`,
      window.location.origin,
    );
    streamUrl.searchParams.set("userId", userId);
    const eventSource = new EventSource(streamUrl.toString());
    eventSourceRef.current = eventSource;
    if (onOpen) {
      eventSource.addEventListener("open", onOpen, { once: true });
    }
    bindStreamEvents(eventSource, connectProjectStream);
    return eventSource;
  }

  function bindStreamEvents(eventSource: EventSource, reconnect: () => void) {
    eventSource.addEventListener("task_created", (event) => {
      const data = parseEvent<TaskCreatedEvent>(event);
      if (!data) return;
      setProjectStatus(data.status as Project["status"]);
      setCurrentStep(getStepIndex(data.currentStep));
      appendAssistantMessage(`Task created: ${data.status}`, "system", false);
    });

    eventSource.addEventListener("step_start", (event) => {
      const data = parseEvent<StepStartEvent>(event);
      if (!data) return;
      setCurrentStep(getStepIndex(data.step));
      appendAssistantMessage("正在思考...", messageStep[data.step], true);
    });

    eventSource.addEventListener("token", (event) => {
      const data = parseEvent<TokenEvent>(event);
      if (!data) return;
      updateAssistantMessage(messageStep[data.step], data.content);
    });

    eventSource.addEventListener("step_complete", (event) => {
      const data = parseEvent<StepCompleteEvent>(event);
      if (!data) return;

      setCurrentStep(Math.min(getStepIndex(data.step) + 1, 4));
      if (data.step === "coding" && data.result) {
        setGeneratedCode(data.result);
      }
      if (data.step === "coding" && data.generatedFiles) {
        setGeneratedFiles(data.generatedFiles);
      }
      if (data.templateId) {
        setTemplateId(data.templateId);
      }
      if (data.step === "deploying" && data.result) {
        setDeployUrl(data.result);
      }
      finishAssistantMessage(messageStep[data.step], data.result);
    });

    eventSource.addEventListener("completed", (event) => {
      const data = parseEvent<CompletedEvent>(event);
      if (!data) return;
      setGeneratedCode(data.code);
      if (data.generatedFiles) {
        setGeneratedFiles(data.generatedFiles);
      }
      if (data.templateId) {
        setTemplateId(data.templateId);
      }
      setDeployUrl(data.deployUrl ?? null);
      setCurrentStep(4);
      setProjectStatus("awaiting_confirmation");
      appendAssistantMessage("Generation completed. Preview updated.", "system", false);
      eventSource.close();
    });

    eventSource.addEventListener("features_confirmation", (event) => {
      const data = parseEvent<FeaturesConfirmationEvent>(event);
      if (!data) return;

      const nextFeatures = data.features || [];
      setFeatures(nextFeatures);
      setSelectedFeatureIds(
        new Set(
          nextFeatures
            .filter((feature) => feature.defaultSelected !== false)
            .map((feature) => feature.id),
        ),
      );
      setCurrentStep(1);
      setProjectStatus("awaiting_features_confirmation");
      appendAssistantMessage("请确认要实现的功能点。", "system", false);
      eventSource.close();
    });

    eventSource.addEventListener("error", (event) => {
      if ("data" in event && typeof event.data === "string" && event.data) {
        const data = parseEvent<AgentErrorEvent>(event);
        const message = data?.message || "Agent generation failed";
        setErrorMessage(message);
        setProjectStatus("failed");
        appendAssistantMessage(message, "system", false);
        eventSource.close();
        return;
      }

      if (!reconnectAttemptedRef.current) {
        reconnectAttemptedRef.current = true;
        eventSource.close();
        window.setTimeout(reconnect, 1000);
        return;
      }

      setErrorMessage("SSE connection was interrupted. Please retry later.");
      setProjectStatus("failed");
      appendAssistantMessage("SSE connection was interrupted. Please retry later.", "system", false);
      eventSource.close();
    });
  }

  async function confirmProject() {
    if (isConfirming) {
      return;
    }

    if (!agentBaseUrl) {
      setErrorMessage("Agent API URL is not configured.");
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-confirm-${Date.now()}`,
      project_id: project.id,
      role: "user",
      content: "满意，确认完成",
      step: null,
      created_at: new Date().toISOString()
    };

    appendUserMessage(userMessage);
    setErrorMessage("");
    setIsConfirming(true);

    try {
      const response = await fetch(`${agentBaseUrl}/tasks/project/${project.id}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ userId })
      });

      if (!response.ok) {
        throw new Error(`确认项目失败：${response.status}`);
      }

      setProjectStatus("completed");
    setCurrentStep(4);
      appendAssistantMessage("项目已确认完成。", "system", false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "确认项目失败";
      setErrorMessage(message);
      appendAssistantMessage(message, "system", false);
    } finally {
      setIsConfirming(false);
    }
  }

  async function confirmFeatures() {
    if (!agentBaseUrl || isConfirmingFeatures) {
      return;
    }

    const confirmedFeatures = features.filter((feature) =>
      selectedFeatureIds.has(feature.id),
    );
    setErrorMessage("");
    setIsConfirmingFeatures(true);

    try {
      const response = await fetch(
        `${agentBaseUrl}/tasks/project/${project.id}/features/confirm`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId, confirmedFeatures }),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to confirm features: ${response.status}`);
      }

      setProjectStatus("generating");
      setCurrentStep(1);
      reconnectAttemptedRef.current = false;
      appendAssistantMessage("功能点已确认，开始生成方案和代码。", "system", false);
      connectProjectStream();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to confirm features";
      setErrorMessage(message);
      appendAssistantMessage(message, "system", false);
    } finally {
      setIsConfirmingFeatures(false);
    }
  }

  function toggleFeature(featureId: string) {
    setSelectedFeatureIds((current) => {
      const next = new Set(current);
      if (next.has(featureId)) {
        next.delete(featureId);
      } else {
        next.add(featureId);
      }
      return next;
    });
  }

  async function handleRetry() {
    if (!agentBaseUrl || isRetrying) {
      return;
    }

    setErrorMessage("");
    setIsRetrying(true);
    reconnectAttemptedRef.current = false;

    try {
      const response = await fetch(`${agentBaseUrl}/tasks/project/${project.id}/retry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ userId })
      });

      if (!response.ok) {
        // 409说明已经在重试了，直接当成功处理
        if (response.status !== 409) {
          throw new Error(`重试失败：${response.status}`);
        }
      }

      setProjectStatus("generating");
      setCurrentStep(0);
      appendAssistantMessage("正在重试生成...", "system", false);
      connectProjectStream();
    } catch (error) {
      const message = error instanceof Error ? error.message : "重试失败";
      setErrorMessage(message);
      appendAssistantMessage(message, "system", false);
    } finally {
      setIsRetrying(false);
    }
  }

  function promptForIterationInput() {
    appendAssistantMessage(
      "请描述你想要修改的内容，发送后开始新一轮迭代生成",
      "system",
      false
    );
    inputRef.current?.focus();
  }

  async function handleSend(content: string) {
    if (!agentBaseUrl) {
      setErrorMessage("Agent API URL is not configured.");
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      project_id: project.id,
      role: "user",
      content,
      step: null,
      created_at: new Date().toISOString()
    };

    appendUserMessage(userMessage);

    if (!isAwaitingConfirmation) {
      try {
        setErrorMessage("");
        const response = await fetch(`${agentBaseUrl}/tasks/project/${project.id}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ userId, content })
        });

        if (!response.ok) {
          throw new Error(`Failed to save message: ${response.status}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save message";
        setErrorMessage(message);
        appendAssistantMessage(message, "system", false);
      }
      return;
    }

    try {
      setErrorMessage("");
      setCurrentStep(2);
      setProjectStatus("generating");
      reconnectAttemptedRef.current = false;

      const response = await fetch(`${agentBaseUrl}/tasks/project/${project.id}/iterate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ userId, prompt: content })
      });

      if (!response.ok) {
        throw new Error(`Failed to start iteration: ${response.status}`);
      }

      connectProjectStream();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start iteration";
      setErrorMessage(message);
      setProjectStatus("awaiting_confirmation");
      appendAssistantMessage(message, "system", false);
    }
  }

  function appendUserMessage(message: ChatMessage) {
    setMessages((current) => [
      ...current,
      message
    ]);
  }

  function appendAssistantMessage(
    content: string,
    step: Message["step"],
    isStreaming: boolean
  ) {
    if (!content.trim()) {
      return;
    }

    setMessages((current) => {
      const settledMessages = current.map((item) => ({ ...item, isStreaming: false }));
      const alreadyExists = settledMessages.some(
        (item) => item.role === "assistant" && item.step === step && item.content === content
      );

      if (!isStreaming && alreadyExists) {
        return settledMessages;
      }

      return [
        ...settledMessages,
        {
          id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          project_id: project.id,
          role: "assistant",
          content,
          step,
          created_at: new Date().toISOString(),
          isStreaming
        }
      ];
    });
  }

  function updateAssistantMessage(step: Message["step"], content: string) {
    setMessages((current) => {
      const lastIndexFromEnd = [...current]
        .reverse()
        .findIndex((message) => message.role === "assistant" && message.step === step);

      if (lastIndexFromEnd === -1) {
        return [
          ...current,
          {
            id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            project_id: project.id,
            role: "assistant",
            content,
            step,
            created_at: new Date().toISOString(),
            isStreaming: true
          }
        ];
      }

      const actualIndex = current.length - 1 - lastIndexFromEnd;
      const updated = [...current];
      updated[actualIndex] = {
        ...updated[actualIndex],
        content,
        isStreaming: true
      };
      return updated;
    });
  }

  function finishAssistantMessage(step: Message["step"], fallbackContent: string) {
    setMessages((current) => {
      const lastIndexFromEnd = [...current]
        .reverse()
        .findIndex((message) => message.role === "assistant" && message.step === step);

      if (lastIndexFromEnd === -1) {
        if (!fallbackContent.trim()) {
          return current.map((item) => ({ ...item, isStreaming: false }));
        }
        return [
          ...current.map((item) => ({ ...item, isStreaming: false })),
          {
            id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            project_id: project.id,
            role: "assistant",
            content: fallbackContent,
            step,
            created_at: new Date().toISOString(),
            isStreaming: false
          }
        ];
      }

      const actualIndex = current.length - 1 - lastIndexFromEnd;
      return current.map((message, index) => {
        if (index !== actualIndex) {
          return { ...message, isStreaming: false };
        }

        return {
          ...message,
          content:
            message.content === "正在思考..." && fallbackContent.trim()
              ? fallbackContent
              : message.content,
          isStreaming: false
        };
      });
    });
  }

  return (
    <div className="flex h-[calc(100vh-64px)] w-full overflow-hidden bg-background">
      <aside className="flex min-w-[320px] w-[clamp(320px,28vw,380px)] shrink-0 flex-col border-r border-border bg-card/95">
        <StepProgress currentStep={currentStep} />
        <MessageList messages={messages} />
        {errorMessage ? (
          <p className="border-t border-border px-4 py-3 text-sm text-destructive-foreground">
            {errorMessage}
          </p>
        ) : null}
        {isAwaitingFeaturesConfirmation ? (
          <div className="max-h-[280px] overflow-y-auto overflow-x-hidden border-t border-border px-4 py-3">
            <p className="mb-3 text-sm text-muted-foreground">
              Select the features to include before generation continues.
            </p>
            <div className="mb-3 space-y-2">
              {features.map((feature) => (
                <label
                  key={feature.id}
                  className="flex min-w-0 cursor-pointer gap-3 rounded-md border border-border bg-background/60 p-3 text-sm"
                >
                  <input
                    checked={selectedFeatureIds.has(feature.id)}
                    className="mt-1 shrink-0"
                    onChange={() => toggleFeature(feature.id)}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <span className="block break-words font-medium text-foreground">
                      {feature.name}
                    </span>
                    <span className="mt-1 block break-words text-muted-foreground">
                      {feature.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <Button
              className="w-full"
              disabled={isConfirmingFeatures || selectedFeatureIds.size === 0}
              size="sm"
              onClick={confirmFeatures}
            >
              {isConfirmingFeatures ? "Confirming..." : "Confirm features"}
            </Button>
          </div>
        ) : null}
        {isAwaitingConfirmation ? (
          <div className="border-t border-border px-4 py-3">
            <p className="mb-3 text-sm text-muted-foreground">
              Generation completed. Are you satisfied with the result?
            </p>
            <div className="grid gap-2">
              <Button size="sm" disabled={isConfirming} onClick={confirmProject}>
                {isConfirming ? "Confirming..." : "Satisfied, finish"}
              </Button>
              <Button size="sm" variant="outline" onClick={promptForIterationInput}>
                Continue editing
              </Button>
            </div>
          </div>
        ) : null}
        <MessageInput
          disabled={isInputDisabled}
          onSend={handleSend}
          onRetry={handleRetry}
          showRetry={projectStatus === "failed" && !isRetrying}
          isRetrying={isRetrying}
          placeholder={
            isAwaitingConfirmation
              ? "Describe the changes you want for the next iteration..."
              : undefined
          }
          ref={inputRef}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-medium text-foreground">Preview</h2>
          {deployUrl ? (
            <a
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              href={deployUrl}
              rel="noreferrer"
              target="_blank"
            >
              Deployment link
            </a>
          ) : null}
        </div>
        <div className="min-h-0 flex-1">
          <ProjectPreviewDemo
            code={previewCode}
            deployUrl={deployUrl}
            generatedFiles={generatedFiles}
            templateId={templateId}
          />
        </div>
      </main>
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
