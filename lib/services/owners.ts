import "server-only";

import { query, withTransaction } from "@/lib/services/db";

/**
 * Owner resolution — the tenancy seam (db/migrations/006_owners.sql).
 *
 * Every hosted resource (API tokens now; graph projects and repo links next)
 * belongs to an *owner*, not to a user. This module is the only place that knows
 * how a user maps to the owners they can act as.
 *
 * Personal owner ids are derived from the user id rather than random, so the
 * migration's backfill and {@link ensurePersonalOwner}'s lazy path independently
 * produce the same id. Either can run first; neither can create a duplicate.
 */

/** Prefix for derived personal-owner ids. Must match 006_owners.sql's backfill. */
export const PERSONAL_OWNER_PREFIX = "own-u";

/** The deterministic personal-owner id for a user. */
export function personalOwnerId(userId: number): string {
  return `${PERSONAL_OWNER_PREFIX}${userId}`;
}

export interface OwnerRecord {
  id: string;
  kind: "personal" | "org";
  name: string;
}

/**
 * Create the user's personal owner and membership if they have none, and return
 * the owner id. Idempotent: both inserts are `on conflict do nothing`, and they
 * share one transaction so a failure can never leave an owner with no member.
 *
 * Called from the lazy path in {@link resolveOwnerIds}, so a user created after
 * 006's backfill (or one whose sign-in event failed) still gets an owner on
 * their next authenticated request rather than hitting an empty-owner error.
 */
export async function ensurePersonalOwner(
  userId: number,
  displayName?: string | null,
): Promise<string> {
  const id = personalOwnerId(userId);
  const name = displayName?.trim() || "Personal";

  await withTransaction(async (client) => {
    await client.query(
      `insert into owners (id, kind, name) values ($1, 'personal', $2)
       on conflict (id) do nothing`,
      [id, name],
    );
    await client.query(
      `insert into owner_members (owner_id, user_id, role) values ($1, $2, 'owner')
       on conflict (owner_id, user_id) do nothing`,
      [id, userId],
    );
  });

  return id;
}

/**
 * Every owner id the user can act as. Resolved on each authenticated request, so
 * it is one indexed read against `owner_members_user_idx`.
 *
 * The empty result triggers {@link ensurePersonalOwner} — the common path costs
 * no extra query, because the lookup had to happen regardless.
 */
export async function resolveOwnerIds(
  userId: number,
  displayName?: string | null,
): Promise<string[]> {
  const { rows } = await query<{ owner_id: string }>(
    `select owner_id from owner_members where user_id = $1 order by owner_id`,
    [userId],
  );
  if (rows.length > 0) return rows.map((row) => row.owner_id);

  return [await ensurePersonalOwner(userId, displayName)];
}

/** The user's owners with their display metadata, for settings surfaces. */
export async function listOwners(userId: number): Promise<OwnerRecord[]> {
  const { rows } = await query<OwnerRecord>(
    `select o.id, o.kind, o.name
       from owners o
       join owner_members m on m.owner_id = o.id
      where m.user_id = $1
      order by o.kind, o.name`,
    [userId],
  );
  return rows;
}

/**
 * Whether the user may act as this owner. Callers that accept an owner id from
 * the client MUST gate on this — it is the single membership check standing
 * between a request and another tenant's data.
 */
export async function userBelongsToOwner(userId: number, ownerId: string): Promise<boolean> {
  const { rows } = await query<{ one: number }>(
    `select 1 as one from owner_members where user_id = $1 and owner_id = $2`,
    [userId, ownerId],
  );
  return rows.length > 0;
}
