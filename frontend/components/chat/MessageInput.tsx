"use client";

import { useState, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type MessageInputProps = {
  onSend: (content: string) => void;
  disabled?: boolean;
};

export function MessageInput({ onSend, disabled = false }: MessageInputProps) {
  const [value, setValue] = useState("");

  function submit() {
    const trimmedValue = value.trim();

    if (!trimmedValue || disabled) {
      return;
    }

    onSend(trimmedValue);
    setValue("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="border-t border-border bg-card pt-4">
      <div className="flex gap-3">
        <Textarea
          className="min-h-12 resize-none"
          disabled={disabled}
          placeholder={disabled ? "生成中，请稍候..." : "继续补充你的需求..."}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button className="h-12 shrink-0" disabled={disabled || !value.trim()} onClick={submit}>
          <Send className="mr-2 h-4 w-4" />
          发送
        </Button>
      </div>
    </div>
  );
}
