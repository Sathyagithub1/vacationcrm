import { NextResponse } from "next/server";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { logAudit } from "@/modules/audit/audit.service";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// GET /api/pipeline-stages — list stages for tenant, optional departmentId filter
export async function GET(request: Request) {
  try {
    const { db } = await requireAuth();

    const { searchParams } = new URL(request.url);
    const departmentId = searchParams.get("departmentId");

    const where: Record<string, unknown> = {};
    if (departmentId) {
      where.departmentId = departmentId;
    }

    const stages = await db.pipelineStage.findMany({
      where,
      orderBy: { position: "asc" },
      include: {
        department: { select: { id: true, name: true } },
        _count: { select: { leads: true } },
      },
    });

    return NextResponse.json({ stages });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    return NextResponse.json(
      { error: "Failed to fetch pipeline stages" },
      { status: 500 }
    );
  }
}

// POST /api/pipeline-stages — create a new stage
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("settings:pipeline");

    const body = await request.json();
    const { name, color, departmentId, position } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const slug = slugify(name.trim());

    // Check for duplicate slug
    const existing = await db.pipelineStage.findFirst({
      where: { slug },
    });
    if (existing) {
      return NextResponse.json(
        { error: "A pipeline stage with this name already exists" },
        { status: 409 }
      );
    }

    // Determine position: use provided or append to end
    let finalPosition = position;
    if (finalPosition === undefined || finalPosition === null) {
      const lastStage = await db.pipelineStage.findFirst({
        orderBy: { position: "desc" },
      });
      finalPosition = lastStage ? lastStage.position + 1 : 0;
    }

    const stage = await (db.pipelineStage.create as Function)({
      data: {
        name: name.trim(),
        slug,
        color: color || "#6B7280",
        departmentId: departmentId || null,
        position: finalPosition,
      },
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "pipeline_stage.create",
      entityType: "PipelineStage",
      entityId: stage.id,
      newValue: stage,
    });

    return NextResponse.json({ stage }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    return NextResponse.json(
      { error: "Failed to create pipeline stage" },
      { status: 500 }
    );
  }
}
