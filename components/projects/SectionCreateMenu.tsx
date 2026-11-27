"use client";

import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { CreateTarget } from "@/lib/data/create-target";
import { CreateItems, KINDS } from "./project-ui";

interface SectionCreateMenuProps {
  target: CreateTarget;
  /** Open the "new project" dialog with this target in mind. */
  onCreate: () => void;
  /** Open the file picker with this target in mind. */
  onImport: () => void;
  /** Only ever passed for the Synked section — restoring produces a backed-up local project. */
  onRestore?: () => void;
  /**
   * The pill's text, and the distinguishing half of the round trigger's
   * accessible name. A section renders this menu twice when it is empty — once
   * in the head, once in the empty state — and two controls with identical
   * accessible names is a trap for anyone navigating by list of buttons. The
   * second instance passes something that says which one it is.
   */
  primaryLabel?: string;
  disabled?: boolean;
  /**
   * Where it sits. In a section head it is a ROUND plus (a cookie under the
   * pointer); anywhere else — an empty section, the signed-out hero — a full
   * pill that says what it does.
   */
  context?: "head" | "empty" | "hero";
}

/**
 * A section's ways in: one trigger, one rich list — create, "Generate with AI"
 * (a real link), import, and "Restore from Synk" under Synked only, because the
 * thing it produces is by definition a backed-up local project. Every item
 * creates a project of THIS section's kind.
 *
 * The first click shows every way in, each with a line saying what it does,
 * rather than a primary button that hides the others behind a chevron.
 */
export function SectionCreateMenu({
  target,
  onCreate,
  onImport,
  onRestore,
  primaryLabel = "Create project",
  disabled = false,
  context = "head",
}: SectionCreateMenuProps) {
  const round = context === "head";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="pj-plus"
          data-round={round ? "" : undefined}
          disabled={disabled}
          aria-label={round ? `${primaryLabel}: ways to add a ${KINDS[target].label} project` : undefined}
        >
          <PlusIcon aria-hidden="true" />
          {round ? null : <span>{primaryLabel}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="pj-menu">
        <CreateItems ways={{ onCreate, onImport, onRestore, generateHref: `/generate?target=${target}` }} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
