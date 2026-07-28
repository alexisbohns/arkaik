---
title: "Spec: Toolchain & Packaging"
navTitle: "Toolchain"
order: 3
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
| `arkaik pack [--no-journal] [--inline-assets]` | Produce a single-file interchange bundle: embed the journal, inline or upload assets | 3 |
| `arkaik open` | Validate, then hand off to arkaik.app import (packed bundle) | 3 |
| `arkaik push` | Publish to Publik / a synced account project from the terminal or CI | 4 |
| `arkaik dev` | Local viewer over the repo's bundle, Storybook-style. **Not committed:** requires the app's `/project/[id]` routing to become static-export compatible first; decided on its own merits in Phase 3 | 3–4 (decision) |

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
  so a publish would have been rejected as a duplicate.

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

A tag-triggered workflow with a granular automation token is the durable fix and
is not built; until it is, the checklist above is the process.

## Licensing

`packages/schema`, `packages/cli`, and the skill assets ship under **MIT**; the app and services remain **AGPL-3.0**. Rationale and timing in [vision.md](../vision.md) — the split executes with the Phase 1 package extraction, while the repository still has a single copyright holder.
