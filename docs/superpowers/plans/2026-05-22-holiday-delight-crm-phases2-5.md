# Holiday Delight CRM — Phases 2-5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the manual CRM into an AI-powered, multichannel, self-improving sales platform across 4 phases.

**Architecture:** Provider-agnostic AI engine (Phase 2) feeds into 6-channel unified inbox (Phase 3) and embeddable website widget (Phase 4), with ML lead scoring and predictive follow-ups (Phase 5). No external ML services — scoring uses weighted formulas, message generation uses the AI provider.

**Tech Stack:** Next.js 16 / Prisma 7 / PostgreSQL 16 / Redis 7 / BullMQ / Socket.io / Anthropic SDK / OpenAI SDK / Google GenAI SDK

**Spec:** `docs/superpowers/specs/2026-05-22-holiday-delight-crm-phases2-5-design.md`

**Build Order:** Phase 2 → Phase 3 → Phase 4 → Phase 5

---

## Phase 2: AI Chatbot (Tasks 1-13)

### Task 1: Schema — AI enums and tables

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add new enums to Prisma schema**

Add after existing enums:

```prisma
enum AIProviderType {
  CLAUDE
  OPENAI
  GEMINI
  CUSTOM
}

enum KnowledgeBaseType {
  FAQ
  SOP
  PRICING
  DOCUMENT
  CUSTOM
}

enum AIToolCallStatus {
  SUCCESS
  FAILED
}
```

- [ ] **Step 2: Add ai_providers model**

```prisma
model AIProvider {
  id        String         @id @default(uuid()) @map("id")
  tenantId  String         @map("tenant_id")
  provider  AIProviderType @map("provider")
  apiKey    String         @map("api_key") // encrypted at app layer
  modelName String         @map("model_name")
  config    Json?          @map("config") // { temperature, maxTokens, etc. }
  isActive  Boolean        @default(true) @map("is_active")
  createdAt DateTime       @default(now()) @map("created_at")
  updatedAt DateTime       @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@map("ai_providers")
}
```

- [ ] **Step 3: Add knowledge_bases model**

```prisma
model KnowledgeBase {
  id             String            @id @default(uuid()) @map("id")
  tenantId       String            @map("tenant_id")
  departmentId   String            @map("department_id")
  type           KnowledgeBaseType @map("type")
  title          String            @map("title")
  content        String            @map("content") @db.Text
  embedding      Json?             @map("embedding") // Float[] stored as JSON
  embeddingModel String?           @map("embedding_model")
  isActive       Boolean           @default(true) @map("is_active")
  createdAt      DateTime          @default(now()) @map("created_at")
  updatedAt      DateTime          @updatedAt @map("updated_at")

  tenant     Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  department Department @relation(fields: [departmentId], references: [id])

  @@index([tenantId])
  @@index([tenantId, departmentId])
  @@map("knowledge_bases")
}
```

- [ ] **Step 4: Add ai_conversations and ai_tool_calls models**

```prisma
model AIConversation {
  id               String   @id @default(uuid()) @map("id")
  tenantId         String   @map("tenant_id")
  conversationId   String   @map("conversation_id")
  providerUsed     String   @map("provider_used")
  modelUsed        String   @map("model_used")
  totalTokens      Int      @default(0) @map("total_tokens")
  totalCost        Float    @default(0) @map("total_cost")
  handoffReason    String?  @map("handoff_reason")
  satisfactionScore Int?    @map("satisfaction_score")
  createdAt        DateTime @default(now()) @map("created_at")

  tenant       Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  toolCalls    AIToolCall[]

  @@index([tenantId])
  @@index([conversationId])
  @@map("ai_conversations")
}

model AIToolCall {
  id                 String           @id @default(uuid()) @map("id")
  tenantId           String           @map("tenant_id")
  aiConversationId   String           @map("ai_conversation_id")
  toolName           String           @map("tool_name")
  input              Json             @map("input")
  output             Json?            @map("output")
  status             AIToolCallStatus @map("status")
  createdAt          DateTime         @default(now()) @map("created_at")

  tenant         Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  aiConversation AIConversation @relation(fields: [aiConversationId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([aiConversationId])
  @@map("ai_tool_calls")
}
```

- [ ] **Step 5: Add reverse relations to existing models**

Add to `Tenant` model:
```prisma
  aiProviders      AIProvider[]
  knowledgeBases   KnowledgeBase[]
  aiConversations  AIConversation[]
  aiToolCalls      AIToolCall[]
```

Add to `Conversation` model:
```prisma
  aiConversations AIConversation[]
```

Add to `Department` model:
```prisma
  knowledgeBases KnowledgeBase[]
```

- [ ] **Step 6: Update tenantPrisma modelsWithTenant array**

In `src/lib/prisma.ts`, find the `modelsWithTenant` array and add:
```typescript
"aIProvider", "knowledgeBase", "aIConversation", "aIToolCall"
```
This ensures tenant isolation works on all new tables.

- [ ] **Step 7: Run migration**

Run: `npx prisma migrate dev --name add_ai_chatbot_tables`
Expected: Migration created and applied successfully.

- [ ] **Step 8: Commit**

```bash
git add prisma/ src/lib/prisma.ts
git commit -m "feat(phase2): add AI chatbot schema — providers, knowledge bases, conversations, tool calls"
```

---

### Task 2: AI Provider interface and Claude adapter

**Files:**
- Create: `src/modules/ai/providers/provider.interface.ts`
- Create: `src/modules/ai/providers/claude.adapter.ts`
- Create: `src/lib/encryption.ts`

- [ ] **Step 1: Create encryption utility for API keys**

```typescript
// src/lib/encryption.ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(key, "hex");
}

export function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(":");
  if (!ivHex || !authTagHex || !encrypted) {
    throw new Error("Invalid encrypted text format");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

- [ ] **Step 2: Create provider interface**

```typescript
// src/modules/ai/providers/provider.interface.ts
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

export interface ChatChunk {
  type: "text" | "tool_call" | "done";
  content?: string;
  toolCall?: ToolCall;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ChatParams {
  messages: ChatMessage[];
  systemPrompt: string;
  tools?: ToolDefinition[];
  knowledgeContext?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIProvider {
  id: string;
  chat(params: ChatParams): AsyncGenerator<ChatChunk>;
  generateEmbedding(text: string): Promise<number[]>;
}
```

- [ ] **Step 3: Install Anthropic SDK and set up ENCRYPTION_KEY**

Run: `npm install @anthropic-ai/sdk`

Add to `.env` and `.env.example`:
```
ENCRYPTION_KEY=<64 hex characters — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

- [ ] **Step 4: Create Claude adapter**

```typescript
// src/modules/ai/providers/claude.adapter.ts
import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, ChatParams, ChatChunk, ChatMessage } from "./provider.interface";

export class ClaudeAdapter implements AIProvider {
  id = "claude";
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = "claude-sonnet-4-5-20250514") {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatChunk> {
    const systemPrompt = params.knowledgeContext
      ? `${params.systemPrompt}\n\n## Knowledge Base Context\n${params.knowledgeContext}`
      : params.systemPrompt;

    const messages = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const tools = params.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: params.maxTokens || 1024,
      temperature: params.temperature ?? 0.7,
      system: systemPrompt,
      messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "text", content: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          // Tool call argument streaming — accumulate externally
          yield { type: "text", content: "" };
        }
      } else if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          yield {
            type: "tool_call",
            toolCall: {
              id: event.content_block.id,
              name: event.content_block.name,
              arguments: "",
            },
          };
        }
      } else if (event.type === "message_stop") {
        const finalMessage = await stream.finalMessage();
        yield {
          type: "done",
          usage: {
            inputTokens: finalMessage.usage.input_tokens,
            outputTokens: finalMessage.usage.output_tokens,
          },
        };
      }
    }
  }

  async generateEmbedding(_text: string): Promise<number[]> {
    // Claude doesn't have an embedding API — use Voyage or fallback
    // For now, return empty — embedding generation handled separately
    throw new Error("Claude does not support embeddings directly. Use a dedicated embedding model.");
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/encryption.ts src/modules/ai/providers/
git commit -m "feat(phase2): add AI provider interface and Claude adapter with encryption"
```

---

### Task 3: OpenAI and Gemini adapters

**Files:**
- Create: `src/modules/ai/providers/openai.adapter.ts`
- Create: `src/modules/ai/providers/gemini.adapter.ts`
- Create: `src/modules/ai/providers/index.ts`

- [ ] **Step 1: Install SDKs**

Run: `npm install openai @google/generative-ai`

- [ ] **Step 2: Create OpenAI adapter**

```typescript
// src/modules/ai/providers/openai.adapter.ts
import OpenAI from "openai";
import type { AIProvider, ChatParams, ChatChunk } from "./provider.interface";

export class OpenAIAdapter implements AIProvider {
  id = "openai";
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = "gpt-4o") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatChunk> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: params.knowledgeContext
          ? `${params.systemPrompt}\n\n## Knowledge Base Context\n${params.knowledgeContext}`
          : params.systemPrompt,
      },
      ...params.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
    ];

    const tools = params.tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: params.maxTokens || 1024,
      temperature: params.temperature ?? 0.7,
      messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        yield { type: "text", content: delta.content };
      }
      if (delta?.tool_calls?.[0]) {
        const tc = delta.tool_calls[0];
        if (tc.function?.name) {
          yield {
            type: "tool_call",
            toolCall: {
              id: tc.id || "",
              name: tc.function.name,
              arguments: tc.function.arguments || "",
            },
          };
        }
      }
      if (chunk.usage) {
        yield {
          type: "done",
          usage: {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          },
        };
      }
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  }
}
```

- [ ] **Step 3: Create Gemini adapter**

```typescript
// src/modules/ai/providers/gemini.adapter.ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIProvider, ChatParams, ChatChunk } from "./provider.interface";

export class GeminiAdapter implements AIProvider {
  id = "gemini";
  private genAI: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model: string = "gemini-2.0-flash") {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatChunk> {
    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: params.knowledgeContext
        ? `${params.systemPrompt}\n\n## Knowledge Base Context\n${params.knowledgeContext}`
        : params.systemPrompt,
    });

    const history = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const lastMessage = history.pop();
    if (!lastMessage) {
      yield { type: "done", usage: { inputTokens: 0, outputTokens: 0 } };
      return;
    }

    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(lastMessage.parts);

    let totalText = "";
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        totalText += text;
        yield { type: "text", content: text };
      }
    }

    const response = await result.response;
    const usage = response.usageMetadata;
    yield {
      type: "done",
      usage: {
        inputTokens: usage?.promptTokenCount || 0,
        outputTokens: usage?.candidatesTokenCount || 0,
      },
    };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const model = this.genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    return result.embedding.values;
  }
}
```

- [ ] **Step 4: Create provider factory**

```typescript
// src/modules/ai/providers/index.ts
import type { AIProvider } from "./provider.interface";
import { ClaudeAdapter } from "./claude.adapter";
import { OpenAIAdapter } from "./openai.adapter";
import { GeminiAdapter } from "./gemini.adapter";
import { decrypt } from "@/lib/encryption";

export type { AIProvider, ChatParams, ChatChunk, ChatMessage, ToolDefinition, ToolCall } from "./provider.interface";

