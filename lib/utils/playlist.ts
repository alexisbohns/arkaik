import type { PlaylistEntry } from "@/lib/data/types";

/**
 * The two pure pieces of the Flow panel's playlist editor: reordering an entry
 * inside its own list, and saying how much a branching entry holds.
 *
 * Both live here rather than in the component for the same reason the rest of
 * `lib/utils` does — they are the parts worth pinning, and pinning them costs
 * nothing: this module has no *value* imports (the `PlaylistEntry` above is an
 * `import type`, which transpiles away), so `tests/app/playlist-utils.test.js`
 * loads it with `typescript.transpileModule` and no bundler, in CI's fast job,
 * with no DOM and no database.
 */

/**
 * `entries` with the item at `from` moved to `to`.
 *
 * Returns the array **unchanged** — the same reference — for a move that would
 * change nothing: an index out of range, or a target equal to the source. The
 * caller is a persist path that writes the whole node's metadata, so handing it
 * back an equal-but-new array would mean an IndexedDB write or an HTTP request
 * for a no-op.
 *
 * Positions are **within one list**. A playlist is a tree: an entry inside a
 * condition's `Yes` branch or a junction case belongs to that sub-list, and
 * moving it renumbers that sub-list alone. Nothing here can move an entry
 * across branches, which is deliberate — that is a different gesture, and it is
 * not one the index menu offers.
 */
export function moveEntry(
  entries: PlaylistEntry[],
  from: number,
  to: number,
): PlaylistEntry[] {
  if (from === to) return entries;
  if (from < 0 || from >= entries.length) return entries;
  if (to < 0 || to >= entries.length) return entries;

  const next = [...entries];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** How many sub-lists a branching entry holds, and how many entries sit in them. */
export interface BranchCount {
  /** Sub-lists: always 2 for a condition (Yes and No), one per case for a junction. */
  groups: number;
  /** Entries directly inside those sub-lists. Not recursive — see `describeBranchCount`. */
  entries: number;
}

/**
 * The size of a branching entry, or `null` for a view or flow entry, which
 * branches into nothing.
 *
 * `entries` counts **direct** children only. A recursive total would be the
 * more impressive number and the less useful one: it answers "how big is this
 * subtree", where the reader of a shut row is asking "how much am I about to
 * unfold" — and a deep total makes two branches of one entry each look like a
 * dozen.
 */
export function countBranchChildren(entry: PlaylistEntry): BranchCount | null {
  if (entry.type === "condition") {
    return {
      groups: 2,
      entries: (entry.if_true?.length ?? 0) + (entry.if_false?.length ?? 0),
    };
  }

  if (entry.type === "junction") {
    const cases = entry.cases ?? [];
    return {
      groups: cases.length,
      entries: cases.reduce((total, item) => total + (item.entries?.length ?? 0), 0),
    };
  }

  return null;
}

/**
 * `2 branches`, `1 case`, `4 entries`. The plural form is given rather than
 * derived: every noun this module counts — branch, case, entry — pluralises in
 * a way that appending `s` gets wrong.
 */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * What a collapsed condition or junction row says about itself — "2 branches ·
 * 4 entries", "3 cases · 7 entries" — or `null` when there is nothing to say.
 *
 * The noun belongs here rather than in the JSX because it is decided by the
 * entry's own type: a condition's sub-lists are *branches* (there are always
 * two, and they are named Yes and No), a junction's are *cases* (there are as
 * many as you add). One function, one place to read the rule.
 */
export function describeBranchCount(entry: PlaylistEntry): string | null {
  const count = countBranchChildren(entry);
  if (!count) return null;

  const groups = entry.type === "condition"
    ? plural(count.groups, "branch", "branches")
    : plural(count.groups, "case", "cases");

  return `${groups} · ${plural(count.entries, "entry", "entries")}`;
}
