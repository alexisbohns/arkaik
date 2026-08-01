"use client";

import Link from "next/link";
import { ChevronDownIcon, FileUpIcon, HistoryIcon, SparklesIcon } from "lucide-react";

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
 * "Restore from Synk" appears under Synked only, and only because the thing it
 * produces is by definition a backed-up local project.
 */
export function SectionCreateMenu({
  target,
  onCreate,
  onImport,
  onRestore,
  disabled = false,
}: SectionCreateMenuProps) {
  const label = TARGET_LABEL[target];

  return (
    <div className="flex items-center">
      <Button
        size="sm"
        className="cursor-pointer rounded-r-none"
        disabled={disabled}
        onClick={onCreate}
      >
        Create project
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            className="cursor-pointer rounded-l-none border-l border-primary-foreground/20 px-2"
            disabled={disabled}
            aria-label={`More ways to add a ${label} project`}
          >
            <ChevronDownIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="cursor-pointer" onSelect={onCreate}>
            <SparklesIcon className="size-4" />
            Create project
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="cursor-pointer">
            <Link href={`/generate?target=${target}`}>
              <SparklesIcon className="size-4" />
              Generate with AI
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer" onSelect={onImport}>
            <FileUpIcon className="size-4" />
            Import JSON
          </DropdownMenuItem>
          {onRestore ? (
            <DropdownMenuItem className="cursor-pointer" onSelect={onRestore}>
              <HistoryIcon className="size-4" />
              Restore from Synk
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