export function createProvider(
  provider: string,
  encryptedApiKey: string,
  modelName: string
): AIProvider {
  const apiKey = decrypt(encryptedApiKey);

  switch (provider) {
    case "CLAUDE":
      return new ClaudeAdapter(apiKey, modelName);
    case "OPENAI":
      return new OpenAIAdapter(apiKey, modelName);
    case "GEMINI":
      return new GeminiAdapter(apiKey, modelName);
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai/providers/
git commit -m "feat(phase2): add OpenAI and Gemini adapters with provider factory"
```

---

### Task 4: Knowledge base service and API routes

**Files:**
- Create: `src/modules/ai/knowledge-base.service.ts`
- Create: `src/app/api/knowledge-base/route.ts`
- Create: `src/app/api/knowledge-base/[id]/route.ts`
- Create: `src/app/api/knowledge-base/import/route.ts`

- [ ] **Step 1: Create knowledge base service**

```typescript
// src/modules/ai/knowledge-base.service.ts
import type { tenantPrisma } from "@/lib/prisma";

type TenantDb = ReturnType<typeof tenantPrisma>;

export async function listKnowledgeBases(
  db: TenantDb,
  filters: { departmentId?: string; type?: string; isActive?: boolean }
) {
  const where: Record<string, unknown> = {};
  if (filters.departmentId) where.departmentId = filters.departmentId;
  if (filters.type) where.type = filters.type;
  if (filters.isActive !== undefined) where.isActive = filters.isActive;

  return db.knowledgeBase.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      department: { select: { id: true, name: true, color: true } },
    },
  });
}

export async function createKnowledgeBase(
  db: TenantDb,
  data: {
    departmentId: string;
    type: string;
    title: string;
    content: string;
  }
) {
  return db.knowledgeBase.create({
    data: {
      departmentId: data.departmentId,
      type: data.type as "FAQ" | "SOP" | "PRICING" | "DOCUMENT" | "CUSTOM",
      title: data.title,
      content: data.content,
      isActive: true,
    },
  });
}

export async function updateKnowledgeBase(
  db: TenantDb,
  id: string,
  data: { title?: string; content?: string; type?: string; isActive?: boolean }
) {
  return db.knowledgeBase.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.content !== undefined && { content: data.content }),
      ...(data.type !== undefined && { type: data.type as "FAQ" | "SOP" | "PRICING" | "DOCUMENT" | "CUSTOM" }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      // Clear embedding when content changes — will be recomputed
      ...(data.content !== undefined && { embedding: null, embeddingModel: null }),
    },
  });
}

export async function deleteKnowledgeBase(db: TenantDb, id: string) {
  return db.knowledgeBase.delete({ where: { id } });
}

export async function getKnowledgeBaseContext(
  db: TenantDb,
  departmentId: string
): Promise<string> {
  const entries = await db.knowledgeBase.findMany({
    where: { departmentId, isActive: true },
    orderBy: { type: "asc" },
    select: { type: true, title: true, content: true },
  });

  if (entries.length === 0) return "";

  return entries
    .map((e) => `### ${e.type}: ${e.title}\n${e.content}`)
    .join("\n\n");
}
```

- [ ] **Step 2: Create list/create API route**

```typescript
// src/app/api/knowledge-base/route.ts
import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { listKnowledgeBases, createKnowledgeBase } from "@/modules/ai/knowledge-base.service";

