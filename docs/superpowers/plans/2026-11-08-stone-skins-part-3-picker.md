# Stone skins — Part 3: pick your stones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each reader choose their light stone, dark stone and radius in Project Settings → Display, remembered in their browser and applied before first paint.

**Architecture:** A pure module (`lib/stones/preferences.ts`) parses, applies and boots the preference; a `useSyncExternalStore` hook (`useStonePreferences`) holds it for React; an inline `<head>` script applies the stored choice before paint; a `StonePicker` section joins `DisplayPreferencesPanel`.

**Tech Stack:** React 19 (`useSyncExternalStore`), Next.js App Router, Tailwind v4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-08-stone-skins-design.md`

**Branch:** `feat/stones-picker`, stacked on `feat/stones-special-actions` (Part 2).

---

### Task 8: The preference module

**Files:**
- Create: `lib/stones/preferences.ts`
- Test: `tests/app/stone-preferences.test.js`
- Modify: `package.json`, `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing test**

Create `tests/app/stone-preferences.test.js`:

```js
#!/usr/bin/env node

/**
 * The reader's stone preference (lib/stones/preferences.ts): parsing a stored
 * record key by key, applying it to <html>, and the inline boot script that
 * does the same before first paint.
 *
 * Transpiled like playlist-utils.test.js. preferences.ts imports the generated
 * registry by a relative path, so both are transpiled into the same build dir
 * and no alias rewriting is needed.
 */

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, `.test-build-stone-prefs-${process.pid}`);

function transpile(rel, outName) {
  const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: path.basename(rel),
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  fs.writeFileSync(path.join(BUILD_DIR, outName), outputText);
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));
transpile("lib/stones/stones-registry.generated.ts", "stones-registry.generated.js");
transpile("lib/stones/preferences.ts", "preferences.js");
const prefs = require(path.join(BUILD_DIR, "preferences.js"));
fs.rmSync(BUILD_DIR, { recursive: true, force: true });

const {
  DEFAULT_STONE_PREFERENCES: D,
  parseStonePreferences,
  applyStonePreferences,
  radiusValue,
  isDefaultStonePreferences,
  stoneBootScript,
  STONE_STORAGE_KEY,
} = prefs;

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${name}\n    ${error.message}`);
  }
}

function fakeRoot() {
  const attrs = {};
  const styleValues = {};
  return {
    attrs,
    styleValues,
    setAttribute: (k, v) => (attrs[k] = v),
    style: { setProperty: (k, v) => (styleValues[k] = v) },
  };
}

console.log("stone preferences");

test("defaults are Calacatta, Onyx and 12px", () => {
  assert.deepEqual(D, { light: "calacatta", dark: "onyx", radius: 12 });
  assert.ok(isDefaultStonePreferences(D));
});

test("anything that is not an object falls back to the defaults", () => {
  for (const raw of [null, undefined, "rosa", 7, true]) assert.deepEqual(parseStonePreferences(raw), D);
});

test("a valid record survives as is", () => {
  const p = { light: "rosa", dark: "lava", radius: 18 };
  assert.deepEqual(parseStonePreferences(p), p);
  assert.ok(!isDefaultStonePreferences(p));
});

test("each key degrades on its own", () => {
  assert.deepEqual(parseStonePreferences({ light: "granite", dark: "lava", radius: 4 }), { light: "calacatta", dark: "lava", radius: 4 });
  assert.deepEqual(parseStonePreferences({ light: "onyx", dark: "carrara", radius: 4 }), { light: "calacatta", dark: "onyx", radius: 4 });
  for (const radius of [-1, 19, Number.NaN, "8", null]) {
    assert.equal(parseStonePreferences({ light: "rosa", dark: "lava", radius }).radius, 12, `radius ${String(radius)}`);
  }
  assert.equal(parseStonePreferences({ radius: 7.6 }).radius, 8);
});

test("the top of the radius range is a pill", () => {
  assert.equal(radiusValue(0), "0px");
  assert.equal(radiusValue(12), "12px");
  assert.equal(radiusValue(18), "9999px");
});

