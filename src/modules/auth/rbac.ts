import { Role } from "@prisma/client";
import { Permission } from "@/types";

const allPermissions: Permission[] = [
  "dashboard:view",
  "leads:view",
  "leads:create",
  "leads:edit",
  "leads:delete",
  "leads:assign",
  "leads:bulk",
  "conversations:view",
  "conversations:takeover",
  "follow-ups:view",
  "follow-ups:create",
  "callbacks:view",
  "callbacks:create",
  "departments:manage",
  "customers:view",
  "broadcasts:send",
  "reports:view",
  "users:manage",
  "settings:general",
  "settings:branding",
  "settings:pipeline",
  "settings:notifications",
  "settings:integrations",
  "settings:billing",
  "settings:ai",
  "settings:knowledge-base",
  "settings:channels",
  "settings:widget",
  "settings:analytics",
  "ai:metrics",
  "predictions:view",
  "predictions:accept",
];

const rolePermissions: Record<Role, Permission[]> = {
  SUPER_ADMIN: allPermissions,

  COMPANY_ADMIN: allPermissions.filter((p) => p !== "settings:billing"),

  DEPT_MANAGER: [
    "dashboard:view",
    "leads:view",
    "leads:create",
    "leads:edit",
    "leads:assign",
    "leads:bulk",
    "conversations:view",
    "conversations:takeover",
    "follow-ups:view",
    "follow-ups:create",
    "callbacks:view",
    "callbacks:create",
    "customers:view",
    "broadcasts:send",
    "reports:view",
    "settings:pipeline",
    "settings:knowledge-base",
    "settings:widget",
    "ai:metrics",
    "predictions:view",
    "predictions:accept",
  ],

  AGENT: [
    "dashboard:view",
    "leads:view",
    "leads:create",
    "leads:edit",
    "conversations:view",
    "conversations:takeover",
    "follow-ups:view",
    "follow-ups:create",
    "callbacks:view",
    "callbacks:create",
    "customers:view",
    "reports:view",
    "ai:metrics",
    "predictions:view",
    "predictions:accept",
  ],

  VIEWER: [
    "dashboard:view",
    "leads:view",
    "follow-ups:view",
    "callbacks:view",
    "customers:view",
    "reports:view",
    "ai:metrics",
    "predictions:view",
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = rolePermissions[role];
  if (!permissions) return false;
  return permissions.includes(permission);
}

export function getPermissions(role: Role): Permission[] {
  return rolePermissions[role] ?? [];
}
