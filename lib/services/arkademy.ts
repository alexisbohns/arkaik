import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";

import { ARKADEMY_FORMAT_VERSION, ARKADEMY_SCHEMA_REVISION, type ArkademyDocument } from "@/lib/arkademy/schema";
import { upgradeArkademyDocument, validateArkademyDocument } from "@/lib/arkademy/validate";
import { query, servicesConfigured } from "@/lib/services/db";
import { formatReadEtag } from "@/lib/services/graph/etag";

/**
 * The Arkademy library, read from Postgres (docs/spec/services.md § Arkademy).
 *
 * `getArkademy` is THE contract: the Arkademy pages call it in-process (wrapped
 * in React's `cache()` per request, like `/p/[id]`), and `GET /api/arkademy`
 * is a thin HTTP wrapper over it for everything that is not a page. Nothing
 * reads the library any other way, and nothing reads it from a file.
 *
 * In production one cache entry holds the validated document for
 * ARKADEMY_CACHE_SECONDS (an hour), whatever the traffic, so anonymous readers
 * and crawlers wake the (scale-to-zero) database at most once an hour. A
 * publish or a rollback does not wait for that: the upload script calls
 * POST /api/arkademy/revalidate, which expires the entry's tag at once
 * (`expireArkademyCache`), and the next read refills it. The key carries the
 * format and the schema revision, so a deploy that changes either starts from
 * an empty entry. In development it reads Postgres directly, so an upload
 * shows on the next reload.
 */

export type ArkademyLookup =
  | { status: "unconfigured" } // no DATABASE_URL
  | { status: "empty" } // the table has no row
  | { status: "invalid"; version: number } // the stored row fails today's schema
  | { status: "error" } // Postgres failed
  | { status: "ready"; version: number; uploadedAt: string; document: ArkademyDocument };

/** The newest row of arkademy_documents, as stored. */
export interface StoredArkademyRow {
  version: number;
  formatVersion: number;
  document: unknown;
  sha256: string;
  uploadedAt: string; // ISO 8601
}

/** The data cache's period: the longest a version can wait without a revalidate call. */
export const ARKADEMY_CACHE_SECONDS = 3600;
/** The tag on the cached loader; `expireArkademyCache` expires it. */
export const ARKADEMY_CACHE_TAG = "arkademy";
/**
 * The cached loader's key. A build whose format or schema revision differs
 * reads a different entry, never one an older build stored.
 */
export const ARKADEMY_CACHE_KEY_PARTS: readonly string[] = [
  "arkademy-current",
  `format-${ARKADEMY_FORMAT_VERSION}`,
  `schema-${ARKADEMY_SCHEMA_REVISION}`,
];

/** One query, uncached: the newest version, or null on an empty table. */
export async function readCurrentArkademy(): Promise<StoredArkademyRow | null> {
  const { rows } = await query<{
    version: number;
    format_version: number;
    document: unknown;
    sha256: string;
    uploaded_at: Date;
  }>(
    `select version, format_version, document, sha256, uploaded_at
     from arkademy_documents order by version desc limit 1`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    version: row.version,
    formatVersion: row.format_version,
    document: row.document,
    sha256: row.sha256,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
  };
}

type LoadedArkademy = Extract<ArkademyLookup, { status: "empty" | "invalid" | "ready" }>;

/**
 * Reads, upgrades and validates the newest row. Returns plain JSON only — the
 * data cache serialises it. Throws when Postgres fails, so a failure is
 * never cached.
 */
async function loadArkademy(): Promise<LoadedArkademy> {
  const row = await readCurrentArkademy();
  if (!row) return { status: "empty" };
  const upgraded = upgradeArkademyDocument(row.document, row.formatVersion);
  if (!upgraded.ok) {
    console.error(`[arkademy] v${row.version} cannot be read: ${upgraded.message}`);
    return { status: "invalid", version: row.version };
  }
  const result = validateArkademyDocument(upgraded.document);
  if (!result.ok) {
    // Paths and messages only: a message names a rule, never the document's text.
    const first = result.errors[0];
    console.error(
      `[arkademy] v${row.version} fails this build's schema (${result.errors.length} errors; first: ${first.path} ${first.message})`,
    );
    return { status: "invalid", version: row.version };
  }
  return { status: "ready", version: row.version, uploadedAt: row.uploadedAt, document: result.document };
}

const loadArkademyCached = unstable_cache(loadArkademy, [...ARKADEMY_CACHE_KEY_PARTS], {
  revalidate: ARKADEMY_CACHE_SECONDS,
  tags: [ARKADEMY_CACHE_TAG],
});

/**
 * Expires the cached library at once, so the next read goes to Postgres and
 * waits for it (no stale copy is served meanwhile). `{ expire: 0 }` is the
 * Next 16 form of an immediate expiry: the one-argument `revalidateTag` is
 * deprecated, and `"max"` would only mark the entry stale, serving the old
 * version once more while it refills. Call it from a route handler only.
 */
export function expireArkademyCache(): void {
  revalidateTag(ARKADEMY_CACHE_TAG, { expire: 0 });
}

/** The library, or why there is none. Never throws. */
export async function getArkademy(): Promise<ArkademyLookup> {
  if (!servicesConfigured()) return { status: "unconfigured" };
  try {
    return process.env.NODE_ENV === "production" ? await loadArkademyCached() : await loadArkademy();
  } catch (err) {
    console.error("[arkademy] load failed:", err instanceof Error ? err.message : "unknown error");
    return { status: "error" };
  }
}

/**
 * The weak validator of a version as this build serves it:
 * `W/"arkademy.<version>.f<format>.s<schema revision>"`. The format and the
 * revision are in it so a client holding a tag from an older build gets the
 * body again rather than a 304.
 */
export function arkademyEtag(version: number): string {
  return formatReadEtag([
    "arkademy",
    String(version),
    `f${ARKADEMY_FORMAT_VERSION}`,
    `s${ARKADEMY_SCHEMA_REVISION}`,
  ]);
}
