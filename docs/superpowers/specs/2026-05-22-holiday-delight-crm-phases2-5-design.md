# Holiday Delight CRM — Phases 2-5 Design Spec

**Date:** 2026-05-22
**Status:** Approved
**Scope:** AI Chatbot (Phase 2) + Multichannel (Phase 3) + Website Chat Widget (Phase 4) + Advanced Analytics (Phase 5)
**Builds on:** Phase 1 spec (`2026-05-20-holiday-delight-crm-design.md`)

---

## 1. Overview

This spec covers the remaining four phases of the Holiday Delight CRM, transforming it from a manual agent-driven CRM into an AI-powered, multichannel, self-improving sales platform. Each phase builds on the previous:

- **Phase 2** adds an AI chatbot engine with pluggable provider support
- **Phase 3** connects 6 external messaging channels into a unified inbox
- **Phase 4** delivers an embeddable website chat widget with AI-first handling
- **Phase 5** adds ML-based lead scoring, predictive follow-ups, and smart agent assignment

### Hard Rules (carried from Phase 1)

- **Zero dead features.** Every button, link, CTA must have a working backend flow.
- **Provider-agnostic.** AI backend is pluggable — Claude default, OpenAI/Gemini configurable per tenant.
- **No external ML services.** Scoring and predictions run within Node.js + PostgreSQL + AI provider. No Python, no model hosting, no GPU.
- **Tenant isolation.** All new tables carry `tenant_id`. All queries scoped via Prisma middleware.

---

## 2. Phase 2: AI Chatbot

### 2.1 Architecture

The AI system sits between incoming messages and the existing conversation flow. An AI Router decides whether to handle a message with AI or pass to a human agent.

```
Customer Message (any channel)
        │
        ▼
┌─────────────────────────┐
│   AI Router Service     │  ← Decides: AI handle or pass to agent?
│   (src/modules/ai/)     │
└──────────┬──────────────┘
           │
     ┌─────┴──────┐
     ▼             ▼
┌─────────┐  ┌──────────────┐
│ AI      │  │ Human Agent  │
│ Process │  │ (existing)   │
└────┬────┘  └──────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│   AI Provider Adapter (Interface)   │
│  ┌──────────┐ ┌────────┐ ┌───────┐ │
│  │ Claude   │ │ OpenAI │ │Gemini │ │
│  │ Adapter  │ │Adapter │ │Adapter│ │
│  └──────────┘ └────────┘ └───────┘ │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│   Context Builder                   │
│  • Department knowledge base (FAQs) │
│  • Lead history & customer profile  │
│  • Canned responses & SOPs          │
│  • Conversation memory (last 20msg) │
│  • Tool definitions                 │
└─────────────────────────────────────┘
```

### 2.2 Provider Adapter Interface

```typescript
interface AIProvider {
  id: string;  // 'claude' | 'openai' | 'gemini'

  chat(params: {
    messages: Message[];
    systemPrompt: string;
    tools?: ToolDefinition[];
    knowledgeContext: string;
  }): AsyncGenerator<ChatChunk>;  // Streaming response

  generateEmbedding(text: string): Promise<number[]>;
}
```

Ships with 3 adapters:
- **ClaudeAdapter** — Anthropic SDK (`@anthropic-ai/sdk`)
- **OpenAIAdapter** — OpenAI SDK (`openai`)
- **GeminiAdapter** — Google GenAI SDK (`@google/generative-ai`)

### 2.3 AI Tools (Function Calling)

The AI can perform CRM actions during conversation:

| Tool | Purpose |
|------|---------|
| `create_lead` | Capture travel inquiry as new lead |
| `check_availability` | Query department packages/dates from KB |
| `get_pricing` | Retrieve package pricing from KB |
| `schedule_callback` | Book a callback with agent |
| `handoff_to_agent` | Transfer to live human |
| `lookup_lead` | Find existing lead by phone/email |

### 2.4 Handoff Logic

AI → Human transfer triggers:
- Customer explicitly requests a person
- AI confidence below threshold after 2 attempts on same question
- Escalation keywords: complaint, refund, cancel, legal
- Complex negotiation: custom pricing, group bookings, special requirements
- Payment/billing discussions

On handoff: full conversation history + AI-generated summary passed to agent. Agent sees context like "AI handled 5 messages, customer wants Chardham package for 8 people, budget concern."

### 2.5 New Database Tables

