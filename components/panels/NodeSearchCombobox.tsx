"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Node as DataNode } from "@/lib/data/types";

interface NodeSearchComboboxProps {
  species: "view" | "flow";
  allNodes: DataNode[];
  onSelect: (nodeId: string) => void;
  onCreate?: (title: string) => Promise<void> | void;
  disabled?: boolean;
}

interface Candidate {
  id: string;
  title: string;
  score: number;
}

function fuzzyScore(query: string, candidate: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;

  const c = candidate.toLowerCase();
  if (c === q) return 10_000;

  let qIndex = 0;
  let consecutive = 0;
  let bestConsecutive = 0;
  let firstMatchIndex = -1;

  for (let i = 0; i < c.length && qIndex < q.length; i += 1) {
    if (c[i] === q[qIndex]) {
      if (firstMatchIndex < 0) firstMatchIndex = i;
      qIndex += 1;
      consecutive += 1;
      bestConsecutive = Math.max(bestConsecutive, consecutive);
      continue;
    }

    consecutive = 0;
  }

  if (qIndex !== q.length) return -1;

  const startBonus = firstMatchIndex === 0 ? 100 : Math.max(0, 25 - firstMatchIndex);
  const lengthPenalty = Math.max(0, c.length - q.length);
  return 300 + bestConsecutive * 20 + startBonus - lengthPenalty;
}

export function NodeSearchCombobox({
  species,
  allNodes,
  onSelect,
  onCreate,
  disabled,
}: NodeSearchComboboxProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const candidates = useMemo(() => {
    const scoped = allNodes
      .filter((node) => node.species === species)
      .map((node) => {
        const searchable = `${node.id} ${node.title}`;
        return {
          id: node.id,
          title: node.title,
          score: fuzzyScore(query, searchable),
        } satisfies Candidate;
      })
      .filter((candidate) => candidate.score >= 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    return scoped.slice(0, 8);
  }, [allNodes, query, species]);

  const trimmed = query.trim();
  const hasExactTitle = allNodes.some(
    (node) => node.species === species && node.title.toLowerCase() === trimmed.toLowerCase(),
  );
  const canCreate = Boolean(trimmed) && Boolean(onCreate) && !hasExactTitle;

  async function handleCreate() {
    if (!onCreate || !trimmed || busy) return;
    setBusy(true);
    try {
      await onCreate(trimmed);
      setQuery("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  function handleSelect(nodeId: string) {
    onSelect(nodeId);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <input
        type="text"
        value={query}
        placeholder={`Search ${species}s...`}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        disabled={disabled || busy}
        className="border-input bg-transparent text-sm text-foreground leading-relaxed rounded-md border px-3 py-2 shadow-xs outline-none placeholder:text-muted-foreground focus:ring-[3px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 w-full"
        aria-label={`Search existing ${species} nodes or create a new one`}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
          <div className="max-h-60 overflow-y-auto p-1">
            {candidates.length === 0 && !canCreate && (
              <p className="px-2 py-2 text-xs text-muted-foreground">No matches.</p>
            )}
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => handleSelect(candidate.id)}
              >
                <span className="font-medium">{candidate.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">{candidate.id}</span>
              </button>
            ))}
            {canCreate && (
              <div className="border-t border-border mt-1 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={handleCreate}
                  disabled={busy}
                >
                  Create &quot;{trimmed}&quot;
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
