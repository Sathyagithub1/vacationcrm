import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { logAudit } from "@/modules/audit/audit.service";

// GET /api/customers — list with search, filter, pagination
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();
    const { searchParams } = request.nextUrl;

    const q = searchParams.get("q")?.trim() || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { mobile: { contains: q, mode: "insensitive" } },
      ];
    }

    const [customers, total] = await Promise.all([
      db.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      db.customer.count({ where }),
    ]);

    return NextResponse.json({
      customers,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 });
  }
}

// POST /api/customers — create customer manually
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("leads:create");

    const body = await request.json();
    const { name, mobile, email, alternatePhone, address, notes } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (!mobile || typeof mobile !== "string" || !mobile.trim()) {
      return NextResponse.json({ error: "Mobile is required" }, { status: 400 });
    }

    // Check for duplicate mobile
    const existing = await db.customer.findFirst({
      where: { mobile: mobile.trim() },
    });
    if (existing) {
      return NextResponse.json(
        { error: "A customer with this mobile number already exists" },
        { status: 409 }
      );
    }

    const customer = await (db.customer.create as Function)({
      data: {
        name: name.trim(),
        mobile: mobile.trim(),
        email: email?.trim() || null,
        alternatePhone: alternatePhone?.trim() || null,
        address: address?.trim() || null,
        notes: notes?.trim() || null,
      },
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "customer.create",
      entityType: "Customer",
      entityId: customer.id,
      newValue: customer,
    });

    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    return NextResponse.json({ error: "Failed to create customer" }, { status: 500 });
  }
}
