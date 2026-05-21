import type { Server, Socket } from "socket.io";
import type { WsUser } from "../auth";

interface TypingPayload {
  conversationId: string;
}

/**
 * Register typing indicator event handlers.
 * Broadcasts typing start/stop to conversation room participants.
 */
export function registerTypingHandlers(
  _io: Server,
  socket: Socket,
  user: WsUser
) {
  socket.on("typing:start", (payload: TypingPayload) => {
    const room = `conversation:${payload.conversationId}`;
    socket.to(room).emit("typing:start", {
      conversationId: payload.conversationId,
      userId: user.userId,
      name: user.name,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on("typing:stop", (payload: TypingPayload) => {
    const room = `conversation:${payload.conversationId}`;
    socket.to(room).emit("typing:stop", {
      conversationId: payload.conversationId,
      userId: user.userId,
      name: user.name,
      timestamp: new Date().toISOString(),
    });
  });
}
