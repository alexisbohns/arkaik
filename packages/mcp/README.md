# arkaik-mcp

> The Arkaik **agent plane** — a dependency-free stdio [MCP](https://modelcontextprotocol.io) server that exposes an Arkaik product-graph bundle as tools: read projections plus validator-gated dual-write mutations.

Part of the [arkaik](https://github.com/alexisbohns/arkaik) toolchain (MIT). Normative contract: [`docs/spec/mcp.md`](../../docs/spec/mcp.md).

## Use

An MCP host spawns the server over stdio — zero install via `npx`:

```json
{
  "mcpServers": {
    "arkaik": {
      "command": "npx",
      "args": ["-y", "arkaik-mcp"],
      "env": { "ARKAIK_BUNDLE": "docs/arkaik/bundle.json" }
    }
  }
}
```

**Bundle discovery** order: `--bundle <path>` → `ARKAIK_BUNDLE` env → `docs/arkaik/bundle.json` under the current working directory. The journal sidecar (`journal.jsonl`) next to the snapshot is folded in automatically. The bundle is reloaded per tool call, so external edits (a human, another agent, `git pull`) are always picked up.

## Tools (v1)

Read tools are projections; write tools follow the validator-gated dual-write path (mutation applied in memory → `validateBundle` → **any error writes nothing**; on success the journal event is appended and the snapshot rewritten canonically, `actor: "arkaik-mcp"`).

| Read | Write |
|---|---|
| `list_nodes`, `get_node` | `create_node`, `update_node`, `delete_node` |
| `get_changelog`, `get_backlog` | `add_edge`, `remove_edge` |
| `list_maps`, `get_map` | `propose_idea`, `file_request` |
| `validate_bundle` | |

## Develop

```bash
npm install                 # from the repo root (workspace)
npm run build -w arkaik-mcp # esbuild bundles src + @arkaik/schema + arkaik/io -> dist/index.js
npm run test:mcp            # spawn the built server, drive it over JSON-RPC
```

`dist/index.js` is a **self-contained esbuild bundle**: `@arkaik/schema` and the CLI's `arkaik/io` seam are inlined at build time, so the published package has **zero runtime dependencies** (they live in `devDependencies`). `dist/` is gitignored and produced at publish time.

## Releasing (publishing to npm)

> ⚠️ **The failure mode to avoid.** Because `dist/` is gitignored and built by a lifecycle script, if that build doesn't run, npm publishes a **`package.json`-only tarball with no error** — and `npx -y arkaik-mcp` then fails with `sh: arkaik-mcp: command not found` (the `bin` points at a `dist/index.js` that isn't in the package). This shipped as `0.1.1`. **Always verify the tarball before publishing** (step 2 below) — that check is the whole point of this runbook.

npm versions are **immutable**: you can never overwrite or re-publish an existing version, and re-running `npm publish` on a published version is *supposed* to fail. Every change ships as a new version.

1. **Bump the version** and commit it (a small PR, or per your flow):
   ```bash
   npm version patch -w arkaik-mcp --no-git-tag-version   # e.g. 0.1.2 -> 0.1.3
   ```

2. **Build, then VERIFY the tarball** — do not skip this:
   ```bash
   npm install
   npm run build -w arkaik-mcp
   npm pack --dry-run -w arkaik-mcp
   ```
   The listed **Tarball Contents MUST include `dist/index.js`** (~624 kB) alongside `package.json` (and `README.md`). If `dist/index.js` is absent, **STOP — do not publish**: the bundle didn't build.

3. **Publish from the package directory** (not `npm publish -w arkaik-mcp` — a workspace publish can skip the `prepublishOnly` build depending on the npm version, which is exactly how the empty `0.1.1` shipped). Because step 2 already built `dist/` into the tree, the tarball is correct even if lifecycle scripts are skipped:
   ```bash
   cd packages/mcp
   npm publish            # unscoped package ⇒ public by default
   cd ../..
   ```

4. **Confirm the published artifact:**
   ```bash
   npm view arkaik-mcp@<version> dist.fileCount    # includes dist/index.js — must NOT be 1
   npm view arkaik-mcp@<version> dependencies       # must be {} (deps are bundled)
   ```

5. **If you shipped a broken version, deprecate it** (it can't be deleted or replaced):
   ```bash
   npm deprecate arkaik-mcp@<bad-version> "Broken; use >=<good-version>"
   ```

Once a good version is `latest`, `npx -y arkaik-mcp` (and any consuming repo's `.mcp.json`) resolves to it automatically — no downstream changes needed.
