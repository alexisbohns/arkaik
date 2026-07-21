"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { PlatformGaugeList } from "@/components/graph/nodes/PlatformGaugeList";
import { ValueIcon } from "@/components/values/ValueBadge";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import { VALUES, VALUE_TIERS_CONFIG } from "@/lib/config/values";
import { computePyramidAggregation } from "@/lib/utils/pyramid";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProject } from "@/lib/hooks/useProject";

const VALUE_LABEL = new Map(VALUES.map((v) => [v.id, v.label]));
const VALUE_DESCRIPTION = new Map(VALUES.map((v) => [v.id, v.description]));
const TIER_LABEL = new Map(VALUE_TIERS_CONFIG.map((t) => [t.id, t.label]));

/**
 * The Pyramid: "How well is each value element delivered?" — the value-delivery
 * radar (spec §9.2). Element gauge grid (layout B): four tier sections, each a
 * grid of element cards (icon + label + per-platform gauge + acceptance count).
 * A platform chip row recomputes the gauges; an element links to the Acceptance
 * matrix pre-filtered on that value.
 */
export default function PyramidPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const [platform, setPlatform] = useState<PlatformId | "all">("all");
  const gaugePlatforms = platform === "all" ? PLATFORMS.map((p) => p.id) : [platform];
  const { nodes: dataNodes, loading } = useNodes(id);
  const { project: projectBundle } = useProject(id);

  const acceptances = useMemo(() => dataNodes.filter((node) => node.species === "acceptance"), [dataNodes]);
  const tiers = useMemo(
    () => computePyramidAggregation(acceptances, platform === "all" ? undefined : platform),
    [acceptances, platform],
  );

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading pyramid...</span>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <SidebarTrigger className="-ml-1 cursor-pointer" />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{projectBundle?.project.title ?? "Untitled project"}</p>
          <p className="truncate text-xs text-muted-foreground">Value pyramid</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Platform</span>
            <Button type="button" size="sm" variant={platform === "all" ? "default" : "outline"} aria-pressed={platform === "all"} onClick={() => setPlatform("all")}>
              All
            </Button>
            {PLATFORMS.map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={platform === option.id ? "default" : "outline"}
                aria-pressed={platform === option.id}
                onClick={() => setPlatform(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {tiers.map((tier) => (
            <section key={tier.tier} className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">{TIER_LABEL.get(tier.tier)}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {tier.elements.map((element) => {
                  const served = element.acceptanceCount > 0;
                  return (
                    <Link
                      key={element.value}
                      href={`/project/${id}/acceptances?value=${element.value}`}
                      className={`flex flex-col gap-2 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40 ${served ? "" : "opacity-50"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <ValueIcon valueId={element.value} className="size-4 text-muted-foreground" />
                          <span className="truncate">{VALUE_LABEL.get(element.value)}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{element.acceptanceCount}</span>
                      </div>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{VALUE_DESCRIPTION.get(element.value)}</p>
                      <PlatformGaugeList rollup={element.rollup} platforms={gaugePlatforms} compact />
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
