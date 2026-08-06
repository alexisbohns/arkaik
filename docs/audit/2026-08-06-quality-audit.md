# Codebase Quality Audit — 2026-08-06

**Scope:** the full repository at commit `22b728f` (main, 2026-08-06). Requested lenses: standard quality issues, refactor opportunities, component factorization, shadcn usage, duplication/redundancy, docs accuracy.

**Method (summary):** seven parallel auditor agents, one lens each, followed by an adversarial verification pass in which independent agents attempted to *refute* the top eight findings by re-reading the code and re-running repros against the built artifacts. Machine baseline (typecheck, lint, full test suite) collected separately. Details in the [appendix](#appendix-method--verification). This report is a snapshot — line numbers reference commit `22b728f`.

**Findings:** 74 retained (6 high, 40 medium, 28 low). One additional finding was refuted during verification and is disclosed in the appendix. All six high-severity findings were independently confirmed; nine GitHub issues were filed (#356–#364).

---

## Executive summary

**The codebase is in structurally excellent shape, with the damage concentrated in a few specific places.** The audit's strongest overall signal is that the declared architecture actually holds: mutation semantics, journal projections, id generation, and validation each live exactly once in `packages/schema`, and the app, CLI, MCP server, and hosted store all funnel through them. Generated artifacts (validators, plugin, skill docs) are mechanical builds of that one source, drift-gated in CI. The app layer has zero `any`, webhook and token security are textbook, and 44 test suites pass.

Against that backdrop, five problem clusters:

1. **Two journal-validation traps in the CLI/MCP surface** — the worst findings of the audit, both reproduced twice with the built artifacts. A journal-less bundle is one event away from permanent invalidity ([#357](https://github.com/alexisbohns/arkaik/issues/357)), and `arkaik release --compact` archives the very events the validator cross-checks, breaking `arkaik validate` after an ordinary release ([#358](https://github.com/alexisbohns/arkaik/issues/358)).
2. **One real editing-surface bug** — playlist junction-case labels are effectively untypeable: per-keystroke persistence plus rows keyed by their own editable label, which remounts the input and drops focus on every committed character ([#356](https://github.com/alexisbohns/arkaik/issues/356)).
3. **Swallowed load errors** — all four data hooks capture `error` state that no consumer reads, so a failed load renders as "No nodes yet. Create one to get started." — indistinguishable from an empty project, reads as data loss ([#362](https://github.com/alexisbohns/arkaik/issues/362)).
4. **The entry-point docs describe a previous Arkaik** — README/CLAUDE.md/copilot-instructions give three different (all wrong) species counts ([#359](https://github.com/alexisbohns/arkaik/issues/359)); CONTRIBUTING describes the executed MIT/AGPL split as future, and the published npm tarballs carry no LICENSE file ([#360](https://github.com/alexisbohns/arkaik/issues/360)); data-layer.md documents an obsolete DataProvider and denies the remote provider exists ([#361](https://github.com/alexisbohns/arkaik/issues/361)). Notably, the *deep* docs (graph-model, the specs, bootstrap, hosted-projects) are accurate — the rot is at the front doors, exactly the files humans and coding agents read first.
5. **Front-end factorization debt** — repeated status selects, ~30 hand-rolled field labels, ~12 divergent empty states, and four missing shadcn primitives (Label, Textarea, Checkbox, Tabs) whose absence is actively producing the drift ([#363](https://github.com/alexisbohns/arkaik/issues/363)) — plus a set of server-hardening gaps: unbounded JSON bodies, check-then-act tier limits, spoofable rate limiting ([#364](https://github.com/alexisbohns/arkaik/issues/364)).

If only three things get fixed, fix the two journal traps (#357, #358) and the playlist editor (#356): the first two silently strand real user data behind a red validator, the third makes a core editing surface unusable.

---

## Baseline: what the tooling says

| Check | Result |
| --- | --- |
| `tsc --noEmit` | ✅ clean |
| `eslint` | ⚠️ 0 errors, 4 warnings — unused `useEffect` import (`app/project/[id]/library/page.tsx:3`), unused `PLATFORMS` (`components/panels/ShotPreviewDialog.tsx:17`), raw `<img>` in `PlatformVariants.tsx:224` and `ShotPreviewDialog.tsx:117` |
| Test suites (44 run) | ✅ all pass, with two environment-shaped exceptions below |
| — 5 suites needing Postgres (`test:tokens`, `test:graph`, `test:github`, `test:publik`, `test:synk`) | ⏭️ refuse loudly when `DATABASE_URL` is unset — by design, not silent passes. Good behavior; ran in CI, not re-runnable here. |
| — `test:bootstrap` | 183/185 — the 2 failures are the "unwritable backup dir" probes, which cannot work when the suite runs as root (root ignores permission bits). A root-detecting skip would make the suite portable; not a product bug. |

---

## The six high-severity findings

All six were independently confirmed by the adversarial verification pass. Full detail in each lens section below.

| # | Finding | Lens | Issue |
| --- | --- | --- | --- |
| `quality-frontend-1` | Playlist condition/junction label editing writes to the store per keystroke and junction-case keys include the label, causing focus loss and dropped characters | Front-end application quality | [#356](https://github.com/alexisbohns/arkaik/issues/356) |
| `quality-packages-1` | First journal event on a journal-less bundle flips validation to INVALID and blocks all MCP mutations | Workspace packages (schema, cli, mcp) | [#357](https://github.com/alexisbohns/arkaik/issues/357) |
| `quality-packages-2` | `arkaik release --compact` breaks `arkaik validate` whenever the archived slice contains provenance or last-status events | Workspace packages (schema, cli, mcp) | [#358](https://github.com/alexisbohns/arkaik/issues/358) |
| `docs-1` | Species count contradicts across README (5), CLAUDE.md (5), copilot-instructions (4) vs actual 6 | Documentation accuracy | [#359](https://github.com/alexisbohns/arkaik/issues/359) |
| `docs-2` | CONTRIBUTING.md licensing section describes the MIT/AGPL split as future, but it has executed | Documentation accuracy | [#360](https://github.com/alexisbohns/arkaik/issues/360) |
| `docs-3` | data-layer.md documents an obsolete DataProvider interface and denies the remote provider exists | Documentation accuracy | [#361](https://github.com/alexisbohns/arkaik/issues/361) |

---

## Findings by lens

### Workspace packages (schema, cli, mcp)

Scope: `packages/schema`, `packages/cli`, `packages/mcp`, `scripts/generate`. The single-source-of-truth architecture holds and version/packaging hygiene is exemplary — but the two highest-impact findings of the whole audit live here, both journal-validation traps reproduced with the built artifacts.

#### 🔴 HIGH — First journal event on a journal-less bundle flips validation to INVALID and blocks all MCP mutations

<sub>`quality-packages-1` · effort: medium · verification: **confirmed** → issue [#357](https://github.com/alexisbohns/arkaik/issues/357)</sub>

**Where:** `packages/schema/src/journal.ts:535`, `packages/mcp/src/store.ts:121`, `packages/cli/src/commands/release.ts:135`, `packages/cli/src/commands/deliverable.ts:132`, `docs/spec/journal.md:120`

crossCheckJournal requires a node.created event for EVERY snapshot node whenever the journal is non-empty (journal.ts:535-543), and every writer makes the journal non-empty without backfilling provenance. Reproduced with the built CLI: a valid journal-less bundle + `arkaik release 1.0` -> `arkaik validate` exits 1 with `journal-missing-node-created` per node. Reproduced with the built MCP server: `propose_idea` on the same bundle is refused (`Mutation refused by validateBundle`) because persistMutation folds the one new event into `candidate.journal` (store.ts:121-130) and the provenance rule fires for every pre-existing node — the bundle becomes permanently un-mutable via MCP. This contradicts docs/spec/journal.md:120 ("A bundle without a journal simply renders none of these — the empty state, not an error"): any bundle whose nodes predate journaling (app export, hand-authored, pre-M3) is a trap.

**Recommendation:** Make the provenance rule adoption-aware: only demand node.created for nodes whose creation postdates the journal's first event (or a dedicated journal-adoption marker event), or downgrade journal-missing-node-created to a warning, or have writers backfill node.created events on first journal write. Add a test that mutates/releases against a journal-less bundle with pre-existing nodes.

> **Adversarial verification (confirmed):** Independently reproduced both halves with the built artifacts, plus found corroborating evidence the finding missed.

Checked: (1) packages/schema/src/journal.ts — crossCheckJournal returns early only when journal is absent/empty (lines 385, 396); once ANY event exists, the provenance loop at lines 535-543 emits an error-severity `journal-missing-node-created` finding for every snapshot node lacking a node.created event. Wired into validateBundle at packages/schema/src/validate.ts:837, so it gates everything downstream. (2) CLI repro: built a minimal valid journal-less 2-node bundle; `arkaik validate` → VALID exit 0; `arkaik release 1.0` succeeds (appendJournalEvent at release.ts:135, no validation gate, no backfill); `arkaik validate` → INVALID exit 1 with `journal-missing-node-created` per node. Exactly as claimed. Same append path in deliverable.ts:132. (3) MCP repro: drove the built arkaik-mcp server over stdio JSON-RPC against a fresh journal-less bundle; `propose_idea` returned isError=true, "Mutation refused by validateBundle — nothing was written", with the two `journal-missing-node-created` findings. Since persistMutation (packages/mcp/src/store.ts:121-130) folds events into candidate.journal and refuses on any error while writing nothing, the state never changes — every MCP mutation (including create_node, update_status) hits the same errors, so "permanently un-mutable via MCP" is accurate absent out-of-band repair.

Aggravating factors not in the original finding: (a) release.ts's own header comment (lines 15-17) falsely asserts "`arkaik validate` … stays green afterward"; (b) lib/utils/export.ts:170-183 explicitly calls the partial-journal state "the expected Level 0/1 → 2 transition, not a corruption" and deliberately keeps it non-blocking in the app — the CLI/MCP hard error contradicts the product's own design intent, and app-exported bundles with partial journals (embedded) hit the same trap; (c) `arkaik doctor`, the repair tool docs/spec/journal.md:90 promises, does not exist (grep across packages finds nothing); (d) blast radius extends to `arkaik open`, which gates the pack-and-handoff on the same validateBundleAt and prints "Invalid bundle — not packed, not opened".

One nitpick that does not change the verdict: docs/spec/journal.md:120 literally describes a bundle *without* a journal (which still validates fine), so it is a spirit-level contradiction ("that is the whole backward-compatibility story") rather than a letter-level one; journal.md:89 does spec the strict per-node provenance rule, and tests/schema/journal.test.js exercises it at unit level. But no test covers the adoption transition, and the composition of spec'd parts leaves no supported path from journal-less to journaled — the defect is real regardless of which document is "right".

Severity high is honest for a quality audit of published npm packages (arkaik 0.1.2, arkaik-mcp 0.2.2): the entire MCP write surface is unusable against any pre-existing graph, successful CLI commands silently flip validation/CI to INVALID, and there is no provided remedy. The recommendation (adoption-aware provenance, or downgrade to warning matching the app's existing precedent, or writer backfill, plus an integration test) is a genuine improvement, not churn.

#### 🔴 HIGH — `arkaik release --compact` breaks `arkaik validate` whenever the archived slice contains provenance or last-status events

<sub>`quality-packages-2` · effort: medium · verification: **confirmed** → issue [#358](https://github.com/alexisbohns/arkaik/issues/358)</sub>

**Where:** `packages/cli/src/lib/journal-io.ts:79`, `packages/cli/src/commands/release.ts:63`, `packages/cli/src/commands/release.ts:176`, `packages/schema/src/journal.ts:535`, `tests/cli/log-release.test.js:71`

compactSlice moves the between-markers slice into journal/archive-<version>.jsonl, but crossCheckJournal only ever sees the working journal.jsonl (validateBundleAt folds just the sidecar). Reproduced: bundle with full provenance validates VALID; `arkaik release 1.0 --compact` archives the node.created + status events (first release: rawReleaseSlice takes EVERYTHING before the marker, release.ts:74-83); `arkaik validate` then exits 1 with `journal-missing-node-created`. Any ordinary release that added nodes since the previous marker hits the same wall, and partial compaction can strand an older node.status_changed as the new "last" transition, triggering `journal-status-mismatch`. The test suite knows: its fixture is hand-built so "none of which crossCheckJournal needs once compacted" (log-release.test.js:71-74) — the guard lives in the test, not the code.

**Recommendation:** Either retain node.created and the last project-level status/decision transition per surviving node in the working journal during compaction, or make validateBundleAt fold journal/archive-*.jsonl when cross-checking, or make `release --compact` refuse (with a message) when the slice contains events the cross-check needs.

> **Adversarial verification (confirmed):** Independently reproduced both failure modes with the built CLI (packages/cli/dist/index.js) in scratchpad fixtures. (1) First release: a 1-node bundle with full provenance validates VALID; `arkaik release 1.0 --compact` archives both pre-marker events (rawReleaseSlice at packages/cli/src/commands/release.ts:63-84 leaves fromIndex=-1 so the slice is everything before the marker); `arkaik validate` then exits 1 with `ERROR [journal-missing-node-created]`. (2) Ordinary release: a node created between markers loses its node.created (`journal-missing-node-created`), and a node whose latest transition was in the slice strands its older pre-marker transition as the new last one (`ERROR [journal-status-mismatch] ... "development" disagrees with snapshot status "live"`) — both errors reproduced in one run. Code path confirmed: compactSlice (packages/cli/src/lib/journal-io.ts:79-98) rewrites journal.jsonl minus the slice; validateBundleAt (packages/cli/src/lib/bundle-validate.ts:47-74) folds ONLY the journal.jsonl sidecar, never journal/archive-*.jsonl; crossCheckJournal (packages/schema/src/journal.ts:396, 535-553) runs whenever the journal is non-empty — and the surviving release.tagged marker guarantees it is non-empty — demanding node.created for every snapshot node and status agreement on the last surviving transition. The test-fixture claim is accurate: tests/cli/log-release.test.js:71-74 explicitly hand-builds a slice "none of which crossCheckJournal needs once compacted", so the suite's "validate stays VALID after --compact" check passes only by fixture construction. Aggravating factors supporting high severity: release.ts's own header (lines 15-17) asserts validate "stays green afterward"; the spec (docs/spec/journal.md § Releases, Compaction & Growth) says archives are part of history yet no reader folds them; `arkaik open` (open.ts:124) and `arkaik push` (push.ts:171) gate on the same validateBundleAt, so a compacted bundle also blocks open/push; and the spec's repair path (`arkaik doctor`) does not exist in the CLI (no doctor command in packages/cli/src/commands/ or --help), so recovery is manual archive re-merge. --compact is opt-in/default OFF, but it is a documented flag in a published CLI whose most ordinary uses (first release, or any release that created nodes) leave the project persistently INVALID. All cited file:line locations check out. The three recommended fixes are each coherent; folding archives at validate time or retaining provenance/last-transition events during compaction would be genuine improvements, not churn.

#### 🟡 MEDIUM — `arkaik init` scaffolds schema_version 1, so any hand-added `backlog` status is silently remapped to `idea` on every read

<sub>`quality-packages-3` · effort: small</sub>

**Where:** `packages/cli/src/commands/init.ts:189`, `packages/schema/src/legacy-status.ts:124`, `packages/cli/src/commands/bootstrap.ts:400`, `packages/cli/src/lib/bundle-io.ts:37`

scaffoldBundle writes `schema_version: 1` (init.ts:188-198) while `bootstrap merge`'s greenfield base writes `schema_version: 3` (bootstrap.ts:399-409). migrateStatusVocabulary (applied by readBundle on every CLI/MCP read) gates the ambiguous `backlog`->`idea` remap on `schema_version < 3` (legacy-status.ts:124-133) because pre-v3 "backlog" meant the someday pile. A bundle scaffolded by init today uses the CURRENT 7-status vocabulary, yet is stamped as pre-v3 vintage: until some command rewrites the file (release/deliverable/log never do), a hand- or agent-edited node with the current-meaning status "backlog" is silently reinterpreted as "idea" by validate, log, sync, pack, and the MCP server.

**Recommendation:** Stamp freshly scaffolded bundles with STATUS_VOCABULARY_VERSION (3), imported from @arkaik/schema so the two can never drift; consider a one-line note in init output for existing scaffolds.

#### 🟡 MEDIUM — Published `arkaik` package ships broken TypeScript types for the `arkaik/io` subpath export

<sub>`quality-packages-4` · effort: small</sub>

**Where:** `packages/cli/package.json:10`, `packages/cli/package.json:16`, `packages/cli/src/io.ts:13`

exports["./io"].types points at ./src/io.ts, and the files field is ["dist", "src/io.ts"]. Verified with `npm pack --dry-run`: the tarball contains src/io.ts (821B) but none of the modules it re-exports (src/lib/bundle-io.ts, src/lib/journal-io.ts, src/lib/bundle-validate.ts), and those modules' types in turn come from @arkaik/schema, which is private, unpublished, and not a declared dependency. Any TypeScript consumer of the published `arkaik/io` seam (the documented reuse point for external MCP-style consumers, docs/spec/mcp.md § Reuse Seams) gets "Cannot find module './lib/bundle-io'" — runtime works via the bundled dist/io.js, types do not. The package also declares no `engines` despite requiring global fetch (Node 18+).

**Recommendation:** Generate a self-contained .d.ts for dist/io.js at build time (esbuild + a dts bundler, or a small hand-maintained dist/io.d.ts) and point exports["./io"].types at it; add an `engines: { node: ">=18" }` field.

#### 🟡 MEDIUM — compactSlice silently destroys malformed journal lines the parser promises never to damage

<sub>`quality-packages-5` · effort: small</sub>

**Where:** `packages/cli/src/lib/journal-io.ts:83`, `packages/cli/src/lib/journal-io.ts:97`, `packages/schema/src/journal.ts:255`

compactSlice rebuilds the working journal from `readJournalEvents(journalPath)` (which drops unparseable lines and events missing envelope fields, journal-io.ts:32-35) and rewrites the file with only the surviving parsed events (journal-io.ts:97). parseJournalLines' contract says a malformed line "can never damage the events on other lines" (journal.ts:257-259) and the journal is documented as append-only history that is "kept, not deleted" — yet one `release --compact` run permanently deletes every malformed line (e.g. a bad hand edit or merge artifact) with no warning, instead of preserving it verbatim or refusing.

**Recommendation:** In compactSlice, operate on raw lines: keep unparseable lines verbatim in the working journal (they are by definition not in the slice), or abort compaction with the line findings when the journal contains malformed lines.

#### 🟡 MEDIUM — Flow-cycle DFS in validateBundle leaves a stale inStack, producing false 'Cycle detected' errors for innocent flows

<sub>`quality-packages-6` · effort: small</sub>

**Where:** `packages/schema/src/validate.ts:813`, `packages/schema/src/validate.ts:822`

dfs() returns true on cycle detection without removing ids from `inStack` (the early-return path at validate.ts:815-824 skips `inStack.delete(id)` at line 826), so after one real cycle every node left in the stale set reads as "on the current stack" for later roots. Reproduced with the built CLI: flows F-a<->F-b (a real cycle) plus F-c whose playlist merely references F-b yields THREE flow-cycle errors including `Cycle detected: flow "F-c" -> "F-b"` — F-c is not on any cycle. Each real cycle also reports once per stack frame. Since this validator gates agent mutations and CI, false findings send an author/agent to "fix" playlists that are correct.

**Recommendation:** Delete from inStack on the error path too (or restructure to a standard colored DFS), and report the cycle once at the frame that closed it rather than at every ancestor. Add a fixture with an edge into a cycle from an acyclic flow.

#### 🟡 MEDIUM — `arkaik link` has no error handling: any network failure is an unhandled promise rejection

<sub>`quality-packages-7` · effort: small</sub>

**Where:** `packages/cli/src/commands/link.ts:161`, `packages/cli/src/commands/link.ts:87`, `packages/cli/src/commands/link.ts:114`

runLinkCli does `void runLink(argv).then(...)` with no `.catch` (link.ts:161-165), and runLink never wraps its fetch/`res.json()` calls (lines 87-94, 114-121). Every sibling network command (push, sync, restore) ends with `.catch((e) => fail(...))`. A DNS failure, offline machine, wrong --remote host, or non-JSON response surfaces as a raw unhandled-rejection stack trace instead of the CLI's normal one-line FATAL message — worst on exactly the command that first-time hosted-mode users run.

**Recommendation:** Wrap the two requests in try/catch returning `{ ok: false }` with a friendly message, and add `.catch((e) => fail(...))` in runLinkCli to match the other commands.

#### 🟡 MEDIUM — `arkaik link` positional-path heuristic mistakes the --remote URL for the target directory

<sub>`quality-packages-8` · effort: small</sub>

**Where:** `packages/cli/src/commands/link.ts:123`, `packages/cli/src/commands/link.ts:79`

The target path is found via `argv.find((a) => !a.startsWith("--") && a !== projectId && a !== baseUrl)` (link.ts:123), but baseUrl was normalized with `.replace(/\/+$/, "")` (line 79). `arkaik link --project prj_x --remote https://arkaik.app/` (trailing slash — a common way to paste an origin) makes the raw argv value fail the `a !== baseUrl` comparison, so the URL itself is taken as the positional path: the link file is written to `<cwd>/https:/arkaik.app/docs/arkaik/arkaik.json` and the command reports success while `docs/arkaik/arkaik.json` was never written — the MCP server then silently stays in file mode.

**Recommendation:** Parse flags positionally like every other command in this CLI (consume flag values by index) instead of value-matching raw argv; reject more than one positional.

#### 🟢 LOW — validateBundle is one 745-line function; rule groups cannot be tested or reused in isolation

<sub>`quality-packages-9` · effort: medium</sub>

**Where:** `packages/schema/src/validate.ts:95`, `packages/schema/src/validate.ts:840`

validateBundle spans lines 95-840 as a single closure with inline sub-passes (project checks, node checks, maps, products, edges, playlist coherence, cycle DFS) sharing ~10 accumulator variables. The sections are well-commented, but the stale-inStack cycle bug (reported separately) illustrates the cost: the DFS is unreachable except through a full bundle fixture, so a two-line unit test was never written. By contrast journal.ts (576 lines) is already cleanly decomposed (orderEvents/parseJournalLines/crossCheckJournal) and needs no change.

**Recommendation:** Extract the existing commented sections into module-private functions taking (ctx, error, warn) — e.g. checkNodes, checkStoredMaps, checkProducts, checkEdges, checkPlaylists, checkFlowCycles — preserving finding order; keep validateBundle as the orchestrator. Pure mechanical move, enables direct unit tests per rule group.

#### 🟢 LOW — MCP initialize echoes back any client-requested protocolVersion, claiming support for revisions it does not implement

<sub>`quality-packages-10` · effort: small</sub>

**Where:** `packages/mcp/src/protocol.ts:122`, `packages/mcp/src/protocol.ts:15`

The initialize handler responds with `protocolVersion: typeof requested === "string" ? requested : PROTOCOL_VERSION` (protocol.ts:124-125) — a client asking for any future or bogus revision string is told the server speaks it. The MCP spec expects the server to return the requested version only if supported, otherwise its own latest supported version, so a client relying on the negotiation result may enable behavior this hand-rolled server (which implements only initialize/tools/ping) does not have.

**Recommendation:** Return `requested` only when it is in a known-supported list (currently just "2025-06-18"); otherwise return PROTOCOL_VERSION and let the client decide.

#### 🟢 LOW — Load-bearing constants duplicated across CLI and MCP modules

<sub>`quality-packages-11` · effort: small</sub>

**Where:** `packages/cli/src/lib/journal-io.ts:14`, `packages/cli/src/lib/bundle-validate.ts:25`, `packages/cli/src/commands/push.ts:57`, `packages/cli/src/commands/restore.ts:104`, `packages/mcp/src/config.ts:14`

JOURNAL_SIDECAR = "journal.jsonl" is exported from both journal-io.ts:14 and bundle-validate.ts:25 (both re-exported via arkaik/io). DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json" is re-declared in ~10 command files plus packages/mcp/src/store.ts:25. DEFAULT_API_BASE = "https://arkaik.app" lives in push.ts:57, restore.ts:108, link.ts:25, and mcp/config.ts:17; LINK_FILE = "docs/arkaik/arkaik.json" in link.ts:24, restore.ts:104, and mcp/config.ts:14. Any rename (e.g. a configurable default path) must now be found in a dozen places, and the pairs are only kept equal by comment discipline.

**Recommendation:** Create one packages/cli/src/lib/constants.ts (re-exported through arkaik/io for the MCP server) holding JOURNAL_SIDECAR, DEFAULT_BUNDLE_PATH, DEFAULT_API_BASE, LINK_FILE; import it everywhere.

#### 🟢 LOW — `arkaik sync` appends journal events before the snapshot write, leaving a validator-red state if interrupted

<sub>`quality-packages-12` · effort: small</sub>

**Where:** `packages/cli/src/commands/sync.ts:291`, `packages/cli/src/commands/sync.ts:316`, `packages/cli/src/commands/sync.ts:332`

Each changed ref appends its ref.status_changed event immediately inside the loop (sync.ts:291), and --promote appends node.status_changed events per promotion (sync.ts:316-329), but the mutated bundle is serialized only once at the end (sync.ts:332-334). A crash, Ctrl-C, or serializeBundle failure between a promote append and the final write leaves node.status_changed events whose `to` disagrees with the snapshot — `arkaik validate` then fails with journal-status-mismatch and there is no doctor command yet to repair it. (The MCP path avoids this by validating the folded candidate before any write, store.ts:117-149.)

**Recommendation:** Buffer events during the loop and perform the dual write at the end in the store.ts order (validate candidate, then journal, then snapshot), or at minimum write the bundle before appending the promote events so the snapshot always leads.


### Front-end application quality

Scope: `app/` pages, `components/` (non-ui), `lib/hooks`, `lib/utils`, `lib/config`. The app layer is structurally strong — zero `any`/`@ts-ignore` in scope, pure-logic extraction is systematic, and known races are guarded where they were identified. The findings below are the places the discipline slipped.

#### 🔴 HIGH — Playlist condition/junction label editing writes to the store per keystroke and junction-case keys include the label, causing focus loss and dropped characters

<sub>`quality-frontend-1` · effort: medium · verification: **confirmed** → issue [#356](https://github.com/alexisbohns/arkaik/issues/356)</sub>

**Where:** `components/panels/PlaylistEntryRow.tsx:219`, `components/panels/PlaylistEntryRow.tsx:250`, `components/panels/PlaylistEntryRow.tsx:262`, `components/panels/PlaylistEditor.tsx:19`

Condition/junction label Inputs are controlled by `entry.label` (which comes from node.metadata via useNodes state) and their onChange calls `void onChangeEntry({ ...entry, label: event.target.value })` on every keystroke, which flows through PlaylistEditor.persistEntries -> onUpdate -> provider.updateNode — an IndexedDB write locally and an HTTP PATCH per keystroke on hosted projects, with no debounce (NodeFields and AcceptanceEditor both debounce the same kind of edit at 350ms). Because the controlled value only updates after the async write resolves and useNodes re-sets state, fast typing has React reset the DOM input to a stale value (typed characters visually revert), and two in-flight writes can land out of order. Worse, junction case rows are keyed `key={`${caseIndex}-${playlistCase.label}`}` (PlaylistEntryRow.tsx:262) with the case-label Input inside — every committed keystroke changes the key, remounts the row, and drops focus, making case labels nearly untypeable.

**Recommendation:** Hold label text in local state and debounce the persist (mirroring NodeFields' 350ms pattern with a latest-node ref like AcceptanceEditor.tsx:48-60), and key junction cases by index or a stable id — never by their editable label.

> **Adversarial verification (confirmed):** Independently reproduced every element of the claim from source. (1) PlaylistEntryRow.tsx:220-224, 253-257, 264-274: condition/junction/case label Inputs are controlled by entry state and call onChangeEntry per keystroke with no local state or debounce. (2) Full persist chain verified: handleReplace (PlaylistEntryRow.tsx:349-352) -> PlaylistEditor.persistEntries (PlaylistEditor.tsx:19-35) -> page handleNodeUpdate (e.g. app/project/[id]/library/page.tsx:390-392) -> useNodes.updateNode (lib/hooks/useNodes.ts:50-57, awaits provider then setNodes) -> Dexie runOps write locally (local-provider.ts:242-249) or HTTP POST per keystroke on hosted (remote-provider.ts:88-93, 166-171). Controlled value therefore only round-trips after the async write, so mid-flight keystrokes visibly revert and two in-flight remote writes adopted out of order can leave a stale label — as claimed. (3) The cited contrast is real: NodeFields debounces identical edits at 350ms (NodeDetailPanel.tsx:77-140) and AcceptanceEditor.tsx:48-60 uses the debounce+nodeRef pattern the recommendation names. (4) The worst part is exact: junction case rows are keyed `${caseIndex}-${playlistCase.label}` (line 262) with the editable case-label Input inside, so every persisted keystroke changes the key, remounts the row, drops focus, and discards characters typed during the in-flight write — even the fast local Dexie write resolves between keystrokes, making case labels effectively require one click per character; the remount also wipes nested PlaylistEntryList/AddEntryControls state. One precision note (does not weaken the finding — it matches its own wording): the top-level condition/junction label rows have a stable key (`${entry.type}-${index}`, line 362) so they suffer revert/ordering but not focus loss; only case rows remount. components/ui/input.tsx is a plain controlled input, no mitigation. Recommendation (local state + 350ms debounce mirroring existing in-repo patterns; stable keys) is a genuine fix consistent with codebase conventions. High severity is honest: a documented core editing surface (flow playlist branching, docs/data-layer.md:207) is effectively unusable for case labels, plus per-keystroke wholesale-metadata HTTP writes with an out-of-order persistence hazard on hosted projects.

#### 🟡 MEDIUM — Load errors from useNodes/useEdges/useProject/useJournal are captured but never rendered — a failed load shows 'No nodes yet. Create one to get started.'

<sub>`quality-frontend-2` · effort: medium · verification: **confirmed** → issue [#362](https://github.com/alexisbohns/arkaik/issues/362)</sub>

**Where:** `lib/hooks/useNodes.ts:20`, `lib/hooks/useEdges.ts:19`, `lib/hooks/useProject.ts:16`, `lib/hooks/useJournal.ts:26`, `app/project/[id]/library/page.tsx:497`

All four hooks catch load failures, `console.error`, set an `error` state string, and set loading=false — but a repo-wide grep shows no consumer ever destructures `error` from any of them (every call site takes only nodes/edges/project/journal + loading). After a failed IndexedDB or remote read, the Library renders its empty state ('No views yet. Create one to get started.', library/page.tsx:497-501), Delivery renders 'No delivery items match', and maps render an empty canvas — all indistinguishable from an empty project. This reads as data loss to the user and invites creating duplicate nodes into a project that failed to load.

**Recommendation:** Surface `error` in the shared loading gate of each page (the `if (nodesLoading || edgesLoading)` blocks) with a retry affordance, or have the hooks throw to an error boundary; at minimum distinguish 'load failed' from 'empty' before rendering create-node empty states.

#### 🟡 MEDIUM — PlatformVariantsSection seeds notes/statuses/screenshots into local state once and every handler writes all three maps back, clobbering concurrent metadata changes

<sub>`quality-frontend-4` · effort: small</sub>

**Where:** `components/panels/NodeDetailPanel.tsx:486`, `components/panels/NodeDetailPanel.tsx:493`, `components/panels/NodeDetailPanel.tsx:509`

`useState(rawNotes)` / `useState(rawStatuses)` / `useState(rawScreenshots)` seed once per mount (key is `pv-${node.id}-${initialPlatform}` so external node updates never re-seed), yet handleNotesChange writes `metadata: { ...node.metadata, platformNotes: next, platformStatuses: statuses, platformScreenshots: screenshots }` — the two maps the user did not touch come from the stale mount-time snapshot. Any change to platformStatuses/platformScreenshots made elsewhere while the panel is open (raw bundle save, a second panel on the same node in the stack — PanelStack keeps hidden panels mounted — or a status change through Delivery) is silently reverted by the next note edit. AcceptanceEditor solved the identical hazard with a `nodeRef` read at fire time (AcceptanceEditor.tsx:48-60); this section predates that fix.

**Recommendation:** Patch only the map being edited and read the other maps from the latest `node.metadata` at write time (or adopt the nodeRef pattern), instead of round-tripping all three maps from mount-time state.

#### 🟡 MEDIUM — TokenManager and RepoLinksPanel: network failures are unhandled promise rejections, and non-OK responses are masked as empty lists

<sub>`quality-frontend-5` · effort: small</sub>

**Where:** `components/settings/TokenManager.tsx:85`, `components/settings/TokenManager.tsx:99`, `components/settings/TokenManager.tsx:123`, `components/settings/RepoLinksPanel.tsx:112`, `components/settings/RepoLinksPanel.tsx:166`

TokenManager.refresh() has no try/catch — a fetch() network error propagates through `void refresh()` as an unhandled rejection with no UI feedback; on `!res.ok` it does `setTokens([])`, so a 500 renders 'No tokens yet.' as if the account genuinely had none. mint() has only a `finally` (network throw = unhandled rejection, no toast), revoke() the same. RepoLinksPanel has the identical shape: refresh() sets `setLinks([])` on failure, rendering 'No repositories linked yet' — which invites re-linking repos that are already linked — and link()/unlink() have no catch for network errors. Contrast RestoreDialog (components/sync/RestoreDialog.tsx:103-137), which handles both failure modes correctly with distinct error state.

**Recommendation:** Add catch blocks that toast the failure, and keep a distinct error/unknown state instead of coercing failures to empty lists (the codebase's own rule — see the 'not-knowing must not look like not-backed-up' comment in app/projects/page.tsx:252-258).

#### 🟡 MEDIUM — NodeFields debounced autosave silently discards up to 350ms of title/description/blocked-by edits on unmount

<sub>`quality-frontend-6` · effort: small</sub>

**Where:** `components/panels/NodeDetailPanel.tsx:100`, `components/panels/NodeDetailPanel.tsx:113`, `components/panels/NodeDetailPanel.tsx:134`, `components/panels/NodeDetailPanel.tsx:626`

Each autosave effect returns `() => clearTimeout(timeout)` with no flush. NodeFields is keyed `key={node.id}` (line 626), so closing the panel (Escape/close button), navigating to another node in the same panel slot, or a delete-driven prune within 350ms of the last keystroke unmounts the component and cancels the pending save — the trailing edit to title, description, or blocked-by is lost with no feedback. There is no save-on-blur fallback either; the contentEditable fields only write through the debounce.

**Recommendation:** Flush the pending save in the effect cleanup (call onUpdate with the latest value via a ref when a timer is outstanding at unmount) or add an onBlur save, so the last keystrokes before a close always persist.

#### 🟢 LOW — Dead onDelete prop threaded through PageShell -> ProjectPanels -> NodeDetailPanel and explicitly voided

<sub>`quality-frontend-7` · effort: small</sub>

**Where:** `components/panels/NodeDetailPanel.tsx:622`, `components/panels/ProjectPanels.tsx:180`, `components/layout/PageShell.tsx:38`, `components/maps/JourneyMap.tsx:777`

NodeDetailPanel accepts `onDelete` and immediately discards it (`void onDelete;` at line 622) — there is no delete affordance anywhere in the panel body. JourneyMap wires a real handler (`onDelete={handleDeleteNodeRequest}`, JourneyMap.tsx:777) through PageShell and ProjectPanels for nothing; the only working delete path is the keyboard shortcut on the maps. Every other surface (Library, Delivery, Acceptances) passes no onDelete, so nodes opened there cannot be deleted at all. A maintainer reading the prop chain reasonably assumes the panel renders a delete button.

**Recommendation:** Either render a delete action in NodeDetailPanel when onDelete is provided (making Library/Delivery pass one too), or delete the prop from all three layers so the chain stops promising a capability that does not exist.

#### 🟢 LOW — useElkLayout serves the previous graph's positioned nodes for the new graph's edges while a relayout is in flight

<sub>`quality-frontend-8` · effort: medium</sub>

**Where:** `lib/hooks/useElkLayout.ts:47`, `components/maps/JourneyMap.tsx:725`

`ready` is `layoutVersion > 0` and never resets, so after the first layout the hook always returns `layoutedNodes` — the previous topology's array — until the async ELK pass for the new graph resolves. JourneyMap renders `nodes = layoutedNodes` beside `edges = graphData.edges` (lines 725-726), i.e. the new edge set against the old node set: a just-deleted node stays visible and clickable for a frame (its click handler resolves a node that no longer exists), a just-added node is absent while its edge already references it, and expanding a flow briefly draws edges into nothing.

**Recommendation:** Track which graph the layouted nodes belong to (e.g. store the input graph reference with the result) and fall back to `graph.nodes` whenever they disagree, rather than gating only on 'has any layout ever completed'.

#### 🟢 LOW — Library gallery recomputes O(views x (nodes+edges)) effective platform statuses inline on every render

<sub>`quality-frontend-9` · effort: small</sub>

**Where:** `app/project/[id]/library/page.tsx:517`, `lib/utils/platform-status.ts:120`

In the gallery map, `viewPlatformStatuses={node.species === 'view' ? getEffectivePlatformStatuses(node, dataNodes, dataEdges) : undefined}` runs unmemoized per card per render; each call runs coveringAcceptances, which filters the full edge list and full node list. Every search keystroke, selection toggle, and sort click re-renders the page and redoes the full O(views x (N+E)) pass, while the flow rollups just above it are carefully memoized into `flowRollupByNodeId` (lines 381-388). NodeDetailPanel's ConnectionsSection/HistorySection/ComputedPlatformStatusSection similarly rebuild Maps and rollups inline per render, though panels render one node at a time.

**Recommendation:** Precompute a `viewStatusesByNodeId` map in a useMemo keyed on [dataNodes, dataEdges], exactly like flowRollupByNodeId, so filter/search/selection interactions stop scaling with graph size.

#### 🟢 LOW — JourneyMap creates a node and then deletes it to reject a cycle, instead of validating before the write

<sub>`quality-frontend-10` · effort: small</sub>

**Where:** `components/maps/JourneyMap.tsx:512`, `components/maps/JourneyMap.tsx:530`

handleAddNode calls `await addNode(...)` first, then builds `nodesForValidation` and runs `wouldCreateCycle`; on a cycle it calls `await removeNode(createdNode.id)` and shows the error. The rejected gesture round-trips two provider writes (and on providers that journal, records a node.created followed by node.deleted for a node that never should have existed); a failure between the two writes strands the node. The validation input is constructed synthetically anyway (`dataNodes.filter(...)` plus `createdNode`), so nothing about the check requires the node to be persisted first.

**Recommendation:** Compute the candidate id via generateNodeId, run wouldCreateCycle against a synthetic node object before calling addNode, and only write when the insertion is legal.


### Server & API quality

Scope: `app/api/**`, `auth.ts`, `lib/services/**`, `lib/data/**`, `lib/sync/**`. The security posture is genuinely good (uniform ownership filtering, HMAC-verified webhooks, hashed tokens, careful hosted-write concurrency); the findings are hardening and consistency gaps, tracked as umbrella issue [#364](https://github.com/alexisbohns/arkaik/issues/364).

#### 🟡 MEDIUM — The 'synk' token scope is mintable but unusable — no Synk route accepts bearer tokens

<sub>`quality-server-1` · effort: small</sub>

**Where:** `lib/services/tokens.ts:47`, `app/api/synk/projects/[projectId]/route.ts:28`, `app/api/synk/projects/route.ts:19`, `app/api/synk/backups/[backupId]/route.ts:21`, `components/settings/TokenManager.tsx:30`, `lib/services/auth.ts:91`

TOKEN_SCOPES declares "synk" and documents it as "the backup API" scope (tokens.ts:47: `export const TOKEN_SCOPES = ["graph:read", "graph:write", "synk"]`), and the settings UI offers minting it ('Synk backups — Read and write project backups', TokenManager.tsx:30). But every Synk route calls getSession() only — none calls getCaller(req), which is the only path that resolves a bearer token — and grep shows hasScope(caller, "synk") is never checked anywhere outside tests. A token minted with only the synk scope authenticates nowhere: every graph route refuses it (insufficient_scope) and every Synk route 401s it (no session cookie).

**Recommendation:** Either wire the Synk routes through getCaller + hasScope(caller, "synk") (verifyToken already returns userId, which is all the Synk queries scope on), or drop "synk" from TOKEN_SCOPES and the TokenManager UI until the API exists. Today's state ships a credential option that silently does nothing.

#### 🟡 MEDIUM — Tier-limit enforcement and Synk backup writes are check-then-act with no transaction

<sub>`quality-server-2` · effort: medium</sub>

**Where:** `lib/services/synk.ts:334-409`, `lib/services/synk.ts:375-385`, `lib/services/graph/store.ts:373-381`, `lib/services/db.ts:87-93`

db.ts's own contract says "Anything needing atomicity … MUST go through withTransaction" (db.ts:87), yet putBackup runs latestHash → validate → tier lookup → projectExists + count(*) → project upsert → backup insert → prune as seven separate query() calls, each potentially on a different pool connection. Two consequences: (1) concurrent PUTs from a new user both read count=0 and both insert, exceeding the synk tier's 1-project cap (same pattern in graph createProject, store.ts:373-381, where the count(*) check runs before withTransaction opens); (2) a crash between the synk_projects upsert (synk.ts:393) and the synk_backups insert (synk.ts:400) leaves a project row with zero backups — the listing's LEFT JOIN LATERAL then shows latest_backup_id null. The dedupe check (latestHash at synk.ts:342) is also racy, so two concurrent identical PUTs both store.

**Recommendation:** Wrap putBackup's steps 4-5 (count check, upsert, insert, prune) in withTransaction with the count under a lock (e.g. `select … from synk_projects where user_id=$1 for update` or an advisory lock per user), and move createProject's project-count check inside its existing withTransaction with a `for update` scan or `serializable` guard. While there, deduplicate the identical getUserTier in synk.ts:152 and store.ts:802.

#### 🟡 MEDIUM — Body-size caps are inconsistent: mutations, project PATCH, and Synk PUT parse unbounded JSON

<sub>`quality-server-3` · effort: small</sub>

**Where:** `app/api/graph/projects/[projectId]/mutations/route.ts:64`, `app/api/graph/projects/[projectId]/route.ts:70`, `app/api/synk/projects/[projectId]/route.ts:42`, `app/api/graph/projects/route.ts:58-61`, `app/api/publik/route.ts:29-40`

POST /api/graph/projects, PUT …/bundle, and POST /api/publik all read req.text() and enforce a 5 MB cap before JSON.parse; the webhook caps at 2 MB. But POST …/mutations (mutations/route.ts:64), PATCH …/{projectId} (route.ts:70), and PUT /api/synk/projects/{id} (synk route.ts:42) call req.json() with no size check at all. MAX_OPS=500 bounds op count, not bytes — a single create_node/update_node op can carry arbitrarily large metadata. Consequences: unbounded parse memory on authenticated routes, and a hosted snapshot grown past 5 MB via mutations that can never round-trip through the capped import/restore endpoints (PUT …/bundle would 413 the export of a project the mutations path happily built). Synk's entity limit (250) similarly caps count, not bytes, so one node with megabytes of metadata is stored per backup version.

**Recommendation:** Apply the same read-text-then-check-then-parse pattern (MAX_BUNDLE_BYTES or a smaller per-route cap) to the mutations, PATCH, and Synk PUT handlers; hoist the shared constant next to servicesUnavailable in lib/services/db.ts so the caps cannot drift again.

#### 🟡 MEDIUM — Publik rate limiting is bypassable via spoofed X-Forwarded-For and racy under bursts

<sub>`quality-server-4` · effort: medium</sub>

**Where:** `lib/services/publik.ts:107-116`, `lib/services/publik.ts:212-241`, `app/api/publik/route.ts:43-51`

deriveClientIp trusts the FIRST hop of the client-supplied x-forwarded-for header (`xff.split(",")[0]`, publik.ts:109-111). Behind Vercel that hop is platform-attested, but the codebase explicitly supports self-hosting ("any self-hosted Postgres (Inkognito)", db.ts) where a direct request controls the header entirely: rotating a random XFF value per request gives each request its own rate bucket, making the throttle on the UNAUTHENTICATED POST /api/publik (which stores up to 5 MB of jsonb per call) a no-op. Separately, checkRateLimit is count-then-insert with no lock (publik.ts:225-240), so N concurrent requests all read hits<limit and all insert — the limit is soft under bursts even with an honest IP.

**Recommendation:** For self-hosted deployments, add a TRUSTED_PROXY/behind-proxy switch (fall back to the socket address or reject XFF when not behind a known proxy) and document it in .env.example. Make the limiter atomic with a single INSERT … SELECT WHERE count<limit statement or an advisory lock keyed on ip_hash.

#### 🟡 MEDIUM — Local and hosted providers drift: local writes skip validateBundle, and saveProject has different blast radius per backend

<sub>`quality-server-5` · effort: medium</sub>

**Where:** `lib/data/local-provider.ts:114-148`, `lib/data/local-provider.ts:177-198`, `lib/services/graph/store.ts:549-555`, `lib/data/remote-provider.ts:128-134`, `lib/services/graph/store.ts:430-466`

Hosted applyMutation gates every op batch on validateBundle over the whole snapshot (store.ts:549-555); the local provider's runOps applies applyOps and persists with no validator pass at all (local-provider.ts:122-141). applyOps enforces op-level rules but not the full graph rules (e.g. duplicate-ref-id inside a metadata.refs patch, playlist coherence findings), so identical DataProvider calls can succeed locally and 422 hosted — the user discovers it only as an invalid_bundle error when importing to their account. Second drift: local saveProject persists the ENTIRE passed bundle including nodes and edges (`db.projects.put({ id, snapshot })`, local-provider.ts:190), while the remote provider PATCHes project fields only and the server strips nodes/edges (updateProjectFields deletes them, store.ts:450-451). A caller holding a stale bundle that calls saveProject silently reverts recent graph edits on a local project but not on a hosted one.

**Recommendation:** Run validateBundle (or at least its error-severity rules) in runOps before commit so local and hosted refuse the same states — or surface findings as warnings locally if hard-refusing is too strict for local-first. Make local saveProject write project fields only (merge onto the stored snapshot) to match the hosted contract; the import path already covers whole-bundle replacement.

#### 🟡 MEDIUM — pull-request.ts (2027 lines) is four modules in one file; planForProject is the real hazard

<sub>`quality-server-6` · effort: large</sub>

**Where:** `lib/services/github/pull-request.ts:139-472`, `lib/services/github/pull-request.ts:474-976`, `lib/services/github/pull-request.ts:1175-1760`, `lib/services/github/pull-request.ts:1901-2018`, `lib/services/github/pull-request.ts:1942`, `lib/services/github/pull-request.ts:1991`

The file is 689 code lines to 1230 comment lines — the length is mostly (excellent) rationale, not logic sprawl — but it interleaves four separable concerns: mention grammar + scanning (ACCEPTANCE_MENTION through mentionedAcceptances, ~139-472), repo-scope resolution (RepoScope/needsChangedFiles/resolveRepoScope/resolveDeliveryScopes, ~474-976), per-project planning (planForProject, a single ~585-line function whose inner node loop juggles refusedScope/freezes/justified/isFrozen/touched state, ~1175-1760), and the delivery ledger + DB orchestration (claimDelivery/releaseDelivery/applyPullRequestEvent, ~322-356 and 1901-2018). The pure parts are already exported for the DB-free suite, so a split is mechanical, and paths.ts proves the precedent. Minor concrete cost of the current shape: applyPullRequestEvent runs the identical ownerIdsFor query twice per project (lines 1942 and 1991).

**Recommendation:** Split along the seams the file already draws: mention.ts (grammar + scan), scope.ts (RepoScope machinery), plan.ts (planForProject, with its freeze/justify logic broken into named helpers), and keep pull-request.ts as the ledger + orchestrator. Hoist the ownerIdsFor result into a local per project. No behavior change; the existing tests pin every seam.

#### 🟢 LOW — SyncManager has no in-flight guard: concurrent backups and status regressions

<sub>`quality-server-7` · effort: small</sub>

**Where:** `lib/sync/sync-manager.ts:286-362`, `lib/sync/sync-manager.ts:260-267`, `lib/sync/sync-manager.ts:378-380`

performBackup tracks nothing about in-flight runs: backupNow() during a debounced run (or two rapid backupNow calls) issues two overlapping export→hash→PUT sequences for the same project. The server dedupes identical content, but the racy latestHash check there (synk.ts:342) means both can store. Also, a mutation arriving mid-flight calls scheduleDebounced → setStatus "pending" (sync-manager.ts:262), and the older in-flight run then completes and overwrites it with "backed-up" (line 330) while the new timer is still armed — the badge claims backed-up while a change is provably pending.

**Recommendation:** Keep a per-project in-flight promise: backupNow awaits/coalesces onto it, and on completion only set "backed-up" if no newer timer is armed for that project (timers.has(projectId) is already the signal).

#### 🟢 LOW — Session callers create projects and tokens against an arbitrary first owner

<sub>`quality-server-8` · effort: small</sub>

**Where:** `app/api/graph/projects/route.ts:74`, `app/api/tokens/route.ts:110`, `lib/services/owners.ts:74-78`

POST /api/graph/projects passes `caller.ownerIds[0]` with no way for the request to choose an owner, and the tokens route defaults to `resolveOwnerIds(...)[0]` the same way. resolveOwnerIds orders by `owner_id` lexicographically (owners.ts:75), so for a user belonging to more than one owner (the schema supports kind='org' since 006_owners.sql), which tenant a new hosted project or default-owner token lands in depends on string sort order of opaque ids. Harmless while only personal owners exist, but it becomes a silent cross-tenant misfile the day org membership ships, and nothing in the API contract reserves a field to fix it.

**Recommendation:** Accept an optional owner_id in POST /api/graph/projects (gated on userBelongsToOwner, exactly as the tokens route already does) and default to the caller's personal owner (personalOwnerId(userId)) rather than sort order.


### Documentation accuracy

Scope: all top-level and spec docs (excluding the `docs/superpowers/` and `docs/rfcs/` dated archives). The pattern is stark: the deep docs are accurate — `graph-model.md`, `spec/mcp.md`, `spec/services.md`, `bootstrap.md`, `hosted-projects.md` all check out against the code — while the entry-point docs (README, CLAUDE.md, copilot-instructions, CONTRIBUTING, architecture.md, data-layer.md) describe a previous Arkaik.

#### 🔴 HIGH — Species count contradicts across README (5), CLAUDE.md (5), copilot-instructions (4) vs actual 6

<sub>`docs-1` · effort: small · verification: **confirmed** → issue [#359](https://github.com/alexisbohns/arkaik/issues/359)</sub>

**Where:** `README.md:13`, `CLAUDE.md:3`, `.github/copilot-instructions.md:10`, `packages/schema/src/ids.ts:8`, `packages/schema/src/ids.ts:25`, `docs/graph-model.md:7`

packages/schema/src/ids.ts:8 defines SPECIES_IDS = ["flow", "view", "data-model", "api-endpoint", "acceptance", "decision"] (6 species) and ids.ts:25 defines 8 edge types (adding covers, supersedes, generates, impacts). docs/graph-model.md:7 correctly says "Current taxonomy has exactly 6 species." But README.md:13 advertises "5-species graph — flows, views, data models, API endpoints, and acceptances as first-class node types" (no decision), CLAUDE.md's header describes Arkaik as an "atomic 5-species graph", and .github/copilot-instructions.md:10 still says "4-species model (flow, view, data-model, api-endpoint)". Three agent/human-facing entry docs give three different, all-wrong species counts while the shipped taxonomy and graph-model.md agree on six.

**Recommendation:** Update README.md's feature bullet, CLAUDE.md's one-line product description, and copilot-instructions.md to the 6-species model (adding decisions) and mention the decision-only edge types. Consider making graph-model.md the single linked source for the taxonomy instead of restating counts in each doc.

> **Adversarial verification (confirmed):** Independently verified every citation. (1) packages/schema/src/ids.ts:8 — SPECIES_IDS is exactly ["flow","view","data-model","api-endpoint","acceptance","decision"], 6 species; ids.ts:25 — EDGE_TYPE_IDS has 8 entries. (2) docs/graph-model.md:7 says "Current taxonomy has exactly 6 species" and its table lists decision with id prefix DEC-. (3) README.md:13 says "5-species graph" omitting decision — and there is a second stale instance the finding missed, README.md:86 ("Graph Model ... 5-species taxonomy"), which a fix should also catch. (4) CLAUDE.md:3-5 says "atomic 5-species graph" listing only the 5 pre-decision species. (5) .github/copilot-instructions.md:10 says "4-species model (flow, view, data-model, api-endpoint)" — the worst offender, missing both acceptance and decision. (6) The decision species is genuinely shipped in the app, not just the schema package: lib/config/species.ts:9 registers it. So three entry docs give three different, all-wrong counts (5, 5, 4) while code and graph-model.md agree on 6. Severity "high" is honest within the docs lens: CLAUDE.md and copilot-instructions.md are auto-loaded into agent context and actively misdescribe the core data model, which is exactly the kind of drift that steers agents into wrong assumptions (e.g., treating decision/acceptance as invalid species). One immaterial imprecision in the evidence: of the four edge types listed as additions, "covers" is acceptance-related; only supersedes/generates/impacts are the decision-cycle edges (per the "Decision edges (cycle 2)" comment at ids.ts:61). The recommendation (fix the three docs, point to graph-model.md as the single taxonomy source) is a real improvement, not churn — CLAUDE.md itself mandates "If species... change → update docs" via copilot-instructions.md:22, so this drift violates the repo's own stated policy.

#### 🔴 HIGH — CONTRIBUTING.md licensing section describes the MIT/AGPL split as future, but it has executed

<sub>`docs-2` · effort: small · verification: **confirmed** → issue [#360](https://github.com/alexisbohns/arkaik/issues/360)</sub>

**Where:** `CONTRIBUTING.md:11`, `CONTRIBUTING.md:14`, `packages/schema/package.json:6`, `packages/cli/package.json:5`, `docs/spec/toolchain.md:110`, `docs/vision.md:303`

CONTRIBUTING.md:11 speaks of "their future extraction into packages/schema and packages/cli" and :14 states "The split executes physically when packages/schema and packages/cli are extracted (Roadmap Phase 1) — until then, everything in this repo remains AGPL-3.0." The extraction happened: packages/schema, packages/cli, and packages/mcp exist, all three declare "license": "MIT" in their package.json, arkaik and arkaik-mcp are published to npm as MIT, and docs/spec/toolchain.md:110 plus README.md:62-63 present the split as done. vision.md:303 similarly claims "Current state: the whole repository ... is AGPL-3.0 (LICENSE)." Contributors reading CONTRIBUTING get the licensing state exactly backwards. Note also the packages ship no LICENSE file in their npm tarballs (packages/cli has files:["dist","src/io.ts"], no LICENSE).

**Recommendation:** Rewrite CONTRIBUTING.md's license section (and vision.md's "Current state" line) to describe the executed split: packages/* + plugin assets MIT, app/services AGPL-3.0. Add MIT LICENSE files to packages/cli and packages/mcp so the published tarballs carry the license they declare.

> **Adversarial verification (confirmed):** Independently reproduced every claim. CONTRIBUTING.md:5 says the entire repo is AGPL-3.0; :11 calls packages/schema and packages/cli a "future extraction"; :14 says the split executes "when packages/schema and packages/cli are extracted... until then, everything in this repo remains AGPL-3.0." In fact packages/schema, packages/cli, and packages/mcp all exist and declare "license": "MIT" (verified in all three package.json files), and npm view confirms arkaik@0.1.2 and arkaik-mcp@0.2.2 are published to the registry as MIT (versions match the working tree). docs/spec/toolchain.md:110 and README.md:62-64 present the split as executed; docs/vision.md:303 ("Current state: the whole repository ... is AGPL-3.0") contradicts vision.md:35-36 in the same file, which marks the Format/Toolchain layers "MIT — Shipped". Also verified the LICENSE gap: find over packages/ shows no LICENSE files, and npm pack --dry-run of the actual published arkaik@0.1.2 tarball lists 11 files with no LICENSE (mcp ships files:["dist"], same gap); the only license text in the repo is the root AGPL-3.0 LICENSE, so the MIT declaration on published packages has no backing grant text. Severity high is honest for a docs-lens finding: the contributor/adopter-facing licensing document states the inverse of reality for exactly the audience (AGPL-averse corporate adopters) the project targets, and the published packages' missing license text is a real compliance gap. The recommendation is precise and a strict improvement. Minor extra staleness in the same section (CONTRIBUTING.md:28-30 still calls validator CI "not wired in yet" though vision.md Phase 0 is marked shipped) further supports the rewrite.

#### 🔴 HIGH — data-layer.md documents an obsolete DataProvider interface and denies the remote provider exists

<sub>`docs-3` · effort: medium · verification: **confirmed** → issue [#361](https://github.com/alexisbohns/arkaik/issues/361)</sub>

**Where:** `docs/data-layer.md:110`, `docs/data-layer.md:214`, `lib/data/data-provider.ts:26`, `lib/data/data-provider.ts:51`, `lib/data/data-provider.ts:67`, `lib/data/remote-provider.ts:1`, `lib/data/provider-registry.ts:49`

docs/data-layer.md:110-136 prints the DataProvider interface with listProjects(): Promise<ProjectBundle[]>, updateNode(id, patch), deleteNode(id), deleteEdge(id) — but lib/data/data-provider.ts:26 has listProjects(): Promise<ProjectSummary[]> (a deliberate redesign, per its own comment), all mutators now take projectId first (updateNode(projectId, id, patch) at :51), and the applyMutations batch method (:67) is undocumented. data-layer.md:214 asserts "Hosted services are *not* providers: Publik shares snapshots and Synk backs them up one-way; the browser stays the source of truth" and :215 calls a second provider "future" — while lib/data/remote-provider.ts and seed-provider.ts exist today and provider-registry.ts:49-54 wires a routing provider over local/remote/seed as the default; docs/spec/services.md:29-41 explicitly records that the browser is no longer the source of truth for hosted projects. The NodeMetadata table (:24-31) also omits gherkin, values, blocked_by, product, decision_status/context/consequences/decided_at, and ProjectMetadata (:82-87) omits products and ref_policy.

**Recommendation:** Regenerate the interface listing from lib/data/data-provider.ts (or link to it instead of transcribing), document applyMutations and ProjectSummary, replace the "hosted services are not providers" paragraph with the local/remote/seed routing-provider reality (cross-referencing services.md's decision record), and extend the metadata tables with the acceptance/decision/product fields.

> **Adversarial verification (confirmed):** Independently reproduced every cited claim. (1) docs/data-layer.md:110-136 transcribes a DataProvider with listProjects(): Promise<ProjectBundle[]>, updateNode(id, patch), deleteNode(id), deleteEdge(id); lib/data/data-provider.ts actually has listProjects(): Promise<ProjectSummary[]> (:26, with a comment documenting the deliberate redesign), projectId-first mutators (updateNode(projectId, id, patch) :51; deleteNode/deleteNodes/deleteEdge all take projectId), and an undocumented applyMutations batch (:67); the doc's mutation-path diagram (:199) repeats the stale signature. (2) data-layer.md:214-215 asserts hosted services are not providers, the browser stays source of truth, and a second provider is "future" — while lib/data/remote-provider.ts and the seed provider exist and provider-registry.ts:48-53 wires createRoutingProvider({local, remote, seed}) as the DEFAULT provider; docs/spec/services.md's decision record explicitly states "Boundary 1 no longer holds for hosted projects" (server is system of record). (3) packages/schema/src/bundle.ts:108-131 confirms NodeMetadata carries blocked_by, gherkin, values, product, decision_status, context, consequences, decided_at — all absent from the doc's table (:24-31); ProjectMetadata (bundle.ts:293-303) has typed products, absent from the doc (:82-87). Minor imprecision only: ref_policy is a spec'd metadata key read via the catchall (promote.ts:76, bundle-format.md) rather than a typed ProjectMetadata field — the omission complaint still stands. Severity high is honest for the docs lens: README.md:87, docs/README.md:7, and docs/vision.md:4 position data-layer.md as the "source of truth for implemented behavior," and it currently asserts the inverse of the shipped provider architecture rather than merely lagging it. The recommendation is actionable and not churn.

#### 🟡 MEDIUM — .github/copilot-instructions.md misleads coding agents on routes, providers, and architecture

<sub>`docs-4` · effort: small</sub>

**Where:** `.github/copilot-instructions.md:11`, `.github/copilot-instructions.md:13`, `app/project/[id]/canvas/page.tsx`, `lib/data/provider-registry.ts:49`

Beyond the 4-species claim (separate finding), copilot-instructions.md:11 lists the project shell routes as "/project/[id]/canvas, /project/[id]/library, /project/[id]/changelog" — but /canvas is now a redirect to /maps/journey and the shell has overview, maps/[mapId], delivery, acceptances, decisions, pyramid, history, and settings routes (app/project/[id]/ contains 13 segments). Line 13 says "Hosted services (Publik/Synk under app/api/) are backups/shares, not providers — no Supabase anywhere", which is falsified by lib/data/remote-provider.ts, the routing default in provider-registry.ts:49-54, and the whole hosted-projects surface (app/api/graph, app/api/tokens, app/api/github/webhook). This file is loaded as instructions for Copilot, so its errors directly steer agent output.

**Recommendation:** Refresh copilot-instructions.md: 6 species, current route list (or just point at docs/architecture.md), and replace the providers claim with a sentence about local-first defaults plus hosted projects via the routing/remote provider.

#### 🟡 MEDIUM — architecture.md contains disproven claims: localProvider default, unregistered CrossLayerEdge, un-shipped CP-C, phantom RawBundleSheet.tsx

<sub>`docs-5` · effort: medium</sub>

**Where:** `docs/architecture.md:199`, `docs/architecture.md:73`, `components/graph/Canvas.tsx:27`, `docs/architecture.md:214`, `docs/architecture.md:115`, `docs/architecture.md:248`, `components/panels/RawBundlePanel.tsx`

Four concrete claims no longer hold. (1) architecture.md:199: "The current implementation is localProvider backed by IndexedDB" — provider-registry.ts:49-54 makes a routing provider over local + remote + seed the default. (2) :73 annotates CrossLayerEdge.tsx "(not yet registered in Canvas)" — Canvas.tsx:27-32 registers it for calls, displays, and queries edge types. (3) :214 says data-model/api-endpoint "render on the System map once roadmap CP-C lands" — CP-C is marked shipped in vision.md:368 and SystemMap.tsx exists (the same doc describes it at :76). (4) :115 and :248-249 reference components/panels/RawBundleSheet.tsx and insist it "stays a Sheet" — no such file exists; the component is RawBundlePanel.tsx, a panel in the stack. The App Router tree (:9-45) also omits shipped routes: acceptances, decisions, pyramid, history, settings, and app/settings/tokens; the component map omits the acceptances/, decisions/, journal/, values/, sync/, publik/, settings/ component domains; and the api/ line names only "Publik, Synk, and auth", omitting graph, tokens, and the GitHub webhook.

**Recommendation:** Fix the four falsified claims and extend the route tree/component map to the shipped surfaces (or trim the doc to stable prose plus links so it drifts less).

#### 🟡 MEDIUM — CLI command lists in toolchain spec, README, and vision omit four shipped commands

<sub>`docs-6` · effort: small</sub>

**Where:** `docs/spec/toolchain.md:50`, `README.md:63`, `docs/vision.md:36`, `packages/cli/src/index.ts:28`

packages/cli/src/index.ts:28-42 dispatches 12 commands: init, validate, log, release, deliverable, sync, pack, open, push, link, restore, bootstrap. The toolchain spec's normative command table (toolchain.md:50-60) lists only init/validate/log/release/sync/pack/open/push (+ the uncommitted dev), with no rows for link, restore, deliverable, or bootstrap — commands central to the hosted-projects and bootstrap workflows documented elsewhere. README.md:63 ("cli/ # arkaik — init, validate, log, release, sync, pack, open, push") and vision.md:36 repeat the 8-command list; vision.md:36 also still says "MCP server specified next" although CP-F shipped (vision.md:371) and packages/mcp is live.

**Recommendation:** Add link, restore, deliverable, and bootstrap rows to toolchain.md's command table (linking hosted-projects.md and bootstrap.md for detail), update the README and vision one-liners, and change vision's layer-2 status to reflect the shipped MCP server.

#### 🟡 MEDIUM — Hosted graph and token HTTP APIs have no spec; services.md env-var list is incomplete

<sub>`docs-7` · effort: medium</sub>

**Where:** `app/api/graph/projects/route.ts:23`, `app/api/graph/projects/[projectId]/mutations/route.ts:7`, `app/api/tokens/route.ts`, `docs/spec/services.md:71`, `docs/README.md:14`, `lib/services/publik.ts:72`

The hosted-projects surface is a substantial HTTP API — app/api/graph/projects (GET/POST), [projectId] (GET/PATCH/DELETE with ETag/If-Match), bundle, edges, export, journal, mutations (the validated write path), repos, plus app/api/tokens (mint/revoke) and /api/auth/status — with three MCP/CLI clients depending on it. Yet docs/README.md:14-23's spec list has no entry for it: services.md's protocol tables cover only Publik and Synk, hosted-projects.md declares itself "a how-to, not a spec" (line 9), and mcp.md documents only client-side resolution. Additionally services.md:71 claims the env-var set is "DATABASE_URL, AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET", but the code also reads GITHUB_WEBHOOK_SECRET, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY (documented only in hosted-projects.md) and RATE_LIMIT_SALT (lib/services/publik.ts:72 — documented nowhere).

**Recommendation:** Write a docs/spec/graph-api.md (or a section in services.md) covering the graph/token endpoints, auth (ark_ tokens vs session), ETag/If-Match semantics, and error shapes; list it in docs/README.md. Update services.md's env-var paragraph to the full set or point to one canonical env table, and document RATE_LIMIT_SALT for self-hosters.

#### 🟡 MEDIUM — bundle-format.md still flags two long-fixed defects as open in an 'Implemented' normative spec

<sub>`docs-8` · effort: small</sub>

**Where:** `docs/spec/bundle-format.md:42`, `docs/spec/bundle-format.md:275`, `lib/utils/export.ts:121`, `lib/utils/id.ts:1`

bundle-format.md:42 warns "Known consumer defect to fix before v2 ships: rewriteBundleProjectId (lib/utils/export.ts) reconstructs imported bundles as { project, nodes, edges } and silently drops any other top-level key" — but export.ts:121-128 now spreads ...bundle, preserving unknown keys (vision.md Phase 0 records the fix). bundle-format.md:275 states "App divergence (defect): The app currently violates these conventions: lib/utils/id.ts generates random UUID suffixes for nodes, and canvas-created edges use raw crypto.randomUUID()" — lib/utils/id.ts now re-exports deriveNodeId/edgeId from @arkaik/schema and its own comment says "The app no longer mints random-UUID-suffixed node ids or raw-UUID edge ids (issue #215)". Both callouts sit in a spec whose header says "Status: Implemented ... This document remains the normative contract", so readers conclude round-tripping through the app is unsafe when it is not. The Identifier Conventions table (:261-269) also lacks the AC-/DEC- prefixes the same doc defines later.

**Recommendation:** Convert both defect callouts to resolved decision-record notes (matching the doc's own style elsewhere) and add acceptance/decision prefix rows to the ID conventions table.

#### 🟡 MEDIUM — README folder structure omits packages/mcp and the current app routes

<sub>`docs-9` · effort: small</sub>

**Where:** `README.md:38`, `README.md:44`, `README.md:47`, `README.md:61`, `packages/mcp/package.json:1`

README.md:38-68's folder structure lists packages/schema and packages/cli but not packages/mcp — the published arkaik-mcp npm package and a headline agent surface (the Features list at :20 likewise mentions CLI and plugin/skill but never the MCP server). The app tree (:43-47) shows only project/[id]/canvas, library, changelog and describes canvas/ as "Graph canvas (the Journey map)" though it is now a redirect; overview, maps, delivery, acceptances, decisions, pyramid, history, and settings are absent. :47's "api/ # Publik, Synk, and auth route handlers" omits api/graph, api/tokens, and api/github/webhook, and the seed listing shows only pebbles.json though seed/arkaik-self-map.json ships and is CI-validated (package.json:15).

**Recommendation:** Refresh the README folder structure: add packages/mcp, the current project/[id] route set, the full api/ list, and arkaik-self-map.json; add the MCP server to the Agent-native feature bullet.

#### 🟡 MEDIUM — CONTRIBUTING pre-PR checklist predates CI: claims validation is unwired and omits the generate drift gate

<sub>`docs-12` · effort: small</sub>

**Where:** `CONTRIBUTING.md:26`, `CONTRIBUTING.md:30`, `.github/workflows/ci.yml:24`, `.github/workflows/ci.yml:36`, `package.json:13`

CONTRIBUTING.md:26-30 tells contributors to validate seed bundles manually via node docs/arkaik-skill/scripts/validate-bundle.js and states "(This isn't wired into CI yet — see Phase 0 in the roadmap — so it's a manual step for now.)" — but ci.yml:36-40 runs npm run validate:seeds and test:fixtures on every PR, and Phase 0 is marked shipped in vision.md:321. More costly: CONTRIBUTING's pre-PR steps are only npm run lint and npm run build, while ci.yml:24-28 fails any PR whose generated artifacts drift (schema doc, validator, plugin, prompt fragments, wobble CSS) unless the contributor ran npm run generate, and CI runs ~50 test:* scripts none of which CONTRIBUTING mentions. A contributor touching packages/schema following CONTRIBUTING exactly will fail CI with no local warning.

**Recommendation:** Update the checklist: npm run lint, npm run build, npm run generate (mandatory after schema/skill changes, with the drift-gate explanation), and the relevant test:* scripts (or a pointer to ci.yml); drop the "not wired into CI" caveat and reference npx arkaik validate as the modern validator entry point.

#### 🟢 LOW — journal.md prescribes 'arkaik doctor', a command that does not exist

<sub>`docs-10` · effort: small</sub>

**Where:** `docs/spec/journal.md:90`, `packages/cli/src/index.ts:28`

journal.md:90 (Authority & Consistency Model rule 4) says "Divergence is repaired explicitly: arkaik doctor appends corrective events to make history consistent with the snapshot" — inside a spec whose header (:9) says "Status: Implemented". The CLI dispatcher (packages/cli/src/index.ts:28-42, and its USAGE text) has no doctor command, so a user or agent hitting a snapshot↔journal cross-check error and following the spec runs a nonexistent command.

**Recommendation:** Either mark arkaik doctor as planned/not yet implemented in journal.md (with the current manual repair path: append corrective events by hand or via MCP tools), or implement the command.

#### 🟢 LOW — conventions.md documents the pre-schema-package config pattern

<sub>`docs-11` · effort: small</sub>

**Where:** `docs/conventions.md:127`, `lib/config/species.ts:1`, `docs/spec/toolchain.md:36`

conventions.md:127-144 says "All domain enums live in lib/config/ as const arrays" with the example export type SpeciesId = (typeof SPECIES)[number]["id"] and "Single source of truth — no duplicate enum + array. To add a new taxonomy value, add it to the array. The type updates automatically." Since the schema extraction, lib/config/species.ts:1-17 imports SpeciesId from @arkaik/schema and validates the label array against it with `as const satisfies` — the enum source of truth is packages/schema/src/ids.ts (toolchain.md:36 states lib/config "derives IDs from here"). Following conventions.md's recipe (add to the lib/config array) will not add a taxonomy value; it will fail the satisfies check until ids.ts changes. The file-organization tree (:5-29) also omits components/maps, delivery, overview, acceptances, decisions, journal, values, and packages/.

**Recommendation:** Update the Config/Taxonomies section to describe the two-file reality (ids in @arkaik/schema, labels/order in lib/config validated with satisfies, then npm run generate), and refresh the directory sketch.


### Component factorization

Scope: repeated UI patterns across `components/**` and `app/**`. The codebase demonstrably knows how to factor (OverviewSection, ProductSelect/ProductPicker, node-styles vocabularies, DeleteConfirmDialog) — these are the patterns that never got the same treatment. Tracked as umbrella issue [#363](https://github.com/alexisbohns/arkaik/issues/363).

#### 🟡 MEDIUM — Status select menu (icon + colored label SelectItems) is copy-pasted verbatim in 5 files, plus a decision-status twin

<sub>`factorization-1` · effort: small</sub>

**Where:** `components/acceptances/AcceptanceFilterBar.tsx:127-130`, `components/panels/NewNodeForm.tsx:262-274`, `components/panels/NodeDetailPanel.tsx:197-208`, `components/panels/PlatformVariants.tsx:187-197`, `components/panels/AcceptanceEditor.tsx:143-146`, `components/panels/DecisionEditor.tsx:181-191`

The exact block `{STATUSES.map((s) => { const Icon = STATUS_ICONS[s.id]; return <SelectItem key={s.id} value={s.id}><span className="inline-flex items-center gap-2"><Icon className={`size-3.5 ${STATUS_STYLES[s.id].badge}`} />{s.label}</span></SelectItem>; })}` appears character-for-character (modulo whitespace) in 5 components. DecisionEditor.tsx:181-191 repeats the identical shape with DECISION_STATUSES/DECISION_STATUS_ICONS/DECISION_STATUS_STYLES. PromptBuilderForm.tsx:108-110 renders the same menu without icons, a 7th drift point.

**Recommendation:** Extract a `<StatusSelectItems />` (or full `<StatusSelect value onChange>` wrapper) next to node-styles.ts, parameterized over the vocabulary (statuses/decision-statuses) so all 6 menus render one way. 5+ call sites with a config-driven, stable shape; new statuses then change one file.

#### 🟡 MEDIUM — The uppercase field-label group is hand-rolled ~30 times and was already extracted privately once (PromptBuilderForm's local Field)

<sub>`factorization-2` · effort: medium</sub>

**Where:** `components/generate/PromptBuilderForm.tsx:34-43`, `components/panels/NewNodeForm.tsx:217-226`, `components/settings/ProductFormDialog.tsx:138-155`, `components/maps/MapEditorDialog.tsx:134-146`, `components/panels/InsertBetweenDialog.tsx:66-83`, `components/panels/CreateProjectForm.tsx:67`, `components/panels/ProductPicker.tsx:86-87`, `components/panels/NodeDetailPanel.tsx:190-191`, `components/panels/PlatformVariants.tsx:167`, `components/settings/ProductDeleteDialog.tsx:113-115`

`<div className="flex flex-col gap-1.5"><span className="text-xs font-medium ... uppercase tracking-wide">Label</span>{control}{optional hint <p className="text-xs text-muted-foreground">}</div>` recurs across every form dialog and panel (44 hits for the gap-1.5 wrapper, ~35 for the label class). PromptBuilderForm.tsx:34-43 already defines exactly this as a private `Field` component. The label class exists in two orderings (`text-muted-foreground uppercase tracking-wide` in panels vs `uppercase tracking-wide text-muted-foreground` in maps/settings/delivery), and elements vary between <span> and <label> (MapEditorDialog uses <label> without htmlFor, giving no a11y benefit).

**Recommendation:** Promote `Field` ({label, hint?, children}) to a shared module (e.g. components/ui/field.tsx) and use it in NewNodeForm, ProductFormDialog, MapEditorDialog, InsertBetweenDialog, CreateProjectForm, NewAcceptanceForm, ProductPicker, DecisionEditor, PlatformVariants, NodeDetailPanel. Keep bare section headings (OverviewSection, PyramidTierGroup) out of scope — they are headings, not fields.

#### 🟡 MEDIUM — Dashed-border empty-state card duplicated across ~12 surfaces with drifting padding and CTA wiring

<sub>`factorization-3` · effort: medium</sub>

**Where:** `app/project/[id]/library/page.tsx:493-508`, `app/project/[id]/delivery/page.tsx:195-210`, `app/project/[id]/history/page.tsx:61-65`, `app/project/[id]/changelog/page.tsx:263-267`, `app/project/[id]/overview/page.tsx:174`, `app/project/[id]/maps/[mapId]/page.tsx:40-47`, `app/project/[id]/maps/[mapId]/page.tsx:60-67`, `app/project/[id]/pyramid/page.tsx:133-135`, `components/maps/JourneyMap.tsx:792`, `components/panels/ProjectPanels.tsx:157`, `components/delivery/DeliveryBoard.tsx:88`, `components/projects/ProjectSection.tsx:87`

`<div className="rounded-xl border border-dashed p-10 text-center"><p className="text-sm text-muted-foreground">…</p>[optional <div className="mt-4"><Button size="sm">CTA</Button></div>]</div>` is rebuilt at each site. Library and delivery pages repeat the identical Create-node CTA block (PlusIcon + Button + setNewNodeOpen). Padding drifts arbitrarily: p-10 (most), p-8 (pyramid:133), p-4 (DeliveryBoard:88, settings:81), rounded-lg vs rounded-xl (ProjectSection:87, ProductManagerPanel:267). No EmptyState component exists anywhere in components/.

**Recommendation:** Extract `<EmptyState message={ReactNode} action?={ReactNode} className?>` rendering the dashed card, and use it at the ~10 page-level sites. The compact p-4 inline variants (DeliveryBoard column, settings) can stay or take a `size="sm"` prop — do not force them in if it complicates the API.

#### 🟡 MEDIUM — Journal feed row (describeJournalEvent icon + text + meta + date) is implemented three times; changelog's FeedRow is the shared component that never got shared

<sub>`factorization-4` · effort: small</sub>

**Where:** `app/project/[id]/changelog/page.tsx:138-176`, `app/project/[id]/history/page.tsx:98-110`, `components/panels/NodeDetailPanel.tsx:452-465`, `components/overview/BacklogCard.tsx:29-41`, `app/project/[id]/changelog/page.tsx:117-132`

Three renderings of a journal event share identical markup: `<div className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm"><Icon className="size-3.5 shrink-0 text-muted-foreground mt-0.5"/><div className="flex-1 min-w-0"><p className="truncate">{text}</p>{meta && <p className="text-xs text-muted-foreground truncate">{meta}</p>}</div><span className="text-xs text-muted-foreground shrink-0">{formatEventDate(ts)}</span></div>` — changelog's FeedRow (a superset with trailing/onOpen), the history page's inline map body, and NodeDetailPanel's HistorySection. Separately, BacklogCard.tsx:29-41 and changelog's BacklogList:117-132 near-duplicate the idea/request row (same LightbulbIcon/MessageSquareTextIcon ternary, same "Idea"/"Request" trailing label).

**Recommendation:** Move FeedRow (with its optional trailing/onOpen props) into components/journal/ beside describe-event.tsx and use it from all three sites; a `BacklogItemRow` in the same module absorbs the BacklogCard/BacklogList pair. describe-event.tsx already centralizes the hard part — only the row markup is forked.

#### 🟡 MEDIUM — Two competing species icon/label vocabularies, including two different constants both named SPECIES_ICONS

<sub>`factorization-5` · effort: medium</sub>

**Where:** `components/graph/nodes/node-styles.ts:61-68`, `components/overview/InventoryCard.tsx:12-28`, `components/layout/ProjectSidebar.tsx:66-71`, `components/layout/CommandPalette.tsx:53-58`

node-styles.ts exports `SPECIES_ICONS` (flow: Network, view: MonitorSmartphone, api-endpoint: Plug) used by 4 components. InventoryCard.tsx:12 declares a *different* private `SPECIES_ICONS: Record<SpeciesId, LucideIcon>` (flow: GitBranchIcon, view: MonitorIcon, api-endpoint: ServerIcon) with a comment admitting it mirrors "the sidebar's species icon vocabulary (ProjectSidebar LIBRARY_ITEMS)"; ProjectSidebar.tsx:66-71 and CommandPalette.tsx:53-58 each re-declare that same nav vocabulary inline. InventoryCard also re-declares SPECIES_PLURALS labels ("Views", "Data Models"...) that ProjectSidebar LIBRARY_ITEMS and DeliveryFilterBar SPECIES_OPTIONS spell out again. An importer seeing `SPECIES_ICONS[...]` cannot tell which glyph set they get, and adding a species (decisions was added recently) requires finding all four maps.

**Recommendation:** Create one module (e.g. lib/config/species-icons.ts) exporting both vocabularies under distinct names — `SPECIES_GRAPH_ICONS` and `SPECIES_NAV_ICONS` — plus a plural-label map, and have InventoryCard, ProjectSidebar, CommandPalette's species entries, and DeliveryFilterBar's labels read from it. Rename the node-styles export accordingly (or re-export).

#### 🟡 MEDIUM — Platform multi-select toggle is built three different ways in three forms — same behavior, three drifting visuals

<sub>`factorization-6` · effort: small</sub>

**Where:** `components/panels/NewNodeForm.tsx:278-303`, `components/settings/ProductFormDialog.tsx:173-198`, `components/generate/PromptBuilderForm.tsx:79-100`

Each form maps PLATFORMS to aria-pressed toggle <button>s that add/remove a PlatformId from an array, but with three unrelated selected-state treatments: NewNodeForm renders `rounded-full ... bg-muted text-foreground` pills with a PLATFORM_DOT_STYLES colored dot; ProductFormDialog renders `rounded-md border ... border-primary bg-primary/10`; PromptBuilderForm renders `rounded-full ... bg-primary text-primary-foreground`. The toggle handler is also re-written in each (handlePlatformToggle in NewNodeForm:157-161 and PromptBuilderForm:50-56, inline setPlatforms in ProductFormDialog:181-187).

**Recommendation:** Extract a `<PlatformToggleGroup value={PlatformId[]} onChange options?={PlatformId[]}>` (options for NewNodeForm's product-constrained menu, a minLength guard for PromptBuilderForm's non-empty rule) and pick one visual treatment. Three real call sites, identical semantics — the drift is accidental, not intentional.

#### 🟢 LOW — Full-page loading placeholder duplicated verbatim in 10 project pages

<sub>`factorization-7` · effort: small</sub>

**Where:** `app/project/[id]/library/page.tsx:436-442`, `app/project/[id]/delivery/page.tsx:154-160`, `app/project/[id]/overview/page.tsx:146-150`, `app/project/[id]/acceptances/page.tsx:152-156`, `app/project/[id]/changelog/page.tsx:232-238`, `app/project/[id]/pyramid/page.tsx:108-114`, `app/project/[id]/decisions/page.tsx:76-80`, `app/project/[id]/history/page.tsx:43-49`, `app/project/[id]/maps/page.tsx:103-107`, `app/project/[id]/maps/[mapId]/page.tsx:29-35`

`if (...Loading) { return (<div className="h-full w-full flex items-center justify-center"><span className="text-muted-foreground text-sm">Loading X...</span></div>); }` appears identically (only the label differs) in 10 pages. Any change — a skeleton, a spinner, keeping the PageShell header mounted during load — is a 10-file edit today.

**Recommendation:** Extract `<PageLoading label="library" />` in components/layout/ and replace the 10 blocks. If the team ever wants the header to persist during loading, this is the single place to do it.

#### 🟢 LOW — DataModelNode and ApiEndpointNode are byte-identical except icon, border color, and fallback label

<sub>`factorization-8` · effort: small</sub>

**Where:** `components/graph/nodes/DataModelNode.tsx:11-38`, `components/graph/nodes/ApiEndpointNode.tsx:11-38`

The two 39-line files differ only in: `Database` vs `Plug` icon, `border-amber-500`/`text-amber-500` vs `border-teal-500`/`text-teal-500`, and `"Data Model"` vs `"API Endpoint"` fallback label. Every other line — handles, ghost classes, StatusBadge, memoization, comments — is identical. These colors are additionally re-stated in node-styles.ts SPECIES_MINIMAP_FILL comments (amber-500, teal-500), so the identity lives in three places.

**Recommendation:** Replace both with one `makeSystemLayerNode(icon, colorClasses, fallbackLabel)` factory (or a single component reading species from node data) in the same directory. Only 2 call sites, but the duplication is total and the "system layer card" concept is stable — a third parallel-layer species would otherwise mean a third copy-paste.

#### 🟢 LOW — Stale-platform-filter reset effect and scope arity logic duplicated between AcceptanceFilterBar and DeliveryFilterBar, comments included

<sub>`factorization-9` · effort: small</sub>

**Where:** `components/acceptances/AcceptanceFilterBar.tsx:36-55`, `components/delivery/DeliveryFilterBar.tsx:51-69`

Both bars repeat the same three-part block: `const scope = useEffectiveProduct(...); const showPlatformFilter = scope.isMultiPlatform; const platformOptions = useMemo(() => PLATFORMS.filter(p => scope.platforms.includes(p.id)), [scope]);` plus a useEffect resetting the platform filter to "all" when the control disappears — with the identical multi-sentence comment ("A stale platform filter must not outlive the control that could clear it... The early return makes this idempotent...") pasted in both files. A future fix to the reset rule must be found and applied twice.

**Recommendation:** Extract a `usePlatformFilterControl(projectId, project, value, onChange)` hook returning `{ showPlatformFilter, platformOptions }` and owning the reset effect; both bars keep their own rendering (Select vs toggle buttons), which genuinely differs. Do NOT attempt a shared FilterBar component — the four bars' contents (selects vs toggles vs segmented controls, debounced vs plain search) diverge too much for a shared shell to pay for itself beyond the one-line container div.

#### 🟢 LOW — Detail-panel section scaffold (px-6 column + micro-label heading) repeated ~10 times across the panel modules

<sub>`factorization-10` · effort: small</sub>

**Where:** `components/panels/NodeDetailPanel.tsx:331-332`, `components/panels/NodeDetailPanel.tsx:355-356`, `components/panels/NodeDetailPanel.tsx:394-395`, `components/panels/NodeDetailPanel.tsx:449-450`, `components/panels/NodeDetailPanel.tsx:528-529`, `components/panels/NodeDetailPanel.tsx:566-567`, `components/panels/AcceptancesSection.tsx:26-28`, `components/panels/PlaylistEditor.tsx:42-43`

Six sections inside NodeDetailPanel plus AcceptancesSection and PlaylistEditor each open with `<div|section className="px-6 flex flex-col gap-2|3"><span className="text-xs font-medium ... uppercase tracking-wide">Heading</span>...`. The gap drifts between gap-2 and gap-3 with no discernible intent, and AcceptancesSection adds a heading-row-with-action variant (justify-between + ghost Button) that any future section with an action will re-derive.

**Recommendation:** Extract `<PanelSection title action?={ReactNode}>` in components/panels/ and use it for the 8+ sections. This also gives one place to change panel gutter (px-6) when the panel stack layout evolves.

#### 🟢 LOW — Icon-inside-search-Input pattern duplicated 4 times with inconsistent icon positioning

<sub>`factorization-11` · effort: small</sub>

**Where:** `components/acceptances/AcceptanceFilterBar.tsx:99-108`, `components/delivery/DeliveryFilterBar.tsx:128-137`, `components/library/LibraryFilterBar.tsx:52-61`, `components/maps/MapEditorDialog.tsx:183-192`

The same shape — relative wrapper, `<SearchIcon className="pointer-events-none absolute ..." />`, `<Input className="pl-8" aria-label=... />` — is rebuilt at 4 sites, and the icon centering already drifted: AcceptanceFilterBar uses `left-2.5 top-1/2 -translate-y-1/2` while the other three hardcode `left-2 top-2.5`, which only centers for the current Input height.

**Recommendation:** Extract `<SearchInput value onChange placeholder aria-label className? />` (or an `icon` slot on the existing components/ui/input.tsx) and use it at the 4 sites, standardizing on the translate-y centering so a future Input height change cannot misalign three of them.

#### 🟢 LOW — useParams project-id unwrapping boilerplate repeated in 13 client files

<sub>`factorization-12` · effort: small</sub>

**Where:** `app/project/[id]/library/page.tsx:160`, `app/project/[id]/delivery/page.tsx:51`, `app/project/[id]/overview/page.tsx:44`, `app/project/[id]/acceptances/page.tsx:25`, `app/project/[id]/changelog/page.tsx:184`, `app/project/[id]/pyramid/page.tsx:43`, `app/project/[id]/decisions/page.tsx:25`, `app/project/[id]/history/page.tsx:28`, `app/project/[id]/maps/page.tsx:24`, `app/project/[id]/maps/[mapId]/page.tsx:19-20`, `app/project/[id]/settings/page.tsx:32`, `app/project/[id]/layout.tsx:50`, `components/panels/ProjectPanels.tsx:94`

`const params = useParams(); const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";` is pasted into every project page, the project layout, and ProjectPanels (13 occurrences; maps/[mapId] repeats it a second time for mapId). The `?? ""` fallback silently feeds an empty project id into useNodes/useProject at every site.

**Recommendation:** Add a `useProjectId()` hook (lib/hooks) wrapping the unwrap, and a `useRouteParam(name)` for the mapId case. One-line call sites, and a single place to decide what an absent id should actually do.


### shadcn/ui usage

Scope: `components/ui/*` fidelity to upstream shadcn and feature-code bypasses of the primitives. Core primitives closely track modern upstream and adoption is thorough (zero native `<select>`, 51 Button importers); the gaps are four missing primitives whose absence is actively producing drift, plus two old-vintage copies. Tracked with the factorization work in issue [#363](https://github.com/alexisbohns/arkaik/issues/363).

#### 🟡 MEDIUM — DialogContent's hard-wired close button forces raw Radix bypass and selector hacks

<sub>`shadcn-1` · effort: small</sub>

**Where:** `components/panels/ShotPreviewDialog.tsx:9`, `components/panels/ShotPreviewDialog.tsx:104-110`, `components/layout/CommandPalette.tsx:131`, `components/ui/dialog.tsx:47-71`

ui/dialog.tsx's DialogContent unconditionally renders its own DialogPrimitive.Close X (dialog.tsx:64-67). ShotPreviewDialog is the only feature file importing raw @radix-ui/react-dialog (line 9) and rebuilds DialogOverlay + DialogContent by hand (lines 104-110, copying the wrapper's class strings verbatim) so it can place its own close button in the sidebar header; CommandPalette instead hides the built-in button with the selector hack `[&>button]:hidden` (line 131), which is fragile — it hides any direct button child of the content, not specifically the close control.

**Recommendation:** Add the `showCloseButton?: boolean` prop that current upstream shadcn DialogContent ships. Then CommandPalette passes showCloseButton={false} instead of the selector hack, and ShotPreviewDialog can use the local DialogContent with className overrides (tailwind-merge already lets max-w-5xl beat max-w-lg), deleting the raw Radix import and the duplicated overlay/content class strings.

#### 🟡 MEDIUM — Hand-rolled tab strips carry ARIA tab roles with no tab keyboard behavior; no tabs.tsx primitive

<sub>`shadcn-2` · effort: medium</sub>

**Where:** `components/panels/PlatformVariants.tsx:138-163`, `components/panels/ShotPreviewDialog.tsx:175-198`

PlatformVariants.tsx:138 renders `<div role="tablist">` with `<button role="tab" aria-selected>` children (lines 146-160) but implements none of the WAI-ARIA tabs contract: no arrow-key navigation, no roving tabindex, no id/aria-controls linkage to the `role="tabpanel"` div at line 165. ShotPreviewDialog.tsx:175-198 duplicates the same strip with the same border-b-2 styling (its window-level ArrowLeft/Right handler cycles platforms-with-shots, not the tab list). Announcing tabs to assistive tech while every tab is a plain Tab-stop button is worse than no roles: screen-reader users are told arrow keys will work and they don't.

**Recommendation:** Add tabs.tsx (Radix @radix-ui/react-tabs via `npx shadcn add tabs`), which provides roving tabindex, arrow-key navigation, and tab/panel wiring for free, and replace both hand-rolled strips. If keeping them hand-rolled, drop the tab roles or implement the keyboard contract.

#### 🟡 MEDIUM — No Textarea primitive: 11 raw textareas across 5 files with three divergent style recipes

<sub>`shadcn-3` · effort: small</sub>

**Where:** `components/generate/PromptBuilderForm.tsx:70-76`, `components/panels/PlatformVariants.tsx:209-216`, `components/panels/DecisionEditor.tsx:197-204`, `components/panels/AcceptanceEditor.tsx:195-201`, `components/panels/RawBundlePanel.tsx:309`

There is no components/ui/textarea.tsx. PromptBuilderForm (6 textareas) and PlatformVariants repeat a hand-copied approximation of ui/input's classes (`border-input bg-transparent ... focus:ring-[3px] focus:ring-ring/50`) — note `focus:` where Input uses `focus-visible:`, and no shadow-xs/aria-invalid handling. DecisionEditor.tsx:203 and AcceptanceEditor.tsx:200 use a third, minimal recipe (`rounded-md border bg-background px-2 py-1.5 text-sm`) with no ring treatment at all, so multi-line fields focus visibly differently from every Input beside them.

**Recommendation:** Add the stock shadcn textarea.tsx (it shares Input's focus/invalid classes) and replace all 11 call sites; per-site rows/resize/font-mono stay as className overrides.

#### 🟡 MEDIUM — No Label primitive despite @radix-ui/react-label being installed; 50+ hand-rolled field labels, mostly unassociated

<sub>`shadcn-4` · effort: small</sub>

**Where:** `package.json:75`, `components/maps/MapEditorDialog.tsx:135`, `components/panels/AcceptanceEditor.tsx:194-201`, `components/panels/PlatformVariants.tsx:167`, `components/panels/NodeDetailPanel.tsx:395`

package.json:75 declares @radix-ui/react-label but no components/ui/label.tsx exists and nothing imports the package. The label style `text-xs font-medium uppercase tracking-wide text-muted-foreground` is hand-repeated 51 times across 25 files, sometimes as <label> without htmlFor (MapEditorDialog.tsx:135,140,149,162 — clicking the label does not focus the Input), sometimes as a plain <span> over a control with no accessible name at all: AcceptanceEditor.tsx:194-201's Gherkin textarea has no aria-label, no id, and its 'label' is an unassociated span, so screen readers announce an unnamed edit field.

**Recommendation:** Add label.tsx (the dependency is already installed) plus a small FieldLabel wrapper carrying the repo's uppercase style; associate every field via htmlFor/id, starting with the AcceptanceEditor gherkin textarea. Alternatively drop the unused @radix-ui/react-label dependency if you go with plain <label>.

#### 🟡 MEDIUM — No Checkbox primitive: 7 raw checkboxes with 4 different appearances

<sub>`shadcn-5` · effort: small</sub>

**Where:** `components/library/NodeTable.tsx:131-138`, `components/library/NodeCard.tsx:171-176`, `components/graph/DeleteConfirmDialog.tsx:46-52`, `components/settings/TokenManager.tsx:192-194`, `components/generate/PromptBuilderForm.tsx:244-248`

Four distinct recipes for the same control: `size-4 cursor-pointer accent-primary` (NodeTable.tsx:135, NodeCard.tsx:175), `h-4 w-4 rounded border-input accent-foreground` (DeleteConfirmDialog.tsx:51 — a different accent color than the library), `className="mt-1"` i.e. fully unstyled native (TokenManager.tsx:194, ignoring the theme entirely), and `rounded border-input` (PromptBuilderForm.tsx:248). None get the focus-visible ring every other interactive primitive in the app has.

**Recommendation:** Add shadcn checkbox.tsx (@radix-ui/react-checkbox) and converge the call sites. NodeTable's select-all can keep its indeterminate handling — Radix Checkbox supports checked="indeterminate" as a plain prop, removing the ref+effect workaround at NodeTable.tsx:115-123.

#### 🟡 MEDIUM — NodeSearchCombobox and MapEditorDialog hand-roll comboboxes with no keyboard or ARIA support

<sub>`shadcn-6` · effort: medium</sub>

**Where:** `components/panels/NodeSearchCombobox.tsx:118-164`, `components/maps/MapEditorDialog.tsx:182-211`

NodeSearchCombobox renders a raw <input> whose className (line 128) is a hand-copied variant of ui/input's classes, plus an absolutely-positioned results div (line 132) closed by a document-level mousedown listener (lines 64-73). It has no combobox semantics (no role, aria-expanded, aria-activedescendant) and no keyboard handling: ArrowDown/ArrowUp do nothing, Enter in the input does nothing, Escape does not close the list. MapEditorDialog's anchor search (lines 182-211) repeats the same input+dropdown shape with the same gaps. The repo demonstrably knows the right pattern — CommandPalette.tsx:290-312 implements the full combobox/listbox contract.

**Recommendation:** Extract one accessible combobox (either reuse CommandPalette's roles/keyboard plumbing or build on ui/popover with an anchored listbox) and use it in both places; at minimum use the Input primitive for the text field and add ArrowDown/ArrowUp/Enter/Escape handling with aria-activedescendant.

#### 🟡 MEDIUM — AcceptanceMatrix hand-builds its table instead of using ui/table

<sub>`shadcn-7` · effort: small</sub>

**Where:** `components/acceptances/AcceptanceMatrix.tsx:106-144`, `components/ui/table.tsx:5-15`

AcceptanceMatrix.tsx:106 renders raw `<table className="w-full text-sm">` with hand-styled thead/th/td (lines 107-143) while ui/table exists and is used by NodeTable for the same kind of node listing. The hand-rolled version loses Table's `overflow-x-auto` container (table.tsx:7) — a multi-platform matrix with several status columns overflows the page with no horizontal scroll — and re-derives row hover/border styling (`border-t hover:bg-muted/40`, line 123) that TableRow already standardizes.

**Recommendation:** Rebuild the group tables from Table/TableHeader/TableRow/TableHead/TableCell; keep the amber gap accent and clickable-row behavior as className/props on TableRow (NodeTable.tsx:165 already shows the pattern).

#### 🟢 LOW — Old-vintage tooltip.tsx forces per-call-site TooltipProvider, mounted per badge instance

<sub>`shadcn-8` · effort: small</sub>

**Where:** `components/ui/tooltip.tsx:7-9`, `components/values/ValueBadge.tsx:20`, `components/graph/edges/ComposeEdge.tsx:82`, `components/layout/StatusBadge.tsx:24`, `components/layout/StageIcon.tsx:18`

tooltip.tsx re-exports the raw Radix Provider/Root/Trigger (lines 7-9, old forwardRef vintage, no data-slot), so six components each wrap themselves in their own TooltipProvider delayDuration={300}: ValueBadge mounts one provider per badge instance (an acceptance matrix row with several values mounts several), and ComposeEdge.tsx:82 mounts one per action inside a .map. Per-instance providers defeat the Provider's purpose — shared skipDelayDuration grouping so adjacent tooltips open instantly once one is shown — and each adds a context layer.

**Recommendation:** Sync tooltip.tsx with current upstream shadcn, whose Tooltip root embeds its own TooltipProvider, then delete every per-call-site provider (the sidebar's app-level provider at sidebar.tsx:139 already covers grouping where it matters).

#### 🟢 LOW — Repeated aria-pressed toggle-chip pattern with no Toggle/ToggleGroup primitive

<sub>`shadcn-9` · effort: medium</sub>

**Where:** `components/panels/NewNodeForm.tsx:285-291`, `components/generate/PromptBuilderForm.tsx:84-90`, `components/values/ValuePicker.tsx:34-38`, `app/project/[id]/history/page.tsx:69-87`

Four surfaces hand-roll pill-shaped aria-pressed toggle buttons with diverging selected-state styling: NewNodeForm.tsx:290 and PromptBuilderForm.tsx:89 use rounded-full chips for platform multi-select, ValuePicker.tsx:38 uses `border-foreground bg-foreground text-background` chips, history/page.tsx:73-75 uses `bg-foreground text-background` filter pills. None have focus-visible styles (unlike Button/SegmentedControl). The repo already created ui/segmented-control.tsx for the exclusive-choice case but has nothing for multi-select toggles.

**Recommendation:** Add shadcn toggle.tsx/toggle-group.tsx (ToggleGroup type="multiple" covers the platform pickers) or extend SegmentedControl with a multiple mode, then converge the four call sites and inherit consistent focus rings.

#### 🟢 LOW — components/ui mixes two shadcn generations; sheet.tsx dropped upstream's close button leaving dead workarounds

<sub>`shadcn-10` · effort: medium</sub>

**Where:** `components/ui/sidebar.tsx:55`, `components/ui/sidebar.tsx:206`, `components/ui/sheet.tsx:46-77`, `components/ui/popover.tsx:10`, `components/ui/dropdown-menu.tsx:22`

Half the directory is current-generation shadcn (function components + data-slot: button, card, dialog, select, table, input, sheet, hover-card) while sidebar.tsx, tooltip.tsx, popover.tsx, separator.tsx, and dropdown-menu.tsx are the older forwardRef/no-data-slot vintage. Concrete drift artifact: sheet.tsx's SheetContent no longer renders upstream's built-in close X, yet sidebar.tsx:206 still carries upstream's `[&>button]:hidden` hack for hiding it — now dead CSS — and the mobile sheet sidebar consequently has no visible close affordance (only Escape/overlay dismiss).

**Recommendation:** Re-sync the old-vintage files from upstream (npx shadcn@latest add sidebar tooltip popover separator dropdown-menu) so future component adds diff cleanly; while touching sidebar.tsx remove the dead `[&>button]:hidden` or restore SheetContent's close button for the mobile sidebar.


### Duplication & redundancy

Scope: logic-level duplication repo-wide. The big invariants are single-sourced (mutation semantics, projections, id generation — all in `packages/schema` with every surface funneling through them, and generated artifacts drift-gated in CI). What remains is edge-duplication around the seams, some of it already drifted.

#### 🟡 MEDIUM — Journal event rendering duplicated between app and CLI — and already drifted (CLI misses decision.status_changed)

<sub>`duplication-1` · effort: medium</sub>

**Where:** `packages/cli/src/lib/render-event.ts:29-93`, `components/journal/describe-event.ts:76-180`, `components/journal/describe-event.ts:116-124`, `packages/cli/src/lib/render-event.ts:89-91`

render-event.ts's header says it is 'the terminal counterpart to the app's components/journal/describe-event.ts, mirroring its wording'. Both files carry the same ~13-case switch over event.type with near-identical wording, the same str() helper, the same title/resolveTitle id-to-title resolver, the same forward-compatible default branch, and a duplicated formatEventDate. The mirror has already drifted: describe-event.ts handles 'decision.status_changed' (lines 116-124), render-event.ts has no such case, so `arkaik log` prints the raw string 'decision.status_changed' via its default branch for every decision transition — decisions were added in cycle 2 and the CLI copy was never updated.

**Recommendation:** Move a zod-free core renderer into @arkaik/schema (which both already depend on): renderEventText(event, nodesById, labelMaps?) returning {text, meta}. The CLI passes no label maps (raw ids, as today); the app wraps it with its lucide icon table and lib/config label maps. That single switch fixes the decision.status_changed gap in the CLI for free and makes the next event type a one-place change.

#### 🟡 MEDIUM — Hosted-remote plumbing (link file, base-URL precedence, HTTP failure messages) re-implemented across CLI commands and the MCP package

<sub>`duplication-2` · effort: medium</sub>

**Where:** `packages/cli/src/commands/link.ts:24-25`, `packages/cli/src/commands/restore.ts:104-108`, `packages/cli/src/commands/restore.ts:358-378`, `packages/cli/src/commands/push.ts:57`, `packages/mcp/src/config.ts:14-37`, `packages/mcp/src/config.ts:94`, `packages/cli/src/commands/link.ts:150-159`, `packages/cli/src/commands/restore.ts:208-213`, `packages/mcp/src/remote-store.ts:181-187`

The constant 'docs/arkaik/arkaik.json' is defined 3 times (link.ts:24, restore.ts:104, mcp/config.ts:14) and 'https://arkaik.app' 4 times (link.ts:25, restore.ts:108, push.ts:57, mcp/config.ts:17). restore.ts:358-369 hand-parses the link file that mcp/config.ts readLinkFile already parses, and restore.ts:378's precedence chain (apiBase ?? env.ARKAIK_URL ?? link.remote ?? default) carries a comment (lines 370-377) explicitly saying it is 'the same order packages/mcp/src/config.ts's resolveRemoteConfig uses'. Three near-identical describeFailure functions map 401/403/404 to messages — link.ts:150-159 and restore.ts:208-213 share byte-identical 401 and 404 strings. This is intra-CLI duplication (link vs restore vs push share a package with a lib/ directory), and the MCP already imports CLI code via the 'arkaik/io' export seam (packages/mcp/src/store.ts:20), so the cross-package copy is not forced either.

**Recommendation:** Add packages/cli/src/lib/link-file.ts exporting LINK_FILE, DEFAULT_BASE_URL, readLinkFile, resolveBaseUrl(apiBase, env, link), and describeHttpFailure(status, baseUrl, projectId?); use it from link.ts, restore.ts, and push.ts. Export it through packages/cli/src/io.ts so packages/mcp/src/config.ts consumes the same implementation instead of its own copy.

#### 🟡 MEDIUM — The parse → migrate → validate inbound-bundle gate is implemented twice (client export.ts and server store.ts), with its load-bearing subtlety repeated in comments

<sub>`duplication-3` · effort: small</sub>

**Where:** `lib/utils/export.ts:72-95`, `lib/services/graph/store.ts:153-165`

parseAndValidateBundle (export.ts) and validateInboundBundle (store.ts) run the identical pipeline: parseBundle → migrateStatusVocabulary(raw input, deliberately not parsed.data) → validateBundle, differing only in output shape (thrown formatted message vs findings array). Each carries the same two fragile invariants in prose: 'Migrate the raw input rather than parsed.data so fields the zod schema does not model survive verbatim' (export.ts:81-82, store.ts:161-162) and 'the gate order is the same one every server load path uses ... and it is load-bearing' (export.ts:63-70). export.ts even names store.ts as its mirror. If one side ever reorders migrate/validate or switches to parsed.data, client-side import and hosted import silently diverge on the same file.

**Recommendation:** Move the pipeline into @arkaik/schema as gateInboundBundle(input): { ok: true; bundle } | { ok: false; findings } (parseBundle, migrateStatusVocabulary and validateBundle already live there). store.ts uses the findings directly; export.ts keeps its formatIssuePath/joinReported presentation over the returned findings.

#### 🟡 MEDIUM — journal.jsonl sidecar-fold logic duplicated between the standalone validator and the CLI — and the two validators already disagree on legacy-status bundles

<sub>`duplication-4` · effort: small</sub>

**Where:** `packages/schema/src/cli/validate-bundle-cli.ts:58-72`, `packages/cli/src/lib/bundle-validate.ts:47-73`, `packages/cli/src/lib/bundle-io.ts:24-38`, `packages/schema/src/validate.ts:210-212`

bundle-validate.ts's header says it 'Mirrors packages/schema/src/cli/validate-bundle-cli.ts': both implement the same ~15-line fold (missing-keys check, sidecar discovery via join(dirname(path), 'journal.jsonl'), parseJournalLines, sidecarFindings/sidecarLoaded bookkeeping) with a third JOURNAL_SIDECAR constant re-declared (bundle-validate.ts:25 mirrors journal-io.ts:14). The copies have a behavioral divergence today: `arkaik validate` reads through readBundle (bundle-io.ts:37), which runs migrateStatusVocabulary, while validate-bundle-cli.ts parses raw JSON and validates unmigrated — and validateBundle errors on any status outside the current vocabulary (validate.ts:210-212). A pre-v3 bundle carrying 'prioritized'/'blocked' therefore passes `arkaik validate` but fails `node validate-bundle.js` — two tools documented as the same gate returning opposite verdicts.

**Recommendation:** Extract a pure foldJournalSidecar(loose, readSidecarText) into @arkaik/schema (parseJournalLines already lives there; the fs read stays with each caller since the standalone build must remain zero-dep). Then decide the migration question once — either both migrate before validating or neither does — and encode it in the shared function so the two validators cannot disagree.

#### 🟢 LOW — collectReferencedNodeIds re-implements @arkaik/schema's collectPlaylistNodeRefs

<sub>`duplication-5` · effort: small</sub>

**Where:** `lib/utils/graph-build.ts:44-70`, `packages/schema/src/playlist.ts:50-68`, `components/maps/JourneyMap.tsx:184`

graph-build.ts's collectReferencedNodeIds walks the playlist entry tree (view_id / flow_id, recursing through condition if_true/if_false and junction cases) exactly as schema's collectPlaylistNodeRefs does — ~25 near-identical lines, same output semantics (order-preserving, duplicates kept). The schema copy is additionally defensive (null-entry and `?? []` guards). lib/ already imports @arkaik/schema at runtime in sibling modules (lib/utils/journal.ts re-exports projections; lib/utils/system-graph.ts imports computeMapSubgraph), so the dependency boundary is not a reason. Consumers: graph-build itself plus three call sites in JourneyMap.tsx.

**Recommendation:** Delete the copy and re-export collectPlaylistNodeRefs from graph-build.ts (aliased as collectReferencedNodeIds to keep the four call sites untouched), inheriting the schema version's defensive guards.

#### 🟢 LOW — lib/config vocabulary mirrors (STATUSES, SPECIES, EDGE_TYPES, DECISION_STATUSES) restate schema id lists with subset-only type checking

<sub>`duplication-6` · effort: small</sub>

**Where:** `lib/config/statuses.ts:3-23`, `lib/config/species.ts:3-15`, `lib/config/edge-types.ts:3-13`, `lib/config/decision-statuses.ts:3-10`, `lib/config/values.ts:100-113`

These arrays re-list every id from @arkaik/schema's ids.ts with `as const satisfies readonly { id: StatusId; ... }[]`, which only checks that listed ids are valid — a status added to schema's STATUS_IDS produces no compile error here. STATUS_ORDER (statuses.ts:21-23) is Object.fromEntries cast to Record<StatusId, number>, hiding the missing key; STATUS_ORDER[newStatus] would then be undefined, breaking compareStatusesBySeverity/weakerStatus in lib/utils/platform-status.ts with NaN comparisons. The vocabulary has changed before (the v3 prioritized/blocked migration), so this drift path is not hypothetical. values.ts already demonstrates the safe pattern: VALUES derives by mapping over schema's VALUE_IDS with exhaustive Record<ValueId, string> label/icon maps, where a missing element IS a compile error (its own comment: 'tier derives from the schema's VALUE_TIERS so it can never drift').

**Recommendation:** Rebuild the four mirrors the way values.ts does: keep an exhaustive Record<StatusId, {label; order}> (or map over schema's STATUS_IDS so order derives from array position) and generate the array from the schema list, making a vocabulary addition a compile error instead of a silent gap.

#### 🟢 LOW — orderEvents' ts-then-id ordering rule re-implemented as sortEvents in bootstrap's journal-merge

<sub>`duplication-7` · effort: small</sub>

**Where:** `packages/cli/src/lib/bootstrap/journal-merge.ts:27-37`, `packages/schema/src/journal.ts:214-216`

journal-merge.ts:27 declares sortEvents gives 'the same total order @arkaik/schema's orderEvents gives' and re-implements the comparator. The stated reason is 'Zero imports, by design, so it can be require()d directly in a test' (tests/cli/bootstrap-journal-merge.test.js loads the file standalone). The rest of the CLI package imports orderEvents from @arkaik/schema (commands/log.ts:15, commands/release.ts:22), so if the tiebreak rule ever changes in schema, bootstrap's merge silently orders differently from arkaik log/release over the same journal.

**Recommendation:** Either accept a schema import in journal-merge.ts (the test loader can resolve the workspace, as other CLI tests do after `npm run build -w arkaik`), or add a parity test asserting sortEvents and orderEvents produce identical orderings over a shared fixture so drift fails loudly.

#### 🟢 LOW — Mutations route hand-mirrors the MutationOp union's op names in VALID_OPS

<sub>`duplication-8` · effort: small</sub>

**Where:** `app/api/graph/projects/[projectId]/mutations/route.ts:30-37`, `packages/schema/src/mutate.ts:38-44`

The route defines `const VALID_OPS = new Set(['create_node', ..., 'delete_edge'])` with the comment 'Ops accepted here, mirroring @arkaik/schema's MutationOp union.' MutationOp is a type-only union — schema exports no runtime list of op names — so adding a seventh op to applyOps means the hosted route 400s it as invalid_ops until someone remembers this Set, while the local provider and MCP file store (which call applyOps directly) accept it. The three write paths are otherwise deliberately unified through applyOps.

**Recommendation:** Export `MUTATION_OP_NAMES = ['create_node', ...] as const` from packages/schema/src/mutate.ts, derive MutationOp's `op` field (and the route's Set) from it, so a new op reaches all writers together.

#### 🟢 LOW — Three separately maintained JSON value-equality implementations (valueEqual, deepEqualIgnoringKeyOrder, canonicalJson)

<sub>`duplication-9` · effort: medium</sub>

**Where:** `packages/schema/src/derive.ts:113-115`, `lib/services/graph/restore.ts:376-404`, `packages/cli/src/lib/bootstrap/journal-merge.ts:60-71`

The repo answers 'are these two JSON-shaped values the same?' three ways: derive.ts's valueEqual (JSON.stringify equality, key-order-sensitive), restore.ts's deepEqualIgnoringKeyOrder (key-order-insensitive, depth-capped at 64 after a coordinator-review RangeError finding, with a documented undefined-key rule), and journal-merge.ts's canonicalJson (key-order-insensitive via sorted-key serialization, with its own undefined-handling bug history documented at lines 46-58). The latter two solve the identical problem — comparing a stored/round-tripped event or node against a freshly built one — and each has independently accumulated (and independently fixed) the same class of edge-case bugs; canonicalJson has no depth cap, so the pathological-nesting concern restore.ts fixed still applies to bootstrap merges of hand-edited bundles.

**Recommendation:** Ship one zod-free jsonDeepEqual (key-order-insensitive, depth-capped) in @arkaik/schema and use it from both lib/services/graph/restore.ts and journal-merge's divergence check; keep valueEqual only where key-order sensitivity is genuinely wanted (derive.ts diffs metadata per key, so it likely is fine).

#### 🟢 LOW — Entity-limit comparison still inlined in createProject/applyMutation despite checkHostedEntityLimit existing for exactly this

<sub>`duplication-10` · effort: small</sub>

**Where:** `lib/services/graph/store.ts:367-370`, `lib/services/graph/store.ts:544-546`, `lib/services/graph/restore.ts:526-539`

checkHostedEntityLimit's own doc comment (restore.ts:533-535) says it 'Mirrors the `count > limits.entities` check already inline in createProject/applyMutation in store.ts — Task 11 should call this instead of re-deriving the same comparison a third time.' replaceProjectBundle was converted (store.ts:700), but createProject (store.ts:368-370) and applyMutation (store.ts:544-546) still inline `entityCount(...) > limits.entities` with hand-built limit-failure objects, so the tier-cap rule now lives in two forms; the inline form also still exposes `limit: Infinity` for an uncapped tier — the exact serialization hazard checkHostedEntityLimit was built to normalize away (its `limit: number | null` contract, restore.ts:499-510).

**Recommendation:** Finish the migration the comment requests: have createProject and applyMutation call checkHostedEntityLimit (its `actual` already equals entityCount) and build the limit failure from its normalized result.

#### 🟢 LOW — coveringAcceptances is a verbatim copy of schema's acceptancesCovering, pinned by a hand-maintained test loader

<sub>`duplication-11` · effort: small</sub>

**Where:** `lib/utils/platform-status.ts:85-102`, `packages/schema/src/acceptance.ts:74-86`, `tests/app/load-effective-status.js:15-27`

platform-status.ts:91-102 duplicates acceptance.ts:75-86 line-for-line, with a comment: 'Mirrors @arkaik/schema's acceptancesCovering — duplicated (not imported) to keep this module's @arkaik/schema imports type-only, so the effective-status test harness needn't build the schema package.' The constraint is real but self-imposed: tests/app/load-effective-status.js hand-transpiles a fixed four-module list and rewrites @/ specifiers, so any schema runtime import breaks it. Meanwhile sibling lib/utils modules (journal.ts, system-graph.ts, id.ts) import @arkaik/schema at runtime freely, so the app bundle carries the schema implementation anyway — the copy exists solely to serve the loader's module map. getNodePlatformStatuses (platform-status.ts:53-62) similarly restates acceptance.ts resolvePlatformStatus's override-?? -base rule.

**Recommendation:** Teach load-effective-status.js to map '@arkaik/schema' to the schema source (one more entry in MODULES/SPECIFIER_MAP, same transpile approach), then delete the copy and import acceptancesCovering. If the loader is judged not worth touching, add a comment in schema's acceptance.ts pointing back at the mirror so a change there knows to update both.


---

## What is healthy

An audit that only lists defects misrepresents this codebase. Things the auditors independently called out as genuinely strong:

### Workspace packages (schema, cli, mcp)

- The declared single-source-of-truth actually holds: the CLI binary, MCP server, standalone validator, published JSON Schema, skill schema doc, prompt fragments, and the Claude plugin are all mechanical builds of packages/schema/src (packages/cli/build.js, packages/mcp/build.js, scripts/generate/*), and app code consumes @arkaik/schema through a tsconfig path alias — no re-implemented validation or serialization logic was found in lib/, packages/cli, or packages/mcp.
- Version handling is exemplary: both published binaries substitute their version from package.json at build time via esbuild `define` (never a source literal), with regression tests (tests/cli/version.test.js, tests/mcp/version.test.js) after a real 0.2.0-reports-0.1.0 incident, and bin/files/prepublishOnly wiring is correct for both packages.
- Injectable seams are used consistently — HttpClient, clock, env, cwd, browser opener, fetchImpl — and every network command exports a standalone run* function, so the CLI/MCP test suites are hermetic and never touch the real network.
- restore.ts treats its one destructive verb with real care: mandatory client-side backup written via hard-link exclusivity (atomic + collision-proof), read back and re-parsed before the PUT, If-Match concurrency with a correct no-retry 412 message, and a history-loss guard with an explicit escape hatch.
- packages/mcp/src/protocol.ts tracks in-flight async tool calls and drains them on stdin close (so a request written just before close still gets its response), cleanly separates agent-actionable ToolErrors from protocol errors, and the shared applyOps mutation core in packages/schema/src/mutate.ts genuinely prevents app/MCP/hosted-store drift.

### Front-end application quality

- Documentation density with intent: nearly every non-obvious decision in the app layer records the rejected alternative and the failure it prevents (product-scope.ts, useProjectPanels.tsx, ProductManagerPanel.tsx), so drift is detectable by reading rather than archaeology.
- Pure-logic extraction is systematic: graph construction (journey-graph.ts), palette ranking (command-palette.ts), panel-stack transitions, and platform rollups are all React-free, testable modules with components reduced to thin bindings — explicitly motivated by 'no component in this repo can be exercised by a test'.
- Race conditions are handled where they were identified: app/projects/page.tsx uses request sequence refs for its two overlapping loaders, useSeedOnOpen latches the closed-to-open transition, and Library/useProjectPanels use render-phase state resets exactly as the React docs prescribe instead of effect-driven cascades.
- Type safety is genuinely clean in the app layer: zero `any`, `@ts-ignore`, or `as unknown as` in app/, components/ (non-ui), lib/hooks and lib/utils; the few non-null assertions are guarded by adjacent checks.
- Single-source-of-truth helpers are enforced, not just intended: productDisplayTitle, resolveEffectiveProductId, withProductMembership, withBlockedBy and platformAvailabilityShape each own one rule and are called from every surface, with comments naming the drift they prevent — and the degenerate-case guarantee (a project with no products looks byte-identical to pre-products) is consistently upheld across Library, panels, settings and maps.

### Server & API quality

- Webhook inbound security is exemplary: lib/services/github/verify.ts verifies the HMAC over the raw bytes before any parsing, uses timingSafeEqual, and fails closed (503) when GITHUB_WEBHOOK_SECRET is unset — the whole check is a small dependency-free module auditable in one read, and the route claims/releases a delivery ledger so retries are replay-safe without losing transitions.
- API token hygiene in lib/services/tokens.ts: only sha256(secret) is stored, verification is one indexed prefix lookup plus a constant-time compare, revocation is a tombstone, last_used_at writes are throttled in the WHERE clause, and minting/revocation are deliberately session-only so a leaked token cannot mint or widen itself.
- Authorization posture is uniform across the hosted graph store: every statement filters owner_id = any($1), another tenant's resource is indistinguishable from a missing one (404, never 403), and the four read routes share one guard chain via the graphReadRoute factory so the checks cannot drift.
- The hosted write path's concurrency story is genuinely careful: withTransaction + select … for update on every real write, BigInt version bumps, RFC-9110-correct If-Match classification (428/400/412 distinguished), and a dryRun toggle that fails closed on unrecognized tokens — with the destructive restore verb requiring If-Match with no wildcard escape.
- Graceful-absence configuration is done right end to end: every env read is lazy (auth.ts's lazy NextAuth config, getPool, appReadiness), the local-first build boots with zero service vars, servicesConfigured/servicesUnavailable live in one shared module, and the DB-free test harness (tests/services/*) transpiles the actual route handlers so guard behavior is pinned without a database.

### Documentation accuracy

- docs/graph-model.md is genuinely current and self-auditing: 6 species and all 8 edge types match packages/schema/src/ids.ts exactly, and its dated Taxonomy Update Checklist notes (2026-07-19, 2026-08-02, 2026-08-03) record precisely which steps shipped and which are deferred, with reasons.
- docs/spec/mcp.md's tool catalog matches packages/mcp/src/tools.ts one-for-one (all 14 tools, names and inputs), and its 'Known gap' box about get_map/list_maps ignoring MapDefinition.product is still an accurate description of the code — the spec admits its own gaps instead of papering over them.
- docs/spec/services.md's Publik and Synk protocol tables match the app/api route handlers method-for-method (including the server-enforced ?include_journal=true opt-in), and TIER_LIMITS in lib/services/limits.ts is a verbatim transcription of the spec's table, with a comment pointing back at it.
- docs/bootstrap.md and docs/hosted-projects.md, the newest surfaces, are accurate against the shipped CLI: bootstrap corpus/plan/slice/index/merge, init --update/--bootstrap/--remove-bootstrap, restore's If-Match/412/--dry-run/--allow-history-loss behavior, link/token resolution, and the ark_ token format all check out in packages/cli/src and lib/services.
- The docs system has strong structural hygiene: every spec carries an explicit Status header, superseded decisions are kept as decision records rather than silently rewritten (e.g. services.md's 'Boundary 1 no longer holds' box), and CI's generated-artifact drift gate keeps the schema-derived doc surfaces (skill schema.md, validator, plugin, prompt fragments) mechanically in sync with packages/schema.

### Component factorization

- The overview card family is genuinely well-factored: all 9 cards (BacklogCard, HealthCard, InventoryCard, MapsCard, ParityCard, PyramidCard, DeliverySnapshotCard, PlatformGaugesCard, ReleasePulseCard) render through one shared OverviewSection shell (components/overview/OverviewSection.tsx) that owns the card chrome, heading, and jump-off link.
- Product controls are exemplary reuse: ProductSelect (components/layout/ProductSelect.tsx) is the single select primitive behind both ProductScopeSelector and ProductOverrideSelector, and ProductPicker (components/panels/ProductPicker.tsx) is deliberately the one assignment control for all three forms, with documented reasoning about why forks were rejected.
- components/graph/nodes/node-styles.ts centralizes the status/platform/decision/ref icon, label, and color vocabularies as exhaustive Records, so StatusBadge, DecisionStatusBadge, rings, dots, and minimap fills cannot drift apart on color — new vocabulary entries fail the build until every surface has them.
- DeleteConfirmDialog is a real shared confirm dialog with 8 call sites across maps pages, settings, SystemMap, JourneyMap, and RawBundlePanel (title/description/confirmLabel/cascade props), so destructive confirmation UX is consistent app-wide — its only flaw is living under components/graph/ despite serving everyone.
- Page scaffolding composes cleanly: every project surface renders one PageShell (header + panel grid), filter bars pin via the shared StickyToolbar, and the SegmentedControl primitive serves both LibraryFilterBar and PyramidToolbar; domain cards (NodeCard, PlatformItemCard, PyramidElementCard) stay lean by composing shared primitives (SpeciesBadge, EntityId, PlatformList, PlatformAvailability, ValueBadge) instead of re-rolling them.

### shadcn/ui usage

- Core primitives (button, card, dialog, select, table, input, sheet, hover-card, breadcrumb) closely track current upstream shadcn: cva variants, data-slot attributes, cn() merging, asChild via Slot — components/ui/button.tsx is byte-for-byte modern upstream.
- Zero native <select> elements in the entire app and only one raw-Radix import outside components/ui — dropdowns, popovers, and menus consistently go through the local Select/DropdownMenu/Popover wrappers (17, 3, and 2 feature importers respectively).
- CommandPalette (components/layout/CommandPalette.tsx:290-312) implements the full WAI-ARIA combobox/listbox contract on top of the Dialog primitive — role=combobox, aria-activedescendant, roving highlight, Home/End/Tab-completion — a model for the app's other comboboxes.
- SegmentedControl (components/ui/segmented-control.tsx) is a well-designed repo-owned primitive: required ariaLabel prop, aria-pressed states, reused consistently across MapDisplayPopover and map toolbars instead of being re-rolled per surface.
- Button adoption is thorough (51 feature importers) with idiomatic asChild composition for links (app/projects/page.tsx:498), and NodeTable pairs the Table primitive with careful a11y: indeterminate select-all handling and disambiguated per-row aria-labels (components/library/NodeTable.tsx:115-138,171-181).

### Duplication & redundancy

- Generated-artifact discipline is excellent: the two validate-bundle.js copies, the plugin skill files, and the CLI's dist skill assets are all build outputs of one source (scripts/generate/build-validator.js esbuild-bundles packages/schema/src/cli/validate-bundle-cli.ts; generate-plugin.js copies byte-for-byte; packages/cli/build.js copies docs/arkaik-skill), and CI fails on drift via `git diff --exit-code` (.github/workflows/ci.yml:28) — the copies are provably identical, not hand-maintained.
- Mutation semantics live exactly once: packages/schema/src/mutate.ts applyOps is the single implementation of create/update/delete + cycle guard + composes synthesis + edge-id normalization, and its header documents that it was extracted precisely because the app and MCP had drifted; the Dexie provider (lib/data/local-provider.ts runOps), the MCP file store (packages/mcp/src/store.ts), and the hosted Postgres store (lib/services/graph/store.ts applyMutation) all funnel through it.
- Journal projections (computeNodeTimeline, computeChangelog, computeBacklog, computeDeliverables) are single-sourced in packages/schema/src/projections.ts; lib/utils/journal.ts is a pure re-export module, and the CLI's log/release and the MCP's tools.ts import the same functions — the ordering rule (orderEvents) is reused everywhere it matters.
- Deterministic id generation is single-sourced: SPECIES_PREFIXES, kebabCase, deriveNodeId and edgeId live in packages/schema/src/id-gen.ts; lib/utils/id.ts is a thin re-export, and applyOps re-normalizes edge ids at the seam so no writer can mint a divergent convention.
- The reuse seams between packages are deliberate and real: 'arkaik/io' exports the CLI's file IO for the MCP server to import verbatim (packages/cli/src/io.ts), the MCP Store interface makes local and hosted mode share one 14-tool catalog (packages/mcp/src/store.ts:82-102), and lib/services/graph/read-route.ts factors the four read routes' auth/guard chain into one higher-order handler.

---

## Appendix: method & verification

### How this audit ran

- **Finders:** seven parallel agents, one lens each (front-end quality, server/API quality, workspace packages, component factorization, shadcn usage, duplication, docs accuracy), each instructed to read whole files before flagging anything, cite `file:line` evidence, cap themselves at their ~12 strongest findings, and record healthy patterns as well as defects.
- **Adversarial verification:** the eight most severe findings (all six highs + two mediums) were each handed to an independent verifier agent whose brief was to *refute* the finding — re-read the cited code, re-run the repro against the built artifacts where applicable, and judge whether severity and recommendation were honest. Verdicts: 7 confirmed, 1 refuted (below). CLI/MCP repros for #357 and #358 were reproduced twice — once by the finder, once by the verifier — against the built `packages/cli/dist` and MCP server.
- **Totals:** 15 agents, ~1.9M tokens, 541 tool calls, ~37 minutes wall-clock.
- **Not covered:** findings below the top eight passed through *without* individual verification (spot-checks were applied to the claims used in umbrella issues #363/#364 — the `SPECIES_ICONS` duplication, textarea count, missing `label.tsx`, dead `synk` scope, and XFF rate-limit keying were all re-verified by hand). Postgres-dependent test suites could not be exercised in this environment. `docs/superpowers/` and `docs/rfcs/` were deliberately out of scope as dated archives.

### The refuted finding (disclosed for the record)

The finder claimed `useProject` in the project layout has no stale-response guard, so switching projects would briefly render the previous project's data (`lib/hooks/useProject.ts:12`, `app/project/[id]/layout.tsx:46`, `app/projects/page.tsx:206`). The verifier refuted the premise: in Next.js 16.2.0 the layout router keys each segment subtree by its dynamic-param value, so navigating `/project/a/*` → `/project/b/*` remounts the entire `[id]` subtree including the layout — the new `useProject` instance starts fresh at `loading=true`, and none of the claimed symptoms are reachable. Residual truth: the hook is *written* as if `id` could vary mid-mount, so a future consumer mounted above the `[id]` segment would hit the missing reset — a latent-robustness nit, not a bug. Recorded here so the pattern isn't "re-found" by a future audit.

### Issues filed

| Issue | Finding(s) |
| --- | --- |
| [#356](https://github.com/alexisbohns/arkaik/issues/356) | `quality-frontend-1` — playlist label editing |
| [#357](https://github.com/alexisbohns/arkaik/issues/357) | `quality-packages-1` — journal-less bundle trap |
| [#358](https://github.com/alexisbohns/arkaik/issues/358) | `quality-packages-2` — `release --compact` breaks validate |
| [#359](https://github.com/alexisbohns/arkaik/issues/359) | `docs-1` — species count wrong in every entry-point doc |
| [#360](https://github.com/alexisbohns/arkaik/issues/360) | `docs-2` — licensing docs backwards; no LICENSE in tarballs |
| [#361](https://github.com/alexisbohns/arkaik/issues/361) | `docs-3` — data-layer.md obsolete (+ `docs-5` architecture.md) |
| [#362](https://github.com/alexisbohns/arkaik/issues/362) | `quality-frontend-2` — swallowed load errors |
| [#363](https://github.com/alexisbohns/arkaik/issues/363) | umbrella: `factorization-1..12`, `shadcn-1..10` |
| [#364](https://github.com/alexisbohns/arkaik/issues/364) | umbrella: `quality-server-1..6` |

Pre-existing open issues #347–#355 (bootstrap/graph-model/MCP cluster, filed 2026-08-06) were checked for overlap before filing; none of the above duplicates them. Adjacent: `duplication-4` (the standalone validator and the CLI disagree on legacy-status bundles) is the same *shape* of problem as #347 (local vs hosted validator disagreement on JunctionCase) — a shared root-cause fix may cover both.
