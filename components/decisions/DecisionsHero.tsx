"use client";

import { useEffect, useRef } from "react";
import { PlusIcon } from "lucide-react";
import type { DecisionLogModel, DecisionStatusFilter } from "@/lib/utils/decision-log";
import { Shape, StatusSeal, plural } from "@/components/decisions/DecisionMarks";

/**
 * The toolbar's height plus the 4px gap under it (PageSurface's
 * `--surface-sticky-top`): the hero counts as gone once it is entirely under
 * the pinned bar.
 */
const UNDER_TOOLBAR = "-68px 0px 0px 0px";

/**
 * The Decisions page's hero: how many decisions there are and how they stand,
 * as six status keys that are also the page's status filter (a second press on
 * the chosen one lets go of it), with "New decision" beside the headline.
 *
 * **It bleeds to the content segment's edges**, as a node panel's hero does
 * under its header — the page's one loud thing, joined to the toolbar above it
 * by the segments' 4px gap. While it is on screen the toolbar wears its tint
 * (and re-tones its controls for it: app/m3/decisions.css); once it has
 * scrolled away under the bar, the bar goes back to its own colour. That is
 * marked on the surface as `data-dc-hero-gone` by an IntersectionObserver —
 * the bar is a sibling of the page content, so there is no React parent to
 * hold the state without lifting it into `PageSurface`.
 */
export function DecisionsHero({
  log,
  statusFilter,
  onStatusFilterChange,
  onNew,
}: {
  log: DecisionLogModel;
  statusFilter: DecisionStatusFilter;
  onStatusFilterChange: (status: DecisionStatusFilter) => void;
  onNew: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const surface = el?.closest<HTMLElement>("[data-surface-segments]");
    if (!el || !surface) return;
    const observer = new IntersectionObserver(
      ([entry]) => surface.toggleAttribute("data-dc-hero-gone", !entry.isIntersecting),
      { root: surface, rootMargin: UNDER_TOOLBAR },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      surface.removeAttribute("data-dc-hero-gone");
    };
  }, []);

  return (
    <div ref={ref} data-dc-hero="bleed">
      <section className="dc-hero" data-hero="keys" aria-label="Decisions overview">
        <div className="dc-hero-head">
          <div className="dc-hero-text">
            <h2 className="dc-hero-title">{plural(log.total, "decision")}</h2>
            <p className="dc-hero-sub">
              {plural(log.open.length, "open call")}
              {log.chains > 0 && !log.flat && <> · {plural(log.chains, "replacement chain")}</>}
              {log.latest?.dateLabel && <> · latest {log.latest.dateLabel}</>}
            </p>
          </div>
          <button type="button" className="dc-btn" data-tone="filled" onClick={onNew}>
            <PlusIcon aria-hidden="true" />
            New decision
          </button>
        </div>
        <div role="group" aria-label="Show decisions by status" className="dc-keys">
          <button
            type="button"
            className="dc-key"
            data-all=""
            aria-pressed={statusFilter === "all"}
            onClick={() => onStatusFilterChange("all")}
          >
            <span className="dc-key-count">{log.total}</span>
            <span className="dc-key-label">All</span>
          </button>
          {log.counts.map(({ status, label, count }) => (
            <button
              key={status}
              type="button"
              className="dc-key"
              data-dc-status={status}
              data-zero={count === 0 ? "" : undefined}
              aria-pressed={statusFilter === status}
              aria-label={`${label} (${count})`}
              onClick={() => onStatusFilterChange(statusFilter === status ? "all" : status)}
            >
              <StatusSeal status={status} size="xs" />
              <span className="dc-key-count">{count}</span>
              <span className="dc-key-label">{label}</span>
            </button>
          ))}
        </div>
        <Shape name="flower" className="dc-hero-shape" />
      </section>
    </div>
  );
}
