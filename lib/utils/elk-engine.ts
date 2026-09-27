import type { ELK, ElkLayoutArguments, ElkNode } from "elkjs/lib/elk-api";

/**
 * The ELK engine, off the main thread.
 *
 * `elk-layout.ts` used to `import ELK from "elkjs/lib/elk.bundled.js"` and
 * construct it at module scope, which meant ~1.6 MB of GWT-compiled script was
 * evaluated on import — during SSR too — and every layout ran synchronously on
 * the main thread. Measured on `seed/pebbles.json`: the Journey map 44–129 ms,
 * the System map 2.2–3.7 s, and a ×5 replica at hosted scale 17–32 s, all of
 * it blocking. The layouts are no faster here; they simply stop freezing the
 * page.
 *
 * Two rules make the rest of this file what it is:
 *
 *  - **Never construct at module scope.** There is no `Worker` during SSR, and
 *    the bundled fallback would be evaluated on every import. `getElkEngine()`
 *    is a lazy, memoized promise instead — the first layout pays for the
 *    engine, every later one reuses it.
 *  - **Never trust the worker to fail loudly.** `elk-api`'s registration ends
 *    in a `.catch(console.err)` — `console.err` is not a function — so a
 *    worker that dies takes every pending `layout()` with it and none of them
 *    reject. The engine below races each layout against the worker's error
 *    events and falls back to the bundled engine rather than hanging the map
 *    forever.
 */

/**
 * The sliver of elkjs' API this app uses — elkjs' own `layout` signature, so
 * the engine and a bare `new ELK()` stay interchangeable and the generic
 * return type (`Omit<T, "children"> & …`) survives to the caller.
 */
export type ElkEngine = Pick<ELK, "layout">;

interface Engine {
  elk: ElkEngine;
  /** Rejects when the worker reports it is dead; never resolves otherwise. */
  failure: Promise<never> | null;
  /** Tears the worker down after a failure, so the next attempt starts clean. */
  dispose: () => void;
}

let engine: Promise<Engine> | null = null;

/** The bundled, main-thread engine — imported dynamically so it is not in the
 * map route's chunk graph unless a worker actually failed to start. A static
 * import here would ship both copies of the engine to every visitor. */
async function loadBundledEngine(): Promise<Engine> {
  const { default: ELKBundled } = await import("elkjs/lib/elk.bundled.js");
  return { elk: new ELKBundled(), failure: null, dispose: () => {} };
}

async function loadWorkerEngine(): Promise<Engine> {
  if (typeof Worker === "undefined") return loadBundledEngine();

  let worker: Worker;
  try {
    // A CLASSIC worker, deliberately: no `{ type: "module" }`. Turbopack
    // strips the option and loads the entry through `importScripts`, and the
    // classic form is also the documented webpack 5 shape, so one spelling
    // works under both bundlers.
    worker = new Worker(new URL("./elk.worker.ts", import.meta.url));
  } catch {
    return loadBundledEngine();
  }

  let reportFailure: (reason: Error) => void = () => {};
  const failure = new Promise<never>((_, reject) => {
    reportFailure = reject;
  });
  // Swallow the unhandled rejection this promise becomes when no layout is in
  // flight to race against it.
  failure.catch(() => {});
  worker.onerror = () => reportFailure(new Error("The ELK worker failed to start."));
  worker.onmessageerror = () => reportFailure(new Error("The ELK worker sent an unreadable message."));

  try {
    const { default: ELKConstructor } = await import("elkjs/lib/elk-api.js");
    const elk = new ELKConstructor({ workerFactory: () => worker });
    return { elk, failure, dispose: () => worker.terminate() };
  } catch {
    worker.terminate();
    return loadBundledEngine();
  }
}

/**
 * The engine every layout goes through. Memoized: the worker is started once
 * per tab and reused. On failure the memo is dropped and the next call builds
 * the bundled engine instead, so a broken worker degrades to the old
 * main-thread behaviour rather than to a map that never lays out.
 */
export async function getElkEngine(): Promise<ElkEngine> {
  engine ??= loadWorkerEngine();
  const active = await engine;

  const failure = active.failure;
  if (failure === null) return active.elk;

  // Wrap `layout` so a dead worker surfaces as a rejection instead of a
  // promise that never settles, and retry the in-flight layout once on the
  // bundled engine.
  return {
    layout: async <T extends ElkNode>(graph: T, args?: ElkLayoutArguments) => {
      try {
        return await Promise.race([active.elk.layout(graph, args), failure]);
      } catch {
        active.dispose();
        engine = loadBundledEngine();
        return (await engine).elk.layout(graph, args);
      }
    },
  };
}

/** Test seam: forget the memoized engine so the next call builds a new one. */
export function resetElkEngineForTests(): void {
  engine = null;
}
