"use client";

import type { CSSProperties, ReactNode } from "react";
import { CircleDashedIcon, MonitorSmartphoneIcon, NetworkIcon } from "lucide-react";
import type { Edge, Node } from "@/lib/data/types";
import type { ProductScope } from "@/lib/utils/product-scope";
import { PanelGroup } from "@/components/panels/PanelGroup";
import { PANEL_GUTTER } from "@/components/panels/PanelSection";
import { useAcceptancePanel } from "@/lib/hooks/useAcceptancePanel";

interface AcceptanceWhereProps {
  node: Node;
  scope: ProductScope;
  allNodes?: Node[];
  allEdges?: Edge[];
  /** Open another node's panel. Absent, the steps are plain words — never dead controls. */
  onNavigate?: (node: Node) => void;
  readOnly: boolean;
}

type Kind = "journey" | "screen" | "outside";

/** A step of the trail: a button when the panel can navigate, plain words when it cannot. */
function Step({ node, kind, onNavigate, children }: { node?: Node; kind: Kind; onNavigate?: (node: Node) => void; children: ReactNode }) {
  const icon = kind === "journey" ? <NetworkIcon aria-hidden="true" /> : kind === "screen" ? <MonitorSmartphoneIcon aria-hidden="true" /> : <CircleDashedIcon aria-hidden="true" />;
  if (node && onNavigate) {
    return (
      <button type="button" className="kap-trail-step kap-focusable" data-kind={kind} onClick={() => onNavigate(node)}>
        {icon}
        <span>{children}</span>
      </button>
    );
  }
  return (
    <span className="kap-trail-step" data-kind={kind}>
      {icon}
      <span>{children}</span>
    </span>
  );
}

/**
 * WHERE an acceptance lives: a staircase from the outermost journey down to
 * the screen it covers, and this promise on its last step, with the promises
 * beside it on the same screen. A group above the shared Relations (where the
 * links are added and removed); this one only orients.
 *
 * Read off the model's `where` — the same journey rule the directory's Mapping
 * view draws. A promise covering a screen no journey holds says so ("Outside
 * any journey"), and one covering nothing says "Unanchored".
 */
export function AcceptanceWhere({ node, scope, allNodes, allEdges, onNavigate, readOnly }: AcceptanceWhereProps) {
  const { promise, where } = useAcceptancePanel({ node, allNodes, allEdges, scope, readOnly });
  const first = where.places[0];
  const chain = first ? [...first.trail, first.journey] : [];
  const screen = where.screen;
  const depth = (n: number) => ({ "--kap-depth": n }) as CSSProperties;
  return (
    <PanelGroup title="You are here">
      <div className={`${PANEL_GUTTER} kap-scope kap-rel`}>
        {where.unanchored ? (
          <p className="kap-lives-note">Unanchored: this promise covers no screen or flow yet.</p>
        ) : (
          <ol className="kap-trail">
            {first ? (
              chain.map((n, i) => (
                <li key={n.id} style={depth(i)}>
                  <Step node={n} kind="journey" onNavigate={onNavigate}>
                    {n.title}
                  </Step>
                </li>
              ))
            ) : (
              <li style={depth(0)}>
                <Step kind="outside">Outside any journey</Step>
              </li>
            )}
            {screen && (
              <li style={depth(first ? chain.length : 1)}>
                <Step node={screen} kind="screen" onNavigate={onNavigate}>
                  {screen.title}
                </Step>
                <span className="kap-trail-count">
                  {where.beside.length + 1} {where.beside.length === 0 ? "promise" : "promises"}
                </span>
              </li>
            )}
            <li className="kap-trail-here" style={depth((first ? chain.length : 1) + (screen ? 1 : 0))} aria-current="location">
              <span className="kap-trail-dot" aria-hidden="true" />
              <span>{promise.title}</span>
            </li>
          </ol>
        )}
        {where.places.length > 1 && (
          <p className="kap-trail-more">
            Also in{" "}
            {where.places.slice(1).map((place, i) => (
              <span key={place.journey.id}>
                {i > 0 && ", "}
                <Step node={place.journey} kind="journey" onNavigate={onNavigate}>
                  {place.journey.title}
                </Step>
              </span>
            ))}
          </p>
        )}
        {where.beside.length > 0 && screen && (
          <div className="kap-sibs">
            <p>Also on {screen.title}</p>
            <ul>
              {where.beside.slice(0, 5).map((s) => (
                <li key={s.id}>
                  {onNavigate ? (
                    <button type="button" className="kap-focusable" onClick={() => onNavigate(s)}>
                      {s.title}
                    </button>
                  ) : (
                    <span>{s.title}</span>
                  )}
                </li>
              ))}
              {where.beside.length > 5 && <li className="kap-sibs-more">+{where.beside.length - 5} more</li>}
            </ul>
          </div>
        )}
      </div>
    </PanelGroup>
  );
}
