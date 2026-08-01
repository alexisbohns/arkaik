# CLAUDE.md — working in the Arkaik repo

Arkaik is a product graph browser built with React Flow on Next.js — a
local-first, navigable map of a product's anatomy (flows, views, data models,
API endpoints, acceptances) as an atomic 5-species graph. Orientation lives in
[`README.md`](README.md).

## Lab Note requirement — read before opening a PR

Arkaik is wired to the Ariko Lab Note pipeline. **When you open a PR that ships
something a user would notice, you MUST include a Lab Note in the PR body.**
Merging the PR posts it to the Ariko inbox automatically — no copy-paste.

This section is the always-loaded summary and is **self-sufficient**: you can
author a valid note from it alone, with no plugin installed. The `lab-note`
skill (installable via `/plugin install lab-note@ariko`) is the source of truth
for full tone guidance and the per-repo molecule table.

**The gate.** User-facing change → write a note. Chore, refactor, infra, or
docs-only change → **no note** (leave the section out; if the advisory reminder
comments on your PR, add the **`no-lab-note`** label to silence it).

**The contract.** One section whose heading **starts with** `## Lab Note`,
containing exactly one ` ```yaml ` fence. `en.title` and `en.summary` are
**required**; `fr.*` is recommended (a real adaptation, not a literal
translation, using the informal "Tu"); `suggested` is optional. Unknown
top-level keys are ignored. Skeleton:

```yaml
en:
  title: "Short, benefit-first title"            # required — always quoted
  summary: "One or two sentences, user-facing."  # required — always quoted
fr:                                              # recommended — adaptation, informal "Tu"
  title: "Titre court, orienté bénéfice"
  summary: "Une ou deux phrases, adaptées, pas traduites littéralement."
suggested:                                       # optional — prefills triage in the Ariko admin
  molecule: arkaik       # THIS repo's molecule slug
  type: feature          # feature | improvement | fix | announcement
  tags: [changelog]
  # atom: <slug>         # ONLY when you know the slug exists — never guess
```

**Always double-quote every title and summary.** A colon is the natural way to
write a sentence ("Heads up: it moved", "ton compte : ceux que...") and it is
exactly what an unquoted YAML value cannot hold — the parser reads `key: value`
and the whole note fails. Quoting removes the failure mode outright, and makes
apostrophes and em dashes free too. Slug-ish values (`molecule`, `type`,
`tags`) need no quotes.

**Tone.** Lead with the benefit, not the mechanism; keep it short; warm and a
little playful, never corporate; no engineering jargon, ticket numbers, or
internal names.

**This repo's molecule slug is `arkaik`.** A malformed note fails the
post-on-merge job loudly (e.g. `en.title is required`); the advisory reminder
surfaces the same problems at PR-open time, as a comment on the PR. **After
opening a PR, read its comments** instead of assuming the note is fine — the
reminder clears its own comment once the body is fixed. Fix by editing the PR
body — posting is idempotent.

Full pipeline docs: [ariko README — "Making it a requirement"](https://github.com/alexisbohns/ariko#lab-note-pipeline-c1--github-connector).
