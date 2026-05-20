# Holiday Delight CRM — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-tenant travel CRM with admin dashboard, lead management, follow-ups, notifications, conversations, and white-label system — self-hosted via Docker Compose.

**Architecture:** Next.js 15 modular monolith with separate WebSocket server and BullMQ worker containers. PostgreSQL with row-level tenant isolation via Prisma middleware. Redis for pub/sub, caching, and job queues.

**Tech Stack:** Next.js 15 (App Router), PostgreSQL, Prisma, NextAuth.js, Socket.io, BullMQ, Redis, Docker Compose, Nginx, Tailwind CSS, @react-pdf/renderer

**Spec:** `docs/superpowers/specs/2026-05-20-holiday-delight-crm-design.md`

**Project root:** `C:\Users\Sathyamoorthy V\Documents\Claude\Holiday Delight CRM`

**HARD RULE:** Zero dead features. Every button, link, CTA must have a working backend. If it can't be wired up in this task, don't render it.

---

## File Structure Overview

```
holiday-delight-crm/
├── docker-compose.yml
├── Dockerfile
├── Dockerfile.ws
├── Dockerfile.worker
├── nginx/
│   └── default.conf
├── scripts/
│   ├── seed.ts
│   ├── backup.sh
│   └── restore.sh
├── .env.example
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── app/
│   │   ├── layout.tsx                    # Root layout
│   │   ├── (auth)/
│   │   │   ├── layout.tsx                # Auth layout (no sidebar)
│   │   │   ├── login/page.tsx
│   │   │   ├── forgot-password/page.tsx
│   │   │   └── accept-invite/page.tsx
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx                # Dashboard layout (sidebar + header)
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── leads/
│   │   │   │   ├── page.tsx              # Lead list + pipeline board
│   │   │   │   └── [id]/page.tsx         # Lead detail
│   │   │   ├── conversations/page.tsx
│   │   │   ├── follow-ups/page.tsx
│   │   │   ├── callbacks/page.tsx
│   │   │   ├── departments/page.tsx
│   │   │   ├── customers/page.tsx
│   │   │   ├── reports/page.tsx
│   │   │   ├── broadcasts/page.tsx
│   │   │   ├── users/page.tsx
│   │   │   └── settings/
│   │   │       ├── page.tsx              # Redirects to general
│   │   │       ├── general/page.tsx
│   │   │       ├── branding/page.tsx
│   │   │       ├── departments/page.tsx
│   │   │       ├── pipeline/page.tsx
│   │   │       ├── notifications/page.tsx
│   │   │       └── integrations/page.tsx
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── leads/route.ts
│   │       ├── leads/[id]/route.ts
│   │       ├── customers/route.ts
│   │       ├── customers/[id]/route.ts
│   │       ├── conversations/route.ts
│   │       ├── conversations/[id]/route.ts
│   │       ├── conversations/[id]/messages/route.ts
│   │       ├── follow-ups/route.ts
│   │       ├── follow-ups/[id]/route.ts
│   │       ├── follow-up-rules/route.ts
│   │       ├── callbacks/route.ts
│   │       ├── callbacks/[id]/route.ts
│   │       ├── escalations/route.ts
│   │       ├── escalations/[id]/route.ts
│   │       ├── broadcasts/route.ts
│   │       ├── broadcasts/[id]/route.ts
│   │       ├── canned-responses/route.ts
│   │       ├── notifications/route.ts
│   │       ├── departments/route.ts
│   │       ├── departments/[id]/route.ts
│   │       ├── pipeline-stages/route.ts
│   │       ├── pipeline-stages/[id]/route.ts
│   │       ├── users/route.ts
│   │       ├── users/[id]/route.ts
│   │       ├── invitations/route.ts
│   │       ├── reports/route.ts
│   │       ├── uploads/route.ts
│   │       ├── widgets/route.ts
│   │       ├── widgets/[id]/route.ts
│   │       ├── widgets/data/route.ts
│   │       ├── audit-log/route.ts
│   │       └── search/route.ts
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.service.ts
│   │   │   ├── rbac.ts
│   │   │   ├── tenant.middleware.ts
│   │   │   ├── invitation.service.ts
│   │   │   └── password-reset.service.ts
│   │   ├── leads/
│   │   │   ├── leads.service.ts
│   │   │   ├── pipeline.service.ts
│   │   │   └── assignment.service.ts
│   │   ├── customers/
│   │   │   └── customers.service.ts
│   │   ├── conversations/
│   │   │   ├── chat.service.ts
│   │   │   └── canned-responses.service.ts
│   │   ├── follow-ups/
│   │   │   ├── follow-up.service.ts
│   │   │   ├── follow-up-rules.service.ts
│   │   │   └── scheduler.service.ts
│   │   ├── escalations/
│   │   │   └── escalation.service.ts
│   │   ├── broadcasts/
│   │   │   └── broadcast.service.ts
│   │   ├── notifications/
│   │   │   ├── notification.service.ts
│   │   │   └── channels/
│   │   │       ├── email.channel.ts
│   │   │       ├── sms.channel.ts
│   │   │       ├── whatsapp.channel.ts
│   │   │       └── in-app.channel.ts
│   │   ├── analytics/
│   │   │   └── reports.service.ts
│   │   ├── audit/
│   │   │   └── audit.service.ts
│   │   └── white-label/
│   │       ├── theme.service.ts
│   │       └── branding.service.ts
│   ├── components/
│   │   ├── ui/
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── select.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── card.tsx
│   │   │   ├── table.tsx
│   │   │   ├── modal.tsx
│   │   │   ├── dropdown.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── toast.tsx
│   │   │   ├── avatar.tsx
│   │   │   ├── pagination.tsx
│   │   │   ├── date-picker.tsx
│   │   │   ├── color-picker.tsx
│   │   │   ├── file-upload.tsx
│   │   │   └── loading.tsx
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   ├── header.tsx
│   │   │   ├── page-header.tsx
│   │   │   └── sidebar-nav-item.tsx
│   │   ├── leads/
│   │   │   ├── lead-table.tsx
│   │   │   ├── lead-card.tsx
│   │   │   ├── lead-detail-panel.tsx
│   │   │   ├── lead-form.tsx
│   │   │   ├── pipeline-board.tsx
│   │   │   ├── pipeline-column.tsx
│   │   │   └── activity-timeline.tsx
│   │   ├── chat/
│   │   │   ├── conversation-list.tsx
│   │   │   ├── chat-thread.tsx
│   │   │   ├── message-bubble.tsx
│   │   │   ├── chat-input.tsx
│   │   │   └── customer-info-panel.tsx
│   │   ├── dashboard/
│   │   │   ├── widget-grid.tsx
│   │   │   ├── widget-card.tsx
│   │   │   ├── widget-builder.tsx
│   │   │   ├── stat-counter-widget.tsx
│   │   │   ├── bar-chart-widget.tsx
│   │   │   ├── pie-chart-widget.tsx
│   │   │   ├── progress-widget.tsx
│   │   │   ├── list-widget.tsx
│   │   │   ├── line-chart-widget.tsx
│   │   │   ├── table-widget.tsx
│   │   │   ├── funnel-widget.tsx
│   │   │   └── activity-feed-widget.tsx
│   │   └── charts/
│   │       ├── bar-chart.tsx
│   │       ├── line-chart.tsx
│   │       ├── pie-chart.tsx
│   │       └── funnel-chart.tsx
│   ├── lib/
│   │   ├── prisma.ts
│   │   ├── redis.ts
│   │   ├── socket.ts
│   │   ├── queue.ts
│   │   ├── uploads.ts
│   │   ├── auth-options.ts
│   │   ├── rate-limit.ts
│   │   ├── search.ts
│   │   └── utils.ts
│   ├── types/
│   │   └── index.ts
│   ├── hooks/
│   │   ├── use-socket.ts
│   │   ├── use-tenant.ts
│   │   └── use-debounce.ts
│   ├── workers/
│   │   ├── index.ts
│   │   ├── follow-up.worker.ts
│   │   ├── follow-up-rules.worker.ts
│   │   ├── notification.worker.ts
│   │   ├── callback.worker.ts
│   │   ├── broadcast.worker.ts
│   │   └── future-interest.worker.ts
│   └── ws-server/
│       ├── index.ts
│       ├── auth.ts
│       └── handlers/
│           ├── chat.handler.ts
│           ├── presence.handler.ts
│           └── typing.handler.ts
└── __tests__/
    ├── modules/
    │   ├── auth.test.ts
    │   ├── leads.test.ts
    │   ├── customers.test.ts
    │   ├── follow-ups.test.ts
    │   ├── notifications.test.ts
    │   ├── broadcasts.test.ts
    │   └── pipeline.test.ts
    ├── api/
    │   ├── leads.test.ts
    │   ├── departments.test.ts
    │   └── users.test.ts
    └── setup.ts
```

