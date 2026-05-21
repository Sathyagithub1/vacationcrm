import type { Server, Socket } from "socket.io";
import Redis from "ioredis";
import type { WsUser } from "../auth";

/**
 * Register presence-related socket event handlers.
 * Tracks online/offline status per tenant using Redis Sets.
 */
export function registerPresenceHandlers(
  io: Server,
  socket: Socket,
  user: WsUser,
  redis: Redis | null
) {
  const tenantRoom = `tenant:${user.tenantId}`;
  const presenceKey = `presence:${user.tenantId}`;

  // Mark user online
  async function markOnline() {
    if (redis) {
      await redis.sadd(presenceKey, user.userId);
      // Store last seen timestamp
      await redis.hset(
        `presence:lastseen:${user.tenantId}`,
        user.userId,
        new Date().toISOString()
      );
    }

    // Broadcast to tenant room
    socket.to(tenantRoom).emit("presence:user-online", {
      userId: user.userId,
      name: user.name,
      timestamp: new Date().toISOString(),
    });
  }

  // Mark user offline
  async function markOffline() {
    if (redis) {
      await redis.srem(presenceKey, user.userId);
      await redis.hset(
        `presence:lastseen:${user.tenantId}`,
        user.userId,
        new Date().toISOString()
      );
    }

    // Broadcast to tenant room
    socket.to(tenantRoom).emit("presence:user-offline", {
      userId: user.userId,
      name: user.name,
      timestamp: new Date().toISOString(),
    });
  }

  // Get list of online users for this tenant
  async function getOnlineUsers(): Promise<string[]> {
    if (!redis) return [];
    return redis.smembers(presenceKey);
  }

  // On connect: auto-mark online
  socket.on("presence:online", async () => {
    await markOnline();
  });

  // Send current online users list to newly connected user
  (async () => {
    const onlineUsers = await getOnlineUsers();
    socket.emit("presence:list", { users: onlineUsers });
    await markOnline();
  })();

  // On disconnect: mark offline
  socket.on("disconnect", async () => {
    // Check if user has any other active sockets in the same tenant room
    const sockets = await io.in(tenantRoom).fetchSockets();
    const stillConnected = sockets.some(
      (s) => s.id !== socket.id && (s.data as { userId?: string })?.userId === user.userId
    );

    if (!stillConnected) {
      await markOffline();
    }
  });
}
