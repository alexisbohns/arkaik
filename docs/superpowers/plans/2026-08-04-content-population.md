# Content Population (Self-Map Cycle 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This plan's tasks are agent fan-outs, not code edits** — the orchestrating session dispatches the wave agents itself (parallel `Agent` calls) and runs the merge/validate machinery between waves.

**Goal:** Populate `seed/arkaik-self-map.json` with the whole Arkaik product (~160–210 nodes, 60–90 valued acceptances) and a curated history (~60–120 deliverables, 8–12 thematic releases, ~12–18 decisions), landing as two stacked PRs.

**Architecture:** Corpus-first layered fan-out (spec: `docs/superpowers/specs/2026-08-04-content-population-design.md`). Agents emit JSON *fragments* into a scratch directory; a deterministic merge script owns ID uniqueness, edge derivation, `node.created` coverage, and journal ordering; `validate-bundle.js` (warning-clean) gates every wave. Agents never edit the seed.

**Tech Stack:** Node scripts in the session scratchpad (never committed), `gh` CLI for the PR corpus, `npm run validate:seeds` as the gate, parallel general-purpose subagents for content authoring.

**Conventions used below:**
- `$REPO` = the repo root (`/Users/alexis/code/arkaik`).
- `$SCRATCH` = `<session scratchpad>/cycle5` (created in Task 0). Layout: `corpus/`, `fragments/`, `base-seed.json`, `dates.json`, `project-patch.json`, `merge.mjs`, `arcs.mjs`.
- Branches: PR A on `cycle5-content-population-spec` (carries the spec + this plan); PR B on `cycle5-self-map-story` branched from A.
- All work references the schema contract in `docs/arkaik-skill/references/schema.md` and values in `docs/arkaik-skill/references/values.md`.

---

### Task 0: Scratch layout + commit this plan

**Files:**
- Create: `$SCRATCH/{corpus,fragments}` (directories)
- Commit: `docs/superpowers/plans/2026-08-04-content-population.md`

- [ ] **Step 1: Create scratch dirs and snapshot the pristine seed**

```bash
mkdir -p "$SCRATCH/corpus" "$SCRATCH/fragments"
cp "$REPO/seed/arkaik-self-map.json" "$SCRATCH/base-seed.json"
```

`base-seed.json` is the merge base for all of PR A. The merge always starts from it, so revising or renaming a fragment node can never leave stale nodes/events behind.

- [ ] **Step 2: Commit the plan on the spec branch**

```bash
cd "$REPO" && git add docs/superpowers/plans/2026-08-04-content-population.md
git commit -m "docs: cycle 5 plan — content population"
```

### Task 1: PR corpus

**Files:**
- Create: `$SCRATCH/corpus/prs.json`, `$SCRATCH/corpus/pr-files.json`, `$SCRATCH/corpus/docs-manifest.txt`

- [ ] **Step 1: Snapshot merged PRs**

```bash
cd "$REPO" && gh pr list --state merged --limit 500 \
  --json number,title,body,mergedAt,labels,author > "$SCRATCH/corpus/prs.json"
python3 -c "import json;d=json.load(open('$SCRATCH/corpus/prs.json'));print(len(d), min(p['number'] for p in d), max(p['number'] for p in d))"
```

Expected: ~330+ PRs, numbers spanning the repo's history.

- [ ] **Step 2: Map PR number → changed files from git history**

```bash
cd "$REPO" && python3 - "$SCRATCH" <<'EOF'
import json, re, subprocess, sys
scratch = sys.argv[1]
log = subprocess.run(["git","log","origin/main","--name-only","--format=@@%s"],
                     capture_output=True, text=True).stdout
out, cur = {}, None
for line in log.splitlines():
    if line.startswith("@@"):
        m = re.search(r"\(#(\d+)\)", line)
        cur = m.group(1) if m else None
    elif line.strip() and cur:
        out.setdefault(cur, []).append(line.strip())
json.dump(out, open(f"{scratch}/corpus/pr-files.json","w"), indent=0)
print("PRs with files:", len(out))
EOF
```

Expected: a few hundred PRs mapped (PRs merged without the `(#N)` squash suffix are simply absent — acceptable).

- [ ] **Step 3: Docs manifest**

```bash
ls "$REPO"/docs/*.md "$REPO"/docs/spec/*.md "$REPO"/docs/rfcs/*.md \
   "$REPO"/docs/superpowers/specs/*.md > "$SCRATCH/corpus/docs-manifest.txt"
wc -l "$SCRATCH/corpus/docs-manifest.txt"
```

