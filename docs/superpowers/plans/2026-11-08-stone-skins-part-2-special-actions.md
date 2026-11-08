# Stone skins — Part 2: stones on special actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the stone on Arkaik's special actions, the active sidebar row and checked checkboxes, using the default skin (Calacatta + Onyx).

**Architecture:** Two new `Button` variants (`stone`, `stone-secondary`) read the role tokens from Part 1 through two small CSS classes in `app/stones.css`. The sidebar menu buttons and the checkbox switch from `bg-sidebar-accent` / `bg-primary` to the stone roles. Then the chosen call sites opt in.

**Tech Stack:** Next.js, Tailwind v4, class-variance-authority, tailwind-merge (`cn`), Radix Checkbox.

**Spec:** `docs/superpowers/specs/2026-11-08-stone-skins-design.md`

**Branch:** `feat/stones-special-actions`, stacked on `feat/stones-tokens` (Part 1). Create it with the `gh-stack` skill (`gh stack add` / equivalent) from the Part 1 branch.

**CSS layer rule used throughout:** the material rules go in `@layer components`, so any Tailwind utility a caller passes still wins. Anything that must beat a utility in the component itself is written as a utility (or a cva compound variant), never as unlayered CSS.

---

### Task 4: Stone button variants

**Files:**
- Modify: `app/stones.css` (append)
- Modify: `components/ui/button.tsx`

- [ ] **Step 1: Add the material classes**

Append to `app/stones.css`:

```css
/*
 * A stone surface. `.stone-primary` / `.stone-secondary` pick the role; `.stone`
 * paints it: the texture, its ink and label lift, the raised or flush edge for
 * the surface it sits on, and — on polished stones — a top sheen, drawn behind
 * the label (z-index -1 inside the element's own stacking context).
 */
@layer components {
  .stone-primary {
    --s-fill: var(--stone-primary-fill);
    --s-ink: var(--stone-primary-ink);
    --s-tsh: var(--stone-primary-tsh);
    --s-polish: var(--stone-primary-polish);
    --s-shadow: var(--stone-primary-shadow);
    --s-sheen: var(--stone-primary-sheen);
  }
  .stone-secondary {
    --s-fill: var(--stone-secondary-fill);
    --s-ink: var(--stone-secondary-ink);
    --s-tsh: var(--stone-secondary-tsh);
    --s-polish: var(--stone-secondary-polish);
    --s-shadow: var(--stone-secondary-shadow);
    --s-sheen: var(--stone-secondary-sheen);
  }
  .stone {
    position: relative;
    isolation: isolate;
    background: var(--s-fill);
    color: var(--s-ink);
    text-shadow: var(--s-tsh);
    box-shadow: var(--s-shadow);
    transition: filter .15s, box-shadow .2s;
  }
  .stone::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    pointer-events: none;
    opacity: var(--s-polish);
    background: linear-gradient(180deg, rgb(255 255 255 / var(--s-sheen)), rgb(255 255 255 / 0) 48%,
      rgb(255 255 255 / 0) 82%, rgb(255 255 255 / .1));
  }
  .stone:hover {
    filter: brightness(1.04);
  }
}
```

- [ ] **Step 2: Add the variants**

In `components/ui/button.tsx`, inside `variants.variant`, add after the `link` entry:

```ts
        // Special actions (docs/superpowers/specs/2026-11-08-stone-skins-design.md):
        // the primary role is the dark stone on light surfaces and the light
        // stone on dark ones; secondary is the other. Colours live in app/stones.css.
        stone: "stone stone-primary",
        "stone-secondary": "stone stone-secondary",
```

and add a `compoundVariants` entry to the `cva` config, between `variants` and `defaultVariants`:

```ts
    // After the size classes, so the reader's radius beats `rounded-md`; a
    // caller's own `rounded-*` (e.g. a split button's `rounded-r-none`) still
    // comes last and wins.
    compoundVariants: [
      { variant: ["stone", "stone-secondary"], className: "rounded-[var(--stone-radius)]" },
    ],
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/stones.css components/ui/button.tsx
git commit -m "feat(stones): stone and stone-secondary button variants"
```

---

### Task 5: Sidebar active row and checkbox

