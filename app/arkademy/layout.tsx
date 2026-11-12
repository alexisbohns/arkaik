import type { ReactNode } from "react";

import { ArkademyChrome } from "@/components/arkademy/ArkademyChrome";

/**
 * Every page under /arkademy: the Arkademy's header around the page. The
 * pages read Postgres through lib/services/arkademy.ts, so the segment runs
 * on Node; each page is also `force-dynamic`, so the build never touches the
 * database.
 */
export const runtime = "nodejs";

export default function ArkademyLayout({ children }: { children: ReactNode }) {
  return <ArkademyChrome>{children}</ArkademyChrome>;
}
