import type { LucideIcon } from "lucide-react";
import type { Deliverable } from "@/lib/utils/journal";

/**
 * One row of the Changelog's release list — the Unreleased bucket or a tagged
 * milestone — carrying everything the list, the picker and the detail column
 * draw, so the three cannot disagree about what a release is called.
 */
export interface ReleaseEntry {
  /** `UNRELEASED_KEY` or the version — also the `?release=` value. */
  key: string;
  title: string;
  icon: LucideIcon;
  /** The date · platform · count line. */
  subtitle: string;
  /** The release notes, or what the Unreleased bucket means. */
  description?: string;
  deliverables: readonly Deliverable[];
}
