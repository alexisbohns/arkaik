# Hotkeys on TanStack — design

**Status:** approved 2026-09-27; amended after review. Ships as a three-part stack.

## Problem

Every shortcut in the app is a hand-rolled `window` keydown listener: ⌘K and
⌘? twice (project layout, docs shell), ⌘E, ⌘B inside the shadcn sidebar
primitive, Escape on the panel stack, ←/→ in the screenshot preview, and
Delete/Backspace on the Journey map. Each one re-implements modifier matching,
the input guard and the repeat guard, and nothing checks them against each
other. The ⌥M clash in the first draft of this feature (Matrix and All maps)
is the kind of mistake that setup can't catch.

We want many more shortcuts: Option-chord navigation from the sidebar, bare
letters on filter toolbars, and an Option-hold reveal of the sidebar chords.
Adding them as more hand-rolled listeners would make that worse.

## Decisions

1. **Every window-level shortcut moves to `@tanstack/react-hotkeys`**, the
   existing ones included. After the migration nothing in `app/`,
   `components/` or `lib/` calls `addEventListener("keydown")` on `window`,
   except the two capture-phase Escape interceptors below.
2. **Element-local keyboard handling stays as it is.** `onKeyDown` on a
   field or widget is widget semantics, not a shortcut: Enter/Escape in
   `EditableLabel`, `RepoLinksPanel` and `PlatformVariants`, Enter/Space on a
   focused `FlowNode` or `NodeCard`, arrow navigation in `CommandPalette`,
   `Combobox` and `ValuePicker`. So do the capture-phase Escape interceptors
   in `components/ui/combobox.tsx` and `components/values/ValuePicker.tsx`.
   They stop propagation at `window` capture, before TanStack's `document`
   listener sees the event, and that is what keeps an open dropdown's Escape
   from also closing the panel under it. Moving them would break exactly that.
3. **`lib/utils/keyboard-shortcuts.ts` stays the single registry.** Each
   entry gains a `hotkey` field holding the TanStack string (`"Mod+K"`,
   `"Alt+O"`). Registrations, the ⌘? cheat sheet and the sidebar chips all read
   from it, so a binding that is not in the registry cannot exist, as the file
   already promises. The file stays import-free so its test loader keeps
   transpiling it standalone.
4. **Resolved clashes and gaps** (decided with the user):
   - ⌥M goes to All maps, and the matrix moves to ⌥X.
   - Bare `d` ("database") is dropped: the schema only knows web, iOS and
     Android.
   - Pressing a platform key for the platform already selected goes back to
     all platforms.

## Library facts the design relies on

Checked against `@tanstack/hotkeys` 0.10.0 / `@tanstack/react-hotkeys` 0.12.0:

- **One `keydown` listener on `document`, bubble phase.** React's handlers
  (on the root container) run first. The window-capture Escape interceptors
  run before either.
- **It ignores `event.defaultPrevented`, and with the default
  `preventDefault: true` it prevents the event *before* the callback runs.**
  So a handler whose guard can decline must register with
  `preventDefault: false` and call `event.preventDefault()` itself once the
  guard passes. This is the **guarded handler** pattern, used by Escape,
  ⌘E and the arrows.
- **Every registration matching a chord fires**; duplicates only
  `console.warn`. The registry test (below) is what keeps chords unique.
- **Default `ignoreInputs`:** Ctrl/Meta chords and Escape fire in inputs;
  bare keys and Alt/Shift chords don't. Its input check covers
  input/textarea/select/contenteditable but not `role="textbox"` or
  `role="combobox"`. Where the app's broader `isEditableElement` matters, the
  guarded handler checks it.
- **Option+letter on macOS** produces `∂`, `å` and so on in `event.key`. The
  matcher falls back to `event.code` when Alt is held, so `"Alt+D"` matches.
- **ESM-only.** The Node test scripts are CommonJS and CI runs Node 20, so
  tests load it with `await import("@tanstack/hotkeys")`, never `require`.
- `requireReset: true` would fire once per press, but guarded callbacks keep
  the literal `if (event.repeat) return;` instead — identical behaviour, no
  keyup-reset reasoning.
- **The matcher's `event.code` fallback assumes US key positions.** With
  Option held a Mac types `æ`/`µ`, so on AZERTY `"Alt+A"` would match the key
  labelled Q. Letter chords are therefore resolved against the active layout
  at runtime (part 2), and `?` is registered by character too (`"Mod+?"`).

## Part 1 — migrate the existing shortcuts (no behaviour change)

**Dependency.** Add `@tanstack/react-hotkeys` (this pulls in
`@tanstack/hotkeys`). No `HotkeysProvider`: the defaults are per-registration
and explicit.

**Registry.** Every existing entry gains its `hotkey` string: `Mod+K`,
`Mod+B`, `Mod+E`, `Escape`, `Delete`/`Backspace`, `ArrowLeft`/`ArrowRight`,
and ⌘? (see below). Entries that describe widget keys rather than shortcuts
(palette ↑/↓, Tab, Enter; map Enter/Space on a focused node) get no `hotkey`.
They stay in the cheat sheet as documentation only.

