import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * GitHub webhook signature verification.
 *
 * THIS IS THE ONLY INBOUND SIGNATURE CHECK IN THE CODEBASE — before this, no
 * route accepted a signed request from a third party. It is kept in its own
 * module, with no database or business logic, so the security-critical part is
 * small enough to audit in one read.
 *
 * The rules, and why each one is here:
 *
 *  - **Unsigned is rejected.** Not "verified when a secret is configured" —
 *    absent configuration means the endpoint refuses everything, because a
 *    deployment that forgot `GITHUB_WEBHOOK_SECRET` must not silently accept
 *    unauthenticated writes.
 *  - **The RAW body is signed**, not a re-serialization of parsed JSON.
 *    `JSON.parse` then `JSON.stringify` does not round-trip byte-for-byte
 *    (key order, number formatting, unicode escapes), so a re-serialized body
 *    would fail against a valid signature — and any attempt to "fix" that by
 *    relaxing the comparison would defeat the check.
 *  - **Constant-time comparison.** A byte-by-byte early return would leak the
 *    expected digest to an attacker who can time responses.
 */

/** GitHub sends `sha256=<hex>` in this header. */
export const SIGNATURE_HEADER = "x-hub-signature-256";

/** Unique per delivery, including retries of the same event. */
export const DELIVERY_HEADER = "x-github-delivery";

export const EVENT_HEADER = "x-github-event";

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "unconfigured" | "missing-signature" | "malformed-signature" | "mismatch" };

/**
 * Verify a raw request body against the configured secret.
 *
 * `rawBody` MUST be the exact bytes received — read it with `req.text()` before
 * any parsing, and parse only after this returns ok.
 */
export function verifySignature(rawBody: string, signatureHeader: string | null): VerifyResult {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: "unconfigured" };
  if (!signatureHeader) return { ok: false, reason: "missing-signature" };

  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (!match) return { ok: false, reason: "malformed-signature" };

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const presented = Buffer.from(match[1], "hex");

  // Both are 32-byte digests by construction — the regex fixes the length — so
  // timingSafeEqual cannot throw on a length mismatch.
  if (presented.length !== expected.length) return { ok: false, reason: "mismatch" };
  return timingSafeEqual(presented, expected) ? { ok: true } : { ok: false, reason: "mismatch" };
}
