/**
 * src/app/snippet/[tenantToken]/route.test.ts
 *
 * T49 — Integration tests for GET /snippet/[tenantToken].
 *
 * Uses the real database.  Each test seeds its own tenant to guarantee
 * isolation.  Prisma is disconnected in afterAll.
 */

import { describe, it, expect, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

// ── Tenant IDs ────────────────────────────────────────────────────────────────

const T_SNIPPET_FOUND   = "t-snip-found";
const T_SNIPPET_MISSING = "t-snip-missing"; // we'll test with a made-up token

// ── Helper ────────────────────────────────────────────────────────────────────

async function seedTenant(id: string): Promise<string> {
  const result = await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
    select: { intakeToken: true },
  });
  return result.intakeToken;
}

async function clearTenant(id: string) {
  await prisma.user.deleteMany({ where: { tenantId: id } });
}

function makeRequest(tenantToken: string): NextRequest {
  return new NextRequest(`http://localhost/snippet/${tenantToken}`);
}

function makeContext(tenantToken: string) {
  return { params: Promise.resolve({ tenantToken }) };
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

afterAll(async () => {
  await clearTenant(T_SNIPPET_FOUND);
  await prisma.tenant.deleteMany({
    where: { id: { in: [T_SNIPPET_FOUND] } },
  });
  await prisma.$disconnect();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /snippet/[tenantToken] (T49)", () => {
  it("returns 200 with Content-Type: application/javascript for a known token", async () => {
    const intakeToken = await seedTenant(T_SNIPPET_FOUND);

    const res = await GET(makeRequest(intakeToken), makeContext(intakeToken));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/javascript");
  });

  it("body contains the tenantToken substitution", async () => {
    const intakeToken = await seedTenant(T_SNIPPET_FOUND);

    const res = await GET(makeRequest(intakeToken), makeContext(intakeToken));
    const body = await res.text();

    // The snippet must contain the token as a JSON string literal
    expect(body).toContain(JSON.stringify(intakeToken));
  });

  it("body is a valid IIFE starting with (function", async () => {
    const intakeToken = await seedTenant(T_SNIPPET_FOUND);

    const res = await GET(makeRequest(intakeToken), makeContext(intakeToken));
    const body = await res.text();

    // Strip comment lines and find the IIFE opener
    const codeLine = body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("/*") && !l.startsWith("*"));
    expect(codeLine).toMatch(/^\(function/);
  });

  it("returns Cache-Control: public, max-age=300", async () => {
    const intakeToken = await seedTenant(T_SNIPPET_FOUND);

    const res = await GET(makeRequest(intakeToken), makeContext(intakeToken));

    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  it("returns 404 with JS comment body for an unknown token", async () => {
    const fakeToken = "definitely-not-a-real-intake-token-xyz";

    const res = await GET(makeRequest(fakeToken), makeContext(fakeToken));

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("application/javascript");
    const body = await res.text();
    expect(body).toContain("Unknown tenant");
  });
});
