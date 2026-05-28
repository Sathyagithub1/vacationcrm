import { Role } from "@prisma/client";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
  departmentId: string | null;
};

export type Permission =
  | "dashboard:view"
  | "leads:view"
  | "leads:create"
  | "leads:edit"
  | "leads:delete"
  | "leads:assign"
  | "leads:bulk"
  | "conversations:view"
  | "conversations:takeover"
  | "follow-ups:view"
  | "follow-ups:create"
  | "callbacks:view"
  | "callbacks:create"
  | "departments:manage"
  | "customers:view"
  | "broadcasts:send"
  | "reports:view"
  | "users:manage"
  | "settings:general"
  | "settings:branding"
  | "settings:pipeline"
  | "settings:notifications"
  | "settings:integrations"
  | "settings:billing"
  | "settings:ai"
  | "settings:knowledge-base"
  | "settings:channels"
  | "settings:widget"
  | "settings:analytics"
  | "settings:intake-forms"
  | "settings:assignment"
  | "settings:tours"
  | "settings:spam"
  | "ai:metrics"
  | "predictions:view"
  | "predictions:accept";
