/**
 * DELETE /api/customers/[id]/memory/[memoryId]
 *
 * Soft-delete a CustomerMemory record.  Since the CustomerMemory table has no
 * deletedAt column (keeping the schema lean), this is a hard delete restricted
 * to COMPANY_ADMIN and above.  If a SUMMARY is deleted, the conversation's
 * `summary` field is cleared too.
 *
 * Requires: conversations:write permission + COMPANY_ADMIN or higher
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { prisma } from "@/lib/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = (db: unknown) => db as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyPrisma = prisma as any;

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; memoryId: string }> }
) {
  try {
    const { id: customerId, memoryId } = await params;
    const { db, user } = await requirePermission("conversations:write");

    // Only COMPANY_ADMIN and SUPER_ADMIN can delete memory records
    if (user.role !== "COMPANY_ADMIN" && user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Only company admins can delete memory records" },
        { status: 403 }
      );
    }

    // Verify customer belongs to tenant
    const customer = await db.customer.findFirst({ where: { id: customerId } });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Verify memory belongs to this customer + tenant
    const memory = await anyDb(db).customerMemory.findFirst({
      where: { id: memoryId, customerId },
    }) as { id: string; kind: string; content: string } | null;
    if (!memory) {
      return NextResponse.json({ error: "Memory record not found" }, { status: 404 });
    }

    await anyPrisma.customerMemory.delete({ where: { id: memoryId } });

    // If it was a SUMMARY, clear any conversation.summary that references same content
    if (memory.kind === "SUMMARY") {
      await anyPrisma.conversation.updateMany({
        where: { customerId, summary: memory.content },
        data: { summary: null },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("DELETE /api/customers/[id]/memory/[memoryId] error:", error);
    return NextResponse.json({ error: "Failed to delete memory record" }, { status: 500 });
  }
}
