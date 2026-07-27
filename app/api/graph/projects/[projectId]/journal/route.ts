import { getJournal } from "@/lib/services/graph/store";
import { graphReadRoute } from "@/lib/services/graph/read-route";

/** GET /api/graph/projects/{projectId}/journal — events in server order. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = graphReadRoute("journal", "journal", getJournal);
