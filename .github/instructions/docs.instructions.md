---
description: "Use when creating or modifying documentation in docs/. Ensures docs stay concise, link to source code, and follow project standards."
applyTo: "docs/**"
---

# Documentation Standards

- Use H2 for major sections, H3 for subsections
- Link to source files using relative paths from repo root: `lib/config/species.ts`, `components/graph/Canvas.tsx`
- Keep docs actionable — explain what to do, not just what exists
- When adding a new doc file, add it to the index in `docs/README.md`
- Include "Config source" references when documenting taxonomies (species, statuses, platforms, edge types)
- Use tables for structured data (type fields, taxonomy values, component maps)
- Do not duplicate full source code — show signatures and key types, link to the file for implementation
