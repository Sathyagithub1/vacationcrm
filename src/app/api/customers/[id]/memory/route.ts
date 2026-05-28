/**
 * GET  /api/customers/[id]/memory  — return structured memory + recent messages
 * POST /api/customers/[id]/memory  — admin adds a manual fact or preference
 *
 * Requires: conversations:read (GET) or conversations:write (POST)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import {
  getCustomerContext,
  appendMemory,
} from "@/modules/memory/customer-memory";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = (db: unknown) => db as any;

const VALID_KINDS = ["FACT", "PREFERENCE", "SUMMARY"] as const;
type MemoryKind = (typeof VALID_KINDS)[number];

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params;
    const { db, user } = await requirePermission("conversations:read");

    // Verify customer belongs to tenant
    const customer = await db.customer.findFirst({ where: { id: customerId } });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const context = await getCustomerContext(customerId);

    // Also return raw memory records so admin can manage them
    const memories = await anyDb(db).customerMemory.findMany({
      where: { customerId },
      orderBy: [{ kind: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        kind: true,
        content: true,
        sourceMessageId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ context, memories });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/customers/[id]/memory error:", error);
    return NextResponse.json({ error: "Failed to fetch customer memory" }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params;
    const { db, user } = await requirePermission("conversations:write");

    // Verify customer belongs to tenant
    const customer = await db.customer.findFirst({ where: { id: customerId } });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const { kind, content, sourceMessageId } = body;

    if (!kind || !VALID_KINDS.includes(kind as MemoryKind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${VALID_KINDS.join(", ")}` },
        { status: 400 }
      );
    }
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    await appendMemory(
      user.tenantId,
      customerId,
      kind as MemoryKind,
      content.trim(),
      typeof sourceMessageId === "string" ? sourceMessageId : undefined
    );

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/customers/[id]/memory error:", error);
    return NextResponse.json({ error: "Failed to add memory" }, { status: 500 });
  }
}
