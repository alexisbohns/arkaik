import {
  REPORT_RATE_LIMIT,
  checkRateLimit,
  deriveClientIp,
  hashIp,
  reportSnapshot,
  servicesConfigured,
  servicesUnavailable,
} from "@/lib/services/publik";

/**
 * POST /api/publik/{id}/report — increment `report_count` and flag for review
 * over the threshold (docs/spec/services.md § Publik → Protocol, § Moderation).
 * Rate-limited per IP like every other unauthenticated write. Returns `202`.
 *
 * Node runtime for the `pg` driver.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Context): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable();

  const { id } = await params;
  try {
    const ipHash = hashIp(deriveClientIp(req));
    const rate = await checkRateLimit(ipHash, "report", REPORT_RATE_LIMIT);
    if (rate.limited) {
      return Response.json(
        { error: "rate_limited", message: "Too many reports. Try again later." },
        { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
      );
    }

    const outcome = await reportSnapshot(id);
    if (!outcome.found) {
      return Response.json({ error: "not_found", message: "Snapshot not found." }, { status: 404 });
    }

    // 202 Accepted: the report is recorded; review is an out-of-band process.
    // `flagged` makes the threshold state queryable by the caller (§ Moderation).
    return Response.json(
      { status: "accepted", report_count: outcome.reportCount, flagged: outcome.flagged },
      { status: 202 },
    );
  } catch (err) {
    console.error("[publik] report failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json(
      { error: "internal_error", message: "Failed to record report." },
      { status: 500 },
    );
  }
}
