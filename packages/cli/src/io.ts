/**
 * `arkaik/io` — the CLI's file IO as an importable seam
 * (docs/spec/mcp.md § Reuse Seams). The MCP server (`arkaik-mcp`) imports
 * these verbatim, so what the CLI and the agent plane consider "the bundle on
 * disk" can never drift. Filesystem code stays out of `@arkaik/schema`, which
 * remains browser-safe.
 *
 * Built as a second esbuild entry to `dist/io.js` (see build.js); the
 * package.json `exports` map serves types from this raw-TS source, mirroring
 * how `@arkaik/schema` ships.
 */

export { readBundle, nodesByIdOf } from "./lib/bundle-io";
export {
  JOURNAL_SIDECAR,
  journalPathFor,
  archivePathFor,
  readJournalEvents,
  loadJournalEvents,
  appendJournalEvent,
  compactSlice,
} from "./lib/journal-io";
export { validateBundleAt, type BundleValidation } from "./lib/bundle-validate";
