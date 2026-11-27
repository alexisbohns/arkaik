"use client";

/**
 * The directory's view switch: one card per view that asks its question and says
 * what it found. The cards share a row and join at the corners; the chosen one
 * rounds out. With a single view there is nothing to switch, so it is not drawn.
 *
 * Styles: app/m3/acceptances-directory.css (`ka-views-`).
 */
import { Toolbar } from "@/components/layout/Toolbar";
import type { AcceptancesModel } from "@/lib/utils/acceptances-model";
import type { DirectoryView, DirectoryViewId } from "./directory-views";

export function ViewSwitch({
  views,
  view,
  onViewChange,
  model,
}: {
  views: readonly DirectoryView[];
  view: DirectoryViewId;
  onViewChange: (view: DirectoryViewId) => void;
  model: AcceptancesModel;
}) {
  if (views.length < 2) return null;
  return (
    <Toolbar>
      <span data-ac-views className="contents">
        <div className="ka-views-box">
          <div role="group" aria-label="Acceptances view" className="ka-views">
            {views.map((v) => {
              const c = v.count(model);
              return (
                <button key={v.id} type="button" aria-pressed={view === v.id} title={v.question} className="ka-views-ask" onClick={() => onViewChange(v.id)}>
                  <span className="ka-views-ask-l">{v.label}</span>
                  <span className="ka-views-ask-q">{v.question}</span>
                  <span className="ka-views-ask-n" data-zero={c.n === 0}>
                    <b>{c.n}</b> <span>{c.word}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </span>
    </Toolbar>
  );
}
