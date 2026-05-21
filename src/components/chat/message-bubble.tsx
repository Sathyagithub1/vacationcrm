"use client";

import { cn } from "@/lib/utils";

export interface MessageData {
  id: string;
  senderType: string;
  senderId: string | null;
  content: string;
  messageType: string;
  fileUrl: string | null;
  createdAt: string;
}

interface MessageBubbleProps {
  message: MessageData;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isAgent = message.senderType === "AGENT";
  const isCustomer = message.senderType === "CUSTOMER";

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div
      className={cn(
        "flex w-full",
        isAgent ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[70%] rounded-lg px-3 py-2",
          isAgent
            ? "bg-primary-500 text-white"
            : isCustomer
            ? "bg-gray-100 text-gray-900"
            : "bg-blue-50 text-blue-900" // BOT
        )}
      >
        {/* Sender label */}
        <div
          className={cn(
            "mb-0.5 text-[10px] font-medium",
            isAgent ? "text-primary-100" : "text-gray-500"
          )}
        >
          {message.senderType === "AGENT"
            ? "Agent"
            : message.senderType === "CUSTOMER"
            ? "Customer"
            : "Bot"}
        </div>

        {/* Content */}
        {message.messageType === "IMAGE" && message.fileUrl ? (
          <img
            src={message.fileUrl}
            alt="Shared image"
            className="max-h-48 rounded"
          />
        ) : message.messageType === "FILE" && message.fileUrl ? (
          <a
            href={message.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "underline text-sm",
              isAgent ? "text-primary-100" : "text-blue-600"
            )}
          >
            {message.content || "View file"}
          </a>
        ) : (
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        )}

        {/* Timestamp */}
        <div
          className={cn(
            "mt-1 text-right text-[10px]",
            isAgent ? "text-primary-200" : "text-gray-400"
          )}
        >
          {formatTime(message.createdAt)}
        </div>
      </div>
    </div>
  );
}