**Registrations, one per old listener:**

| Old listener | New registration |
|---|---|
| `app/project/[id]/layout.tsx` ⌘K | `useHotkey("Mod+K", togglePalette)` — live in inputs (the default for Mod). |
| layout ⌘? | registered for both readings (see below) — live in inputs. |
| layout ⌘E | guarded: `preventDefault: false`; the callback returns early on `isEditableElement(event.target)`, otherwise prevents and exports. |
| `components/docs/DocsSearch.tsx` ⌘K, ⌘? | same as the layout's. The two never mount together. |
| `components/ui/sidebar.tsx` ⌘B | `useHotkey("Mod+B", toggleSidebar)` — keeps its current live-in-inputs behaviour. |
| `components/panels/PanelStack.tsx` Escape | guarded, `enabled: entries.length > 0`, an `event.repeat` bail-out, `ignoreInputs: false` with the callback checking `isEditableElement` and `OPEN_OVERLAY_SELECTOR` (unchanged guards). |
| `components/panels/ShotPreviewDialog.tsx` ←/→ | guarded, `enabled: open`; the callback keeps the `[data-slot="tabs-list"]` bail-out. |
| `lib/hooks/useKeyboardShortcuts.ts` Delete/Backspace | `useHotkeys` over both keys with an `event.repeat` bail-out; the callback keeps the editable-target guard. The unused `onEscape` option is removed (its only caller, `JourneyMap`, never passes it). |

**⌘? both readings.** The old predicate accepts `key === "?"` or
Shift+`/`. The test pins, through `matchesKeyboardEvent`, which one or two
registered strings make both events match, and that bare `?` never does. The
exact string (`"Mod+Shift+/"`, `"Mod+?"`, or both) is whatever makes that
test pass.

**Dead code.** `isCommandPaletteShortcut`, `isShortcutsDialogShortcut`,
`isExportShortcut` and `isDeleteShortcut` go. `isEditableElement` stays in
`lib/utils/keyboard.ts`.

**Tests** (`tests/app/keyboard-shortcuts.test.js`, rewritten around the registry):
- Every `hotkey` in the registry passes TanStack's `validateHotkey`.
- **No two entries in overlapping scopes share a chord** (`everywhere`
  overlaps everything; `project` overlaps `map` and the toolbar scopes of part 3).
- The old predicate cases re-expressed through `matchesKeyboardEvent` against
  the registry strings: ⌘K and Ctrl+K match, ⌘⇧K and ⌘⌥K don't, ⌘? matches in
  both readings, bare `?` doesn't, and ⌘E matches but ⌘⇧E doesn't.
- The existing scope-filtering assertions for `getShortcutGroups` are kept.

**Lab Note:** none. It's a refactor, so the PR gets the `no-lab-note` label.

## Part 2 — sidebar navigation chords and the Option reveal

**Bindings** (scope `project`, all `ignoreInputs: true`, the default for Alt chords):

| Chord | Goes to |
|---|---|
| ⌥O | Overview |
| ⌥P | Pyramid |
| ⌥D | Delivery |
| ⌥C | Changelog |
| ⌥X | Quality › Matrix |
| ⌥F | Quality › Findings |
| ⌥M | All maps |
| ⌥J | Journey map |
| ⌥L | Library (all nodes) |
| ⌥A | Acceptances |
| ⌥S | Show or hide the sidebar (same as ⌘B) |

⌥C, ⌥J and ⌥L are additions the user did not ask for explicitly. They are
proposed in the design and kept unless struck at review.

**Where they register.** In `ProjectSidebar`, which already owns every
href and sits inside `SidebarProvider` (for `useSidebar().toggleSidebar`).
It stays mounted on mobile too, where the shadcn primitive renders the menu
in a sheet. Navigation goes through `router.push`, just as clicking the
`Link` would.

**Registry.** A new `navigation` group. Keys are written with an `Alt`
token (`ALT_KEY_TOKEN`) beside `Mod`. `formatShortcutKey` renders it as `⌥`
when `useModKeyLabel()` reports ⌘, and as `Alt` otherwise (and while the
platform is still unknown, the same SSR rule `Mod` follows).

**The reveal.** A `useOptionHeld()` hook over `useHeldKeys()` returns true
when the only held key is Alt. That way ⌥⇧ or ⌥⌘ doesn't paint chips. While
a chord's letter is down the chips hide, and they come back if Option is
still held, which is fine for pressing several chords in a row. A
small `SidebarHotkeyHint` renders the chip after each item's label, with the
same classes as the Search `⌘K` chip: `ml-auto … group-data-[collapsible=icon]:hidden`,
so it's hidden in icon mode, like the Search chip. It renders nothing while
the reveal is off, so the sidebar's layout does not change until Option is
held. The key-state tracker clears on window blur, so ⌘-Tab away with
Option down does not leave chips painted.

