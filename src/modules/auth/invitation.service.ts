import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

const SALT_ROUNDS = 12;
const TOKEN_LENGTH = 32; // 32 bytes = 64 hex chars
const EXPIRY_DAYS = 7;

interface CreateInvitationData {
  tenantId: string;
  email: string;
  role: Role;
  departmentId?: string | null;
  invitedBy: string;
}

export async function createInvitation(data: CreateInvitationData) {
  const token = crypto.randomBytes(TOKEN_LENGTH).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + EXPIRY_DAYS);

  return prisma.invitation.create({
    data: {
      tenantId: data.tenantId,
      email: data.email,
      role: data.role,
      departmentId: data.departmentId ?? null,
      invitedBy: data.invitedBy,
      token,
      expiresAt,
    },
  });
}

export async function acceptInvitation(
  token: string,
  name: string,
  password: string
) {
  const invitation = await prisma.invitation.findUnique({
    where: { token },
  });

  if (!invitation) {
    throw new Error("Invalid invitation token");
  }

  if (invitation.acceptedAt) {
    throw new Error("Invitation has already been used");
  }

  if (new Date() > invitation.expiresAt) {
    throw new Error("Invitation has expired");
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        tenantId: invitation.tenantId,
        email: invitation.email,
        passwordHash,
        name,
        role: invitation.role,
        departmentId: invitation.departmentId,
      },
    });

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });

    return user;
  });
}
