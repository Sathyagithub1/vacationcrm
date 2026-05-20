# Holiday Delight CRM — Phase 1 Design Spec

**Date:** 2026-05-20
**Status:** Approved
**Scope:** Admin Dashboard + CRM (Phase 1 of multi-phase build)

---

## 1. Overview

Holiday Delight is a travel & documentation company with multiple departments (HD Visas, B2B Chardham, Hindu Tours, Hyderabad DMC, Holiday Delight packages). This CRM system serves as the central platform for lead management, customer communication, follow-ups, and team coordination.

The system is designed as a **sellable, white-label, multi-tenant SaaS product** — each buyer (tenant) gets a fully branded, isolated workspace with customizable dashboards, pipeline stages, and notification preferences.

### Hard Rule

**Zero dead features.** Every button, link, CTA, claim, and feature shown in the UI must have a fully working backend flow. Nothing gets rendered unless it works end-to-end. No placeholders, no "coming soon", no dead code. Build incrementally — only ship pages/features when the full stack is complete.

---

## 2. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend + API | Next.js 15 (App Router) | Single app — pages, server actions, API routes |
| Database | PostgreSQL | Self-hosted, multi-tenant with row-level isolation |
| ORM | Prisma | Auto-migrations, typed queries, tenant middleware |
| Auth | NextAuth.js (Auth.js) | Self-hosted, JWT, no external auth provider |
| Real-time | Socket.io | Live chat, typing indicators, presence |
| Queue/Jobs | BullMQ + Redis | Follow-ups, notifications, scheduled jobs |
| Cache/Pub-Sub | Redis | Session cache, inter-service communication |
| PDF Generation | @react-pdf/renderer | Server-side PDF generation for report exports |
| Packaging | Docker Compose | One-command deployment: `docker compose up -d` |
| Reverse Proxy | Nginx | SSL termination, static files, WS proxy |
| File Storage | Local filesystem | `/uploads/` with per-tenant directory isolation |

---

## 3. Architecture — Modular Monolith + Service Containers

```
┌────────────────────────────────────────────────────┐
│                  Docker Compose                     │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  Next.js App (Port 3000)                    │   │
│  │  Internally organized as modules:           │   │
│  │  ├── @modules/auth      (login, RBAC, JWT)  │   │
│  │  ├── @modules/tenants   (multi-tenant)      │   │
│  │  ├── @modules/leads     (pipeline, CRUD)    │   │
│  │  ├── @modules/departments                   │   │
│  │  ├── @modules/follow-ups                    │   │
│  │  ├── @modules/analytics                     │   │
│  │  └── @modules/white-label                   │   │
│  │  Each module owns its routes, schemas,      │   │
│  │  services, and types. No cross-imports.     │   │
│  └─────────────────┬───────────────────────────┘   │
│                    │                                │
│  ┌─────────────────┴───┐  ┌────────────────────┐  │
│  │  PostgreSQL          │  │  Redis              │  │
│  │  (Port 5432)         │  │  (Port 6379)        │  │
│  └─────────────────────┘  └──────┬─────────────┘  │
│                                   │                 │
│  ┌────────────────────────────────┴────────────┐   │
│  │  WebSocket Server (Port 3001)               │   │
│  │  Separate container — Socket.io             │   │
│  │  Live chat, typing indicators, presence     │   │
│  │  Shares Redis pub/sub with main app         │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  Worker Service (Background)                │   │
│  │  Separate container — BullMQ consumer       │   │
│  │  ├── Follow-up scheduler                    │   │
│  │  ├── Notification dispatcher                │   │
│  │  ├── Callback reminders                     │   │
│  │  └── Future inquiry notifier                │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  Nginx (Port 80/443)                        │   │
│  │  Routes: /api/* & pages → Next.js           │   │
│  │          /ws/*          → WebSocket Server   │   │
│  │          /uploads/*     → Static files       │   │
│  └─────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────┘
```

**Container count:** 5 (Next.js, PostgreSQL, Redis, WebSocket Server, Nginx) + 1 Worker process

