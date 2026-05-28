/**
 * src/lib/crypto/credential-encryption.test.ts
 *
 * Unit tests for the AES-256-GCM credential encryption module.
 *
 * Covers:
 *   1. encrypt/decrypt roundtrip
 *   2. random IV → different ciphertext each call
 *   3. isEncrypted: v1 prefix detection
 *   4. decryptIfEncrypted: plaintext passthrough during transition
 *   5. tamper detection (modified ciphertext)
 *   6. auth-tag tamper detection
 *   7. wrong key fails
 *   8. missing / malformed env key throws
 *   9. empty string roundtrip
 *  10. safeCompare
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  encryptCredential,
  decryptCredential,
  decryptIfEncrypted,
  isEncrypted,
  safeCompare,
} from "./credential-encryption";

// ── Test key ─────────────────────────────────────────────────────────────────
// A deterministic 32-byte hex key used only in tests.
const TEST_KEY = "a".repeat(64); // 64 hex chars = 32 bytes
const ALT_KEY = "b".repeat(64);

function setKey(key: string) {
  process.env.CREDENTIAL_ENCRYPTION_KEY = key;
}
function unsetKey() {
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;
}

beforeAll(() => setKey(TEST_KEY));
afterAll(() => unsetKey());

// ── Test suite ────────────────────────────────────────────────────────────────

describe("encryptCredential / decryptCredential", () => {
  it("roundtrip: decrypted value equals original plaintext", () => {
    const plain = "rzp_secret_key_ABCDEF";
    const enc = encryptCredential(plain);
    const dec = decryptCredential(enc);
    expect(dec).toBe(plain);
  });

  it("two encryptions of the same value produce different ciphertexts (random IV)", () => {
    const plain = "same-value";
    const enc1 = encryptCredential(plain);
    const enc2 = encryptCredential(plain);
    expect(enc1).not.toBe(enc2);
  });

  it("encrypted output starts with 'v1:' prefix", () => {
    const enc = encryptCredential("anything");
    expect(enc.startsWith("v1:")).toBe(true);
  });

  it("encrypted output has exactly three colons separating four segments", () => {
    const enc = encryptCredential("anything");
    // Format: v1:<iv>:<tag>:<cipher> → split on : gives 4 parts
    const parts = enc.split(":");
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe("v1");
  });

  it("empty string roundtrip succeeds", () => {
    const enc = encryptCredential("");
    const dec = decryptCredential(enc);
    expect(dec).toBe("");
  });

  it("unicode / special chars roundtrip", () => {
    const plain = "sk_live_💎αβγ<>&\"'";
    const enc = encryptCredential(plain);
    expect(decryptCredential(enc)).toBe(plain);
  });
});

describe("isEncrypted", () => {
  it("returns true for v1 formatted strings", () => {
    const enc = encryptCredential("test");
    expect(isEncrypted(enc)).toBe(true);
  });

  it("returns false for plaintext strings", () => {
    expect(isEncrypted("rzp_live_ABCDEF")).toBe(false);
    expect(isEncrypted("")).toBe(false);
    expect(isEncrypted("v1")).toBe(false); // no colon
  });

  it("returns false for strings that start with v1 but lack colons", () => {
    expect(isEncrypted("v1no-colon")).toBe(false);
  });
});

describe("decryptIfEncrypted", () => {
  it("returns encrypted value decrypted when in v1 format", () => {
    const plain = "telephony_secret";
    const enc = encryptCredential(plain);
    expect(decryptIfEncrypted(enc)).toBe(plain);
  });

  it("returns plaintext unchanged (transition passthrough)", () => {
    const plain = "old-plaintext-key-not-yet-migrated";
    expect(decryptIfEncrypted(plain)).toBe(plain);
  });
});

describe("tamper detection", () => {
  it("throws when ciphertext segment is modified", () => {
    const enc = encryptCredential("sensitive");
    const parts = enc.split(":");
    // Flip last char of ciphertext
    const last = parts[3];
    parts[3] = last.slice(0, -1) + (last.endsWith("a") ? "b" : "a");
    const tampered = parts.join(":");
    expect(() => decryptCredential(tampered)).toThrow();
  });

  it("throws when auth tag segment is modified", () => {
    const enc = encryptCredential("sensitive");
    const parts = enc.split(":");
    // Flip a char in the auth tag
    const tag = parts[2];
    parts[2] = tag.slice(0, -1) + (tag.endsWith("0") ? "1" : "0");
    const tampered = parts.join(":");
    expect(() => decryptCredential(tampered)).toThrow();
  });

  it("throws when passed a plaintext value (not v1 format)", () => {
    expect(() => decryptCredential("not-encrypted")).toThrow(
      /not in v1 encrypted format/,
    );
  });
});

describe("wrong key", () => {
  it("throws when decrypting with a different key", () => {
    setKey(TEST_KEY);
    const enc = encryptCredential("secret");

    // Switch to a different key
    setKey(ALT_KEY);
    try {
      expect(() => decryptCredential(enc)).toThrow();
    } finally {
      // Always restore key for subsequent tests
      setKey(TEST_KEY);
    }
  });
});

describe("missing / malformed env key", () => {
  it("encryptCredential throws if CREDENTIAL_ENCRYPTION_KEY is not set", () => {
    unsetKey();
    try {
      expect(() => encryptCredential("anything")).toThrow(
        /CREDENTIAL_ENCRYPTION_KEY/,
      );
    } finally {
      setKey(TEST_KEY);
    }
  });

  it("encryptCredential throws if CREDENTIAL_ENCRYPTION_KEY is too short", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "tooshort";
    try {
      expect(() => encryptCredential("anything")).toThrow(
        /CREDENTIAL_ENCRYPTION_KEY/,
      );
    } finally {
      setKey(TEST_KEY);
    }
  });
});

describe("safeCompare", () => {
  it("returns true for equal strings", () => {
    expect(safeCompare("abc", "abc")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(safeCompare("abc", "abd")).toBe(false);
  });

  it("returns false for different-length strings", () => {
    expect(safeCompare("abc", "abcd")).toBe(false);
  });

  it("returns false for empty vs non-empty", () => {
    expect(safeCompare("", "a")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(safeCompare("", "")).toBe(true);
  });
});
