"use client";

import { cn } from "@/lib/utils";

export interface MessageDelivery {
  status: "sent" | "delivered" | "read" | null;
}

export interface MessageData {
  id: string;
  senderType: string;
  senderId: string | null;
  content: string;
  messageType: string;
  fileUrl: string | null;
  createdAt: string;
  delivery?: MessageDelivery | null;
}

interface MessageBubbleProps {
  message: MessageData;
}

function DeliveryTicks({ status }: { status: string | null | undefined }) {
  if (!status) return null;

  if (status === "read") {
    return (
      <span className="ml-1 inline-flex text-blue-400" title="Read" aria-label="Read">
        <svg width="16" height="10" viewBox="0 0 16 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 5.5L3.5 8L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M5 5.5L7.5 8L12 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
  }

  if (status === "delivered") {
    return (
      <span className="ml-1 inline-flex text-gray-400" title="Delivered" aria-label="Delivered">
        <svg width="16" height="10" viewBox="0 0 16 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 5.5L3.5 8L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M5 5.5L7.5 8L12 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
  }

  // sent
  return (
    <span className="ml-1 inline-flex text-gray-400" title="Sent" aria-label="Sent">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 5.5L3.5 8L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isAgent = message.senderType === "AGENT";
  const isBot = message.senderType === "BOT";
  const isCustomer = message.senderType === "CUSTOMER";
  const isOutbound = isAgent || isBot;

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
        isOutbound ? "justify-end" : "justify-start"
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
        {/* Sender label with AI badge */}
        <div
          className={cn(
            "mb-0.5 flex items-center gap-1.5 text-[10px] font-medium",
            isAgent ? "text-primary-100" : "text-gray-500"
          )}
        >
          <span>
            {message.senderType === "AGENT"
              ? "Agent"
              : message.senderType === "CUSTOMER"
              ? "Customer"
              : "Bot"}
          </span>
          {isBot && (
            <span
              className="inline-flex items-center rounded-full bg-blue-500 px-1.5 py-px text-[9px] font-semibold uppercase leading-tight text-white"
              title="AI-generated message"
            >
              AI
            </span>
          )}
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

        {/* Timestamp + delivery status */}
        <div
          className={cn(
            "mt-1 flex items-center justify-end text-[10px]",
            isAgent ? "text-primary-200" : "text-gray-400"
          )}
        >
          {formatTime(message.createdAt)}
          {isOutbound && <DeliveryTicks status={message.delivery?.status} />}
        </div>
      </div>
    </div>
  );
}

/** Divider shown when conversation transfers to a human agent */
export function HumanTakeoverDivider() {
  return (
    <div className="flex items-center gap-3 py-3" role="separator">
      <div className="flex-1 border-t border-yellow-300" />
      <span className="flex items-center gap-1.5 text-xs font-medium text-yellow-600">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        Transferred to agent
      </span>
      <div className="flex-1 border-t border-yellow-300" />
    </div>
  );
}
