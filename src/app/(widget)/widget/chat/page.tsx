"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuickAction {
  label: string;
  message: string;
}

interface WidgetTenant {
  id: string;
  name: string;
  productName: string;
  logoUrl: string | null;
  themeConfig: Record<string, unknown> | null;
}

interface WidgetDept {
  id: string;
  name: string;
  color: string | null;
}

interface WidgetConfig {
  id: string;
  welcomeMessage: string | null;
  placeholderText: string | null;
  position: string;
  buttonIcon: string;
  themeOverride: Record<string, unknown> | null;
  offlineMessage: string | null;
  quickActions: QuickAction[] | null;
  businessHours: Record<string, unknown> | null;
  autoOpenDelayMs: number;
  tenant: WidgetTenant;
  department: WidgetDept;
}

interface ChatMessage {
  id: string;
  senderType: "CUSTOMER" | "BOT" | "AGENT";
  content: string;
  messageType: string;
  fileUrl: string | null;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateVisitorId(): string {
  const stored = typeof window !== "undefined" ? localStorage.getItem("hd-visitor-id") : null;
  if (stored) return stored;
  const id = `v-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  if (typeof window !== "undefined") localStorage.setItem("hd-visitor-id", id);
  return id;
}

function getStoredSession(tenant: string, dept: string) {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`hd-session-${tenant}-${dept}`);
    return raw ? (JSON.parse(raw) as { token: string; conversationId: string }) : null;
  } catch {
    return null;
  }
}

function storeSession(tenant: string, dept: string, token: string, conversationId: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(`hd-session-${tenant}-${dept}`, JSON.stringify({ token, conversationId }));
}

function resolveThemeColor(config: WidgetConfig | null): string {
  if (!config) return "#2563EB";
  const override = config.themeOverride as Record<string, unknown> | null;
  if (override?.primaryColor && typeof override.primaryColor === "string") return override.primaryColor;
  const theme = config.tenant?.themeConfig as Record<string, unknown> | null;
  if (theme?.primaryColor && typeof theme.primaryColor === "string") return theme.primaryColor;
  if (config.department?.color) return config.department.color;
  return "#2563EB";
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WidgetChatPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const tenant = searchParams.tenant ?? "";
  const dept = searchParams.dept ?? "";

  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const [visitorToken, setVisitorToken] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const primaryColor = resolveThemeColor(config);

  // ── Load widget config ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!tenant || !dept) {
      setConfigError("Missing tenant or dept parameter.");
      setLoadingConfig(false);
      return;
    }

    fetch(`/api/widget/config?tenant=${encodeURIComponent(tenant)}&dept=${encodeURIComponent(dept)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Widget not found");
        return r.json();
      })
      .then((data: { config: WidgetConfig }) => {
        setConfig(data.config);
      })
      .catch(() => {
        setConfigError("This chat widget is not available right now.");
      })
      .finally(() => setLoadingConfig(false));
  }, [tenant, dept]);

  // ── Create / resume session ────────────────────────────────────────────────
  useEffect(() => {
    if (!config || !tenant || !dept) return;

    const visitorId = generateVisitorId();

    // Attempt to reuse existing session from localStorage
    const stored = getStoredSession(tenant, dept);
    if (stored?.token && stored?.conversationId) {
      setVisitorToken(stored.token);
      setConversationId(stored.conversationId);
      setSessionReady(true);
      return;
    }

    fetch("/api/widget/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantSlug: tenant,
        deptSlug: dept,
        visitorId,
        pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
        referrer: typeof document !== "undefined" ? document.referrer : undefined,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Session creation failed");
        return r.json();
      })
      .then((data: { visitorToken: string; conversationId: string }) => {
        setVisitorToken(data.visitorToken);
        setConversationId(data.conversationId);
        storeSession(tenant, dept, data.visitorToken, data.conversationId);
        setSessionReady(true);
      })
      .catch(() => {
        setConfigError("Could not start chat session. Please refresh and try again.");
      });
  }, [config, tenant, dept]);

  // ── Load history once session is ready ────────────────────────────────────
  useEffect(() => {
    if (!sessionReady || !visitorToken || !conversationId) return;

    fetch(`/api/widget/history?conversationId=${encodeURIComponent(conversationId)}`, {
      headers: { Authorization: `Bearer ${visitorToken}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.resolve({ messages: [] })))
      .then((data: { messages: ChatMessage[] }) => {
        if (data.messages && data.messages.length > 0) {
          setMessages(data.messages);
        } else if (config?.welcomeMessage) {
          // Insert synthetic welcome message when no history exists
          setMessages([
            {
              id: "welcome",
              senderType: "BOT",
              content: config.welcomeMessage,
              messageType: "TEXT",
              fileUrl: null,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      })
      .catch(() => {
        // Non-fatal — start with welcome message
        if (config?.welcomeMessage) {
          setMessages([
            {
              id: "welcome",
              senderType: "BOT",
              content: config.welcomeMessage,
              messageType: "TEXT",
              fileUrl: null,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      });
  }, [sessionReady, visitorToken, conversationId, config]);

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || sending || !visitorToken || !conversationId) return;

      const trimmed = text.trim();
      setInputValue("");
      setSending(true);

      // Optimistic: append customer message immediately
      const optimisticId = `opt-${Date.now()}`;
      const optimisticMsg: ChatMessage = {
        id: optimisticId,
        senderType: "CUSTOMER",
        content: trimmed,
        messageType: "TEXT",
        fileUrl: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticMsg]);

      try {
        const res = await fetch("/api/widget/message", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${visitorToken}`,
          },
          body: JSON.stringify({ message: trimmed, conversationId }),
        });

        if (!res.ok) throw new Error("Send failed");

        const data = (await res.json()) as {
          customerMessage: ChatMessage;
          botMessage: ChatMessage;
          handoff?: boolean;
        };

        // Replace optimistic message with server record, then append bot reply
        setMessages((prev) =>
          prev
            .filter((m) => m.id !== optimisticId)
            .concat([data.customerMessage, data.botMessage])
        );
      } catch {
        // Roll back optimistic message and show error
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticId),
          {
            id: `err-${Date.now()}`,
            senderType: "BOT",
            content: "Sorry, something went wrong. Please try again.",
            messageType: "TEXT",
            fileUrl: null,
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [sending, visitorToken, conversationId]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  const handleClose = () => {
    if (typeof window !== "undefined") {
      window.parent.postMessage({ type: "hd-widget-close" }, "*");
    }
  };

  // ─── Render states ──────────────────────────────────────────────────────────

  if (loadingConfig) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "#6B7280",
          fontSize: 14,
        }}
      >
        Loading...
      </div>
    );
  }

  if (configError) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          padding: 24,
          textAlign: "center",
          color: "#6B7280",
          fontSize: 14,
        }}
      >
        {configError}
      </div>
    );
  }

  const quickActions: QuickAction[] = Array.isArray(config?.quickActions)
    ? (config!.quickActions as QuickAction[])
    : [];

  const placeholderText = config?.placeholderText ?? "Type a message...";

  // ─── Main UI ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "#FFFFFF",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 14,
        overflow: "hidden",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          backgroundColor: primaryColor,
          color: "#FFFFFF",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        {config?.tenant?.logoUrl && (
          <img
            src={config.tenant.logoUrl}
            alt={config.tenant.name}
            style={{ height: 28, width: 28, borderRadius: 4, objectFit: "contain", background: "#fff" }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, lineHeight: "1.2" }}>
            {config?.department?.name ?? config?.tenant?.productName ?? "Support"}
          </div>
          <div style={{ fontSize: 11, opacity: 0.85 }}>
            {config?.tenant?.productName ?? config?.tenant?.name}
          </div>
        </div>
        <button
          onClick={handleClose}
          aria-label="Close chat"
          style={{
            background: "transparent",
            border: "none",
            color: "#FFFFFF",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            alignItems: "center",
            opacity: 0.85,
            flexShrink: 0,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* ── Message list ── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.map((msg) => {
          const isBot = msg.senderType === "BOT" || msg.senderType === "AGENT";
          return (
            <div
              key={msg.id}
              style={{
                display: "flex",
                justifyContent: isBot ? "flex-start" : "flex-end",
                alignItems: "flex-end",
                gap: 6,
              }}
            >
              {isBot && (
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    backgroundColor: primaryColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    fontSize: 10,
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  AI
                </div>
              )}
              <div
                style={{
                  maxWidth: "72%",
                  padding: "9px 13px",
                  borderRadius: isBot ? "4px 16px 16px 16px" : "16px 16px 4px 16px",
                  backgroundColor: isBot ? "#F3F4F6" : primaryColor,
                  color: isBot ? "#111827" : "#FFFFFF",
                  fontSize: 13.5,
                  lineHeight: "1.5",
                  wordBreak: "break-word",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                }}
              >
                {msg.content}
                {msg.messageType === "FILE" && msg.fileUrl && (
                  <div style={{ marginTop: 6 }}>
                    <a
                      href={msg.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: isBot ? primaryColor : "#E0E7FF",
                        textDecoration: "underline",
                        fontSize: 12,
                      }}
                    >
                      View file
                    </a>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {sending && (
          <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "flex-end", gap: 6 }}>
            <div
              style={{
                width: 28, height: 28, borderRadius: "50%", backgroundColor: primaryColor,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, fontSize: 10, color: "#fff", fontWeight: 700,
              }}
            >
              AI
            </div>
            <div
              style={{
                padding: "9px 16px",
                borderRadius: "4px 16px 16px 16px",
                backgroundColor: "#F3F4F6",
                display: "flex",
                gap: 4,
                alignItems: "center",
              }}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    backgroundColor: "#9CA3AF",
                    display: "inline-block",
                    animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Quick-action chips (shown when no messages or only welcome) ── */}
      {quickActions.length > 0 && messages.length <= 1 && !sending && (
        <div
          style={{
            padding: "8px 12px 4px",
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            borderTop: "1px solid #F3F4F6",
          }}
        >
          {quickActions.map((qa, idx) => (
            <button
              key={idx}
              onClick={() => sendMessage(qa.message)}
              disabled={sending || !sessionReady}
              style={{
                background: "#F9FAFB",
                border: `1px solid ${primaryColor}`,
                borderRadius: 20,
                color: primaryColor,
                fontSize: 12,
                padding: "5px 12px",
                cursor: sending || !sessionReady ? "not-allowed" : "pointer",
                fontWeight: 500,
                transition: "background 0.15s",
                opacity: sending || !sessionReady ? 0.5 : 1,
              }}
            >
              {qa.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Input area ── */}
      <form
        onSubmit={handleSubmit}
        style={{
          borderTop: "1px solid #E5E7EB",
          padding: "10px 12px",
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexShrink: 0,
          backgroundColor: "#FAFAFA",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={sessionReady ? placeholderText : "Starting session..."}
          disabled={sending || !sessionReady}
          aria-label="Chat message input"
          style={{
            flex: 1,
            border: "1px solid #D1D5DB",
            borderRadius: 20,
            padding: "8px 14px",
            fontSize: 13.5,
            outline: "none",
            backgroundColor: "#FFFFFF",
            color: "#111827",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => (e.target.style.borderColor = primaryColor)}
          onBlur={(e) => (e.target.style.borderColor = "#D1D5DB")}
        />
        <button
          type="submit"
          disabled={sending || !inputValue.trim() || !sessionReady}
          aria-label="Send message"
          style={{
            backgroundColor: primaryColor,
            border: "none",
            borderRadius: "50%",
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: sending || !inputValue.trim() || !sessionReady ? "not-allowed" : "pointer",
            opacity: sending || !inputValue.trim() || !sessionReady ? 0.5 : 1,
            flexShrink: 0,
            transition: "opacity 0.15s",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>

      {/* ── Typing animation keyframes ── */}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-5px); }
        }
      `}</style>
    </div>
  );
}
