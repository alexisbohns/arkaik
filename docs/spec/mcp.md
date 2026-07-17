---
title: "Spec: MCP Server (Agent Plane)"
navTitle: "MCP Server"
order: 6
---

# MCP Server — the Agent Plane

> Status: **Implemented** — `packages/mcp` (`arkaik-mcp`), a dependency-free stdio server: the SDK caveat below resolved to its own fallback (the workspace's zod 4 vs the SDK's zod 3), so the server speaks newline-delimited JSON-RPC directly; the tool catalog is the contract, and adopting the SDK later changes plumbing, not behavior. File IO comes from the `arkaik/io` subpath export (§ Reuse Seams); the plugin ships the generated `plugin/.mcp.json`; `tests/mcp/run-mcp-tests.js` is the harness (§ Testing). This document remains the normative contract.
> The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as in RFC 2119.

## Purpose

The skill makes agents good *writers* of the map; the format makes them competent *readers*. What's missing is a **conversational surface**: an agent asked "what's blocked on iOS?" or "link this new endpoint to the checkout view" should not need to parse a 4,000-line JSON file into context or shell out to a CLI with flags. The MCP server exposes the map as **tools** — the same projections humans see as pages ([maps.md](maps.md), [journal.md](journal.md) § Projections), plus validated dual-write mutations.

This is the **audience-symmetry principle** (vision.md § Core Product) made concrete: every human surface has an agent-consumable twin, produced by the same `@arkaik/schema` functions.

## Packaging & Transport

| Decision | Detail |
|---|---|
| Package | New workspace package `packages/mcp`, npm name **`arkaik-mcp`** (unscoped, symmetric with `arkaik`), MIT — toolchain side of the license split |
| Bin / install story | `npx -y arkaik-mcp` is the whole setup; esbuild-bundled single file like the CLI |
| Transport | **stdio** (v1). The server is spawned per session by the agent host; no daemon, no port |
| Not a CLI subcommand | The `arkaik` CLI stays dependency-free; the MCP SDK would end that. The CLI usage text gains a pointer line; an `arkaik mcp` alias MAY wrap the package later |
| SDK note | `@modelcontextprotocol/sdk` was the default choice; its zod-3 pin against the workspace's zod 4 resolved this to the fallback, taken all the way: the server speaks newline-delimited JSON-RPC directly (`src/protocol.ts`, ~150 lines — `initialize`, `tools/list`, `tools/call`, `ping`) with raw JSON-Schema tool definitions whose enums come from `@arkaik/schema` ids. `@arkaik/schema` remains the only validation authority; the SDK MAY be adopted later without changing the tool catalog |

## Bundle Discovery (Kommit-first)

The server operates on the **repo bundle** — the Kommit mode where the map already lives next to the code, maintained as a side effect of development. Resolution order:

1. `--bundle <path>` argument
2. `ARKAIK_BUNDLE` environment variable
3. `docs/arkaik/bundle.json` under the current working directory

The journal is the sidecar resolved by the rules in [journal.md](journal.md) § Storage Shapes. The server MUST reload the bundle per tool call (files are small; external edits — a human, another agent, `git pull` — must be picked up).

## Tool Catalog (v1)

All tool results are JSON text content. Read tools are projections; write tools follow the Write Path below.

| Tool | Input | Returns | Journal events |
|---|---|---|---|
| `list_nodes` | `species?`, `status?`, `platform?`, `query?`, `limit?` | node summaries `{id, title, species, status, platforms}` | — |
| `get_node` | `node_id` | full node + edges with neighbor titles + where-used flows + `computeNodeTimeline` | — |
| `create_node` | `species`, `title`, `description?`, `status?`, `platforms`, `metadata?` | created node (id via `deriveNodeId`) + any synthesized `composes` edges | `node.created` (+ one `edge.added` per synthesized composes edge — see Playlist Composition) |
| `update_node` | `node_id`, `patch` | updated node + any synthesized `composes` edges | via `diffNodeUpdate`: `node.updated` / `node.status_changed` (± `platform`) / `ref.added` / `ref.removed` (+ `edge.added` per synthesized composes edge) |
| `delete_node` | `node_id` | removed node + cascaded edge ids | `node.deleted` (edge cascade implied per [journal.md](journal.md)) |
| `add_edge` | `source_id`, `target_id`, `edge_type` | created edge (id via `edgeId`) | `edge.added` |
| `remove_edge` | `edge_id` | ack | `edge.removed` |
| `propose_idea` | `title`, `description?`, `node_id?` | event | `idea.proposed` |
| `file_request` | `title`, `description?`, `source?`, `node_id?` | event | `request.filed` |
| `get_changelog` | `version?` | release list, or one `computeChangelog` slice | — |
| `get_backlog` | — | `computeBacklog` (open ideas & requests) | — |
| `list_maps` | — | built-in + stored `MapDefinition`s with node/edge counts | — |
| `get_map` | `map_id` | `computeMapSubgraph` result | — |
| `validate_bundle` | — | `validateBundle` findings (errors + warnings, with paths) | — |

