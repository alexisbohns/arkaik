## Summary

Part A of the bootstrap method (design: `docs/superpowers/specs/2026-08-04-bootstrap-method-design.md`) — the deterministic CLI surface that mines a repo and assembles agent-written fragments into a bundle. Judgment (the skill that actually drives an agent through a run) and hosted restore ship in later PRs; this PR is the commands and the tests that prove they compose.

**New `arkaik bootstrap` command group:**
- `corpus` — mines merged PRs (`gh`, or `--from-json`/`--from-git` for offline/no-GitHub-remote repos), design docs, and code surfaces into `.arkaik/corpus/`.
- `plan` — emits/updates a resumable work-unit manifest: only the wave-0 recon unit with no profile yet; waves 1–3 (anatomy, acceptances, story) once a recon agent writes `.arkaik/bootstrap/profile.json`. `--issues` is the alternate driver: files one GitHub issue per pending unit instead of running in-session.
- `slice <unit>` — prints exactly the corpus subset one work unit needs (path-prefix or era-date-window filtered), so an agent reads ~30–60KB instead of the whole mined corpus.
- `index [path]` — a compact id/species/title listing of the current map.
- `merge` — assembles every fragment named by the manifest onto the bundle: id uniqueness, cross-fragment edge resolution, the `node.created`/`node.status_changed`/`decision.status_changed` events the journal requires, validates the result, and only then writes.

**Golden end-to-end test** (`tests/cli/bootstrap-e2e.test.js`): a tiny fixture repo driven through the *whole* method — `corpus` → `plan` (recon-only) → a hand-written `profile.json` → `plan` again (waves expand) → `slice` a unit → hand-written fragments → `merge` → `arkaik validate`. Every other `bootstrap-*.test.js` file proves one command's own contract in isolation; this is the only one that proves the commands compose — asserting on node/edge counts, a cross-fragment edge resolving correctly, exactly one `node.created` per node, and a clean `arkaik validate` pass.

**Test wiring:** `npm run test:bootstrap` now runs all 10 bootstrap test files (482 checks: era-window, body-budget, event-id, journal-merge, corpus, plan, slice, merge, merge-selfmap, e2e), and CI runs it as its own step alongside the existing per-suite steps.

## A defect the end-to-end test found

The design spec's own mode table lists "no bundle at all" — not just an `arkaik init` stub — as a valid greenfield starting state, and `bootstrap merge`'s code already branched on it (fabricating an in-memory stub bundle when none exists on disk). But the write path never created the bundle's parent directory first. Every *existing* merge test pre-created `docs/arkaik/` by hand in its own fixture setup, so this had zero coverage until the e2e fixture — deliberately built with no pre-existing `docs/arkaik/`, exactly how a real first-ever bootstrap run starts — hit it immediately: the first `arkaik bootstrap merge` on a genuinely fresh repo crashed with a raw `ENOENT` instead of creating its own target.

Fixed in `packages/cli/src/commands/bootstrap.ts`: `runMerge` now `mkdirSync`s the bundle's directory before writing. While in there, both the bundle and its journal sidecar were also switched from a direct `writeFileSync` to a same-directory temp-file-plus-rename (`writeFileAtomic`), so a process killed mid-write can no longer leave either file truncated.

## Known limitation (flagged by Task 6, still open)

`runMerge` still performs the bundle write and the journal write as two separate operations. The rename fix above closes the *truncation* risk for each file individually, but the *pair* still isn't atomic: a process killed between the two writes leaves the bundle and journal out of sync with each other. Real for a long-running, multi-wave bootstrap; not fixed here — worth closing before this method is relied on for long, unattended runs, but not blocking for this PR.

## Test plan

- [x] `npm run test:bootstrap` — 482 checks, 0 failures
- [x] `npm run test:cli` — clean
- [x] `npm run lint` — 0 errors (4 pre-existing warnings, none in a touched file)
- [x] `npm run validate:seeds` — clean
- [x] `npx tsc --noEmit` — clean

## Lab Note

```yaml
en:
  title: "Map an existing codebase in one pass"
  summary: "Arkaik can now read a whole repository — its screens, its APIs, its merged pull requests — and turn it into a map, instead of you drawing every piece by hand."
fr:
  title: "Cartographie ton dépôt en une seule passe"
  summary: "Arkaik peut maintenant lire tout un dépôt — écrans, APIs, pull requests fusionnées — et en tirer la carte tout seul, plutôt que de te la faire dessiner morceau par morceau."
suggested:
  molecule: arkaik
  type: feature
  tags: [changelog]
```