test("applying writes both stones and the radius onto the root", () => {
  const root = fakeRoot();
  applyStonePreferences(root, { light: "rosequartz", dark: "amethyst", radius: 18 });
  assert.equal(root.attrs["data-stone-light"], "rosequartz");
  assert.equal(root.attrs["data-stone-dark"], "amethyst");
  assert.equal(root.styleValues["--stone-radius"], "9999px");
});

function runBoot(stored, { throws = false } = {}) {
  const root = fakeRoot();
  const context = {
    localStorage: {
      getItem: (key) => {
        if (throws) throw new Error("denied");
        assert.equal(key, STONE_STORAGE_KEY);
        return stored;
      },
    },
    document: { documentElement: root },
    JSON,
    Math,
  };
  vm.runInNewContext(stoneBootScript(), context);
  return root;
}

test("the boot script applies a stored choice", () => {
  const root = runBoot(JSON.stringify({ light: "travertine", dark: "lava", radius: 18 }));
  assert.equal(root.attrs["data-stone-light"], "travertine");
  assert.equal(root.attrs["data-stone-dark"], "lava");
  assert.equal(root.styleValues["--stone-radius"], "9999px");
});

test("the boot script ignores what it does not recognise", () => {
  const root = runBoot(JSON.stringify({ light: "granite", dark: "carrara", radius: 99 }));
  assert.deepEqual(root.attrs, {});
  assert.deepEqual(root.styleValues, {});
});

test("the boot script never throws", () => {
  assert.doesNotThrow(() => runBoot("{not json"));
  assert.doesNotThrow(() => runBoot(null));
  assert.doesNotThrow(() => runBoot(null, { throws: true }));
});

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
```

Add to `package.json` directly after `"test:stones"`:

```json
    "test:stone-preferences": "node tests/app/stone-preferences.test.js",
```

and to `.github/workflows/ci.yml` directly after the "Stone skin tests" step:

```yaml
      - name: Stone preference tests
        run: npm run test:stone-preferences
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:stone-preferences`
Expected: FAIL with `ENOENT ... lib/stones/preferences.ts`.

- [ ] **Step 3: Write the module**

Create `lib/stones/preferences.ts`:

```ts
import { DEFAULT_STONES, STONES, type StoneSide } from "./stones-registry.generated";

/**
 * The reader's stone skin: one light stone, one dark stone, and the radius of
 * stone buttons and sidebar rows (docs/superpowers/specs/2026-11-08-stone-skins-design.md).
 *
 * Held in this browser, not in the bundle, for the reason display preferences
 * are: it is the taste of the person reading, not a fact about the product.
 * Global rather than per project, because the stones are Arkaik's own material.
 */
export interface StonePreferences {
  light: string;
  dark: string;
  radius: number;
}

export const STONE_STORAGE_KEY = "arkaik:stones";
export const RADIUS_MIN = 0;
/** The top of the range reads as "pill": fully rounded at any height. */
export const RADIUS_MAX = 18;
export const RADIUS_DEFAULT = 12;

export const DEFAULT_STONE_PREFERENCES: StonePreferences = {
  light: DEFAULT_STONES.light,
  dark: DEFAULT_STONES.dark,
  radius: RADIUS_DEFAULT,
};

export function stoneIds(side: StoneSide): string[] {
  return STONES.filter((s) => s.side === side).map((s) => s.id);
}

/**
 * Reads a stored record key by key: an unknown stone or an out-of-range radius
 * falls back to its own default without discarding the rest, so a stone
 * removed in a later release costs the reader only that one choice.
 */
export function parseStonePreferences(raw: unknown): StonePreferences {
  if (typeof raw !== "object" || raw === null) return DEFAULT_STONE_PREFERENCES;
  const record = raw as Record<string, unknown>;
  const pick = (side: StoneSide): string => {
    const value = record[side];
    return typeof value === "string" && stoneIds(side).includes(value) ? value : DEFAULT_STONE_PREFERENCES[side];
  };
  const r = record.radius;
  const radius =
    typeof r === "number" && Number.isFinite(r) && r >= RADIUS_MIN && r <= RADIUS_MAX ? Math.round(r) : RADIUS_DEFAULT;
  return { light: pick("light"), dark: pick("dark"), radius };
}

