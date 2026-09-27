import { snapshotEtag } from "@/lib/services/graph/etag";
import { graphReadRoute } from "@/lib/services/graph/read-route";
import { getNodes } from "@/lib/services/graph/store";

/** GET /api/graph/projects/{projectId}/nodes — backs DataProvider.getNodes. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = graphReadRoute("nodes", "nodes", getNodes, snapshotEtag);
