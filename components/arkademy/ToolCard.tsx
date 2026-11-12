import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { Card } from "@/components/ui/card";

interface ToolCardProps {
  href: string;
  title: string;
  tagline: string;
  exampleCount: number;
}

/** One tool on the shell (`/arkademy`): the whole card links to the tool's cover. */
export function ToolCard({ href, title, tagline, exampleCount }: ToolCardProps) {
  return (
    <Link
      href={href}
      className="group block h-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card className="h-full gap-3 p-5 transition-colors group-hover:border-foreground/25">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{tagline}</p>
        <p className="mt-auto flex items-center gap-1 pt-2 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          {exampleCount} {exampleCount === 1 ? "example" : "examples"}
          <ChevronRightIcon aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </p>
      </Card>
    </Link>
  );
}
