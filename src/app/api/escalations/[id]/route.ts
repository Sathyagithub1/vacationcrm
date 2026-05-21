import { NextResponse } from "next/server";
import { requireAuth, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import {
  acknowledgeEscalation,
  resolveEscalation,
  closeEscalation,
} from "@/modules/escalations/escalation.service";
import { logAudit } from "@/modules/audit/audit.service";

// PATCH /api/escalations/[id] — actions: acknowledge, resolve, close
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action, notes } = body;

    if (!action) {
      return NextResponse.json({ error: "Action is required" }, { status: 400 });
    }

    const { user, db } = await requireAuth();

    if (action === "acknowledge") {
      const escalation = await acknowledgeEscalation(db, id);

      await logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action: "escalation.acknowledge",
        entityType: "Escalation",
        entityId: id,
        newValue: { status: "ACKNOWLEDGED" },
      });

      return NextResponse.json({ escalation });
    }

    if (action === "resolve") {
      const escalation = await resolveEscalation(db, id, notes);

      await logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action: "escalation.resolve",
        entityType: "Escalation",
        entityId: id,
        newValue: { status: "RESOLVED" },
      });

      return NextResponse.json({ escalation });
    }

    if (action === "close") {
      const escalation = await closeEscalation(db, id);

      await logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action: "escalation.close",
        entityType: "Escalation",
        entityId: id,
        newValue: { status: "CLOSED" },
      });

      return NextResponse.json({ escalation });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Escalation not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (
        error.message.includes("only acknowledge") ||
        error.message.includes("already") ||
        error.message.includes("Already")
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    console.error("PATCH /api/escalations/[id] error:", error);
    return NextResponse.json({ error: "Failed to perform action" }, { status: 500 });
  }
}
