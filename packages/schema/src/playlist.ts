import { z } from "zod";

export interface JunctionCase {
  label: string;
  entries: PlaylistEntry[];
}

export type PlaylistEntry =
  | { type: "view"; view_id: string }
  | { type: "flow"; flow_id: string }
  | { type: "condition"; label: string; if_true: PlaylistEntry[]; if_false: PlaylistEntry[] }
  | { type: "junction"; label: string; cases: JunctionCase[] };

export const JunctionCaseSchema: z.ZodType<JunctionCase> = z.lazy(() =>
  z.object({
    label: z.string(),
    entries: z.array(PlaylistEntrySchema),
  }),
).meta({ id: "JunctionCase" });

export const PlaylistEntrySchema: z.ZodType<PlaylistEntry> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("view"), view_id: z.string() }),
    z.object({ type: z.literal("flow"), flow_id: z.string() }),
    z.object({
      type: z.literal("condition"),
      label: z.string(),
      if_true: z.array(PlaylistEntrySchema),
      if_false: z.array(PlaylistEntrySchema),
    }),
    z.object({
      type: z.literal("junction"),
      label: z.string(),
      cases: z.array(JunctionCaseSchema),
    }),
  ]),
).meta({
  id: "PlaylistEntry",
  description: "An entry in a flow's playlist. Discriminated union on 'type'.",
});

/**
 * Every node id a playlist references — the `view_id` of each view entry and
 * the `flow_id` of each sub-flow entry — recursing through `condition` and
 * `junction` branches. Order follows the entries; duplicates (a reused node)
 * are preserved. Pure and shape-only: it never touches the graph, so both the
 * validator's coherence check and the MCP's composes-edge synthesis
 * (docs/spec/mcp.md § Write Path) can share it.
 */
export function collectPlaylistNodeRefs(entries: PlaylistEntry[]): string[] {
  const refs: string[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.type === "view") {
      refs.push(entry.view_id);
    } else if (entry.type === "flow") {
      refs.push(entry.flow_id);
    } else if (entry.type === "condition") {
      refs.push(...collectPlaylistNodeRefs(entry.if_true ?? []));
      refs.push(...collectPlaylistNodeRefs(entry.if_false ?? []));
    } else if (entry.type === "junction") {
      for (const branch of entry.cases ?? []) {
        refs.push(...collectPlaylistNodeRefs(branch.entries ?? []));
      }
    }
  }
  return refs;
}

export interface FlowPlaylist {
  entries: PlaylistEntry[];
}

export const FlowPlaylistSchema: z.ZodType<FlowPlaylist> = z.object({
  entries: z.array(PlaylistEntrySchema),
}).meta({ id: "FlowPlaylist" });