export function radiusValue(radius: number): string {
  return radius >= RADIUS_MAX ? "9999px" : `${radius}px`;
}

export function isDefaultStonePreferences(p: StonePreferences): boolean {
  return (
    p.light === DEFAULT_STONE_PREFERENCES.light &&
    p.dark === DEFAULT_STONE_PREFERENCES.dark &&
    p.radius === DEFAULT_STONE_PREFERENCES.radius
  );
}

/** What app/stones.css and stones.generated.css read: two attributes and one custom property on <html>. */
export function applyStonePreferences(
  root: Pick<HTMLElement, "setAttribute"> & { style: Pick<CSSStyleDeclaration, "setProperty"> },
  p: StonePreferences,
): void {
  root.setAttribute("data-stone-light", p.light);
  root.setAttribute("data-stone-dark", p.dark);
  root.style.setProperty("--stone-radius", radiusValue(p.radius));
}

/**
 * The inline <head> script that applies a stored choice before first paint,
 * the way next-themes applies the theme. Self-contained (no imports at run
 * time), it only ever sets a value it recognises, and swallows every error:
 * the server-rendered defaults are always a valid skin.
 */
export function stoneBootScript(): string {
  const light = JSON.stringify(stoneIds("light"));
  const dark = JSON.stringify(stoneIds("dark"));
  return (
    `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(STONE_STORAGE_KEY)})||"null");` +
    `if(!p||typeof p!=="object")return;var d=document.documentElement;` +
    `if(${light}.indexOf(p.light)>=0)d.setAttribute("data-stone-light",p.light);` +
    `if(${dark}.indexOf(p.dark)>=0)d.setAttribute("data-stone-dark",p.dark);` +
    `var r=p.radius;if(typeof r==="number"&&r>=${RADIUS_MIN}&&r<=${RADIUS_MAX})` +
    `d.style.setProperty("--stone-radius",r>=${RADIUS_MAX}?"9999px":Math.round(r)+"px");` +
    `}catch(e){}})();`
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:stone-preferences && npx tsc --noEmit`
Expected: nine `✓` lines; no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/stones/preferences.ts tests/app/stone-preferences.test.js package.json .github/workflows/ci.yml
git commit -m "feat(stones): parse, apply and boot the reader's stone preference"
```

---

### Task 9: The hook and the boot script

**Files:**
- Create: `lib/hooks/useStonePreferences.ts`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Write the hook**

Create `lib/hooks/useStonePreferences.ts`:

```ts
"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  DEFAULT_STONE_PREFERENCES,
  STONE_STORAGE_KEY,
  applyStonePreferences,
  parseStonePreferences,
  type StonePreferences,
} from "@/lib/stones/preferences";

/**
 * A module store read through `useSyncExternalStore`, the same shape as
 * `useDisplayPreferences`: SSR renders the defaults (localStorage does not
 * exist there), hydration re-reads the real store, and every subscriber agrees
 * the instant a choice changes — `setItem` fires no `storage` event in the tab
 * that wrote it. Writing also re-applies the skin to <html>, so the whole app
 * changes stone without a reload.
 */
let cache: StonePreferences | null = null;
const listeners = new Set<() => void>();

function read(): StonePreferences {
  if (typeof window === "undefined") return DEFAULT_STONE_PREFERENCES;
  try {
    const stored = window.localStorage.getItem(STONE_STORAGE_KEY);
    return stored ? parseStonePreferences(JSON.parse(stored)) : DEFAULT_STONE_PREFERENCES;
  } catch {
    return DEFAULT_STONE_PREFERENCES;
  }
}

function getSnapshot(): StonePreferences {
  if (!cache) cache = read();
  return cache;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: StonePreferences, remember: boolean) {
  cache = next;
  try {
    if (remember) window.localStorage.setItem(STONE_STORAGE_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(STONE_STORAGE_KEY);
  } catch {
    // Best-effort: the skin changes now, it just won't be remembered.
  }
  applyStonePreferences(document.documentElement, next);
  for (const listener of listeners) listener();
}

export function useStonePreferences(): {
  preferences: StonePreferences;
  update: (patch: Partial<StonePreferences>) => void;
  reset: () => void;
} {
  const preferences = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_STONE_PREFERENCES);
  const update = useCallback((patch: Partial<StonePreferences>) => commit({ ...getSnapshot(), ...patch }, true), []);
  const reset = useCallback(() => commit(DEFAULT_STONE_PREFERENCES, false), []);
  return { preferences, update, reset };
}
```

- [ ] **Step 2: Boot before paint**

In `app/layout.tsx`, add the import:

```tsx
import { stoneBootScript } from "@/lib/stones/preferences";
```

and add a `<head>` as the first child of `<html>` (before `<body>`):

```tsx
      <head>
        {/* Applies the reader's stones before first paint (lib/stones/preferences.ts). */}
        <script dangerouslySetInnerHTML={{ __html: stoneBootScript() }} />
      </head>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/hooks/useStonePreferences.ts app/layout.tsx
git commit -m "feat(stones): remember the reader's stones and apply them before paint"
```

---

### Task 10: The Stones picker

**Files:**
- Create: `components/settings/StonePicker.tsx`
- Modify: `components/settings/DisplayPreferencesPanel.tsx`

- [ ] **Step 1: Write the picker**

Create `components/settings/StonePicker.tsx`:

```tsx
"use client";

import type { CSSProperties } from "react";
import { PyramidIcon, RouteIcon, SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useStonePreferences } from "@/lib/hooks/useStonePreferences";
import { RADIUS_MAX, RADIUS_MIN, isDefaultStonePreferences } from "@/lib/stones/preferences";
import { STONES, type StoneEntry, type StoneSide } from "@/lib/stones/stones-registry.generated";
import { cn } from "@/lib/utils";

const swatch = (s: StoneEntry): CSSProperties => ({
  background: `url("/stones/${s.id}.svg") 0 0 / ${s.size}px ${s.size}px, ${s.base}`,
});

function StoneChoices({ side, value, onChange }: { side: StoneSide; value: string; onChange: (id: string) => void }) {
  const label = side === "light" ? "Light stone" : "Dark stone";
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      {STONES.filter((s) => s.side === side).map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={value === s.id}
          onClick={() => onChange(s.id)}
          className={cn(
            "inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border bg-background pl-1.5 pr-3 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
            value === s.id && "border-foreground text-foreground",
          )}
        >
          <span aria-hidden="true" className="size-5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)]" style={swatch(s)} />
          {s.name}
        </button>
      ))}
    </div>
  );
}

/**
 * One theme's roles, forced on a subtree by `.stone-scope-light|dark`. The
 * icon gradient is local to the pane: a gradient's stops resolve where the
 * gradient is defined, so the shared `#stone-icon` would show the current
 * theme's tone in both panes.
 */
function PreviewPane({ mode }: { mode: "light" | "dark" }) {
  const gradientId = `stone-icon-preview-${mode}`;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border p-3",
        mode === "light"
          ? "stone-scope-light border-zinc-200 bg-white text-zinc-950"
          : "stone-scope-dark border-zinc-800 bg-zinc-900 text-zinc-50",
      )}
      style={{ "--stone-icon-paint": `url(#${gradientId})` } as CSSProperties}
    >
      <svg aria-hidden="true" width="0" height="0" className="absolute">
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="8" y2="24">
          <stop offset="0" style={{ stopColor: "var(--stone-icon-1)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--stone-icon-2)" }} />
          <stop offset="1" style={{ stopColor: "var(--stone-icon-3)" }} />
        </linearGradient>
      </svg>
      <span className="w-full font-mono text-[10px] uppercase tracking-wider opacity-60">{mode}</span>
      <Button type="button" size="sm" variant="stone" tabIndex={-1}>
        <SparklesIcon />
        Primary
      </Button>
      <Button type="button" size="sm" variant="stone-secondary" tabIndex={-1}>
        <RouteIcon />
        Secondary
      </Button>
      <div
        data-sidebar="menu-button"
        data-active="true"
        className="flex h-8 items-center gap-2 rounded-[min(var(--stone-radius),15px)] px-2 text-sm font-medium [&>svg]:size-4"
      >
        <PyramidIcon />
        <span>Pyramid</span>
      </div>
    </div>
  );
}

