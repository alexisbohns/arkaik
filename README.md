# Arkaik

> A product graph browser built with React Flow on Next.js. Map your product's anatomy — from user flows down to API endpoints — in one navigable, local-first graph.

## What is arkaik?

Existing tools silo product knowledge across Jira, Figma, Notion, dbdiagram, and Swagger. **arkaik** lets you traverse across all these layers fluidly — from a user flow down to the API payload it touches, or from a data model up to which screens render its data, across platforms.

It's not a task tracker, not a wiki, not a design tool. It's a navigable, multi-dimensional map of a product's full anatomy.

## Features

- **6-species graph** — flows, views, data models, API endpoints, acceptances, and decisions as first-class node types ([the taxonomy](docs/graph-model.md) is the source of truth)
- **Playlist composition** — flows contain ordered sequences of views and sub-flows, with condition and junction branching
- **Per-platform tracking** — Web, iOS, Android variants with independent statuses and notes per view
- **7 lifecycle statuses** — idea, discovery, backlog, development, releasing, live, archived — plus a `blocked_by` flag for nodes stalled by a dependency
- **Journal & changelog** — an append-only event log records how the graph changed; releases, timelines, and a backlog are derived from it
- **Local-first** — all data in your browser (IndexedDB), works offline, no account required; optional Synk backups with a free account
- **Publish & share** — Publik snapshots (`arkaik.app/p/{id}`) and full JSON import/export for backup, sharing, and self-hosting
- **Agent-native** — an `arkaik` CLI, an `arkaik-mcp` MCP server, a Claude Code plugin/skill for coding agents that maintain the map as a side effect of development, and machine-readable schema surfaces (`/llms.txt`)
- **Seed example** — ships with a "Pebbles" example project to explore immediately
- **⌘K palette** — jump to any map, library, board or setting by typing it, with Tab completion; the same palette searches the docs
- **Dark mode** — light/dark theme toggle

## Quick Start

```bash
git clone https://github.com/alexisbohns/arkaik.git
cd arkaik
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — create a project or load the seed example from the projects page.

## Folder Structure

```
app/
  layout.tsx                  # Root layout: fonts, theme, global CSS
  page.tsx                    # Home / landing page (signed in → /projects)
  projects/page.tsx           # Project list, create, import, seed, restore
  project/[id]/              # The project shell — page.tsx redirects to overview/
    overview/                 # Dashboard: coverage, gauges, release pulse, backlog
    maps/ + maps/[mapId]/     # Maps index and renderer (journey, system, custom)
    canvas/                   # Redirect to maps/journey — old links keep working
    library/                  # Filterable node browser (gallery + directory)
    delivery/                 # Board of (node × platform) items by status
    acceptances/              # Acceptance matrix
    decisions/                # Decision log
    pyramid/                  # Value-elements aggregation
    changelog/ + history/     # Releases + backlog, and the raw event log
    settings/                 # Project settings, products, linked repos
  settings/tokens/            # Account-level `ark_` API token management
  p/[id]/                     # Publik snapshot preview
  generate/                   # Prompt builder for LLM-assisted bundle generation
  api/                        # graph (hosted projects), tokens, publik, synk, auth,
                              #   github/webhook (acceptance promotion from PRs)
components/
  graph/
    Canvas.tsx                # React Flow wrapper + node/edge type registry
    nodes/                    # FlowNode, ViewNode, DataModelNode, ApiEndpointNode
    edges/                    # ComposeEdge, CrossLayerEdge, FloatingDottedEdge
  maps/                       # JourneyMap, SystemMap, map cards + editor dialog
  overview/ delivery/ acceptances/ decisions/ pyramid/ journal/ values/
  layout/                     # ProjectSidebar, ProjectSwitcher, CommandPalette, StatusBadge, etc.
  panels/                     # PanelStack, NodeDetailPanel, NewNodeForm, PlaylistEditor, etc.
  publik/ sync/ settings/     # Share dialog, Synk status, product/repo/token managers
  ui/                         # shadcn/ui primitives (button, card, dialog, etc.)
