"use client";

/**
 * The directory's Contents view: the product read as a book. Journeys are
 * numbered chapters (a sub-journey is 3.1), screens their sections, promises the
 * lines under them; the two honest shelves are appendices A and B. It reads in
 * two columns on a wide window, and its back is the Index — every promise A–Z
 * with the chapters it lives in — one switch away (`?co=index`). A depth switch
 * (`?cd=`) says how far down the chapters unfold.
 *
 * A chapter, screen or locator is a door into Mapping when the page gives the
 * view `onOpenJourney`; a promise opens its panel.
 *
 * Styles: app/m3/acceptances-directory.css (`ka-contents-`).
 */
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryWriter } from "@/lib/hooks/useQueryWriter";
import type { Node } from "@/lib/data/types";
import type { Journey, JourneyScreen, MappingModel, PromiseModel } from "@/lib/utils/acceptances-model";
import { MAPPING_FONT, OUTSIDE_KEY, UNANCHORED_KEY, journeyTree, plural } from "./journey-kit";
import { PromiseMarks } from "./kit";

export type OpenJourney = (key: string, title?: string) => void;

interface ContentsProps {
  mapping: MappingModel;
  onSelect: (node: Node) => void;
  /** Opens a journey (or shelf) in Mapping. Absent: chapters, screens and locators are only read. */
  onOpenJourney?: OpenJourney;
}

type Depth = "chapters" | "screens" | "promises";
const DEPTHS: { id: Depth; label: string }[] = [
  { id: "chapters", label: "Chapters" },
  { id: "screens", label: "Screens" },
  { id: "promises", label: "Promises" },
];

interface Chapter {
  journey: Journey;
  number: string;
  depth: number;
}

/** Journeys in reading order, numbered like a book: 1, 2, 2.1, 3 … (a sub-flow seen twice is listed once). */
function chaptersOf(mapping: MappingModel): Chapter[] {
  const counters: number[] = [];
  const out: Chapter[] = [];
  for (const r of journeyTree(mapping)) {
    if (r.repeat) continue;
    counters.length = r.depth + 1;
    counters[r.depth] = (counters[r.depth] ?? 0) + 1;
    out.push({ journey: r.journey, number: counters.map((n) => n ?? 1).join("."), depth: r.depth });
  }
  return out;
}

function useDepth(): [Depth, (d: Depth) => void] {
  const params = useSearchParams();
  const write = useQueryWriter();
  const raw = params.get("cd");
  const depth: Depth = raw === "chapters" || raw === "promises" ? raw : "screens";
  return [
    depth,
    (d) =>
      write((q) => {
        if (d === "screens") q.delete("cd");
        else q.set("cd", d);
      }),
  ];
}

function Leader({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="ka-contents-dots" aria-hidden="true" />
      <b className="ka-contents-n ka-mapping-num">{children}</b>
    </>
  );
}

function Gap({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className="ka-contents-gap" title={plural(n, "gap")}>
      <span className="sr-only">, {plural(n, "gap")}</span>
    </span>
  );
}

/** One line of the contents: a door into Mapping when it has somewhere to go, plain text when it does not. */
function Row({ kind, self, onOpen, label, children }: { kind: "chapter" | "screen"; self?: boolean; onOpen?: () => void; label?: string; children: ReactNode }) {
  const attrs = { className: "ka-contents-row", "data-kind": kind, "data-self": self ? "" : undefined };
  if (!onOpen) return <div {...attrs}>{children}</div>;
  return (
    <button type="button" {...attrs} aria-label={label} onClick={onOpen}>
      {children}
    </button>
  );
}