**Files:**
- Modify: `components/ui/sidebar.tsx` (`sidebarMenuButtonVariants` base string ~line 483; `SidebarMenuSubButton` classes ~line 693-694)
- Modify: `components/ui/checkbox.tsx:36`
- Modify: `app/stones.css` (append)

- [ ] **Step 1: Sidebar classes**

In `sidebarMenuButtonVariants`' base string:
- replace `rounded-md` with `rounded-[min(var(--stone-radius),15px)]`;
- delete `data-[active=true]:bg-sidebar-accent ` (keep `data-[active=true]:font-medium` and `data-[active=true]:text-sidebar-accent-foreground`).

In `SidebarMenuSubButton`'s first class string, replace `rounded-md` with `rounded-[min(var(--stone-radius),15px)]`, and replace the line

```ts
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
```

with

```ts
        "data-[active=true]:text-sidebar-accent-foreground",
```

- [ ] **Step 2: Sidebar stone**

Append to `app/stones.css`:

```css
/*
 * The active sidebar row: the secondary stone at 78% behind the label, held by
 * a hairline (dark on light surfaces, light on dark), and its icon stroked in
 * the stone's icon tone. `--stone-icon-paint` lets a preview point at its own
 * gradient; everywhere else it is the shared `#stone-icon`.
 */
@layer components {
  [data-sidebar="menu-button"][data-active="true"],
  [data-sidebar="menu-sub-button"][data-active="true"] {
    position: relative;
    isolation: isolate;
  }
  [data-sidebar="menu-button"][data-active="true"]::before,
  [data-sidebar="menu-sub-button"][data-active="true"]::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    pointer-events: none;
    background: var(--stone-secondary-fill);
    opacity: .78;
    box-shadow: inset 0 0 0 1px var(--stone-row-hairline);
  }
  [data-sidebar="menu-button"][data-active="true"] > svg,
  [data-sidebar="menu-sub-button"][data-active="true"] > svg {
    stroke: var(--stone-icon-paint, url(#stone-icon));
  }
}
```

- [ ] **Step 3: Checkbox**

In `components/ui/checkbox.tsx`, in the root's class string:
- replace `dark:bg-input/30` with `dark:data-[state=unchecked]:bg-input/30`;
- replace `data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary` with:

```
data-[state=checked]:[background:var(--stone-primary-fill)] data-[state=checked]:text-[var(--stone-primary-ink)] data-[state=checked]:border-transparent data-[state=checked]:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.18)] data-[state=indeterminate]:[background:var(--stone-primary-fill)] data-[state=indeterminate]:text-[var(--stone-primary-ink)] data-[state=indeterminate]:border-transparent data-[state=indeterminate]:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.18)]
```

Add one sentence to the component's doc comment, after the first paragraph: `Checked and indeterminate boxes fill with the primary stone (app/stones.css), so a ticked box reads as the same material as the special actions.`

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Run the suites that read these components' source: `npm run test:panel-semantics && npm run test:project-panels && npm run test:docs-visibility && npm run test:product-scope`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add components/ui/sidebar.tsx components/ui/checkbox.tsx app/stones.css
git commit -m "feat(stones): the active sidebar row and checked boxes take the stone"
```

---

### Task 6: Apply the stone to the special actions

**Files (each a one-attribute change unless noted):**
- `app/page.tsx:62` — Start building
- `app/project/[id]/decisions/page.tsx:183` — Create (decision)
- `app/project/[id]/delivery/page.tsx:266` — Create node
- `app/project/[id]/library/page.tsx:549` — Create node
- `components/panels/NewNodeForm.tsx:276` — Create node
- `components/panels/NewAcceptanceForm.tsx:147` — Create acceptance
- `app/projects/page.tsx:519,522` — Generate with AI, Create project
- `components/projects/SectionCreateMenu.tsx:68,78-80` — the per-section create split button
- `components/publik/PublishDialog.tsx:252` — Publish
- `components/publik/ImportSnapshotButton.tsx:55` — Import into arkaik
- `components/generate/PromptOutput.tsx:45,70` — Copy prompt

- [ ] **Step 1: Primary actions**

Add `variant="stone"` to each of these `<Button>` elements (keep every other prop):

