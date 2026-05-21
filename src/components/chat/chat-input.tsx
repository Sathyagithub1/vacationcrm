"use client";

import * as React from "react";
import { Send, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CannedResponse {
  id: string;
  title: string;
  content: string;
  shortcut: string;
}

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  sending?: boolean;
  cannedResponses: CannedResponse[];
}

export function ChatInput({ onSend, disabled, sending, cannedResponses }: ChatInputProps) {
  const [text, setText] = React.useState("");
  const [showCanned, setShowCanned] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText("");
    setShowCanned(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function insertCannedResponse(response: CannedResponse) {
    setText(response.content);
    setShowCanned(false);
    textareaRef.current?.focus();
  }

  return (
    <div className="relative border-t border-gray-200 bg-white">
      {/* Canned responses dropdown */}
      {showCanned && cannedResponses.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 max-h-48 overflow-y-auto border-t border-gray-200 bg-white shadow-lg">
          {cannedResponses.map((cr) => (
            <button
              key={cr.id}
              onClick={() => insertCannedResponse(cr)}
              className="flex w-full items-start gap-2 border-b border-gray-50 px-4 py-2 text-left hover:bg-gray-50"
            >
              <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-600">
                /{cr.shortcut}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-gray-900">{cr.title}</div>
                <div className="truncate text-xs text-gray-500">{cr.content}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2 p-3">
        <button
          type="button"
          onClick={() => setShowCanned(!showCanned)}
          className={cn(
            "shrink-0 rounded-md p-2 transition-colors",
            showCanned
              ? "bg-primary-100 text-primary-600"
              : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          )}
          title="Canned responses"
        >
          <Zap className="h-4 w-4" />
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Conversation closed" : "Type a message..."}
          disabled={disabled}
          rows={1}
          className="max-h-24 min-h-[36px] flex-1 resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200 disabled:bg-gray-50"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!text.trim() || disabled}
          loading={sending}
          className="shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
