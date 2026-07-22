"use client";

import { forwardRef, useState, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type MessageInputProps = {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export const MessageInput = forwardRef<HTMLTextAreaElement, MessageInputProps>(
  function MessageInput({ onSend, disabled = false, placeholder }, ref) {
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
      <div className="border-t border-border bg-card/95 p-4">
        <div className="flex min-w-0 gap-2">
          <Textarea
            className="min-h-12 min-w-0 resize-none text-sm"
            disabled={disabled}
            placeholder={
              placeholder || (disabled ? "Generating, please wait..." : "Describe what to change...")
            }
            ref={ref}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            aria-label="Send"
            className="h-12 w-12 shrink-0 px-0"
            disabled={disabled || !value.trim()}
            onClick={submit}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }
);
