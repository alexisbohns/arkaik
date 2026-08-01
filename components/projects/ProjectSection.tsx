"use client";

import type { ReactNode } from "react";

import { SectionCreateMenu } from "./SectionCreateMenu";
import type { CreateTarget } from "@/lib/data/create-target";

interface ProjectSectionProps {
  target: CreateTarget;
  count: number;
  onCreate: () => void;
  onImport: () => void;
  onRestore?: () => void;
  disabled?: boolean;
  /** The card grid. Ignored when `count` is 0. */
  children: ReactNode;
}

const SECTION_COPY: Record<CreateTarget, { title: string; empty: string }> = {
  hosted: {
    title: "Hosted",
    empty: "Projects that live in your account, reachable from any device.",
  },
  synked: {
    title: "Synked",
    empty: "Projects that stay on this device and keep a backup in Synk.",
  },
  lokal: {
    title: "Lokal",
    empty: "Projects that live only in this browser. Nothing leaves the device.",
  },
};

/**
 * One section of the projects page: a heading, a count, that section's creation
 * controls, and either its cards or an empty state.
 *
 * An empty section still renders. It is how the page teaches what the three
 * kinds ARE, and the empty state carries the same create control as the header
 * so the explanation and the action sit together.
 */
export function ProjectSection({
  target,
  count,
  onCreate,
  onImport,
  onRestore,
  disabled,
  children,
}: ProjectSectionProps) {
  const copy = SECTION_COPY[target];
  const menu = (
    <SectionCreateMenu
      target={target}
      onCreate={onCreate}
      onImport={onImport}
      onRestore={onRestore}
      disabled={disabled}
    />
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-baseline gap-2 text-lg font-semibold">
          {copy.title}
          <span className="text-sm font-normal text-muted-foreground">{count}</span>
        </h2>
        {menu}
      </div>

      {count === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">{copy.empty}</p>
          {menu}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
      )}
    </section>
  );
}
