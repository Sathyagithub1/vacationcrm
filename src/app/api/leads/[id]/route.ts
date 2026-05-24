import { NextResponse } from "next/server";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { updateLead, changeStage, addNote, deleteLead } from "@/modules/leads/leads.service";
import { assignLead } from "@/modules/leads/assignment.service";
import { logAudit } from "@/modules/audit/audit.service";

// GET /api/leads/[id] — full detail with customer, department, stage, agent, activities, follow-ups, callbacks
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requireAuth();

    const lead = await db.lead.findFirst({
      where: { id },
      include: {
        customer: true,
        department: { select: { id: true, name: true, color: true, slug: true } },
        stage: { select: { id: true, name: true, color: true, position: true } },
        assignee: { select: { id: true, name: true, avatarUrl: true, email: true } },
      },
    });

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // RBAC check
    if (user.role === "DEPT_MANAGER" && user.departmentId && lead.departmentId !== user.departmentId) {
      return forbidden();
    }
    if (user.role === "AGENT" && lead.assignedTo !== user.id) {
      return forbidden();
    }

    // Fetch related data in parallel
    const [activities, followUps, callbacks, fileUploads] = await Promise.all([
      db.leadActivity.findMany({
        where: { leadId: id },
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      db.followUp.findMany({
        where: { leadId: id },
        orderBy: { scheduledAt: "desc" },
        include: {
          assignee: { select: { id: true, name: true } },
        },
      }),
      db.callback.findMany({
        where: { leadId: id },
        orderBy: { preferredTime: "desc" },
        include: {
          assignee: { select: { id: true, name: true } },
        },
      }),
      db.fileUpload.findMany({
        where: { leadId: id },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return NextResponse.json({
      lead,
      activities,
      followUps,
      callbacks,
      fileUploads,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/leads/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch lead" }, { status: 500 });
  }
}

// PUT /api/leads/[id] — update lead fields
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("leads:edit");

    const existing = await db.lead.findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Ownership check
    if (user.role === "AGENT" && existing.assignedTo !== user.id) return forbidden();
    if (user.role === "DEPT_MANAGER" && user.departmentId && existing.departmentId !== user.departmentId) return forbidden();

    const body = await request.json();
    const lead = await updateLead(db, id, body, user.id);

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "lead.update",
      entityType: "Lead",
      entityId: id,
      oldValue: existing,
      newValue: lead,
    });

    return NextResponse.json({ lead });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Lead not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("PUT /api/leads/[id] error:", error);
    return NextResponse.json({ error: "Failed to update lead" }, { status: 500 });
  }
}

// DELETE /api/leads/[id] — delete lead
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("leads:delete");

    // Ownership check before delete
    const existing = await db.lead.findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    if (user.role === "AGENT" && existing.assignedTo !== user.id) return forbidden();
    if (user.role === "DEPT_MANAGER" && user.departmentId && existing.departmentId !== user.departmentId) return forbidden();

    const lead = await deleteLead(db, id);

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "lead.delete",
      entityType: "Lead",
      entityId: id,
      oldValue: lead,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Lead not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("DELETE /api/leads/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete lead" }, { status: 500 });
  }
}

// PATCH /api/leads/[id] — actions: assign, change-stage, add-note
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json({ error: "Action is required" }, { status: 400 });
    }

    if (action === "assign") {
      const { user, db } = await requirePermission("leads:assign");
      const { agentId } = body;

      if (!agentId || typeof agentId !== "string") {
        return NextResponse.json({ error: "Agent ID is required" }, { status: 400 });
      }

      const lead = await assignLead(db, id, agentId, user.id, user.tenantId);

      await logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action: "lead.assign",
        entityType: "Lead",
        entityId: id,
        newValue: { assignedTo: agentId },
      });

      return NextResponse.json({ lead });
    }

    if (action === "change-stage") {
      const { user, db } = await requirePermission("leads:edit");
      const { stageId } = body;

      if (!stageId || typeof stageId !== "string") {
        return NextResponse.json({ error: "Stage ID is required" }, { status: 400 });
      }

      const lead = await changeStage(db, id, stageId, user.id);

      await logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action: "lead.change_stage",
        entityType: "Lead",
        entityId: id,
        newValue: { stageId },
      });

      return NextResponse.json({ lead });
    }

    if (action === "add-note") {
      const { user, db } = await requirePermission("leads:edit");
      const { content } = body;

      if (!content || typeof content !== "string" || !content.trim()) {
        return NextResponse.json({ error: "Note content is required" }, { status: 400 });
      }

      const activity = await addNote(db, id, content.trim(), user.id);
      return NextResponse.json({ activity });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Lead not found" || error.message === "Agent not found" || error.message === "Stage not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("PATCH /api/leads/[id] error:", error);
    return NextResponse.json({ error: "Failed to perform action" }, { status: 500 });
  }
}