### Task 2: Merge machinery

**Files:**
- Create: `$SCRATCH/merge.mjs`

**Fragment contract** (what every content agent emits, one JSON file in `$SCRATCH/fragments/`):

```json
{
  "area": "canvas-maps",
  "nodes": [ { "id": "V-canvas", "species": "view", "title": "Project Canvas",
               "status": "live", "platforms": ["web"],
               "metadata": { "product": "studio" } } ],
  "edges": [ { "source_id": "V-canvas", "target_id": "DM-node", "edge_type": "displays" } ],
  "events": [ { "ts": "2026-05-10T12:00:00.000Z", "type": "deliverable.shipped",
                "deliverable_id": "pr-123", "title": "…", "summary": "…",
                "url": "…", "node_ids": ["V-canvas"] } ]
}
```

Agents omit `project_id` and edge `id`s (derived). `events` is only used in PR B (plus `node.created` coverage, which the script owns).

- [ ] **Step 1: Write `$SCRATCH/merge.mjs`**

```js
#!/usr/bin/env node
// Usage: node merge.mjs <repoRoot> <scratchDir>
// Assembles <scratch>/fragments/*.json onto <scratch>/base-seed.json and
// writes <repoRoot>/seed/arkaik-self-map.json. Deterministic; rerun freely.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const [repo = ".", scratch = "."] = process.argv.slice(2);
const seedPath = join(repo, "seed/arkaik-self-map.json");
const fragDir = join(scratch, "fragments");
const PROJECT_ID = "arkaik-self-map";
const PRODUCTS = [
  { id: "studio", title: "Studio", platforms: ["web"] },
  { id: "platform", title: "Platform", platforms: ["web"] },
  { id: "toolchain", title: "Toolchain", platforms: ["web"] },
];

const seed = JSON.parse(readFileSync(join(scratch, "base-seed.json"), "utf8"));
const nodes = new Map(seed.nodes.map((n) => [n.id, n]));
const edges = new Map(seed.edges.map((e) => [e.id, e]));
const journal = [...(seed.journal ?? [])];
const owner = new Map(); // node id -> area, collision guard

let seq = 0;
const eid = (ts) =>
  "01" + ts.replace(/\D/g, "").slice(2, 14) + String(seq++).padStart(10, "0");

for (const f of readdirSync(fragDir).filter((x) => x.endsWith(".json")).sort()) {
  const frag = JSON.parse(readFileSync(join(fragDir, f), "utf8"));
  for (const n of frag.nodes ?? []) {
    if (owner.has(n.id) && owner.get(n.id) !== frag.area)
      throw new Error(`${f}: ${n.id} already claimed by area "${owner.get(n.id)}"`);
    owner.set(n.id, frag.area);
    nodes.set(n.id, { ...n, project_id: PROJECT_ID });
  }
  for (const e of frag.edges ?? []) {
    const id = `e-${e.source_id}-${e.target_id}`;
    edges.set(id, { id, project_id: PROJECT_ID, source_id: e.source_id,
                    target_id: e.target_id, edge_type: e.edge_type });
  }
  for (const ev of frag.events ?? [])
    journal.push({ id: ev.id ?? eid(ev.ts), actor: "claude-code", ...ev });
}

const ids = new Set(nodes.keys());
const dangling = [...edges.values()].filter(
  (e) => !ids.has(e.source_id) || !ids.has(e.target_id));
if (dangling.length) {
  console.error("DANGLING EDGES:\n" +
    dangling.map((e) => `  ${e.source_id} -> ${e.target_id}`).join("\n"));
  process.exit(1);
}

// node.created coverage — ts from dates.json, else project.created_at
const dates = existsSync(join(scratch, "dates.json"))
  ? JSON.parse(readFileSync(join(scratch, "dates.json"), "utf8")) : {};
const created = new Set(
  journal.filter((e) => e.type === "node.created").map((e) => e.node_id));
for (const n of nodes.values()) {
  if (created.has(n.id)) continue;
  const ts = dates[n.id] ?? seed.project.created_at;
  journal.push({ id: eid(ts), ts, actor: "claude-code", type: "node.created",
                 node_id: n.id, species: n.species, title: n.title });
}

journal.sort((a, b) =>
  a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

if (existsSync(join(scratch, "project-patch.json"))) {
  const { metadata, ...rest } =
    JSON.parse(readFileSync(join(scratch, "project-patch.json"), "utf8"));
  Object.assign(seed.project, rest);
  seed.project.metadata = { ...(seed.project.metadata ?? {}), ...(metadata ?? {}) };
}
seed.project.metadata = { ...(seed.project.metadata ?? {}), products: PRODUCTS };
seed.nodes = [...nodes.values()];
seed.edges = [...edges.values()];
seed.journal = journal;
seed.project.updated_at = "2026-08-04T12:00:00.000Z";
const out = JSON.stringify(seed, null, 2) + "\n";
writeFileSync(seedPath, out);
console.log(`nodes=${seed.nodes.length} edges=${seed.edges.length} ` +
  `journal=${journal.length} size=${Math.round(out.length / 1024)}KB`);
```

