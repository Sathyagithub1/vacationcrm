import type { Server, Socket } from "socket.io";
import type { WsUser } from "../auth";

interface SendMessagePayload {
  conversationId: string;
  content: string;
  messageType?: "TEXT" | "IMAGE" | "FILE";
}

interface JoinConversationPayload {
  conversationId: string;
}

/**
 * Register chat-related socket event handlers.
 * Handles real-time message delivery, conversation join/leave.
 */
export function registerChatHandlers(
  io: Server,
  socket: Socket,
  user: WsUser
) {
  // Join a conversation room for real-time updates
  socket.on("conversation:join", (payload: JoinConversationPayload) => {
    const room = `conversation:${payload.conversationId}`;
    socket.join(room);
    console.log(
      `[WS] User ${user.userId} joined conversation ${payload.conversationId}`
    );
  });

  // Leave a conversation room
  socket.on("conversation:leave", (payload: JoinConversationPayload) => {
    const room = `conversation:${payload.conversationId}`;
    socket.leave(room);
    console.log(
      `[WS] User ${user.userId} left conversation ${payload.conversationId}`
    );
  });

  // Send a message — broadcast to conversation participants
  socket.on("message:send", (payload: SendMessagePayload) => {
    const room = `conversation:${payload.conversationId}`;

    // Broadcast to all users in the conversation room (except sender)
    socket.to(room).emit("message:new", {
      conversationId: payload.conversationId,
      content: payload.content,
      messageType: payload.messageType || "TEXT",
      senderId: user.userId,
      senderName: user.name,
      senderType: "AGENT",
      timestamp: new Date().toISOString(),
    });

    // Also emit to the sender for confirmation
    socket.emit("message:sent", {
      conversationId: payload.conversationId,
      content: payload.content,
      timestamp: new Date().toISOString(),
    });
  });
}

/**
 * Handle messages published via Redis from the HTTP API.
 * Called by the main server when a message is created via REST.
 */
export function handleRedisMessage(io: Server, data: {
  conversationId: string;
  message: Record<string, unknown>;
  tenantId: string;
}) {
  const room = `conversation:${data.conversationId}`;
  io.to(room).emit("message:new", {
    conversationId: data.conversationId,
    ...data.message,
    timestamp: new Date().toISOString(),
  });
}
