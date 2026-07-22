"use client";

import { cn } from "@/lib/utils";
import type { Message } from "@/lib/types";

const stepLabels: Record<NonNullable<Message["step"]>, string> = {
  analysis: "需求分析",
  design: "架构设计",
  code: "代码生成",
  system: "系统消息"
};

type MessageBubbleProps = {
  role: Message["role"];
  content: string;
  isStreaming?: boolean;
  step?: Message["step"];
};

export function MessageBubble({
  role,
  content,
  isStreaming = false,
  step = null
}: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={cn("flex w-full min-w-0", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] overflow-hidden rounded-lg px-3.5 py-3 text-sm leading-6 shadow-lg",
          isUser
            ? "bg-sky-600 text-white shadow-sky-950/20"
            : "border border-border bg-secondary/80 text-foreground shadow-black/20"
        )}
      >
        {!isUser && step ? (
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {stepLabels[step]}
          </div>
        ) : null}
        <div className="whitespace-pre-wrap break-words [&_code]:break-words [&_pre]:overflow-x-auto">
          {content}
          {isStreaming ? <span className="ml-0.5 animate-pulse">▌</span> : null}
        </div>
      </div>
    </div>
  );
}