**ai_providers**
- id, tenant_id
- provider (CLAUDE | OPENAI | GEMINI | CUSTOM)
- api_key (encrypted)
- model_name (e.g., "claude-sonnet-4-5-20250514")
- config (JSON: temperature, max_tokens, etc.)
- is_active, created_at

**knowledge_bases**
- id, tenant_id, department_id
- type (FAQ | SOP | PRICING | DOCUMENT | CUSTOM)
- title, content (text)
- embedding (vector, for semantic search)
- is_active, created_at, updated_at

**ai_conversations**
- id, conversation_id (FK)
- provider_used, model_used
- total_tokens, total_cost
- handoff_reason (nullable)
- satisfaction_score (nullable)
- created_at

**ai_tool_calls**
- id, ai_conversation_id
- tool_name
- input (JSON), output (JSON)
- status (SUCCESS | FAILED)
- created_at

### 2.6 New Module Structure

```
src/modules/ai/
├── ai-router.service.ts        # Decide: AI or human?
├── ai-chat.service.ts          # Orchestrate AI conversation
├── context-builder.service.ts  # Build prompt context from KB + history
├── knowledge-base.service.ts   # CRUD + semantic search for KB entries
├── providers/
│   ├── provider.interface.ts   # AIProvider interface
│   ├── claude.adapter.ts       # Anthropic SDK
│   ├── openai.adapter.ts       # OpenAI SDK
│   └── gemini.adapter.ts       # Google GenAI SDK
└── tools/
    ├── tool.interface.ts       # Tool definition interface
    ├── create-lead.tool.ts
    ├── check-availability.tool.ts
    ├── get-pricing.tool.ts
    ├── schedule-callback.tool.ts
    ├── handoff.tool.ts
    └── lookup-lead.tool.ts
```

### 2.7 New API Routes

```
POST   /api/ai/chat              # Send message to AI (streaming response)
GET    /api/ai/providers          # List configured providers
POST   /api/ai/providers          # Configure AI provider for tenant
PUT    /api/ai/providers/[id]     # Update provider config
GET    /api/knowledge-base        # List KB entries (filterable by dept)
POST   /api/knowledge-base        # Create KB entry
PUT    /api/knowledge-base/[id]   # Update KB entry
DELETE /api/knowledge-base/[id]   # Delete KB entry
POST   /api/knowledge-base/import # Bulk import from CSV/JSON
GET    /api/ai/metrics            # AI usage stats (tokens, cost, handoff rate)
```

### 2.8 New UI Pages

- **Settings → AI Configuration:** Select provider, enter API key, choose model, set temperature/max tokens
- **Settings → Knowledge Base:** Per-department CRUD for FAQs, SOPs, pricing docs, custom content. Bulk import.
- **Dashboard → AI Metrics Widget:** Messages handled, handoff rate, avg cost/conversation, satisfaction
- **Conversation view:** "AI" badge on bot messages, handoff marker in timeline, token cost per conversation

---

## 3. Phase 3: Multichannel Integration

### 3.1 Architecture — Channel Adapter Pattern

All 6 channels feed into a unified message service through a common adapter interface. Outbound messages route through the same adapters.

```
 INBOUND (Customer → CRM)                    OUTBOUND (CRM → Customer)

 WhatsApp ──webhook──┐                  ┌──→ WhatsApp Cloud API
 Facebook ──webhook──┤                  ├──→ Meta Graph API
 Instagram ─webhook──┤                  ├──→ Instagram Messaging API
 Email ────webhook───┤     Unified      ├──→ SMTP (nodemailer)
 SMS ──────webhook───┤  ←→ Message  ←→  ├──→ Twilio/MSG91 API
 Telegram ─webhook───┤     Service      ├──→ Telegram Bot API
 Website ──websocket─┘                  └──→ WebSocket (Socket.io)
                           │
                           ▼
              ┌─────────────────────────┐
              │   Conversation Manager  │
              │  • Dedup by customer ID │
              │  • Route to department  │
              │  • Assign to agent/AI   │
              │  • Merge cross-channel  │
              └─────────────────────────┘
```

### 3.2 Channel Adapter Interface

