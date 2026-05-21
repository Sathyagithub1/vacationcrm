import * as http from "http";
import { Server } from "socket.io";
import Redis from "ioredis";

const createServer = http.createServer;
import { authenticateSocket, type WsUser } from "./auth";
import { registerChatHandlers, handleRedisMessage } from "./handlers/chat.handler";
import { registerPresenceHandlers } from "./handlers/presence.handler";
import { registerTypingHandlers } from "./handlers/typing.handler";

const WS_PORT = parseInt(process.env.WS_PORT || "3001", 10);
const CORS_ORIGIN = process.env.NEXTAUTH_URL || "http://localhost:3000";

// ─── HTTP Server ─────────────────────────────────────────────────────────────

const httpServer = createServer((_req, res) => {
  // Health check endpoint
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", server: "ws", uptime: process.uptime() }));
});

// ─── Socket.io Server ────────────────────────────────────────────────────────

const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 20000,
});

// ─── Redis for pub/sub (optional) ────────────────────────────────────────────

let redisSub: Redis | null = null;
let redisClient: Redis | null = null;

function initRedis(): { sub: Redis | null; client: Redis | null } {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn("[WS] REDIS_URL not set — Redis pub/sub disabled");
    return { sub: null, client: null };
  }

  try {
    const sub = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
    const client = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });

    sub.on("error", (err) => console.error("[WS] Redis sub error:", err.message));
    client.on("error", (err) => console.error("[WS] Redis client error:", err.message));

    return { sub, client };
  } catch (err) {
    console.error("[WS] Failed to create Redis clients:", err);
    return { sub: null, client: null };
  }
}

// ─── Redis Subscription ──────────────────────────────────────────────────────

function subscribeToRedisChannels() {
  if (!redisSub) return;

  // Listen for messages created via the HTTP API
  redisSub.subscribe("ws:message:new", "ws:notification:new", (err) => {
    if (err) {
      console.error("[WS] Redis subscribe error:", err.message);
    } else {
      console.log("[WS] Subscribed to Redis channels");
    }
  });

  redisSub.on("message", (channel, rawData) => {
    try {
      const data = JSON.parse(rawData);

      switch (channel) {
        case "ws:message:new":
          handleRedisMessage(io, data);
          break;

        case "ws:notification:new":
          // Deliver notification to specific user
          if (data.userId) {
            io.to(`user:${data.userId}`).emit("notification:new", data);
          }
          // Broadcast to tenant if it's a tenant-wide notification
          if (data.tenantId && data.broadcast) {
            io.to(`tenant:${data.tenantId}`).emit("notification:new", data);
          }
          break;
      }
    } catch (err) {
      console.error("[WS] Failed to parse Redis message:", err);
    }
  });
}

// ─── Connection Handler ──────────────────────────────────────────────────────

io.on("connection", (socket) => {
  let user: WsUser;

  try {
    user = authenticateSocket(socket);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Authentication failed";
    console.warn(`[WS] Auth rejected: ${message}`);
    socket.emit("auth:error", { message });
    socket.disconnect(true);
    return;
  }

  // Store user info on socket data for later reference
  socket.data.userId = user.userId;
  socket.data.tenantId = user.tenantId;

  console.log(
    `[WS] Connected: user=${user.userId} tenant=${user.tenantId} socket=${socket.id}`
  );

  // Join rooms
  socket.join(`tenant:${user.tenantId}`);
  socket.join(`user:${user.userId}`);
  if (user.departmentId) {
    socket.join(`dept:${user.departmentId}`);
  }

  // Register event handlers
  registerChatHandlers(io, socket, user);
  registerPresenceHandlers(io, socket, user, redisClient);
  registerTypingHandlers(io, socket, user);

  // Handle disconnect logging
  socket.on("disconnect", (reason) => {
    console.log(
      `[WS] Disconnected: user=${user.userId} socket=${socket.id} reason=${reason}`
    );
  });
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

function shutdown(signal: string) {
  console.log(`[WS] ${signal} received — shutting down gracefully`);

  io.close(() => {
    console.log("[WS] Socket.io server closed");

    if (redisSub) {
      redisSub.disconnect();
    }
    if (redisClient) {
      redisClient.disconnect();
    }

    httpServer.close(() => {
      console.log("[WS] HTTP server closed");
      process.exit(0);
    });
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error("[WS] Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─── Start ───────────────────────────────────────────────────────────────────

const redisClients = initRedis();
redisSub = redisClients.sub;
redisClient = redisClients.client;

subscribeToRedisChannels();

httpServer.listen(WS_PORT, () => {
  console.log(`[WS] WebSocket server running on port ${WS_PORT}`);
  console.log(`[WS] CORS origin: ${CORS_ORIGIN}`);
  console.log(`[WS] Redis: ${redisClient ? "connected" : "disabled"}`);
});
