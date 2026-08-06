# Contributing to arkaik

## License

arkaik is licensed **by layer**, and the split has already executed — this is a description of the current state, not a plan.

- **MIT — the format, schema, validator, CLI, MCP server, and agent skill.** `packages/schema` (`@arkaik/schema`), `packages/cli` (the published `arkaik` CLI), `packages/mcp` (the published `arkaik-mcp` server), and the skill/plugin assets under `plugin/` and `docs/arkaik-skill/`. Each package carries its own MIT `LICENSE`; the two published ones ship it inside their npm tarball, and `@arkaik/schema` — which is workspace-private and reaches users bundled into those two builds — is covered by the same text at the same terms. These layers are the toolchain's adoption channel: they exist to be pasted into other organizations' repositories, and many corporate policies reject AGPL dependencies outright.
- **AGPL-3.0 — the app and the services.** Everything else, under the repository-root [`LICENSE`](LICENSE): the Next.js application (`app/`, `components/`, `lib/`, `hooks/`), the route handlers and server code (`app/api/`, `lib/services/`), and the migrations in `db/`. Self-hosting stays possible for everyone; a closed-source clone of the hosted app does not.

Rationale in [`docs/vision.md` § Open Source Strategy](docs/vision.md#open-source-strategy); the normative statement is [`docs/spec/toolchain.md` § Licensing](docs/spec/toolchain.md).

**By submitting a contribution, you agree it carries the license of the path(s) it touches** — MIT under `packages/`, `plugin/`, and `docs/arkaik-skill/`; AGPL-3.0 everywhere else. Recording this while the project still has effectively a single copyright holder is what keeps the boundary maintainable: consent gathered per-contribution now is consent nobody has to chase down later.

## How to contribute

1. Branch off `main`. There's no enforced naming scheme yet — a short `type/description` name (e.g. `fix/rewrite-bundle-id`, `docs/contributing`) is fine.
2. Before opening a PR, run:
   ```bash
   npm run lint
   npm run build
   npm run generate
   ```
   `npm run generate` is the one contributors are most likely to skip and most likely to be failed by. CI regenerates every derived artifact and then fails the PR on `git diff` — the JSON Schema, the standalone validator, the skill reference, the prompt fragments, the plugin manifests, and the wobble CSS (`.github/workflows/ci.yml` § *Fail on generated-artifact drift*). Running the generator and committing what it rewrites is the only way to close that gate; hand-editing a generated file just moves the failure.
3. Run the tests around what you changed. CI runs every `test:*` script in `package.json`, so the local subset is a fast-feedback loop rather than a substitute — pick the ones named after your change (`npm run test:schema` for the model, `npm run test:cli`, `npm run test:mcp`, `npm run test:provider`, …). The Postgres-backed integration tests (`test:graph`, `test:publik`, `test:synk`, `test:tokens`, `test:github`, `test:auth`, `test:sync`) run in a separate CI job with a database attached; locally they need a `DATABASE_URL`.
4. If your change touches the bundle format or any seed/example data (`seed/pebbles.json`, `seed/arkaik-self-map.json`, `public/schema/example-bundle.json`), validate it:
   ```bash
   npm run validate:seeds        # all three, exactly as CI does
   npx arkaik validate <path>    # one bundle, folding in a journal.jsonl sidecar
   ```
5. Open a PR with a clear description of what changed and why. Keep the scope focused — smaller PRs are easier to review.
6. Follow the patterns in [`docs/conventions.md`](docs/conventions.md) for file organization, state management, and styling.

## Learn more

- [`docs/vision.md`](docs/vision.md) — product strategy, the four layers, roadmap
- [`docs/conventions.md`](docs/conventions.md) — coding conventions
