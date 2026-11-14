"use client";

/**
 * The project sidebar's two navigations, one per look (`data-panel-look`).
 * ProjectSidebar renders BOTH and app/m3/sidebar.css shows the one the look
 * asks for: the attribute is set before first paint, so a Calm reader never
 * sees the Expressive nav flash in, which a look read in React would do.
 *
 * - **Expressive — tiles.** Project and Quality as launch tiles, the Library
 *   as a mosaic of species tiles, each group a CONNECTED tile group (22px on
 *   the group's outer corners, 5px at every joint, a 3px seam). Maps stays a
 *   list. Collapsed, the tiles become plain rail icons.
 * - **Calm — a tree that folds.** Maps hang under "All maps", the four
 *   library species under "All nodes"; every group label folds its group,
 *   keeping the active row in view.
 *
 * Both render the model (components/layout/sidebar-nav-model.ts) and never
 * re-derive which row is active.
 */
import Link from "next/link";
import { useId, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { SidebarNavGroup, SidebarNavItem, SidebarNavModel } from "@/components/layout/sidebar-nav-model";
import { SpeciesShape } from "@/components/panels/species-shape";
type Model = SidebarNavModel;

function Row({ item, model }: { item: SidebarNavItem; model: Model }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={item.active} tooltip={item.tooltip} data-nav-item={item.id} data-species={item.species}>
        <Link href={item.href} onClick={model.onItemClick(item)}>
          <item.Icon />
          <span>{item.label}</span>
          {model.renderHint(item)}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Where each tile sits in a two-column grid whose first tile may span the
 * row, and which of its corners are the GROUP's outer corners. A last tile
 * left alone on its row spans it too, so the group stays a clean block.
 */
function layout(count: number, leadSpans: boolean) {
  const cells: { row: number; col: 0 | 1; span: boolean }[] = [];
  let row = 0;
  let col: 0 | 1 = 0;
  for (let i = 0; i < count; i++) {
    const remaining = count - i;
    const span = (i === 0 && leadSpans) || (col === 0 && remaining === 1);
    cells.push({ row, col, span });
    if (span || col === 1) {
      row += 1;
      col = 0;
    } else col = 1;
  }
  const lastRow = cells.length ? cells[cells.length - 1].row : 0;
  return cells.map((c) => {
    const left = c.span || c.col === 0;
    const right = c.span || c.col === 1;
    const corners = [
      c.row === 0 && left && "tl",
      c.row === 0 && right && "tr",
      c.row === lastRow && left && "bl",
      c.row === lastRow && right && "br",
    ].filter(Boolean);
    return { span: c.span, corners: corners.join(" ") };
  });
}

function TileGroup({ group, model, kind }: { group: SidebarNavGroup; model: Model; kind: "launch" | "mosaic" }) {
  const leadSpans = kind === "mosaic" ? !group.items[0]?.species : group.items.length % 2 === 1;
  const cells = layout(group.items.length, leadSpans);
  return (
    <SidebarGroup data-sb-group={group.id}>
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarMenu className={`ps-l-tiles ${kind === "launch" ? "ps-tiles" : "ps-mosaic"}`} data-ps-l-tiles={kind}>
        {group.items.map((item, i) => {
          const cell = cells[i];
          const wide = cell.span && (kind === "launch" ? i === 0 : !item.species);
          return (
            <SidebarMenuItem
              key={item.id}
              className={kind === "mosaic" && wide ? "ps-mosaic-wide" : undefined}
              data-ps-l-span={cell.span ? "" : undefined}
              data-ps-l-wide={wide ? "" : undefined}
            >
              <SidebarMenuButton
                asChild
                isActive={item.active}
                tooltip={item.tooltip}
                data-nav-item={item.id}
                data-species={item.species}
                data-ps-l-corners={cell.corners}
                className={kind === "launch" ? "ps-tile" : "ps-mosaic-tile"}
              >
                <Link href={item.href} onClick={model.onItemClick(item)}>
                  <item.Icon />
                  <span>{item.label}</span>
                  {kind === "mosaic" && item.species ? <SpeciesShape species={item.species} className="ps-mosaic-shape" /> : null}
                  {model.renderHint(item)}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

export function SidebarNavTiles({ model }: { model: SidebarNavModel }) {
  return (
    <div data-sb-nav="tiles">
      {model.groups.map((group) =>
        group.id === "project" || group.id === "quality" ? (
          <TileGroup key={group.id} group={group} model={model} kind="launch" />
        ) : group.id === "library" ? (
          <TileGroup key={group.id} group={group} model={model} kind="mosaic" />
        ) : (
          <SidebarGroup key={group.id} data-sb-group={group.id}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => (
                <Row key={item.id} item={item} model={model} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ),
      )}
    </div>
  );
}

// ── Calm: the tree that folds ──────────────────────────────────────────────

/** Which rows hang under their group's "All …" row. Acceptances and Decisions are pages of their own, so they stay top-level. */
const TREE: Partial<Record<SidebarNavGroup["id"], { parent: string; child: (item: SidebarNavItem) => boolean }>> = {
  maps: { parent: "maps", child: () => true },
  library: {
    parent: "library",
    child: (item) => item.species !== undefined && item.species !== "acceptance" && item.species !== "decision",
  },
};

function FoldRow({ item, model, folded }: { item: SidebarNavItem; model: Model; folded: boolean }) {
  return (
    <SidebarMenuItem data-ps-c-fold-hidden={folded ? "" : undefined}>
      <SidebarMenuButton asChild isActive={item.active} tooltip={item.tooltip} data-nav-item={item.id} data-species={item.species}>
        <Link href={item.href} onClick={model.onItemClick(item)}>
          <item.Icon />
          <span>{item.label}</span>
          {model.renderHint(item)}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * The tree, with every group label a fold toggle. A folded group keeps its
 * active row (you never lose your place): when that row hangs in a branch,
 * the branch's parent row steps aside and the active child shows alone.
 */
export function SidebarNavTree({ model }: { model: SidebarNavModel }) {
  const { state, isMobile } = useSidebar();
  const rail = state === "collapsed" && !isMobile;
  const baseId = useId();
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div data-sb-nav="tree" data-ps-c-nav="treefold">
      {model.groups.map((group) => {
        const isFolded = !rail && folded.has(group.id);
        const hidden = isFolded ? group.items.filter((i) => !i.active).length : 0;
        const listId = `${baseId}-${group.id}`;
        const tree = TREE[group.id];
        const parent = tree && group.items.find((i) => i.id === tree.parent);
        const others = parent ? group.items.filter((i) => i !== parent) : group.items;
        const children = tree && parent ? others.filter(tree.child) : [];
        const rest = tree && parent ? others.filter((i) => !tree.child(i)) : group.items;
        const childActive = children.some((i) => i.active);
        return (
          <SidebarGroup key={group.id} data-sb-group={group.id} data-ps-c-folded={isFolded ? "" : undefined}>
            <SidebarGroupLabel asChild>
              <button
                type="button"
                data-ps-c-fold-label=""
                aria-expanded={!isFolded}
                aria-controls={listId}
                tabIndex={rail ? -1 : undefined}
                onClick={() => toggle(group.id)}
              >
                <span>{group.label}</span>
                {hidden > 0 ? (
                  <span data-ps-c-fold-count="" aria-label={`${hidden} hidden`}>
                    +{hidden}
                  </span>
                ) : null}
                <ChevronDownIcon data-ps-c-fold-chevron="" aria-hidden="true" />
              </button>
            </SidebarGroupLabel>
            <SidebarMenu id={listId}>
              {parent ? (
                <SidebarMenuItem
                  data-ps-c-fold-hidden={isFolded && !parent.active && !childActive ? "" : undefined}
                  data-ps-l-fold-orphan={isFolded && !parent.active && childActive ? "" : undefined}
                >
                  <SidebarMenuButton
                    asChild
                    isActive={parent.active}
                    tooltip={parent.tooltip}
                    data-nav-item={parent.id}
                    data-species={parent.species}
                  >
                    <Link href={parent.href} onClick={model.onItemClick(parent)}>
                      <parent.Icon />
                      <span>{parent.label}</span>
                      {model.renderHint(parent)}
                    </Link>
                  </SidebarMenuButton>
                  <SidebarMenu data-ps-c-branch="">
                    {children.map((item) => (
                      <FoldRow key={item.id} item={item} model={model} folded={isFolded && !item.active} />
                    ))}
                  </SidebarMenu>
                </SidebarMenuItem>
              ) : null}
              {rest.map((item) => (
                <FoldRow key={item.id} item={item} model={model} folded={isFolded && !item.active} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        );
      })}
    </div>
  );
}
