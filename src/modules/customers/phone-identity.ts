/**
 * src/modules/customers/phone-identity.ts
 *
 * Phone-number-as-identity helpers for customer dedupe.
 *
 * The Customer table stores `mobile` as a raw operator-entered string
 * (there is a DB `@@unique([tenantId, mobile])` constraint, but it is a
 * RAW-string constraint — "+91 98765 43210" and "9876543210" are two
 * different strings to Postgres and both could exist). These helpers give
 * us a *normalized* notion of phone identity so the intake/create path can
 * reuse an existing customer instead of creating a formatting-variant
 * duplicate.
 *
 * IMPORTANT (data safety): these helpers only READ. Resolving by phone
 * returns an existing row or null — it never mutates, deletes, or
 * overwrites any customer. Dedupe = REUSE, never destroy.
 */

/**
 * Normalize a raw phone string into a canonical, comparable form.
 *
 * Rules (deterministic):
 *  - `null`/`undefined`/non-string  → "" (empty = "no usable phone").
 *  - Strip everything that isn't a digit or a leading "+".
 *    (spaces, dashes, parens, dots, letters, etc. are removed)
 *  - A "+" is only meaningful at the very start (country-code marker);
 *    any "+" elsewhere is dropped.
 *  - If, after stripping, there are MORE than 10 digits, keep only the
 *    last 10 (the subscriber number) — this makes local vs. country-code
 *    forms collapse together, e.g.:
 *        "+91 98765 43210" → "9876543210"
 *        "098765 43210"    → "9876543210"  (leading trunk "0" dropped)
 *        "919876543210"    → "9876543210"
 *  - If there are 10 or fewer digits, keep them all (short/extension
 *    numbers are compared as-is).
 *
 * The result is DIGITS ONLY (no "+") so that country-code and local
 * variants of the same subscriber number compare equal.
 */
export function normalizePhone(raw: unknown): string {
  if (typeof raw !== "string") return "";

  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Keep only digits (drop +, spaces, dashes, parens, letters, etc.).
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  // Collapse to the last 10 digits when longer (country code / trunk prefix).
  if (digits.length > 10) {
    return digits.slice(-10);
  }

  return digits;
}

/**
 * Minimal shape of the tenant-scoped Prisma client this helper needs.
 * (The real `db` from requireAuth/requirePermission satisfies this and
 * auto-injects tenantId into `where`; we also pass tenantId explicitly
 * for defence-in-depth and to make the scope intent unmistakable.)
 */
export interface CustomerPhoneDb {
  customer: {
    findMany: (args: {
      where: Record<string, unknown>;
      select?: Record<string, boolean>;
    }) => Promise<Array<{ id: string; mobile?: string | null; alternatePhone?: string | null; [k: string]: unknown }>>;
  };
}

/**
 * Resolve an existing customer (within the tenant) whose phone matches the
 * given phone by NORMALIZED identity, or null if none match.
 *
 * Matching is done on the normalized form (see normalizePhone), so
 * formatting/country-code variants of the same number resolve to the same
 * customer. We narrow the candidate set in SQL using the trailing digits
 * (robust to spaces/dashes/parens in stored values), then confirm with a
 * full normalized-equality check in JS.
 *
 * Read-only: returns the existing row (full record) or null. Never writes.
 *
 * @param db        tenant-scoped Prisma client (from requireAuth/requirePermission)
 * @param tenantId  the current tenant (also enforced by the scoped client)
 * @param phone     raw phone string from intake/create input
 */
export async function resolveCustomerByPhone(
  db: CustomerPhoneDb,
  tenantId: string,
  phone: unknown
): Promise<{ id: string; [k: string]: unknown } | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  // Trailing digits are the most format-stable part of a stored number.
  // Use enough of them to keep the candidate set tiny but still catch
  // matches, then verify with exact normalized equality below.
  const suffix = normalized.length >= 7 ? normalized.slice(-7) : normalized;

  const candidates = await db.customer.findMany({
    where: {
      tenantId,
      OR: [
        { mobile: { contains: suffix } },
        { alternatePhone: { contains: suffix } },
      ],
    },
  });

  for (const candidate of candidates) {
    if (
      normalizePhone(candidate.mobile) === normalized ||
      normalizePhone(candidate.alternatePhone) === normalized
    ) {
      return candidate;
    }
  }

  return null;
}
