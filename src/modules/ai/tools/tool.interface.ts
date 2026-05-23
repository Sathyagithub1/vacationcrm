import type { tenantPrisma } from "@/lib/prisma";
import type { ToolDefinition } from "../providers/provider.interface";

type TenantDb = ReturnType<typeof tenantPrisma>;

export interface ToolContext {
  db: TenantDb;
  tenantId: string;
  departmentId: string;
  conversationId: string;
  customerId?: string;
}

export interface ToolResult {
  success: boolean;
  data?: Record<string, unknown>;
  message: string;
}

export interface AITool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
