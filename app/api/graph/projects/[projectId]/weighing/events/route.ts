import { getCaller, hasScope } from "@/lib/services/auth";
import { MAX_BUNDLE_BYTES, servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { appendJournalEvents, getProject, weighingFoldEvents } from "@/lib/services/graph/store";
import {
  foldWeighingEvents,
  parseWeighingEventInputs,
  planWeighingEvents,
  type Node,
  type WeighingSection,
} from "@arkaik/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST` — the hosted, events-only write path for weighing: one assessment, or a
 * positioning, recorded on a project that has no checkout to hold
 * `docs/weighing/` (docs/rfcs/weighing.md). The twin of
 * `quality/events/route.ts`, and built the same way.
 *
 * A batch of typed entries, each `weighing.assessment.recorded` or
 * `weighing.set.saved`, and nothing else — this is not a general
 * event-append surface. Every entry goes through `planWeighingEvents`, the one
 * validator-gated gate the browser provider and the MCP tools also use, so an
 * assessment written here has been checked against the same library, the same
 * scale and the same subject rule as every other. The batch is all-or-nothing:
 * one refusal anywhere refuses every entry, each naming its `index`.
 *
 * **Provenance is stamped here, never read from the body.** A session (the
 * browser) is a `human`; a token (the MCP server, a script) is an `agent` —
 * `getCaller` is the only thing on this route that knows which, so `scorer`,
 * `basis` and `ts` are refused if a caller supplies them. A human's level beats
 * an agent's in every roll-up, which is exactly why a token cannot claim to be
 * one.
 *
 * **On whose behalf (D14, not yet run).** A token is an agent acting for the
 * person who minted it, and the record says so: `scorer.on_behalf_of` is the
 * token owner's user id, an opaque string and never an email (sidecars are
 * committed to repos, and a bundle can be published). A session is the person
 * themselves, so it stamps nothing.
 *
 * `snapshot.weighing` is NEVER rewritten: the journal grows and the project GET
 * folds it (`foldWeighingEvents`), the doctrine `quality/events` already
 * follows. The scope is `graph:write` — there is no narrower credential for
 * this, because nothing here is an append-only observation: an assessment
 * outranks the ones before it.
 *
 * Deliberately unlocked, like its sibling: the journal is append-only and the
 * fold is latest-wins per cell and scorer kind, so two concurrent writers
 * produce the same outcome a lock would have — the later event wins.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Graph");

  const caller = await getCaller(req);
  if (!caller) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasScope(caller, "graph:write")) {
    return Response.json({ error: "insufficient_scope", required: "graph:write" }, { status: 403 });
  }

  const { projectId } = await params;

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BUNDLE_BYTES) {
    return Response.json({ error: "payload_too_large", limit: MAX_BUNDLE_BYTES }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const inputs = parseWeighingEventInputs(body);
  if (!Array.isArray(inputs)) {
    return Response.json({ error: "invalid_events", message: inputs.error }, { status: 400 });
  }

  try {
    const found = await getProject(projectId, caller.ownerIds);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    // What acted, not just who: an agent's writes stay distinguishable from the
    // same person's edits in the browser, and the scorer kind follows from it.
    const agent = caller.via === "token";
    const actor = agent ? "arkaik-agent" : "arkaik-app";

    const snapshot = found.bundle as { weighing?: WeighingSection; nodes: Node[] };
    // The section the next GET would show, so a check reads what a reader sees.
    const section = foldWeighingEvents(snapshot.weighing, await weighingFoldEvents(projectId, caller.ownerIds));

    const plan = planWeighingEvents(section, snapshot.nodes, inputs, {
      actor,
      scorerKind: agent ? "agent" : "human",
      // D14, not yet run: whose hands the token is. `caller.userId` is the token's owner.
      ...(agent ? { onBehalfOf: String(caller.userId) } : {}),
    });
    if (!plan.ok) {
      const message = plan.refusals.map((r) => `entry ${r.index}: ${r.reason} — ${r.detail}`).join("; ");
      return Response.json({ error: "refused", message, refusals: plan.refusals }, { status: 422 });
    }

    const result = await appendJournalEvents(projectId, caller.ownerIds, plan.events, actor);
    if (!result.ok) {
      return Response.json({ error: "refused", reason: result.reason }, { status: 422 });
    }

    return Response.json({ events: plan.events }, { status: 200 });
  } catch (err) {
    console.error("[graph] POST weighing events failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to append weighing events." }, { status: 500 });
  }
}
