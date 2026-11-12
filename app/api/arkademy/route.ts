import { arkademyEtag, getArkademy } from "@/lib/services/arkademy";
import { servicesUnavailable } from "@/lib/services/db";
import { ifNoneMatchSatisfied } from "@/lib/services/graph/etag";

/**
 * GET /api/arkademy — the Arkademy library, public, no parameters
 * (docs/spec/services.md § Arkademy). A thin wrapper over `getArkademy`, the
 * cached loader the pages call in-process; this route is the contract for
 * agents, scripts and anything else that is not a page.
 *
 * Node runtime for the `pg` driver; force-dynamic so the build never touches
 * the database. The data cache behind `getArkademy` (an hour, expired at once
 * by POST /api/arkademy/revalidate after a publish) is what keeps a read
 * cheap; the CDN window below is short on purpose, so a revalidated version
 * reaches every reader within two minutes.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READY_CACHE_CONTROL = "public, max-age=60, s-maxage=60, stale-while-revalidate=60";
const EMPTY_CACHE_CONTROL = "public, max-age=60, s-maxage=60";
const NO_STORE = "no-store";

export async function GET(req: Request): Promise<Response> {
  const lookup = await getArkademy();
  switch (lookup.status) {
    case "ready": {
      const etag = arkademyEtag(lookup.version);
      const headers = { ETag: etag, "Cache-Control": READY_CACHE_CONTROL };
      if (ifNoneMatchSatisfied(req.headers.get("if-none-match"), etag)) {
        return new Response(null, { status: 304, headers });
      }
      return Response.json(
        {
          version: lookup.version,
          uploaded_at: lookup.uploadedAt,
          format_version: lookup.document.formatVersion,
          document: lookup.document,
        },
        { status: 200, headers },
      );
    }
    case "empty":
      return Response.json(
        { error: "no_document", message: "No Arkademy document has been uploaded yet." },
        { status: 404, headers: { "Cache-Control": EMPTY_CACHE_CONTROL } },
      );
    case "unconfigured": {
      const response = servicesUnavailable("Arkademy");
      response.headers.set("Cache-Control", NO_STORE);
      return response;
    }
    case "invalid":
      return Response.json(
        {
          error: "document_invalid",
          message: `The stored Arkademy document (v${lookup.version}) does not pass this deployment's schema.`,
        },
        { status: 500, headers: { "Cache-Control": NO_STORE } },
      );
    case "error":
      return Response.json(
        { error: "internal_error", message: "Failed to load the Arkademy." },
        { status: 500, headers: { "Cache-Control": NO_STORE } },
      );
  }
}
