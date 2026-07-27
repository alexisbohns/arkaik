/**
 * `RemoteStore` — the agent plane over a hosted project (docs/spec/mcp.md
 * § Non-Goals → "Hosted MCP / REST over Synk projects", now built).
 *
 * The tool catalog does not change. `tools.ts` is written against the `Store`
 * interface and knows nothing about where the graph lives, so `list_nodes`,
 * `get_node`, `create_node` and the rest are literally the same code against a
 * repo file or an account. That is the point: local and remote cannot drift,
 * because there is only one implementation of each tool.
 *
 * What differs is only what a `Store` is for:
 *  - `load()` is two HTTP reads (snapshot + journal) instead of two file reads;
 *  - `persist()` posts the ops to `POST /api/graph/projects/{id}/mutations`,
 *    where the SERVER runs `applyOps` and `validateBundle` inside a row-locked
 *    transaction. The refusal semantics are identical because it is the same
 *    validator — the gate simply lives on the other side of the wire.
 *
 * A consequence worth stating: this store sends OPS, not a mutated graph. The
 * server recomputes the result under its own lock, so two agents editing one
 * project cannot clobber each other the way "read, mutate locally, write back"
 * would allow.
 */

import type { EventInput, JournalEvent, Project, ValidationFinding } from "@arkaik/schema";

import type { LoadedGraph, Store, WriteResult } from "./store";

/** Events written through this store are attributed to the agent plane. */
export const REMOTE_ACTOR = "arkaik-agent";

export interface RemoteStoreOptions {
  baseUrl: string;
  projectId: string;
  token: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export function createRemoteStore(options: RemoteStoreOptions): Store {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = options.baseUrl.replace(/\/+$/, "");
  const projectPath = `${base}/api/graph/projects/${encodeURIComponent(options.projectId)}`;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await doFetch(`${projectPath}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.token}`,
        ...(init?.headers ?? {}),
      },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(describeFailure(res.status, body)) as Error & { status: number; body: unknown };
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body as T;
  }

  return {
    async load(): Promise<LoadedGraph> {
      // Two reads rather than one /export: the journal can be large and most
      // tool calls never look at it, but `get_changelog` and the timeline
      // projections do — so it is fetched, just not merged into the snapshot.
      const [{ bundle }, { journal }] = await Promise.all([
        request<{ bundle: Record<string, unknown> }>(""),
        request<{ journal: JournalEvent[] }>("/journal"),
      ]);

      const nodes = (bundle.nodes ?? []) as unknown[];
      const edges = (bundle.edges ?? []) as unknown[];

      return {
        // `loaded` mirrors the file store's BundleValidation shape closely
        // enough for the read tools, which only ever touch bundle/nodes/edges/
        // journal. The server has already validated everything it stores, so
        // there are no findings to carry here.
        loaded: {
          bundle: { ...bundle, journal },
          nodes,
          edges,
          journal,
          sidecarLoaded: false,
          errors: [] as ValidationFinding[],
          warnings: [] as ValidationFinding[],
        } as unknown as LoadedGraph["loaded"],
        nodes,
        edges,
        project: bundle.project as Project,
        journal,
      };
    },

    // `inputs` is deliberately not accepted: the locally-derived events are not
    // sent. The server derives its own from the ops it applies, so that the
    // events stored alongside a graph are always the ones that produced it —
    // a client cannot describe a change differently from how it was made.
    async persist(_graph, next): Promise<WriteResult> {
      const ops = next.ops;
      if (!ops || ops.length === 0) {
        // A journal-only tool (propose_idea, file_request) has no graph ops.
        // Those are not yet expressible through the mutations endpoint, so they
        // are refused loudly rather than silently dropped.
        return {
          ok: false,
          errors: [
            {
              path: "",
              rule: "remote-unsupported",
              message:
                "This tool writes a journal-only event, which the hosted API does not accept yet. Run against a repo bundle for now.",
              severity: "error",
            },
          ],
          warnings: [],
        };
      }

      try {
        const result = await request<{
          version: string;
          events: JournalEvent[];
          warnings: ValidationFinding[];
        }>("/mutations", { method: "POST", body: JSON.stringify({ ops }) });
        return { ok: true, warnings: result.warnings ?? [], events: result.events ?? [] };
      } catch (err) {
        const e = err as Error & { status?: number; body?: { errors?: ValidationFinding[]; message?: string; code?: string } };
        // 422 is the server's refusal — either validator findings or a refused
        // op. Both map onto the same shape the file store returns, so the tool
        // layer reports them identically whichever side produced them.
        if (e.status === 422) {
          return {
            ok: false,
            errors: e.body?.errors ?? [
              { path: "", rule: e.body?.code ?? "mutation-refused", message: e.body?.message ?? e.message, severity: "error" },
            ],
            warnings: [],
          };
        }
        throw err;
      }
    },

    describe() {
      return `hosted project: ${options.projectId} at ${base}`;
    },
  };
}

function describeFailure(status: number, body: unknown): string {
  const b = body as { error?: string; message?: string } | null;
  if (status === 401) return "Unauthorized — check ARKAIK_TOKEN (create one at /settings/tokens).";
  if (status === 403) return `Forbidden — ${b?.message ?? b?.error ?? "the token lacks the required scope"}.`;
  if (status === 404) return "Project not found — check the project id, or that the token's account owns it.";
  return b?.message ?? b?.error ?? `Request failed (${status}).`;
}

export type { EventInput };
