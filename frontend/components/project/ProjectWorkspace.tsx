"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList, type ChatMessage } from "@/components/chat/MessageList";
import { ProjectPreviewDemo } from "@/components/preview/ProjectPreviewDemo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Message, Project } from "@/lib/types";

type WorkflowStep = "analyzing" | "designing" | "coding" | "deploying";
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
};

type CompletedEvent = {
  code: string;
  deployUrl?: string | null;
};

type AgentErrorEvent = {
  message: string;
  retry?: boolean;
};

const stepIndex: Record<WorkflowStep, number> = {
  analyzing: 0,
  designing: 1,
  coding: 2,
  deploying: 3
};

const messageStep: Record<WorkflowStep, Message["step"]> = {
  analyzing: "analysis",
  designing: "design",
  coding: "code",
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
    return 3;
  }
  return stepIndex[step as WorkflowStep] ?? 0;
}

function getInitialStepIndex(project: Project) {
  if (
    project.status === "awaiting_confirmation" ||
    project.status === "completed" ||
    project.status === "failed"
  ) {
    return 3;
  }
  return getStepIndex(project.current_step);
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
  const [deployUrl, setDeployUrl] = useState(project.deployed_url);
  const [projectStatus, setProjectStatus] = useState<Project["status"]>(project.status);
  const [errorMessage, setErrorMessage] = useState(project.error_message || "");
  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const hasStartedRef = useRef(false);
  const reconnectAttemptedRef = useRef(false);

  const agentBaseUrl = useMemo(
    () => (process.env.NEXT_PUBLIC_AGENT_API_URL || "").trim().replace(/\/$/, ""),
    []
  );
  const previewCode = useMemo(() => generatedCode || emptyPreviewHtml, [generatedCode]);
  const isGenerating = projectStatus === "pending" || projectStatus === "generating";
  const isAwaitingConfirmation = projectStatus === "awaiting_confirmation";
  const isInputDisabled = projectStatus === "generating" || projectStatus === "completed";

  useEffect(() => {
    if (!agentBaseUrl || hasStartedRef.current || !isGenerating) {
      return;
    }

    hasStartedRef.current = true;
    const abortController = new AbortController();

    if (projectStatus === "generating") {
      connectProjectStream();
      return () => {
        abortController.abort();
        eventSourceRef.current?.close();
      };
    }

    if (projectStatus !== "pending") {
      return;
    }

    async function startTask() {
      try {
        appendAssistantMessage("Creating generation task...", "system", true);

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
        connectProjectStream();
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        const message = error instanceof Error ? error.message : "Failed to create task";
        setErrorMessage(message);
        setProjectStatus("failed");
        appendAssistantMessage(message, "system", false);
      }
    }

    startTask();

    return () => {
      abortController.abort();
      eventSourceRef.current?.close();
    };
  }, [
    agentBaseUrl,
    isGenerating,
    project.id,
    project.initial_prompt,
    projectStatus,
    userId
  ]);

  function connectProjectStream() {
    if (!agentBaseUrl) {
      return;
    }

    eventSourceRef.current?.close();
    const eventSource = new EventSource(`${agentBaseUrl}/tasks/project/${project.id}/stream`);
    eventSourceRef.current = eventSource;
    bindStreamEvents(eventSource, connectProjectStream);
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
      appendAssistantMessage(data.message, messageStep[data.step], true);
    });

    eventSource.addEventListener("step_complete", (event) => {
      const data = parseEvent<StepCompleteEvent>(event);
      if (!data) return;

      setCurrentStep(Math.min(getStepIndex(data.step) + 1, 3));
      if (data.step === "coding" && data.result) {
        setGeneratedCode(data.result);
      }
      if (data.step === "deploying" && data.result) {
        setDeployUrl(data.result);
      }
      setMessages((current) => current.map((item) => ({ ...item, isStreaming: false })));
      appendAssistantMessage(data.result, messageStep[data.step], false);
    });

    eventSource.addEventListener("completed", (event) => {
      const data = parseEvent<CompletedEvent>(event);
      if (!data) return;
      setGeneratedCode(data.code);
      setDeployUrl(data.deployUrl ?? null);
      setCurrentStep(3);
      setProjectStatus("awaiting_confirmation");
      appendAssistantMessage("Generation completed. Preview updated.", "system", false);
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
    if (!agentBaseUrl) {
      return;
    }

    const response = await fetch(`${agentBaseUrl}/tasks/project/${project.id}/confirm`, {
      method: "POST"
    });

    if (!response.ok) {
      setErrorMessage(`Failed to confirm project: ${response.status}`);
      return;
    }

    setProjectStatus("completed");
    setCurrentStep(3);
    appendAssistantMessage("Project marked as completed.", "system", false);
  }

  function focusIterationInput() {
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

    if (!isAwaitingConfirmation) {
      try {
        setErrorMessage("");
        const response = await fetch(`${agentBaseUrl}/tasks/project/${project.id}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ content })
        });

        if (!response.ok) {
          throw new Error(`Failed to save message: ${response.status}`);
        }

        appendUserMessage(userMessage);
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
        body: JSON.stringify({ prompt: content })
      });

      if (!response.ok) {
        throw new Error(`Failed to start iteration: ${response.status}`);
      }

      appendUserMessage(userMessage);
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

  return (
    <div className="grid min-h-[620px] gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <Card className="min-h-0 bg-card/90">
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0">
          <div className="flex h-[620px] min-h-0 flex-col">
            <MessageList currentStep={currentStep} messages={messages} />
            {errorMessage ? (
              <p className="border-t border-border pt-3 text-sm text-destructive-foreground">
                {errorMessage}
              </p>
            ) : null}
            {isAwaitingConfirmation ? (
              <div className="border-t border-border py-3">
                <p className="mb-3 text-sm text-muted-foreground">
                  Generation completed. Are you satisfied with the result?
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={confirmProject}>
                    Satisfied, finish
                  </Button>
                  <Button size="sm" variant="outline" onClick={focusIterationInput}>
                    Continue editing
                  </Button>
                </div>
              </div>
            ) : null}
            <MessageInput
              disabled={isInputDisabled}
              onSend={handleSend}
              placeholder={
                isAwaitingConfirmation
                  ? "Describe the changes you want for the next iteration..."
                  : undefined
              }
              ref={inputRef}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="min-h-0 bg-card/90">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Preview</CardTitle>
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
