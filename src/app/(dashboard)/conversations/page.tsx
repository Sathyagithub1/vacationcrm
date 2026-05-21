"use client";

import * as React from "react";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import { ConversationList, type ConversationListItem } from "@/components/chat/conversation-list";
import { ChatThread } from "@/components/chat/chat-thread";
import { CustomerInfoPanel } from "@/components/chat/customer-info-panel";
import type { MessageData } from "@/components/chat/message-bubble";

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

  // State
  const [conversations, setConversations] = React.useState<ConversationListItem[]>([]);
  const [loadingList, setLoadingList] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState("");

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<ConversationDetail | null>(null);
  const [messages, setMessages] = React.useState<MessageData[]>([]);
  const [loadingMessages, setLoadingMessages] = React.useState(false);
  const [sending, setSending] = React.useState(false);

  const [cannedResponses, setCannedResponses] = React.useState<CannedResponse[]>([]);

  // Polling interval ref
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

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

      // Poll for new messages every 5 seconds (Phase 1, no WebSocket)
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        fetchMessages(selectedId);
      }, 5000);
    } else {
      setDetail(null);
      setMessages([]);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedId, fetchDetail]);

  // Fetch only messages (for polling)
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
      // Refresh messages
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
      </div>

      {/* Right panel: Customer info */}
      <div className="w-72 shrink-0">
        <CustomerInfoPanel conversation={detail} />
      </div>
    </div>
  );
}