- `app/page.tsx:62` → `<Button asChild size="lg" variant="stone" className="mt-10 px-8 text-base">`
- `app/project/[id]/decisions/page.tsx:183` → `<Button type="submit" variant="stone" disabled={newTitle.trim() === ""}>`
- `app/project/[id]/delivery/page.tsx:266` → `<Button size="sm" variant="stone" className="cursor-pointer" onClick={() => setNewNodeOpen(true)}>`
- `app/project/[id]/library/page.tsx:549` → same as delivery.
- `components/panels/NewNodeForm.tsx:276` → `<Button type="submit" variant="stone" form="new-node-form">`
- `components/panels/NewAcceptanceForm.tsx:147` → `<Button type="submit" variant="stone" form="new-acceptance-form">`
- `app/projects/page.tsx:522` → `<Button variant="stone" className="cursor-pointer" onClick={() => openCreateDialog("lokal")}>`
- `components/publik/PublishDialog.tsx:252` → `<Button variant="stone" onClick={() => void handlePublish()} disabled={publishing} className="cursor-pointer">`
- `components/publik/ImportSnapshotButton.tsx:55` → `<Button size="lg" variant="stone" className="cursor-pointer" onClick={() => void handleImport()} disabled={importing}>`
- `components/generate/PromptOutput.tsx:45` and `:70` → `<Button size="sm" variant="stone" onClick={handleCopy} disabled={!prompt}>`

- [ ] **Step 2: The secondary action**

`app/projects/page.tsx:519` — Generate with AI sits beside Create project, so it takes the secondary stone:

```tsx
              <Button variant="stone-secondary" className="cursor-pointer" asChild>
                <Link href="/generate?target=lokal">Generate with AI</Link>
              </Button>
```

- [ ] **Step 3: The split button**

In `components/projects/SectionCreateMenu.tsx`, add `variant="stone"` to both halves (lines 68 and 78). On the right half, the seam colour is tied to the old primary foreground; replace `border-primary-foreground/20` with `border-[color-mix(in_srgb,var(--stone-primary-ink)_20%,transparent)]`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Run the suites that read these pages' source: `npm run test:landing && npm run test:delivery && npm run test:decision-utils && npm run test:product-scope && npm run test:project-panels && npm run test:panel-semantics`
Expected: all pass. If one fails because it asserts on the exact JSX text of a changed line, update the assertion to the new markup — do not revert the variant.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx "app/project/[id]/decisions/page.tsx" "app/project/[id]/delivery/page.tsx" "app/project/[id]/library/page.tsx" components/panels/NewNodeForm.tsx components/panels/NewAcceptanceForm.tsx app/projects/page.tsx components/projects/SectionCreateMenu.tsx components/publik/PublishDialog.tsx components/publik/ImportSnapshotButton.tsx components/generate/PromptOutput.tsx
git commit -m "feat(stones): special actions wear the stone"
```

---

### Task 7: Visual check and PR (controller)

- [ ] **Step 1:** `npm run generate && git status --short` — must be clean (no wobble drift).
- [ ] **Step 2:** Start the dev server and screenshot with Playwright, light and dark: `/` (Start building), `/projects` (Create project + Generate with AI), a project's Delivery page (Create node, active sidebar row), a page with checkboxes (Library table select). Check: label legible on the stone, sheen behind the label, sidebar row tinted with a hairline, icon in the stone tone, focus ring visible on Tab.
- [ ] **Step 3:** Push and open the PR stacked on Part 1, titled "feat(stones): special actions wear the stone (part 2/3)", with this Lab Note in the body:

````markdown
## Lab Note

```yaml
en:
  title: "Special actions now wear stone"
  summary: "Creating, publishing and generating now sit on a polished stone button, and the active sidebar row and ticked boxes pick up the same material. Onyx and Calacatta swap roles when you switch theme."
fr:
  title: "Les actions spéciales passent à la pierre"
  summary: "Créer, publier et générer reposent maintenant sur un bouton en pierre polie, et la ligne active du menu comme les cases cochées prennent la même matière. Onyx et Calacatta échangent leurs rôles quand tu changes de thème."
nodes: [V-projects, V-delivery-board, V-library, V-decision-log, V-publik-publish-dialog, V-generate-prompt, V-landing]
suggested:
  molecule: arkaik
  type: feature
  tags: [design]
```
````

- [ ] **Step 4:** Read the PR's comments for the Lab Note reminder and fix the body if it flags anything.
