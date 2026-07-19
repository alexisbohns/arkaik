# Arkaik

> A product graph browser built with React Flow on Next.js. Map your product's anatomy — from user flows down to API endpoints — in one navigable, local-first graph.

## What is arkaik?

Existing tools silo product knowledge across Jira, Figma, Notion, dbdiagram, and Swagger. **arkaik** lets you traverse across all these layers fluidly — from a user flow down to the API payload it touches, or from a data model up to which screens render its data, across platforms.

It's not a task tracker, not a wiki, not a design tool. It's a navigable, multi-dimensional map of a product's full anatomy.

## Features

- **5-species graph** — flows, views, data models, API endpoints, and acceptances as first-class node types
- **Playlist composition** — flows contain ordered sequences of views and sub-flows, with condition and junction branching
- **Per-platform tracking** — Web, iOS, Android variants with independent statuses and notes per view
- **8 lifecycle statuses** — idea, backlog, prioritized, development, releasing, live, archived, blocked
- **Journal & changelog** — an append-only event log records how the graph changed; releases, timelines, and a backlog are derived from it
- **Local-first** — all data in your browser (IndexedDB), works offline, no account required; optional Synk backups with a free account
- **Publish & share** — Publik snapshots (`arkaik.app/p/{id}`) and full JSON import/export for backup, sharing, and self-hosting
- **Agent-native** — an `arkaik` CLI, a Claude Code plugin/skill for coding agents that maintain the map as a side effect of development, and machine-readable schema surfaces (`/llms.txt`)
- **Seed example** — ships with a "Pebbles" example project to explore immediately
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
  page.tsx                    # Home / landing page
  projects/page.tsx           # Project list, create, import, seed, restore
  project/[id]/canvas/        # Graph canvas (the Journey map)
  project/[id]/library/       # Filterable node browser
  project/[id]/changelog/     # Releases + backlog from the journal
  p/[id]/                     # Publik snapshot preview
  api/                        # Publik, Synk, and auth route handlers
components/
  graph/
    Canvas.tsx                # React Flow wrapper + node/edge type registry
    nodes/                    # FlowNode, ViewNode, DataModelNode, ApiEndpointNode
    edges/                    # ComposeEdge, CrossLayerEdge, FloatingDottedEdge
  layout/                     # ProjectSidebar, ProjectSwitcher, StatusBadge, etc.
  panels/                     # NodeDetailPanel, NewNodeForm, PlaylistEditor, etc.
  ui/                         # shadcn/ui primitives (button, card, dialog, etc.)
lib/
  config/                     # Typed const arrays: species, statuses, platforms, edge-types, stages
  data/                       # DataProvider interface + IndexedDB (Dexie) implementation
  hooks/                      # useNodes, useEdges, useProject, useJournal, etc.
  utils/                      # export, layout, cycle detection, platform-status rollups
packages/
  schema/                     # @arkaik/schema — canonical zod model, validation, projections (MIT)
  cli/                        # arkaik — init, validate, log, release, sync, pack, open, push (MIT)
plugin/                       # Claude Code plugin: the agent skill + generated assets (MIT)
seed/
  pebbles.json                # Example project data
docs/                         # Architecture, graph model, data layer, conventions, vision, specs
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| UI | React 19 |
| Graph canvas | React Flow (`@xyflow/react` 12) |
| Styling | Tailwind CSS 4 + shadcn/ui + CVA |
| Storage | IndexedDB via Dexie (local-first); optional Postgres-backed services (Publik, Synk) |
| Schema | `@arkaik/schema` — canonical zod model, generated JSON Schema + validator |

## Documentation

See [`docs/`](docs/README.md) for detailed documentation:

- [Architecture](docs/architecture.md) — system design, component map, data flow
- [Graph Model](docs/graph-model.md) — 5-species taxonomy, composition, statuses, edge types
- [Data Layer](docs/data-layer.md) — DataProvider interface, local storage, import/export
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