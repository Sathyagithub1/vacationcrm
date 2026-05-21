import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import {
  listFollowUpRules,
  createFollowUpRule,
  updateFollowUpRule,
  deleteFollowUpRule,
} from "@/modules/follow-ups/follow-up-rules.service";
import { logAudit } from "@/modules/audit/audit.service";

const VALID_TRIGGER_TYPES = ["STAGE_CHANGE", "LEAD_CREATED", "LEAD_INACTIVE"];
const VALID_FOLLOW_UP_TYPES = ["REMINDER", "QUOTATION", "DOCUMENT", "PAYMENT", "RE_ENGAGE"];

// GET /api/follow-up-rules — list all rules
export async function GET() {
  try {
    const { db } = await requirePermission("follow-ups:create");
    const rules = await listFollowUpRules(db);
    return NextResponse.json({ rules });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/follow-up-rules error:", error);
    return NextResponse.json({ error: "Failed to fetch rules" }, { status: 500 });
  }
}

// POST /api/follow-up-rules — create a rule
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("follow-ups:create");

    const body = await request.json();
    const { departmentId, triggerType, triggerValue, followUpType, delayHours, messageTemplate } = body;

    if (!triggerType || !VALID_TRIGGER_TYPES.includes(triggerType)) {
      return NextResponse.json({ error: "Valid trigger type is required" }, { status: 400 });
    }
    if (!followUpType || !VALID_FOLLOW_UP_TYPES.includes(followUpType)) {
      return NextResponse.json({ error: "Valid follow-up type is required" }, { status: 400 });
    }
    if (delayHours == null || typeof delayHours !== "number" || delayHours < 0) {
      return NextResponse.json({ error: "Delay hours must be a non-negative number" }, { status: 400 });
    }

    const rule = await createFollowUpRule(db, {
      departmentId: departmentId || null,
      triggerType,
      triggerValue: triggerValue || null,
      followUpType,
      delayHours,
      messageTemplate: messageTemplate || null,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "follow_up_rule.create",
      entityType: "FollowUpRule",
      entityId: rule.id,
      newValue: rule,
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Department not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("POST /api/follow-up-rules error:", error);
    return NextResponse.json({ error: "Failed to create rule" }, { status: 500 });
  }
}

// PUT /api/follow-up-rules — update a rule (pass id in body)
export async function PUT(request: Request) {
  try {
    const { user, db } = await requirePermission("follow-ups:create");

    const body = await request.json();
    const { id, ...data } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Rule ID is required" }, { status: 400 });
    }

    const rule = await updateFollowUpRule(db, id, data);

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "follow_up_rule.update",
      entityType: "FollowUpRule",
      entityId: id,
      newValue: rule,
    });

    return NextResponse.json({ rule });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Rule not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("PUT /api/follow-up-rules error:", error);
    return NextResponse.json({ error: "Failed to update rule" }, { status: 500 });
  }
}

// DELETE /api/follow-up-rules — delete a rule (pass id in body)
export async function DELETE(request: Request) {
  try {
    const { user, db } = await requirePermission("follow-ups:create");

    const body = await request.json();
    const { id } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Rule ID is required" }, { status: 400 });
    }

    const deleted = await deleteFollowUpRule(db, id);

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "follow_up_rule.delete",
      entityType: "FollowUpRule",
      entityId: id,
      oldValue: deleted,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Rule not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("DELETE /api/follow-up-rules error:", error);
    return NextResponse.json({ error: "Failed to delete rule" }, { status: 500 });
  }
}
