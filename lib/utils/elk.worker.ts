/**
 * The ELK layout worker's entry point.
 *
 * Exactly one side-effect import, and nothing else on purpose:
 * `elk-worker.min.js` installs its own `self.onmessage` when it is evaluated,
 * so there is no handler to write here. The file exists so the bundler has a
 * worker entry to emit a chunk for — `new Worker(new URL("./elk.worker.ts",
 * import.meta.url))` in `elk-engine.ts` is what points at it.
 *
 * Keep it free of every other import. Anything added here is evaluated inside
 * the worker, where there is no DOM, no React and no app context.
 */
import "elkjs/lib/elk-worker.min.js";
