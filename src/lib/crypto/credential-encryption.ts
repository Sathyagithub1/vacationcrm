/**
 * src/lib/crypto/credential-encryption.ts
 *
 * AES-256-GCM credential encryption for tenant secrets stored at rest.
 *
 * All sensitive per-tenant credentials (Razorpay secrets, telephony API keys,
 * STT/TTS API keys) must be encrypted before writing to the DB and decrypted
 * on read.  A tamper-evident format is used so that any modification to the
 * ciphertext or auth tag is detected and rejected.
 *
 * Wire format:  "v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>"
 *
 * Key source:   process.env.CREDENTIAL_ENCRYPTION_KEY (64 hex chars = 32 bytes)
 *   Generate:   openssl rand -hex 32
 *   Node:       node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * The `isEncrypted` guard enables a safe transition period where some DB rows
 * still hold plaintext values — callers check before decrypting so that old
 * rows are returned as-is while new writes are encrypted.
 *
 * NEVER log decrypted values.  NEVER return raw keys in API responses.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "crypto";

// ── Constants ─────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 16; // bytes
const AUTH_TAG_LENGTH = 16; // bytes
const V1_PREFIX = "v1:" as const;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Reads and validates CREDENTIAL_ENCRYPTION_KEY from the environment.
 * Throws a descriptive error if the key is missing or incorrectly sized.
 */
function getMasterKey(): Buffer {
  const hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  return Buffer.from(hex, "hex");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true if `value` is already in the v1 encrypted format.
 *
 * Use this during the transition period to avoid double-encrypting a value
 * that was stored before encryption was enabled.
 *
 * @example
 *   isEncrypted("v1:abc:def:123") // true
 *   isEncrypted("sk_live_abc123") // false (plaintext)
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(V1_PREFIX);
}

/**
 * Encrypts `plaintext` with AES-256-GCM using a random IV per call.
 *
 * Returns a self-describing string:
 *   "v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>"
 *
 * The auth tag protects against ciphertext tampering.  Any modification to
 * any of the four fields will cause `decryptCredential` to throw.
 *
 * @throws If CREDENTIAL_ENCRYPTION_KEY is not set or malformed.
 */
export function encryptCredential(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  let ciphertext = cipher.update(plaintext, "utf8", "hex");
  ciphertext += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${V1_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext}`;
}

/**
 * Decrypts a value produced by `encryptCredential`.
 *
 * Parses the v1 wire format, verifies the auth tag (tamper detection), and
 * returns the original plaintext.
 *
 * @throws If the format is unrecognised (not v1), the key is wrong, or the
 *         auth tag fails verification — indicating tampering or key mismatch.
 *
 * NEVER log the return value.
 */
export function decryptCredential(encoded: string): string {
  if (!isEncrypted(encoded)) {
    throw new Error(
      "decryptCredential: value is not in v1 encrypted format. " +
        "Check that CREDENTIAL_ENCRYPTION_KEY matches the key used when encrypting.",
    );
  }

  // Strip "v1:" prefix then split remainder into three parts
  const payload = encoded.slice(V1_PREFIX.length);
  const colonCount = (payload.match(/:/g) ?? []).length;
  if (colonCount < 2) {
    throw new Error(
      "decryptCredential: malformed v1 payload — expected v1:<iv>:<tag>:<cipher>",
    );
  }

  const firstColon = payload.indexOf(":");
  const secondColon = payload.indexOf(":", firstColon + 1);

  const ivHex = payload.slice(0, firstColon);
  const authTagHex = payload.slice(firstColon + 1, secondColon);
  const ciphertextHex = payload.slice(secondColon + 1);

  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("decryptCredential: one or more v1 payload segments is empty");
  }

  const key = getMasterKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  // Validate auth tag length before passing to Node's decipher
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(
      `decryptCredential: auth tag must be ${AUTH_TAG_LENGTH} bytes, got ${authTag.length}`,
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let plaintext: string;
  try {
    plaintext = decipher.update(ciphertextHex, "hex", "utf8");
    plaintext += decipher.final("utf8");
  } catch {
    throw new Error(
      "decryptCredential: authentication failed — ciphertext may have been tampered with " +
        "or the wrong CREDENTIAL_ENCRYPTION_KEY is in use",
    );
  }

  return plaintext;
}

/**
 * Decrypts `encoded` if it is in v1 format; otherwise returns it unchanged.
 *
 * This is the safe helper for the transition period where some DB rows still
 * hold plaintext values.  After the one-shot migration script has run, every
 * value will be in v1 format and this function will always decrypt.
 *
 * NEVER log the return value.
 */
export function decryptIfEncrypted(encoded: string): string {
  return isEncrypted(encoded) ? decryptCredential(encoded) : encoded;
}

/**
 * Timing-safe comparison of two decrypted credential strings.
 *
 * Prevents timing-oracle attacks when comparing secrets for equality.
 * Returns false if the strings have different byte lengths (not constant-time
 * for length, which is acceptable — padding via AES-GCM already obscures this).
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  try {
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
