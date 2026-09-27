"use client";

import { useMemo } from "react";
import { deriveQualityMatrix, deriveQualityTrend, resolveKritikLibrary } from "@arkaik/schema";
import { useEdges } from "@/lib/hooks/useEdges";
import { useJournal } from "@/lib/hooks/useJournal";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProject } from "@/lib/hooks/useProject";
import { buildFindingRows, buildSurfaceTitles } from "@/lib/utils/quality";

/**
 * The one event type the trend reads. Module-level so the projection's cache
 * key is stable across renders (`useJournal` normalizes the list, but a fresh
 * array per render is still a fresh options object per render).
 */
const AUDIT_EVENTS = ["quality.audit.completed"] as const;

/**
 * Everything both Quality pages read.
 *
 * The Matrix page and the Findings page look at one audit from two angles, and
 * before the split they were one component deriving all of this inline. Two
 * copies of that derivation would be two chances for the matrix's column
 * headers and the board's cards to call the same surface by different names —
 * which is the very drift `buildSurfaceTitles` exists to prevent.
 *
 * The nodes and edges are here because both pages mount `PageShell`, which
 * resolves node panels against them: without them, following a finding into its
 * linked node opens a panel that cannot find its node.
 */
export function useQualityData(projectId: string) {
  const { nodes, loading: nodesLoading, error: nodesError, reload: reloadNodes } = useNodes(projectId);
  const { edges, loading: edgesLoading, error: edgesError, reload: reloadEdges } = useEdges(projectId);
  const { project, error: projectError, reload: reloadProject } = useProject(projectId);
  // Only the audit events, projected: the trend is what the arrows and the
  // cell panel's History read, and on a hosted project the rest of the journal
  // never crosses the network for it. Not folded into `loading` — the matrix
  // renders as soon as the section does, and the arrows arrive with the read.
  const { journal: audits, reload: reloadJournal } = useJournal(projectId, { types: AUDIT_EVENTS });

  const section = project?.quality;
  const profile = section?.profile;
  const library = useMemo(() => resolveKritikLibrary(section), [section]);
  const matrix = useMemo(() => deriveQualityMatrix({ quality: section }, library), [section, library]);
  // The live matrix is the baseline, not the last event — see the head of
  // `quality-trend.ts` for why a just-recorded audit still gets an arrow.
  const trend = useMemo(() => deriveQualityTrend(audits, profile, matrix), [audits, profile, matrix]);

  // Split rather than chained, and the split is the point:
  // `react-hooks/preserve-manual-memoization` is an error here and it refuses a
  // single memo wrapping the whole build-narrow-group chain. Each of these is
  // an opaque imported call over the props that are also its deps, which is the
  // shape the rule accepts. They are real memoization either way — the React
  // Compiler does not run in this build — and the pilot audit is 246 findings.
  const rows = useMemo(() => buildFindingRows(section, library), [section, library]);
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  // The project's audit targets, not a constant: the filter bar's surface menu
  // offers exactly what the profile declared, so a surface this project never
  // audited is never offered as a way to narrow to nothing.
  const surfaces = useMemo(() => section?.profile?.surfaces ?? [], [section]);
  const domains = useMemo(() => library?.domains ?? [], [library]);
  // One titles map for both pages. The cards and the board name the same axis,
  // and a component deriving its own would be free to call `supabase` what the
  // heading two rows up calls "Database contract".
  const surfaceTitles = useMemo(() => buildSurfaceTitles(section), [section]);

  const reload = () => {
    void reloadNodes();
    void reloadEdges();
    void reloadProject();
    void reloadJournal();
  };

  return {
    project,
    section,
    library,
    matrix,
    trend,
    rows,
    nodes,
    edges,
    nodesById,
    surfaces,
    domains,
    surfaceTitles,
    loading: nodesLoading || edgesLoading,
    error: nodesError ?? edgesError ?? projectError,
    reload,
  };
}
