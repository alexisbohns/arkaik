import { journalEtag } from "@/lib/services/graph/etag";
import { graphReadRoute } from "@/lib/services/graph/read-route";
import { exportProject } from "@/lib/services/graph/store";

/**
 * GET /api/graph/projects/{projectId}/export — the full interchange bundle with
 * its journal embedded. The escape hatch: a hosted project is always exportable
 * to a file, so choosing hosting never means giving up the portable format.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = graphReadRoute("export", "bundle", exportProject, journalEtag);
