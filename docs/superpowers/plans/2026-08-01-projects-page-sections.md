# Projects Page Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `/projects` into Hosted, Synked and Lokal sections, each with its own creation controls that produce that kind of project, and show the Synk backup callout only when a local un-backed-up project exists.

**Architecture:** Two decisions are extracted from the page component into pure, dependency-injected modules so Node can test them without a DOM: `lib/data/project-sections.ts` (which bucket a project belongs to) and `lib/data/create-target.ts` (what "create" means per bucket). `app/projects/page.tsx` becomes a thin consumer of both, owns the single `/api/synk/projects` fetch, and renders three `<ProjectSection>` blocks. `SynkOnboardingBanner` loses its own fetch and takes the backup id set as a prop.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, TypeScript, Tailwind v4, shadcn/ui (`button`, `dropdown-menu`, `card`), lucide-react icons, sonner toasts. Tests are plain Node scripts (`node tests/**/*.test.js`) that transpile TypeScript on the fly with the `typescript` package — there is **no** vitest/jest/Testing Library in this repo, so do not reach for one.

**Spec:** `docs/superpowers/specs/2026-08-01-projects-page-sections-design.md`

**Branch:** `projects-page-sections` (already created; the spec commit is on it).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/data/project-sections.ts` | **Create.** Pure bucketing: `ProjectSection`, `sectionFor`, `groupBySection`. No I/O. |
| `lib/data/create-target.ts` | **Create.** Pure creation routing: `CreateTarget`, `parseCreateTarget`, `createInTarget` with injected effects. No I/O of its own. |
| `tests/data/load-project-sections.js` | **Create.** Transpile-and-require loader for the two modules above. |
| `tests/data/project-sections.test.js` | **Create.** Unit tests for `sectionFor` / `groupBySection`. |
| `tests/data/create-target.test.js` | **Create.** Unit tests for `parseCreateTarget` / `createInTarget`. |
| `lib/utils/export.ts` | **Modify.** Extract and export `parseBundleFromFile(file)` so the hosted import path can get a bundle without writing it locally. |
| `components/projects/SectionCreateMenu.tsx` | **Create.** The split button + dropdown for one section. |
| `components/projects/ProjectSection.tsx` | **Create.** One section: heading, count, create menu, card grid or empty state. |
| `components/projects/ProjectCard.tsx` | **Create.** The existing card body, lifted out of the page verbatim minus the hosted badge. |
| `app/projects/page.tsx` | **Modify.** Owns the backup-id fetch and `syncManager` subscription, groups, renders three sections, handles `?import=`. |
| `components/sync/SynkOnboardingBanner.tsx` | **Modify.** Takes `backedUpIds` as a prop; drops its own fetch and subscription. |
| `app/generate/page.tsx` | **Modify.** Reads `?target=`, shows a destination line, and links back with `?import=`. |
| `package.json` | **Modify.** Add `test:project-sections` script. |
| `.github/workflows/ci.yml` | **Modify.** Run the new script in the fast `build` job. |

---

### Task 1: The bucketing module

**Files:**
- Create: `lib/data/project-sections.ts`
- Create: `tests/data/load-project-sections.js`
- Create: `tests/data/project-sections.test.js`
- Modify: `package.json` (scripts)
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the loader**

This mirrors `tests/data/load-provider-registry.js` but is far simpler: both
modules under test import only types (`import type` erases at transpile time),
so nothing needs stubbing.

Create `tests/data/load-project-sections.js`:

```js
/**
 * Loads lib/data/project-sections.ts and lib/data/create-target.ts into a
 * running Node process without a bundler — same transpile-on-the-fly approach
 * as the other tests/data loaders.
 *
 * Neither module has a runtime import: their `./data-provider` and `./types`
 * imports are `import type`, which erase. So there is nothing to stub, and the
 * code under test here is the real code, byte for byte.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-project-sections");

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
};

function transpile(srcAbsPath, fileName) {
  const source = fs.readFileSync(srcAbsPath, "utf8");
  return ts.transpileModule(source, { fileName, compilerOptions: COMPILER_OPTIONS }).outputText;
}

function loadProjectSections() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const write = (name, text) => fs.writeFileSync(path.join(BUILD_DIR, name), text);
  write(
    "project-sections.js",
    transpile(path.join(ROOT, "lib", "data", "project-sections.ts"), "project-sections.ts")
  );
  write(
    "create-target.js",
    transpile(path.join(ROOT, "lib", "data", "create-target.ts"), "create-target.ts")
  );

  for (const name of fs.readdirSync(BUILD_DIR)) {
    if (name.endsWith(".js")) delete require.cache[path.join(BUILD_DIR, name)];
  }

  const req = (name) => require(path.join(BUILD_DIR, name));
  return { sections: req("project-sections.js"), createTarget: req("create-target.js") };
}

module.exports = { loadProjectSections, BUILD_DIR };
```

- [ ] **Step 2: Write the failing test**

Create `tests/data/project-sections.test.js`:

```js
#!/usr/bin/env node

/**
 * Which section a project belongs to (lib/data/project-sections.ts).
 *
 * There are only TWO storage backends — hosted and local. "Synked" is a state
 * of a local project (it has a Synk backup), not a third backend. These tests
 * pin that rule, and in particular that a signed-out session — where the backup
 * set is empty — collapses every local project into Lokal.
 */

