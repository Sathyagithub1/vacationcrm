import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const SALT_ROUNDS = 12;
const TOKEN_LENGTH = 32; // 32 bytes = 64 hex chars
const EXPIRY_HOURS = 1;

export async function createPasswordReset(email: string) {
  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
  });

  // Don't reveal whether user exists
  if (!user) return null;

  const token = crypto.randomBytes(TOKEN_LENGTH).toString("hex");
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + EXPIRY_HOURS);

  const resetToken = await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      token,
      expiresAt,
    },
  });

  return {
    token: resetToken.token,
    userId: user.id,
    email: user.email,
  };
}

export async function resetPassword(token: string, newPassword: string) {
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token },
  });

  if (!resetToken) {
    throw new Error("Invalid reset token");
  }

  if (resetToken.usedAt) {
    throw new Error("Reset token has already been used");
  }

  if (new Date() > resetToken.expiresAt) {
    throw new Error("Reset token has expired");
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    });

    await tx.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });
  });
}