- [ ] **Step 2: No-op smoke test**

```bash
node "$SCRATCH/merge.mjs" "$REPO" "$SCRATCH"
node "$REPO/docs/arkaik-skill/scripts/validate-bundle.js" "$REPO/seed/arkaik-self-map.json"
cd "$REPO" && git diff --stat seed/arkaik-self-map.json
```

Expected: `nodes=15 edges=19 journal=20`, validator exit 0, diff limited to `products` injection + `updated_at` + formatting. Then `git checkout seed/arkaik-self-map.json` to reset until the real merge.

**The wave gate** (used at the end of every wave; "warning-clean" means zero errors AND zero warnings):

```bash
node "$SCRATCH/merge.mjs" "$REPO" "$SCRATCH" && \
node "$REPO/docs/arkaik-skill/scripts/validate-bundle.js" "$REPO/seed/arkaik-self-map.json"
```

### Task 3: Wave 1a — data-layer inventory (runs first, alone)

One agent owns **all** `DM-` and `API-` nodes so parallel area agents can reference them without collisions.

- [ ] **Step 1: Dispatch the data-layer agent**

Prompt (fill `$SCRATCH` literally):

> Read `docs/arkaik-skill/references/schema.md` (ID conventions, edge semantics) in /Users/alexis/code/arkaik, then inventory Arkaik's data models and API endpoints by reading: `lib/data/` (types, db, providers), `db/`, `app/api/**` (auth, synk, publik, graph, tokens, github), `packages/schema/src/`, `docs/data-layer.md`, `docs/architecture.md`, `docs/spec/bundle-format.md`, `docs/spec/journal.md`.
> Produce fragment `$SCRATCH/fragments/10-data-layer.json` (shape: `{"area":"data-layer","nodes":[…],"edges":[…]}`) containing:
> - `DM-` nodes for **concepts** (Project, Node, Edge, ProjectBundle, JournalEvent, MapDefinition, Product, Deliverable…) and **physical stores** (each IndexedDB store, each Postgres table) as distinct nodes per the concept-vs-table rule. ~20–25 total.
> - `API-` nodes for every real route under `app/api` (title like "POST /api/synk/projects"). ~15–20 total.
> - `queries` edges (api-endpoint → data-model) where the route genuinely reads/writes the model, and `calls` edges between endpoints where one fans out to another.
> - Every node: `status` (almost all `live`), `platforms: ["web"]`, a one-sentence `description`. **No** `metadata.product` (membership is derived for these species). No playlists, no gherkin.
> - IDs deterministic from titles with correct prefixes. Return the fragment path and a one-paragraph inventory summary.

- [ ] **Step 2: Sanity-check the fragment**

```bash
python3 -c "
import json;f=json.load(open('$SCRATCH/fragments/10-data-layer.json'))
from collections import Counter
print(Counter(n['species'] for n in f['nodes']), len(f['edges']),'edges')
print(sorted(n['id'] for n in f['nodes']))"
```

Expected: only `data-model`/`api-endpoint` species; DM/API counts inside spec ranges; no obviously duplicate concepts.

### Task 4: Wave 1b — seven area agents in parallel (flows, views, edges)

- [ ] **Step 1: Dispatch all seven agents in one message**

Shared prompt template (per-area values from the table below; attach the **id list** from `10-data-layer.json` — ids and titles only — to every prompt):

