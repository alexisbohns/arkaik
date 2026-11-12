import "server-only";

import { unstable_cache } from "next/cache";

import type { ArkademyDocument } from "@/lib/arkademy/schema";
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
 * ARKADEMY_CACHE_SECONDS, whatever the traffic, so anonymous readers and
 * crawlers never wake the (scale-to-zero) database per view. In development
 * it reads Postgres directly, so an upload shows on the next reload.
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

export const ARKADEMY_CACHE_SECONDS = 300;

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

const loadArkademyCached = unstable_cache(loadArkademy, ["arkademy-current"], {
  revalidate: ARKADEMY_CACHE_SECONDS,
  tags: ["arkademy"],
});

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

/** The weak validator of a version: `W/"arkademy.<version>"`. */
export function arkademyEtag(version: number): string {
  return formatReadEtag(["arkademy", String(version)]);
}