export async function GET(req: Request) {
  try {
    const { user, db } = await requirePermission("settings:general");
    const { searchParams } = new URL(req.url);
    const departmentId = searchParams.get("departmentId") || undefined;
    const type = searchParams.get("type") || undefined;

    // Dept managers can only see their department's KB
    const effectiveDeptId =
      user.role === "DEPT_MANAGER" && user.departmentId
        ? user.departmentId
        : departmentId;

    const entries = await listKnowledgeBases(db, {
      departmentId: effectiveDeptId,
      type,
      isActive: true,
    });

    return NextResponse.json({ entries });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return unauthorized();
    if (error instanceof Error && error.message === "Forbidden") return forbidden();
    return NextResponse.json({ error: "Failed to list knowledge base" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { db } = await requirePermission("settings:general");
    const body = await req.json();
    const { departmentId, type, title, content } = body;

    if (!departmentId || !type || !title || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const entry = await createKnowledgeBase(db, { departmentId, type, title, content });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return unauthorized();
    if (error instanceof Error && error.message === "Forbidden") return forbidden();
    return NextResponse.json({ error: "Failed to create knowledge base entry" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create single-entry API route**

```typescript
// src/app/api/knowledge-base/[id]/route.ts
import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { updateKnowledgeBase, deleteKnowledgeBase } from "@/modules/ai/knowledge-base.service";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await requirePermission("settings:general");
    const { id } = await params;
    const body = await req.json();
    const entry = await updateKnowledgeBase(db, id, body);
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return unauthorized();
    if (error instanceof Error && error.message === "Forbidden") return forbidden();
    return NextResponse.json({ error: "Failed to update knowledge base entry" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await requirePermission("settings:general");
    const { id } = await params;
    await deleteKnowledgeBase(db, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return unauthorized();
    if (error instanceof Error && error.message === "Forbidden") return forbidden();
    return NextResponse.json({ error: "Failed to delete knowledge base entry" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Create bulk import route**

```typescript
// src/app/api/knowledge-base/import/route.ts
import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";

export async function POST(req: Request) {
  try {
    const { db } = await requirePermission("settings:general");
    const body = await req.json();
    const { departmentId, entries } = body;

    if (!departmentId || !Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: "departmentId and entries[] required" }, { status: 400 });
    }

    const created = await (db.knowledgeBase.createMany as Function)({
      data: entries.map((e: { type: string; title: string; content: string }) => ({
        departmentId,
        type: e.type || "FAQ",
        title: e.title,
        content: e.content,
        isActive: true,
      })),
    });

    return NextResponse.json({ count: created.count }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return unauthorized();
    if (error instanceof Error && error.message === "Forbidden") return forbidden();
    return NextResponse.json({ error: "Failed to import" }, { status: 500 });
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai/knowledge-base.service.ts src/app/api/knowledge-base/
git commit -m "feat(phase2): add knowledge base service and API routes (CRUD + bulk import)"
```

---

### Task 5: AI tools — CRM actions the bot can perform

**Files:**
- Create: `src/modules/ai/tools/tool.interface.ts`
- Create: `src/modules/ai/tools/create-lead.tool.ts`
- Create: `src/modules/ai/tools/lookup-lead.tool.ts`
- Create: `src/modules/ai/tools/check-availability.tool.ts`
- Create: `src/modules/ai/tools/get-pricing.tool.ts`
- Create: `src/modules/ai/tools/schedule-callback.tool.ts`
- Create: `src/modules/ai/tools/handoff.tool.ts`
- Create: `src/modules/ai/tools/index.ts`

- [ ] **Step 1: Create tool interface**

```typescript
// src/modules/ai/tools/tool.interface.ts
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
```

- [ ] **Step 2: Create create-lead tool**

```typescript
// src/modules/ai/tools/create-lead.tool.ts
import type { AITool, ToolContext, ToolResult } from "./tool.interface";
import { createLead, type CreateLeadData } from "@/modules/leads/leads.service";

export const createLeadTool: AITool = {
  definition: {
    name: "create_lead",
    description: "Create a new lead/inquiry in the CRM when a customer expresses interest in a travel package or service. Use when the customer provides their name, phone number, and travel interest.",
    parameters: {
      type: "object",
      properties: {
        customerName: { type: "string", description: "Customer's full name" },
        customerMobile: { type: "string", description: "Customer's phone number" },
        customerEmail: { type: "string", description: "Customer's email (optional)" },
        destination: { type: "string", description: "Travel destination or service requested" },
        travelDate: { type: "string", description: "Preferred travel date (ISO format)" },
        numPassengers: { type: "number", description: "Number of travellers" },
        specialRequirement: { type: "string", description: "Any special requests" },
      },
      required: ["customerName", "customerMobile"],
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const data: CreateLeadData = {
        customerName: args.customerName as string,
        customerMobile: args.customerMobile as string,
        customerEmail: (args.customerEmail as string) || null,
        departmentId: ctx.departmentId,
        destination: (args.destination as string) || null,
        travelDate: (args.travelDate as string) || null,
        numPassengers: (args.numPassengers as number) || null,
        specialRequirement: (args.specialRequirement as string) || null,
        source: "WEBSITE",
        tenantId: ctx.tenantId,
      };

      const lead = await createLead(ctx.db, data, "system");
      return {
        success: true,
        data: { leadId: lead.id },
        message: `Lead created successfully for ${args.customerName}. A team member will follow up.`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create lead: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
};
```

- [ ] **Step 3: Create check-availability, lookup-lead, get-pricing, schedule-callback, and handoff tools**

```typescript
// src/modules/ai/tools/check-availability.tool.ts
import type { AITool, ToolContext, ToolResult } from "./tool.interface";

export const checkAvailabilityTool: AITool = {
  definition: {
    name: "check_availability",
    description: "Check availability of travel packages or services for specific dates and passenger counts.",
    parameters: {
      type: "object",
      properties: {
        destination: { type: "string", description: "Travel destination or package name" },
        travelDate: { type: "string", description: "Desired travel date (ISO format)" },
        numPassengers: { type: "number", description: "Number of travellers" },
      },
      required: ["destination"],
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    // Search knowledge base for availability info
    const entries = await ctx.db.knowledgeBase.findMany({
      where: {
        departmentId: ctx.departmentId,
        type: { in: ["PRICING", "FAQ", "DOCUMENT"] },
        isActive: true,
      },
    });

    const query = (args.destination as string).toLowerCase();
    const matching = entries.filter(
      (e) => e.title.toLowerCase().includes(query) || e.content.toLowerCase().includes(query)
    );

    if (matching.length === 0) {
      return {
        success: true,
        data: { found: false },
        message: "I don't have specific availability data for that destination. Let me connect you with a specialist who can check in real-time.",
      };
    }

    return {
      success: true,
      data: { entries: matching.map((e) => ({ title: e.title, content: e.content })) },
      message: matching.map((e) => `${e.title}: ${e.content}`).join("\n"),
    };
  },
};
```

```typescript
// src/modules/ai/tools/lookup-lead.tool.ts
import type { AITool, ToolContext, ToolResult } from "./tool.interface";

export const lookupLeadTool: AITool = {
  definition: {
    name: "lookup_lead",
    description: "Look up an existing customer or lead by phone number or email to check if they have contacted us before.",
    parameters: {
      type: "object",
      properties: {
        phone: { type: "string", description: "Phone number to search" },
        email: { type: "string", description: "Email to search" },
      },
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const where: Record<string, unknown> = {};
    if (args.phone) where.mobile = args.phone;
    if (args.email) where.email = args.email;

    if (Object.keys(where).length === 0) {
      return { success: false, message: "Provide phone or email to search" };
    }

    const customer = await (ctx.db.customer.findFirst as Function)({
      where,
      include: {
        leads: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { id: true, destination: true, travelDate: true, createdAt: true },
        },
      },
    });

    if (!customer) {
      return { success: true, data: { found: false }, message: "No existing customer found." };
    }

    return {
      success: true,
      data: {
        found: true,
        customerId: customer.id,
        name: customer.name,
        totalLeads: customer.leads.length,
        recentLeads: customer.leads,
      },
      message: `Found existing customer: ${customer.name} with ${customer.leads.length} previous inquiries.`,
    };
  },
};
```

```typescript
// src/modules/ai/tools/get-pricing.tool.ts
import type { AITool, ToolContext, ToolResult } from "./tool.interface";

export const getPricingTool: AITool = {
  definition: {
    name: "get_pricing",
    description: "Retrieve pricing information for a specific package or service from the department's knowledge base.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What pricing to look up (e.g., 'Chardham Yatra package')" },
      },
      required: ["query"],
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const entries = await ctx.db.knowledgeBase.findMany({
      where: {
        departmentId: ctx.departmentId,
        type: "PRICING",
        isActive: true,
      },
    });

    const query = (args.query as string).toLowerCase();
    const matching = entries.filter(
      (e) =>
        e.title.toLowerCase().includes(query) ||
        e.content.toLowerCase().includes(query)
    );

    if (matching.length === 0) {
      return {
        success: true,
        data: { found: false },
        message: "No specific pricing found. Suggest the customer speak with a specialist.",
      };
    }

    return {
      success: true,
      data: { entries: matching.map((e) => ({ title: e.title, content: e.content })) },
      message: matching.map((e) => `${e.title}: ${e.content}`).join("\n"),
    };
  },
};
```

```typescript
// src/modules/ai/tools/schedule-callback.tool.ts
import type { AITool, ToolContext, ToolResult } from "./tool.interface";

export const scheduleCallbackTool: AITool = {
  definition: {
    name: "schedule_callback",
    description: "Schedule a callback for the customer. Use when they want someone to call them back.",
    parameters: {
      type: "object",
      properties: {
        preferredTime: { type: "string", description: "When the customer wants to be called (ISO datetime or description like 'tomorrow morning')" },
        notes: { type: "string", description: "What the callback is about" },
      },
      required: ["preferredTime"],
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    try {
      // Find a lead linked to this conversation to satisfy the required leadId FK
      const conversation = await (ctx.db.conversation.findUnique as Function)({
        where: { id: ctx.conversationId },
        select: { leadId: true },
      });

      if (!conversation?.leadId) {
        return {
          success: false,
          message: "I'll need your name and phone number first before scheduling a callback. Could you share those?",
        };
      }

      const callback = await (ctx.db.callback.create as Function)({
        data: {
          departmentId: ctx.departmentId,
          preferredTime: new Date(args.preferredTime as string),
          status: "SCHEDULED",
          notes: (args.notes as string) || "Requested via chat",
          leadId: conversation.leadId,
        },
      });

      return {
        success: true,
        data: { callbackId: callback.id },
        message: "Callback scheduled. Our team will call you at the requested time.",
      };
    } catch (error) {
      return { success: false, message: "Could not schedule callback. Please try again." };
    }
  },
};
```

```typescript
// src/modules/ai/tools/handoff.tool.ts
import type { AITool, ToolContext, ToolResult } from "./tool.interface";

export const handoffTool: AITool = {
  definition: {
    name: "handoff_to_agent",
    description: "Transfer the conversation to a live human agent. Use when: customer explicitly requests a person, the query is too complex, involves payment/billing, or complaints.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why the handoff is happening" },
        summary: { type: "string", description: "Summary of conversation so far for the agent" },
      },
      required: ["reason", "summary"],
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    // Update conversation status to HUMAN_TAKEOVER
    await (ctx.db.conversation.update as Function)({
      where: { id: ctx.conversationId },
      data: { status: "HUMAN_TAKEOVER" },
    });

    return {
      success: true,
      data: {
        handoffReason: args.reason,
        summary: args.summary,
      },
      message: "I'm connecting you with a team member who can help further. They'll have the full context of our conversation.",
    };
  },
};
```

- [ ] **Step 4: Create tool registry**

```typescript
// src/modules/ai/tools/index.ts
import type { AITool } from "./tool.interface";
import { createLeadTool } from "./create-lead.tool";
import { checkAvailabilityTool } from "./check-availability.tool";
import { lookupLeadTool } from "./lookup-lead.tool";
import { getPricingTool } from "./get-pricing.tool";
import { scheduleCallbackTool } from "./schedule-callback.tool";
import { handoffTool } from "./handoff.tool";

export type { AITool, ToolContext, ToolResult } from "./tool.interface";

export const allTools: AITool[] = [
  createLeadTool,
  checkAvailabilityTool,
  lookupLeadTool,
  getPricingTool,
  scheduleCallbackTool,
  handoffTool,
];

export function getToolByName(name: string): AITool | undefined {
  return allTools.find((t) => t.definition.name === name);
}

export function getToolDefinitions() {
  return allTools.map((t) => t.definition);
}
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai/tools/
git commit -m "feat(phase2): add AI tools — create lead, lookup, pricing, callback, handoff"
```

---

### Task 6: Context builder and AI router services

**Files:**
- Create: `src/modules/ai/context-builder.service.ts`
- Create: `src/modules/ai/ai-router.service.ts`

- [ ] **Step 1: Create context builder — assembles prompt context from KB + history**

```typescript
// src/modules/ai/context-builder.service.ts
import type { tenantPrisma } from "@/lib/prisma";
import type { ChatMessage } from "./providers/provider.interface";
import { getKnowledgeBaseContext } from "./knowledge-base.service";

type TenantDb = ReturnType<typeof tenantPrisma>;

export async function buildSystemPrompt(
  db: TenantDb,
  departmentId: string,
  tenantId: string
): Promise<string> {
  const [department, tenant] = await Promise.all([
    (db.department.findUnique as Function)({
      where: { id: departmentId },
      select: { name: true, description: true, contactEmail: true, contactPhone: true },
    }),
    (db.tenant.findUnique as Function)({
      where: { id: tenantId },
      select: { name: true, productName: true },
    }),
  ]);

  const companyName = tenant?.productName || tenant?.name || "our company";
  const deptName = department?.name || "our team";

  return `You are a helpful customer service assistant for ${companyName}, specifically for the ${deptName} department.

## Your Role
- Answer questions about our services, pricing, and availability using the knowledge base provided.
- Capture customer contact details (name, phone number) naturally during conversation.
- Create leads when customers express interest in a service.
- Schedule callbacks when requested.
- Transfer to a human agent when you cannot help or the customer requests it.

## Rules
- Be friendly, professional, and concise.
- Never make up information — only use what is in the knowledge base.
- If you don't know something, say so and offer to connect them with a specialist.
- Always ask for the customer's name and phone number before creating a lead.
- If the customer mentions complaints, refunds, or legal matters, immediately hand off to an agent.
- Respond in the same language the customer uses.

## Department Contact
${department?.contactEmail ? `Email: ${department.contactEmail}` : ""}
${department?.contactPhone ? `Phone: ${department.contactPhone}` : ""}`;
}

export async function buildKnowledgeContext(
  db: TenantDb,
  departmentId: string
): Promise<string> {
  return getKnowledgeBaseContext(db, departmentId);
}

export async function buildConversationHistory(
  db: TenantDb,
  conversationId: string,
  limit: number = 20
): Promise<ChatMessage[]> {
  const messages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      content: true,
      senderType: true,
      createdAt: true,
    },
  });

  return messages.reverse().map((m) => ({
    role: m.senderType === "CUSTOMER" ? "user" as const : "assistant" as const,
    content: m.content,
  }));
}
```

- [ ] **Step 2: Create AI router — decides AI vs human**

```typescript
// src/modules/ai/ai-router.service.ts
import type { tenantPrisma } from "@/lib/prisma";

type TenantDb = ReturnType<typeof tenantPrisma>;

const ESCALATION_KEYWORDS = [
  "complaint", "refund", "cancel", "legal", "lawyer",
  "sue", "court", "fraud", "scam", "police",
];

const HUMAN_REQUEST_PATTERNS = [
  "speak to a person", "talk to someone", "human agent",
  "real person", "speak to agent", "connect me to",
  "talk to a human", "live agent", "customer service",
];

export type RoutingDecision = {
  route: "ai" | "human";
  reason?: string;
};

export function shouldRouteToAI(
  message: string,
  conversationStatus: string
): RoutingDecision {
  // If conversation is already in human takeover, keep routing to human
  if (conversationStatus === "HUMAN_TAKEOVER") {
    return { route: "human", reason: "Conversation already handed off to agent" };
  }

  const lowerMsg = message.toLowerCase();

  // Check for explicit human request
  for (const pattern of HUMAN_REQUEST_PATTERNS) {
    if (lowerMsg.includes(pattern)) {
      return { route: "human", reason: "Customer requested human agent" };
    }
  }

  // Check for escalation keywords
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lowerMsg.includes(keyword)) {
      return { route: "human", reason: `Escalation keyword detected: ${keyword}` };
    }
  }

  // Default: route to AI
  return { route: "ai" };
}

export async function getActiveProvider(db: TenantDb) {
  return (db.aIProvider.findFirst as Function)({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/ai/context-builder.service.ts src/modules/ai/ai-router.service.ts
git commit -m "feat(phase2): add context builder and AI router services"
```

---

### Task 7: AI chat service — orchestrates AI conversations

**Files:**
- Create: `src/modules/ai/ai-chat.service.ts`

- [ ] **Step 1: Create the main AI chat orchestration service**

```typescript
// src/modules/ai/ai-chat.service.ts
import type { tenantPrisma } from "@/lib/prisma";
import { createProvider } from "./providers";
import type { ChatMessage, ChatChunk } from "./providers/provider.interface";
import { buildSystemPrompt, buildKnowledgeContext, buildConversationHistory } from "./context-builder.service";
import { getActiveProvider, shouldRouteToAI } from "./ai-router.service";
import { getToolDefinitions, getToolByName, type ToolContext } from "./tools";
import { publishEvent } from "@/lib/redis";

type TenantDb = ReturnType<typeof tenantPrisma>;

interface AIChatParams {
  db: TenantDb;
  tenantId: string;
  conversationId: string;
  departmentId: string;
  customerMessage: string;
  customerId?: string;
}

export async function processAIMessage(
  params: AIChatParams
): Promise<{ response: string; handoff: boolean; toolResults: Array<{ tool: string; result: unknown }> }> {
  const { db, tenantId, conversationId, departmentId, customerMessage, customerId } = params;

  // Check routing
  const conversation = await (db.conversation.findUnique as Function)({
    where: { id: conversationId },
    select: { status: true },
  });

  const routing = shouldRouteToAI(customerMessage, conversation?.status || "ACTIVE");
  if (routing.route === "human") {
    return {
      response: "Let me connect you with a team member. Please hold on.",
      handoff: true,
      toolResults: [],
    };
  }

  // Get AI provider
  const providerConfig = await getActiveProvider(db);
  if (!providerConfig) {
    return {
      response: "Our chat service is currently being set up. Please call us directly for assistance.",
      handoff: false,
      toolResults: [],
    };
  }

  const provider = createProvider(
    providerConfig.provider,
    providerConfig.apiKey,
    providerConfig.modelName
  );

  // Build context
  const [systemPrompt, knowledgeContext, history] = await Promise.all([
    buildSystemPrompt(db, departmentId, tenantId),
    buildKnowledgeContext(db, departmentId),
    buildConversationHistory(db, conversationId),
  ]);

  // Add current customer message
  const messages: ChatMessage[] = [
    ...history,
    { role: "user", content: customerMessage },
  ];

  // Stream AI response and collect tool calls
  let fullResponse = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const toolResults: Array<{ tool: string; result: unknown }> = [];
  let handoff = false;

  const toolDefs = getToolDefinitions();
  const toolCtx: ToolContext = {
    db,
    tenantId,
    departmentId,
    conversationId,
    customerId,
  };

  const stream = provider.chat({
    messages,
    systemPrompt,
    knowledgeContext,
    tools: toolDefs,
    maxTokens: (providerConfig.config as Record<string, number>)?.maxTokens || 1024,
    temperature: (providerConfig.config as Record<string, number>)?.temperature ?? 0.7,
  });

  for await (const chunk of stream) {
    if (chunk.type === "text" && chunk.content) {
      fullResponse += chunk.content;
    } else if (chunk.type === "tool_call" && chunk.toolCall) {
      const tool = getToolByName(chunk.toolCall.name);
      if (tool) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(chunk.toolCall.arguments);
        } catch {
          args = {};
        }

        const result = await tool.execute(args, toolCtx);
        toolResults.push({ tool: chunk.toolCall.name, result });

        // Record tool call
        const aiConv = await getOrCreateAIConversation(db, tenantId, conversationId, providerConfig);
        await (db.aIToolCall.create as Function)({
          data: {
            tenantId,
            aiConversationId: aiConv.id,
            toolName: chunk.toolCall.name,
            input: args,
            output: result,
            status: result.success ? "SUCCESS" : "FAILED",
          },
        });

        if (chunk.toolCall.name === "handoff_to_agent") {
          handoff = true;
        }
      }
    } else if (chunk.type === "done" && chunk.usage) {
      totalInputTokens += chunk.usage.inputTokens;
      totalOutputTokens += chunk.usage.outputTokens;
    }
  }

  // Update AI conversation metrics
  const aiConv = await getOrCreateAIConversation(db, tenantId, conversationId, providerConfig);
  await (db.aIConversation.update as Function)({
    where: { id: aiConv.id },
    data: {
      totalTokens: { increment: totalInputTokens + totalOutputTokens },
      totalCost: {
        increment: estimateCost(providerConfig.provider, totalInputTokens, totalOutputTokens),
      },
      ...(handoff ? { handoffReason: toolResults.find((r) => r.tool === "handoff_to_agent")?.result?.toString() } : {}),
    },
  });

  // Save bot response as message
  await (db.message.create as Function)({
    data: {
      conversationId,
      senderType: "BOT",
      content: fullResponse || "I apologize, I could not generate a response. Let me connect you with a team member.",
      messageType: "TEXT",
    },
  });

  // Publish to WebSocket
  await publishEvent("ws:message:new", {
    conversationId,
    content: fullResponse,
    senderType: "BOT",
    messageType: "TEXT",
    timestamp: new Date().toISOString(),
  });

  return { response: fullResponse, handoff, toolResults };
}

async function getOrCreateAIConversation(
  db: TenantDb,
  tenantId: string,
  conversationId: string,
  providerConfig: { provider: string; modelName: string }
) {
  const existing = await (db.aIConversation.findFirst as Function)({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
  });

  if (existing) return existing;

  return (db.aIConversation.create as Function)({
    data: {
      tenantId,
      conversationId,
      providerUsed: providerConfig.provider,
      modelUsed: providerConfig.modelName,
      totalTokens: 0,
      totalCost: 0,
    },
  });
}

function estimateCost(provider: string, inputTokens: number, outputTokens: number): number {
  // Rough cost estimates per 1M tokens
  const rates: Record<string, { input: number; output: number }> = {
    CLAUDE: { input: 3.0, output: 15.0 },
    OPENAI: { input: 2.5, output: 10.0 },
    GEMINI: { input: 0.075, output: 0.3 },
  };
  const rate = rates[provider] || rates.CLAUDE;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/ai/ai-chat.service.ts
git commit -m "feat(phase2): add AI chat service — orchestrates provider, tools, context, and streaming"
```

---

### Task 8: AI Chat API route and provider config routes

**Files:**
- Create: `src/app/api/ai/chat/route.ts`
- Create: `src/app/api/ai/providers/route.ts`
- Create: `src/app/api/ai/providers/[id]/route.ts`
- Create: `src/app/api/ai/metrics/route.ts`

- [ ] **Step 1: Create AI chat route (non-streaming for simplicity — streaming added later)**

```typescript
// src/app/api/ai/chat/route.ts
import { NextResponse } from "next/server";
import { requireAuth, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { processAIMessage } from "@/modules/ai/ai-chat.service";

export async function POST(req: Request) {
  try {
    const { user, db } = await requireAuth();
    const body = await req.json();
    const { conversationId, departmentId, message, customerId } = body;

    if (!conversationId || !departmentId || !message) {
      return NextResponse.json({ error: "conversationId, departmentId, and message required" }, { status: 400 });
    }

    // Save customer message first
    await (db.message.create as Function)({
      data: {
        conversationId,
        senderType: "CUSTOMER",
        content: message,
        messageType: "TEXT",
      },
    });

    const result = await processAIMessage({
      db,
      tenantId: user.tenantId,
      conversationId,
      departmentId,
      customerMessage: message,
      customerId,
    });

    return NextResponse.json({
      response: result.response,
      handoff: result.handoff,
      toolResults: result.toolResults,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return unauthorized();
    return NextResponse.json({ error: "AI chat failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create provider config routes**

```typescript
// src/app/api/ai/providers/route.ts
import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { encrypt } from "@/lib/encryption";

export async function GET() {
  try {
    const { db } = await requirePermission("settings:general");
    const providers = await db.aIProvider.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        provider: true,
        modelName: true,
        config: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        // Never return apiKey
      },
    });
    return NextResponse.json({ providers });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return unauthorized();
    if (error instanceof Error && error.message === "Forbidden") return forbidden();
    return NextResponse.json({ error: "Failed to list providers" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { db } = await requirePermission("settings:general");
    const body = await req.json();
    const { provider, apiKey, modelName, config } = body;

    if (!provider || !apiKey || !modelName) {
      return NextResponse.json({ error: "provider, apiKey, and modelName required" }, { status: 400 });
    }

    // Deactivate existing providers when adding a new one
    await (db.aIProvider.updateMany as Function)({
      where: { isActive: true },
      data: { isActive: false },
    });

    const created = await (db.aIProvider.create as Function)({
      data: {
        provider,
        apiKey: encrypt(apiKey),
        modelName,
        config: config || {},
        isActive: true,
      },
    });

    return NextResponse.json({
      provider: {
        id: created.id,
        provider: created.provider,
        modelName: created.modelName,
        isActive: created.isActive,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return unauthorized();
    if (error instanceof Error && error.message === "Forbidden") return forbidden();
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}
```

```typescript
// src/app/api/ai/providers/[id]/route.ts
import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { encrypt } from "@/lib/encryption";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await requirePermission("settings:general");
    const { id } = await params;
    const body = await req.json();
    const updateData: Record<string, unknown> = {};

    if (body.modelName) updateData.modelName = body.modelName;
    if (body.config) updateData.config = body.config;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.apiKey) updateData.apiKey = encrypt(body.apiKey);

    // If activating this provider, deactivate others
    if (body.isActive === true) {
      await (db.aIProvider.updateMany as Function)({
        where: { id: { not: id }, isActive: true },
        data: { isActive: false },
      });
    }

    const updated = await (db.aIProvider.update as Function)({
      where: { id },
      data: updateData,
      select: { id: true, provider: true, modelName: true, config: true, isActive: true },
    });

    return NextResponse.json({ provider: updated });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return unauthorized();
    if (error instanceof Error && error.message === "Forbidden") return forbidden();
    return NextResponse.json({ error: "Failed to update provider" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await requirePermission("settings:general");
    const { id } = await params;
    await (db.aIProvider.delete as Function)({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return unauthorized();
    if (error instanceof Error && error.message === "Forbidden") return forbidden();
    return NextResponse.json({ error: "Failed to delete provider" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create AI metrics route**

```typescript
// src/app/api/ai/metrics/route.ts
import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";

export async function GET() {
  try {
    const { user, db } = await requirePermission("dashboard:view");

    const [totalConversations, totalTokens, totalCost, handoffs] = await Promise.all([
      db.aIConversation.count(),
      db.aIConversation.aggregate({ _sum: { totalTokens: true } }),
      db.aIConversation.aggregate({ _sum: { totalCost: true } }),
      db.aIConversation.count({ where: { handoffReason: { not: null } } }),
    ]);

    return NextResponse.json({
      metrics: {
        totalConversations,
        totalTokens: totalTokens._sum.totalTokens || 0,
        totalCost: totalCost._sum.totalCost || 0,
        handoffCount: handoffs,
        handoffRate: totalConversations > 0 ? handoffs / totalConversations : 0,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return unauthorized();
    if (error instanceof Error && error.message === "Forbidden") return forbidden();
    return NextResponse.json({ error: "Failed to get AI metrics" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ai/
git commit -m "feat(phase2): add AI chat, provider config, and metrics API routes"
```

---

### Task 9: Update RBAC for new AI permissions

**Files:**
- Modify: `src/modules/auth/rbac.ts`

- [ ] **Step 1: Add new permissions to RBAC**

Add to the Permission type:
```typescript
  | "settings:ai"
  | "settings:knowledge-base"
  | "ai:metrics"
```

Add to rolePermissions:
- `SUPER_ADMIN`: add all three
- `COMPANY_ADMIN`: add all three
- `DEPT_MANAGER`: add `"settings:knowledge-base"`, `"ai:metrics"`
- `AGENT`: add `"ai:metrics"`
- `VIEWER`: add `"ai:metrics"`

- [ ] **Step 2: Commit**

```bash
git add src/modules/auth/rbac.ts
git commit -m "feat(phase2): add AI permissions to RBAC — settings:ai, settings:knowledge-base, ai:metrics"
```

---

### Task 10: AI Configuration settings page

**Files:**
- Create: `src/app/(dashboard)/settings/ai/page.tsx`

- [ ] **Step 1: Build AI Configuration page**

This page allows Company Admin+ to:
- Select AI provider (Claude/OpenAI/Gemini)
- Enter API key (masked input)
- Choose model name from a dropdown
- Set temperature and max tokens
- Toggle active/inactive
- Show current usage stats

Build as a React form with `useState` for form state, `fetch` to POST/PUT to `/api/ai/providers`. Show existing provider config on load via GET. Include a "Test Connection" button that sends a test message.

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/settings/ai/
git commit -m "feat(phase2): add AI Configuration settings page"
```

---

### Task 11: Knowledge Base management page

**Files:**
- Create: `src/app/(dashboard)/settings/knowledge-base/page.tsx`

- [ ] **Step 1: Build Knowledge Base management page**

This page allows admins/managers to:
- List all KB entries filtered by department and type
- Create new entries (modal form: department, type, title, content textarea)
- Edit existing entries inline
- Delete entries with confirmation
- Bulk import from JSON/CSV
- Toggle active/inactive

Build with a table listing entries, filter dropdowns (department, type), and a slide-out form for create/edit. Dept Managers only see their department's entries.

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/settings/knowledge-base/
git commit -m "feat(phase2): add Knowledge Base management page"
```

---

### Task 12: Update conversation view with AI indicators

**Files:**
- Modify: `src/app/(dashboard)/conversations/page.tsx` (or relevant conversation components)

- [ ] **Step 1: Add AI badge and handoff marker**

In the conversation message list:
- Show "AI" badge on messages where `senderType === "BOT"`
- Show handoff marker in timeline when conversation status changes to `HUMAN_TAKEOVER`
- Show tool call results inline (e.g., "Lead created", "Pricing retrieved") as small info cards
- Show token cost per conversation in the info panel

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/conversations/
git commit -m "feat(phase2): add AI badges, handoff markers, and tool call indicators to conversation view"
```

---

### Task 13: AI Metrics dashboard widget

**Files:**
- Modify: dashboard widget data source and widget type components

- [ ] **Step 1: Add AI metrics data source to widget system**

Add a new data source `ai_metrics` to the existing widget data system. When a widget is configured with this source, fetch from `/api/ai/metrics` and display:
- Total AI conversations
- Handoff rate (%)
- Total cost ($)
- Avg tokens per conversation

- [ ] **Step 2: Add sidebar nav link for AI settings**

Update sidebar to show "AI Configuration" and "Knowledge Base" under Settings, visible to Company Admin+ roles.

- [ ] **Step 3: Commit**

```bash
git add src/
git commit -m "feat(phase2): add AI metrics dashboard widget and sidebar nav updates"
```

---

## Phase 3: Multichannel Integration (Tasks 14-26)

### Task 14: Schema — Update Conversation model and add channel enums

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Update ConversationChannel and MessageType enums**

```prisma
enum ConversationChannel {
  MANUAL
  WHATSAPP
  FACEBOOK
  INSTAGRAM
  EMAIL
  SMS
  TELEGRAM
  WEBSITE
}

enum MessageType {
  TEXT
  IMAGE
  FILE
  AUDIO
  VIDEO
  LOCATION
  TEMPLATE
}

enum DeliveryStatus {
  SENT
  DELIVERED
  READ
  FAILED
}

enum WebhookLogStatus {
  PROCESSED
  FAILED
  IGNORED
}
```

- [ ] **Step 2: Make Conversation.leadId nullable, add customerId**

Update the Conversation model:
```prisma
model Conversation {
  // Change leadId from required to optional
  leadId          String?              @map("lead_id")
  customerId      String?              @map("customer_id")
  // ... keep all existing fields ...

  lead     Lead?     @relation(fields: [leadId], references: [id])
  customer Customer? @relation("ConversationCustomer", fields: [customerId], references: [id])
}
```

Add reverse relation to Customer model:
```prisma
  conversations Conversation[] @relation("ConversationCustomer")
```

- [ ] **Step 3: Audit existing code for leadId assumptions**

Grep for `leadId` in conversation-related code. Any code that creates conversations with a required `leadId` must be updated to handle `null`. Check:
- `src/app/api/conversations/route.ts` — POST handler
- `src/modules/conversations/chat.service.ts` — createConversation function
- Any component that links to lead from conversation

- [ ] **Step 4: Run migration**

Run: `npx prisma migrate dev --name update_conversation_for_multichannel`

- [ ] **Step 5: Commit**

```bash
git add prisma/ src/
git commit -m "feat(phase3): update conversation model — nullable leadId, add customerId, expand channel/message enums"
```

---

### Task 15: Schema — Channel config, customer channels, delivery, webhook logs

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add 4 new models**

```prisma
model ChannelConfig {
  id            String              @id @default(uuid()) @map("id")
  tenantId      String              @map("tenant_id")
  channel       ConversationChannel @map("channel")
  credentials   String              @map("credentials") @db.Text // encrypted JSON
  webhookSecret String?             @map("webhook_secret")
  config        Json?               @map("config") // { defaultDepartmentId, autoReply, senderId }
  isActive      Boolean             @default(false) @map("is_active")
  verifiedAt    DateTime?           @map("verified_at")
  createdAt     DateTime            @default(now()) @map("created_at")
  updatedAt     DateTime            @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, channel])
  @@index([tenantId])
  @@map("channel_configs")
}

model CustomerChannel {
  id            String              @id @default(uuid()) @map("id")
  tenantId      String              @map("tenant_id")
  customerId    String              @map("customer_id")
  channel       ConversationChannel @map("channel")
  externalId    String              @map("external_id")
  displayName   String?             @map("display_name")
  profilePicUrl String?             @map("profile_pic_url")
  lastSeenAt    DateTime?           @map("last_seen_at")
  createdAt     DateTime            @default(now()) @map("created_at")

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@unique([tenantId, channel, externalId])
  @@index([tenantId])
  @@index([customerId])
  @@map("customer_channels")
}

model MessageDelivery {
  id                String         @id @default(uuid()) @map("id")
  messageId         String         @map("message_id")
  tenantId          String         @map("tenant_id")
  externalMessageId String?        @map("external_message_id")
  status            DeliveryStatus @default(SENT) @map("status")
  errorMessage      String?        @map("error_message")
  errorCode         String?        @map("error_code")
  sentAt            DateTime?      @map("sent_at")
  deliveredAt       DateTime?      @map("delivered_at")
  readAt            DateTime?      @map("read_at")

  tenant  Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([messageId])
  @@map("message_delivery")
}

model WebhookLog {
  id              String           @id @default(uuid()) @map("id")
  tenantId        String?          @map("tenant_id")
  channel         ConversationChannel @map("channel")
  eventType       String?          @map("event_type")
  payload         Json             @map("payload")
  status          WebhookLogStatus @default(PROCESSED) @map("status")
  errorMessage    String?          @map("error_message")
  processingTimeMs Int?            @map("processing_time_ms")
  createdAt       DateTime         @default(now()) @map("created_at")

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([createdAt])
  @@map("webhook_logs")
}
```

- [ ] **Step 2: Add reverse relations**

Add to `Tenant`:
```prisma
  channelConfigs   ChannelConfig[]
  customerChannels CustomerChannel[]
  messageDeliveries MessageDelivery[]
  webhookLogs      WebhookLog[]
```

Add to `Customer`:
```prisma
  channels CustomerChannel[]
```

Add to `Message`:
```prisma
  delivery MessageDelivery?
```

- [ ] **Step 3: Update tenantPrisma modelsWithTenant array**

In `src/lib/prisma.ts`, add to `modelsWithTenant`:
```typescript
"channelConfig", "customerChannel", "messageDelivery", "webhookLog"
```

- [ ] **Step 4: Run migration**

Run: `npx prisma migrate dev --name add_multichannel_tables`

- [ ] **Step 5: Commit**

```bash
git add prisma/ src/lib/prisma.ts
git commit -m "feat(phase3): add channel_configs, customer_channels, message_delivery, webhook_logs tables"
```

---

### Task 16: Channel adapter interface and WhatsApp adapter

**Files:**
- Create: `src/modules/channels/adapters/adapter.interface.ts`
- Create: `src/modules/channels/adapters/whatsapp.adapter.ts`

- [ ] **Step 1: Create channel adapter interface**

```typescript
// src/modules/channels/adapters/adapter.interface.ts
export interface InboundMessage {
  externalMessageId: string;
  senderExternalId: string;
  senderName?: string;
  content: string;
  messageType: string; // TEXT | IMAGE | FILE | AUDIO | VIDEO | LOCATION
  fileUrl?: string;
  channel: string;
  rawPayload: Record<string, unknown>;
  timestamp: Date;
}

export interface SendResult {
  success: boolean;
  externalMessageId?: string;
  error?: string;
}

export interface ChannelAdapter {
  channel: string;
  parseInbound(body: Record<string, unknown>): InboundMessage | null;
  sendMessage(params: {
    externalId: string;
    content: string;
    messageType: string;
    fileUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<SendResult>;
  verifySignature(headers: Record<string, string>, body: string): boolean;
}
```

- [ ] **Step 2: Create WhatsApp adapter**

```typescript
// src/modules/channels/adapters/whatsapp.adapter.ts
import crypto from "crypto";
import type { ChannelAdapter, InboundMessage, SendResult } from "./adapter.interface";

export class WhatsAppAdapter implements ChannelAdapter {
  channel = "WHATSAPP";
  private phoneNumberId: string;
  private accessToken: string;
  private appSecret: string;

  constructor(credentials: { phoneNumberId: string; accessToken: string; appSecret: string }) {
    this.phoneNumberId = credentials.phoneNumberId;
    this.accessToken = credentials.accessToken;
    this.appSecret = credentials.appSecret;
  }

  parseInbound(body: Record<string, unknown>): InboundMessage | null {
    const entry = (body.entry as Array<Record<string, unknown>>)?.[0];
    const changes = (entry?.changes as Array<Record<string, unknown>>)?.[0];
    const value = changes?.value as Record<string, unknown>;
    const messages = value?.messages as Array<Record<string, unknown>>;
    if (!messages?.[0]) return null;

    const msg = messages[0];
    const contact = (value?.contacts as Array<Record<string, unknown>>)?.[0];

    let content = "";
    let messageType = "TEXT";
    let fileUrl: string | undefined;

    if (msg.type === "text") {
      content = (msg.text as Record<string, string>)?.body || "";
    } else if (msg.type === "image" || msg.type === "document" || msg.type === "audio" || msg.type === "video") {
      messageType = (msg.type as string).toUpperCase();
      const media = msg[msg.type as string] as Record<string, string>;
      content = media?.caption || `[${msg.type}]`;
      fileUrl = media?.id; // Will need to download via API
    } else if (msg.type === "location") {
      messageType = "LOCATION";
      const loc = msg.location as Record<string, number>;
      content = `Location: ${loc?.latitude}, ${loc?.longitude}`;
    }

    return {
      externalMessageId: msg.id as string,
      senderExternalId: msg.from as string,
      senderName: (contact?.profile as Record<string, string>)?.name,
      content,
      messageType,
      fileUrl,
      channel: "WHATSAPP",
      rawPayload: body,
      timestamp: new Date(parseInt(msg.timestamp as string) * 1000),
    };
  }

  async sendMessage(params: {
    externalId: string;
    content: string;
    messageType: string;
    fileUrl?: string;
  }): Promise<SendResult> {
    const url = `https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`;

    let messageBody: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to: params.externalId,
    };

    if (params.messageType === "TEXT") {
      messageBody.type = "text";
      messageBody.text = { body: params.content };
    } else if (params.messageType === "IMAGE" && params.fileUrl) {
      messageBody.type = "image";
      messageBody.image = { link: params.fileUrl, caption: params.content };
    } else if (params.messageType === "TEMPLATE") {
      // Template messages handled separately
      messageBody.type = "text";
      messageBody.text = { body: params.content };
    } else {
      messageBody.type = "text";
      messageBody.text = { body: params.content };
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messageBody),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, error: data.error?.message || "Send failed" };
      }

      return {
        success: true,
        externalMessageId: data.messages?.[0]?.id,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Network error" };
    }
  }

  verifySignature(headers: Record<string, string>, body: string): boolean {
    const signature = headers["x-hub-signature-256"];
    if (!signature) return false;
    const expected = `sha256=${crypto.createHmac("sha256", this.appSecret).update(body).digest("hex")}`;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/channels/adapters/
git commit -m "feat(phase3): add channel adapter interface and WhatsApp Business API adapter"
```

---

### Task 17: Facebook and Instagram adapters

**Files:**
- Create: `src/modules/channels/adapters/facebook.adapter.ts`
- Create: `src/modules/channels/adapters/instagram.adapter.ts`

- [ ] **Step 1: Create Facebook Messenger adapter**

Similar pattern to WhatsApp but using Meta Page Messaging API. Parse incoming `messaging` events, send via `https://graph.facebook.com/v19.0/me/messages`. PSID as external ID. Verify via app secret HMAC.

- [ ] **Step 2: Create Instagram adapter**

Same Meta platform, parse `messaging` events from Instagram webhook. Send via Instagram Messaging API. Handle story replies and mentions as special message types.

- [ ] **Step 3: Commit**

```bash
git add src/modules/channels/adapters/facebook.adapter.ts src/modules/channels/adapters/instagram.adapter.ts
git commit -m "feat(phase3): add Facebook Messenger and Instagram DM adapters"
```

---

### Task 18: Email, SMS, and Telegram adapters

**Files:**
- Create: `src/modules/channels/adapters/email.adapter.ts`
- Create: `src/modules/channels/adapters/sms.adapter.ts`
- Create: `src/modules/channels/adapters/telegram.adapter.ts`
- Create: `src/modules/channels/adapters/index.ts`

- [ ] **Step 1: Create Email adapter** — Parse SendGrid inbound parse webhook (multipart form), send via existing nodemailer. Match by From email.

- [ ] **Step 2: Create SMS adapter** — Parse Twilio/MSG91 webhook, send via Twilio REST API. Match by phone number.

- [ ] **Step 3: Create Telegram adapter** — Parse Telegram Bot API update, send via `https://api.telegram.org/bot{token}/sendMessage`. Verify via secret token in URL path.

- [ ] **Step 4: Create adapter factory**

```typescript
// src/modules/channels/adapters/index.ts
import type { ChannelAdapter } from "./adapter.interface";
import { WhatsAppAdapter } from "./whatsapp.adapter";
import { FacebookAdapter } from "./facebook.adapter";
import { InstagramAdapter } from "./instagram.adapter";
import { EmailAdapter } from "./email.adapter";
import { SMSAdapter } from "./sms.adapter";
import { TelegramAdapter } from "./telegram.adapter";
import { decrypt } from "@/lib/encryption";

export type { ChannelAdapter, InboundMessage, SendResult } from "./adapter.interface";

export function createChannelAdapter(
  channel: string,
  encryptedCredentials: string
): ChannelAdapter {
  const credentials = JSON.parse(decrypt(encryptedCredentials));

  switch (channel) {
    case "WHATSAPP": return new WhatsAppAdapter(credentials);
    case "FACEBOOK": return new FacebookAdapter(credentials);
    case "INSTAGRAM": return new InstagramAdapter(credentials);
    case "EMAIL": return new EmailAdapter(credentials);
    case "SMS": return new SMSAdapter(credentials);
    case "TELEGRAM": return new TelegramAdapter(credentials);
    default: throw new Error(`Unsupported channel: ${channel}`);
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/channels/adapters/
git commit -m "feat(phase3): add Email, SMS, Telegram adapters and adapter factory"
```

---

### Task 19: Channel manager and message dispatcher services

**Files:**
- Create: `src/modules/channels/channel-manager.service.ts`
- Create: `src/modules/channels/message-dispatcher.service.ts`
- Create: `src/modules/channels/customer-matcher.service.ts`

- [ ] **Step 1: Create channel manager** — Handles inbound messages: look up tenant from webhook path, find/create customer via customer-matcher, find/create conversation, route to AI (Phase 2) or agent, save message to DB.

- [ ] **Step 2: Create message dispatcher** — Handles outbound: when agent sends a message in a non-MANUAL conversation, route through the correct channel adapter. Save delivery status.

- [ ] **Step 3: Create customer matcher** — Match inbound external ID to existing customer. Auto-merge when phone/email matches. Create new customer if no match. Link via customer_channels table.

- [ ] **Step 4: Commit**

```bash
git add src/modules/channels/
git commit -m "feat(phase3): add channel manager, message dispatcher, and customer matcher services"
```

---

### Task 20: Webhook API routes (all 6 channels)

**Files:**
- Create: `src/app/api/webhooks/whatsapp/route.ts`
- Create: `src/app/api/webhooks/facebook/route.ts`
- Create: `src/app/api/webhooks/instagram/route.ts`
- Create: `src/app/api/webhooks/email/route.ts`
- Create: `src/app/api/webhooks/sms/route.ts`
- Create: `src/app/api/webhooks/telegram/route.ts`

- [ ] **Step 1: Create WhatsApp webhook** — GET for verification (hub.verify_token), POST for inbound messages. Verify HMAC signature. Parse tenant from URL path segment. Log to webhook_logs. Call channel manager.

- [ ] **Step 2: Create remaining 5 webhook routes** — Same pattern: verify signature, parse tenant, log, route to channel manager. Each has channel-specific verification.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/
git commit -m "feat(phase3): add webhook endpoints for all 6 channels (WhatsApp, Facebook, Instagram, Email, SMS, Telegram)"
```

---

### Task 21: Channel config API routes

**Files:**
- Create: `src/app/api/channel-configs/route.ts`
- Create: `src/app/api/channel-configs/[id]/route.ts`
- Create: `src/app/api/channel-configs/[id]/test/route.ts`

- [ ] **Step 1: Create CRUD routes** — List, create, update, delete channel configs. Encrypt credentials on save. Never return decrypted credentials in GET responses. Require `settings:general` permission.

- [ ] **Step 2: Create test connection route** — Send a test message via the adapter to verify credentials work. Return success/failure.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/channel-configs/
git commit -m "feat(phase3): add channel config CRUD and test connection API routes"
```

---

### Task 22: Customer merge API and channels list

**Files:**
- Create: `src/app/api/customers/[id]/channels/route.ts`
- Create: `src/app/api/customers/[id]/merge/route.ts`

- [ ] **Step 1: Create customer channels list** — GET returns all linked channels for a customer (customer_channels).

- [ ] **Step 2: Create customer merge** — POST merges two customer records: moves all leads, conversations, channels, and follow-ups from source to target customer. Deletes source.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/customers/
git commit -m "feat(phase3): add customer channels list and merge API routes"
```

---

### Task 23: Channel settings UI

**Files:**
- Create: `src/app/(dashboard)/settings/channels/page.tsx`

- [ ] **Step 1: Build channel settings page**

Shows 6 channel cards. Each card:
- Channel icon + name
- Status badge (Active/Inactive/Not configured)
- "Configure" button → modal form with channel-specific fields
- Webhook URL display (auto-generated, copy button)
- "Test Connection" button
- Enable/disable toggle

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/settings/channels/
git commit -m "feat(phase3): add channel configuration settings page"
```

---

### Task 24: Update conversations UI for multichannel

**Files:**
- Modify: conversation list and chat components

- [ ] **Step 1: Add channel badges** — Show channel icon (WhatsApp green, FB blue, etc.) on each conversation in the list.

- [ ] **Step 2: Add channel filter** — Dropdown to filter conversations by channel.

- [ ] **Step 3: Update reply flow** — Agent types message → sent via customer's channel (not just saved to DB). Show delivery status (sent/delivered/read ticks).

- [ ] **Step 4: Add customer info panel** — Show linked channels, merge suggestion if duplicates detected.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat(phase3): update conversations UI — channel badges, filters, delivery status, customer merge"
```

---

### Task 25: Update sidebar and RBAC for Phase 3

**Files:**
- Modify: `src/modules/auth/rbac.ts`
- Modify: sidebar component

- [ ] **Step 1: Add channel permissions** — `settings:channels` permission for Company Admin+.

- [ ] **Step 2: Add sidebar links** — "Channels" under Settings.

- [ ] **Step 3: Commit**

```bash
git add src/
git commit -m "feat(phase3): add channel permissions to RBAC and sidebar navigation"
```

---

## Phase 4: Website Chat Widget (Tasks 26-31)

### Task 26: Schema — Widget configs and visitors

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add widget enums and models**

```prisma
enum WidgetPosition {
  BOTTOM_RIGHT
  BOTTOM_LEFT
}

enum WidgetButtonIcon {
  CHAT
  HELP
  CUSTOM
}

model WidgetConfig {
  id                  String           @id @default(uuid()) @map("id")
  tenantId            String           @map("tenant_id")
  departmentId        String           @map("department_id")
  welcomeMessage      String?          @map("welcome_message")
  placeholderText     String?          @map("placeholder_text")
  position            WidgetPosition   @default(BOTTOM_RIGHT) @map("position")
  buttonIcon          WidgetButtonIcon @default(CHAT) @map("button_icon")
  themeOverride       Json?            @map("theme_override")
  offlineMessage      String?          @map("offline_message")
  preChatForm         Json?            @map("pre_chat_form")
  quickActions        Json?            @map("quick_actions") // [{label, message}]
  businessHours       Json?            @map("business_hours")
  autoOpenDelayMs     Int              @default(0) @map("auto_open_delay_ms")
  maxConcurrentVisitors Int           @default(100) @map("max_concurrent_visitors")
  isActive            Boolean          @default(true) @map("is_active")
  createdAt           DateTime         @default(now()) @map("created_at")
  updatedAt           DateTime         @updatedAt @map("updated_at")

  tenant     Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  department Department @relation(fields: [departmentId], references: [id])

  @@unique([tenantId, departmentId])
  @@index([tenantId])
  @@map("widget_configs")
}

model WidgetVisitor {
  id            String    @id @default(uuid()) @map("id")
  tenantId      String    @map("tenant_id")
  visitorId     String    @map("visitor_id") // UUID from localStorage
  customerId    String?   @map("customer_id")
  firstPageUrl  String?   @map("first_page_url")
  referrerUrl   String?   @map("referrer_url")
  userAgent     String?   @map("user_agent")
  ipCountry     String?   @map("ip_country")
  ipCity        String?   @map("ip_city")
  totalVisits   Int       @default(1) @map("total_visits")
  totalMessages Int       @default(0) @map("total_messages")
  firstSeenAt   DateTime  @default(now()) @map("first_seen_at")
  lastSeenAt    DateTime  @default(now()) @map("last_seen_at")

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  customer Customer? @relation(fields: [customerId], references: [id])

  @@unique([tenantId, visitorId])
  @@index([tenantId])
  @@map("widget_visitors")
}
```

- [ ] **Step 2: Add reverse relations and update tenantPrisma**

Add reverse relations to Tenant, Department, Customer models.

In `src/lib/prisma.ts`, add to `modelsWithTenant`:
```typescript
"widgetConfig", "widgetVisitor"
```

- [ ] **Step 3: Install geoip-lite**

Run: `npm install geoip-lite`

- [ ] **Step 4: Run migration**

Run: `npx prisma migrate dev --name add_widget_tables`

- [ ] **Step 5: Commit**

```bash
git add prisma/ src/lib/prisma.ts package.json package-lock.json
git commit -m "feat(phase4): add widget_configs and widget_visitors tables"
```

---

### Task 27: Widget services and API routes

**Files:**
- Create: `src/modules/widget/widget.service.ts`
- Create: `src/modules/widget/visitor.service.ts`
- Create: `src/modules/widget/widget-auth.service.ts`
- Create: `src/app/api/widget/config/route.ts`
- Create: `src/app/api/widget/session/route.ts`
- Create: `src/app/api/widget/message/route.ts`
- Create: `src/app/api/widget/history/route.ts`
- Create: `src/app/api/widget-configs/route.ts`
- Create: `src/app/api/widget-configs/[id]/route.ts`

- [ ] **Step 1: Create widget service** — CRUD for widget configs (admin). Public config getter (for widget embed).

- [ ] **Step 2: Create visitor service** — Create/resume visitor sessions. Track visits. Link to customer when identified.

- [ ] **Step 3: Create widget auth** — Issue short-lived JWT for anonymous visitors. Validate on subsequent requests. IP rate limiting (10 sessions/hour).

- [ ] **Step 4: Create public API routes** — `/api/widget/config` (GET, no auth — returns widget config for tenant+dept), `/api/widget/session` (POST — creates visitor JWT), `/api/widget/message` (POST — send message, authed via visitor JWT), `/api/widget/history` (GET — conversation history).

- [ ] **Step 5: Create widget upload route** — `POST /api/widget/upload` for file uploads from the widget. Reuse existing upload validation from `src/lib/uploads.ts` (10MB max, allowed types).

- [ ] **Step 6: Create admin API routes** — `/api/widget-configs` CRUD for widget configuration management.

- [ ] **Step 6: Commit**

```bash
git add src/modules/widget/ src/app/api/widget/ src/app/api/widget-configs/
git commit -m "feat(phase4): add widget services and API routes (public + admin)"
```

---

### Task 28: Widget loader script (widget.js)

**Files:**
- Create: `public/widget.js`

- [ ] **Step 1: Create embeddable widget loader**

Vanilla JS, no dependencies. <5KB gzipped.

```javascript
// public/widget.js
(function() {
  'use strict';
  var script = document.currentScript;
  var tenant = script.getAttribute('data-tenant');
  var dept = script.getAttribute('data-dept');
  var theme = script.getAttribute('data-theme') || 'auto';
  if (!tenant || !dept) return;

  var baseUrl = script.src.replace('/widget.js', '');
  var isOpen = false;
  var iframe = null;
  var unread = 0;

  // Create floating button
  var btn = document.createElement('div');
  btn.id = 'hd-widget-btn';
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;background:#FF6B35;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:999998;transition:transform 0.2s;';
  btn.onmouseenter = function() { btn.style.transform = 'scale(1.1)'; };
  btn.onmouseleave = function() { btn.style.transform = 'scale(1)'; };

  // Unread badge
  var badge = document.createElement('div');
  badge.style.cssText = 'position:absolute;top:-2px;right:-2px;width:20px;height:20px;border-radius:50%;background:#e53935;color:white;font-size:12px;display:none;align-items:center;justify-content:center;font-family:sans-serif;';
  btn.appendChild(badge);

  btn.onclick = function() {
    if (isOpen) { closeWidget(); } else { openWidget(); }
  };

  document.body.appendChild(btn);

  function openWidget() {
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.src = baseUrl + '/widget/chat?tenant=' + tenant + '&dept=' + dept + '&theme=' + theme;
      iframe.style.cssText = 'position:fixed;bottom:90px;right:20px;width:380px;height:560px;border:none;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.15);z-index:999999;transition:opacity 0.2s;';
      iframe.allow = 'clipboard-read; clipboard-write';
      document.body.appendChild(iframe);
    }
    iframe.style.display = 'block';
    isOpen = true;
    unread = 0;
    badge.style.display = 'none';
  }

  function closeWidget() {
    if (iframe) iframe.style.display = 'none';
    isOpen = false;
  }

  // Listen for messages from iframe
  window.addEventListener('message', function(e) {
    if (e.data?.type === 'hd-widget-close') closeWidget();
    if (e.data?.type === 'hd-widget-unread') {
      unread++;
      badge.textContent = unread > 9 ? '9+' : unread;
      badge.style.display = 'flex';
    }
    if (e.data?.type === 'hd-widget-theme') {
      btn.style.background = e.data.color || '#FF6B35';
    }
  });

  // Auto-open
  var autoDelay = parseInt(script.getAttribute('data-auto-open') || '0');
  if (autoDelay > 0) {
    setTimeout(openWidget, autoDelay);
  }
})();
```

- [ ] **Step 2: Commit**

```bash
git add public/widget.js
git commit -m "feat(phase4): add embeddable chat widget loader script (widget.js)"
```

---

### Task 29: Widget chat page (iframe content)

**Files:**
- Create: `src/app/(widget)/widget/chat/page.tsx`
- Create: `src/app/(widget)/layout.tsx`

- [ ] **Step 1: Create widget layout** — Minimal layout (no sidebar, no header). Just renders children.

- [ ] **Step 2: Create widget chat page**

React component that:
- Reads `tenant` and `dept` from URL params
- Fetches widget config from `/api/widget/config?tenant=X&dept=Y`
- Creates/resumes visitor session via `/api/widget/session`
- Displays welcome message and quick-action blobs
- Connects to Socket.io for real-time messaging
- Shows message bubbles (bot = left, customer = right)
- Input field + send button + file upload
- Typing indicators
- Applies tenant branding (colors, logo)
- Mobile responsive (full-screen when viewport < 480px)
- Posts `hd-widget-close` to parent when close button clicked

- [ ] **Step 3: Commit**

```bash
git add src/app/\(widget\)/
git commit -m "feat(phase4): add widget chat page with quick-action blobs, branding, and real-time messaging"
```

---

### Task 30: Widget settings UI and embed code

**Files:**
- Create: `src/app/(dashboard)/settings/widget/page.tsx`

- [ ] **Step 1: Build widget settings page**

Per-department configuration:
- Welcome message textarea
- Quick-action blobs editor (add/remove/reorder chips with label+message)
- Position toggle (bottom-right / bottom-left)
- Theme override (color picker or "auto" from tenant branding)
- Business hours editor (per-day open/close times)
- Auto-open delay slider
- Pre-chat form builder (optional fields to collect before chat)
- Offline message textarea
- "Embed Code" section with copy-paste snippet and live preview

- [ ] **Step 2: Add sidebar link and RBAC**

Add `settings:widget` permission. Visible to Company Admin + Dept Manager (own dept).

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/settings/widget/ src/modules/auth/rbac.ts
git commit -m "feat(phase4): add widget settings page with quick-action blob editor and embed code generator"
```

---

### Task 31: Update WebSocket server for widget visitors

**Files:**
- Modify: `src/ws-server/index.ts`
- Modify: `src/ws-server/auth.ts`

- [ ] **Step 1: Support visitor JWT alongside agent JWT**

Widget visitors connect with a visitor JWT (not a NextAuth session JWT). Update `authenticateSocket` to handle both token types. Visitor sockets join `visitor:{visitorId}` room.

- [ ] **Step 2: Commit**

```bash
git add src/ws-server/
git commit -m "feat(phase4): update WebSocket server to support widget visitor sessions"
```

---

## Phase 5: Advanced Analytics (Tasks 32-39)

### Task 32: Schema — Lead scores, predictions, scoring weights, conversion stats

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add analytics enums and models**

```prisma
enum LeadScoreTier {
  HOT
  WARM
  COOL
  COLD
}

enum PredictionType {
  FOLLOW_UP_TIME
  AGENT_MATCH
  CONVERSION_PROB
  MESSAGE_DRAFT
}

enum StatsDimension {
  DEPARTMENT
  SOURCE
  AGENT
  HOUR
  DAY
  STAGE
}

enum WeightCategory {
  ENGAGEMENT
  ATTRIBUTE
  HISTORICAL
  CONVERSATION
}

model LeadScore {
  id                String        @id @default(uuid()) @map("id")
  tenantId          String        @map("tenant_id")
  leadId            String        @unique @map("lead_id")
  score             Int           @map("score") // 0-100
  tier              LeadScoreTier @map("tier")
  previousScore     Int?          @map("previous_score")
  previousTier      LeadScoreTier? @map("previous_tier")
  engagementScore   Float         @default(0) @map("engagement_score")
  attributeScore    Float         @default(0) @map("attribute_score")
  historicalScore   Float         @default(0) @map("historical_score")
  conversationScore Float         @default(0) @map("conversation_score")
  factors           Json?         @map("factors")
  scoreChange       Int?          @map("score_change")
  computedAt        DateTime      @default(now()) @map("computed_at")
  expiresAt         DateTime?     @map("expires_at")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  lead   Lead   @relation(fields: [leadId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([tenantId, tier])
  @@map("lead_scores")
}

model Prediction {
  id          String         @id @default(uuid()) @map("id")
  tenantId    String         @map("tenant_id")
  leadId      String         @map("lead_id")
  type        PredictionType @map("type")
  value       Json           @map("value")
  confidence  Float          @map("confidence") // 0-1
  reasoning   String?        @map("reasoning") @db.Text
  accepted    Boolean?       @map("accepted")
  outcome     Json?          @map("outcome")
  computedAt  DateTime       @default(now()) @map("computed_at")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  lead   Lead   @relation(fields: [leadId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([leadId, type])
  @@map("predictions")
}

model ScoringWeight {
  id           String         @id @default(uuid()) @map("id")
  tenantId     String         @map("tenant_id")
  featureName  String         @map("feature_name")
  weight       Float          @map("weight")
  category     WeightCategory @map("category")
  autoTuned    Boolean        @default(false) @map("auto_tuned")
  lastTunedAt  DateTime?      @map("last_tuned_at")
  updatedAt    DateTime       @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, featureName])
  @@index([tenantId])
  @@map("scoring_weights")
}

model ConversionStat {
  id              String         @id @default(uuid()) @map("id")
  tenantId        String         @map("tenant_id")
  dimension       StatsDimension @map("dimension")
  dimensionValue  String         @map("dimension_value")
  totalLeads      Int            @default(0) @map("total_leads")
  convertedLeads  Int            @default(0) @map("converted_leads")
  conversionRate  Float          @default(0) @map("conversion_rate")
  avgTimeToConvert Float?        @map("avg_time_to_convert") // hours
  avgMessages     Float?         @map("avg_messages")
  periodStart     DateTime       @map("period_start")
  periodEnd       DateTime       @map("period_end")
  computedAt      DateTime       @default(now()) @map("computed_at")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, dimension])
  @@map("conversion_stats")
}
```

- [ ] **Step 2: Add reverse relations and update tenantPrisma**

Add reverse relations to Tenant and Lead models.

In `src/lib/prisma.ts`, add to `modelsWithTenant`:
```typescript
"leadScore", "prediction", "scoringWeight", "conversionStat"
```

- [ ] **Step 3: Run migration**

Run: `npx prisma migrate dev --name add_analytics_tables`

- [ ] **Step 4: Seed default scoring weights**

Add to seed script or create inline: insert default weights for common features (source_whatsapp: 0.3, source_website: 0.25, travel_date_14d: 0.3, travel_date_30d: 0.2, pax_6plus: 0.2, priority_vip: 0.2, etc.). These serve as initial values before auto-tuning kicks in.

- [ ] **Step 5: Commit**

```bash
git add prisma/ src/lib/prisma.ts
git commit -m "feat(phase5): add lead_scores, predictions, scoring_weights, conversion_stats tables"
```

---

### Task 33: Lead scorer service

**Files:**
- Create: `src/modules/analytics/lead-scorer.service.ts`

- [ ] **Step 1: Build lead scoring service**

```typescript
// src/modules/analytics/lead-scorer.service.ts
import type { tenantPrisma } from "@/lib/prisma";

type TenantDb = ReturnType<typeof tenantPrisma>;

interface ScoreBreakdown {
  engagement: number;   // 0-100, weighted 35%
  attributes: number;   // 0-100, weighted 25%
  historical: number;   // 0-100, weighted 25%
  conversation: number; // 0-100, weighted 15%
}

export async function scoreLeadById(db: TenantDb, tenantId: string, leadId: string) {
  const lead = await (db.lead.findUnique as Function)({
    where: { id: leadId },
    include: {
      customer: true,
      activities: { orderBy: { createdAt: "desc" }, take: 50 },
      followUps: true,
      department: true,
      stage: true,
    },
  });

  if (!lead) throw new Error("Lead not found");

  const breakdown = await computeScoreBreakdown(db, tenantId, lead);
  const totalScore = Math.round(
    breakdown.engagement * 0.35 +
    breakdown.attributes * 0.25 +
    breakdown.historical * 0.25 +
    breakdown.conversation * 0.15
  );
  const clampedScore = Math.max(0, Math.min(100, totalScore));
  const tier = getTier(clampedScore);

  // Get existing score for history
  const existing = await (db.leadScore.findUnique as Function)({
    where: { leadId },
  });

  const scoreData = {
    tenantId,
    leadId,
    score: clampedScore,
    tier,
    previousScore: existing?.score ?? null,
    previousTier: existing?.tier ?? null,
    engagementScore: breakdown.engagement,
    attributeScore: breakdown.attributes,
    historicalScore: breakdown.historical,
    conversationScore: breakdown.conversation,
    factors: {
      engagement: breakdown.engagement,
      attributes: breakdown.attributes,
      historical: breakdown.historical,
      conversation: breakdown.conversation,
    },
    scoreChange: existing ? clampedScore - existing.score : null,
    computedAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
  };

  if (existing) {
    return (db.leadScore.update as Function)({ where: { leadId }, data: scoreData });
  }
  return (db.leadScore.create as Function)({ data: scoreData });
}

async function computeScoreBreakdown(
  db: TenantDb,
  tenantId: string,
  lead: Record<string, unknown>
): Promise<ScoreBreakdown> {
  // Engagement: messages, activities, follow-ups completed, response speed
  const activities = lead.activities as Array<Record<string, unknown>>;
  const followUps = lead.followUps as Array<Record<string, unknown>>;
  const msgCount = activities.filter((a) => ["NOTE", "CALL", "EMAIL"].includes(a.type as string)).length;
  const completedFollowUps = followUps.filter((f) => f.status === "COMPLETED").length;
  const totalFollowUps = followUps.length;
  const engagement = Math.min(100,
    (msgCount * 10) +
    (completedFollowUps > 0 && totalFollowUps > 0 ? (completedFollowUps / totalFollowUps) * 40 : 0) +
    (activities.length > 5 ? 20 : activities.length * 4)
  );

  // Attributes: source, travel date proximity, passengers, priority
  const source = lead.source as string;
  const sourceScores: Record<string, number> = { WHATSAPP: 30, WEBSITE: 25, FB: 20, IG: 20, MANUAL: 15 };
  const travelDate = lead.travelDate ? new Date(lead.travelDate as string) : null;
  const daysUntilTravel = travelDate ? Math.max(0, (travelDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 999;
  const travelProximity = daysUntilTravel < 14 ? 30 : daysUntilTravel < 30 ? 20 : daysUntilTravel < 90 ? 10 : 0;
  const paxScore = Math.min(20, ((lead.numPassengers as number) || 1) * 5);
  const priorityScores: Record<string, number> = { VIP: 20, HIGH: 15, MEDIUM: 10, LOW: 5 };
  const attributes = Math.min(100,
    (sourceScores[source] || 15) + travelProximity + paxScore + (priorityScores[lead.priority as string] || 10)
  );

  // Historical: department and source conversion rates
  const convStats = await (db.conversionStat.findMany as Function)({
    where: {
      tenantId,
      dimension: { in: ["DEPARTMENT", "SOURCE"] },
      dimensionValue: { in: [lead.departmentId, source] },
    },
  });
  const deptRate = convStats.find((s: Record<string, unknown>) => s.dimension === "DEPARTMENT")?.conversionRate || 0;
  const sourceRate = convStats.find((s: Record<string, unknown>) => s.dimension === "SOURCE")?.conversionRate || 0;
  const historical = Math.min(100, (deptRate * 50 + sourceRate * 50));

  // Conversation: AI conversation sentiment (placeholder — will be enriched when AI conversation data exists)
  const aiConvs = await (db.aIConversation.findMany as Function)({
    where: { conversationId: { in: activities.map((a) => a.leadId) } },
    select: { satisfactionScore: true },
  });
  const avgSatisfaction = aiConvs.length > 0
    ? aiConvs.reduce((sum: number, c: Record<string, unknown>) => sum + ((c.satisfactionScore as number) || 50), 0) / aiConvs.length
    : 50;
  const conversation = Math.min(100, avgSatisfaction);

  return { engagement, attributes, historical, conversation };
}

function getTier(score: number): "HOT" | "WARM" | "COOL" | "COLD" {
  if (score >= 76) return "HOT";
  if (score >= 51) return "WARM";
  if (score >= 26) return "COOL";
  return "COLD";
}

export async function scoreAllActiveLeads(db: TenantDb, tenantId: string) {
  const leads = await db.lead.findMany({
    where: {
      stage: { slug: { notIn: ["converted", "lost", "dormant"] } },
    },
    select: { id: true },
  });

  let scored = 0;
  for (const lead of leads) {
    try {
      await scoreLeadById(db, tenantId, lead.id);
      scored++;
    } catch (err) {
      console.error(`[Scorer] Failed to score lead ${lead.id}:`, err);
    }
  }
  return scored;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/analytics/lead-scorer.service.ts
git commit -m "feat(phase5): add lead scorer service with 4-category weighted scoring"
```

---

### Task 34: Conversion stats, follow-up predictor, and agent matcher services

**Files:**
- Create: `src/modules/analytics/conversion-stats.service.ts`
- Create: `src/modules/analytics/follow-up-predictor.service.ts`
- Create: `src/modules/analytics/agent-matcher.service.ts`
- Create: `src/modules/analytics/prediction.service.ts`

- [ ] **Step 1: Create conversion stats service** — Aggregates lead conversion rates by department, source, agent, hour, day, and stage. Queries historical data and upserts into conversion_stats table.

- [ ] **Step 2: Create follow-up predictor** — Uses conversion_stats to find optimal follow-up time (best hour/day by conversion rate). Uses AI provider (Phase 2) to draft personalized follow-up messages with lead context.

- [ ] **Step 3: Create agent matcher** — Scores agents for a given lead: `(conv_rate × 0.4) + (specialty_match × 0.3) + (load_inverse × 0.2) + (satisfaction × 0.1)`. Returns ranked list.

- [ ] **Step 4: Create prediction service** — CRUD for predictions. Record acceptance/outcome. Calculate prediction accuracy.

- [ ] **Step 5: Commit**

```bash
git add src/modules/analytics/
git commit -m "feat(phase5): add conversion stats, follow-up predictor, agent matcher, and prediction services"
```

---

### Task 35: Scoring and analytics workers

**Files:**
- Create: `src/workers/scoring.worker.ts`
- Create: `src/workers/analytics.worker.ts`
- Modify: `src/workers/index.ts`
- Modify: `src/lib/queue.ts`

- [ ] **Step 1: Add scoring queue helpers to lib/queue.ts**

Add `getScoringQueue()`, `addScoringJob()`, `getAnalyticsQueue()`, `addAnalyticsJob()`.

- [ ] **Step 2: Create scoring worker**

Processes scoring jobs (lead created, stage changed, message received). Also supports batch scoring via `score-all-active` job type.

- [ ] **Step 3: Create analytics worker**

Runs weekly: aggregates conversion_stats, auto-tunes scoring_weights by comparing predicted scores vs actual outcomes.

- [ ] **Step 4: Register workers in index.ts**

Add `createScoringWorker()` and `createAnalyticsWorker()` to the worker startup.

- [ ] **Step 5: Commit**

```bash
git add src/workers/ src/lib/queue.ts
git commit -m "feat(phase5): add scoring and analytics workers with queue helpers"
```

---

### Task 36: Analytics API routes

**Files:**
- Create: `src/app/api/leads/[id]/score/route.ts`
- Create: `src/app/api/leads/[id]/predictions/route.ts`
- Create: `src/app/api/leads/[id]/suggested-agent/route.ts`
- Create: `src/app/api/leads/[id]/draft-followup/route.ts`
- Create: `src/app/api/analytics/conversion-stats/route.ts`
- Create: `src/app/api/analytics/scoring-weights/route.ts`
- Create: `src/app/api/analytics/prediction-accuracy/route.ts`

- [ ] **Step 1: Create lead score route** — GET returns score + breakdown. POST /refresh forces recompute.

- [ ] **Step 2: Create predictions route** — GET returns predictions for lead. POST /accept marks prediction as accepted. POST /outcome records actual result.

- [ ] **Step 3: Create suggested agent route** — GET returns ranked agent recommendations.

- [ ] **Step 4: Create draft follow-up route** — POST generates AI-drafted follow-up message using lead context.

- [ ] **Step 5: Create analytics routes** — Conversion stats, scoring weights (GET/PUT), prediction accuracy.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/leads/ src/app/api/analytics/
git commit -m "feat(phase5): add analytics API routes — scoring, predictions, agent matching, draft follow-ups"
```

---

### Task 37: Lead score badges in UI

**Files:**
- Modify: lead list and lead detail components

- [ ] **Step 1: Add score badge component**

Colored circle badge showing score (0-100) with tier color: Hot=red, Warm=orange, Cool=green, Cold=grey.

- [ ] **Step 2: Add to lead list** — Score badge on each lead card. Sortable by score. Filterable by tier.

- [ ] **Step 3: Add to lead detail** — "AI Insights" panel showing score breakdown (4 categories), suggested next action, best follow-up time, recommended agent, and "Draft Follow-up" button.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat(phase5): add lead score badges to list and AI Insights panel to lead detail"
```

---

### Task 38: Predictions UI and suggested follow-ups

**Files:**
- Modify: follow-up queue page

- [ ] **Step 1: Add "Suggested" tab** — ML-recommended follow-ups not yet created. Each shows lead, best time, draft message, confidence score. One-click approve button.

- [ ] **Step 2: Add prediction dashboard widgets** — Score Distribution pie chart, Prediction Accuracy tracker, AI Cost tracker.

- [ ] **Step 3: Commit**

```bash
git add src/
git commit -m "feat(phase5): add suggested follow-ups tab and prediction dashboard widgets"
```

---

### Task 39: Analytics settings page and RBAC

**Files:**
- Create: `src/app/(dashboard)/settings/analytics/page.tsx`
- Modify: `src/modules/auth/rbac.ts`

- [ ] **Step 1: Build analytics settings page**

- Toggle auto-assignment by ML recommendation
- View/override scoring weights per category
- Enable/disable AI follow-up suggestions
- Set minimum confidence threshold for predictions
- Show prediction accuracy stats

- [ ] **Step 2: Add analytics permissions to RBAC**

Add `settings:analytics` for Company Admin+. Add `predictions:view` and `predictions:accept` scoped by role.

- [ ] **Step 3: Update sidebar** — Add "Analytics" under Settings.

- [ ] **Step 4: Final commit for Phase 5**

```bash
git add src/
git commit -m "feat(phase5): add analytics settings page and RBAC permissions"
```

---

## Post-Implementation Checklist

After all 39 tasks are complete, run the full quality gate from CLAUDE.md:

- [ ] Check 1: No dead buttons, links, or CTAs
- [ ] Check 2: No hardcoded data — all numbers from API
- [ ] Check 3: No placeholder code or fake tokens
- [ ] Check 4: Every API route exists and handles the correct HTTP methods
- [ ] Check 5: RBAC enforced on all new routes
- [ ] Check 6: Tenant isolation on all 14 new tables
- [ ] Check 7: API keys encrypted at rest
- [ ] Check 8: Webhook signatures verified
- [ ] Check 9: Build passes: `npm run build`
- [ ] Check 10: All sidebar links navigate to real pages