**Design rules:**
- If two things share the same DB tables and are always deployed together → module inside Next.js
- If something has independent lifecycle, scaling needs, or failure modes → separate container
- Modules communicate through DB and Redis pub/sub — no direct cross-imports
- Workers and WS server share the same Prisma schema and Redis connection

---

## 4. Multi-Tenancy

**Strategy:** Single database, row-level isolation via `tenant_id` on every table.

**Enforcement:** Prisma middleware auto-injects `tenant_id` on every query (read and write). No developer can accidentally leak data across tenants.

**Tenant resolution:** Custom domain → tenant lookup. Fallback to subdomain (e.g., `holidaydelight.app.com`).

---

## 5. Role-Based Access Control (RBAC)

### Role Overview

| Role | Scope | Summary |
|------|-------|---------|
| **Super Admin** | Platform-wide | Manage all tenants, billing, platform settings |
| **Company Admin** | Single tenant | Full control within their tenant — all departments, all users, all settings |
| **Dept Manager** | Single department | View/manage leads, agents, follow-ups within their department. Access department-level reports |
| **Agent** | Assigned work | View/manage only their assigned leads, conversations, follow-ups. Cannot access other agents' data |
| **Viewer** | Read-only | View reports and dashboards. Cannot modify leads, settings, or assignments |

### Permission Matrix

| Page / Action | Super Admin | Company Admin | Dept Manager | Agent | Viewer |
|---------------|:-----------:|:------------:|:------------:|:-----:|:------:|
| **Dashboard** | ✅ (all tenants) | ✅ | ✅ (dept data) | ✅ (own data) | ✅ (read) |
| **Leads — View** | ✅ all | ✅ all | ✅ own dept | ✅ assigned only | ✅ read |
| **Leads — Create/Edit** | ✅ | ✅ | ✅ own dept | ✅ assigned | ❌ |
| **Leads — Delete** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Leads — Assign** | ✅ | ✅ | ✅ own dept | ❌ | ❌ |
| **Leads — Bulk actions** | ✅ | ✅ | ✅ own dept | ❌ | ❌ |
| **Conversations** | ✅ | ✅ | ✅ own dept | ✅ assigned | ❌ |
| **Conversations — Take over** | ✅ | ✅ | ✅ own dept | ✅ assigned | ❌ |
| **Follow-ups — View** | ✅ | ✅ | ✅ own dept | ✅ assigned | ✅ read |
| **Follow-ups — Create/Edit** | ✅ | ✅ | ✅ own dept | ✅ own | ❌ |
| **Callbacks** | ✅ | ✅ | ✅ own dept | ✅ assigned | ✅ read |
| **Departments — CRUD** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Customers — View** | ✅ | ✅ | ✅ own dept | ✅ assigned | ✅ read |
| **Broadcasts — Send** | ✅ | ✅ | ✅ own dept | ❌ | ❌ |
| **Reports** | ✅ all | ✅ all depts | ✅ own dept | ✅ own stats | ✅ read |
| **Users — Invite/Manage** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Settings — General** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Settings — Branding** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Settings — Pipeline** | ✅ | ✅ | ✅ own dept | ❌ | ❌ |
| **Settings — Notifications** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Settings — Integrations** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Settings — Billing** | ✅ only | ❌ | ❌ | ❌ | ❌ |

---

## 6. Database Schema

### Tenant-ID Rule

Every table has a `tenant_id` column. The only exception is `tenants` itself. Prisma middleware auto-injects `tenant_id` on every query — no exceptions, no special cases. Child tables like `lead_activities` and `messages` also carry `tenant_id` for direct querying without joins.

### Core Tables

**tenants**
- id, name, slug, domain
- logo_url, favicon_url, product_name
- theme_config (JSON: colors, fonts, presets)
- login_bg_url, email_template_config (JSON)
- notification_settings (JSON: which channels enabled)
- subscription_status, created_at, updated_at