```typescript
interface ChannelAdapter {
  channel: ConversationChannel;

  parseInbound(req: Request): Promise<InboundMessage>;

  sendMessage(params: {
    externalId: string;
    content: string;
    messageType: MessageType;
    fileUrl?: string;
    metadata?: Record<string, any>;
  }): Promise<SendResult>;

  verifySignature(req: Request): boolean;

  sendTemplate?(templateId: string, params: Record<string, string>): Promise<SendResult>;
}

interface InboundMessage {
  externalMessageId: string;
  senderExternalId: string;
  senderName?: string;
  content: string;
  messageType: MessageType;
  fileUrl?: string;
  channel: ConversationChannel;
  rawPayload: Record<string, any>;
  timestamp: Date;
}
```

### 3.3 Channel Specifications

**WhatsApp Business API**
- API: Meta Cloud API (free tier available)
- Webhook: `POST /api/webhooks/whatsapp`
- Auth: Verify token + HMAC-SHA256 signature
- Features: Text, images, docs, templates (HSM), quick replies, location
- 24h rule: After 24h without customer msg → template messages only
- Config: Phone Number ID, Business Account ID, Access Token, Webhook Verify Token

**Facebook Messenger**
- API: Meta Graph API v19+
- Webhook: `POST /api/webhooks/facebook`
- Auth: App Secret HMAC signature
- Features: Text, images, quick replies, buttons, persistent menu
- Matching: PSID → customer by name lookup or ask for phone
- Config: Page ID, Page Access Token, App Secret

**Instagram DM**
- API: Instagram Messaging API (same Meta platform)
- Webhook: `POST /api/webhooks/instagram`
- Auth: Same App Secret as Facebook
- Features: Text, images, story replies, story mentions, ice breakers
- Config: IG Business Account ID, shared with FB app

**Email (Inbound)**
- Method: SendGrid Inbound Parse webhook OR IMAP polling
- Webhook: `POST /api/webhooks/email`
- Auth: Basic auth or IP whitelist
- Features: Text (HTML stripped), attachments, reply threading (In-Reply-To header)
- Matching: From email → customer.email lookup
- Config: Inbound domain, SendGrid API key or IMAP credentials

**SMS (Twilio / MSG91)**
- API: Twilio Programmable SMS or MSG91 (India)
- Webhook: `POST /api/webhooks/sms`
- Auth: Twilio signature validation / MSG91 auth key
- Features: Text only (160 char segments), MMS for images (Twilio)
- Matching: From phone → customer.mobile lookup
- Config: Account SID, Auth Token, From Number (Twilio) or API Key, Sender ID (MSG91)

**Telegram Bot**
- API: Telegram Bot API
- Webhook: `POST /api/webhooks/telegram`
- Auth: Secret token in webhook URL path
- Features: Text, images, docs, inline keyboards, reply markup, location
- Matching: Telegram user ID → ask for phone or match by name
- Config: Bot Token, Webhook Secret

### 3.4 Conversation Channel Enum Update

`ConversationChannel` expands from `MANUAL` to:

```
MANUAL | WHATSAPP | FACEBOOK | INSTAGRAM | EMAIL | SMS | TELEGRAM | WEBSITE
```

`WEBSITE` is included now for Phase 4. All existing conversations remain `MANUAL`.

### 3.5 New Database Tables

**channel_configs**
- id, tenant_id
- channel (WHATSAPP | FACEBOOK | INSTAGRAM | EMAIL | SMS | TELEGRAM)
- credentials (encrypted JSON: API keys, tokens)
- webhook_secret
- config (JSON: sender ID, default department, auto-reply toggle)
- is_active, verified_at, created_at

**customer_channels**
- id, tenant_id, customer_id
- channel (enum)
- external_id (phone, PSID, email, chat_id)
- display_name, profile_pic_url
- last_seen_at, created_at
- Unique constraint: (tenant_id, channel, external_id)

