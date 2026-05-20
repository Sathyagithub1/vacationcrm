import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { logAudit } from "@/modules/audit/audit.service";

type RouteContext = { params: Promise<{ id: string }> };

// PUT /api/pipeline-stages/[id] — update stage
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user, db } = await requirePermission("settings:pipeline");

    const existing = await db.pipelineStage.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Pipeline stage not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, color, position } = body;

    const updateData: Record<string, unknown> = {};

    // System stages can only change color
    if (existing.isSystem) {
      if (color !== undefined) updateData.color = color;
    } else {
      if (name !== undefined) updateData.name = name.trim();
      if (color !== undefined) updateData.color = color;
      if (position !== undefined) updateData.position = position;
    }

    const stage = await db.pipelineStage.update({
      where: { id },
      data: updateData,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "pipeline_stage.update",
      entityType: "PipelineStage",
      entityId: stage.id,
      oldValue: existing,
      newValue: stage,
    });

    return NextResponse.json({ stage });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    return NextResponse.json(
      { error: "Failed to update pipeline stage" },
      { status: 500 }
    );
  }
}

// DELETE /api/pipeline-stages/[id] — delete non-system stage only
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user, db } = await requirePermission("settings:pipeline");

    const existing = await db.pipelineStage.findUnique({
      where: { id },
      include: { _count: { select: { leads: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Pipeline stage not found" }, { status: 404 });
    }

    if (existing.isSystem) {
      return NextResponse.json(
        { error: "System stages cannot be deleted" },
        { status: 403 }
      );
    }

    if (existing._count.leads > 0) {
      return NextResponse.json(
        { error: "Cannot delete stage with active leads. Move leads to another stage first." },
        { status: 409 }
      );
    }

    await db.pipelineStage.delete({ where: { id } });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "pipeline_stage.delete",
      entityType: "PipelineStage",
      entityId: id,
      oldValue: existing,
    });

    return NextResponse.json({ message: "Stage deleted" });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    return NextResponse.json(
      { error: "Failed to delete pipeline stage" },
      { status: 500 }
    );
  }
}
