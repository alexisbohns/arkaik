import { servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  verifySignature,
} from "@/lib/services/github/verify";
import {
  applyPullRequestEvent,
  claimDelivery,
  releaseDelivery,
  type PullRequestEvent,
} from "@/lib/services/github/pull-request";

/**
 * POST /api/github/webhook — GitHub App deliveries.
 *
 * The only endpoint in the app that accepts a signed request from a third
 * party. Its guards, in the order they must happen:
 *
 *   1. read the RAW body — the signature covers bytes, and re-serializing
 *      parsed JSON does not round-trip;
 *   2. verify the HMAC before parsing anything;
 *   3. claim the delivery id, so a retry or a manual redeliver cannot re-apply
 *      transitions;
 *   4. only then interpret the payload.
 *
 * Unrecognised events are acknowledged with 202 rather than 4xx: GitHub retries
 * on failure, and an event this deployment does not care about is not a failure.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bodies above this are rejected unread — GitHub's are far smaller. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Actions that can change a PR's open/closed/merged state. */
const HANDLED_ACTIONS = new Set(["opened", "reopened", "closed", "edited", "synchronize", "ready_for_review"]);

export async function POST(req: Request): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("GitHub");

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  // Verify BEFORE parsing. Nothing derived from an unverified body is trusted,
  // including the decision about what kind of event it is.
  const verified = verifySignature(raw, req.headers.get(SIGNATURE_HEADER));
  if (!verified.ok) {
    if (verified.reason === "unconfigured") {
      // A deployment without a secret refuses everything rather than accepting
      // unauthenticated writes — 503, because this is a server-side gap.
      console.error("[github] webhook received but GITHUB_WEBHOOK_SECRET is unset");
      return Response.json({ error: "webhook_not_configured" }, { status: 503 });
    }
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  const deliveryId = req.headers.get(DELIVERY_HEADER);
  if (!deliveryId) return Response.json({ error: "missing_delivery_id" }, { status: 400 });

  const event = req.headers.get(EVENT_HEADER);
  if (event !== "pull_request") {
    // ping, installation, everything else: acknowledged, not acted on.
    return Response.json({ status: "ignored", event }, { status: 202 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = typeof payload.action === "string" ? payload.action : "";
  if (!HANDLED_ACTIONS.has(action)) {
    return Response.json({ status: "ignored", action }, { status: 202 });
  }

  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;
  if (!pr || !repo || typeof repo.full_name !== "string" || typeof pr.number !== "number") {
    return Response.json({ error: "unexpected_payload" }, { status: 400 });
  }

  // Claimed only once the event is one we will act on, so an ignored delivery
  // does not consume an id that a later retry of a handled event might reuse.
  if (!(await claimDelivery(deliveryId))) {
    return Response.json({ status: "duplicate", delivery: deliveryId }, { status: 202 });
  }

  // `installation.id` is present on every GitHub App delivery and absent on a
  // plain repository webhook. It is what lets arkaik call the API back to read
  // a pull request's changed files, which path-scoped repository links need —
  // and it is a NUMBER in the payload against a `text` column, so the
  // conversion happens once, here, at the boundary.
  const installation = payload.installation as Record<string, unknown> | undefined;
  const installationId =
    installation && (typeof installation.id === "number" || typeof installation.id === "string")
      ? String(installation.id)
      : null;

  const prEvent: PullRequestEvent = {
    action,
    repoFullName: repo.full_name,
    number: pr.number,
    url: typeof pr.html_url === "string" ? pr.html_url : "",
    title: typeof pr.title === "string" ? pr.title : "",
    body: typeof pr.body === "string" ? pr.body : "",
    merged: pr.merged === true,
    state: typeof pr.state === "string" ? pr.state : "open",
    installationId,
  };

  try {
    const outcomes = await applyPullRequestEvent(prEvent);
    // A typo'd repo link — or no link at all — is the commonest reason "nothing
    // happened", and `{status:"ok", outcomes:[]}` names nothing at all: the one
    // page docs/hosted-projects.md tells people to read would show a green 200
    // and an empty list. `applyPullRequestEvent` returns one outcome per linked
    // PROJECT — a monorepo's several path-scoped links to one repository still
    // produce exactly one — so an empty list can only mean the repo resolved to
    // no project.
    //
    // Still a 200: not linking a repository is a configuration state, not an
    // error, and a 4xx/5xx here would make GitHub retry a delivery that will
    // resolve to nothing every time. Same `status: "ok"` envelope as below, with
    // the same `skipped` key `ApplyOutcome` already uses to explain a no-op.
    if (outcomes.length === 0) {
      return Response.json(
        { status: "ok", outcomes, skipped: `no project has linked ${prEvent.repoFullName}` },
        { status: 200 },
      );
    }
    return Response.json({ status: "ok", outcomes }, { status: 200 });
  } catch (err) {
    console.error("[github] webhook failed:", err instanceof Error ? err.message : "unknown error");
    // Release the claim so GitHub's retry can redo this. Holding it would turn
    // a transient failure into a permanently lost transition — the retry would
    // arrive, see the claim, and skip. Re-applying is a no-op by construction
    // (see releaseDelivery), so at-least-once is the right posture here.
    //
    // This is also the contract `lib/services/github/app.ts` relies on when it
    // THROWS a `GithubTransientError` for a 5xx, a rate limit or a socket
    // error: those are the failures a redelivery can fix, so they must reach
    // here rather than be reported as a permanent no-op. A missing private key
    // is the opposite and never throws — no retry can set an env var.
    await releaseDelivery(deliveryId).catch(() => {});
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