---

## Task Group 1: Project Foundation & Infrastructure

### Task 1: Initialize Next.js Project & Dependencies

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.env.example`, `.gitignore`, `src/app/layout.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Initialize Next.js with TypeScript and Tailwind**

```bash
cd "C:\Users\Sathyamoorthy V\Documents\Claude\Holiday Delight CRM"
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack
```

Select defaults. This creates the base Next.js 15 project.

- [ ] **Step 2: Install core dependencies**

```bash
npm install prisma @prisma/client next-auth@beta @auth/prisma-adapter bcryptjs jsonwebtoken socket.io socket.io-client bullmq ioredis uuid zod date-fns recharts @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities lucide-react clsx tailwind-merge class-variance-authority
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D @types/bcryptjs @types/jsonwebtoken @types/uuid vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom prisma tsx
```

- [ ] **Step 4: Create .env.example**

```env
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/holiday_delight_crm"

# Redis
REDIS_URL="redis://localhost:6379"

# Auth
NEXTAUTH_SECRET="your-secret-key-min-32-chars"
NEXTAUTH_URL="http://localhost:3000"

# Super Admin (first-time setup)
SUPER_ADMIN_EMAIL="admin@holidaydelight.com"
SUPER_ADMIN_PASSWORD="change-me-immediately"

# SMTP (Email notifications)
SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""

# SMS Gateway
SMS_API_KEY=""
SMS_API_URL=""

# WhatsApp
WHATSAPP_API_KEY=""
WHATSAPP_API_URL=""

# Backup
BACKUP_CRON="0 2 * * *"
```

- [ ] **Step 5: Create .gitignore additions**

Append to existing `.gitignore`:
```
.env
.env.local
uploads/
backups/
.superpowers/
unpacked/
node_modules/
```

- [ ] **Step 6: Create utility lib file `src/lib/utils.ts`**

```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateToken(length: number = 64): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

export function formatDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
```

- [ ] **Step 7: Verify project builds**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git init && git add -A && git commit -m "feat: initialize Next.js 15 project with dependencies"
```

---

### Task 2: Prisma Schema & Database

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/prisma.ts`

- [ ] **Step 1: Create Prisma schema with all 18 tables**

Create `prisma/schema.prisma` with the full schema from spec Section 6. All enums, all relations, all JSON fields. Include:
- `Tenant`, `User`, `Invitation`, `PasswordResetToken`, `Department`, `PipelineStage`, `Customer`, `Lead`, `LeadActivity`, `FollowUp`, `FollowUpRule`, `Callback`, `Conversation`, `Message`, `Notification`, `Escalation`, `Broadcast`, `BroadcastRecipient`, `CannedResponse`, `AuditLog`, `FileUpload`, `DashboardWidget`
- All enums: `Role`, `LeadSource`, `LeadPriority`, `LeadActivityType`, `FollowUpType`, `FollowUpStatus`, `CallbackStatus`, `ConversationChannel`, `ConversationStatus`, `MessageSenderType`, `MessageType`, `NotificationType`, `EscalationReason`, `EscalationStatus`, `BroadcastChannel`, `BroadcastTargetType`, `BroadcastStatus`, `BroadcastRecipientStatus`, `WidgetType`, `WidgetSize`, `TriggerType`, `SubscriptionStatus`
- `@@unique([tenantId, mobile])` on Customer
- `@@index` on all `tenant_id` columns

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  SUPER_ADMIN
  COMPANY_ADMIN
  DEPT_MANAGER
  AGENT
  VIEWER
}

enum LeadSource {
  WHATSAPP
  WEBSITE
  FB
  IG
  MANUAL
}

enum LeadPriority {
  LOW
  MEDIUM
  HIGH
  VIP
}

enum LeadActivityType {
  NOTE
  STAGE_CHANGE
  ASSIGNMENT
  CALL
  EMAIL
  SYSTEM
}

enum FollowUpType {
  REMINDER
  QUOTATION
  DOCUMENT
  PAYMENT
  RE_ENGAGE
}

enum FollowUpStatus {
  PENDING
  SENT
  COMPLETED
  CANCELLED
}

enum TriggerType {
  STAGE_CHANGE
  LEAD_CREATED
  LEAD_INACTIVE
}

enum CallbackStatus {
  SCHEDULED
  COMPLETED
  MISSED
}

enum ConversationChannel {
  MANUAL
}

enum ConversationStatus {
  ACTIVE
  HUMAN_TAKEOVER
  CLOSED
}

enum MessageSenderType {
  CUSTOMER
  BOT
  AGENT
}

enum MessageType {
  TEXT
  IMAGE
  FILE
}

enum NotificationType {
  LEAD_ASSIGNED
  FOLLOW_UP_DUE
  ESCALATION
  CALLBACK
  NEW_MESSAGE
}

enum EscalationReason {
  REPEATED_FAILURE
  COMPLEX_REQUEST
  PAYMENT_ISSUE
  TECHNICAL_ISSUE
  VIP_CLIENT
  CUSTOMER_REQUEST
}

enum EscalationStatus {
  OPEN
  ACKNOWLEDGED
  RESOLVED
  CLOSED
}

enum BroadcastChannel {
  EMAIL
  SMS
  WHATSAPP
  IN_APP
}

enum BroadcastTargetType {
  ALL_CUSTOMERS
  DEPARTMENT
  STAGE
  CUSTOM_FILTER
}

enum BroadcastStatus {
  DRAFT
  SCHEDULED
  SENDING
  SENT
  FAILED
}

enum BroadcastRecipientStatus {
  PENDING
  DELIVERED
  FAILED
}

enum WidgetType {
  STAT_COUNTER
  BAR_CHART
  PIE
  PROGRESS
  LIST
  LINE
  TABLE
  FUNNEL
  ACTIVITY
}

enum WidgetSize {
  SMALL   // 1x1
  MEDIUM  // 2x1
  LARGE   // 2x2
}

enum SubscriptionStatus {
  ACTIVE
  TRIAL
  SUSPENDED
  CANCELLED
}

model Tenant {
  id                   String             @id @default(uuid())
  name                 String
  slug                 String             @unique
  domain               String?            @unique
  logoUrl              String?            @map("logo_url")
  faviconUrl           String?            @map("favicon_url")
  productName          String             @default("Holiday Delight CRM") @map("product_name")
  themeConfig          Json               @default("{}") @map("theme_config")
  loginBgUrl           String?            @map("login_bg_url")
  emailTemplateConfig  Json               @default("{}") @map("email_template_config")
  notificationSettings Json               @default("{}") @map("notification_settings")
  timezone             String             @default("Asia/Kolkata")
  currency             String             @default("INR")
  address              String?
  subscriptionStatus   SubscriptionStatus @default(ACTIVE) @map("subscription_status")
  createdAt            DateTime           @default(now()) @map("created_at")
  updatedAt            DateTime           @updatedAt @map("updated_at")

  users              User[]
  departments        Department[]
  pipelineStages     PipelineStage[]
  customers          Customer[]
  leads              Lead[]
  leadActivities     LeadActivity[]
  followUps          FollowUp[]
  followUpRules      FollowUpRule[]
  callbacks          Callback[]
  conversations      Conversation[]
  messages           Message[]
  notifications      Notification[]
  escalations        Escalation[]
  broadcasts         Broadcast[]
  cannedResponses    CannedResponse[]
  auditLogs          AuditLog[]
  fileUploads        FileUpload[]
  dashboardWidgets   DashboardWidget[]
  invitations        Invitation[]

  @@map("tenants")
}

