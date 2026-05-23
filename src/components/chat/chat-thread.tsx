"use client";

import * as React from "react";
import { X, MessageSquare } from "lucide-react";
import { MessageBubble, HumanTakeoverDivider, type MessageData } from "./message-bubble";
import { ChatInput } from "./chat-input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";

interface CannedResponse {
  id: string;
  title: string;
  content: string;
  shortcut: string;
}

interface ChatThreadProps {
  conversationId: string | null;
  conversationStatus: string;
  customerName: string;
  messages: MessageData[];
  loadingMessages: boolean;
  cannedResponses: CannedResponse[];
  onSendMessage: (content: string) => void;
  onCloseConversation: () => void;
  sending: boolean;
}

export function ChatThread({
  conversationId,
  conversationStatus,
  customerName,
  messages,
  loadingMessages,
  cannedResponses,
  onSendMessage,
  onCloseConversation,
  sending,
}: ChatThreadProps) {
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!conversationId) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-gray-50 text-gray-400">
        <MessageSquare className="mb-2 h-12 w-12" />
        <p className="text-sm">Select a conversation to start chatting</p>
      </div>
    );
  }

  const isClosed = conversationStatus === "CLOSED";

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{customerName}</h3>
          <p className="text-xs text-gray-500">
            {isClosed ? "Closed" : "Active conversation"}
          </p>
        </div>
        {!isClosed && (
          <Button variant="secondary" size="sm" onClick={onCloseConversation}>
            <X className="h-3.5 w-3.5" />
            Close
          </Button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {loadingMessages ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size="md" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-gray-400">
            <p className="text-sm">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, idx) => {
              // Insert a divider when conversation transfers to a human agent
              // Detect: previous message was BOT and this one is AGENT (human takeover boundary)
              const prevMsg = idx > 0 ? messages[idx - 1] : null;
              const showTakeoverDivider =
                conversationStatus === "HUMAN_TAKEOVER" &&
                msg.senderType === "AGENT" &&
                prevMsg?.senderType === "BOT";

              return (
                <React.Fragment key={msg.id}>
                  {showTakeoverDivider && <HumanTakeoverDivider />}
                  <MessageBubble message={msg} />
                </React.Fragment>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput
        onSend={onSendMessage}
        disabled={isClosed}
        sending={sending}
        cannedResponses={cannedResponses}
      />
    </div>
  );
}