**Tests.**
- Every navigation entry resolves to a sidebar destination: a pure
  `NAV_HOTKEY_ROUTES` table (entry id → path suffix) sits beside the
  registry, and the test checks it one-to-one against the `navigation` group.
- Chord uniqueness (from part 1) now covers the new group.
- `formatShortcutKey("Alt", "⌘") === "⌥"`, `("Alt", "Ctrl") === "Alt"`, and
  `("Alt", null) === "Alt"`.

**Known limitation.** On Windows and Linux, Chrome keeps some Alt+letter chords
(Alt+D focuses the address bar, Alt+F opens the menu), and a page can't
always win. Documented, not worked around: the audience is on macOS, where
Option chords are the page's.

**Lab Note:** yes. It covers the Option-chord navigation and the reveal, and
touches the sidebar view.

## Part 3 — toolbar hotkeys

**Bindings** (bare keys and ⌥E, `ignoreInputs: true`):

| Key | Surfaces | Action |
|---|---|---|
| `i` / `w` / `a` | Acceptances, Delivery | Filter to iOS / Web / Android. Pressing the key for the selected platform goes back to all. |
| `c` | Acceptances, Quality findings, Delivery | Clear filters |
| ⌥E | Acceptances, Decisions, Changelog | Expand or collapse, the same as that bar's toggle |

**Registered inside each filter bar**, since the bar owns the state the
binding reads: `showPlatformFilter`, `platformOptions`, `isFiltered`, the
toggle's handler. A bar that is not mounted has no bindings, and that is the
scoping.

**Gating uses `enabled`, not a no-op callback.** With the default
`preventDefault: true`, a callback that declines would still swallow the key.
So:
- `i`/`w`/`a` are `enabled` only while `showPlatformFilter` is true **and**
  that platform is in `platformOptions`.
- `c` is `enabled` only while `isFiltered`.

**Also guarded handlers, found in review.** `enabled` alone is not enough for a
bare key: TanStack's `ignoreInputs` does not recognise a Radix `Select`
trigger or `Combobox` field (`role="combobox"`) or its open listbox, and Radix
does not stop propagation on those, so a bare letter typed while picking an
option would otherwise fire straight through and act on the surface behind
the menu — and holding the key would autorepeat a toggle like Clear or
Expand. Every toolbar callback (`i`/`w`/`a`, `c`, ⌥E) is wrapped in
`toolbarKey()` (`lib/hooks/useShortcut.ts`), which declines on
`event.repeat`, on an `isEditableElement` target (inputs, textareas,
`role="textbox"`/`"combobox"`), and while `OPEN_OVERLAY_SELECTOR`
(`lib/utils/keyboard.ts`) matches any open Radix layer — before calling
`preventDefault()` and firing. `GUARDED_HOTKEY` is spread into every toolbar
registration's options alongside `enabled`, same as Part 1's Escape handler.

**Pure helper.** `nextPlatformFilter(current, pressed)` lives in
`lib/utils/keyboard.ts`: pressing the current platform returns `"all"`,
anything else returns `pressed`. `PLATFORM_HOTKEYS` (`i → ios`, `w → web`,
`a → android`) lives in the registry.

**Per-surface wiring.**
- **Acceptances.** Platform keys go through the same `onChange` the Select
  uses (the URL stays the source of truth). `c` runs the Clear button's
  handler. ⌥E runs `onToggleExpandAll`.
- **Delivery.** Platform keys call `onPlatformChange`. The bar has no Clear
  button today, so a new `onClearFilters` prop resets the page's state to
  its defaults (platform `all`, species `["view"]`, all-statuses off, empty
  search). `isFiltered` means "differs from those defaults". No visible Clear
  button is added. That would be a UI change beyond this feature.
- **Quality.** `c` runs the existing Clear button's handler, with its
  existing `isFiltered`.
- **Decisions, Changelog.** ⌥E runs the existing detail toggle.

**Cheat sheet.** A `toolbar` group lists the three, scoped `project`, with
a description naming the surfaces ("On Acceptances and Delivery").

**Tests.**
- `nextPlatformFilter` truth table: `all + i → ios`, `ios + i → all`,
  `ios + w → web`.
- `PLATFORM_HOTKEYS` covers exactly `PLATFORM_IDS`, one letter each, and those
  letters collide with no other registry chord.
- Chord uniqueness: the bare `a` (Android) and ⌥A (Acceptances) must not
  count as a clash. The test compares parsed modifiers, not letters.

**Lab Note:** yes, covering the filter and expand keys. It touches the
Acceptances, Delivery, Quality, Decisions and Changelog views.

## Out of scope

- A database platform (a schema change with its own ripple).
- A visible Clear button on Delivery.
- Remapping or user-customisable bindings.
- Hotkeys on the map canvases beyond the migrated Delete/Backspace.
