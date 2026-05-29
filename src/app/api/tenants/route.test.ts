/**
 * src/app/api/tenants/route.test.ts
 *
 * Phase 6g — Credential encryption + masking for tenant settings.
 *
 * Covers:
 *   - GET masks Phase 6c/6d secret fields with the "••••••••" sentinel
 *   - PUT encrypts secret fields with AES-256-GCM (v1: prefix) on write
 *   - PUT with the masked sentinel preserves the existing stored value
 *   - PUT updates non-secret fields (razorpayKeyId, *Provider, *PhoneNumber) plain
 *   - Audit log redacts secret field values
 *   - Exotel credentials are stored as encrypted JSON
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { isEncrypted, decryptCredential } from "@/lib/crypto/credential-encryption";

const mockSession = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(() => mockSession.value) }));

import { GET, PUT } from "./route";

const T_ID = "t-credtest";
const U_ID = "u-credtest";
const MASK = "••••••••";

// Ensure the encryption key is available in the test env.
// The test suite-level env may not have it; set a deterministic test key.
beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY =
    process.env.CREDENTIAL_ENCRYPTION_KEY ||
    "0".repeat(64); // 32-byte zero key — fine for tests
});

function setAdminSession() {
  mockSession.value = {
    user: {
      id: U_ID,
      email: "admin@credtest.com",
      name: "Cred Test Admin",
      role: "COMPANY_ADMIN",
      tenantId: T_ID,
    },
  };
}

async function clearTenant() {
  await prisma.auditLog.deleteMany({ where: { tenantId: T_ID } });
  await prisma.user.deleteMany({ where: { tenantId: T_ID } });
  await prisma.tenant.deleteMany({ where: { id: T_ID } });
}

async function seedTenant(overrides: Record<string, unknown> = {}) {
  await prisma.tenant.create({
    data: {
      id: T_ID,
      name: "Cred Test Tenant",
      slug: "cred-test",
      ...overrides,
    },
  });
  await prisma.user.create({
    data: {
      id: U_ID,
      tenantId: T_ID,
      email: "admin@credtest.com",
      passwordHash: "x",
      name: "Cred Test Admin",
      role: "COMPANY_ADMIN",
      isActive: true,
      languages: [],
      tags: [],
    },
  });
}

function putReq(body: unknown): Request {
  return new Request("http://localhost/api/tenants", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await clearTenant();
  mockSession.value = null;
});

afterAll(async () => {
  await clearTenant();
  await prisma.$disconnect();
});

describe("Phase 6g — tenant credential encryption + masking", () => {
  describe("GET /api/tenants", () => {
    it("401 when unauthenticated", async () => {
      const res = await GET();
      expect(res.status).toBe(401);
    });

    it("returns nulls for unset credential fields", async () => {
      await seedTenant();
      setAdminSession();

      const res = await GET();
      expect(res.status).toBe(200);

      const json = (await res.json()) as { tenant: Record<string, unknown> };
      expect(json.tenant.razorpayKeyId).toBeNull();
      expect(json.tenant.razorpayKeySecret).toBeNull();
      expect(json.tenant.telephonyApiKey).toBeNull();
      expect(json.tenant.sttApiKey).toBeNull();
      expect(json.tenant.ttsApiKey).toBeNull();
    });

    it("masks stored secret fields with the sentinel", async () => {
      // Seed with already-encrypted (real wire format) values
      const { encryptCredential } = await import("@/lib/crypto/credential-encryption");
      await seedTenant({
        razorpayKeyId: "rzp_test_xyz",
        razorpayKeySecret: encryptCredential("secret-value-abc"),
        razorpayWebhookSecret: encryptCredential("webhook-value-def"),
        telephonyProvider: "EXOTEL",
        telephonyApiKey: encryptCredential(JSON.stringify({ accountSid: "AC1", apiKey: "k1", apiToken: "t1" })),
        telephonyPhoneNumber: "+911234567890",
        sttProvider: "GOOGLE",
        sttApiKey: encryptCredential("stt-key"),
        ttsProvider: "GOOGLE",
        ttsApiKey: encryptCredential("tts-key"),
      });
      setAdminSession();

      const res = await GET();
      const json = (await res.json()) as { tenant: Record<string, unknown> };

      // Plain (non-secret) fields pass through
      expect(json.tenant.razorpayKeyId).toBe("rzp_test_xyz");
      expect(json.tenant.telephonyProvider).toBe("EXOTEL");
      expect(json.tenant.telephonyPhoneNumber).toBe("+911234567890");
      expect(json.tenant.sttProvider).toBe("GOOGLE");
      expect(json.tenant.ttsProvider).toBe("GOOGLE");

      // Secret fields are masked
      expect(json.tenant.razorpayKeySecret).toBe(MASK);
      expect(json.tenant.razorpayWebhookSecret).toBe(MASK);
      expect(json.tenant.telephonyApiKey).toBe(MASK);
      expect(json.tenant.sttApiKey).toBe(MASK);
      expect(json.tenant.ttsApiKey).toBe(MASK);
    });
  });

  describe("PUT /api/tenants — plain field updates", () => {
    it("updates razorpayKeyId as plaintext", async () => {
      await seedTenant();
      setAdminSession();

      const res = await PUT(putReq({ razorpayKeyId: "rzp_live_new" }));
      expect(res.status).toBe(200);

      const tenant = await prisma.tenant.findUnique({ where: { id: T_ID } });
      expect(tenant?.razorpayKeyId).toBe("rzp_live_new");
    });

    it("sets and clears non-secret provider fields", async () => {
      await seedTenant({ telephonyProvider: "EXOTEL", sttProvider: "GOOGLE", ttsProvider: "GOOGLE" });
      setAdminSession();

      const res = await PUT(putReq({ telephonyProvider: "FREJUN", sttProvider: "", ttsProvider: "" }));
      expect(res.status).toBe(200);

      const tenant = await prisma.tenant.findUnique({ where: { id: T_ID } });
      expect(tenant?.telephonyProvider).toBe("FREJUN");
      expect(tenant?.sttProvider).toBeNull();
      expect(tenant?.ttsProvider).toBeNull();
    });

    it("normalizes provider strings to uppercase", async () => {
      await seedTenant();
      setAdminSession();

      const res = await PUT(putReq({ telephonyProvider: "exotel", sttProvider: "google" }));
      expect(res.status).toBe(200);

      const tenant = await prisma.tenant.findUnique({ where: { id: T_ID } });
      expect(tenant?.telephonyProvider).toBe("EXOTEL");
      expect(tenant?.sttProvider).toBe("GOOGLE");
    });
  });

  describe("PUT /api/tenants — secret field encryption", () => {
    it("encrypts razorpayKeySecret with v1 prefix on write", async () => {
      await seedTenant();
      setAdminSession();

      const res = await PUT(putReq({ razorpayKeySecret: "rzp_secret_abc" }));
      expect(res.status).toBe(200);

      const tenant = await prisma.tenant.findUnique({ where: { id: T_ID } });
      expect(tenant?.razorpayKeySecret).toBeTruthy();
      expect(isEncrypted(tenant!.razorpayKeySecret!)).toBe(true);
      expect(decryptCredential(tenant!.razorpayKeySecret!)).toBe("rzp_secret_abc");
    });

    it("preserves existing value when sentinel is sent (no overwrite)", async () => {
      const { encryptCredential } = await import("@/lib/crypto/credential-encryption");
      const originalCipher = encryptCredential("original-secret");
      await seedTenant({ razorpayKeySecret: originalCipher });
      setAdminSession();

      const res = await PUT(putReq({ razorpayKeySecret: MASK }));
      expect(res.status).toBe(200);

      const tenant = await prisma.tenant.findUnique({ where: { id: T_ID } });
      expect(tenant?.razorpayKeySecret).toBe(originalCipher);
      expect(decryptCredential(tenant!.razorpayKeySecret!)).toBe("original-secret");
    });

    it("stores Exotel JSON-shaped credentials as a single encrypted blob", async () => {
      await seedTenant();
      setAdminSession();

      const exotelJson = JSON.stringify({
        accountSid: "AC123",
        apiKey: "exo_key_xyz",
        apiToken: "exo_token_xyz",
      });

      const res = await PUT(putReq({
        telephonyProvider: "EXOTEL",
        telephonyApiKey: exotelJson,
        telephonyPhoneNumber: "+919876543210",
      }));
      expect(res.status).toBe(200);

      const tenant = await prisma.tenant.findUnique({ where: { id: T_ID } });
      expect(tenant?.telephonyProvider).toBe("EXOTEL");
      expect(tenant?.telephonyPhoneNumber).toBe("+919876543210");
      expect(isEncrypted(tenant!.telephonyApiKey!)).toBe(true);

      const decrypted = decryptCredential(tenant!.telephonyApiKey!);
      const parsed = JSON.parse(decrypted) as Record<string, string>;
      expect(parsed.accountSid).toBe("AC123");
      expect(parsed.apiKey).toBe("exo_key_xyz");
      expect(parsed.apiToken).toBe("exo_token_xyz");
    });

    it("encrypts STT and TTS API keys", async () => {
      await seedTenant();
      setAdminSession();

      const res = await PUT(putReq({
        sttProvider: "GOOGLE",
        sttApiKey: "AIza-stt-key",
        ttsProvider: "GOOGLE",
        ttsApiKey: "AIza-tts-key",
      }));
      expect(res.status).toBe(200);

      const tenant = await prisma.tenant.findUnique({ where: { id: T_ID } });
      expect(isEncrypted(tenant!.sttApiKey!)).toBe(true);
      expect(isEncrypted(tenant!.ttsApiKey!)).toBe(true);
      expect(decryptCredential(tenant!.sttApiKey!)).toBe("AIza-stt-key");
      expect(decryptCredential(tenant!.ttsApiKey!)).toBe("AIza-tts-key");
    });

    it("ignores empty string for secret fields (no overwrite)", async () => {
      const { encryptCredential } = await import("@/lib/crypto/credential-encryption");
      await seedTenant({ razorpayKeySecret: encryptCredential("existing-secret") });
      setAdminSession();

      const before = await prisma.tenant.findUnique({ where: { id: T_ID } });
      const res = await PUT(putReq({ razorpayKeySecret: "" }));
      expect(res.status).toBe(400);
      // empty payload after empty-string filter yields "No fields to update"

      const after = await prisma.tenant.findUnique({ where: { id: T_ID } });
      expect(after?.razorpayKeySecret).toBe(before?.razorpayKeySecret);
    });
  });

  describe("PUT /api/tenants — audit log redaction", () => {
    it("records audit entry with <redacted> placeholder for secret fields", async () => {
      await seedTenant();
      setAdminSession();

      await PUT(putReq({
        razorpayKeyId: "rzp_live_abc",
        razorpayKeySecret: "secret-not-in-log",
        telephonyApiKey: "tel-secret-not-in-log",
      }));

      const log = await prisma.auditLog.findFirst({
        where: { tenantId: T_ID, action: "tenant.update" },
        orderBy: { createdAt: "desc" },
      });
      expect(log).toBeTruthy();

      const newValue = log!.newValue as Record<string, unknown>;
      // Non-secret retained in audit
      expect(newValue.razorpayKeyId).toBe("rzp_live_abc");
      // Secrets redacted
      expect(newValue.razorpayKeySecret).toBe("<redacted>");
      expect(newValue.telephonyApiKey).toBe("<redacted>");
    });
  });
});
