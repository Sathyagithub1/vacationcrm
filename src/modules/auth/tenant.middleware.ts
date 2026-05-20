import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-options";
import { tenantPrisma } from "@/lib/prisma";
import { hasPermission } from "@/modules/auth/rbac";
import type { SessionUser, Permission } from "@/types";

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    tenantId: session.user.tenantId,
    departmentId: session.user.departmentId,
  };
}

export async function requireAuth() {
  const user = await getSessionUser();
  if (!user) {
    throw new Error("Unauthorized");
  }

  return {
    user,
    db: tenantPrisma(user.tenantId),
  };
}

export async function requirePermission(permission: Permission) {
  const { user, db } = await requireAuth();

  if (!hasPermission(user.role, permission)) {
    throw new Error("Forbidden");
  }

  return { user, db };
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
