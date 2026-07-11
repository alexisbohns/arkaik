# Contributing to arkaik

## License

The entire repository is currently licensed under the **GNU Affero General Public License v3.0** (`LICENSE`), including the agent skill under `docs/arkaik-skill/` even though it's designed to be copied into other people's repos.

### Planned split

Per [`docs/vision.md` § Open Source Strategy](docs/vision.md#open-source-strategy), the license will split by layer:

- **MIT (or Apache-2.0):** the format, schema, validator, CLI, and skill — today that's `docs/arkaik-skill/`, `public/schema/`, and their future extraction into `packages/schema` and `packages/cli`. These are the toolchain's adoption channel, and copyleft would throttle exactly the growth they exist for.
- **AGPL-3.0 (unchanged):** the app (`arkaik.app`) and services. Self-hosting stays possible for everyone; a closed-source clone of the hosted app does not.

The split executes physically when `packages/schema` and `packages/cli` are extracted (Roadmap Phase 1) — until then, everything in this repo remains AGPL-3.0.

**By submitting a contribution, you agree it may be relicensed under the terms above once the split executes**, for whichever path(s) your contribution touches. This is what keeps the eventual split simple: recording it now, while the project has a single copyright holder, avoids having to track down every contributor's consent later.

## How to contribute

1. Branch off `main`. There's no enforced naming scheme yet — a short `type/description` name (e.g. `fix/rewrite-bundle-id`, `docs/contributing`) is fine.
2. Before opening a PR, run:
   ```bash
   npm run lint
   npm run build
   ```
3. If your change touches the bundle format or any seed/example data (`seed/pebbles.json`, `seed/arkaik-self-map.json`, `public/schema/example-bundle.json`), validate it:
   ```bash
   node docs/arkaik-skill/scripts/validate-bundle.js <path-to-bundle.json>
   ```
   (This isn't wired into CI yet — see Phase 0 in the [roadmap](docs/vision.md#roadmap) — so it's a manual step for now.)
4. Open a PR with a clear description of what changed and why. Keep the scope focused — smaller PRs are easier to review.
5. Follow the patterns in [`docs/conventions.md`](docs/conventions.md) for file organization, state management, and styling.

## Learn more

- [`docs/vision.md`](docs/vision.md) — product strategy, the four layers, roadmap
- [`docs/conventions.md`](docs/conventions.md) — coding conventions
