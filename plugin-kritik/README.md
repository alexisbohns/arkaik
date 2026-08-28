# Kritik — Claude Code plugin

The quality layer as an installable agent skill: score each criterion on each
surface against observable maturity anchors, record findings carrying risk and
remediation cost, and roll the result into a comparative matrix whose
anti-averaging caps stop one open Critical from being averaged into a B.

The design is [RFC: Kritik](../docs/rfcs/kritik.md); the meta-model and the
88-criterion pack are [`packages/kritik-library`](../packages/kritik-library/)
(MIT); the roll-up it runs is `deriveQualityMatrix` from `@arkaik/schema`, the
same projection the app renders.

## Install

```
/plugin marketplace add alexisbohns/arkaik
/plugin install kritik@arkaik
```

(Or, for local testing before publishing: `/plugin marketplace add .` from the
repo root.) `kritik` is the second entry in the same marketplace as `arkaik`;
neither requires the other. Kritik audits a codebase whether or not it has a
product map — the map only adds the ability to tie a finding to a node.

## Layout

```
.claude-plugin/
  marketplace.json           # the marketplace catalog (repo root) — two entries
plugin-kritik/
  .claude-plugin/
    plugin.json               # the plugin manifest (generated)
  skills/
    kritik/
      SKILL.md                 # generated copy of docs/kritik-skill/skill.md
      references/
        framework.md            # generated copy of packages/kritik-library/SPEC.md
        library.json            # generated copy of packages/kritik-library/framework.json
      scripts/
        compute-matrix.js       # the roll-up — the only thing that writes matrix.json
        scaffold-criterion.js   # custom criteria + issue skeletons
        init-profile.js         # the install-time surface picker
```

Supporting files sit **beside `SKILL.md`**, not at the plugin root
([Plugins reference § Skills](https://code.claude.com/docs/en/plugins-reference#skills)),
the same layout `plugin/skills/arkaik/` uses. That is what makes
`node <skill-path>/scripts/compute-matrix.js` resolvable from the repo being
audited: the scripts travel with the skill, the data stays in the user's repo.

The scripts are esbuild bundles of `packages/schema/src/cli/kritik-*.ts`,
zero-dependency for the same reason `validate-bundle.js` is: an agent auditing a
repo that has no `node_modules` must still be able to run the gate. They are a
few kB each — everything they import from the schema package is the zod-free
half, so there is nothing to drag in behind it.

## What an install decides

Two things are per-project, and the plugin ships neither:

**The surface list.** A **surface** is one independently assessable body of code
— deliberately not the same vocabulary as an Arkaik platform, since `web`,
`ios`, and `android` name where a *view* ships while an admin back-office or a
database contract ships none. `init-profile.js` writes the choice to
`docs/quality/profile.json`, and the matrix has exactly those columns
thereafter. A single-surface app picks one and every cell set collapses to one
column; that is the normal case, not a degenerate one.

**The project's own criteria.** The pack is written for a product *class*.
`scaffold-criterion.js` adds criteria specific to this product — with their own
anchors, signals, and issue skeleton — into `docs/quality/criteria.custom.json`,
which is layered over the pack at load. **A pack upgrade rewrites the pack and
never touches the overlay**, which is the entire reason they are separate files.
Custom criteria roll up into their domain, or into a domain the project defines,
exactly like pack ones.

## What it writes

```
docs/quality/
  profile.json            # the surfaces and domain weights
  criteria.custom.json    # this project's own criteria
  audits/<YYYY-MM>/
    scores.json           # assessments
    findings.json         # findings
    matrix.json           # GENERATED — compute-matrix.js is the only writer
```

These sidecars are **canonical in a repository**, the same doctrine as the
journal's JSONL sidecar (`docs/spec/journal.md` § Storage Shapes): a bundle's
`quality` section is the interchange projection of them, never the other way
round.

`docs/quality/` is deliberately not published. A quality section enumerates
open, unfixed defects with the file paths to reach them, so Publik strips it
from public snapshots unless a caller explicitly opts in
(`?include_quality=true`) and the `/docs` route treats the whole area as
internal. See the RFC's § 8.3.

## Single source of truth (generated, not hand-copied)

Nothing under `plugin-kritik/` is hand-edited. `npm run generate` runs
`build-kritik-scripts.js` and then `generate-kritik-plugin.js` to:

1. Bundle `packages/schema/src/cli/kritik-{matrix,criterion,profile}-cli.ts`
   into `scripts/`.
2. Copy `docs/kritik-skill/skill.md` → `skills/kritik/SKILL.md`,
   `packages/kritik-library/SPEC.md` → `references/framework.md`, and
   `packages/kritik-library/framework.json` → `references/library.json`,
   byte-for-byte.
3. Rewrite `plugin.json` in full, stamping its `version` from the skill's own
   frontmatter so the two can never drift.

CI (`.github/workflows/ci.yml` → "Fail on generated-artifact drift") diffs the
whole directory, so a stale plugin fails the build exactly like a stale
`validate-bundle.js` would.

**The pack is embedded, not depended on.** `@arkaik/kritik-library` stays a
private workspace package and the plugin ships a copy of it, because a repo that
installs this plugin has no `node_modules` to resolve a dependency through —
the same answer, for the same reason, as the schema reference in the `arkaik`
plugin.

## Static plugin, no render step

Unlike the `arkaik` skill, this one has **no template parameters**. Every path
it names is a fixed default under `docs/quality/`, and everything
project-specific lives in `profile.json` and `criteria.custom.json` — data the
install writes, not a substitution baked into the prose. So the plugin channel
and any future `arkaik kritik init` channel ship the identical skill text.
