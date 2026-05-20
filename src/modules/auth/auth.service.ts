import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

const SALT_ROUNDS = 12;

interface CreateUserData {
  tenantId: string;
  email: string;
  password: string;
  name: string;
  role: Role;
  departmentId?: string | null;
  phone?: string | null;
}

export async function createUser(data: CreateUserData) {
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  return prisma.user.create({
    data: {
      tenantId: data.tenantId,
      email: data.email,
      passwordHash,
      name: data.name,
      role: data.role,
      departmentId: data.departmentId ?? null,
      phone: data.phone ?? null,
    },
  });
}

export async function verifyPassword(
  plaintext: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

export async function changePassword(
  userId: string,
  newPassword: string
): Promise<void> {
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
}