model User {
  id                      String    @id @default(uuid())
  tenantId                String    @map("tenant_id")
  email                   String
  passwordHash            String    @map("password_hash")
  name                    String
  phone                   String?
  avatarUrl               String?   @map("avatar_url")
  role                    Role
  departmentId            String?   @map("department_id")
  notificationPreferences Json      @default("{}") @map("notification_preferences")
  isActive                Boolean   @default(true) @map("is_active")
  lastSeenAt              DateTime? @map("last_seen_at")
  createdAt               DateTime  @default(now()) @map("created_at")

  tenant     Tenant      @relation(fields: [tenantId], references: [id])
  department Department? @relation(fields: [departmentId], references: [id])

  assignedLeads       Lead[]          @relation("AssignedAgent")
  leadActivities      LeadActivity[]
  followUps           FollowUp[]      @relation("AssignedFollowUps")
  callbacks           Callback[]      @relation("AssignedCallbacks")
  conversations       Conversation[]  @relation("AssignedConversations")
  notifications       Notification[]
  escalationsFrom     Escalation[]    @relation("EscalatedFrom")
  escalationsTo       Escalation[]    @relation("EscalatedTo")
  broadcasts          Broadcast[]
  cannedResponses     CannedResponse[]
  fileUploads         FileUpload[]
  invitationsSent     Invitation[]
  auditLogs           AuditLog[]
  passwordResetTokens PasswordResetToken[]

  @@unique([tenantId, email])
  @@index([tenantId])
  @@map("users")
}

model Invitation {
  id           String    @id @default(uuid())
  tenantId     String    @map("tenant_id")
  email        String
  role         Role
  departmentId String?   @map("department_id")
  invitedBy    String    @map("invited_by")
  token        String    @unique
  expiresAt    DateTime  @map("expires_at")
  acceptedAt   DateTime? @map("accepted_at")
  createdAt    DateTime  @default(now()) @map("created_at")

  tenant  Tenant @relation(fields: [tenantId], references: [id])
  inviter User   @relation(fields: [invitedBy], references: [id])

  @@index([tenantId])
  @@index([token])
  @@map("invitations")
}

model PasswordResetToken {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  token     String    @unique
  expiresAt DateTime  @map("expires_at")
  usedAt    DateTime? @map("used_at")
  createdAt DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id])

  @@index([token])
  @@map("password_reset_tokens")
}

model Department {
  id                 String  @id @default(uuid())
  tenantId           String  @map("tenant_id")
  name               String
  slug               String
  description        String?
  icon               String?
  color              String?
  contactEmail       String? @map("contact_email")
  contactPhone       String? @map("contact_phone")
  websiteUrl         String? @map("website_url")
  knowledgeBaseConfig Json    @default("{}") @map("knowledge_base_config")
  isActive           Boolean @default(true) @map("is_active")
  createdAt          DateTime @default(now()) @map("created_at")

  tenant         Tenant          @relation(fields: [tenantId], references: [id])
  users          User[]
  pipelineStages PipelineStage[]
  leads          Lead[]
  followUpRules  FollowUpRule[]
  callbacks      Callback[]
  cannedResponses CannedResponse[]

  @@unique([tenantId, slug])
  @@index([tenantId])
  @@map("departments")
}

model PipelineStage {
  id           String  @id @default(uuid())
  tenantId     String  @map("tenant_id")
  departmentId String? @map("department_id")
  name         String
  slug         String
  color        String  @default("#6B7280")
  position     Int
  isDefault    Boolean @default(false) @map("is_default")
  isSystem     Boolean @default(false) @map("is_system")
  createdAt    DateTime @default(now()) @map("created_at")

  tenant     Tenant      @relation(fields: [tenantId], references: [id])
  department Department? @relation(fields: [departmentId], references: [id])
  leads      Lead[]

  @@unique([tenantId, slug])
  @@index([tenantId])
  @@map("pipeline_stages")
}

model Customer {
  id             String    @id @default(uuid())
  tenantId       String    @map("tenant_id")
  name           String
  email          String?
  mobile         String
  alternatePhone String?   @map("alternate_phone")
  address        String?
  notes          String?
  totalLeads     Int       @default(0) @map("total_leads")
  lastLeadDate   DateTime? @map("last_lead_date")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  tenant              Tenant               @relation(fields: [tenantId], references: [id])
  leads               Lead[]
  broadcastRecipients BroadcastRecipient[]

  @@unique([tenantId, mobile])
  @@index([tenantId])
  @@map("customers")
}

model Lead {
  id                 String       @id @default(uuid())
  tenantId           String       @map("tenant_id")
  departmentId       String       @map("department_id")
  customerId         String       @map("customer_id")
  destination        String?
  travelDate         DateTime?    @map("travel_date")
  numPassengers      Int?         @map("num_passengers")
  specialRequirement String?      @map("special_requirement")
  source             LeadSource   @default(MANUAL)
  stageId            String       @map("stage_id")
  assignedTo         String?      @map("assigned_to")
  priority           LeadPriority @default(MEDIUM)
  isFutureInterest   Boolean      @default(false) @map("is_future_interest")
  createdAt          DateTime     @default(now()) @map("created_at")
  updatedAt          DateTime     @updatedAt @map("updated_at")

  tenant       Tenant         @relation(fields: [tenantId], references: [id])
  department   Department     @relation(fields: [departmentId], references: [id])
  customer     Customer       @relation(fields: [customerId], references: [id])
  stage        PipelineStage  @relation(fields: [stageId], references: [id])
  assignedAgent User?         @relation("AssignedAgent", fields: [assignedTo], references: [id])

  activities    LeadActivity[]
  followUps     FollowUp[]
  callbacks     Callback[]
  conversations Conversation[]
  escalations   Escalation[]
  fileUploads   FileUpload[]

  @@index([tenantId])
  @@index([tenantId, departmentId])
  @@index([tenantId, stageId])
  @@index([tenantId, assignedTo])
  @@map("leads")
}

