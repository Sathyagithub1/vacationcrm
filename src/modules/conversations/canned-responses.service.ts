type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

interface CreateCannedResponseData {
  departmentId?: string | null;
  title: string;
  content: string;
  shortcut: string;
  createdBy: string;
}

interface UpdateCannedResponseData {
  title?: string;
  content?: string;
  shortcut?: string;
  departmentId?: string | null;
  isActive?: boolean;
}

export async function listCannedResponses(db: TenantDb, departmentId?: string) {
  const where: Record<string, unknown> = { isActive: true };
  if (departmentId) {
    where.OR = [
      { departmentId },
      { departmentId: null }, // Global canned responses
    ];
  }

  const responses = await db.cannedResponse.findMany({
    where,
    orderBy: { title: "asc" },
    include: {
      department: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true } },
    },
  });

  return responses;
}

export async function createCannedResponse(db: TenantDb, data: CreateCannedResponseData) {
  if (data.departmentId) {
    const dept = await db.department.findFirst({ where: { id: data.departmentId } });
    if (!dept) throw new Error("Department not found");
  }

  const response = await (db.cannedResponse.create as Function)({
    data: {
      departmentId: data.departmentId || null,
      title: data.title,
      content: data.content,
      shortcut: data.shortcut,
      createdBy: data.createdBy,
      isActive: true,
    },
  });

  return response;
}

export async function updateCannedResponse(db: TenantDb, id: string, data: UpdateCannedResponseData) {
  const existing = await db.cannedResponse.findFirst({ where: { id } });
  if (!existing) throw new Error("Canned response not found");

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.content !== undefined) updateData.content = data.content;
  if (data.shortcut !== undefined) updateData.shortcut = data.shortcut;
  if (data.departmentId !== undefined) updateData.departmentId = data.departmentId || null;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  const response = await db.cannedResponse.update({
    where: { id },
    data: updateData,
  });

  return response;
}

export async function deleteCannedResponse(db: TenantDb, id: string) {
  const existing = await db.cannedResponse.findFirst({ where: { id } });
  if (!existing) throw new Error("Canned response not found");

  await db.cannedResponse.delete({ where: { id } });
  return existing;
}
