"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { io, type Socket } from "socket.io-client";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:3001";

interface UseSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  onlineUsers: string[];
}

/**
 * Client hook for WebSocket connection management.
 * Auto-connects on mount with JWT from session, reconnects on disconnect,
 * cleans up on unmount.
 */
export function useSocket(): UseSocketReturn {
  const { data: session, status } = useSession();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);

  useEffect(() => {
    // Don't connect until we have a session
    if (status !== "authenticated" || !session?.user) return;

    // Build the WebSocket token from the session JWT
    // The token is fetched from our custom endpoint
    let cancelled = false;

    async function connect() {
      try {
        // Fetch a WS-specific JWT token
        const res = await fetch("/api/auth/ws-token");
        if (!res.ok) return;
        const { token } = await res.json();

        if (cancelled) return;

        const socket = io(WS_URL, {
          query: { token },
          transports: ["websocket", "polling"],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 30000,
        });

        socketRef.current = socket;

        socket.on("connect", () => {
          setIsConnected(true);
        });

        socket.on("disconnect", () => {
          setIsConnected(false);
        });

        socket.on("auth:error", (data: { message: string }) => {
          console.error("[Socket] Auth error:", data.message);
          socket.disconnect();
        });

        // Presence events
        socket.on("presence:list", (data: { users: string[] }) => {
          setOnlineUsers(data.users);
        });

        socket.on("presence:user-online", (data: { userId: string }) => {
          setOnlineUsers((prev) =>
            prev.includes(data.userId) ? prev : [...prev, data.userId]
          );
        });

        socket.on("presence:user-offline", (data: { userId: string }) => {
          setOnlineUsers((prev) => prev.filter((id) => id !== data.userId));
        });
      } catch (err) {
        console.error("[Socket] Connection error:", err);
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setIsConnected(false);
      setOnlineUsers([]);
    };
  }, [session, status]);

  return {
    socket: socketRef.current,
    isConnected,
    onlineUsers,
  };
}

/**
 * Hook for real-time conversation messages.
 * Joins a conversation room and listens for new messages.
 */
export function useConversationSocket(
  socket: Socket | null,
  conversationId: string | null,
  onNewMessage?: (message: Record<string, unknown>) => void,
  onTyping?: (data: { userId: string; name: string }) => void,
  onTypingStop?: (data: { userId: string; name: string }) => void
) {
  const onNewMessageRef = useRef(onNewMessage);
  const onTypingRef = useRef(onTyping);
  const onTypingStopRef = useRef(onTypingStop);

  // Keep refs up to date
  useEffect(() => {
    onNewMessageRef.current = onNewMessage;
    onTypingRef.current = onTyping;
    onTypingStopRef.current = onTypingStop;
  }, [onNewMessage, onTyping, onTypingStop]);

  useEffect(() => {
    if (!socket || !conversationId) return;

    // Join conversation room
    socket.emit("conversation:join", { conversationId });

    const handleNewMessage = (msg: Record<string, unknown>) => {
      if (msg.conversationId === conversationId) {
        onNewMessageRef.current?.(msg);
      }
    };

    const handleTypingStart = (data: { conversationId: string; userId: string; name: string }) => {
      if (data.conversationId === conversationId) {
        onTypingRef.current?.(data);
      }
    };

    const handleTypingStop = (data: { conversationId: string; userId: string; name: string }) => {
      if (data.conversationId === conversationId) {
        onTypingStopRef.current?.(data);
      }
    };

    socket.on("message:new", handleNewMessage);
    socket.on("typing:start", handleTypingStart);
    socket.on("typing:stop", handleTypingStop);

    return () => {
      socket.emit("conversation:leave", { conversationId });
      socket.off("message:new", handleNewMessage);
      socket.off("typing:start", handleTypingStart);
      socket.off("typing:stop", handleTypingStop);
    };
  }, [socket, conversationId]);

  const sendMessage = useCallback(
    (content: string, messageType: string = "TEXT") => {
      if (!socket || !conversationId) return;
      socket.emit("message:send", { conversationId, content, messageType });
    },
    [socket, conversationId]
  );

  const startTyping = useCallback(() => {
    if (!socket || !conversationId) return;
    socket.emit("typing:start", { conversationId });
  }, [socket, conversationId]);

  const stopTyping = useCallback(() => {
    if (!socket || !conversationId) return;
    socket.emit("typing:stop", { conversationId });
  }, [socket, conversationId]);

  return { sendMessage, startTyping, stopTyping };
}
