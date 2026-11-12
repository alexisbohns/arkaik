# The Arkademy library — operator guide

The Arkademy's pages read one JSON document, the **library**: its tools (today
the Business Model Canvas), the example companies, the entities they share and
each company's own wording. The library is data, not code. It is never
committed: the owner keeps it in a gitignored folder, uploads it with a script,
and the app reads it back from Postgres only — in development as in
production. The design is
`docs/superpowers/specs/2026-11-12-arkademy-bmc-design.md`.

This area of `docs/` is internal (`lib/utils/docs-visibility.ts`); the public
contract of the route and the table is
[spec/services.md § Arkademy](spec/services.md).

## The document

The shape and its rules live in `lib/arkademy/schema.ts`; the rules across
fields (unknown ids, kinds that do not match, more than five answers, an
open question that is also answered) in `lib/arkademy/validate.ts`. A finding
names a JSON path such as `uses[12].entity`. Errors refuse the upload;
warnings are printed and the upload goes ahead.

Two content rules no validator can check:

- **An entity id is permanent once uploaded.** A visitor's browser may hold
  it. Relabelling an entity is free; renaming its id is not.
- Two companies share an entity by pointing at the same id, each with its own
  `text`.
- **A fact goes in a note, never in a wording.** A figure, a date, a named
  supplier — anything a reader could ask "says who?" about — is a use's
  `note`, with its source: a name, an `https` link and a date — the date the
  source carries (`dateKind: "published"`), or for an undated page such as a
  pricing page the day it was read (`dateKind: "accessed"`). A fact with no
  source a reader can open stays out of the library. The link carries no
  username or password and is written the way a browser normalises it: a
  lowercase scheme and host, no `:443`, no `/../`, spaces and accented
  characters percent-encoded (`https://example.com/mar%C3%A9e`). Paste it
  from the address bar; a bare origin may leave out its trailing slash.
  `check` warns on a wording that looks like a figure or a press claim, and on
  a note dated in the future.

Every text field refuses characters a reader cannot see or Postgres cannot
store: control characters (a newline and a tab are allowed in the two
multi-line fields, `pitch.body[]` and `prompt.text`, and nowhere else; a
carriage return nowhere), DEL, U+2028 and U+2029, zero-width characters
(U+200B–U+200D, U+2060–U+2064, U+FEFF, U+180E), bidirectional controls
(U+061C, U+200E, U+200F, U+202A–U+202E, U+2066–U+2069) and a lone surrogate.
The error names the code point. Accents, emoji and no-break spaces (U+00A0,
U+202F) are fine.

A key written twice in one object is an error (`JSON.parse` would keep the
last and drop the first without a word), and so is a `__proto__` key anywhere
(it would be dropped too). `check` and `publish` read the file's text for the
first; the second is `validateArkademyDocument`'s.

`tests/fixtures/arkademy/document.json` is a small, fictional, valid document
to copy the shape from.

## The content folder

`arkademy-content/` at the repository root is gitignored. It holds
`arkademy.json` and whatever drafts sit beside it; the script reads one file.
A gitignored folder belongs to one checkout — a git worktree does not see the
main checkout's ignored files — so keep the content in the main checkout and,
from anywhere else, pass its path or set `ARKADEMY_CONTENT`.

## The commands

```
npm run arkademy -- check    [file]                     validate only, no database
npm run arkademy -- publish  [file] [--note "…"] [--yes]
npm run arkademy -- status                             the last ten versions
npm run arkademy -- rollback [--to N] [--yes]
```

`file` defaults to `$ARKADEMY_CONTENT`, then `arkademy-content/arkademy.json`.
A relative path is read from the directory you typed the command in.

The database is `DATABASE_URL`, as for `npm run db:migrate`. Before anything
else the script prints the database name and host the driver will actually
connect to (never the password) — a `?host=` parameter in the URL and
`PGHOST`/`PGDATABASE` in the environment count, exactly as they do when it
connects — and refuses a write to anything but this machine (a Unix socket,
`localhost`, an address in `127.0.0.0/8`, or `::1`) without `--yes`. Exit codes: 0 done
(or nothing to do), 1 refused or failed, 2 a usage mistake.

- **check** validates the file and prints its findings. Nothing else.
- **publish** validates, then inserts the document as the next version — or
  prints `unchanged (vN)` when it is the current document already (compared by
  the SHA-256 of its canonical JSON, so key order and whitespace in the file
  do not count). Two publishes at once collide on the version; the loser exits
  1 and writes nothing.
- **status** lists the last ten versions: version, upload time, size, the hash's
  first eight characters, the version a rollback restored, the note.
- **rollback** re-publishes an earlier version as a new one, with
  `restored_from` set and the note `rollback to vN`. The default target is the
  newest earlier version whose content differs from the current one; `--to N`
  names one. The target is re-validated against today's schema first and
  refused if it no longer passes. A rollback is undone the same way.

Nothing is ever updated or deleted: every version stays in the table.

## Local development

```
npm run db:migrate                                   # once, against the Postgres in .env.local
node --env-file=.env.local scripts/arkademy/upload.js publish
```

or `DATABASE_URL=postgres://… npm run arkademy -- publish`. In development
the app reads Postgres on every request, so the next reload shows the upload.

## Production

The table is created by `migrate-prod` when the migration lands on `main`.
Publish with the production connection string — the value behind Vercel's
production `DATABASE_URL` and the `PROD_DATABASE_URL` Actions secret — kept in
a `.env.arkademy-prod` file (gitignored by `.env*`):

```
node --env-file=.env.arkademy-prod scripts/arkademy/upload.js publish --note "…" --yes
```

Not `.env.production.local`, nor any `.env`, `.env.local`,
`.env.production` or `.env.development*`: Next loads those by itself
(`@next/env`: `.env.<mode>.local`, `.env.local`, `.env.<mode>`, `.env`), so a
local `next build` or `next start` in that checkout would run against the
production database. Next never reads `.env.arkademy-prod`; only the
`--env-file` above does.

The app caches the validated library for five minutes
(`ARKADEMY_CACHE_SECONDS`), so a publish or a rollback is live after the
first request more than five minutes after the previous refill. Nothing purges
the cache from the script. Check with:

```
curl -s https://arkaik.app/api/arkademy | head -c 200
curl -sI https://arkaik.app/api/arkademy        # twice: the CDN should answer the second
```

## When the app cannot show it

| `GET /api/arkademy` | Meaning | Fix |
|---|---|---|
| 503 `services_unavailable` | No `DATABASE_URL` on this deployment | Configure the database |
| 404 `no_document` | The table is empty | `publish` |
| 500 `document_invalid` | The newest row fails this deployment's schema (the server log names the version and the first finding) | `rollback`, or publish a fixed document |
| 500 `internal_error` | Postgres failed | Check the database |
