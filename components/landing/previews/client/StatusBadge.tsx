"use client";

/**
 * `StatusBadge` is a plain component whose Radix tooltip needs its trigger
 * child created on the client: rendered straight from a server component, the
 * server-serialised `asChild` span fails hydration. This re-export moves the
 * client boundary one level up, which is all it takes.
 */
export { StatusBadge } from "@/components/layout/StatusBadge";