const fs = require("fs");
const { loadProjectSections, BUILD_DIR } = require("./load-project-sections");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const summary = (id, hosted) => ({
  project: { id, title: id },
  nodeCount: 0,
  edgeCount: 0,
  hosted,
});

function main() {
  const { sections } = loadProjectSections();
  const { sectionFor, groupBySection } = sections;

  const hosted = summary("prj_abc", true);
  const backedUp = summary("local-1", false);
  const plain = summary("local-2", false);
  const backups = new Set(["local-1"]);

  check("hosted project is hosted", sectionFor(hosted, backups) === "hosted");
  check(
    "hosted project stays hosted even if its id is in the backup set",
    sectionFor(summary("prj_abc", true), new Set(["prj_abc"])) === "hosted"
  );
  check("local project with a backup is synked", sectionFor(backedUp, backups) === "synked");
  check("local project without a backup is lokal", sectionFor(plain, backups) === "lokal");
  check(
    "empty backup set collapses locals into lokal",
    sectionFor(backedUp, new Set()) === "lokal" && sectionFor(plain, new Set()) === "lokal"
  );

  const grouped = groupBySection([hosted, backedUp, plain], backups);
  check("groupBySection puts hosted in hosted", grouped.hosted.length === 1 && grouped.hosted[0] === hosted);
  check("groupBySection puts backed-up local in synked", grouped.synked.length === 1 && grouped.synked[0] === backedUp);
  check("groupBySection puts plain local in lokal", grouped.lokal.length === 1 && grouped.lokal[0] === plain);

  const ordered = groupBySection(
    [summary("local-a", false), summary("local-b", false), summary("local-c", false)],
    new Set()
  );
  check(
    "groupBySection preserves input order within a bucket",
    ordered.lokal.map((s) => s.project.id).join(",") === "local-a,local-b,local-c"
  );

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  console.log(failures === 0 ? "\nAll project-section tests passed." : `\n${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node tests/data/project-sections.test.js`
Expected: FAIL — the loader throws `ENOENT ... lib/data/project-sections.ts`.

(Note: the loader also transpiles `create-target.ts`, which does not exist yet
either. For this step only, that is the same class of failure and expected. Task 2
creates it. If you prefer a clean red, create `lib/data/create-target.ts` as an
empty file now and fill it in during Task 2.)

- [ ] **Step 4: Write the implementation**

Create `lib/data/project-sections.ts`:

```ts
import type { ProjectSummary } from "./data-provider";

/**
 * The three groups the projects page shows.
 *
 * Note there are only TWO storage backends behind these: hosted (the account)
 * and local (this browser). "Synked" is a *state* of a local project — it has a
 * Synk backup on the server — not a third place data can live. That is the
 * whole local-first promise: signing in and backing up adds a copy, it never
 * moves your data.
 */
export type ProjectSection = "hosted" | "synked" | "lokal";

/**
 * Which section a project belongs to.
 *
 * Takes the set of backed-up project ids as an argument rather than fetching
 * it, so this stays a pure function of its inputs — testable in Node with no
 * DOM, no Dexie and no network. The caller (`app/projects/page.tsx`) owns the
 * single `/api/synk/projects` fetch that produces the set.
 *
 * Signed out, the caller passes an empty set and every local project is Lokal,
 * which is exactly right: without an account there are no backups to have.
 */
export function sectionFor(summary: ProjectSummary, backedUpIds: Set<string>): ProjectSection {
  if (summary.hosted) return "hosted";
  return backedUpIds.has(summary.project.id) ? "synked" : "lokal";
}

/** A project list split into the three sections, input order preserved within each. */
export interface GroupedProjects {
  hosted: ProjectSummary[];
  synked: ProjectSummary[];
  lokal: ProjectSummary[];
}

/** Split a project list into its three sections in one pass. */
export function groupBySection(
  summaries: ProjectSummary[],
  backedUpIds: Set<string>
): GroupedProjects {
  const grouped: GroupedProjects = { hosted: [], synked: [], lokal: [] };
  for (const summary of summaries) {
    grouped[sectionFor(summary, backedUpIds)].push(summary);
  }
  return grouped;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/data/project-sections.test.js`
Expected: every line `PASS:`, then `All project-section tests passed.`, exit 0.
(If `create-target.ts` is still missing, Step 3's note applies — finish Task 2
then re-run.)

- [ ] **Step 6: Wire it into the test scripts and CI**

In `package.json`, add after the `"test:provider"` line:

```json
    "test:project-sections": "node tests/data/project-sections.test.js && node tests/data/create-target.test.js",
```

In `.github/workflows/ci.yml`, immediately after the step that runs
`npm run test:provider` (around line 122), add a matching step in the same
`build` job — copy the surrounding step's `name:`/`run:` formatting exactly:

```yaml
      - name: Projects page section + create-target routing
        run: npm run test:project-sections
```

This must go in the fast `build` job, **not** a services job: these tests need no
Postgres, and the services suites no-op on a machine without one.

- [ ] **Step 7: Commit**

```bash
git add lib/data/project-sections.ts tests/data/load-project-sections.js tests/data/project-sections.test.js package.json .github/workflows/ci.yml
git commit -m "feat: pure bucketing for Hosted/Synked/Lokal project sections"
```

---

### Task 2: The creation-routing module

**Files:**
- Create: `lib/data/create-target.ts`
- Create: `tests/data/create-target.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/data/create-target.test.js`:

```js
#!/usr/bin/env node

/**
 * What "create" means per section (lib/data/create-target.ts).
 *
 * The rule that matters most here is the last one: creating a Synked project
 * runs a backup immediately, but a FAILED backup must not fail the creation.
 * The user asked for a project; they get a project. It just lands in Lokal
 * instead, and we tell them why.
 */

const fs = require("fs");
const { loadProjectSections, BUILD_DIR } = require("./load-project-sections");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const BUNDLE = { project: { id: "local-1", title: "Draft" }, nodes: [], edges: [] };

/** Records every effect the module reaches for, so a test can prove routing. */
function makeDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      saveLocal: async (bundle) => {
        calls.push(`saveLocal:${bundle.project.id}`);
        return bundle.project.id;
      },
      importHosted: async (bundle) => {
        calls.push(`importHosted:${bundle.project.id}`);
        return "prj_server";
      },
      backupNow: async (id) => {
        calls.push(`backupNow:${id}`);
      },
      ...overrides,
    },
  };
}

async function main() {
  const { createTarget } = loadProjectSections();
  const { parseCreateTarget, createInTarget } = createTarget;

  // --- parseCreateTarget ---------------------------------------------------
  check("parses hosted", parseCreateTarget("hosted") === "hosted");
  check("parses synked", parseCreateTarget("synked") === "synked");
  check("parses lokal", parseCreateTarget("lokal") === "lokal");
  check("rejects an unknown value", parseCreateTarget("wat") === null);
  check("rejects null", parseCreateTarget(null) === null);
  check("rejects an empty string", parseCreateTarget("") === null);

  // --- hosted --------------------------------------------------------------
  {
    const { calls, deps } = makeDeps();
    const result = await createInTarget("hosted", BUNDLE, deps);
    check("hosted uses importHosted only", calls.join(",") === "importHosted:local-1");
    check("hosted returns the server id", result.id === "prj_server");
    check("hosted reports no backup error", result.backupError === null);
  }

  // --- synked --------------------------------------------------------------
  {
    const { calls, deps } = makeDeps();
    const result = await createInTarget("synked", BUNDLE, deps);
    check("synked saves locally then backs up", calls.join(",") === "saveLocal:local-1,backupNow:local-1");
    check("synked returns the local id", result.id === "local-1");
    check("synked reports no backup error on success", result.backupError === null);
  }

  // --- lokal ---------------------------------------------------------------
  {
    const { calls, deps } = makeDeps();
    const result = await createInTarget("lokal", BUNDLE, deps);
    check("lokal saves locally and never backs up", calls.join(",") === "saveLocal:local-1");
    check("lokal returns the local id", result.id === "local-1");
    check("lokal reports no backup error", result.backupError === null);
  }

  // --- a failed backup must not fail the creation --------------------------
  {
    const { calls, deps } = makeDeps({
      backupNow: async (id) => {
        calls.push(`backupNow:${id}`);
        throw new Error("Entity limit exceeded");
      },
    });
    const result = await createInTarget("synked", BUNDLE, deps);
    check("a failed backup still returns the created id", result.id === "local-1");
    check("a failed backup is reported, not thrown", result.backupError === "Entity limit exceeded");
    check("a failed backup still ran saveLocal first", calls[0] === "saveLocal:local-1");
  }

  // --- a failed save DOES fail the creation --------------------------------
  {
    const { deps } = makeDeps({
      saveLocal: async () => {
        throw new Error("Disk full");
      },
    });
    let threw = null;
    try {
      await createInTarget("lokal", BUNDLE, deps);
    } catch (err) {
      threw = err.message;
    }
    check("a failed save rejects", threw === "Disk full");
  }

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  console.log(failures === 0 ? "\nAll create-target tests passed." : `\n${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/data/create-target.test.js`
Expected: FAIL — `createInTarget is not a function` (or `ENOENT` if you have not
created the empty `lib/data/create-target.ts` yet).

- [ ] **Step 3: Write the implementation**

Create `lib/data/create-target.ts`:

```ts
import type { ProjectBundle } from "./types";

/**
 * Where a newly created project should land — one per section on `/projects`.
 * Mirrors {@link ProjectSection} in `./project-sections`, but is deliberately a
 * separate type: sections describe where projects *are*, targets describe where
 * a new one is *going*, and only the latter travels through a URL.
 */
export type CreateTarget = "hosted" | "synked" | "lokal";

const CREATE_TARGETS: readonly string[] = ["hosted", "synked", "lokal"];

/**
 * Read a `CreateTarget` off untrusted input — a `?target=` or `?import=` query
 * param that survived a round trip through `/generate` and an external LLM.
 *
 * Returns `null` rather than throwing or defaulting, so the caller can decide
 * that a lost intent simply means "ask me again" instead of silently creating a
 * project in the wrong place.
 */
export function parseCreateTarget(value: string | null | undefined): CreateTarget | null {
  if (!value) return null;
  return CREATE_TARGETS.includes(value) ? (value as CreateTarget) : null;
}

/** The three effects {@link createInTarget} needs, injected so it stays testable in Node. */
export interface CreateTargetDeps {
  /** Persist a bundle in this browser. Resolves to the stored project id. */
  saveLocal(bundle: ProjectBundle): Promise<string>;
  /** Persist a bundle in the account. Resolves to the SERVER-minted project id. */
  importHosted(bundle: ProjectBundle): Promise<string>;
  /** Push a local project to Synk now. */
  backupNow(projectId: string): Promise<void>;
}

export interface CreateTargetResult {
  /** The id the project actually got — server-minted for hosted, local otherwise. */
  id: string;
  /**
   * Why the immediate backup failed, or `null`. Non-null means the project
   * exists but landed in Lokal rather than Synked.
   */
  backupError: string | null;
}

/**
 * Create a project in the place the user asked for.
 *
 * Hosted goes straight to the account — no local write, no "move to account"
 * detour afterwards. Synked writes locally and then backs up, and a failed
 * backup is REPORTED, NOT THROWN: the user asked for a project, so they get a
 * project; it just sits in Lokal until the next backup succeeds. A failed
 * *save* is a different matter and propagates, because then there is no project
 * at all.
 */
export async function createInTarget(
  target: CreateTarget,
  bundle: ProjectBundle,
  deps: CreateTargetDeps
): Promise<CreateTargetResult> {
  if (target === "hosted") {
    return { id: await deps.importHosted(bundle), backupError: null };
  }

  const id = await deps.saveLocal(bundle);
  if (target === "lokal") return { id, backupError: null };

  try {
    await deps.backupNow(id);
    return { id, backupError: null };
  } catch (err) {
    return { id, backupError: err instanceof Error ? err.message : "Backup failed" };
  }
}
```

- [ ] **Step 4: Run both suites to verify they pass**

Run: `npm run test:project-sections`
Expected: every line `PASS:`, `All project-section tests passed.`, then
`All create-target tests passed.`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/data/create-target.ts tests/data/create-target.test.js
git commit -m "feat: per-section creation routing with non-fatal backup"
```

---

### Task 3: Expose a file→bundle parser

The hosted import path needs a `ProjectBundle` from a user-selected file
*without* writing it to this browser first. `importProjectFromFile` does the
parse but then commits it locally, so the parse half gets extracted.

**Files:**
- Modify: `lib/utils/export.ts:194-220`

- [ ] **Step 1: Extract the parser**

In `lib/utils/export.ts`, replace the body of `importProjectFromFile` down to and
including the `normalizedBundle` declaration with a call to a new exported
function. The result should read:

```ts
/**
 * Reads a user-selected JSON file into a validated, timestamp-normalized
 * {@link ProjectBundle} — WITHOUT storing it anywhere.
 *
 * Split out of {@link importProjectFromFile} because the hosted import path
 * must not write to this browser on its way to the account: the bundle goes
 * straight to `importProject` on the remote provider, which mints its own id.
 * The local path below still does the id-uniquing this one deliberately skips.
 */
export async function parseBundleFromFile(file: File): Promise<ProjectBundle> {
  const rawText = await file.text();
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Invalid JSON file");
  }

  const bundle = parseAndValidateBundle(parsed);
  return { ...bundle, project: normalizeProjectTimestamps(bundle.project) };
}

/**
 * Imports a project bundle from a user-selected JSON file.
 * If the project id already exists locally, a new id is generated.
 */
export async function importProjectFromFile(file: File): Promise<Project> {
  const normalizedBundle = await parseBundleFromFile(file);

  const resolvedProjectId = await ensureUniqueProjectId(normalizedBundle.project.id);
  const finalBundle =
    resolvedProjectId === normalizedBundle.project.id
      ? normalizedBundle
      : rewriteBundleProjectId(normalizedBundle, resolvedProjectId);
```

Leave everything after that line in `importProjectFromFile` exactly as it is.

- [ ] **Step 2: Verify nothing regressed**

Run: `npm run test:migrate`
Expected: all `PASS:` lines, exit 0. (`tests/data/import-roundtrip.test.js` and
`tests/data/seed-import.test.js` both exercise this path.)

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/export.ts
git commit -m "refactor: extract parseBundleFromFile for the hosted import path"
```

---

### Task 4: The section create menu

**Files:**
- Create: `components/projects/SectionCreateMenu.tsx`

- [ ] **Step 1: Write the component**

`components/ui/dropdown-menu.tsx` already exists (Radix-backed). Create
`components/projects/SectionCreateMenu.tsx`:

```tsx
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/projects/SectionCreateMenu.tsx
git commit -m "feat: per-section create split button"
```

---

### Task 5: The project card, lifted out of the page

**Files:**
- Create: `components/projects/ProjectCard.tsx`

- [ ] **Step 1: Write the component**

This is the existing card from `app/projects/page.tsx:276-329`, moved verbatim
with two changes: the `hosted` badge is dropped (redundant under a "Hosted"
heading), and every action arrives as a prop.

Create `components/projects/ProjectCard.tsx`:

```tsx
"use client";

import { CloudUploadIcon, GithubIcon, Share2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProjectSyncControl } from "@/components/sync/ProjectSyncControl";
import type { ProjectSummary } from "@/lib/data/data-provider";

interface ProjectCardProps {
  summary: ProjectSummary;
  /** True when the signed-in user has somewhere to move a local project to. */
  canHost: boolean;
  /** Non-null while THIS project is being copied into the account. */
  moving: boolean;
  onOpen: () => void;
  onPublish: () => void;
  onRepos: () => void;
  onMoveToAccount: () => void;
  onDelete: () => void;
}

/**
 * One project card.
 *
 * No "In your account" badge: the section heading above already says so, and
 * repeating it on every card was noise. "Move to account" stays, because with
 * sections it is now the ONLY way a Lokal or Synked project becomes Hosted.
 */
export function ProjectCard({
  summary,
  canHost,
  moving,
  onOpen,
  onPublish,
  onRepos,
  onMoveToAccount,
  onDelete,
}: ProjectCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="truncate">{summary.project.title}</CardTitle>
        {summary.project.description && (
          <CardDescription>{summary.project.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {summary.nodeCount} node{summary.nodeCount !== 1 ? "s" : ""} ·{" "}
          {summary.edgeCount} edge{summary.edgeCount !== 1 ? "s" : ""}
        </p>
        {/* Synk backs up browser-held projects; a hosted project is already on
            the server and has nothing to back up. */}
        {summary.hosted ? null : <ProjectSyncControl projectId={summary.project.id} />}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="cursor-pointer" onClick={onOpen}>
          Open
        </Button>
        <Button size="sm" variant="outline" className="cursor-pointer" onClick={onPublish}>
          <Share2Icon />
          Publish
        </Button>
        {summary.hosted ? (
          <Button size="sm" variant="outline" className="cursor-pointer" onClick={onRepos}>
            <GithubIcon />
            Repos
          </Button>
        ) : null}
        {!summary.hosted && canHost ? (
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            disabled={moving}
            onClick={onMoveToAccount}
          >
            <CloudUploadIcon />
            {moving ? "Moving…" : "Move to account"}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" className="cursor-pointer" onClick={onDelete}>
          Delete
        </Button>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. (The old inline card in `page.tsx` is still there and still
compiles; Task 7 removes it.)

- [ ] **Step 3: Commit**

```bash
git add components/projects/ProjectCard.tsx
git commit -m "refactor: extract ProjectCard from the projects page"
```

---

### Task 6: The section block

**Files:**
- Create: `components/projects/ProjectSection.tsx`

- [ ] **Step 1: Write the component**

Create `components/projects/ProjectSection.tsx`:

```tsx
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/projects/ProjectSection.tsx
git commit -m "feat: ProjectSection block with empty state"
```

---

### Task 7: Rewrite the projects page

The big one. The page gains the backup-id fetch, the `syncManager`
subscription, target-aware creation, and three sections; it loses the
page-level button row and the inline card.

**Files:**
- Modify: `app/projects/page.tsx` (whole file)

- [ ] **Step 1: Replace the imports block**

Replace `app/projects/page.tsx:1-50` with:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ArkaikLogo } from "@/components/branding/ArkaikLogo";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthButton } from "@/components/auth/AuthButton";
import { getProvider } from "@/lib/data/provider-registry";
import type { Project, ProjectBundle } from "@/lib/data/types";
import type { ProjectSummary } from "@/lib/data/data-provider";
import { RepoLinksDialog } from "@/components/settings/RepoLinksDialog";
import { exportProject as exportProjectBundle } from "@/lib/utils/export";
import { createRemoteProvider } from "@/lib/data/remote-provider";
import { archiveProject, importProjectFromFile, parseBundleFromFile } from "@/lib/utils/export";
import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { CreateProjectForm } from "@/components/panels/CreateProjectForm";
import { PublishDialog } from "@/components/publik/PublishDialog";
import { RestoreDialog } from "@/components/sync/RestoreDialog";
import { SynkOnboardingBanner } from "@/components/sync/SynkOnboardingBanner";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { ProjectSection } from "@/components/projects/ProjectSection";
import { groupBySection } from "@/lib/data/project-sections";
import {
  createInTarget,
  parseCreateTarget,
  type CreateTarget,
} from "@/lib/data/create-target";
import { syncManager } from "@/lib/sync/sync-manager";
import { useAuthStatus } from "@/lib/hooks/useAuthStatus";
```

Note what is gone: the `Card*` imports, `Badge`, `CloudIcon`/`HistoryIcon`/
`GithubIcon`/`Share2Icon`/`CloudUploadIcon`, `Select*`, `ProjectSyncControl`, and
the `pebbles`/`arkaikSelfMap` seed imports with their `EXAMPLE_SEEDS` map and
`ExampleSeed` type — the example-project picker lived only in the old
all-projects-empty state, which sections replace.

- [ ] **Step 2: Add the backup-id state and target plumbing**

Inside `ProjectsPage`, after the existing `const [moving, setMoving] = ...` line,
replace the duplicated `const authStatus = useAuthStatus();` (the component
currently calls the hook twice — `auth` and `authStatus`; keep only `auth`) and
add:

```tsx
  const searchParams = useSearchParams();
  /** Ids of projects with a Synk backup — the ONLY thing that separates Synked from Lokal. */
  const [backedUpIds, setBackedUpIds] = useState<Set<string>>(new Set());
  /** Which section the in-flight create/import is destined for. */
  const [createTarget, setCreateTarget] = useState<CreateTarget>("lokal");
  const importTargetRef = useRef<CreateTarget>("lokal");
  const signedIn = auth.state === "signed-in";
  /** Hosting a project needs somewhere to put it — i.e. a signed-in account. */
  const canHost = signedIn;
```

Then delete the old standalone `const canHost = authStatus.state === "signed-in";`
line and its `authStatus` declaration.

- [ ] **Step 3: Own the backup-id fetch and the sync subscription**

Add below `loadProjects`. This is the fetch that used to live inside
`SynkOnboardingBanner`; it moves up so the banner and the sections cannot
disagree about what is backed up.

```tsx
  /**
   * The set of project ids Synk holds a backup for.
   *
   * This used to live inside `SynkOnboardingBanner`. It moved up here because
   * the sections need the same answer: a local project with a backup is Synked,
   * without one it is Lokal. Two independent fetches could disagree, and the
   * banner would then offer to back up a project already sitting under "Synked".
   */
  const loadBackedUpIds = useCallback(async () => {
    if (!signedIn) {
      setBackedUpIds(new Set());
      return;
    }
    try {
      const res = await fetch("/api/synk/projects", { cache: "no-store" });
      if (!res.ok) {
        setBackedUpIds(new Set());
        return;
      }
      const body = (await res.json()) as { projects?: Array<{ project_id: string }> };
      setBackedUpIds(new Set((body.projects ?? []).map((p) => p.project_id)));
    } catch {
      setBackedUpIds(new Set());
    }
  }, [signedIn]);

  useEffect(() => {
    void loadBackedUpIds();
  }, [loadBackedUpIds]);

  // A project that just got backed up — via the banner, the per-card control, or
  // a Synked creation — must hop from Lokal to Synked without a page reload.
  useEffect(
    () =>
      syncManager.subscribe(() => {
        void loadBackedUpIds();
      }),
    [loadBackedUpIds]
  );
```

- [ ] **Step 4: Route creation through `createInTarget`**

Replace the whole existing `createProject` function
(`app/projects/page.tsx:114-137`) with:

```tsx
  /** The injected effects `createInTarget` routes between. */
  const targetDeps = {
    saveLocal: async (bundle: ProjectBundle) => {
      await getProvider().saveProject(bundle);
      return bundle.project.id;
    },
    importHosted: async (bundle: ProjectBundle) => {
      const created = await createRemoteProvider().importProject(bundle);
      return created.id;
    },
    backupNow: (projectId: string) => syncManager.backupNow(projectId),
  };

  async function createProject(project: Pick<Project, "title" | "description">) {
    setError(null);
    const now = new Date().toISOString();
    const bundle: ProjectBundle = {
      project: {
        id: crypto.randomUUID(),
        title: project.title,
        description: project.description,
        metadata: { view_card_variant: "compact" },
        created_at: now,
        updated_at: now,
        archived_at: null,
      },
      nodes: [],
      edges: [],
    };

    try {
      const { id, backupError } = await createInTarget(createTarget, bundle, targetDeps);
      if (backupError) toast.error(`Created, but the backup failed: ${backupError}`);
      await loadProjects();
      await loadBackedUpIds();
      router.push(`/project/${id}`);
    } catch (err) {
      console.error("[ProjectsPage] Failed to create project:", err);
      setError(err instanceof Error ? err.message : "Could not create this project.");
    }
  }
```

- [ ] **Step 5: Make import target-aware**

Delete `handleImportExample` entirely (its only caller was the removed
all-empty state). Replace `handleImportFileChange`
(`app/projects/page.tsx:157-181`) with:

```tsx
  function openImportPicker(target: CreateTarget) {
    importTargetRef.current = target;
    fileInputRef.current?.click();
  }

  async function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const MAX_IMPORT_SIZE = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_IMPORT_SIZE) {
      setError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 5 MB.`);
      return;
    }

    const target = importTargetRef.current;
    setImporting(true);
    setError(null);
    try {
      let id: string;
      let backupError: string | null = null;

      if (target === "hosted") {
        // Straight to the account — never write it to this browser on the way.
        const bundle = await parseBundleFromFile(file);
        id = await targetDeps.importHosted(bundle);
      } else {
        // The local path does its own id-uniquing, which the hosted one must not.
        const project = await importProjectFromFile(file);
        id = project.id;
        if (target === "synked") {
          try {
            await syncManager.backupNow(id);
          } catch (err) {
            backupError = err instanceof Error ? err.message : "Backup failed";
          }
        }
      }

      if (backupError) toast.error(`Imported, but the backup failed: ${backupError}`);
      await loadProjects();
      await loadBackedUpIds();
      router.push(`/project/${id}`);
    } catch (err) {
      console.error("[ProjectsPage] Failed to import project JSON:", err);
      setError(err instanceof Error ? err.message : "Failed to import project JSON");
    } finally {
      setImporting(false);
    }
  }
```

- [ ] **Step 6: Handle the `?import=` return from /generate**

Add after the sync-subscription effect:

```tsx
  // Coming back from /generate with a target in hand: open the file picker on
  // that section and drop the param, so a refresh does not re-open it.
  useEffect(() => {
    const target = parseCreateTarget(searchParams.get("import"));
    if (!target) return;
    window.history.replaceState(null, "", "/projects");
    importTargetRef.current = target;
    fileInputRef.current?.click();
  }, [searchParams]);
```

- [ ] **Step 7: Replace the render**

Replace everything from the `return (` at line 199 through the closing of
`</main>` with:

```tsx
  const grouped = groupBySection(projects, backedUpIds);

  const openCreateDialog = (target: CreateTarget) => {
    setCreateTarget(target);
    setCreateOpen(true);
  };

  const renderCards = (summaries: ProjectSummary[]) =>
    summaries.map((summary) => (
      <ProjectCard
        key={summary.project.id}
        summary={summary}
        canHost={canHost}
        moving={moving === summary.project.id}
        onOpen={() => router.push(`/project/${summary.project.id}`)}
        onPublish={() => setPublishTarget(summary)}
        onRepos={() => setRepoTarget(summary)}
        onMoveToAccount={() => void moveToAccount(summary)}
        onDelete={() => setDeleteTarget(summary)}
      />
    ));

  return (
    <div className="flex flex-1 flex-col bg-background font-sans">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/" aria-label="Go to home" className="inline-flex items-center">
          <ArkaikLogo className="w-20 shrink-0" />
        </Link>
        <div className="flex items-center gap-2">
          <AuthButton />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Projects</h1>
          {/* One shared picker: `importTargetRef` carries which section asked. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFileChange}
            className="hidden"
          />
          {/* Signed out there is only one kind of project, so the sole control
              sits up here rather than under a heading that says nothing. */}
          {!signedIn && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="cursor-pointer"
                disabled={importing}
                onClick={() => openImportPicker("lokal")}
              >
                {importing ? "Importing..." : "Import JSON"}
              </Button>
              <Button variant="outline" className="cursor-pointer" asChild>
                <Link href="/generate?target=lokal">Generate with AI</Link>
              </Button>
              <Button className="cursor-pointer" onClick={() => openCreateDialog("lokal")}>
                Create project
              </Button>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Only relevant when something is actually un-backed-up and local. */}
        {!loading && grouped.lokal.length > 0 && (
          <SynkOnboardingBanner projects={grouped.lokal} backedUpIds={backedUpIds} />
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : !signedIn ? (
          /* Signed out: no sections. Hosted and Synked are impossible without an
             account, and the local-first promise is that signing in ADDS things
             rather than rearranging what was already there. */
          grouped.lokal.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
              <p className="max-w-xs text-sm text-muted-foreground">
                No projects yet. Create one or import your JSON.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {renderCards(grouped.lokal)}
            </div>
          )
        ) : (
          <>
            <ProjectSection
              target="hosted"
              count={grouped.hosted.length}
              disabled={importing}
              onCreate={() => openCreateDialog("hosted")}
              onImport={() => openImportPicker("hosted")}
            >
              {renderCards(grouped.hosted)}
            </ProjectSection>

            <ProjectSection
              target="synked"
              count={grouped.synked.length}
              disabled={importing}
              onCreate={() => openCreateDialog("synked")}
              onImport={() => openImportPicker("synked")}
              onRestore={() => setRestoreOpen(true)}
            >
              {renderCards(grouped.synked)}
            </ProjectSection>

            <ProjectSection
              target="lokal"
              count={grouped.lokal.length}
              disabled={importing}
              onCreate={() => openCreateDialog("lokal")}
              onImport={() => openImportPicker("lokal")}
            >
              {renderCards(grouped.lokal)}
            </ProjectSection>
          </>
        )}
      </main>
```

Leave the dialog block after `</main>` (CreateProjectForm, DeleteConfirmDialog,
RepoLinksDialog, PublishDialog, RestoreDialog) exactly as it is.

- [ ] **Step 8: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. If `useSearchParams` triggers a Next.js prerender warning at
build time, wrap the page body in a `<Suspense>` boundary in
`app/projects/page.tsx` — but check `npm run build` first rather than adding it
speculatively.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add app/projects/page.tsx
git commit -m "feat: Hosted/Synked/Lokal sections on the projects page"
```

---

### Task 8: The banner takes the backup set as a prop

**Files:**
- Modify: `components/sync/SynkOnboardingBanner.tsx`

- [ ] **Step 1: Change the props and drop the fetch**

Replace the `SynkOnboardingBannerProps` interface and everything from
`const auth = useAuthStatus();` down to the `if (auth.state !== "signed-in" ||
serverProjectIds === null) return null;` line with:

```tsx
interface SynkOnboardingBannerProps {
  /** Already filtered to the Lokal bucket by `app/projects/page.tsx`. */
  projects: ProjectSummary[];
  /** Ids Synk already holds a backup for — fetched once by the page, not here. */
  backedUpIds: Set<string>;
}
```

and

```tsx
  const auth = useAuthStatus();
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const [backingUpId, setBackingUpId] = useState<string | null>(null);

  if (auth.state !== "signed-in") return null;

  const candidates = projects.filter((bundle) => {
    const id = bundle.project.id;
    if (backedUpIds.has(id)) return false;
    if (dismissed.has(id)) return false;
    if (syncManager.getStatus(id).state === "backed-up") return false; // just backed up this session
    return true;
  });
```

Delete the `serverProjectIds` state, the `useEffect` that fetched
`/api/synk/projects`, the `forceUpdate` reducer and its `syncManager.subscribe`
effect — the page now owns all three. Remove `useEffect` and `useReducer` from
the React import if they are no longer used; keep `useState`.

Update the doc comment above the component to note that the backup set and the
sync subscription now live in `app/projects/page.tsx`.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/sync/SynkOnboardingBanner.tsx
git commit -m "refactor: banner takes the backup id set from the page"
```

---

### Task 9: Carry the target through /generate

**Files:**
- Modify: `app/generate/page.tsx`

- [ ] **Step 1: Read the param and show the destination**

At the top of `app/generate/page.tsx`, add to the existing imports:

```tsx
import { useSearchParams } from "next/navigation";
import { parseCreateTarget } from "@/lib/data/create-target";
```

Inside the component, alongside the existing `useState` calls:

```tsx
  const searchParams = useSearchParams();
  /**
   * Where the generated bundle should land once the user comes back to import
   * it. This page does not create anything — it builds a prompt the user runs
   * elsewhere — so the section's intent has to survive the round trip through
   * the URL. A missing or unrecognised value simply means "ask me on import".
   */
  const target = parseCreateTarget(searchParams.get("target"));

  const DESTINATION: Record<string, string> = {
    hosted: "This will land in your account.",
    synked: "This will land in this browser, backed up to Synk.",
    lokal: "This will land in this browser only.",
  };
```

- [ ] **Step 2: Render the destination line and the return link**

Change the existing back link at `app/generate/page.tsx:56` from:

```tsx
          <Link href="/projects" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
```

to:

```tsx
          <Link
            href={target ? `/projects?import=${target}` : "/projects"}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
```

and immediately after that link's closing tag, add:

```tsx
          {target ? (
            <p className="text-xs text-muted-foreground">{DESTINATION[target]}</p>
          ) : null}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors. If the build complains that `useSearchParams` needs a
suspense boundary on `/generate` or `/projects`, wrap that page's default export
body in `<Suspense fallback={null}>` and rebuild.

- [ ] **Step 4: Commit**

```bash
git add app/generate/page.tsx
git commit -m "feat: carry the create target through the generate round trip"
```

---

### Task 10: Full verification and manual pass

**Files:** none

- [ ] **Step 1: Run the automated suites**

```bash
npm run test:project-sections
npm run test:provider
npm run test:migrate
npm run test:sync
npm run lint
npx tsc --noEmit
npm run build
```

Expected: all pass, exit 0. Do not claim completion on any of these without
having seen the output.

Note: the `tests/services/*` suites need a local Postgres and will no-op or fail
on a machine without one. That is expected — CI runs them. Nothing in this change
touches a services path.

- [ ] **Step 2: Manual pass**

Run `npm run dev` and check, in order:

1. **Signed out** — `/projects` shows a flat list, no section headings, and the
   three page-level buttons. No Synk callout.
2. **Signed in, hosted only** — three headings appear; both hosted projects are
   under Hosted; Synked and Lokal show their dashed empty states with a working
   create control; **the "Back up your local projects to Synk" callout is
   absent.** This is the bug from the original screenshot.
3. **Create under Lokal** — lands in Lokal, callout appears offering to back it up.
4. **Back it up** from the callout or the card control — it moves to Synked
   without a reload, and the callout disappears.
5. **Create under Synked** — lands directly in Synked, no callout.
6. **Create under Hosted** — lands in Hosted; confirm the id starts with `prj_`
   in the URL.
7. **Import JSON under Hosted** — the project appears under Hosted, not Lokal.
8. **Restore from Synk** — present in the Synked menu only; absent from Hosted
   and Lokal.
9. **Generate round trip** — open Generate with AI from the Hosted menu; the
   `/generate` page states it will land in your account; clicking back opens
   `/projects` with the file picker already open; importing lands it in Hosted;
   the URL no longer carries `?import=`.

- [ ] **Step 3: Open the PR with a Lab Note**

This is a user-facing change, so `CLAUDE.md` requires a Lab Note section in the
PR body. Molecule slug for this repo is `arkaik`.

```bash
git push -u origin projects-page-sections
```

Then open the PR with a body containing:

````markdown
## Lab Note

```yaml
en:
  title: Your projects, sorted by where they live
  summary: The projects page now groups everything into Hosted, Synked and Lokal, and each group has its own way to add a project — so what you create lands exactly where you meant it to. The backup nudge only shows up when you actually have something local to back up.
fr:
  title: Tes projets, rangés selon où ils vivent
  summary: La page projets range désormais tout en Hosted, Synked et Lokal, et chaque groupe a son propre bouton pour ajouter un projet — ce que tu crées atterrit donc exactement où tu le voulais. Et la proposition de sauvegarde n'apparaît que si tu as vraiment quelque chose de local à sauvegarder.
suggested:
  molecule: arkaik
  type: improvement
  tags: [changelog]
```
````
