"use client";

import Link from "next/link";
import { ChevronDownIcon, FileUpIcon, HistoryIcon, PlusIcon, SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CreateTarget } from "@/lib/data/create-target";

interface SectionCreateMenuProps {
  target: CreateTarget;
  /** Open the "new project" dialog with this target in mind. */
  onCreate: () => void;
  /** Open the file picker with this target in mind. */
  onImport: () => void;
  /** Only ever passed for the Synked section — restoring produces a backed-up local project. */
  onRestore?: () => void;
  /**
   * The primary button's text, and the distinguishing half of the chevron's
   * accessible name. A section renders this menu twice when it is empty — once
   * in the header, once in the empty state — and two controls with identical
   * accessible names is a trap for anyone navigating by list of buttons. The
   * second instance passes something that says which one it is.
   */
  primaryLabel?: string;
  disabled?: boolean;
}

const TARGET_LABEL: Record<CreateTarget, string> = {
  hosted: "Hosted",
  synked: "Synked",
  lokal: "Lokal",
};

/**
 * A section's creation controls: a primary "Create project" plus a menu of the
 * other ways in. Every item creates a project of THIS section's kind — that is
 * the whole point of moving these controls out of a single page-level row.
 *
 * The menu repeats the primary action on purpose. It is meant to read as the
 * complete list of ways into this section, so someone who opens it looking for
 * their options never has to close it again to find the most ordinary one.
 *
 * "Restore from Synk" appears under Synked only, and only because the thing it
 * produces is by definition a backed-up local project.
 */
export function SectionCreateMenu({
  target,
  onCreate,
  onImport,
  onRestore,
  primaryLabel = "Create project",
  disabled = false,
}: SectionCreateMenuProps) {
  const label = TARGET_LABEL[target];

  return (
    <div className="flex items-center gap-0.5">
      {/* An M3 Expressive split button: two shapes 2px apart, pill ends
          outside and a tight joint between them. Each half tightens into a
          rounded square under the pointer (the Button's own morph), and the
          chevron rounds up into a circle while its menu is out.
          Both halves raise themselves while focused: the ring is painted 3px
          OUTSIDE the element and the neighbour would paint over it. */}
      <Button
        size="sm"
        className="cursor-pointer rounded-r-(--mx-joint) focus-visible:relative focus-visible:z-10"
        disabled={disabled}
        onClick={onCreate}
      >
        {primaryLabel}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            className="w-9 cursor-pointer rounded-l-(--mx-joint) px-0 focus-visible:relative focus-visible:z-10 aria-expanded:rounded-[1rem] [&_svg]:transition-transform aria-expanded:[&_svg]:rotate-180"
            disabled={disabled}
            aria-label={`${primaryLabel}: more ways to add a ${label} project`}
          >
            <ChevronDownIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="cursor-pointer" onSelect={onCreate}>
            <PlusIcon />
            Create project
          </DropdownMenuItem>
          {/* `asChild` + `Link` instead of an `onSelect` that pushes: this item
              alone leads somewhere with a URL, and keeping it a real anchor
              keeps that URL copyable, middle-clickable and openable in a new
              tab. Worth the inconsistency with its neighbours. */}
          <DropdownMenuItem asChild className="cursor-pointer">
            <Link href={`/generate?target=${target}`}>
              <SparklesIcon />
              Generate with AI
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer" onSelect={onImport}>
            <FileUpIcon />
            Import JSON
          </DropdownMenuItem>
          {onRestore ? (
            <DropdownMenuItem className="cursor-pointer" onSelect={onRestore}>
              <HistoryIcon />
              Restore from Synk
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
