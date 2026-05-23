type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

interface KnowledgeBaseFilters {
  departmentId?: string;
  type?: string;
  isActive?: boolean;
}

interface CreateKnowledgeBaseData {
  departmentId: string;
  type: string;
  title: string;
  content: string;
}

interface UpdateKnowledgeBaseData {
  title?: string;
  content?: string;
  type?: string;
  isActive?: boolean;
}

const VALID_KB_TYPES = ["FAQ", "SOP", "PRICING", "DOCUMENT", "CUSTOM"];

export async function listKnowledgeBases(db: TenantDb, filters: KnowledgeBaseFilters) {
  const where: Record<string, unknown> = {};

  if (filters.departmentId) where.departmentId = filters.departmentId;
  if (filters.type && VALID_KB_TYPES.includes(filters.type)) where.type = filters.type;
  if (filters.isActive !== undefined) where.isActive = filters.isActive;

  return db.knowledgeBase.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      department: { select: { id: true, name: true, color: true, slug: true } },
    },
  });
}

export async function createKnowledgeBase(db: TenantDb, data: CreateKnowledgeBaseData) {
  return (db.knowledgeBase.create as Function)({
    data: {
      departmentId: data.departmentId,
      type: data.type,
      title: data.title,
      content: data.content,
    },
    include: {
      department: { select: { id: true, name: true, color: true, slug: true } },
    },
  });
}

export async function updateKnowledgeBase(db: TenantDb, id: string, data: UpdateKnowledgeBaseData) {
  const existing = await db.knowledgeBase.findFirst({ where: { id } });
  if (!existing) throw new Error("Knowledge base entry not found");

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  if (data.content !== undefined) {
    updateData.content = data.content;
    // Clear embedding when content changes — it will need to be re-generated
    updateData.embedding = null;
    updateData.embeddingModel = null;
  }

  return (db.knowledgeBase.update as Function)({
    where: { id },
    data: updateData,
    include: {
      department: { select: { id: true, name: true, color: true, slug: true } },
    },
  });
}

export async function deleteKnowledgeBase(db: TenantDb, id: string) {
  const existing = await db.knowledgeBase.findFirst({ where: { id } });
  if (!existing) throw new Error("Knowledge base entry not found");

  await db.knowledgeBase.delete({ where: { id } });
  return existing;
}

export async function getKnowledgeBaseContext(db: TenantDb, departmentId: string): Promise<string> {
  const entries = await db.knowledgeBase.findMany({
    where: { departmentId, isActive: true },
    orderBy: { type: "asc" },
    select: { type: true, title: true, content: true },
  });

  if (entries.length === 0) return "";

  const lines: string[] = [];

  for (const entry of entries) {
    lines.push(`[${entry.type}] ${entry.title}`);
    lines.push(entry.content.trim());
    lines.push("");
  }

  return lines.join("\n").trim();
}
