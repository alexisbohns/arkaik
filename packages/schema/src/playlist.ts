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
);

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
);

export interface FlowPlaylist {
  entries: PlaylistEntry[];
}

export const FlowPlaylistSchema: z.ZodType<FlowPlaylist> = z.object({
  entries: z.array(PlaylistEntrySchema),
});
