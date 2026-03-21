# arkaik

A product graph browser built with React Flow on Next.js. Map your product's anatomy — from user flows down to API endpoints — in one navigable, local-first graph.

<!-- TODO: Replace with actual screenshot -->
![Screenshot](docs/screenshot.png)

## What is arkaik?

Existing tools silo product knowledge across Jira, Figma, Notion, dbdiagram, and Swagger. **arkaik** lets you traverse across all these layers fluidly — from a user flow down to the API payload it touches, or from a data model up to which screens render its data, across platforms.

It's not a task tracker, not a wiki, not a design tool. It's a navigable, multi-dimensional map of a product's full anatomy.

## Features

- **4-species graph** — flows, views, data models, and API endpoints as first-class node types
- **Playlist composition** — flows contain ordered sequences of views and sub-flows, with condition and junction branching
- **Per-platform tracking** — Web, iOS, Android variants with independent statuses and notes per view
- **8 lifecycle statuses** — idea, backlog, prioritized, development, releasing, live, archived, blocked
- **Local-first** — all data in `localStorage`, works offline, no account required
- **JSON import/export** — full project bundles for backup, sharing, and self-hosting
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
  projects/page.tsx           # Project list, create, import, seed
  project/[id]/page.tsx       # Main graph canvas
components/
  graph/
    Canvas.tsx                # React Flow wrapper + node/edge type registry
    nodes/                    # FlowNode, ViewNode, DataModelNode, ApiEndpointNode
    edges/                    # ComposeEdge, CrossLayerEdge, FloatingDottedEdge
  layout/                     # Breadcrumb, StatusBadge, PlatformDots, StageIcon
  panels/                     # NodeDetailPanel, NewNodeForm, PlaylistEditor, etc.
  ui/                         # shadcn/ui primitives (button, card, dialog, etc.)
lib/
  config/                     # Typed const arrays: species, statuses, platforms, edge-types, stages
  data/                       # DataProvider interface + localStorage implementation
  hooks/                      # useNodes, useEdges, useProject, useGraphNavigation, etc.
  utils/                      # export, layout, cycle detection, platform-status rollups
seed/
  pebbles.json                # Example project data
docs/                         # Architecture, graph model, data layer, conventions, vision
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| UI | React 19 |
| Graph canvas | React Flow (`@xyflow/react` 12) |
| Styling | Tailwind CSS 4 + shadcn/ui + CVA |
| Storage | `localStorage` (Supabase planned) |

## Documentation

See [`docs/`](docs/README.md) for detailed documentation:

- [Architecture](docs/architecture.md) — system design, component map, data flow
- [Graph Model](docs/graph-model.md) — 4-species taxonomy, composition, statuses, edge types
- [Data Layer](docs/data-layer.md) — DataProvider interface, local storage, import/export
- [Conventions](docs/conventions.md) — coding patterns, file organization, state management
- [Vision](docs/vision.md) — full product vision and roadmap (8-level species model, semantic zoom, planned features)

## Migration Path

| **Phase** | **What** | **How** |
| --- | --- | --- |
| MVP (now) | Local-first, single user | `local-provider` with localStorage |
| Phase 2 | Supabase backend | Write `supabase-provider`, swap provider, add RLS on `project_id` |
| Phase 3 | Auth + profiles | Supabase Auth, `profiles` table, `project_members` join table |
| Phase 4 | Multi-tenant SaaS | Each user sees their projects, can create new ones |
| Open source | Self-hosted | Same repo, `local-provider` or self-hosted Supabase |

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