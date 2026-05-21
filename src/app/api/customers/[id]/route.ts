import { NextResponse } from "next/server";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { logAudit } from "@/modules/audit/audit.service";

// GET /api/customers/[id] — customer detail with linked leads
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requireAuth();

    const customer = await db.customer.findFirst({
      where: { id },
    });

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Fetch linked leads (most recent first) with stage and department
    // Apply RBAC filtering so users only see leads they have access to
    const leadWhere: Record<string, unknown> = { customerId: id };
    if (user.role === "AGENT") {
      leadWhere.assignedTo = user.id;
    } else if (user.role === "DEPT_MANAGER" && user.departmentId) {
      leadWhere.departmentId = user.departmentId;
    }

    const leads = await db.lead.findMany({
      where: leadWhere,
      orderBy: { createdAt: "desc" },
      include: {
        stage: { select: { id: true, name: true, color: true } },
        department: { select: { id: true, name: true, color: true } },
      },
    });

    return NextResponse.json({ customer, leads });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    return NextResponse.json({ error: "Failed to fetch customer" }, { status: 500 });
  }
}

// PUT /api/customers/[id] — update customer fields
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("leads:edit");

    const existing = await db.customer.findFirst({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, email, mobile, alternatePhone, address, notes } = body;

    // If mobile is changing, check for duplicates
    if (mobile && mobile.trim() !== existing.mobile) {
      const duplicate = await db.customer.findFirst({
        where: { mobile: mobile.trim(), id: { not: id } },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "A customer with this mobile number already exists" },
          { status: 409 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (email !== undefined) updateData.email = email?.trim() || null;
    if (mobile !== undefined) updateData.mobile = mobile.trim();
    if (alternatePhone !== undefined) updateData.alternatePhone = alternatePhone?.trim() || null;
    if (address !== undefined) updateData.address = address?.trim() || null;
    if (notes !== undefined) updateData.notes = notes?.trim() || null;

    const customer = await db.customer.update({
      where: { id },
      data: updateData,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "customer.update",
      entityType: "Customer",
      entityId: id,
      oldValue: existing,
      newValue: customer,
    });

    return NextResponse.json({ customer });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    return NextResponse.json({ error: "Failed to update customer" }, { status: 500 });
  }
}