lib/
  config/                     # Label/order arrays for the ids in @arkaik/schema (see docs/conventions.md)
  data/                       # DataProvider interface + local (Dexie), remote, seed and routing providers
  hooks/                      # useNodes, useEdges, useProject, useJournal, etc.
  services/                   # Server-side: hosted graph store, publik, synk, github app
  utils/                      # export, layout, cycle detection, platform-status rollups
packages/
  schema/                     # @arkaik/schema — canonical zod model, validation, projections (MIT)
  cli/                        # arkaik — init, validate, log, release, deliverable, sync, pack,
                              #   open, push, link, restore, bootstrap (MIT)
  mcp/                        # arkaik-mcp — stdio MCP server over a bundle (MIT)
plugin/                       # Claude Code plugin: the agent skill + generated assets (MIT)
seed/
  pebbles.json                # Example project data
  arkaik-self-map.json        # Arkaik's own map — the built-in public seed project
docs/                         # Architecture, graph model, data layer, conventions, vision, specs
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| UI | React 19 |
| Graph canvas | React Flow (`@xyflow/react` 12) |
| Styling | Tailwind CSS 4 + shadcn/ui + CVA |
| Storage | IndexedDB via Dexie (local-first, the default); optional Postgres-backed services (Publik, Synk, hosted projects) |
| Schema | `@arkaik/schema` — canonical zod model, generated JSON Schema + validator |

## Documentation

See [`docs/`](docs/README.md) for detailed documentation:

- [Architecture](docs/architecture.md) — system design, component map, data flow
- [Graph Model](docs/graph-model.md) — **the taxonomy's source of truth**: species, composition, statuses, and edge types (including the decision-only `supersedes`, `generates`, `impacts`)
- [Data Layer](docs/data-layer.md) — DataProvider interface, local storage, import/export
- [Hosted Projects](docs/hosted-projects.md) — put a project in your account, point a coding agent at it, and let pull requests move acceptances
- [Bootstrap](docs/bootstrap.md) — onboarding an existing repo onto Arkaik in one run
- [Conventions](docs/conventions.md) — coding patterns, file organization, state management
- [Vision](docs/vision.md) — product strategy: the four layers (format, toolchain, app, services), the core product ("one graph, many maps"), modes & tiers, roadmap
- [Specs](docs/spec/bundle-format.md) — normative specifications: bundle format v2, event journal, toolchain, services, maps, MCP server
- [Contributing](CONTRIBUTING.md) — license split, how to submit changes

---

## Running Example: Pebbles

### Product: Pebbles

**Scenario:** Record a Pebble

- **Flow:** Create the record → Views: Set the time, Set the intensity
- **Flow:** Shape an emotion → Views: Open emotion wheel, Select primary, Refine secondary
- **Flow:** Relate souls → Views: Search contacts, Select soul, Confirm
- **Flow:** Add a card → Views: Choose card type, Write content, Attach

**Data Models:** `events` (pebble), `pearl`, `event_pearl`, `pearl_emotions`, `souls`, `event_souls`, `profiles`, `cards`, `event_cards`

**API Endpoints:**

- `GET /pebbles/:id` → Consolidated pebble (full relations)
- `GET /pebbles` → List of compact pebbles (lighter)
- `POST /pebbles` → Create a new pebble
- `PUT /pebbles/:id/emotions` → Attach emotions to a pebble

## Credits

arkaik is built on top of these great projects:

- [Next.js](https://github.com/vercel/next.js) — React framework with App Router, server components, and file-based routing
- [React Flow](https://github.com/xyflow/xyflow) — Interactive node-based graph library for React
- [shadcn/ui](https://github.com/shadcn-ui/ui) — Accessible, composable UI components built on Radix UI
- [Radix UI](https://github.com/radix-ui/primitives) — Unstyled, accessible component primitives
- [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) — Utility-first CSS framework
- [class-variance-authority](https://github.com/joe-bell/cva) — Type-safe component variant management
- [tailwind-merge](https://github.com/dcastil/tailwind-merge) — Merge Tailwind classes without style conflicts
- [Lucide](https://github.com/lucide-icons/lucide) — Icon library
- [next-themes](https://github.com/pacocoursey/next-themes) — Theme management for Next.js