> Read `docs/arkaik-skill/references/schema.md` in /Users/alexis/code/arkaik — especially ID conventions, edge semantics, and playlists. You are mapping the **AREA** area of Arkaik itself. Read: FILES. The existing seed (`seed/arkaik-self-map.json`) already contains 15 nodes about the /projects area — reuse those exact ids where your area overlaps them rather than minting near-duplicates.
> Produce fragment `$SCRATCH/fragments/NN-AREA.json` (`{"area":"AREA","nodes":[…],"edges":[…]}`):
> - `V-` nodes for each distinct screen/page/panel a user perceives; `F-` nodes for each user journey. Every flow has `metadata.playlist` with real entries, and a matching `composes` edge for every view/flow the playlist references.
> - `metadata.product: "PRODUCT"` on every flow and view. `platforms: ["web"]`, `status` honest (`live` for shipped surfaces, `development`/`backlog` only if genuinely unfinished). `metadata.stage` only for `beta`/`monitoring`/`deprecated` realities.
> - `calls` edges to the attached `API-` ids and `displays` edges to `DM-` ids where the surface genuinely does so. Only reference `DM-`/`API-` ids from the attached list — never invent new ones; if something is missing, note it in your summary instead.
> - No acceptances, no decisions, no gherkin/values. IDs deterministic from titles. Budget: BUDGET nodes — every *distinct* surface, no filler.
> Return the fragment path, a summary, and any DM/API gaps you noticed.

| NN | AREA | PRODUCT | BUDGET | FILES |
|---|---|---|---|---|
| 20 | projects-home | studio | 5–9 | `app/projects/page.tsx`, `lib/data/project-sections.ts`, `lib/data/create-target.ts`, `components/projects/`, `lib/data/arkaik-seed.ts` |
| 21 | canvas-maps | studio | 8–12 | `app/project/[id]/{page.tsx,canvas,maps}`, `components/graph/`, `components/maps/`, `lib/utils/{graph-build,elk-layout,journey-graph,graph-spotlight,keyboard-shortcuts,command-palette}.ts`, `docs/spec/maps.md` |
| 22 | detail-editing | studio | 8–12 | `app/project/[id]/{library,overview,pyramid,acceptances}`, `components/{panels,library,acceptances,values,pyramid,overview}/`, `lib/utils/{acceptance-matrix,coverage,product-editing}.ts` |
| 23 | pm-surfaces | studio | 6–10 | `app/project/[id]/{changelog,delivery,history,decisions}`, `components/{journal,delivery,decisions}/`, `lib/utils/{journal,delivery,decision}.ts`, `docs/spec/journal.md` |
| 24 | sharing-platform | platform | 8–12 | `app/p/`, `app/generate/`, `app/settings/`, `auth.ts`, `components/{publik,sync,auth,generate,settings}/`, `lib/{sync,services,prompts}/`, `docs/hosted-projects.md` |
| 25 | sandbox-io | studio | 5–8 | `lib/utils/export.ts`, `lib/data/{seed-provider,routing-provider,migrate,seed-project-id}.ts`, `app/docs/`, `components/docs/`, cycle-4 spec `docs/superpowers/specs/2026-08-04-public-self-map-design.md` |
| 26 | toolchain | toolchain | 6–10 | `packages/cli/`, `packages/mcp/`, `plugin/`, `docs/arkaik-skill/`, `docs/spec/{toolchain,mcp}.md` (CLI commands and MCP tools map naturally to flows; the skill/plugin surfaces to views sparingly) |

- [ ] **Step 2: Merge + validate (errors only at this stage)**

```bash
node "$SCRATCH/merge.mjs" "$REPO" "$SCRATCH" && \
node "$REPO/docs/arkaik-skill/scripts/validate-bundle.js" "$REPO/seed/arkaik-self-map.json"
```

Expected: node count in the 90–120 range (pre-acceptances), zero **errors**. Warnings about missing acceptances/values are expected until Task 6. If the merge aborts on dangling edges or an id collision, fix the named fragment (edit the JSON, or redispatch that one agent with the error attached) and rerun.

### Task 5: Wave 1 adversarial review + node dating

- [ ] **Step 1: Dispatch the anatomy reviewer**

> You are reviewing the product map of Arkaik against the real product — adversarially. Repo: /Users/alexis/code/arkaik. Read `seed/arkaik-self-map.json`, then spot-check it against the codebase (`app/`, `components/`, `packages/`, `plugin/`). Hunt for: (1) real user-facing surfaces with no node — check every route under `app/` and every `packages/cli` command; (2) nodes describing surfaces that do not exist or misdescribing ones that do; (3) playlists that misrepresent the actual journey; (4) `calls`/`displays`/`queries` edges that are false, and important ones that are missing; (5) duplicate concepts under different ids. Do NOT edit anything. Return a numbered findings list — each with the node/edge id, what is wrong, and the file evidence — ordered by severity.

- [ ] **Step 2: Apply findings to the fragments, re-merge, re-validate**

Edit the named fragment files (never the seed), rerun the wave gate. Repeat until the reviewer's material findings are addressed.

- [ ] **Step 3: Dispatch the dating agent**