**message_delivery**
- id, message_id, tenant_id
- external_message_id (provider's msg ID)
- status (SENT | DELIVERED | READ | FAILED)
- error_message, error_code
- sent_at, delivered_at, read_at

**webhook_logs**
- id, tenant_id, channel
- event_type, payload (JSON)
- status (PROCESSED | FAILED | IGNORED)
- error_message, processing_time_ms
- created_at (auto-purge after 30 days)

### 3.6 New Module Structure

```
src/modules/channels/
├── channel-manager.service.ts     # Route inbound, manage conversations
├── message-dispatcher.service.ts  # Send outbound via correct adapter
├── customer-matcher.service.ts    # Match external IDs to customers
├── adapters/
│   ├── adapter.interface.ts       # ChannelAdapter interface
│   ├── whatsapp.adapter.ts
│   ├── facebook.adapter.ts
│   ├── instagram.adapter.ts
│   ├── email.adapter.ts
│   ├── sms.adapter.ts
│   └── telegram.adapter.ts
└── webhook-logger.service.ts      # Log + debug webhooks
```

### 3.7 New API Routes

```
POST   /api/webhooks/whatsapp      # WhatsApp webhook receiver
GET    /api/webhooks/whatsapp      # WhatsApp webhook verification
POST   /api/webhooks/facebook      # Facebook webhook receiver
GET    /api/webhooks/facebook      # Facebook webhook verification
POST   /api/webhooks/instagram     # Instagram webhook receiver
POST   /api/webhooks/email         # Email inbound parse receiver
POST   /api/webhooks/sms           # SMS webhook receiver
POST   /api/webhooks/telegram      # Telegram webhook receiver

GET    /api/channel-configs        # List channel configurations
POST   /api/channel-configs        # Configure a channel
PUT    /api/channel-configs/[id]   # Update channel config
DELETE /api/channel-configs/[id]   # Remove channel config
POST   /api/channel-configs/[id]/test  # Test channel connection

GET    /api/customers/[id]/channels    # List customer's linked channels
POST   /api/customers/[id]/merge       # Merge duplicate customers
```

### 3.8 Cross-Channel Customer Merging

Same customer can message from multiple channels. Merge logic:
1. **Phone match:** WhatsApp phone = SMS phone = customer.mobile → auto-merge
2. **Email match:** Inbound email = customer.email → auto-merge
3. **AI-assisted:** Bot asks "Have you contacted us before? What's your phone/email?" → lookup and link
4. **Manual merge:** Agent sees "Possible duplicate" banner → clicks to merge customer records

All conversations across channels visible in one unified timeline per customer.

### 3.9 Webhook Security

- All webhooks verify signatures before processing (HMAC-SHA256 for Meta, Twilio signature for SMS)
- Webhook URLs include tenant-specific secret path segment: `/api/webhooks/whatsapp/{tenantId}/{secret}`
- Rate limit: 100 webhook calls/second per channel per tenant
- All payloads logged to webhook_logs for debugging (auto-purge 30 days)
- Idempotency: external_message_id dedup prevents double processing

### 3.10 New UI

- **Settings → Channels:** Per-channel setup with credentials, webhook URL display, test connection button, enable/disable toggle
- **Settings → Channel Routing:** Map channels to default departments
- **Conversations:** Channel icon badge on each conversation, filter by channel, unified reply
- **Customer profile:** "Channels" section showing all linked external IDs, merge UI

---

## 4. Phase 4: Website Chat Widget

### 4.1 Architecture

A single JS file that tenants embed on their websites. The script creates a floating chat button and loads an iframe pointing to the CRM's widget page.

```
Tenant's Website (e.g., hdvisas.com)
┌──────────────────────────────────────────┐
│  <script src="https://crm/widget.js"     │
│          data-tenant="hd-visas"          │
│          data-dept="visas"               │
│          data-theme="auto"></script>     │
│                                    [💬]  │
└────────────────────────────────────┼─────┘
                                     │ Click opens chat
                                     ▼
                        ┌──────────────────────┐
                        │  Widget iframe        │
                        │  (React mini-app)     │
                        │  Socket.io → CRM WS   │
                        │  channel: WEBSITE      │
                        │  → AI Router (Phase 2) │
                        │  → Agent Inbox         │
                        └──────────────────────┘
```

### 4.2 Widget Bundle

**widget.js (Loader)**
- Size target: <5KB gzipped
- Reads `data-tenant`, `data-dept`, `data-theme` attributes
- Creates floating button (position, color from tenant branding)
- On click → injects iframe pointing to CRM widget page
- Handles postMessage communication with iframe
- Stores visitor session in localStorage (persist across pages)
- No dependencies — vanilla JS

**Widget App (iframe)**
- Route: `/widget/chat?tenant=X&dept=Y`
- React mini-app inside Next.js
- Socket.io client for real-time messaging
- Auto-connects to AI bot on open
- Shows tenant branding (logo, colors, welcome message)
- File upload support (drag & drop)
- Typing indicators, read receipts
- Mobile responsive (bottom sheet on mobile)

### 4.3 Quick-Action Blobs

Pre-defined tappable chips shown on widget open so visitors can start without typing.

Configured per department in `widget_configs.quick_actions` (JSON array):
```json
[
  { "label": "Chardham Yatra", "message": "I'm interested in Chardham Yatra" },
  { "label": "Visa Enquiry", "message": "I need help with a visa application" },
  { "label": "Call Me Back", "message": "Can someone call me back?" },
  { "label": "Package Pricing", "message": "What are your package prices?" }
]
```

Displayed as rounded chips below the welcome message. Visitor taps one → sends the associated message to AI.

### 4.4 Visitor Identity & Session

1. **Anonymous start:** Visitor opens widget → assigned a visitor_id (UUID stored in localStorage)
2. **AI greeting:** Bot sends welcome message from department config + quick-action blobs
3. **Lead capture:** AI naturally asks for name, phone, email during conversation
4. **Customer link:** Once phone/email provided → lookup existing customer or create new
5. **Cross-visit persistence:** Same visitor_id on return → resume previous conversation
6. **Cross-device:** Once linked to customer, any channel shows full history

### 4.5 Embed Code

```html
<!-- Holiday Delight Chat Widget -->
<script
  src="https://your-crm-domain.com/widget.js"
  data-tenant="holiday-delight"
  data-dept="b2b-chardham"
  data-theme="auto"
  async
></script>
```

One line. Async load. No impact on page speed.

### 4.6 New Database Tables

**widget_configs**
- id, tenant_id, department_id
- welcome_message, placeholder_text
- position (BOTTOM_RIGHT | BOTTOM_LEFT)
- button_icon (CHAT | HELP | CUSTOM)
- theme_override (JSON: colors, or "auto" from tenant branding)
- offline_message (shown when no agents + AI off)
- pre_chat_form (JSON: fields to collect before chat)
- quick_actions (JSON array: `[{label, message}]`)
- business_hours (JSON: per-day open/close times)
- auto_open_delay_ms (0 = manual, 3000 = auto-open after 3s)
- is_active, created_at

**widget_visitors**
- id, tenant_id
- visitor_id (UUID from localStorage)
- customer_id (nullable — linked once identified)
- first_page_url, referrer_url
- user_agent, ip_country, ip_city
- total_visits, total_messages
- first_seen_at, last_seen_at

### 4.7 Widget Features

- **White-label:** Auto-inherits tenant branding (colors, logo, name)
- **Responsive:** Bottom-right popup on desktop, full-screen sheet on mobile
- **File upload:** Drag & drop or click — images, docs, PDFs
- **Business hours:** Show AI/offline message outside hours
- **Unread badge:** Notification dot on widget button for new messages
- **Multi-language:** AI responds in visitor's language automatically
- **Page context:** Sends current URL to AI (knows which page visitor is on)
- **Persistent:** Conversation survives page navigation & revisits
- **Handoff:** Smooth AI-to-agent with context summary

### 4.8 New Module Structure

```
src/modules/widget/
├── widget.service.ts            # Widget config CRUD
├── visitor.service.ts           # Visitor tracking & customer linking
└── widget-auth.service.ts       # Visitor session (JWT for anonymous users)

src/app/(widget)/
└── widget/
    └── chat/
        └── page.tsx             # Widget chat UI (iframe content)

public/
└── widget.js                    # Embeddable loader script (<5KB)
```

### 4.9 New API Routes

```
GET    /api/widget/config        # Public — returns widget config for tenant+dept
POST   /api/widget/session       # Create/resume visitor session (returns JWT)
POST   /api/widget/message       # Send message from widget (authed via visitor JWT)
GET    /api/widget/history       # Get conversation history for visitor
POST   /api/widget/upload        # File upload from widget

GET    /api/widget-configs                # Admin — list widget configs
POST   /api/widget-configs                # Create widget config for department
PUT    /api/widget-configs/[id]           # Update widget config
GET    /api/widget-configs/[id]/embed     # Get embed code snippet
GET    /api/widget/visitors               # Admin — list visitors with stats
```

### 4.10 New UI in CRM

- **Settings → Widget:** Per-department config — welcome message, quick-action blobs, position, colors, pre-chat form, business hours, auto-open delay
- **Settings → Widget → Embed Code:** Copy-paste snippet with live preview
- **Conversations:** WEBSITE channel badge, visitor info panel (page URL, location, visit count, device)
- **Dashboard → Widget Analytics Widget:** Active visitors, conversations started, leads captured, handoff rate

---

## 5. Phase 5: Advanced Analytics

### 5.1 Architecture

```
┌──────────────────────────────────────────────┐
│              Data Collection Layer            │
│  Leads, Follow-ups, Conversations, Messages, │
│  Activities, AI Tool Calls, Widget Visits     │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│         Feature Engineering Worker            │
│         (BullMQ — nightly + on-demand)        │
│                                              │
│  Lead Features:          Agent Features:      │
│  • Response time         • Conv rate/dept     │
│  • Msg count             • Avg close time     │
│  • Source score           • Specialties       │
│  • Travel proximity      • Active load        │
│  • Sentiment             • Satisfaction        │
│  • Passenger count       • Follow-up rate     │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│              Scoring & Prediction Layer       │
│                                              │
│  Lead Scorer (0-100)    Follow-up Predictor   │
│  Agent Matcher          Conversion Predictor  │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│              Action Layer                     │
│  • Lead score badges on cards/list/detail    │
│  • "Suggested next action" on lead detail    │
│  • Auto-assign to best agent (optional)      │
│  • AI-drafted follow-up messages             │
│  • Predictive dashboard widgets              │
└──────────────────────────────────────────────┘
```

### 5.2 Implementation Approach — No External ML Service

No TensorFlow, PyTorch, or Python needed. The AI provider handles message generation and the rest uses weighted formulas:

1. **Lead scoring:** Weighted formula computed in SQL/TypeScript. Weights initialized from domain knowledge, auto-tuned monthly by comparing scores vs actual conversions.
2. **Optimal timing:** Statistical analysis of historical conversions grouped by hour/day. Stored as lookup tables, refreshed weekly.
3. **Message generation:** AI provider (Phase 2) with context injection — lead details + conversation history + department KB → personalized message.
4. **Agent matching:** Scoring function: `(conv_rate × 0.4) + (specialty_match × 0.3) + (load_inverse × 0.2) + (satisfaction × 0.1)`. Computed per-assignment.

### 5.3 Lead Scorer

**Input Features (Weighted)**

| Category | Weight | Signals |
|----------|--------|---------|
| Engagement | 35% | Messages sent, response speed, follow-ups completed, files shared, widget pages visited |
| Lead Attributes | 25% | Source channel, travel date proximity, passenger count, destination popularity, priority |
| Historical Patterns | 25% | Dept conversion rate, source conversion rate, similar lead outcomes, seasonal trends |
| AI Conversation | 15% | Sentiment score, intent confidence, objection count, questions asked, pricing discussed |

**Output Tiers**

| Score | Tier | Meaning |
|-------|------|---------|
| 76-100 | 🔥 Hot | High intent, prioritize immediately |
| 51-75 | ⚡ Warm | Active engagement, good potential |
| 26-50 | 🌱 Cool | Some interest, needs nurturing |
| 0-25 | ❄️ Cold | Low engagement, unlikely to convert |

### 5.4 Follow-up Predictor

**When to Follow Up**
- Analyzes historical conversion patterns by hour/day/stage/channel
- Output: optimal hour + day to follow up
- Example: "Best time: Tuesday 10:30 AM (72% higher response rate)"

**What to Say**
- AI generates personalized follow-up message using tenant's AI provider
- Context: lead details, conversation history, objections raised, stage
- Example: "Hi Rajan, the July Chardham slots are filling up — shall I hold 6 seats for your group?"

**Who to Assign**
- Matches lead profile to agent strengths
- Factors: agent conversion rate for similar leads, current load, department, language
- Output: ranked list of best-fit agents
- Example: "Priya (87% conv rate for Chardham, 3 active leads)"

### 5.5 New Database Tables

**lead_scores**
- id, tenant_id, lead_id (unique)
- score (0-100)
- tier (HOT | WARM | COOL | COLD)
- engagement_score, attribute_score, historical_score, conversation_score
- factors (JSON: breakdown of scoring reasons)
- computed_at, expires_at

**predictions**
- id, tenant_id, lead_id
- type (FOLLOW_UP_TIME | AGENT_MATCH | CONVERSION_PROB | MESSAGE_DRAFT)
- value (JSON: prediction result)
- confidence (0-1)
- reasoning (text: human-readable explanation)
- accepted (boolean: did agent use this prediction?)
- outcome (JSON: what actually happened)
- computed_at

**scoring_weights**
- id, tenant_id
- feature_name (e.g., "source_whatsapp", "travel_date_30d")
- weight (float)
- category (ENGAGEMENT | ATTRIBUTE | HISTORICAL | CONVERSATION)
- auto_tuned (boolean)
- last_tuned_at

**conversion_stats**
- id, tenant_id
- dimension (DEPARTMENT | SOURCE | AGENT | HOUR | DAY | STAGE)
- dimension_value
- total_leads, converted_leads, conversion_rate
- avg_time_to_convert, avg_messages
- period_start, period_end
- computed_at

### 5.6 New Workers

**scoring.worker.ts**
- Recomputes lead scores
- Triggers: lead created, stage changed, message received, follow-up completed
- Also runs nightly batch for all active leads
- Queue: `scoring`

**analytics.worker.ts**
- Refreshes conversion_stats aggregations
- Auto-tunes scoring_weights by comparing predicted scores vs actual outcomes
- Runs weekly
- Queue: `analytics`

### 5.7 New Module Structure

```
src/modules/analytics/
├── lead-scorer.service.ts          # Compute lead scores
├── follow-up-predictor.service.ts  # Predict optimal timing + draft messages
├── agent-matcher.service.ts        # Recommend best agent for lead
├── conversion-stats.service.ts     # Aggregate historical conversion data
├── weight-tuner.service.ts         # Auto-tune scoring weights from outcomes
└── prediction.service.ts           # CRUD predictions, track acceptance/outcomes

src/workers/
├── scoring.worker.ts               # Lead score computation
└── analytics.worker.ts             # Stats aggregation + weight tuning
```

### 5.8 New API Routes

```
GET    /api/leads/[id]/score         # Get lead score + breakdown
POST   /api/leads/[id]/score/refresh # Force recompute score
GET    /api/leads/[id]/predictions   # Get all predictions for lead
POST   /api/leads/[id]/predictions/[predId]/accept  # Mark prediction as accepted
POST   /api/leads/[id]/predictions/[predId]/outcome  # Record actual outcome
GET    /api/leads/[id]/suggested-agent   # Get best agent recommendation
POST   /api/leads/[id]/draft-followup    # AI-generate follow-up message

GET    /api/analytics/conversion-stats   # Get aggregated conversion stats
GET    /api/analytics/scoring-weights    # View current scoring weights
PUT    /api/analytics/scoring-weights    # Override scoring weights
POST   /api/analytics/tune              # Trigger manual weight tuning
GET    /api/analytics/prediction-accuracy  # Prediction vs outcome stats
```

### 5.9 Feedback Loop (Self-Improving)

1. **Predict:** Score lead at 78 (Hot), suggest follow-up Tuesday 10am, recommend Agent Priya
2. **Track:** Was the prediction accepted? Did the agent use the drafted message? Was the follow-up sent at suggested time?
3. **Outcome:** Did the lead convert? How long did it take? What stage did it reach?
4. **Tune:** Weekly worker compares predictions vs outcomes → adjusts scoring_weights

After 3-6 months of data, scoring becomes highly accurate for each tenant's specific patterns.

### 5.10 New UI Elements

**Lead List & Detail**
- Score badge (colored circle: 🔥85) on every lead card
- Sort/filter leads by score tier
- Lead detail: "AI Insights" panel — score breakdown, suggested action, best follow-up time, recommended agent
- "Draft Follow-up" button → AI generates message → agent edits & sends

**Dashboard Widgets**
- Score Distribution: Pie chart of Hot/Warm/Cool/Cold leads
- Prediction Accuracy: How often ML predictions match outcomes
- AI Cost Tracker: Tokens used, cost per conversation, per department
- Agent Fit Score: How well assignments match ML recommendations

**Follow-up Queue**
- "Suggested" tab — ML-recommended follow-ups not yet created
- Each suggestion shows: lead, best time, draft message, confidence
- One-click approve → creates follow-up with AI message

**Settings → Analytics**
- Toggle auto-assignment by ML recommendation
- View/override scoring weights per category
- Enable/disable AI follow-up suggestions
- Set minimum confidence threshold for predictions

---

## 6. Enum Updates Summary

### ConversationChannel
```
Before: MANUAL
After:  MANUAL | WHATSAPP | FACEBOOK | INSTAGRAM | EMAIL | SMS | TELEGRAM | WEBSITE
```

### New Enums

```
AIProviderType:    CLAUDE | OPENAI | GEMINI | CUSTOM
KnowledgeBaseType: FAQ | SOP | PRICING | DOCUMENT | CUSTOM
AIToolCallStatus:  SUCCESS | FAILED
DeliveryStatus:    SENT | DELIVERED | READ | FAILED
WebhookLogStatus:  PROCESSED | FAILED | IGNORED
LeadScoreTier:     HOT | WARM | COOL | COLD
PredictionType:    FOLLOW_UP_TIME | AGENT_MATCH | CONVERSION_PROB | MESSAGE_DRAFT
StatsDimension:    DEPARTMENT | SOURCE | AGENT | HOUR | DAY | STAGE
WidgetPosition:    BOTTOM_RIGHT | BOTTOM_LEFT
WidgetButtonIcon:  CHAT | HELP | CUSTOM
WeightCategory:    ENGAGEMENT | ATTRIBUTE | HISTORICAL | CONVERSATION
```

---

## 7. New Tables Summary (All Phases)

| Phase | Table | Purpose |
|-------|-------|---------|
| 2 | ai_providers | Per-tenant AI provider config (encrypted keys) |
| 2 | knowledge_bases | Per-department FAQ/SOP/pricing content + embeddings |
| 2 | ai_conversations | AI conversation metadata (tokens, cost, handoff) |
| 2 | ai_tool_calls | Track AI function calls (create_lead, etc.) |
| 3 | channel_configs | Per-tenant channel credentials (encrypted) |
| 3 | customer_channels | Map external IDs (phone, PSID, email) to customers |
| 3 | message_delivery | Track outbound delivery status per message |
| 3 | webhook_logs | Debug log for inbound webhooks (30-day retention) |
| 4 | widget_configs | Per-department widget customization + quick actions |
| 4 | widget_visitors | Anonymous visitor tracking before identification |
| 5 | lead_scores | Computed lead quality scores (0-100 + tier) |
| 5 | predictions | All ML predictions with acceptance + outcome tracking |
| 5 | scoring_weights | Tunable scoring weights per tenant |
| 5 | conversion_stats | Pre-aggregated conversion stats for fast predictions |

**Total new tables:** 14

---

## 8. New Workers Summary

| Worker | Queue | Schedule | Purpose |
|--------|-------|----------|---------|
| scoring.worker.ts | scoring | Event-driven + nightly | Compute/refresh lead scores |
| analytics.worker.ts | analytics | Weekly | Aggregate stats + tune weights |

**Added to existing worker container** — no new Docker service needed.

---

## 9. Dependencies (New Packages)

| Package | Phase | Purpose |
|---------|-------|---------|
| `@anthropic-ai/sdk` | 2 | Claude API adapter |
| `openai` | 2 | OpenAI API adapter |
| `@google/generative-ai` | 2 | Gemini API adapter |
| (no new packages) | 3 | All channels use `fetch` — Meta/Twilio/Telegram APIs are REST |
| (no new packages) | 4 | Widget is vanilla JS + existing React/Socket.io |
| (no new packages) | 5 | Scoring is TypeScript + SQL — no ML libraries |

**Total new dependencies:** 3 (all AI SDKs for Phase 2)

---

## 10. Phase Dependencies

```
Phase 1 (complete) ──→ Phase 2 (AI Chatbot)
                            │
                            ├──→ Phase 3 (Multichannel)
                            │         │
                            │         └──→ Phase 4 (Widget)
                            │
                            └──→ Phase 5 (Analytics)
```

- Phase 2 must be built first (AI engine used by all subsequent phases)
- Phase 3 depends on Phase 2 (AI handles inbound channel messages)
- Phase 4 depends on Phase 3 (widget is a WEBSITE channel adapter)
- Phase 5 depends on Phase 2 (uses AI provider for message generation) but can be built in parallel with Phase 3/4
- Recommended build order: Phase 2 → Phase 3 → Phase 4 → Phase 5

---

## 11. Security Considerations

- **API keys encrypted at rest** in ai_providers and channel_configs (AES-256-GCM, key from env)
- **Webhook signatures verified** before processing any inbound message
- **Visitor JWT** for widget sessions — short-lived (24h), limited scope (read own conversation only)
- **Rate limiting** on all new endpoints (100/min per user, 30/sec per webhook source)
- **Tenant isolation** enforced on all 14 new tables via Prisma middleware
- **AI prompt injection defense** — user messages sanitized before injection into AI prompts
- **File upload validation** maintained for widget uploads (same Phase 1 rules: 10MB, allowed types)
- **Webhook log auto-purge** — 30-day retention to prevent storage bloat
