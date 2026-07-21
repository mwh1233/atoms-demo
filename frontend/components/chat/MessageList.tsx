"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { StepProgress } from "@/components/chat/StepProgress";
import type { Message } from "@/lib/types";

export type ChatMessage = Message & {
  isStreaming?: boolean;
};

type MessageListProps = {
  messages: ChatMessage[];
  currentStep: number;
};

export function MessageList({ messages, currentStep }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, currentStep]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sticky top-0 z-10 bg-card pb-4">
        <StepProgress currentStep={currentStep} />
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            content={message.content}
            isStreaming={message.isStreaming}
            role={message.role}
            step={message.step}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
