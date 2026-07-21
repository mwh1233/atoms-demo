"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList, type ChatMessage } from "@/components/chat/MessageList";
import type { Message, Project } from "@/lib/types";

type ProjectChatDemoProps = {
  project: Project;
};

const assistantMessages: Array<Pick<Message, "role" | "content" | "step">> = [
  {
    role: "assistant",
    step: "analysis",
    content:
      "我先分析你的需求：这是一个需要清晰信息架构、核心转化路径和可扩展数据模型的产品。下一步会整理页面结构与关键功能。"
  },
  {
    role: "assistant",
    step: "design",
    content:
      "设计方案已形成：工作台负责项目管理，详情页拆分为对话区和预览区，生成流程通过步骤状态持续反馈。"
  },
  {
    role: "assistant",
    step: "code",
    content:
      "开始生成代码骨架：先搭建页面布局、基础组件和数据读取链路，后续可以接入真实 Agent 输出。"
  }
];

export function ProjectChatDemo({ project }: ProjectChatDemoProps) {
  const initialMessage = useMemo<ChatMessage>(
    () => ({
      id: "mock-user-initial",
      project_id: project.id,
      role: "user",
      content: project.initial_prompt,
      step: null,
      created_at: project.created_at
    }),
    [project.created_at, project.id, project.initial_prompt]
  );
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const [currentStep, setCurrentStep] = useState(0);
  const [isGenerating, setIsGenerating] = useState(true);

  useEffect(() => {
    setMessages([initialMessage]);
    setCurrentStep(0);
    setIsGenerating(true);

    const timers = assistantMessages.map((message, index) =>
      window.setTimeout(() => {
        setCurrentStep(index);
        setMessages((current) => [
          ...current.map((item) => ({ ...item, isStreaming: false })),
          {
            id: `mock-assistant-${index}`,
            project_id: project.id,
            role: message.role,
            content: message.content,
            step: message.step,
            created_at: new Date().toISOString(),
            isStreaming: true
          }
        ]);

        if (index === assistantMessages.length - 1) {
          window.setTimeout(() => {
            setCurrentStep(3);
            setIsGenerating(false);
          }, message.content.length * 18 + 600);
        }
      }, index * 2600 + 500)
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [initialMessage, project.id]);

  function handleSend(content: string) {
    setMessages((current) => [
      ...current,
      {
        id: `mock-user-${Date.now()}`,
        project_id: project.id,
        role: "user",
        content,
        step: null,
        created_at: new Date().toISOString()
      }
    ]);
  }

  return (
    <div className="flex h-[620px] min-h-0 flex-col">
      <MessageList currentStep={currentStep} messages={messages} />
      <MessageInput disabled={isGenerating} onSend={handleSend} />
    </div>
  );
}
