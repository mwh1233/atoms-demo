"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/types";

const stepLabels: Record<NonNullable<Message["step"]>, string> = {
  analysis: "需求分析",
  design: "设计方案",
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
  const [visibleContent, setVisibleContent] = useState(isStreaming ? "" : content);
  const isUser = role === "user";

  useEffect(() => {
    if (!isStreaming) {
      setVisibleContent(content);
      return;
    }

    setVisibleContent("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setVisibleContent(content.slice(0, index));

      if (index >= content.length) {
        window.clearInterval(timer);
      }
    }, 18);

    return () => window.clearInterval(timer);
  }, [content, isStreaming]);

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-4 py-3 text-sm leading-6 shadow-lg",
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
        <div className="whitespace-pre-wrap">
          {visibleContent}
          {isStreaming ? <span className="ml-0.5 animate-pulse">|</span> : null}
        </div>
      </div>
    </div>
  );
}