Attach: the current seed's `{id,title,species}` node list, and `corpus/prs.json` reduced to `{number,title,mergedAt}` (plus `corpus/pr-files.json`).

> For each node of Arkaik's self-map (attached), find the merged PR that first shipped that surface, using PR titles and the PR→files map (e.g. nodes about `components/graph` date to early canvas PRs). Output **JSON only** — `{"<node_id>": "<ISO 8601 merge timestamp>", …}` — covering every attached node id. When no PR clearly matches, use the merge date of the era when the area appeared (infer from neighboring surfaces); never omit a node, never use a date outside the repo's PR history.

Save output to `$SCRATCH/dates.json`, spot-check five known nodes (e.g. Decision Log dates ≈ 2026-08-03, `V-projects` early), then re-run the wave gate — `node.created` timestamps now become historical.

### Task 6: Wave 2 — acceptances + values

- [ ] **Step 1: Dispatch seven acceptance agents in parallel**

One per area from the Task 4 table (fragment `3N-AREA-acceptances.json`, area `AREA-acceptances`). Attach the merged seed's node list (`{id,title,species,product}`) for the agent's area. Template:

> Read `docs/arkaik-skill/references/values.md` and the acceptance conventions in `docs/arkaik-skill/references/schema.md` (repo /Users/alexis/code/arkaik). For the **AREA** area of Arkaik's self-map, write acceptance nodes — the testable promises the product makes on those surfaces. For each: `id` `AC-<kebab-promise>`, `species: "acceptance"`, honest `status` (`live` if the promise holds today), `platforms: ["web"]`, `metadata.product: "PRODUCT"`, `metadata.gherkin` with ONE Given/When/Then scenario grounded in real behavior (read the code/docs when unsure), `metadata.values` with 1–3 elements from the values doc — most specific element; higher tier only when genuinely earned. Add a `covers` edge to each view/flow anchor (attached list; anchors must be in your area — never span products). Budget: BUDGET acceptances covering the area's real promises — quality over count. Fragment shape: `{"area":"AREA-acceptances","nodes":[…],"edges":[…]}`.