`arkaik release` (tagging, note drafting, compaction) stays **CLI-only** in v1 — it is a ceremony with side effects beyond the bundle, owned by `packages/cli/src/commands/release.ts`.

## Write Path (dual-write, validator-gated)

Every mutating tool MUST follow, in order:

1. Load bundle + journal (fresh).
2. Apply the mutation **in memory** and derive the matching journal events (shared derivation — see Reuse Seams).
3. Run `validateBundle` on the mutated bundle with the new events folded in. **Any error → return the pathed findings and write nothing.** Warnings pass through in the tool result.
4. Persist: append each event to the journal sidecar (JSONL, one line per event, `actor: "arkaik-mcp"`), then rewrite the snapshot with `serializeBundle` (canonical form — clean git diffs).

This is the skill's dual-write doctrine ([journal.md](journal.md) § Authority) enforced structurally: an MCP mutation is *incapable* of the snapshot-without-history drift that free-form file edits invite.

### Playlist Composition (composes-edge synthesis)

A flow's playlist and its `composes` edges are two views of one relationship: the validator's `playlist-composes-coherence` rule requires a `composes` edge from a flow to every view/sub-flow its playlist references. Under the gate above this created a deadlock — a flow created with a populated playlist fails coherence because the edges don't exist yet, but `add_edge` cannot create them until the flow node exists, so no single call could produce a populated flow (issue #263).

`create_node` and `update_node` therefore **synthesize** the required edges: when the mutated node is a flow, they add a `composes` edge (flow → referenced node) for every playlist reference (recursing through `condition`/`junction` branches) that lacks one, fold those edges and their `edge.added` events into the *same* validated write, and return them in the tool result under `edges`. Edges that already exist are never duplicated; a reference to a missing node still fails the gate (nothing is written). This mirrors the app's own playlist editor, which adds the edge and the entry together. A populated flow is thus a single `create_node` call.

## Reuse Seams (two enabling moves)

1. **CLI file-IO becomes importable.** `packages/cli` exposes a subpath export `arkaik/io` (bundle read/write, journal sidecar IO, validation wrapper) built as a second esbuild entry. `packages/mcp` depends on `arkaik` and imports these verbatim — no drift between what the CLI and the MCP server consider "the bundle on disk". Filesystem code stays out of `@arkaik/schema`, which remains browser-safe.
2. **Dual-write derivation moves to the schema package.** `lib/data/emit-events.ts` is already pure; its core moves to `packages/schema/src/derive.ts` with the actor as a parameter. The app keeps a thin re-export binding `actor: "arkaik-app"`; the MCP server binds `"arkaik-mcp"`; the skill doctrine stays the human-readable statement of the same rules.

## Distribution

- **npm:** `npx -y arkaik-mcp` — zero-install for any MCP host.
- **Claude Code plugin:** the plugin gains a generated `plugin/.mcp.json` declaring the server (`command: "npx", args: ["-y", "arkaik-mcp"]`), emitted by `scripts/generate/generate-plugin.js` and covered by the CI drift check. Installing the plugin then delivers **skill + MCP together**: the doctrine and the tools, one install.

## Testing

`tests/mcp/run-mcp-tests.js` follows the CLI harness pattern: spawn the built server against a tmpdir fixture bundle + journal sidecar, speak JSON-RPC over stdio (`initialize`, `tools/list`, `tools/call`), and assert: read-tool shapes; a write round-trip (update → journal line appended → `validate_bundle` clean → snapshot canonical); and the gate (a mutation that would dangle an edge is refused with pathed findings and the files untouched).

## Non-Goals (v1)

- **Hosted MCP / REST over Synk projects.** The natural Klub-tier follow-up: the same tool catalog served over authenticated transport against account-backed projects, enforced on the existing `lib/services/limits.ts` seam. Requires a device-token auth flow (shared open question with `arkaik push --to synk`, [services.md](services.md)). Specified when scheduled — nothing in this document precludes it.
- **Multi-bundle workspaces** — one server instance, one bundle.
- **Release ceremony** — CLI-only, above.
