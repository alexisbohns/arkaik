/**
 * The "boil" driver for the icon-wobble effect (issue #271).
 *
 * Static wobble is pure CSS (`app/wobble.generated.css`) and costs nothing at
 * rest. This module adds the *animated* part: while an icon is hovered or
 * keyboard-focused, its shared filter's `seed` is cycled through a short
 * ping-pong so the noise "boils", then snaps back to the resting seed on leave.
 *
 * Everything runs off a single set of delegated document listeners and one
 * `setInterval` per actively-boiling icon name — no per-instance React state,
 * no per-frame work when nothing is hovered/focused.
 *
 * The static wobble uses a shared `wob-<name>` filter (all instances identical
 * at rest). Boiling, however, is per-instance: a hovered icon is switched via
 * inline `style.filter` to a dedicated `wob-boil-<name>` filter that the driver
 * animates. So hovering one card in a grid boils only that card's icon, not
 * every other card that happens to use the same icon name.
 *
 * Hover/focus is resolved to a "scope": the nearest interactive *item* (a link,
 * button, menu/option, or a `[data-wobble-group]` wrapper), falling back to the
 * icon itself. So hovering anywhere on a sidebar row or Overview card row boils
 * the icon inside it — not just a direct hover of the glyph.
 */

import { BOIL_FPS, BOIL_SEED_STEPS, NO_WOBBLE_CLASS, WOBBLE_GROUP_ATTR } from "./constants";

type Reason = "hover" | "focus";

const ICON_SELECTOR = `svg.lucide:not(.${NO_WOBBLE_CLASS})`;
const BOIL_INTERVAL_MS = Math.round(1000 / BOIL_FPS);

/**
 * Interactive "items" whose hover/focus should boil the icons they contain.
 * Real elements + ARIA roles cover almost every icon-bearing item in the app;
 * `[data-wobble-group]` opts in the few clickable wrappers that lack a role.
 */
const GROUP_SELECTOR = [
  "a[href]",
  "button",
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
  "label",
  "summary",
  `[${WOBBLE_GROUP_ATTR}]`,
].join(",");

/** Icons currently held active, and by which signals (hover and/or focus). */
const active = new Map<Element, Set<Reason>>();
/** One interval per icon name currently boiling. */
const timers = new Map<string, ReturnType<typeof setInterval>>();

/** The `lucide-<name>` suffix of an icon's class list, or null. */
function iconName(svg: Element): string | null {
  for (const cls of svg.classList) {
    if (cls.startsWith("lucide-")) return cls.slice("lucide-".length);
  }
  return null;
}

/**
 * The `feTurbulence` of a name's *boil* filter (`wob-boil-<name>`). Only this
 * dedicated filter is animated; the shared static `wob-<name>` filter is never
 * touched, so un-hovered instances of the same icon are left undisturbed.
 */
function boilTurbulenceFor(name: string): Element | null {
  return document.getElementById(`wob-boil-${name}`)?.querySelector("feTurbulence") ?? null;
}

/** Point an icon at its boil filter (on) or back at the shared static one (off). */
function setBoilFilter(icon: Element, name: string, on: boolean): void {
  const style = (icon as SVGElement).style;
  if (!style) return;
  style.filter = on ? `url(#wob-boil-${name})` : "";
}

function anyActiveForName(name: string): boolean {
  for (const el of active.keys()) {
    if (iconName(el) === name) return true;
  }
  return false;
}

function startBoil(name: string): void {
  if (timers.has(name) || prefersReducedMotion.matches) return;
  const turbulence = boilTurbulenceFor(name);
  if (!turbulence) return;
  const base = Number(turbulence.getAttribute("data-base-seed") ?? "0");
  let step = 0;
  const timer = setInterval(() => {
    step = (step + 1) % BOIL_SEED_STEPS.length;
    turbulence.setAttribute("seed", String(base + BOIL_SEED_STEPS[step]));
  }, BOIL_INTERVAL_MS);
  timers.set(name, timer);
}

