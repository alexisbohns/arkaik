/**
 * Domain types for the app.
 *
 * These are re-exported from `@arkaik/schema` — the single source of truth for
 * the ProjectBundle shape (zod schemas + inferred types). Re-exporting here,
 * rather than declaring the shapes a second time, means the app and the schema
 * package can never drift. See `docs/spec/toolchain.md` § @arkaik/schema.
 *
 * The `~23` existing importers of `@/lib/data/types` are unaffected: every name
 * they consumed is still exported from this module.
 */
import type { SpeciesId, StatusId, PlatformId, EdgeTypeId } from "@arkaik/schema";

export type {
  PlatformStatusMap,
  PlatformNotesMap,
  PlatformScreenshotsMap,
  PlaylistEntry,
  JunctionCase,
  FlowPlaylist,
  NodeMetadata,
  Node,
  Edge,
  Project,
  ProjectMetadata,
  ProjectBundle,
} from "@arkaik/schema";

/** Species of a node — the SPECIES config id union. */
export type Species = SpeciesId;
/** Lifecycle status of a node — the STATUSES config id union. */
export type Status = StatusId;
/** Platform the node is available on — the PLATFORMS config id union. */
export type Platform = PlatformId;
/** Relationship type between two nodes — the EDGE_TYPES config id union. */
export type EdgeType = EdgeTypeId;