function PromiseLines({ promises, onSelect }: { promises: readonly PromiseModel[]; onSelect: (node: Node) => void }) {
  return (
    <ul className="ka-contents-promises">
      {promises.map((p) => (
        <li key={p.id}>
          <button type="button" className="ka-contents-line" data-ac-row data-ac-gap={p.hasGap} data-ac-status={p.status} onClick={() => onSelect(p.node)}>
            <span className="ka-contents-name">{p.title}</span>
            <span className="ka-contents-dots" aria-hidden="true" />
            <PromiseMarks promise={p} size="sm" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Screens({ screens, depth, onOpen, onSelect }: { screens: readonly JourneyScreen[]; depth: Depth; onOpen?: () => void; onSelect: (node: Node) => void }) {
  const held = screens.filter((s) => s.promises.length > 0);
  if (held.length === 0) return null;
  return (
    <ul className="ka-contents-screens">
      {held.map((s) => {
        const gaps = s.promises.filter((p) => p.hasGap).length;
        return (
          <li key={s.view.id}>
            <Row kind="screen" onOpen={onOpen}>
              <span className="ka-contents-name">
                {s.view.title}
                <Gap n={gaps} />
              </span>
              <Leader>{s.promises.length}</Leader>
            </Row>
            {depth === "promises" && <PromiseLines promises={s.promises} onSelect={onSelect} />}
          </li>
        );
      })}
    </ul>
  );
}

// ── Contents: the chapters ──────────────────────────────────────────────────

function Book({ mapping, onSelect, onOpenJourney, arrange }: ContentsProps & { arrange: ReactNode }) {
  const [depth, setDepth] = useDepth();
  if (mapping.empty) return <p className="p-6 text-sm text-muted-foreground">{mapping.emptyMessage}</p>;
  const chapters = chaptersOf(mapping);
  // Distinct promises: one promise in two journeys is one gap, as Parity counts it.
  const gapIds = new Set<string>();
  for (const j of mapping.journeys) for (const p of j.promises) if (p.hasGap) gapIds.add(p.id);
  for (const sc of mapping.outside) for (const p of sc.promises) if (p.hasGap) gapIds.add(p.id);
  for (const p of mapping.unanchored) if (p.hasGap) gapIds.add(p.id);
  const gaps = gapIds.size;
  const outsideCount = mapping.outside.reduce((n, s) => n + s.promises.length, 0);
  const door = (key: string, title: string) => (onOpenJourney ? () => onOpenJourney(key, title) : undefined);

  return (
    <article className={`${MAPPING_FONT} ka-mapping-scope ka-contents`} data-spread="" aria-label="Contents">
      <header className="ka-contents-head">
        <div>
          <h2 className="ka-contents-title ka-mapping-display">Contents</h2>
          <p className="ka-contents-sub">
            {plural(mapping.totals.journeys, "chapter")} · {plural(mapping.totals.promises, "promise")}
            {gaps > 0 && <> · {plural(gaps, "gap")}</>}
          </p>
        </div>
        <span className="ka-contents-tools">
          <span className="ka-contents-depth" role="group" aria-label="How deep">
            {DEPTHS.map((d) => (
              <button key={d.id} type="button" aria-pressed={depth === d.id} onClick={() => setDepth(d.id)}>
                {d.label}
              </button>
            ))}
          </span>
          {arrange}
        </span>
      </header>

      <ol className="ka-contents-chapters">
        {chapters.map(({ journey: j, number, depth: level }) => {
          const open = door(j.id, j.title);
          return (
            <li key={j.id} className="ka-contents-chapter" data-level={Math.min(level, 2)} data-gap={j.gaps > 0 ? "" : undefined}>
              <Row
                kind="chapter"
                onOpen={open}
                label={`Chapter ${number}, ${j.title}, ${plural(j.promises.length, "promise")}${j.gaps ? `, ${plural(j.gaps, "gap")}` : ""} — open in Mapping`}
              >
                <span className="ka-contents-num ka-mapping-num" aria-hidden="true">{number}</span>
                <span className="ka-contents-name">
                  {j.title}
                  <Gap n={j.gaps} />
                </span>
                <Leader>{j.promises.length}</Leader>
              </Row>
              {depth !== "chapters" && (
                <>
                  {j.direct.length > 0 && (
                    <ul className="ka-contents-screens">
                      <li>
                        <Row kind="screen" self onOpen={open}>
                          <span className="ka-contents-name">The journey itself</span>
                          <Leader>{j.direct.length}</Leader>
                        </Row>
                        {depth === "promises" && <PromiseLines promises={j.direct} onSelect={onSelect} />}
                      </li>
                    </ul>
                  )}
                  <Screens screens={j.screens} depth={depth} onOpen={open} onSelect={onSelect} />
                  {j.uncovered > 0 && depth === "screens" && <p className="ka-contents-note">+ {plural(j.uncovered, "screen")} with no promise yet</p>}
                </>
              )}
            </li>
          );
        })}
      </ol>

      {(mapping.outside.length > 0 || mapping.unanchored.length > 0) && (
        <ol className="ka-contents-appendices" aria-label="Appendices">
          {mapping.outside.length > 0 && (
            <li className="ka-contents-chapter" data-appendix="">
              <Row kind="chapter" onOpen={door(OUTSIDE_KEY, "Outside any journey")}>
                <span className="ka-contents-num" aria-hidden="true">A</span>
                <span className="ka-contents-name">Outside any journey</span>
                <Leader>{outsideCount}</Leader>
              </Row>
              {depth !== "chapters" && <Screens screens={mapping.outside} depth={depth} onOpen={door(OUTSIDE_KEY, "Outside any journey")} onSelect={onSelect} />}
            </li>
          )}
          {mapping.unanchored.length > 0 && (
            <li className="ka-contents-chapter" data-appendix="">
              <Row kind="chapter" onOpen={door(UNANCHORED_KEY, "Unanchored")}>
                <span className="ka-contents-num" aria-hidden="true">{mapping.outside.length > 0 ? "B" : "A"}</span>
                <span className="ka-contents-name">Unanchored — covers nothing</span>
                <Leader>{mapping.unanchored.length}</Leader>
              </Row>
              {depth === "promises" && <PromiseLines promises={mapping.unanchored} onSelect={onSelect} />}
            </li>
          )}
        </ol>
      )}
    </article>
  );
}

// ── Index: every promise A–Z, where it lives ─────────────────────────────────

interface Locator {
  key: string;
  label: string;
  title: string;
}

const locatorTitle = (x: Locator) => (x.key === OUTSIDE_KEY ? "Outside any journey" : x.key === UNANCHORED_KEY ? "Unanchored" : x.title.split(" › ")[0]);

function Index({ mapping, onSelect, onOpenJourney, arrange }: ContentsProps & { arrange: ReactNode }) {
  if (mapping.empty) return <p className="p-6 text-sm text-muted-foreground">{mapping.emptyMessage}</p>;
  const chapters = chaptersOf(mapping);
  const where = new Map<string, { promise: PromiseModel; at: Locator[] }>();
  const add = (p: PromiseModel, l: Locator) => {
    const entry = where.get(p.id) ?? { promise: p, at: [] };
    if (!entry.at.some((x) => x.key === l.key)) entry.at.push(l);
    where.set(p.id, entry);
  };
  for (const c of chapters) {
    for (const p of c.journey.direct) add(p, { key: c.journey.id, label: c.number, title: c.journey.title });
    for (const s of c.journey.screens) for (const p of s.promises) add(p, { key: c.journey.id, label: c.number, title: `${c.journey.title} › ${s.view.title}` });
  }
  for (const s of mapping.outside) for (const p of s.promises) add(p, { key: OUTSIDE_KEY, label: "A", title: `Outside any journey › ${s.view.title}` });
  const unLabel = mapping.outside.length > 0 ? "B" : "A";
  for (const p of mapping.unanchored) add(p, { key: UNANCHORED_KEY, label: unLabel, title: "Unanchored" });

  // An index files "A calm answer…" under C, as a book's index would.
  const sortKey = (t: string) => t.trim().replace(/^(a|an|the)\s+/i, "").replace(/^[^\p{L}\p{N}]+/u, "");
  const entries = [...where.values()].sort((a, b) => sortKey(a.promise.title).localeCompare(sortKey(b.promise.title), undefined, { sensitivity: "base" }));
  const letterOf = (t: string) => {
    const c = sortKey(t).charAt(0).toLocaleUpperCase();
    return /\p{L}/u.test(c) ? c : "#";
  };
  const byLetter = new Map<string, typeof entries>();
  for (const e of entries) {
    const l = letterOf(e.promise.title);
    byLetter.set(l, [...(byLetter.get(l) ?? []), e]);
  }
  const letters = [...byLetter.keys()];
  const jump = (l: string) => document.getElementById(`ka-contents-idx-${l}`)?.scrollIntoView({ block: "start" });

  return (
    <article className={`${MAPPING_FONT} ka-mapping-scope ka-contents`} data-index="" aria-label="Index">
      <header className="ka-contents-head">
        <div>
          <h2 className="ka-contents-title ka-mapping-display">Index</h2>
          <p className="ka-contents-sub">
            {plural(entries.length, "promise")}, A–Z · each with the chapters it lives in
          </p>
        </div>
        <span className="ka-contents-tools">{arrange}</span>
      </header>
      <nav className="ka-contents-letters" aria-label="Letters">
        {letters.map((l) => (
          <button key={l} type="button" onClick={() => jump(l)}>
            {l}
          </button>
        ))}
      </nav>
      <div className="ka-contents-index">
        {letters.map((l) => (
          <section key={l} id={`ka-contents-idx-${l}`} className="ka-contents-letter" aria-label={l}>
            <h3 className="ka-contents-letter-h ka-mapping-display">{l}</h3>
            <ul>
              {byLetter.get(l)!.map(({ promise: p, at }) => (
                <li key={p.id} className="ka-contents-entry" data-ac-row data-ac-gap={p.hasGap} data-ac-status={p.status}>
                  <button type="button" className="ka-contents-entry-name" onClick={() => onSelect(p.node)}>
                    {p.title}
                  </button>
                  <span className="ka-contents-dots" aria-hidden="true" />
                  <PromiseMarks promise={p} size="sm" />
                  <span className="ka-contents-locs">
                    {at.map((x) =>
                      onOpenJourney ? (
                        <button key={x.key} type="button" title={x.title} aria-label={`Open ${x.title} in Mapping`} onClick={() => onOpenJourney(x.key, locatorTitle(x))}>
                          {x.label}
                        </button>
                      ) : (
                        <span key={x.key} title={x.title}>
                          <span className="sr-only">In </span>
                          {x.label}
                        </span>
                      ),
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}

// ── the switch between them ─────────────────────────────────────────────────

type Arrangement = "contents" | "index";
const ARRANGEMENTS: { id: Arrangement; label: string }[] = [
  { id: "contents", label: "Contents" },
  { id: "index", label: "A–Z" },
];

/** The Contents view, with the back of the book one switch away (`?co=index`). */
export function ContentsView(props: ContentsProps) {
  const params = useSearchParams();
  const write = useQueryWriter();
  const arrangement: Arrangement = params.get("co") === "index" ? "index" : "contents";
  const arrange = (
    <span className="ka-contents-depth ka-contents-arrange" role="group" aria-label="Arrange by">
      {ARRANGEMENTS.map((a) => (
        <button
          key={a.id}
          type="button"
          aria-pressed={arrangement === a.id}
          onClick={() =>
            write((q) => {
              if (a.id === "contents") q.delete("co");
              else q.set("co", a.id);
            })
          }
        >
          {a.label}
        </button>
      ))}
    </span>
  );
  return arrangement === "index" ? <Index {...props} arrange={arrange} /> : <Book {...props} arrange={arrange} />;
}
