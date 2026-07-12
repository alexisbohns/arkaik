import {
  CREATE_RATE_LIMIT,
  MAX_BUNDLE_BYTES,
  checkRateLimit,
  deriveClientIp,
  hashIp,
  servicesConfigured,
  servicesUnavailable,
  storeSnapshot,
  stripJournal,
  validateInboundBundle,
} from "@/lib/services/publik";

/**
 * POST /api/publik — create an anonymous snapshot (docs/spec/services.md §
 * Publik → Protocol). Validates through @arkaik/schema, strips the journal by
 * default, rate-limits per IP in Postgres, and returns `201 { id, url, owner_key }`
 * with the owner key delivered exactly once.
 *
 * Node runtime: the `pg` driver needs Node APIs, not the edge runtime.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable();

  // 1. Size cap (§ "Size cap 5 MB → 413"). Read raw so we measure real bytes,
  //    not a possibly-absent content-length header.
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BUNDLE_BYTES) {
    return Response.json(
      {
        error: "payload_too_large",
        message: `Bundle exceeds the ${MAX_BUNDLE_BYTES} byte limit.`,
      },
      { status: 413 },
    );
  }

  try {
    // 2. Per-IP creation throttle (§ "Rate limiting → 429 with retry-after").
    //    Checked before parsing so invalid/abusive floods are throttled too.
    const ipHash = hashIp(deriveClientIp(req));
    const rate = await checkRateLimit(ipHash, "create", CREATE_RATE_LIMIT);
    if (rate.limited) {
      return Response.json(
        { error: "rate_limited", message: "Too many snapshots created. Try again later." },
        { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
      );
    }

    // 3. Parse the JSON body. Malformed JSON is a syntactic error → 400.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Response.json(
        { error: "invalid_json", message: "Request body is not valid JSON." },
        { status: 400 },
      );
    }

    // 4. Validate through @arkaik/schema (§ "Validate → 422 with findings").
    const validation = validateInboundBundle(parsed);
    if (!validation.ok) {
      return Response.json(
        { error: "validation_failed", findings: validation.findings },
        { status: 422 },
      );
    }

    // 5. Journal strip, enforced server-side (§ "Journal stripped by default").
    const includeJournal = new URL(req.url).searchParams.get("include_journal") === "true";
    const bundle = parsed as Record<string, unknown>;
    const toStore = includeJournal ? bundle : stripJournal(bundle);

    // 6. Store (immutable) and return id + one-time owner key.
    const { id, ownerKey } = await storeSnapshot(toStore);
    const url = `${new URL(req.url).origin}/p/${id}`;

    return Response.json({ id, url, owner_key: ownerKey }, { status: 201 });
  } catch (err) {
    // Never log the request body or owner key (§ Security & Privacy).
    console.error("[publik] POST failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json(
      { error: "internal_error", message: "Failed to create snapshot." },
      { status: 500 },
    );
  }
}
