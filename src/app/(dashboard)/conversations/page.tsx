"use client";

import * as React from "react";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import { ConversationList, type ConversationListItem } from "@/components/chat/conversation-list";
import { ChatThread } from "@/components/chat/chat-thread";
import { CustomerInfoPanel } from "@/components/chat/customer-info-panel";
import type { MessageData } from "@/components/chat/message-bubble";
import { useSocket, useConversationSocket } from "@/hooks/use-socket";

interface ConversationDetail {
  id: string;
  status: string;
  startedAt: string;
  lead: {
    id: string;
    destination: string | null;
    travelDate: string | null;
    numPassengers: number | null;
    source: string;
    priority: string;
    customer: {
      id: string;
      name: string;
      mobile: string;
      email: string | null;
      address: string | null;
    };
    department: { id: string; name: string; color: string | null };
    stage: { id: string; name: string; color: string | null };
    assignee: { id: string; name: string; avatarUrl: string | null } | null;
  };
  agent: { id: string; name: string; avatarUrl: string | null; email: string } | null;
}

interface CannedResponse {
  id: string;
  title: string;
  content: string;
  shortcut: string;
}

export default function ConversationsPage() {
  const { toast } = useToast();
  const { socket, isConnected } = useSocket();

  // State
  const [conversations, setConversations] = React.useState<ConversationListItem[]>([]);
  const [loadingList, setLoadingList] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState("");

  const [channelFilter, setChannelFilter] = React.useState("");

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<ConversationDetail | null>(null);
  const [messages, setMessages] = React.useState<MessageData[]>([]);
  const [loadingMessages, setLoadingMessages] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [typingUser, setTypingUser] = React.useState<string | null>(null);

  const [cannedResponses, setCannedResponses] = React.useState<CannedResponse[]>([]);

  // Polling interval ref (fallback when WS not connected)
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const typingTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // WebSocket: real-time message handler
  const handleNewMessage = React.useCallback(
    (msg: Record<string, unknown>) => {
      const newMsg: MessageData = {
        id: (msg.id as string) || `ws-${Date.now()}`,
        content: msg.content as string,
        senderType: (msg.senderType as string) || "AGENT",
        senderId: (msg.senderId as string) || null,
        messageType: (msg.messageType as string) || "TEXT",
        fileUrl: (msg.fileUrl as string) || null,
        createdAt: (msg.timestamp as string) || new Date().toISOString(),
        delivery: msg.delivery ? { status: (msg.delivery as { status: string }).status as "sent" | "delivered" | "read" } : null,
      };
      setMessages((prev) => {
        // Avoid duplicates
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
    },
    []
  );

  const handleTyping = React.useCallback(
    (data: { userId: string; name: string }) => {
      setTypingUser(data.name);
      // Auto-clear after 3 seconds
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 3000);
    },
    []
  );

  const handleTypingStop = React.useCallback(() => {
    setTypingUser(null);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  }, []);

  // Wire up WebSocket for the selected conversation
  const { startTyping, stopTyping } = useConversationSocket(
    socket,
    selectedId,
    handleNewMessage,
    handleTyping,
    handleTypingStop
  );

  // Fetch conversation list
  const fetchConversations = React.useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/conversations?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setConversations(data.conversations);
    } catch {
      toast("error", "Failed to load conversations");
    } finally {
      setLoadingList(false);
    }
  }, [statusFilter, toast]);

  React.useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Fetch canned responses once
  React.useEffect(() => {
    async function fetchCanned() {
      try {
        const res = await fetch("/api/canned-responses");
        if (res.ok) {
          const data = await res.json();
          setCannedResponses(data.responses || []);
        }
      } catch {
        // not critical
      }
    }
    fetchCanned();
  }, []);

  // Fetch detail + messages when selected
  const fetchDetail = React.useCallback(async (convId: string) => {
    setLoadingMessages(true);
    try {
      const [detailRes, msgRes] = await Promise.all([
        fetch(`/api/conversations/${convId}`),
        fetch(`/api/conversations/${convId}/messages?limit=100`),
      ]);
      if (detailRes.ok) {
        const detailData = await detailRes.json();
        setDetail(detailData.conversation);
      }
      if (msgRes.ok) {
        const msgData = await msgRes.json();
        setMessages(msgData.messages || []);
      }
    } catch {
      toast("error", "Failed to load conversation");
    } finally {
      setLoadingMessages(false);
    }
  }, [toast]);

  // When selection changes
  React.useEffect(() => {
    if (selectedId) {
      fetchDetail(selectedId);

      // Use polling as fallback only when WebSocket is NOT connected
      if (!isConnected) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(() => {
          fetchMessages(selectedId);
        }, 5000);
      } else {
        // Clear polling when WS is connected
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } else {
      setDetail(null);
      setMessages([]);
      setTypingUser(null);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedId, fetchDetail, isConnected]);

  // Fetch only messages (for polling fallback)
  async function fetchMessages(convId: string) {
    try {
      const res = await fetch(`/api/conversations/${convId}/messages?limit=100`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch {
      // silent fail for polling
    }
  }

  // Send message
  async function handleSendMessage(content: string) {
    if (!selectedId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, senderType: "AGENT" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send");
      }
      // Stop typing indicator
      stopTyping();
      // Refresh messages (WS will also deliver the message to other participants)
      await fetchMessages(selectedId);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  // Close conversation
  async function handleCloseConversation() {
    if (!selectedId) return;
    if (!confirm("Close this conversation?")) return;
    try {
      const res = await fetch(`/api/conversations/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to close");
      }
      toast("success", "Conversation closed");
      // Refresh
      fetchConversations();
      fetchDetail(selectedId);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to close");
    }
  }

  if (loadingList) {
    return (
      <div className="flex h-[calc(100vh-120px)] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-120px)] overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* Left panel: Conversation list */}
      <div className="w-72 shrink-0">
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          channelFilter={channelFilter}
          onChannelFilterChange={setChannelFilter}
        />
      </div>

      {/* Center panel: Chat thread */}
      <div className="flex-1">
        <ChatThread
          conversationId={selectedId}
          conversationStatus={detail?.status || ""}
          customerName={detail?.lead.customer.name || ""}
          messages={messages}
          loadingMessages={loadingMessages}
          cannedResponses={cannedResponses}
          onSendMessage={handleSendMessage}
          onCloseConversation={handleCloseConversation}
          sending={sending}
        />
        {/* Typing indicator */}
        {typingUser && selectedId && (
          <div className="border-t border-gray-100 px-4 py-1">
            <span className="text-xs text-gray-400 italic">
              {typingUser} is typing...
            </span>
          </div>
        )}
      </div>

      {/* Right panel: Customer info */}
      <div className="w-72 shrink-0">
        <CustomerInfoPanel conversation={detail} />
      </div>

      {/* Connection status indicator */}
      {isConnected && (
        <div className="absolute bottom-2 right-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-600">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Live
          </span>
        </div>
      )}
    </div>
  );
}