model LeadActivity {
  id        String           @id @default(uuid())
  tenantId  String           @map("tenant_id")
  leadId    String           @map("lead_id")
  userId    String?          @map("user_id")
  type      LeadActivityType
  content   Json             @default("{}")
  createdAt DateTime         @default(now()) @map("created_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])
  lead   Lead   @relation(fields: [leadId], references: [id])
  user   User?  @relation(fields: [userId], references: [id])

  @@index([tenantId])
  @@index([leadId])
  @@map("lead_activities")
}

model FollowUp {
  id              String         @id @default(uuid())
  tenantId        String         @map("tenant_id")
  leadId          String         @map("lead_id")
  assignedTo      String         @map("assigned_to")
  type            FollowUpType
  scheduledAt     DateTime       @map("scheduled_at")
  completedAt     DateTime?      @map("completed_at")
  status          FollowUpStatus @default(PENDING)
  messageTemplate String?        @map("message_template")
  createdAt       DateTime       @default(now()) @map("created_at")

  tenant        Tenant @relation(fields: [tenantId], references: [id])
  lead          Lead   @relation(fields: [leadId], references: [id])
  assignedAgent User   @relation("AssignedFollowUps", fields: [assignedTo], references: [id])

  @@index([tenantId])
  @@index([tenantId, status, scheduledAt])
  @@map("follow_ups")
}

model FollowUpRule {
  id              String       @id @default(uuid())
  tenantId        String       @map("tenant_id")
  departmentId    String?      @map("department_id")
  triggerType     TriggerType  @map("trigger_type")
  triggerValue    String       @map("trigger_value")
  followUpType    FollowUpType @map("follow_up_type")
  delayHours      Int          @map("delay_hours")
  messageTemplate String?      @map("message_template")
  isActive        Boolean      @default(true) @map("is_active")
  createdAt       DateTime     @default(now()) @map("created_at")

  tenant     Tenant      @relation(fields: [tenantId], references: [id])
  department Department? @relation(fields: [departmentId], references: [id])

  @@index([tenantId])
  @@map("follow_up_rules")
}

model Callback {
  id            String         @id @default(uuid())
  tenantId      String         @map("tenant_id")
  leadId        String         @map("lead_id")
  departmentId  String         @map("department_id")
  assignedTo    String?        @map("assigned_to")
  preferredTime DateTime       @map("preferred_time")
  status        CallbackStatus @default(SCHEDULED)
  notes         String?
  createdAt     DateTime       @default(now()) @map("created_at")

  tenant        Tenant     @relation(fields: [tenantId], references: [id])
  lead          Lead       @relation(fields: [leadId], references: [id])
  department    Department @relation(fields: [departmentId], references: [id])
  assignedAgent User?      @relation("AssignedCallbacks", fields: [assignedTo], references: [id])

  @@index([tenantId])
  @@map("callbacks")
}

model Conversation {
  id              String             @id @default(uuid())
  tenantId        String             @map("tenant_id")
  leadId          String             @map("lead_id")
  channel         ConversationChannel @default(MANUAL)
  status          ConversationStatus  @default(ACTIVE)
  assignedAgentId String?            @map("assigned_agent_id")
  startedAt       DateTime           @default(now()) @map("started_at")
  closedAt        DateTime?          @map("closed_at")

  tenant        Tenant   @relation(fields: [tenantId], references: [id])
  lead          Lead     @relation(fields: [leadId], references: [id])
  assignedAgent User?    @relation("AssignedConversations", fields: [assignedAgentId], references: [id])
  messages      Message[]
  escalations   Escalation[]

  @@index([tenantId])
  @@map("conversations")
}

model Message {
  id             String            @id @default(uuid())
  tenantId       String            @map("tenant_id")
  conversationId String            @map("conversation_id")
  senderType     MessageSenderType @map("sender_type")
  senderId       String?           @map("sender_id")
  content        String
  messageType    MessageType       @default(TEXT) @map("message_type")
  fileUrl        String?           @map("file_url")
  createdAt      DateTime          @default(now()) @map("created_at")

  tenant       Tenant       @relation(fields: [tenantId], references: [id])
  conversation Conversation @relation(fields: [conversationId], references: [id])

  @@index([tenantId])
  @@index([conversationId])
  @@map("messages")
}

model Notification {
  id           String           @id @default(uuid())
  tenantId     String           @map("tenant_id")
  userId       String           @map("user_id")
  type         NotificationType
  title        String
  body         String
  data         Json             @default("{}")
  channelsSent Json             @default("[]") @map("channels_sent")
  readAt       DateTime?        @map("read_at")
  createdAt    DateTime         @default(now()) @map("created_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])
  user   User   @relation(fields: [userId], references: [id])

  @@index([tenantId])
  @@index([userId, readAt])
  @@map("notifications")
}

model Escalation {
  id              String           @id @default(uuid())
  tenantId        String           @map("tenant_id")
  leadId          String           @map("lead_id")
  conversationId  String?          @map("conversation_id")
  reason          EscalationReason
  escalatedFrom   String           @map("escalated_from")
  escalatedTo     String           @map("escalated_to")
  status          EscalationStatus @default(OPEN)
  notes           String?
  resolvedAt      DateTime?        @map("resolved_at")
  createdAt       DateTime         @default(now()) @map("created_at")

  tenant       Tenant        @relation(fields: [tenantId], references: [id])
  lead         Lead          @relation(fields: [leadId], references: [id])
  conversation Conversation? @relation(fields: [conversationId], references: [id])
  fromUser     User          @relation("EscalatedFrom", fields: [escalatedFrom], references: [id])
  toUser       User          @relation("EscalatedTo", fields: [escalatedTo], references: [id])

  @@index([tenantId])
  @@map("escalations")
}

model Broadcast {
  id              String              @id @default(uuid())
  tenantId        String              @map("tenant_id")
  createdBy       String              @map("created_by")
  title           String
  content         String
  channel         BroadcastChannel
  targetType      BroadcastTargetType @map("target_type")
  targetFilter    Json                @default("{}") @map("target_filter")
  status          BroadcastStatus     @default(DRAFT)
  scheduledAt     DateTime?           @map("scheduled_at")
  sentAt          DateTime?           @map("sent_at")
  totalRecipients Int                 @default(0) @map("total_recipients")
  deliveredCount  Int                 @default(0) @map("delivered_count")
  failedCount     Int                 @default(0) @map("failed_count")
  createdAt       DateTime            @default(now()) @map("created_at")

  tenant     Tenant               @relation(fields: [tenantId], references: [id])
  creator    User                 @relation(fields: [createdBy], references: [id])
  recipients BroadcastRecipient[]

  @@index([tenantId])
  @@map("broadcasts")
}

model BroadcastRecipient {
  id           String                   @id @default(uuid())
  broadcastId  String                   @map("broadcast_id")
  customerId   String                   @map("customer_id")
  status       BroadcastRecipientStatus @default(PENDING)
  deliveredAt  DateTime?                @map("delivered_at")
  errorMessage String?                  @map("error_message")

  broadcast Broadcast @relation(fields: [broadcastId], references: [id])
  customer  Customer  @relation(fields: [customerId], references: [id])

  @@index([broadcastId])
  @@map("broadcast_recipients")
}

model CannedResponse {
  id           String   @id @default(uuid())
  tenantId     String   @map("tenant_id")
  departmentId String?  @map("department_id")
  title        String
  content      String
  shortcut     String?
  createdBy    String   @map("created_by")
  isActive     Boolean  @default(true) @map("is_active")
  createdAt    DateTime @default(now()) @map("created_at")

  tenant     Tenant      @relation(fields: [tenantId], references: [id])
  department Department? @relation(fields: [departmentId], references: [id])
  creator    User        @relation(fields: [createdBy], references: [id])

  @@index([tenantId])
  @@map("canned_responses")
}

model AuditLog {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  userId     String?  @map("user_id")
  action     String
  entityType String?  @map("entity_type")
  entityId   String?  @map("entity_id")
  oldValue   Json?    @map("old_value")
  newValue   Json?    @map("new_value")
  ipAddress  String?  @map("ip_address")
  userAgent  String?  @map("user_agent")
  createdAt  DateTime @default(now()) @map("created_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])
  user   User?  @relation(fields: [userId], references: [id])

  @@index([tenantId])
  @@index([tenantId, action])
  @@map("audit_log")
}

model FileUpload {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  leadId     String?  @map("lead_id")
  uploadedBy String   @map("uploaded_by")
  fileName   String   @map("file_name")
  filePath   String   @map("file_path")
  fileType   String   @map("file_type")
  fileSize   Int      @map("file_size")
  createdAt  DateTime @default(now()) @map("created_at")

  tenant   Tenant @relation(fields: [tenantId], references: [id])
  lead     Lead?  @relation(fields: [leadId], references: [id])
  uploader User   @relation(fields: [uploadedBy], references: [id])

  @@index([tenantId])
  @@map("file_uploads")
}

model DashboardWidget {
  id              String     @id @default(uuid())
  tenantId        String     @map("tenant_id")
  userId          String     @map("user_id")
  widgetType      WidgetType @map("widget_type")
  title           String
  dataSource      String     @map("data_source")
  filters         Json       @default("{}")
  size            WidgetSize @default(SMALL)
  position        Json       @default("{}")
  refreshInterval Int        @default(300) @map("refresh_interval")
  config          Json       @default("{}")
  createdAt       DateTime   @default(now()) @map("created_at")
  updatedAt       DateTime   @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@index([tenantId, userId])
  @@map("dashboard_widgets")
}
```

- [ ] **Step 2: Create Prisma client with tenant middleware `src/lib/prisma.ts`**

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Tenant-scoped Prisma client
export function tenantPrisma(tenantId: string) {
  return prisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        if (model === "Tenant") return query(args);

        const modelsWithTenant = [
          "User", "Invitation", "Department", "PipelineStage", "Customer",
          "Lead", "LeadActivity", "FollowUp", "FollowUpRule", "Callback",
          "Conversation", "Message", "Notification", "Escalation",
          "Broadcast", "CannedResponse", "AuditLog", "FileUpload", "DashboardWidget",
        ];

        if (!model || !modelsWithTenant.includes(model)) return query(args);

        if (["create", "createMany"].includes(operation)) {
          if ("data" in args) {
            if (Array.isArray(args.data)) {
              args.data = args.data.map((d: any) => ({ ...d, tenantId }));
            } else {
              (args.data as any).tenantId = tenantId;
            }
          }
        }

        if (["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy",
             "update", "updateMany", "delete", "deleteMany", "upsert"].includes(operation)) {
          if ("where" in args) {
            (args.where as any).tenantId = tenantId;
          } else {
            (args as any).where = { tenantId };
          }
        }

        return query(args);
      },
    },
  });
}
```

- [ ] **Step 3: Generate Prisma client and run migration**

```bash
npx prisma generate
npx prisma migrate dev --name init
```

Expected: Migration creates all 22 tables with proper indices.

- [ ] **Step 4: Commit**

```bash
git add prisma/ src/lib/prisma.ts && git commit -m "feat: add Prisma schema with 22 tables and tenant middleware"
```

---

### Task 3: Docker Compose & Infrastructure

**Files:**
- Create: `docker-compose.yml`, `Dockerfile`, `Dockerfile.ws`, `Dockerfile.worker`, `nginx/default.conf`, `scripts/backup.sh`, `scripts/restore.sh`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
version: "3.9"

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - uploads:/app/uploads
    restart: unless-stopped

  ws-server:
    build:
      context: .
      dockerfile: Dockerfile.ws
    ports:
      - "3001:3001"
    env_file: .env
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: holiday_delight_crm
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - uploads:/uploads:ro
    depends_on:
      - app
      - ws-server
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
  uploads:
```

- [ ] **Step 2: Create `Dockerfile` (Next.js app)**

```dockerfile
FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
```

- [ ] **Step 3: Create `Dockerfile.ws` (WebSocket server)**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ws-server ./src/ws-server
COPY src/lib/redis.ts ./src/lib/redis.ts
COPY tsconfig.json ./
RUN npx tsx src/ws-server/index.ts --dry-run 2>/dev/null || true
EXPOSE 3001
CMD ["npx", "tsx", "src/ws-server/index.ts"]
```

- [ ] **Step 4: Create `Dockerfile.worker` (BullMQ worker)**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY src/workers ./src/workers
COPY src/modules ./src/modules
COPY src/lib ./src/lib
COPY tsconfig.json ./
EXPOSE 0
CMD ["npx", "tsx", "src/workers/index.ts"]
```

- [ ] **Step 5: Create `nginx/default.conf`**

```nginx
upstream nextjs {
    server app:3000;
}

upstream websocket {
    server ws-server:3001;
}

server {
    listen 80;
    server_name _;

    client_max_body_size 10M;

    location / {
        proxy_pass http://nextjs;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws/ {
        proxy_pass http://websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /uploads/ {
        alias /uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

- [ ] **Step 6: Create backup/restore scripts**

`scripts/backup.sh`:
```bash
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/postgres"
mkdir -p "$BACKUP_DIR"
docker compose exec -T postgres pg_dump -U postgres holiday_delight_crm | gzip > "$BACKUP_DIR/backup_$TIMESTAMP.sql.gz"
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete
echo "Backup completed: backup_$TIMESTAMP.sql.gz"
```

`scripts/restore.sh`:
```bash
#!/bin/bash
if [ -z "$1" ]; then echo "Usage: ./restore.sh <backup_file>"; exit 1; fi
gunzip -c "$1" | docker compose exec -T postgres psql -U postgres holiday_delight_crm
echo "Restore completed from: $1"
```

- [ ] **Step 7: Update `next.config.ts` for standalone output**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml Dockerfile* nginx/ scripts/ next.config.ts && git commit -m "feat: add Docker Compose infrastructure with Nginx, backup/restore"
```

---

### Task 4: Auth System (NextAuth + RBAC)

**Files:**
- Create: `src/lib/auth-options.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/rbac.ts`, `src/modules/auth/invitation.service.ts`, `src/modules/auth/password-reset.service.ts`, `src/types/index.ts`, `src/types/next-auth.d.ts`

- [ ] **Step 1: Create types `src/types/index.ts`**

```typescript
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
  | "leads:view" | "leads:create" | "leads:edit" | "leads:delete" | "leads:assign" | "leads:bulk"
  | "conversations:view" | "conversations:takeover"
  | "follow-ups:view" | "follow-ups:create"
  | "callbacks:view" | "callbacks:create"
  | "departments:manage"
  | "customers:view"
  | "broadcasts:send"
  | "reports:view"
  | "users:manage"
  | "settings:general" | "settings:branding" | "settings:pipeline" | "settings:notifications" | "settings:integrations" | "settings:billing";
```

- [ ] **Step 2: Create NextAuth type extensions `src/types/next-auth.d.ts`**

```typescript
import { Role } from "@prisma/client";
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      tenantId: string;
      departmentId: string | null;
    };
  }

  interface User {
    id: string;
    role: Role;
    tenantId: string;
    departmentId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    tenantId: string;
    departmentId: string | null;
  }
}
```

- [ ] **Step 3: Create RBAC module `src/modules/auth/rbac.ts`**

Full permission matrix from spec Section 5. Maps each role to allowed permissions, with scope qualifiers (all, own_dept, assigned, read_only).

```typescript
import { Role } from "@prisma/client";
import type { Permission } from "@/types";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: [
    "dashboard:view", "leads:view", "leads:create", "leads:edit", "leads:delete",
    "leads:assign", "leads:bulk", "conversations:view", "conversations:takeover",
    "follow-ups:view", "follow-ups:create", "callbacks:view", "callbacks:create",
    "departments:manage", "customers:view", "broadcasts:send", "reports:view",
    "users:manage", "settings:general", "settings:branding", "settings:pipeline",
    "settings:notifications", "settings:integrations", "settings:billing",
  ],
  COMPANY_ADMIN: [
    "dashboard:view", "leads:view", "leads:create", "leads:edit", "leads:delete",
    "leads:assign", "leads:bulk", "conversations:view", "conversations:takeover",
    "follow-ups:view", "follow-ups:create", "callbacks:view", "callbacks:create",
    "departments:manage", "customers:view", "broadcasts:send", "reports:view",
    "users:manage", "settings:general", "settings:branding", "settings:pipeline",
    "settings:notifications", "settings:integrations",
  ],
  DEPT_MANAGER: [
    "dashboard:view", "leads:view", "leads:create", "leads:edit", "leads:assign",
    "leads:bulk", "conversations:view", "conversations:takeover",
    "follow-ups:view", "follow-ups:create", "callbacks:view", "callbacks:create",
    "customers:view", "broadcasts:send", "reports:view", "settings:pipeline",
  ],
  AGENT: [
    "dashboard:view", "leads:view", "leads:create", "leads:edit",
    "conversations:view", "conversations:takeover",
    "follow-ups:view", "follow-ups:create", "callbacks:view", "callbacks:create",
    "customers:view", "reports:view",
  ],
  VIEWER: [
    "dashboard:view", "leads:view", "follow-ups:view", "callbacks:view",
    "customers:view", "reports:view",
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function getPermissions(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
```

- [ ] **Step 4: Create auth options `src/lib/auth-options.ts`**

```typescript
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findFirst({
          where: { email: credentials.email, isActive: true },
        });
        if (!user) return null;

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastSeenAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          departmentId: user.departmentId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.tenantId = user.tenantId;
        token.departmentId = user.departmentId;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.tenantId = token.tenantId;
      session.user.departmentId = token.departmentId;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
};
```

- [ ] **Step 5: Create NextAuth route `src/app/api/auth/[...nextauth]/route.ts`**

```typescript
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth-options";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

- [ ] **Step 6: Create auth service `src/modules/auth/auth.service.ts`**

```typescript
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

export async function createUser(data: {
  tenantId: string;
  email: string;
  password: string;
  name: string;
  role: Role;
  departmentId?: string;
  phone?: string;
}) {
  const passwordHash = await bcrypt.hash(data.password, 12);
  return prisma.user.create({
    data: {
      tenantId: data.tenantId,
      email: data.email,
      passwordHash,
      name: data.name,
      role: data.role,
      departmentId: data.departmentId,
      phone: data.phone,
    },
  });
}

export async function verifyPassword(plaintext: string, hash: string) {
  return bcrypt.compare(plaintext, hash);
}

export async function changePassword(userId: string, newPassword: string) {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  return prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
}
```

- [ ] **Step 7: Create invitation service `src/modules/auth/invitation.service.ts`**

```typescript
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import { generateToken } from "@/lib/utils";

export async function createInvitation(data: {
  tenantId: string;
  email: string;
  role: Role;
  departmentId?: string;
  invitedBy: string;
}) {
  const token = generateToken(64);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  return prisma.invitation.create({
    data: {
      tenantId: data.tenantId,
      email: data.email,
      role: data.role,
      departmentId: data.departmentId,
      invitedBy: data.invitedBy,
      token,
      expiresAt,
    },
  });
}

export async function acceptInvitation(token: string, name: string, password: string) {
  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (!invitation) throw new Error("Invalid invitation");
  if (invitation.acceptedAt) throw new Error("Invitation already used");
  if (invitation.expiresAt < new Date()) throw new Error("Invitation expired");

  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.hash(password, 12);

  const [user] = await prisma.$transaction([
    prisma.user.create({
      data: {
        tenantId: invitation.tenantId,
        email: invitation.email,
        passwordHash,
        name,
        role: invitation.role,
        departmentId: invitation.departmentId,
      },
    }),
    prisma.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    }),
  ]);

  return user;
}
```

- [ ] **Step 8: Create password reset service `src/modules/auth/password-reset.service.ts`**

```typescript
import { prisma } from "@/lib/prisma";
import { generateToken } from "@/lib/utils";

export async function createPasswordReset(email: string) {
  const user = await prisma.user.findFirst({ where: { email, isActive: true } });
  if (!user) return null; // Don't reveal if user exists

  const token = generateToken(64);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.passwordResetToken.create({
    data: { userId: user.id, token, expiresAt },
  });

  return { token, user };
}

export async function resetPassword(token: string, newPassword: string) {
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!resetToken) throw new Error("Invalid token");
  if (resetToken.usedAt) throw new Error("Token already used");
  if (resetToken.expiresAt < new Date()) throw new Error("Token expired");

  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
  ]);
}
```

- [ ] **Step 9: Create tenant middleware `src/modules/auth/tenant.middleware.ts`**

```typescript
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { tenantPrisma } from "@/lib/prisma";
import { hasPermission } from "@/modules/auth/rbac";
import type { Permission, SessionUser } from "@/types";
import { NextResponse } from "next/server";

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return session.user as SessionUser;
}

export async function requireAuth() {
  const user = await getSessionUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return { user, db: tenantPrisma(user.tenantId) };
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
```

- [ ] **Step 10: Create audit service `src/modules/audit/audit.service.ts`**

```typescript
import { prisma } from "@/lib/prisma";

export async function logAudit(data: {
  tenantId: string;
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  oldValue?: any;
  newValue?: any;
  ipAddress?: string;
  userAgent?: string;
}) {
  return prisma.auditLog.create({
    data: {
      tenantId: data.tenantId,
      userId: data.userId,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      oldValue: data.oldValue ?? undefined,
      newValue: data.newValue ?? undefined,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    },
  });
}
```

- [ ] **Step 11: Commit**

```bash
git add src/types/ src/lib/auth-options.ts src/app/api/auth/ src/modules/auth/ src/modules/audit/ && git commit -m "feat: add auth system with NextAuth, RBAC, invitations, password reset, audit logging"
```

---

### Task 5: Seed Script & First-Time Setup

**Files:**
- Create: `scripts/seed.ts`, update `package.json`

- [ ] **Step 1: Create seed script `scripts/seed.ts`**

Full seed script that creates:
- Super Admin user from `.env`
- Default "Holiday Delight" tenant
- 5 departments (HD Visas, B2B Chardham, Hindu Tours, Hyderabad DMC, Holiday Delight)
- 8 default pipeline stages (New, Contacted, Follow-up, Quotation Sent, Negotiation, Converted, Lost, Dormant)
- 2 default follow-up rules
- Default canned responses per department
- Default dashboard widget layout for admin

The script should be idempotent — safe to run multiple times.

- [ ] **Step 2: Add seed command to package.json**

```json
"scripts": {
  "seed": "tsx scripts/seed.ts",
  "db:reset": "npx prisma migrate reset && npm run seed"
}
```

- [ ] **Step 3: Run seed**

```bash
cp .env.example .env
npm run seed
```

Expected: Seed completes, creates tenant + admin + departments + stages.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed.ts package.json && git commit -m "feat: add seed script with default tenant, departments, pipeline stages"
```

---

## Task Group 2: UI Foundation & Layout

### Task 6: Tailwind Theme & UI Components

**Files:**
- Create: `tailwind.config.ts` (update), `src/components/ui/*.tsx` (all base components)

- [ ] **Step 1: Update Tailwind config with Sunset Orange theme**

```typescript
// tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#FFF3E0",
          100: "#FFE0B2",
          200: "#FFCC80",
          300: "#FFB74D",
          400: "#FF9F1C",
          500: "#FF6B35",
          600: "#E55A2B",
          700: "#CC4A22",
          800: "#B23A18",
          900: "#8B2500",
        },
        surface: "#F8F9FA",
        card: "#FFFFFF",
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 2: Build all UI components**

Create each component in `src/components/ui/`:
- `button.tsx` — primary, secondary, ghost, danger variants using CVA
- `input.tsx` — text input with label, error state
- `select.tsx` — dropdown select
- `badge.tsx` — status badges (colored by variant)
- `card.tsx` — content card with header
- `table.tsx` — data table with sorting headers
- `modal.tsx` — dialog/modal overlay
- `dropdown.tsx` — action dropdown menu
- `tabs.tsx` — tab navigation
- `toast.tsx` — notification toasts
- `avatar.tsx` — user avatar with initials fallback
- `pagination.tsx` — page navigation
- `date-picker.tsx` — date input
- `color-picker.tsx` — color selection for branding
- `file-upload.tsx` — drag-and-drop file upload (10MB limit, allowed types from spec)
- `loading.tsx` — skeleton loaders and spinners

Each component must use the primary (Sunset Orange) color palette via Tailwind classes. All components receive CSS variables from the tenant theme so white-label recoloring works.

- [ ] **Step 3: Verify components render**

Create a temporary page to render all components and verify visually.

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.ts src/components/ui/ && git commit -m "feat: add UI component library with Sunset Orange theme"
```

---

### Task 7: Dashboard Layout (Sidebar + Header)

**Files:**
- Create: `src/components/layout/sidebar.tsx`, `src/components/layout/header.tsx`, `src/components/layout/page-header.tsx`, `src/components/layout/sidebar-nav-item.tsx`, `src/app/(dashboard)/layout.tsx`, `src/app/(auth)/layout.tsx`, `src/hooks/use-tenant.ts`

- [ ] **Step 1: Create sidebar component**

Full sidebar from spec mockup:
- Tenant logo + name at top (from tenant settings, falls back to HD default)
- Nav items with icons (lucide-react): Dashboard, Leads, Conversations, Follow-ups, Callbacks, Departments, Customers, Broadcasts, Reports | Users, Settings
- Active item highlighted with orange left border + orange background
- Badge counts on Leads, Conversations, Follow-ups (fetched via API)
- Bottom section: Users, Settings (separated by divider)
- Responsive: collapsible on mobile

- [ ] **Step 2: Create header component**

- Page title + subtitle
- Right side: date filter dropdown, notification bell with count badge, user avatar with dropdown (profile, settings, logout)

- [ ] **Step 3: Create dashboard layout `src/app/(dashboard)/layout.tsx`**

Protected layout — redirects to `/login` if no session. Wraps children with sidebar + header.

- [ ] **Step 4: Create auth layout `src/app/(auth)/layout.tsx`**

Minimal layout — centered card, tenant login background image if configured.

- [ ] **Step 5: Create `use-tenant` hook**

Fetches and caches tenant config (theme, logo, product name) for client-side use. Applies CSS variables for white-label theming.

- [ ] **Step 6: Verify layout renders**

Navigate to `/dashboard` — should see sidebar + header with Sunset Orange theme.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/ src/app/\(dashboard\)/layout.tsx src/app/\(auth\)/layout.tsx src/hooks/ && git commit -m "feat: add dashboard layout with sidebar, header, and white-label theming"
```

---

### Task 8: Login, Forgot Password, Accept Invite Pages

**Files:**
- Create: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/forgot-password/page.tsx`, `src/app/(auth)/accept-invite/page.tsx`

- [ ] **Step 1: Build login page**

- Email + password form
- "Forgot password?" link
- Submit calls NextAuth signIn
- Error display on invalid credentials
- Redirects to `/dashboard` on success
- Tenant-branded: shows logo + product name if custom domain detected

- [ ] **Step 2: Build forgot password page**

- Email input form
- Calls API to create reset token
- Shows "Check your email" confirmation
- API route: `POST /api/auth/forgot-password`

- [ ] **Step 3: Build accept invite page**

- Reads `?token=` from URL
- Validates token via API
- Shows name + password form
- Creates user account on submit
- Redirects to login

- [ ] **Step 4: Test full auth flow**

Run dev server, login with seeded admin, verify redirect to dashboard.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(auth\)/ && git commit -m "feat: add login, forgot password, and accept invite pages"
```

---

## Task Group 3: Core CRM Features

### Task 9: Department Management

**Files:**
- Create: `src/modules/leads/pipeline.service.ts`, `src/app/api/departments/route.ts`, `src/app/api/departments/[id]/route.ts`, `src/app/(dashboard)/departments/page.tsx`

- [ ] **Step 1: Create department API routes** (CRUD — GET list, POST create, PUT update, DELETE deactivate)
- [ ] **Step 2: Create department management page** (table with add/edit modal, color picker, contact info)
- [ ] **Step 3: Create pipeline stages API** (`src/app/api/pipeline-stages/route.ts`, `src/app/api/pipeline-stages/[id]/route.ts`)
- [ ] **Step 4: Create pipeline settings page** (`src/app/(dashboard)/settings/pipeline/page.tsx` — drag-reorder stages, add/remove per department)
- [ ] **Step 5: Test** — create department, verify in DB, verify pipeline stages
- [ ] **Step 6: Commit**

---

### Task 10: Customer Module

**Files:**
- Create: `src/modules/customers/customers.service.ts`, `src/app/api/customers/route.ts`, `src/app/api/customers/[id]/route.ts`, `src/app/(dashboard)/customers/page.tsx`

- [ ] **Step 1: Create customer service** (CRUD, dedup by mobile, auto-create from lead)
- [ ] **Step 2: Create customer API routes** (GET list with search/filter, GET detail, PUT update)
- [ ] **Step 3: Create customers page** (searchable table, click to view detail with linked leads)
- [ ] **Step 4: Commit**

---

### Task 11: Lead Management (Core)

**Files:**
- Create: `src/modules/leads/leads.service.ts`, `src/modules/leads/assignment.service.ts`, `src/app/api/leads/route.ts`, `src/app/api/leads/[id]/route.ts`, `src/app/(dashboard)/leads/page.tsx`, `src/app/(dashboard)/leads/[id]/page.tsx`, `src/components/leads/*.tsx`

- [ ] **Step 1: Create lead service** (CRUD, with auto customer creation/linking by mobile)
- [ ] **Step 2: Create lead assignment service** (assign to agent, auto-create LEAD_ASSIGNED notification)
- [ ] **Step 3: Create lead API routes** (GET list with filters/search/pagination, POST create, PUT update, DELETE, PATCH assign, PATCH change-stage)
- [ ] **Step 4: Create lead list page** — filterable table view with:
  - Search bar (name, phone, email)
  - Filters: department, stage, agent, source, priority, date range
  - Bulk actions: assign, change stage, export CSV
  - Quick view slide-out panel
- [ ] **Step 5: Create pipeline board (Kanban)** — `src/components/leads/pipeline-board.tsx`
  - Drag-and-drop cards across stage columns using @dnd-kit
  - Cards show: customer name, department color, travel date, assigned agent avatar, priority badge
  - Dropping card on new column calls PATCH change-stage API
- [ ] **Step 6: Create lead detail page** `src/app/(dashboard)/leads/[id]/page.tsx`
  - Customer info card
  - Activity timeline (all lead_activities in chronological order)
  - Follow-up scheduler (create new follow-up from lead)
  - File attachments section (upload/download)
  - Quick actions: assign, change stage, schedule callback, add note
- [ ] **Step 7: Create lead form component** (used in create modal + edit)
- [ ] **Step 8: Test full lead flow** — create lead, assign, change stage, verify activity log
- [ ] **Step 9: Commit**

---

### Task 12: Follow-up System

**Files:**
- Create: `src/modules/follow-ups/follow-up.service.ts`, `src/modules/follow-ups/follow-up-rules.service.ts`, `src/app/api/follow-ups/route.ts`, `src/app/api/follow-ups/[id]/route.ts`, `src/app/api/follow-up-rules/route.ts`, `src/app/(dashboard)/follow-ups/page.tsx`

- [ ] **Step 1: Create follow-up service** (CRUD, snooze, reassign, mark complete)
- [ ] **Step 2: Create follow-up rules service** (CRUD, triggered by stage change/lead creation)
- [ ] **Step 3: Create follow-up API routes**
- [ ] **Step 4: Create follow-ups page** — queue sorted by urgency (overdue → today → upcoming), filterable by type/department/agent, actions: complete, snooze, reassign
- [ ] **Step 5: Create follow-up rules settings** (add to `src/app/(dashboard)/settings/pipeline/page.tsx` or separate tab)
- [ ] **Step 6: Commit**

---

### Task 13: Callback System

**Files:**
- Create: `src/app/api/callbacks/route.ts`, `src/app/api/callbacks/[id]/route.ts`, `src/app/(dashboard)/callbacks/page.tsx`

- [ ] **Step 1: Create callback API routes** (CRUD, mark complete/missed)
- [ ] **Step 2: Create callbacks page** — scheduled callbacks with time slots, status filters, department filter
- [ ] **Step 3: Integrate callback creation** into lead detail page (quick action)
- [ ] **Step 4: Commit**

---

### Task 14: Escalation System

**Files:**
- Create: `src/modules/escalations/escalation.service.ts`, `src/app/api/escalations/route.ts`, `src/app/api/escalations/[id]/route.ts`

- [ ] **Step 1: Create escalation service** (create, acknowledge, resolve, auto-notify manager)
- [ ] **Step 2: Create escalation API routes**
- [ ] **Step 3: Add escalation button** to lead detail page and conversation panel
- [ ] **Step 4: Show escalation badges** in sidebar and follow-ups page
- [ ] **Step 5: Commit**

---

### Task 15: Conversations & Chat

**Files:**
- Create: `src/modules/conversations/chat.service.ts`, `src/modules/conversations/canned-responses.service.ts`, `src/app/api/conversations/route.ts`, `src/app/api/conversations/[id]/route.ts`, `src/app/api/conversations/[id]/messages/route.ts`, `src/app/api/canned-responses/route.ts`, `src/app/(dashboard)/conversations/page.tsx`, `src/components/chat/*.tsx`

- [ ] **Step 1: Create chat service** (create conversation from lead, send message, close)
- [ ] **Step 2: Create canned responses service** (CRUD per department)
- [ ] **Step 3: Create chat API routes**
- [ ] **Step 4: Create conversations page** — 3-panel layout:
  - Left: conversation list (sorted by recent, filterable by status)
  - Center: chat thread with message bubbles (sender type indicator), chat input with canned response dropdown
  - Right: customer info card + lead details + quick actions
- [ ] **Step 5: Create canned responses management** (in Settings or inline)
- [ ] **Step 6: Commit**

---

### Task 16: User Management & Invitations

**Files:**
- Create: `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`, `src/app/api/invitations/route.ts`, `src/app/(dashboard)/users/page.tsx`

- [ ] **Step 1: Create user API routes** (GET list, PUT update role/dept, PATCH deactivate)
- [ ] **Step 2: Create invitation API routes** (POST invite, GET pending invitations)
- [ ] **Step 3: Create users page** — table of team members with role, department, status. Invite button (sends email). Edit role/department. Deactivate.
- [ ] **Step 4: Commit**

---

## Task Group 4: Notifications, Broadcasts & Background Workers

### Task 17: Notification System

**Files:**
- Create: `src/modules/notifications/notification.service.ts`, `src/modules/notifications/channels/*.ts`, `src/app/api/notifications/route.ts`, `src/lib/redis.ts`, `src/lib/queue.ts`

- [ ] **Step 1: Create Redis client `src/lib/redis.ts`**
- [ ] **Step 2: Create BullMQ queue producer `src/lib/queue.ts`**
- [ ] **Step 3: Create notification service** (create notification, dispatch to channels via queue)
- [ ] **Step 4: Create channel implementations** — email (nodemailer + SMTP), SMS (HTTP API), WhatsApp (HTTP API), in-app (DB + Redis pub/sub)
- [ ] **Step 5: Create notification API** (GET list, PATCH mark-read, GET unread count)
- [ ] **Step 6: Create notification bell dropdown** in header (real-time via polling or socket)
- [ ] **Step 7: Create notification settings page** (`src/app/(dashboard)/settings/notifications/page.tsx` — per-channel toggles)
- [ ] **Step 8: Commit**

---

### Task 18: Broadcast System

**Files:**
- Create: `src/modules/broadcasts/broadcast.service.ts`, `src/app/api/broadcasts/route.ts`, `src/app/api/broadcasts/[id]/route.ts`, `src/app/(dashboard)/broadcasts/page.tsx`

- [ ] **Step 1: Create broadcast service** (create draft, schedule, send, track delivery)
- [ ] **Step 2: Create broadcast API routes**
- [ ] **Step 3: Create broadcasts page** — list of broadcasts with status, create new (select channel, target audience, compose message), schedule or send immediately, view delivery stats
- [ ] **Step 4: Commit**

---

### Task 19: Background Workers

**Files:**
- Create: `src/workers/index.ts`, `src/workers/follow-up.worker.ts`, `src/workers/follow-up-rules.worker.ts`, `src/workers/notification.worker.ts`, `src/workers/callback.worker.ts`, `src/workers/broadcast.worker.ts`, `src/workers/future-interest.worker.ts`

- [ ] **Step 1: Create worker entry point** `src/workers/index.ts` — registers all BullMQ workers
- [ ] **Step 2: Create follow-up worker** — processes due follow-ups, dispatches notifications
- [ ] **Step 3: Create follow-up-rules worker** — listens for stage change events (via Redis pub/sub), auto-creates follow-ups based on matching rules
- [ ] **Step 4: Create notification worker** — processes notification queue, delivers via configured channels
- [ ] **Step 5: Create callback worker** — checks for upcoming callbacks, sends reminders
- [ ] **Step 6: Create broadcast worker** — processes broadcast sends, updates recipient statuses
- [ ] **Step 7: Create future-interest worker** — when flagged service becomes available, notifies interested customers
- [ ] **Step 8: Commit**

---

## Task Group 5: Dashboard, Reports & Analytics

### Task 20: Dashboard Widget System

**Files:**
- Create: `src/app/api/widgets/route.ts`, `src/app/api/widgets/[id]/route.ts`, `src/app/api/widgets/data/route.ts`, `src/app/(dashboard)/dashboard/page.tsx`, `src/components/dashboard/*.tsx`, `src/components/charts/*.tsx`

- [ ] **Step 1: Create widget data API** (`src/app/api/widgets/data/route.ts` — accepts data_source + filters, returns aggregated data)
- [ ] **Step 2: Create widget CRUD API** (save/update/delete user widget layouts)
- [ ] **Step 3: Create chart components** (bar, line, pie, funnel using Recharts)
- [ ] **Step 4: Create all 9 widget components** (stat counter, bar chart, pie, progress, list, line, table, funnel, activity feed)
- [ ] **Step 5: Create widget grid** with drag-and-drop reordering (@dnd-kit)
- [ ] **Step 6: Create widget builder slide-out** (select type → configure data source, filters, size, title)
- [ ] **Step 7: Create dashboard page** — loads user's saved widgets, shows "+ Add Widget" and "Edit Layout" buttons
- [ ] **Step 8: Seed default widgets** for new users
- [ ] **Step 9: Commit**

---

### Task 21: Reports & Analytics

**Files:**
- Create: `src/modules/analytics/reports.service.ts`, `src/app/api/reports/route.ts`, `src/app/(dashboard)/reports/page.tsx`

- [ ] **Step 1: Create reports service** — aggregation queries for:
  - Lead funnel (conversion rates per stage)
  - Department performance
  - Agent performance
  - Source analysis
  - Follow-up effectiveness
  - Time-based trends
- [ ] **Step 2: Create reports API** (GET with type + date range + department filters)
- [ ] **Step 3: Create reports page** — tab navigation between report types, each with charts + data tables, date range picker, department filter
- [ ] **Step 4: Add CSV export** (generate CSV server-side, download via API)
- [ ] **Step 5: Add PDF export** (using @react-pdf/renderer)
- [ ] **Step 6: Commit**

---

## Task Group 6: WebSocket, Search & White-Label

### Task 22: WebSocket Server

**Files:**
- Create: `src/ws-server/index.ts`, `src/ws-server/auth.ts`, `src/ws-server/handlers/chat.handler.ts`, `src/ws-server/handlers/presence.handler.ts`, `src/ws-server/handlers/typing.handler.ts`, `src/hooks/use-socket.ts`

- [ ] **Step 1: Create WS server entry** — Socket.io server on port 3001, JWT auth in handshake, tenant-scoped rooms
- [ ] **Step 2: Create WS auth** — validate JWT, extract user/tenant, join rooms
- [ ] **Step 3: Create chat handler** — real-time message delivery, new message events
- [ ] **Step 4: Create presence handler** — online/offline status, last seen
- [ ] **Step 5: Create typing handler** — typing indicator events
- [ ] **Step 6: Create `use-socket` hook** for client-side socket management
- [ ] **Step 7: Integrate** real-time into conversations page + notification bell
- [ ] **Step 8: Commit**

---

### Task 23: Global Search

**Files:**
- Create: `src/lib/search.ts`, `src/app/api/search/route.ts`

- [ ] **Step 1: Add tsvector columns** via Prisma migration (on customers.name, customers.mobile, leads.destination)
- [ ] **Step 2: Create search service** — full-text search across customers, leads, conversations
- [ ] **Step 3: Create search API** (GET with query param, returns grouped results)
- [ ] **Step 4: Add search bar** to header component (global search with results dropdown)
- [ ] **Step 5: Commit**

---

### Task 24: White-Label System

**Files:**
- Create: `src/modules/white-label/theme.service.ts`, `src/modules/white-label/branding.service.ts`, `src/app/(dashboard)/settings/branding/page.tsx`, `src/app/(dashboard)/settings/general/page.tsx`

- [ ] **Step 1: Create theme service** — generate full palette from primary + secondary colors, apply as CSS variables
- [ ] **Step 2: Create branding service** — logo/favicon upload to `/uploads/{tenant_id}/branding/`, product name update
- [ ] **Step 3: Create general settings page** — company name, address, timezone, currency
- [ ] **Step 4: Create branding settings page** — logo upload, favicon upload, product name, color picker (6 presets + custom), login background image, email template preview
- [ ] **Step 5: Create integrations settings page** (`src/app/(dashboard)/settings/integrations/page.tsx` — SMTP config, SMS gateway, WhatsApp API keys)
- [ ] **Step 6: Apply theme dynamically** — tenant theme loaded on page load, injected as CSS variables
- [ ] **Step 7: Commit**

---

## Task Group 7: File Upload, Rate Limiting & Final Polish

### Task 25: File Upload System

**Files:**
- Create: `src/lib/uploads.ts`, `src/app/api/uploads/route.ts`

- [ ] **Step 1: Create upload utility** — validates file (10MB max, allowed MIME types), saves to `/uploads/{tenant_id}/{lead_id}/`, returns path
- [ ] **Step 2: Create upload API route** (POST multipart, returns file record)
- [ ] **Step 3: Integrate** into lead detail page (file attachments section) and chat (file messages)
- [ ] **Step 4: Commit**

---

### Task 26: Rate Limiting

**Files:**
- Create: `src/lib/rate-limit.ts`

- [ ] **Step 1: Create rate limiter** — Redis sliding window, 100 req/min per user
- [ ] **Step 2: Create login rate limiter** — 5 attempts, 15-min lockout, audit log on failure
- [ ] **Step 3: Apply** to all API routes via middleware
- [ ] **Step 4: Commit**

---

### Task 27: Audit Log Viewer

**Files:**
- Create: `src/app/api/audit-log/route.ts`

- [ ] **Step 1: Create audit log API** (GET with filters: user, action, entity, date range)
- [ ] **Step 2: Add audit log section** to Settings (visible to Company Admin + Super Admin only)
- [ ] **Step 3: Commit**

---

### Task 28: End-to-End Integration Test

- [ ] **Step 1: Start docker compose** (`docker compose up -d`)
- [ ] **Step 2: Run seed** (`npm run seed`)
- [ ] **Step 3: Verify login flow** — login as admin, verify dashboard loads
- [ ] **Step 4: Verify lead flow** — create lead, assign, change stage, create follow-up, upload file
- [ ] **Step 5: Verify conversation flow** — start conversation from lead, send messages
- [ ] **Step 6: Verify notification flow** — check notification bell after lead assignment
- [ ] **Step 7: Verify dashboard widgets** — add widget, configure, drag reorder, save
- [ ] **Step 8: Verify white-label** — change logo, colors, product name, verify applied
- [ ] **Step 9: Verify reports** — generate report, export CSV
- [ ] **Step 10: Verify broadcast** — create draft, send to department, check delivery
- [ ] **Step 11: Final commit**

```bash
git add -A && git commit -m "feat: Holiday Delight CRM Phase 1 complete"
```

---

## Task Summary

| Group | Tasks | Description |
|-------|-------|-------------|
| 1. Foundation | Tasks 1-5 | Project init, Prisma schema, Docker, auth, seed |
| 2. UI Foundation | Tasks 6-8 | Components, layout, auth pages |
| 3. Core CRM | Tasks 9-16 | Departments, customers, leads, follow-ups, callbacks, escalations, conversations, users |
| 4. Notifications | Tasks 17-19 | Notification system, broadcasts, background workers |
| 5. Dashboard | Tasks 20-21 | Widget system, reports & analytics |
| 6. Real-time & Search | Tasks 22-24 | WebSocket, global search, white-label |
| 7. Polish | Tasks 25-28 | File upload, rate limiting, audit log, E2E test |

**Total: 28 tasks across 7 groups.**

Each group produces a deployable state. Group 1-2 gives you a working app shell. Group 3 gives you the full CRM. Groups 4-7 add the remaining features incrementally.
