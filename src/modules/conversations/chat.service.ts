type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

interface CreateConversationData {
  leadId: string;
  assignedAgentId: string;
}

interface SendMessageData {
  conversationId: string;
  senderType: string;
  senderId?: string | null;
  content: string;
  messageType?: string;
  fileUrl?: string | null;
}

export async function createConversation(db: TenantDb, data: CreateConversationData) {
  // Verify lead exists
  const lead = await db.lead.findFirst({ where: { id: data.leadId } });
  if (!lead) throw new Error("Lead not found");

  // Check for existing active conversation on this lead
  const existing = await db.conversation.findFirst({
    where: { leadId: data.leadId, status: { in: ["ACTIVE", "HUMAN_TAKEOVER"] } },
  });
  if (existing) throw new Error("An active conversation already exists for this lead");

  // Verify agent
  const agent = await db.user.findFirst({ where: { id: data.assignedAgentId, isActive: true } });
  if (!agent) throw new Error("Agent not found");

  const conversation = await (db.conversation.create as Function)({
    data: {
      leadId: data.leadId,
      channel: "MANUAL",
      status: "ACTIVE",
      assignedAgentId: data.assignedAgentId,
      startedAt: new Date(),
    },
  });

  return conversation;
}

export async function sendMessage(db: TenantDb, data: SendMessageData) {
  // Verify conversation exists
  const conversation = await db.conversation.findFirst({ where: { id: data.conversationId } });
  if (!conversation) throw new Error("Conversation not found");
  if (conversation.status === "CLOSED") throw new Error("Cannot send message to a closed conversation");

  const message = await (db.message.create as Function)({
    data: {
      conversationId: data.conversationId,
      senderType: data.senderType,
      senderId: data.senderId || null,
      content: data.content,
      messageType: data.messageType || "TEXT",
      fileUrl: data.fileUrl || null,
    },
  });

  return message;
}

export async function closeConversation(db: TenantDb, conversationId: string) {
  const conversation = await db.conversation.findFirst({ where: { id: conversationId } });
  if (!conversation) throw new Error("Conversation not found");
  if (conversation.status === "CLOSED") throw new Error("Already closed");

  const updated = await db.conversation.update({
    where: { id: conversationId },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
    },
  });

  return updated;
}

export async function listConversations(
  db: TenantDb,
  filters: { status?: string; assignedAgentId?: string; page?: number; limit?: number }
) {
  const { status, assignedAgentId, page = 1, limit = 50 } = filters;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (assignedAgentId) where.assignedAgentId = assignedAgentId;

  const [conversations, total] = await Promise.all([
    db.conversation.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip,
      take: limit,
      include: {
        lead: {
          include: {
            customer: { select: { id: true, name: true, mobile: true, email: true } },
            department: { select: { id: true, name: true, color: true } },
            stage: { select: { id: true, name: true } },
          },
        },
        agent: { select: { id: true, name: true, avatarUrl: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, createdAt: true, senderType: true },
        },
      },
    }),
    db.conversation.count({ where }),
  ]);

  return { conversations, total, page, totalPages: Math.ceil(total / limit) };
}

export async function getConversationDetail(db: TenantDb, conversationId: string) {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId },
    include: {
      lead: {
        include: {
          customer: true,
          department: { select: { id: true, name: true, color: true } },
          stage: { select: { id: true, name: true, color: true } },
          assignee: { select: { id: true, name: true, avatarUrl: true } },
        },
      },
      agent: { select: { id: true, name: true, avatarUrl: true, email: true } },
    },
  });

  if (!conversation) throw new Error("Conversation not found");
  return conversation;
}

export async function getMessages(
  db: TenantDb,
  conversationId: string,
  page: number = 1,
  limit: number = 50
) {
  const skip = (page - 1) * limit;

  const [messages, total] = await Promise.all([
    db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      skip,
      take: limit,
    }),
    db.message.count({ where: { conversationId } }),
  ]);

  return { messages, total, page, totalPages: Math.ceil(total / limit) };
}
