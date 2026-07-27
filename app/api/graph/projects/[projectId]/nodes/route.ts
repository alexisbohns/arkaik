import { getNodes } from "@/lib/services/graph/store";
import { graphReadRoute } from "@/lib/services/graph/read-route";

/** GET /api/graph/projects/{projectId}/nodes — backs DataProvider.getNodes. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = graphReadRoute("nodes", "nodes", getNodes);
