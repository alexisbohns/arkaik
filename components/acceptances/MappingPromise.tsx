"use client";

/**
 * One promise inside a journey, as a dense line: marks first, then the title; a gap
 * shows as a tick on the edge. Hovering (or focusing) it opens the preview card —
 * the sentence the promise makes (the Gherkin's Then), the values it claims, where
 * it lives and where it stands on every platform. Click opens the panel.
 *
 * Styles: app/m3/acceptances-mapping.css (`ka-mapping-dense`, `ka-mapping-preview`).
 */
import type { ReactNode } from "react";
import type { Node } from "@/lib/data/types";
import type { Journey, JourneyScreen, PromiseModel } from "@/lib/utils/acceptances-model";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ValueBadge } from "@/components/values/ValueBadge";
import { thenOf } from "./journey-kit";
import { PromiseMarks } from "./kit";

/** Where the line is drawn: under a journey, under a screen no journey holds, or on a shelf. */
export interface PromiseSpot {
  journey?: Journey;
  screen?: JourneyScreen;
}

/** Where a promise lives, as plain words, for a row that is not already under its journey and screen. */
function whereLine(p: PromiseModel, { journey, screen }: PromiseSpot): string {
  const others = p.journeys.filter((j) => j.id !== journey?.id);
  if (journey) {
    return others.length === 0 ? "Only in this journey" : `Also in ${others.map((j) => j.title).join(", ")}`;
  }
  if (screen) return others.length === 0 ? `On ${screen.view.title}, outside any journey` : `On ${screen.view.title}`;
  if (p.anchors.length === 0) return "Anchored to nothing yet";
  return `Covers ${p.anchors.map((a) => a.title).join(", ")}`;
}

/** The anchored preview card the line opens: the sentence, the values, where it lives. */
function Preview({ promise, spot, children }: { promise: PromiseModel; spot: PromiseSpot; children: ReactNode }) {
  const then = thenOf(promise.gherkin);
  return (
    <HoverCard openDelay={350} closeDelay={80}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="ka-mapping-scope w-80 max-w-[calc(100vw-2rem)]" align="start" side="bottom">
        <div className="ka-mapping-preview">
          <div className="ka-mapping-preview-title">{promise.title}</div>
          <div className="ka-mapping-preview-id">{promise.id}</div>
          {then ? (
            <div className="ka-mapping-preview-then">
              <b>Then</b>
              {then}
            </div>
          ) : promise.description ? (
            <div className="ka-mapping-preview-then">{promise.description}</div>
          ) : null}
          {promise.values.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {promise.values.map((v) => (
                <ValueBadge key={v} valueId={v} />
              ))}
            </div>
          )}
          <div className="ka-mapping-preview-foot">
            <span className="ka-mapping-preview-where">{whereLine(promise, spot)}</span>
            <PromiseMarks promise={promise} size="md" />
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function MappingPromise({ promise, onSelect, journey, screen }: { promise: PromiseModel; onSelect: (node: Node) => void } & PromiseSpot) {
  return (
    <Preview promise={promise} spot={{ journey, screen }}>
      <button
        type="button"
        data-ac-row=""
        data-ac-gap={promise.hasGap}
        data-ac-status={promise.status}
        onClick={() => onSelect(promise.node)}
        className="ka-mapping-scope ka-mapping-dense ka-mapping-focusable"
      >
        <span className="ka-mapping-dense-marks">
          <PromiseMarks promise={promise} size="sm" />
        </span>
        <span className="ka-mapping-dense-title">{promise.title}</span>
        {promise.hasGap && <span className="sr-only">, a platform is behind</span>}
      </button>
    </Preview>
  );
}
