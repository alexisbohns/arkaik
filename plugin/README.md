# Arkaik — Claude Code plugin

A second distribution channel for the Arkaik agent skill, alongside `arkaik
init` (issue #220): install it as a marketplace plugin instead of scaffolding
it with the CLI. Both channels ship the exact same generated assets — see
[Single source of truth](#single-source-of-truth-generated-not-hand-copied)
below (`docs/spec/toolchain.md` § Skill Distribution, "second channel").

## Layout

```
.claude-plugin/
  marketplace.json           # the marketplace catalog (repo root)
plugin/
  .claude-plugin/
    plugin.json               # the plugin manifest (generated)
  .mcp.json                   # declares the arkaik-mcp server (generated) — skill + tools, one install
  skills/
    arkaik/
      SKILL.md                 # generated copy of docs/arkaik-skill/skill.md
      references/
        schema.md               # generated copy of docs/arkaik-skill/references/schema.md
      scripts/
        validate-bundle.js       # generated copy of docs/arkaik-skill/scripts/validate-bundle.js
```

The marketplace manifest lives at `.claude-plugin/marketplace.json` **at the
repository root** — not inside `plugin/` — because that's the location the
`owner/repo` GitHub shorthand (`/plugin marketplace add alexisbohns/arkaik`)
resolves against; see
[Host on GitHub](https://code.claude.com/docs/en/plugin-marketplaces#host-on-github-recommended).
Its single entry points at `./plugin`, a relative path resolved from the
marketplace root, i.e. the repo root
(["Relative paths"](https://code.claude.com/docs/en/plugin-marketplaces#relative-paths)).

The plugin's own component layout (`skills/<name>/SKILL.md`, with
`references/` and `scripts/` as supporting files alongside it) follows
[Plugins reference § Skills](https://code.claude.com/docs/en/plugins-reference#skills)
— `SKILL.md` must be exactly that filename, uppercase, for discovery.

**Why a top-level `plugin/` directory** rather than `packages/plugin/`: this
isn't an npm package — it has no `package.json` and isn't published to npm —
so it doesn't belong under the `packages/*` npm workspace glob
(`package.json` → `"workspaces": ["packages/*"]`; npm expects every matched
directory to be a package). A dedicated top-level directory keeps that
distinction obvious, while the marketplace manifest stays at the repo root
for the install ergonomics described above.

## Install

```
/plugin marketplace add alexisbohns/arkaik
/plugin install arkaik@arkaik
```

(Or, for local testing before publishing: `/plugin marketplace add .` from
the repo root.)

## Single source of truth (generated, not hand-copied)

The skill and its two generated siblings live once, canonically, at
`docs/arkaik-skill/` (`skill.md`, `references/schema.md`,
`scripts/validate-bundle.js` — the latter two are themselves generated from
`@arkaik/schema`, see `docs/spec/toolchain.md` § `@arkaik/schema`). Nothing
under `plugin/skills/arkaik/` is hand-edited: `npm run generate` runs
`scripts/generate/generate-plugin.js` last (after the schema doc and
validator are regenerated) to:

1. Copy `docs/arkaik-skill/skill.md` → `plugin/skills/arkaik/SKILL.md`,
   `docs/arkaik-skill/references/schema.md` →
   `plugin/skills/arkaik/references/schema.md`, and
   `docs/arkaik-skill/scripts/validate-bundle.js` →
   `plugin/skills/arkaik/scripts/validate-bundle.js`, byte-for-byte.
2. Regenerate `plugin/.claude-plugin/plugin.json` in full, stamping its
   `version` field from the skill's own frontmatter `version` stamp (see
   [Version lockstep](#version-lockstep)).

CI (`.github/workflows/ci.yml` → "Fail on generated-artifact drift") runs
`npm run generate` and then `git diff --exit-code` over these plugin paths
alongside the other generated contract artifacts, so a stale plugin fails the
build exactly like a stale `validate-bundle.js` or `schema.md` would.

## Static plugin, rendered `init` — the render-vs-static decision

`arkaik init` installs the skill as a *render*: `{{PRODUCT_NAME}}`,
`{{BUNDLE_PATH}}`, and `{{JOURNAL_PATH}}` are substituted per project. A
marketplace plugin can't do that — it ships static files, with no
per-project install step to hook a substitution into.

**Decision: the plugin ships the skill unrendered.** `SKILL.md` here is the
raw, untemplated `docs/arkaik-skill/skill.md`, placeholders and all. This
relies on the skill's own "Template parameters" section
(`skill.md` → *Template parameters*), which documents the parenthetical
defaults (`{{PRODUCT_NAME}}` → "the current product", `{{BUNDLE_PATH}}` →
`docs/arkaik/bundle.json`, `{{JOURNAL_PATH}}` → `docs/arkaik/journal.jsonl`)
and instructs the agent to treat those defaults as the values when reading a
raw, unrendered copy — plus the agent's own judgment about the actual product
and file locations from context. Projects that want per-project substitution
(a non-default bundle path, an explicit product name) should use the `arkaik
init` channel instead; the two channels are not meant to be identical, just
compatible.

## Version lockstep

`plugin/.claude-plugin/plugin.json`'s `version` field is *generated from* the
skill's frontmatter `version` stamp (`docs/arkaik-skill/skill.md`,
`version: 3.0.0`) — never hand-set — so a skill version bump and a plugin
manifest version bump cannot drift apart. `npm run generate` is the only
thing that writes `plugin.json`.
