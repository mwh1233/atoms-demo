"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import type { Message } from "@/lib/types";

export type ChatMessage = Message & {
  isStreaming?: boolean;
};

type MessageListProps = {
  messages: ChatMessage[];
  currentStep?: number;
};

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-4">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          content={message.content}
          isStreaming={message.isStreaming}
          role={message.role}
          step={message.role === "user" ? null : message.step}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
