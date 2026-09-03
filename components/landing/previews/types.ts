import type { ProjectBundle } from "@/lib/data/types";

/** What every preview receives: the one bundle its catalogue entry names. */
export interface PreviewProps {
  bundle: ProjectBundle;
}
