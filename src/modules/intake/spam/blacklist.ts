// src/modules/intake/spam/blacklist.ts
import { prisma } from "@/lib/prisma";

export interface BlacklistInput {
  tenantId: string;
  channel: string;
  sender: string;
  departmentId?: string;
}

export interface BlacklistResult {
  blocked: boolean;
  ruleId?: string;
}

export async function checkBlacklist(
  input: BlacklistInput
): Promise<BlacklistResult> {
  const rule = await prisma.spamRule.findFirst({
    where: {
      tenantId: input.tenantId,
      type: "BLACKLIST",
      identifier: input.sender,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (!rule) return { blocked: false };

  const channelOk =
    rule.channels.length === 0 || rule.channels.includes(input.channel);
  if (!channelOk) return { blocked: false };

  const deptOk =
    rule.departmentIds.length === 0 ||
    (input.departmentId
      ? rule.departmentIds.includes(input.departmentId)
      : true);
  if (!deptOk) return { blocked: false };

  return { blocked: true, ruleId: rule.id };
}