function stopBoil(name: string): void {
  const timer = timers.get(name);
  if (timer === undefined) return;
  clearInterval(timer);
  timers.delete(name);
  const turbulence = boilTurbulenceFor(name);
  if (turbulence) {
    turbulence.setAttribute("seed", turbulence.getAttribute("data-base-seed") ?? "0");
  }
}

function enter(icon: Element, reason: Reason): void {
  const name = iconName(icon);
  if (!name) return;
  let reasons = active.get(icon);
  if (!reasons) {
    reasons = new Set();
    active.set(icon, reasons);
  }
  reasons.add(reason);
  // Static wobble stays under reduced motion; don't switch to the boil filter.
  if (prefersReducedMotion.matches) return;
  setBoilFilter(icon, name, true);
  startBoil(name);
}

function leave(icon: Element, reason: Reason): void {
  const reasons = active.get(icon);
  if (!reasons) return;
  reasons.delete(reason);
  const name = iconName(icon);
  if (reasons.size === 0) {
    active.delete(icon);
    if (name) setBoilFilter(icon, name, false); // back to the shared static filter
  }
  if (name && !anyActiveForName(name)) stopBoil(name);
}

/** Icons at or within an element (a focusable/hoverable item may contain them). */
function iconsWithin(el: Element): Element[] {
  const icons: Element[] = [];
  if (el.matches(ICON_SELECTOR)) icons.push(el);
  el.querySelectorAll(ICON_SELECTOR).forEach((node) => icons.push(node));
  return icons;
}

/**
 * The hover/focus scope for a target: the nearest interactive item, or the icon
 * itself for a standalone glyph with no interactive ancestor (unchanged
 * direct-hover behaviour — no regression).
 */
function resolveScope(target: Element): Element | null {
  return target.closest(GROUP_SELECTOR) ?? target.closest(ICON_SELECTOR);
}

function onMouseOver(event: MouseEvent): void {
  const target = event.target as Element | null;
  const scope = target?.closest ? resolveScope(target) : null;
  if (!scope) return;
  for (const icon of iconsWithin(scope)) enter(icon, "hover");
}

function onMouseOut(event: MouseEvent): void {
  const target = event.target as Element | null;
  const scope = target?.closest ? resolveScope(target) : null;
  if (!scope) return;
  const related = event.relatedTarget as Node | null;
  // Ignore moves between the scope's own descendants.
  if (related && scope.contains(related)) return;
  for (const icon of iconsWithin(scope)) leave(icon, "hover");
}

function onFocusIn(event: FocusEvent): void {
  const el = event.target as Element | null;
  if (!el?.querySelectorAll) return;
  for (const icon of iconsWithin(el)) enter(icon, "focus");
}

function onFocusOut(event: FocusEvent): void {
  const el = event.target as Element | null;
  if (!el?.querySelectorAll) return;
  for (const icon of iconsWithin(el)) leave(icon, "focus");
}

// Live handle so newly-hovered icons respect a mid-session reduced-motion
// toggle; the change listener also stops any boil already running.
let prefersReducedMotion: MediaQueryList;

/** Stop every boil and revert active icons to the shared static filter. */
function clearAllBoils(): void {
  for (const name of [...timers.keys()]) stopBoil(name);
  for (const icon of active.keys()) {
    const name = iconName(icon);
    if (name) setBoilFilter(icon, name, false);
  }
}

function onReduceChange(): void {
  if (prefersReducedMotion.matches) clearAllBoils();
}

/**
 * Wire the delegated hover/focus listeners. Returns a cleanup that removes them,
 * clears every running boil, and resets seeds. Safe to call on the server (no-op).
 */
export function wireBoil(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  prefersReducedMotion.addEventListener("change", onReduceChange);

  document.addEventListener("mouseover", onMouseOver);
  document.addEventListener("mouseout", onMouseOut);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);

  return () => {
    document.removeEventListener("mouseover", onMouseOver);
    document.removeEventListener("mouseout", onMouseOut);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    prefersReducedMotion.removeEventListener("change", onReduceChange);
    clearAllBoils();
    active.clear();
  };
}