**users**
- id, tenant_id, email, password_hash
- name, phone, avatar_url
- role (SUPER_ADMIN | COMPANY_ADMIN | DEPT_MANAGER | AGENT | VIEWER)
- department_id (nullable — admins/viewers aren't tied to a dept)
- notification_preferences (JSON: per-channel toggles)
- is_active, last_seen_at, created_at

**invitations**
- id, tenant_id, email, role
- department_id (nullable), invited_by (FK → users)
- token (unique, 64-char random), expires_at
- accepted_at (nullable), created_at
- Flow: Company Admin invites → email sent with token link → user clicks accept-invite → sets password → account created

**password_reset_tokens**
- id, user_id, token (unique, 64-char random)
- expires_at (default: 1 hour), used_at (nullable), created_at
- Flow: user requests reset → email with token link → user clicks → sets new password → token invalidated

**departments**
- id, tenant_id, name, slug
- description, icon, color
- contact_email, contact_phone, website_url
- knowledge_base_config (JSON — structure: { faqs: [{q, a}], documents: [{name, url}], sops: [{title, content}] })
- is_active, created_at

**pipeline_stages**
- id, tenant_id, department_id (nullable = global stages)
- name, slug, color, position (ordering)
- is_default (pre-selected for new leads), is_system (cannot be deleted)
- created_at

**customers**
- id, tenant_id
- name, email, mobile (unique per tenant)
- alternate_phone, address, notes
- total_leads, last_lead_date
- created_at, updated_at
- Note: Customers are auto-created/linked when leads are created. Deduplication is by mobile number within a tenant. Multiple leads can belong to one customer.

**leads**
- id, tenant_id, department_id, customer_id (FK → customers)
- destination, travel_date, num_passengers
- special_requirement, source (WHATSAPP | WEBSITE | FB | IG | MANUAL)
- stage_id (FK → pipeline_stages)
- assigned_to (FK → users)
- priority (LOW | MEDIUM | HIGH | VIP)
- is_future_interest (for unlaunched services)
- created_at, updated_at

**lead_activities**
- id, tenant_id, lead_id, user_id
- type (NOTE | STAGE_CHANGE | ASSIGNMENT | CALL | EMAIL | SYSTEM)
- content (JSON — flexible payload per type)
- created_at

**follow_ups**
- id, tenant_id, lead_id, assigned_to
- type (REMINDER | QUOTATION | DOCUMENT | PAYMENT | RE_ENGAGE)
- scheduled_at, completed_at
- status (PENDING | SENT | COMPLETED | CANCELLED)
- message_template
- created_at

**follow_up_rules**
- id, tenant_id, department_id (nullable = global rule)
- trigger_type (STAGE_CHANGE | LEAD_CREATED | LEAD_INACTIVE)
- trigger_value (e.g., stage slug "quotation_sent", or inactivity days "7")
- follow_up_type (REMINDER | QUOTATION | DOCUMENT | PAYMENT | RE_ENGAGE)
- delay_hours (e.g., 24 = create follow-up 1 day after trigger)
- message_template, is_active
- created_at
- Note: When a trigger fires, the worker auto-creates a follow_up record based on the matching rule.

**callbacks**
- id, tenant_id, lead_id
- department_id, assigned_to
- preferred_time, status (SCHEDULED | COMPLETED | MISSED)
- notes, created_at

**conversations**
- id, tenant_id, lead_id
- channel (MANUAL)
- status (ACTIVE | HUMAN_TAKEOVER | CLOSED)
- assigned_agent_id, started_at, closed_at
- Note: In Phase 1, only MANUAL channel exists (agent-initiated conversations via dashboard). WhatsApp/Website/FB/IG channels are added in Phase 3. The schema supports future channels without migration.

**messages**
- id, tenant_id, conversation_id
- sender_type (CUSTOMER | BOT | AGENT)
- sender_id, content, message_type (TEXT | IMAGE | FILE)
- file_url, created_at

**notifications**
- id, tenant_id, user_id
- type (LEAD_ASSIGNED | FOLLOW_UP_DUE | ESCALATION | CALLBACK | NEW_MESSAGE)
- title, body, data (JSON)
- channels_sent (JSON array: which channels delivered)
- read_at, created_at

**escalations**
- id, tenant_id, lead_id, conversation_id (nullable)
- reason (REPEATED_FAILURE | COMPLEX_REQUEST | PAYMENT_ISSUE | TECHNICAL_ISSUE | VIP_CLIENT | CUSTOMER_REQUEST)
- escalated_from (FK → users, the agent), escalated_to (FK → users, the manager/admin)
- status (OPEN | ACKNOWLEDGED | RESOLVED | CLOSED)
- notes, resolved_at, created_at

**broadcasts**
- id, tenant_id, created_by (FK → users)
- title, content, channel (EMAIL | SMS | WHATSAPP | IN_APP)
- target_type (ALL_CUSTOMERS | DEPARTMENT | STAGE | CUSTOM_FILTER)
- target_filter (JSON — e.g., {department_id: "x"} or {stage_id: "y"})
- status (DRAFT | SCHEDULED | SENDING | SENT | FAILED)
- scheduled_at, sent_at, total_recipients, delivered_count, failed_count
- created_at

**broadcast_recipients**
- id, broadcast_id, customer_id
- status (PENDING | DELIVERED | FAILED)
- delivered_at, error_message

**canned_responses**
- id, tenant_id, department_id (nullable = global)
- title, content, shortcut (e.g., "/greeting")
- created_by (FK → users), is_active
- created_at

**audit_log**
- id, tenant_id, user_id
- action (e.g., "settings.branding.updated", "user.invited", "pipeline_stage.deleted", "login.success", "login.failed")
- entity_type, entity_id (what was changed)
- old_value (JSON, nullable), new_value (JSON, nullable)
- ip_address, user_agent
- created_at
- Note: Tracks all sensitive actions for security and compliance. Not the same as lead_activities (which tracks per-lead events).

**file_uploads**
- id, tenant_id, lead_id (nullable)
- uploaded_by, file_name, file_path
- file_type, file_size, created_at
- Constraints: max 10MB per file, allowed types: PDF, JPG, JPEG, PNG, DOC, DOCX, XLS, XLSX. Max 1GB storage per tenant (configurable in tenant settings).

**dashboard_widgets**
- id, tenant_id, user_id
- widget_type (STAT_COUNTER | BAR_CHART | PIE | PROGRESS | LIST | LINE | TABLE | FUNNEL | ACTIVITY)
- title, data_source, filters (JSON)
- size (1x1 | 2x1 | 2x2)
- position (JSON: {x, y})
- refresh_interval (seconds)
- config (JSON: widget-specific settings)
- created_at, updated_at
- Valid data_source values: leads_total, leads_by_stage, leads_by_department, leads_by_source, leads_by_date, conversion_rate, follow_ups_due, follow_ups_by_type, callbacks_scheduled, agent_performance, department_performance, recent_leads, recent_activities, response_time_avg

---

## 7. Module Structure

```
src/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Public routes (no sidebar)
│   │   ├── login/
│   │   ├── forgot-password/
│   │   └── accept-invite/
│   ├── (dashboard)/              # Protected routes (sidebar layout)
│   │   ├── dashboard/            # Overview — customizable widgets
│   │   ├── leads/                # Lead list, detail, pipeline board
│   │   ├── conversations/        # Live chat panel
│   │   ├── follow-ups/           # Scheduled follow-ups
│   │   ├── callbacks/            # Callback queue
│   │   ├── departments/          # Department management
│   │   ├── customers/            # Customer database
│   │   ├── reports/              # Analytics & reports
│   │   ├── broadcasts/           # Broadcast messaging
│   │   ├── users/                # User/agent management
│   │   └── settings/
│   │       ├── general/
│   │       ├── branding/
│   │       ├── departments/
│   │       ├── pipeline/
│   │       ├── notifications/
│   │       └── integrations/
│   └── api/
│       ├── auth/[...nextauth]/
│       ├── leads/
│       ├── customers/
│       ├── conversations/
│       ├── follow-ups/
│       ├── callbacks/
│       ├── escalations/
│       ├── broadcasts/
│       ├── canned-responses/
│       ├── notifications/
│       ├── departments/
│       ├── pipeline-stages/
│       ├── follow-up-rules/
│       ├── users/
│       ├── invitations/
│       ├── reports/
│       ├── uploads/
│       ├── widgets/
│       ├── audit-log/
│       └── webhooks/
│
├── modules/                      # Business logic (no UI)
│   ├── auth/
│   │   ├── auth.service.ts
│   │   ├── rbac.middleware.ts
│   │   ├── tenant.middleware.ts
│   │   ├── invitation.service.ts
│   │   └── password-reset.service.ts
│   ├── leads/
│   │   ├── leads.service.ts
│   │   ├── pipeline.service.ts
│   │   └── assignment.service.ts
│   ├── customers/
│   │   └── customers.service.ts
│   ├── conversations/
│   │   ├── chat.service.ts
│   │   └── canned-responses.service.ts
│   ├── follow-ups/
│   │   ├── follow-up.service.ts
│   │   ├── follow-up-rules.service.ts
│   │   └── scheduler.service.ts
│   ├── escalations/
│   │   └── escalation.service.ts
│   ├── broadcasts/
│   │   └── broadcast.service.ts
│   ├── notifications/
│   │   ├── notification.service.ts
│   │   ├── channels/
│   │   │   ├── email.channel.ts
│   │   │   ├── sms.channel.ts
│   │   │   ├── whatsapp.channel.ts
│   │   │   └── in-app.channel.ts
│   │   └── templates/
│   ├── analytics/
│   │   └── reports.service.ts
│   ├── audit/
│   │   └── audit.service.ts
│   └── white-label/
│       ├── theme.service.ts
│       └── branding.service.ts
│
├── components/                   # Shared UI components
│   ├── ui/                       # Base (buttons, inputs, badges)
│   ├── layout/                   # Sidebar, header, page wrappers
│   ├── leads/                    # Lead-specific components
│   ├── chat/                     # Chat widgets
│   └── charts/                   # Dashboard charts
│
├── lib/                          # Shared utilities
│   ├── prisma.ts                 # Prisma client + tenant middleware
│   ├── redis.ts
│   ├── socket.ts
│   ├── queue.ts
│   └── uploads.ts
│
├── workers/                      # BullMQ consumers (separate container)
│   ├── follow-up.worker.ts
│   ├── follow-up-rules.worker.ts # Listens for stage changes, creates follow-ups
│   ├── notification.worker.ts
│   ├── callback.worker.ts
│   ├── broadcast.worker.ts
│   └── future-interest.worker.ts
│
└── ws-server/                    # WebSocket server (separate container)
    ├── index.ts
    ├── handlers/
    │   ├── chat.handler.ts
    │   ├── presence.handler.ts
    │   └── typing.handler.ts
    └── auth.ts
```

**Module rules:**
- `modules/` = pure business logic, no React, no Next.js imports
- `app/` pages call `modules/` services via server actions or API routes
- Modules never import from each other directly — communicate through services and events via Redis pub/sub
- `workers/` and `ws-server/` share the same Prisma schema and Redis connection but run as separate Docker containers

---

## 8. UI Design

### Theme
- **Default:** Sunset Orange (primary: #FF6B35, secondary: #FF9F1C, bg-accent: #FFF3E0)
- **White-label:** Full customization via settings — 6+ pre-built theme presets + custom color picker that auto-generates full palette from primary + secondary colors
- **Background:** Light (#F8F9FA), cards on white, subtle shadows

### Layout
- **Full sidebar (classic):** always-visible sidebar with icons + labels
- **Sidebar top-left:** Tenant logo + company name (uploaded via branding settings)
- **Sidebar items:** Dashboard, Leads, Conversations, Follow-ups, Callbacks, Departments, Customers, Broadcasts, Reports | Users, Settings
- **Badge counts:** real-time counters on Leads, Conversations, Follow-ups

### Dashboard — Customizable Widget System
- **Default widgets:** Stat counters (leads, converted, live chats, follow-ups), Lead Trends chart, Department Breakdown, Recent Leads list, Upcoming Follow-ups list
- **"+ Add Widget" button:** opens slide-out panel with 9 widget types:
  - Stat Counter, Bar Chart, Pie/Donut, Progress Bars, List Widget, Line Chart, Table Widget, Funnel Chart, Activity Feed
- **Widget configuration:** data source, department filter, date range, size (1x1/2x1/2x2), custom title, auto-refresh interval
- **Drag-and-drop reordering** — layout saved per user
- **"Edit Layout" mode** — toggle grid editing, remove widgets, resize

### Lead Management
- **List view:** filterable table (search, department, stage, agent, source, date, priority), bulk actions (assign, change stage, export CSV), quick view slide-out
- **Pipeline board (Kanban):** drag-and-drop cards across stages, color-coded by department, cards show name, department, travel date, agent, priority
- **Lead detail page:** customer info, activity timeline, follow-up scheduler, file attachments, conversation history, quick actions (assign, stage change, callback, note)

### Conversations / Live Chat Panel
- **Phase 1 scope:** Agent-initiated conversations only (MANUAL channel). Agents start conversations from lead detail page. Full multichannel (WhatsApp/FB/IG) added in Phase 3.
- **3-panel layout:** conversation list (left), chat thread (center), customer info card (right)
- **Status indicators:** Active / Human Takeover / Closed
- **Typing indicators + online presence** via WebSocket
- **Canned responses:** pre-saved quick replies per department (managed in Settings)

### Follow-up & Callback System
- **Follow-up queue:** sorted by urgency (overdue → due today → upcoming)
- **Filters:** type, department, agent
- **Actions:** mark complete, snooze, reassign, send now
- **Auto-creation rules:** stage change triggers auto follow-up (e.g., "Quotation Sent" → 1-day follow-up)
- **Callback queue:** separate view — scheduled callbacks with time slots, department, status

### Reports & Analytics
Pre-built reports (also available as dashboard widgets):
- Lead funnel (conversion rates across stages)
- Department performance (leads, conversions, response time)
- Agent performance (leads handled, conversion rate, avg response time)
- Source analysis (which channels drive most leads)
- Follow-up effectiveness (completion rate, post-follow-up conversion)
- Time-based trends (daily/weekly/monthly)
- All reports exportable as CSV/PDF with selectable date range

### Settings
- **General:** company name, address, timezone, currency
- **Branding:** logo upload, favicon, product name, primary/secondary colors (picker + presets), login background, email templates
- **Departments:** CRUD, contact info, website URL, knowledge base config
- **Pipeline:** add/remove/reorder stages per department, set defaults
- **Notifications:** enable/disable per channel (email/SMS/WhatsApp/in-app), configure templates per notification type
- **Integrations:** WhatsApp API keys, SMS gateway, SMTP config, webhook URLs
- **Users:** invite (via email), deactivate, change role, assign department
- **Billing:** (super admin only) tenant subscription management

---

## 9. Notification System

**Channels:** In-app, Email, WhatsApp, SMS — all configurable per tenant and per user.

**Notification types:**
| Event | Default Channels | Recipients |
|-------|-----------------|------------|
| New lead assigned | In-app + Email | Assigned agent |
| Follow-up due | In-app + Email | Assigned agent |
| Follow-up overdue | In-app + Email + SMS | Assigned agent + dept manager |
| Escalation request | In-app + Email + WhatsApp | Dept manager + admin |
| New chat message | In-app | Assigned agent |
| Callback scheduled | In-app + Email | Assigned agent |
| Payment reminder due | In-app + Email | Assigned agent |
| Future service launched | Email + WhatsApp | Customer (external) |

**Configuration:** Tenants set which channels are enabled globally. Users override with personal preferences (e.g., "don't send me SMS for follow-ups").

---

## 10. White-Label System

Each tenant can customize:
- **Product name** — replaces "Holiday Delight CRM" everywhere
- **Logo + Favicon** — uploaded via settings, stored in `/uploads/{tenant_id}/branding/`
- **Theme colors** — pick from 6+ presets or use custom color picker (primary + secondary → auto-generated palette)
- **Login page** — custom background image
- **Email templates** — customize header, footer, colors, logo in transactional emails
- **Custom domain** — tenant maps their domain → Nginx routes to their workspace

Theme config stored as JSON in `tenants.theme_config`, applied at runtime via CSS variables.

---

## 11. Docker Compose Setup

```yaml
services:
  app:          # Next.js (port 3000)
  ws-server:    # Socket.io (port 3001)
  worker:       # BullMQ consumer
  postgres:     # PostgreSQL (port 5432)
  redis:        # Redis (port 6379)
  nginx:        # Reverse proxy (port 80/443)

volumes:
  postgres_data:
  redis_data:
  uploads:      # /uploads/ host volume
```

**Deployment:** `docker compose up -d` — single command, full system.

**Environment:** Single `.env` file for all config (DB credentials, Redis URL, SMTP, SMS gateway, WhatsApp API key, JWT secret).

---

## 12. Future Phases (Out of Scope for Phase 1)

- **Phase 2:** AI Chatbot (multi-department NLP, knowledge base per dept, website data integration)
- **Phase 3:** Multichannel Integration (WhatsApp Business API, Facebook Messenger, Instagram DM)
- **Phase 4:** Website Chat Widget (embeddable JS widget for department websites)
- **Phase 5:** Advanced Analytics (ML-based lead scoring, predictive follow-ups)

Phase 1 builds the foundation that all future phases plug into.

---

## 13. WebSocket Authentication

WebSocket connections are authenticated via JWT token passed in the handshake query parameter:
1. Client connects: `io("ws://domain/ws", { query: { token: "jwt..." } })`
2. `ws-server/auth.ts` validates the JWT, extracts `user_id` and `tenant_id`
3. Socket joins tenant-scoped rooms: `tenant:{tenant_id}`, `user:{user_id}`, `dept:{department_id}`
4. All events are scoped to tenant rooms — no cross-tenant leakage
5. Invalid/expired token → connection rejected with 401

---

## 14. Search

- **Lead search:** PostgreSQL full-text search using `tsvector` index on `customers.name`, `customers.email`, `customers.mobile`, `leads.destination`, `leads.special_requirement`
- **Global search bar:** searches across leads, customers, and conversations. Returns grouped results.
- **Index maintenance:** `tsvector` columns auto-updated via Prisma middleware on insert/update

---

## 15. Timezone Handling

- **Storage:** All dates stored as UTC in PostgreSQL (`TIMESTAMPTZ`)
- **Tenant timezone:** Set in Settings → General (e.g., `Asia/Kolkata`)
- **Display:** All dates converted to tenant timezone on the frontend using `Intl.DateTimeFormat`
- **Scheduled jobs:** Follow-ups, callbacks, broadcasts use tenant timezone for scheduling. Worker converts to UTC before storing. Cron jobs run in UTC; delivery time calculated per-tenant.
- **Timezone change:** Does not retroactively modify existing scheduled items. Only affects new items.

---

## 16. Rate Limiting & Security

- **API rate limiting:** 100 requests/minute per user (configurable per tenant). Uses Redis sliding window counter.
- **Login protection:** 5 failed attempts → 15-minute lockout. Logged in `audit_log` with `login.failed`.
- **Webhook endpoints:** 30 requests/second per source IP
- **File upload:** Validated server-side — MIME type check + file extension check. No executable files.
- **CSRF:** NextAuth built-in CSRF protection
- **XSS:** React's default escaping + CSP headers via Nginx

---

## 17. Seed Data & First-Time Setup

On first `docker compose up`, an init script runs:
1. Creates default Super Admin account (email/password from `.env`)
2. Creates a demo tenant ("Holiday Delight") with:
   - 5 default departments (HD Visas, B2B Chardham, Hindu Tours, Hyderabad DMC, Holiday Delight)
   - Default pipeline stages: New → Contacted → Follow-up → Quotation Sent → Negotiation → Converted → Lost → Dormant
   - Default follow-up rules (quotation sent → 1-day reminder, payment pending → 2-day reminder)
   - Default dashboard widget layout (4 stat cards + lead trends + department breakdown + recent leads + follow-ups)
   - Default canned responses per department
3. No sample lead data — tenants start clean

For buyers: they run `docker compose up`, create their Super Admin via `.env`, and configure their tenant through the admin dashboard.

---

## 18. Backup & Recovery

- **Database:** `pg_dump` daily cron (configurable in `.env`: `BACKUP_CRON=0 2 * * *`), stored in `/backups/postgres/`, 30-day retention
- **Uploads:** rsync `/uploads/` to `/backups/uploads/` daily
- **Restore:** documented script `scripts/restore.sh` — takes a backup timestamp, restores DB + files
- **Docker volumes:** `postgres_data` and `redis_data` are named volumes, persist across container restarts