Budgets: projects-home 6–9, canvas-maps 10–14, detail-editing 10–14, pm-surfaces 8–12, sharing-platform 10–14, sandbox-io 6–9, toolchain 8–12 (total lands in the spec's 60–90).

- [ ] **Step 2: Merge + validate**

Run the wave gate. Expected: acceptance warnings gone for covered nodes; zero errors; total nodes 150–210.

- [ ] **Step 3: Values-balance review**

```bash
python3 -c "
import json;from collections import Counter
b=json.load(open('$REPO/seed/arkaik-self-map.json'))
vs=Counter(v for n in b['nodes'] if n['species']=='acceptance' for v in n.get('metadata',{}).get('values',[]))
print(vs.most_common())"
```

Dispatch one reviewer with this distribution + the acceptance list: instruct it to flag over-assigned elements (anything > ~25% of all assignments), acceptances whose values ring hollow, and pyramid-tier inflation; return per-acceptance reassignments. Apply to fragments, re-merge, re-validate: gate is **warning-clean** from here on.

### Task 7: Curated maps + project finalize (inline, no agent)

- [ ] **Step 1: Write `$SCRATCH/project-patch.json`**

Using the merged seed's real ids (adjust `root_node_id`/roots to actual ids after Task 6; the shape below is the contract, the four maps are the deliverable):

```json
{
  "description": "Arkaik mapped in Arkaik — the whole product as a living graph: every surface, the promises it makes, and the history of how it got here.",
  "root_node_id": "V-projects",
  "metadata": {
    "maps": [
      { "id": "studio-journey", "title": "Studio journey", "kind": "journey",
        "product": "studio", "root_node_id": "V-projects" },
      { "id": "platform-journey", "title": "Platform journey", "kind": "journey",
        "product": "platform", "root_node_id": "<platform home view id>" },
      { "id": "toolchain-journey", "title": "Toolchain journey", "kind": "journey",
        "product": "toolchain", "root_node_id": "<toolchain root id>" },
      { "id": "data-spine", "title": "Data spine", "kind": "system",
        "species": ["api-endpoint", "data-model"],
        "edge_types": ["queries", "calls"] }
    ]
  }
}
```

- [ ] **Step 2: Re-run the wave gate**

Expected: warning-clean (map root warnings would surface a bad id), size printed and ≤ ~600KB.

### Task 8: PR A — the map

- [ ] **Step 1: Final gate + commit**

```bash
node "$SCRATCH/merge.mjs" "$REPO" "$SCRATCH" && \
node "$REPO/docs/arkaik-skill/scripts/validate-bundle.js" "$REPO/seed/arkaik-self-map.json" && \
cd "$REPO" && git add seed/arkaik-self-map.json && \
git commit -m "Self-map: whole-product anatomy, acceptances, values, curated maps (cycle 5, PR A)"
```

- [ ] **Step 2: Push and open the PR**

PR body: what the map now contains (counts per species, the three products, the four maps), the validator/warning-clean statement, a visual-pass checklist for Alexis (canvas legibility at this scale; product filter; each curated map opens; pyramid/coverage pages; Explore sandbox unchanged mechanically), and this Lab Note section:

```markdown
## Lab Note
```yaml
en:
  title: "Arkaik's own map just got real"
  summary: "The sandbox project on the projects page now holds the whole product — every screen, journey, and promise Arkaik makes, wired to the value it serves. Open it and wander."
fr:
  title: "La carte d'Arkaik devient réelle"
  summary: "Le projet bac à sable de la page projets contient maintenant tout le produit — chaque écran, chaque parcours, chaque promesse, reliés à la valeur servie. Ouvre-la et balade-toi."
suggested:
  molecule: arkaik
  type: feature
  tags: [changelog]
```
```

```bash
git push -u origin cycle5-content-population-spec
gh pr create --title "Self-map content: the whole product, mapped (cycle 5, PR A)" --body-file <body>
```

- [ ] **Step 3: Read the PR comments**

```bash
gh pr view --comments
```

Expected: no Lab Note reminder comment (or fix the body until it clears). CI must go green — remember main carries pre-existing lint errors; the bar is no new ones (no code files touched here, so build + validate:seeds are the live risks).

### Task 9: Story setup (PR B branch, era definition)

- [ ] **Step 1: Branch and re-snapshot the base**

```bash
cd "$REPO" && git checkout -b cycle5-self-map-story
cp seed/arkaik-self-map.json "$SCRATCH/base-seed.json"
mv "$SCRATCH/fragments" "$SCRATCH/fragments-pr-a" && mkdir "$SCRATCH/fragments"
```

(The PR A seed becomes the new merge base; PR A fragments are retired.)

- [ ] **Step 2: Define the eras (inline, from the corpus)**

Read `corpus/prs.json` mergedAt distribution + titles and write `$SCRATCH/eras.json`: 8–12 entries `{ "version": "<kebab-slug>", "title": "…", "boundary_pr": <last PR number>, "ts": "<just after that PR's merge>", "notes": "<one narrative paragraph>" }`, using the spec's working list (`first-graph`, `journal-and-changelog`, `going-multi-product`, `acceptance-and-value`, `hosted-and-public`, `decisions-and-history`, `the-self-map`) as the starting shape, adjusted to what the corpus actually shows. Convert to a fragment `$SCRATCH/fragments/50-releases.json` with one `release.tagged` event per era (`{ts, type, version, notes, actor: "alexis"}`).

### Task 10: Wave 3 — era deliverables + decisions + ideas (parallel)

- [ ] **Step 1: Dispatch one agent per era (8–12, parallel) + one decisions agent**

Era-agent template — attach: the era's corpus slice (PRs between the previous boundary and this one, full bodies), `pr-files.json` entries for those PRs, and the seed's node id/title list:

> You are writing the deliverable history for the "**ERA**" chapter of Arkaik's self-map. From the attached merged PRs, select every **user-visible** change (a PR whose body contains a `## Lab Note` section is user-visible by definition; for others, judge: would a user notice?). Skip chores, CI, refactors, docs-only. For each selected PR emit one event: `{ "ts": "<mergedAt>", "type": "deliverable.shipped", "deliverable_id": "pr-<number>", "title": "…", "summary": "…", "url": "https://github.com/alexisbohns/arkaik/pull/<number>", "node_ids": [ids from the attached list that the PR touched], "actor": "claude-code" }`. Where a Lab Note exists, adapt its `en` title/summary (benefit-first, no jargon); otherwise write in that same voice. `node_ids` must only use attached ids (use the PR's changed files to infer which surfaces it touched); leave `[]` when nothing maps. Fragment: `$SCRATCH/fragments/6N-ERA.json`, `{"area":"ERA","events":[…]}`.

Decisions-agent prompt — attach the seed node list and `docs-manifest.txt`:

