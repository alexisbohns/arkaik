---
title: "Spec: Toolchain & Packaging"
navTitle: "Toolchain"
order: 3
icon: wrench
---

# Toolchain & Packaging

> Status: **Implemented** — `packages/schema` (`@arkaik/schema`), `packages/cli` (`arkaik`, with the `arkaik/io` subpath export), and `packages/mcp` (`arkaik-mcp`) are live workspace packages, with `arkaik` and `arkaik-mcp` published to npm (see [Releasing](#releasing) — publishing is manual); the skill ships as a Claude Code plugin (`plugin/`) with generated assets (now including `.mcp.json`), and `scripts/generate/` drift-checks every generated artifact in CI. The legacy copy-paste skill remains under `docs/arkaik-skill/`. This document remains the normative contract; the MCP server companion is specified in [mcp.md](mcp.md).
> The key words MUST, SHOULD, and MAY are to be interpreted as in RFC 2119.

## Why npm

The toolchain's audience is product repositories and their CI — the same channel Storybook, Changesets, shadcn, and husky ship through. `npx arkaik <command>` works with zero install, and a dev dependency pins the version per repo. A system package manager (brew) targets machine-global binaries and misses both the per-repo pinning and the CI story; it is not planned.

## Repository Layout

The arkaik repo becomes an npm workspace. **The Next.js app stays at the repository root** — the `/docs` site and LLM routes read `docs/` and `README.md` from `process.cwd()` (`lib/utils/docs.ts`, `app/llms-full.txt/route.ts`), and the Vercel project is bound to the root; moving the app buys nothing and risks both.

```
/                        # the Next.js app, unchanged (AGPL-3.0)
  package.json           # + "workspaces": ["packages/*"]
  packages/
    schema/              # @arkaik/schema (MIT)
    cli/                 # arkaik (MIT) — depends on @arkaik/schema; exports arkaik/io
    mcp/                 # arkaik-mcp (MIT) — the agent plane (mcp.md); depends on both
```

The app consumes `@arkaik/schema` via `transpilePackages` in `next.config.ts` and a path mapping in `tsconfig.json`; `lib/data/types.ts` becomes a re-export so its ~23 importers don't churn.

## `@arkaik/schema` — the Single Source of Truth

The bundle contract currently lives in five places that drift independently (`lib/data/types.ts`, `public/schema/project-bundle.json`, `docs/arkaik-skill/references/schema.md`, `docs/arkaik-skill/scripts/validate-bundle.js`, `lib/prompts/blocks.ts`). This package collapses them.

- **Canonical definition in code (zod):** the decisive reason is that the highest-value rules are *semantic graph rules* — duplicate IDs, dangling edge references, playlist↔composes coherence, flow cycles, species/edge-type semantics — which JSON Schema cannot express. A JSON-Schema-first pipeline would still need a hand-written semantic layer, leaving two sources of truth. Code is canonical; zod v4 generates the JSON Schema natively.
- **Exports:** inferred TS types, enum ID lists (species, statuses, platforms, edge types — `lib/config/*` keeps labels/order/colors and derives IDs from here), `parseBundle()` (shape) and `validateBundle()` (shape + semantic rules, structured errors with paths/line numbers).
- **Generated artifacts, committed, drift-checked in CI** (a regeneration diff fails the build):

| Artifact | Replaces |
|---|---|
| `public/schema/project-bundle.json` (v2, `$id` + version) | Hand-maintained JSON Schema |
| `validate-bundle.js` — esbuild-bundled, **zero-dependency**, runnable as `node validate-bundle.js <path>`, exit code 0/1 | Hand-written standalone validator |
| Schema reference fragment injected into the skill's `references/schema.md` | Hand-typed interface listings |
| Prompt generator schema/rules fragments (`lib/prompts/generated/`) | Hand-maintained `SCHEMA_BLOCK` and enum lists in `lib/prompts/blocks.ts` |

The standalone validator artifact remains a first-class contract: agents operating in repos without node_modules MUST be able to gate on it with nothing but Node. `arkaik validate` and the artifact are builds of the same source — both exist, neither drifts.

## `arkaik` — the CLI

| Command | Does | Phase |
|---|---|---|
| `arkaik init` | Scaffold `docs/arkaik/` (bundle, journal, assets dir), write `.gitattributes` union-merge rule, install the agent skill into the repo's skills directory, optionally add a CI step. `--update` upgrades a previous install | 3 |
| `arkaik validate [path]` | Shape + semantic + snapshot↔journal cross-checks ([journal.md](journal.md)); `--fix-format` rewrites to canonical serialization ([bundle-format.md](bundle-format.md)) | 3 |
| `arkaik log [--node <id>]` | Human-readable journal: project changelog or per-node timeline | 3 |
| `arkaik release <version> [--platform <p>]` | Append `release.tagged`, generate release-note draft from the slice since the last release, compact to `journal/archive-{version}.jsonl` | 3 |
| `arkaik sync` | Mirror external ref status (GitHub/GitLab/Linear APIs, tokens from env), update `external_status`/`synced_at`, append `ref.status_changed` events | 3 |
| `arkaik pack [--no-journal] [--no-quality] [--inline-assets]` | Produce a single-file interchange bundle: embed the journal, fold `docs/quality/` into the `quality` section, inline or upload assets | 3 |
| `arkaik open` | Validate, then hand off to arkaik.app import (packed bundle) | 3 |
| `arkaik push [--include-journal] [--include-quality]` | Publish to Publik / a synced account project from the terminal or CI; the journal and the `quality` section are stripped before packing unless opted in | 4 |
| `arkaik dev` | Local viewer over the repo's bundle, Storybook-style. **Not committed:** requires the app's `/project/[id]` routing to become static-export compatible first; decided on its own merits in Phase 3 | 3–4 (decision) |

**The `quality` section is folded at bundle-assembly time**, exactly as the journal is embedded there: `docs/quality/` is canonical in the repo and `bundle.quality` is only its interchange projection, so the verbs below produce one while assembling a bundle and nothing ever writes it back to `docs/arkaik/bundle.json` ([bundle-format.md](bundle-format.md) § Quality (Kritik)).

| Verb | Default | Flags |
|---|---|---|
| `arkaik pack` | folds | `--no-quality` **deletes** the section rather than merely declining to add one — a source bundle that already carried a hand-written `quality` key must not be packed with it either. `--audit <id>` pins one audit's snapshot instead of merging every audit into current state; an id that is not on disk is an error, not an empty section. `--root <dir>` says where `docs/quality/` lives; the default is derived from the *bundle's* own path, not the cwd, so packing `<repo>/docs/arkaik/bundle.json` folds `<repo>`'s audits whatever directory you run from |
| `arkaik open` | folds | none of its own — it packs through `runPack` and inherits every default above, quality section included, which is the point: what `open` hands the import picker is what the app will render |
| `arkaik push` | strips | `--include-quality` embeds the section and forwards `?include_quality=true`. Independent of `--include-journal` on purpose: publishing your history and publishing your open findings are two disclosures, not one, and both default to no ([RFC: Kritik](../rfcs/kritik.md) § 8.3) |
| `arkaik restore` | folds | `--no-quality`, `--audit <id>` and `--root <dir>` behave as on `pack`, plus `--allow-quality-loss`, required before a restore may erase a `quality` section the hosted project has and the outbound bundle does not. `--no-quality` deliberately does **not** imply it: "do not send mine" and "destroy theirs" are different decisions, and only the second is irreversible |

A repo with no audits, with audits but no `docs/quality/profile.json`, or with no resolvable criteria pack, is reported and skipped — never failed. Quality is additive to a bundle, and a half-installed Kritik must not break `arkaik pack`. The notice names the directory it searched (`Quality: none to fold …`), the profile it wanted (`Quality: skipped, no profile …`) or the pack it could not find (`Quality: skipped, no pack …`), because the ways to reach those lines are "not audited yet", "not installed yet" and "wrong `--root`", and the path tells them apart at a glance.

The notice goes to **stderr** for `pack`, `open` and `push`, so their stdout stays the bundle or the URL. `restore` prints it on **stdout** instead: that command's stdout is already the human report — backup path, delta, undo command — and the notice belongs beside them.

The fold only ever *sets* `quality`; it never clears one. So a bundle that arrives already carrying a section keeps it when the fold has nothing to project, and the notice says so on a second indented line. That is what lets `arkaik restore <backup-path>` put back the quality half of the state it is undoing; `--no-quality` is the posture that deletes instead.

**`arkaik restore --dry-run` cannot preview a guard that needs the hosted export.** A dry run asks the server what the restore *would* do and takes no backup, on purpose: nothing destructive happens, so there is nothing to protect against. But the backup and the guards read the same `GET .../export`, and a dry run never fetches it — so the history-loss, deletion and quality-loss refusals are all structurally invisible in preview, and a dry run that prints a clean delta can still be refused for real. This is a standing property of `--dry-run` rather than anything specific to quality: the guards live on the destructive path, which is the path they exist to protect.

## Skill Distribution

The agent skill graduates from copy-paste (`docs/arkaik-skill/`) to a managed asset:

| Property | Rule |
|---|---|
| Source | Lives in the arkaik repo (moving into `packages/cli` assets); its schema reference and validator are generated from `@arkaik/schema` |
| Install | `arkaik init` writes it as `SKILL.md` (uppercase — required for discovery) into the consuming repo's skills directory |
| Templating | The install is a render, not a copy: product name and bundle path are parameters (the current skill hardcodes Pebbles and `docs/arkaik/bundle.json`) |
| Versioning | A version stamp in the skill frontmatter lets `arkaik init --update` upgrade cleanly instead of blind-overwriting local edits |
| Skill v2 behavior | Dual-write per [journal.md](journal.md): surgical snapshot patches + appended events, validator as the hard gate — unchanged doctrine, new history duty |
| Second channel | A Claude Code plugin (marketplace-installable) packaging the same generated assets, for users who prefer plugin management over `npx` |

A second skill ships through the same marketplace: **`kritik`** (`plugin-kritik/`), the quality layer's audit + scoring skill ([RFC: Kritik](../rfcs/kritik.md) § 5). It follows every rule above — canonical source at `docs/kritik-skill/`, generated assets, `version` stamped into the manifest, CI drift gate over the whole directory — with two differences. It ships **unrendered with no template parameters at all**: everything project-specific lives in the `docs/quality/` sidecars its own scripts write, not in substituted prose. And it carries four zero-dependency scripts built from `packages/schema/src/cli/kritik-*.ts` (`compute-matrix.js`, `scaffold-criterion.js`, `init-profile.js`, `detect-regressions.js`), for the same reason the standalone validator exists: the gate has to run in a repo with no `node_modules`.

Those scripts are the *third* entry point to the same code, not a fourth implementation. `arkaik kritik <verb>` and the `kritik_*` MCP tools ([mcp.md](mcp.md) § Quality tools) call the same functions — `quality-ops.ts` for the operations, `cli/kritik-audit.ts` for the audit files, `cli/kritik-overlay.ts` for the overlay — so a score written by a person at a terminal, by an agent through MCP, and by a plugin script in a repo with no toolchain are the same write. The CLI and the MCP server each carry the criteria pack as a build asset beside their bundle (`dist/assets/kritik/library.json`), the way `arkaik init` carries the skill; a project that wants a pack version independent of whichever CLI it is running vendors one at `docs/quality/library.json`, which is checked first.

## Releasing

**Both packages are published by hand. Nothing in CI publishes** — there is no
release workflow and no `NPM_TOKEN`. That is a deliberate note rather than an
omission, because the absence has already cost twice:

- `arkaik` was never published at all, and *could not have been*: it declared
  `@arkaik/schema` — a private package — as a runtime `dependency`, so
  `npm i arkaik` would have failed to resolve it;
- `arkaik-mcp` on npm drifted twelve days behind `main` and silently lacked
  hosted mode entirely, so `npx -y arkaik-mcp` in a linked repo served a local
  bundle instead of the account project. The version had not been bumped either,
  so a publish would have been rejected as a duplicate;
- the Kritik CLI/MCP surface (#385) merged without a bump, and the **skill it
  shipped names `npx arkaik kritik`** — an instruction the registry could not
  yet satisfy. Caught the same day, but it shows the shape of the recurrence:
  the rule is easy to keep when a PR is *about* a package, and easy to miss when
  the package is one of six things the PR touches.

The rules that keep both from recurring:

| Rule | Why |
|---|---|
| `@arkaik/schema` is a **devDependency** of both packages, never a dependency | It is private and not on the registry; both builds esbuild-bundle it, so the published `dist/index.js` imports nothing but `node:` builtins. A runtime dependency on it is unresolvable for consumers |
| Bump the version in the same commit as the change that ships | npm refuses a duplicate version, so an unbumped package silently stays stale on the registry while `main` moves |
| Build explicitly before publishing | Both packages have `prepublishOnly`, but it does **not** run when `ignore-scripts=true` is set in the publisher's npm config — a common and otherwise sensible supply-chain setting. Do not rely on it |
| Verify from the registry, not the working tree | `npm pack <name>` the published tarball and check it contains what you expect. The stale-MCP failure was invisible from a local checkout |

```bash
npm run build -w arkaik && npm run build -w arkaik-mcp
npm publish -w arkaik
npm publish -w arkaik-mcp
npm view arkaik version && npm view arkaik-mcp version
```

One consequence worth stating, because it is the reason the bump matters beyond
tidiness: **the published CLI is a dependency of the agent skills.** The Kritik
skill tells an agent to try `npx arkaik kritik`, and the Arkaik skill's install
path is `npx arkaik init`. A stale registry does not merely lag — it makes the
prose we ship untrue, in a repo whose author has no way to know that.

A tag-triggered workflow with a granular automation token is the durable fix and
is not built; until it is, the checklist above is the process.

## Licensing

`packages/schema`, `packages/cli`, and the skill assets ship under **MIT**; the app and services remain **AGPL-3.0**. Rationale and timing in [vision.md](../vision.md) — the split executes with the Phase 1 package extraction, while the repository still has a single copyright holder.
