# Weighing ruler v2 (reach) — plan

Source: `~/Documents/project/arkaik/acceptances-weighing-26-11/HANDOFF.md` § "The Jev POC changed the model",
and the owner's answers there (2026-11-15). RFC: `docs/rfcs/weighing.md`.

## What changes in meaning

- **The scale measures reach in a person's life**, not centrality: +1 within the product, +2 across the
  domain, +3 life-wide; negatives mirror. No centrality axis.
- **Per-element ladders.** Each of the 30 elements carries its own −3..+3 anchors (drafted in the Jev POC,
  `data/ladders.global.json`; only the Informs positives are the owner's wording — the rest is a draft for
  the owner to review). Informs is asked as "mainly gives information".
- **Seed:** every claimed value is guessed at +1, whatever its position.
- **`claim_not_supported` fires on a judged 0 only.** +1 is a supported claim.
- **Probabilities, sparingly:** an assessment may carry `p_serves` and `p_costs` (0..1). A cell is
  **uncertain** when the scorer was under 0.7 sure of the direction it chose, or at least 0.3 sure of the
  other one (the POC's gates). The interface shows only a "range" marker; `get_matrix` omits the numbers
  unless asked.
- **Caps ignore −1** (slice 2 — recorded in the RFC only; caps are not built yet).
- **Need = opportunity** (confirmed): "need" in the interface, `opportunity` in the schema.

## Migration

`value-contribution` goes to **2.0.0** and the built-in `value` matrix to `value-contribution@2`. The major
bump makes every v1 cell **stale** (it still wins and still counts, flagged, until re-scored — the existing
staleness rule). v1 stays in the library, frozen, so a positioning or project matrix that says `@1` still
resolves; the validator says a positioning on an older ruler should be re-saved.

## Parts

1. **`weighing-ruler-v2`** — schema, gate, MCP, docs. Library v2 + v1 kept, `setOfRef` by id and major, seed
   +1, flag on 0, `p_serves`/`p_costs` through types, zod leaves, planner (0..1), fold (passes through),
   validator (`weighing-probability-shape`, `weighing-positioning-old-ruler`), derive (`uncertain`), MCP
   (`assess` accepts them; `get_matrix` gets per-element ladders on `subject`, `probabilities` opt-in,
   `uncertain` filter; anchor reply reads the element's ladder), RFC §§ 3/7/8/11 + specs, the seed copy in
   the panel. Regenerate.
2. **`weighing-ruler-v2-panel`** — the weighing panel reads the ladder: each level option's tooltip is the
   element's anchor, the chosen level's anchor shows under the control, and an uncertain cell carries a
   "range" marker.
