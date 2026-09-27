import { snapshotEtag } from "@/lib/services/graph/etag";
import { graphReadRoute } from "@/lib/services/graph/read-route";
import { getEdges } from "@/lib/services/graph/store";

/** GET /api/graph/projects/{projectId}/edges — backs DataProvider.getEdges. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = graphReadRoute("edges", "edges", getEdges, snapshotEtag);