> Mine Arkaik's decision record. Read the spec docs in `docs/superpowers/specs/` (especially `2026-08-03-self-map-program.md`'s standing decisions), `docs/rfcs/`, and `docs/spec/journal.md` (repo /Users/alexis/code/arkaik). The seed already has 3 `DEC-` nodes — keep their ids untouched. Add ~9–15 more: for each, a `DEC-` node (`species: "decision"`, no `platforms`, `metadata`: `context` (the Why, markdown), `consequences` (the How), `decided_at` (real date from the doc/PR), `decision_status` (mostly `enacted`), and `status` set to the lifecycle mapping — enacted→`live`, proposed→`discovery`, approved→`backlog`, rejected/deprecated/superseded→`archived`). Add `generates` edges (decision→acceptance), `impacts` edges (decision→flow|view|data-model|api-endpoint) to attached ids, and `supersedes` where one decision replaced another. For every NEW decision also emit `decision.status_changed` events tracing its real path (e.g. proposed at brainstorm date → enacted at ship date), final `to` matching its `decision_status`, `actor: "alexis"`. Fragment: `$SCRATCH/fragments/70-decisions.json`, `{"area":"decisions","nodes":[…],"edges":[…],"events":[…]}`.

- [ ] **Step 2: Ideas fragment (inline)**

Write `$SCRATCH/fragments/75-ideas.json` with 3–6 `idea.proposed` events for genuinely open items with real dates, e.g. blocked indicator on StatusRing rollups (deferred in cycle 1, 2026-08-03), milestones (parked in cycle 2), pebbles retro-population — `{ "ts": "…", "type": "idea.proposed", "title": "…", "description": "…", "actor": "alexis" }`.

### Task 11: Status arcs + story merge

- [ ] **Step 1: Merge wave 3 first** (deliverables must exist before arcs can use ship dates)

Run the wave gate. Expected: zero errors; journal now has releases + deliverables + decision events in historical order.

- [ ] **Step 2: Write `$SCRATCH/arcs.mjs`**

```js
#!/usr/bin/env node
// Usage: node arcs.mjs <repoRoot> <scratchDir>
// Emits fragments/80-status-arcs.json: honest node.status_changed arcs.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const [repo = ".", scratch = "."] = process.argv.slice(2);
const seed = JSON.parse(readFileSync(join(repo, "seed/arkaik-self-map.json"), "utf8"));
const created = new Map(seed.journal.filter((e) => e.type === "node.created")
  .map((e) => [e.node_id, e.ts]));
const ship = new Map(); // node id -> earliest deliverable ts
for (const ev of seed.journal) {
  if (ev.type !== "deliverable.shipped") continue;
  for (const id of ev.node_ids ?? [])
    if (!ship.has(id) || ev.ts < ship.get(id)) ship.set(id, ev.ts);
}
const overrides = existsSync(join(scratch, "arc-overrides.json"))
  ? JSON.parse(readFileSync(join(scratch, "arc-overrides.json"), "utf8")) : {};
const bump = (ts, h) => { const d = new Date(ts); d.setHours(d.getHours() + h);
  return d.toISOString(); };
const events = [];
for (const n of seed.nodes) {
  if (n.species === "decision") continue; // decisions have their own events
  const o = overrides[n.id];
  if (o === "skip") continue;
  if (o) { for (const s of o) events.push({ ts: s.ts, type: "node.status_changed",
      node_id: n.id, from: s.from, to: s.to }); continue; }
  const t0 = created.get(n.id) ?? seed.project.created_at;
  if (n.status === "live") {
    const dev = bump(t0, 1);
    const live = ship.has(n.id) && ship.get(n.id) > dev ? ship.get(n.id) : bump(t0, 48);
    events.push({ ts: dev, type: "node.status_changed", node_id: n.id,
      from: "idea", to: "development" });
    events.push({ ts: live, type: "node.status_changed", node_id: n.id,
      from: "development", to: "live" });
  } else if (n.status !== "idea") {
    events.push({ ts: bump(t0, 1), type: "node.status_changed", node_id: n.id,
      from: "idea", to: n.status });
  }
}
writeFileSync(join(scratch, "fragments/80-status-arcs.json"),
  JSON.stringify({ area: "status-arcs", events }, null, 2) + "\n");
console.log(`status events: ${events.length}`);
```

- [ ] **Step 3: Generate arcs, re-merge, era-consistency check**