/**
 * The reader's stones: which light and dark stone Arkaik wears, and how round
 * its stone buttons and sidebar rows are. Applies to every project in this
 * browser, which is why it says so — everything else on this page is per project.
 */
export function StonePicker() {
  const { preferences, update, reset } = useStonePreferences();
  const radiusLabel = preferences.radius >= RADIUS_MAX ? "pill" : `${preferences.radius}px`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Stones</p>
          <p className="text-sm text-muted-foreground">
            The material on special actions, the active sidebar row and ticked boxes. The dark stone leads in
            light mode and the light stone in dark mode. Applies to every project in this browser.
          </p>
        </div>
        {!isDefaultStonePreferences(preferences) && (
          <button
            type="button"
            onClick={reset}
            className="shrink-0 cursor-pointer text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Reset to default
          </button>
        )}
      </div>
      <StoneChoices side="light" value={preferences.light} onChange={(light) => update({ light })} />
      <StoneChoices side="dark" value={preferences.dark} onChange={(dark) => update({ dark })} />
      <label className="flex items-center gap-1.5">
        <span className="w-24 shrink-0 text-xs text-muted-foreground">Radius</span>
        <input
          type="range"
          min={RADIUS_MIN}
          max={RADIUS_MAX}
          step={1}
          value={preferences.radius}
          aria-valuetext={radiusLabel}
          onChange={(event) => update({ radius: Number(event.target.value) })}
          className="w-40 cursor-pointer accent-foreground"
        />
        <output className="ml-2 font-mono text-xs tabular-nums">{radiusLabel}</output>
      </label>
      <div aria-hidden="true" className="grid gap-2 sm:grid-cols-2">
        <PreviewPane mode="light" />
        <PreviewPane mode="dark" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add it to the Display panel**

In `components/settings/DisplayPreferencesPanel.tsx`, add the import:

```tsx
import { StonePicker } from "@/components/settings/StonePicker";
```

and render it as the last child of the outer `<div className="flex flex-col gap-3 rounded-lg border p-4">`, separated by a rule:

```tsx
      <div className="border-t pt-3">
        <StonePicker />
      </div>
```

Extend the panel's doc comment by one sentence at the end: `The Stones section is the exception to "per project": the stones are Arkaik's own material, so that choice applies to every project in this browser.`

- [ ] **Step 3: Verify**

Run: `npm run generate && git status --short`
Expected: the only changes are this task's files — plus, if the picker's icons were new to the app, `lib/wobble/wobble-registry.generated.ts` and `app/wobble.generated.css`. Stage those too.

Run: `npx tsc --noEmit && npm run lint && npm run test:stones && npm run test:stone-preferences && npm run build`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add components/settings/StonePicker.tsx components/settings/DisplayPreferencesPanel.tsx lib/wobble/wobble-registry.generated.ts app/wobble.generated.css
git commit -m "feat(stones): pick your stones and radius in Settings → Display"
```

---

### Task 11: Visual check and PR (controller)

- [ ] **Step 1:** Playwright on a project's Settings page: pick Rose Quartz + Amethyst and radius "pill"; check the previews and the real sidebar row change at once; reload and check there is no flash of Calacatta/Onyx (screenshot right after `domcontentloaded`); Reset to default returns to Calacatta + Onyx and 12px and hides the link.
- [ ] **Step 2:** Push and open the PR stacked on Part 2, "feat(stones): pick your stones (part 3/3)", with this Lab Note:

````markdown
## Lab Note

```yaml
en:
  title: "Pick your stones"
  summary: "Choose the light and dark stones Arkaik wears, from Carrara to Amethyst, and how round its buttons get, in Settings → Display. Your pick follows you across every project in this browser."
fr:
  title: "Choisis tes pierres"
  summary: "Choisis les pierres claire et sombre que porte Arkaik, du Carrare à l'améthyste, et l'arrondi de ses boutons, dans Réglages → Affichage. Ton choix te suit dans tous tes projets sur ce navigateur."
nodes: [V-project-settings]
suggested:
  molecule: arkaik
  type: feature
  tags: [design, settings]
```
````

- [ ] **Step 3:** Read the PR's comments for the Lab Note reminder and fix the body if it flags anything.
