"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenIcon, FolderTreeIcon, FileTextIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { DocsNavItem } from "@/lib/utils/docs";

interface DocsSidebarProps {
  items: DocsNavItem[];
}

interface FlatDocsNavItem {
  key: string;
  title: string;
  href?: string;
  depth: number;
}

function flattenItems(items: DocsNavItem[], depth = 0, parentKey = ""): FlatDocsNavItem[] {
  return items.flatMap((item, index) => {
    const key = `${parentKey}${parentKey ? "/" : ""}${item.title.toLowerCase().replace(/\s+/g, "-")}-${index}`;
    const current: FlatDocsNavItem = {
      key,
      title: item.title,
      href: item.href,
      depth,
    };

    const children = item.children ? flattenItems(item.children, depth + 1, key) : [];
    return [current, ...children];
  });
}

function normalizePath(pathname: string) {
  if (pathname.length <= 1) {
    return pathname;
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function isHrefActive(href: string, pathname: string) {
  const normalizedHref = normalizePath(href);
  const normalizedPath = normalizePath(pathname);

  if (normalizedHref === "/docs") {
    return normalizedPath === "/docs";
  }

  return normalizedPath === normalizedHref || normalizedPath.startsWith(`${normalizedHref}/`);
}

export function DocsSidebar({ items }: DocsSidebarProps) {
  const pathname = normalizePath(usePathname());
  const flatItems = flattenItems(items);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Documentation" isActive={pathname === "/docs"}>
              <Link href="/docs">
                <BookOpenIcon />
                <span>Documentation</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Pages</SidebarGroupLabel>
          <SidebarMenu>
            {flatItems.map((item) => {
              const active = item.href ? isHrefActive(item.href, pathname) : false;
              const icon = item.href ? FileTextIcon : FolderTreeIcon;
              const Icon = icon;

              if (item.href) {
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.title}
                      className="h-8"
                      style={{ paddingLeft: `${0.5 + item.depth * 0.85}rem` }}
                    >
                      <Link href={item.href}>
                        <Icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              }

              return (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    disabled
                    className="h-8 opacity-80"
                    style={{ paddingLeft: `${0.5 + item.depth * 0.85}rem` }}
                  >
                    <Icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