```bash
node "$SCRATCH/arcs.mjs" "$REPO" "$SCRATCH"
node "$SCRATCH/merge.mjs" "$REPO" "$SCRATCH" && \
node "$REPO/docs/arkaik-skill/scripts/validate-bundle.js" "$REPO/seed/arkaik-self-map.json"
python3 - "$REPO/seed/arkaik-self-map.json" <<'EOF'
import json, sys
b = json.load(open(sys.argv[1])); j = b["journal"]
rel = [(e["ts"], e["version"]) for e in j if e["type"] == "release.tagged"]
first = {}
for e in j:
    if e["type"] == "deliverable.shipped" and e["deliverable_id"] not in first:
        first[e["deliverable_id"]] = e["ts"]
after_last = [d for d, ts in first.items() if rel and ts > max(r[0] for r in rel)]
print(len(rel), "releases;", len(first), "deliverables;", len(after_last), "unreleased:", after_last)
EOF
```

Expected: warning-clean validate; every deliverable inside an era slice (unreleased list empty, or only deliberately-post-era items). If arcs put a node's `live` before its era looks right, add an `arc-overrides.json` entry for it and regenerate.

### Task 12: Story adversarial review

- [ ] **Step 1: Dispatch the story reviewer**

> Review the historical narrative in `seed/arkaik-self-map.json` (repo /Users/alexis/code/arkaik) as a skeptical editor. Check: (1) era release notes — do they tell a true, benefit-first story matching their deliverables? (2) deliverable summaries — corporate jargon, ticket-speak, or mechanism-first phrasing? (3) `node_ids` — spot-check ten deliverables against their real PRs (`gh pr view <n>`); are the touched nodes plausible? (4) decisions — do context/consequences match the actual spec docs; are `decided_at` dates real? (5) any journal event whose `ts` is obviously wrong (before the repo existed, after today, out of era). Return numbered findings with severity; do not edit.

- [ ] **Step 2: Apply findings to fragments, re-merge, re-validate (warning-clean)**

### Task 13: PR B — the story

- [ ] **Step 1: Update the program doc**

Edit `docs/superpowers/specs/2026-08-03-self-map-program.md`: cycle 4 line → `✅ SHIPPED 2026-08-04 (PR #338)`; cycle 5 line → `✅ SHIPPED <date> (PR A #…, PR B #…)` with a one-line summary and a pointer to the cycle-5 spec; header status line updated.

- [ ] **Step 2: Final gate + commit + PR**

```bash
node "$SCRATCH/merge.mjs" "$REPO" "$SCRATCH" && \
node "$REPO/docs/arkaik-skill/scripts/validate-bundle.js" "$REPO/seed/arkaik-self-map.json" && \
cd "$REPO" && git add seed/arkaik-self-map.json docs/superpowers/specs/2026-08-03-self-map-program.md && \
git commit -m "Self-map: the story — deliverables, thematic releases, decisions, status arcs (cycle 5, PR B)"
git push -u origin cycle5-self-map-story
gh pr create --base cycle5-content-population-spec --title "Self-map content: the story (cycle 5, PR B)" --body-file <body>
```

PR body: counts (releases, deliverables, decisions, journal size, file size), the era list, visual-pass checklist (Changelog Design | Delivery panels, release grouping, History page density, Decision Log, a node's timeline), and this Lab Note:

```markdown
## Lab Note
```yaml
en:
  title: "Arkaik's map now remembers its own story"
  summary: "Open the sandbox project's changelog: every chapter of how Arkaik was built is there — what shipped, what was decided, and why. A product that keeps its own diary."
fr:
  title: "La carte d'Arkaik raconte maintenant son histoire"
  summary: "Ouvre le changelog du projet bac à sable : chaque chapitre de la construction d'Arkaik y est — ce qui a été livré, ce qui a été décidé, et pourquoi. Un produit qui tient son propre journal."
suggested:
  molecule: arkaik
  type: feature
  tags: [changelog]
```
```

- [ ] **Step 3: Read PR comments, confirm CI green on both PRs, hand the visual pass to Alexis**

```bash
gh pr view --comments
gh pr checks
```

Both PRs then wait on Alexis's visual pass; PR B retargets to `main` automatically when PR A merges (or re-point it manually).

---

## Execution notes

- **Fragments are the source of truth during the cycle** — every content fix goes into a fragment (or `dates.json`/`project-patch.json`/overrides), then re-merge. Editing the seed by hand guarantees the change is lost on the next merge.
- **Dangling-edge aborts** name the exact ids: fix the owning fragment, not the referencing one, when the id was misspelled at mint time.
- **Agent failures** (a fragment that won't parse or violates the contract): redispatch that one agent with the validator/merge error attached — don't hand-patch large fragments.
- The `eid()` pseudo-ULIDs are sortable strings, not real ULIDs; the validator only requires string ids, and consumers order by `ts` first.
