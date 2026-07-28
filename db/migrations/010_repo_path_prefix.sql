-- 010_repo_path_prefix.sql
--
-- Path-scoped repository links: several links per (project, repository), each
-- scoping a platform to one subtree of a monorepo
-- (docs/hosted-projects.md § Monorepos).
--
-- WHY THE PRIMARY KEY MOVES. 009 keyed project_repos on
-- (project_id, provider, repo_full_name), which is the sentence "a project
-- links a repository at most once" — and that sentence is exactly what makes a
-- monorepo unrepresentable, because `apps/ios` -> ios and `apps/webapp` -> web
-- are two links to ONE repository from ONE project. Adding the column without
-- moving the key would leave the second link rejected as a duplicate row, so
-- the two halves of this file are one change and not two.
--
-- `''` IS THE WHOLE REPOSITORY, and it is the DEFAULT, so every row 009 wrote
-- keeps both its meaning and its identity: (project, provider, repo) becomes
-- (project, provider, repo, ''), and the webhook resolves it exactly as before.
-- No backfill, no data migration, nothing to get wrong on a live database.
-- The default also makes the whole-repository link SINGULAR by construction —
-- the empty prefix is one value, so the key admits at most one of them per
-- (project, repository). That is what lets the resolver speak of "the fallback
-- link" rather than "one of the fallback links".
--
-- NOT LOWERCASED, unlike `repo_full_name` two columns away. GitHub treats
-- repository NAMES case-insensitively and webhook payloads promise no
-- particular case, so that column is folded on write. Paths INSIDE a repository
-- are the opposite: git tracks `Apps/iOS` and `apps/ios` as different paths, and
-- folding a prefix would make a link match files it does not cover. The
-- asymmetry between the two columns is deliberate, not an oversight in one.
--
-- THE CHECK CONSTRAINT records the normal form the matcher assumes: no leading
-- or trailing `/`, no empty segment, no leading or trailing whitespace.
-- Prefixes are normalised in application code before they are written
-- (lib/services/github/paths.ts); this makes a row that skipped that path —
-- hand-edited, restored from elsewhere, written by some future caller —
-- unstorable rather than silently unmatchable, which is the failure with no
-- symptom: a link that exists, looks right in the dialog, and never matches a
-- single pull request. It is a FLOOR, not the normaliser: it cannot express
-- "a `./` segment was dropped", so the matcher still normalises what it reads.
-- Interior whitespace is allowed on purpose — `My App/ios` is a legal git path,
-- and rejecting it would trade a real prefix for a tidier rule.
--
-- SAFE TO RE-RUN BY HAND. `add column if not exists` is natively idempotent;
-- `add constraint` has no IF NOT EXISTS, so both constraint changes inspect
-- pg_constraint first and return early when the shape is already installed.
-- Nothing in db/ has a foreign key TO project_repos, so dropping its primary
-- key between two statements of one transaction cannot cascade anywhere.

alter table project_repos
  add column if not exists path_prefix text not null default '';

do $$
declare
  pk_name    text;
  pk_columns text[];
begin
  -- The CURRENT primary key, as column names in key order, read from the
  -- catalog rather than assumed: 009 wrote `primary key (...)` inline and let
  -- Postgres pick the constraint name, and a database restored from a dump can
  -- carry a different name for the same thing. Dropping by a guessed name is
  -- how a "safe to re-run" file stops being safe on exactly one deployment.
  select con.conname,
         array(select att.attname::text
                 from unnest(con.conkey) with ordinality as k(attnum, ord)
                 join pg_attribute att
                   on att.attrelid = con.conrelid and att.attnum = k.attnum
                order by k.ord)
    into pk_name, pk_columns
    from pg_constraint con
   where con.conrelid = 'project_repos'::regclass
     and con.contype = 'p';

  -- Already the shape this file installs. CI's second `npm run db:migrate`
  -- never reaches here (the runner skips files recorded in _migrations), but a
  -- hand re-run does, and this is where it stops.
  --
  -- Compared as an ORDERED array rather than "does it contain path_prefix", so
  -- the guarantee this file makes is exact: afterwards the primary key IS these
  -- four columns IN THIS ORDER. A containment test would silently accept a
  -- wrong column order and leave the index useless for the lookups below.
  if pk_columns = array['project_id', 'provider', 'repo_full_name', 'path_prefix'] then
    return;
  end if;

  -- NULL when the table has no primary key at all — a state this file does not
  -- create but should not choke on. The comparison above is NULL there too, so
  -- the early return correctly did not fire.
  if pk_name is not null then
    execute format('alter table project_repos drop constraint %I', pk_name);
  end if;

  -- `path_prefix` LAST, deliberately. This constraint's index is also what
  -- `listRepoLinks` scans by (project_id, provider) and what `linkRepo`'s
  -- ON CONFLICT probes. A leading path_prefix would put the least selective
  -- column first and make the index useless for both.
  alter table project_repos
    add constraint project_repos_pkey
    primary key (project_id, provider, repo_full_name, path_prefix);
end $$;

do $$
begin
  -- `alter table ... add constraint ... check` has no IF NOT EXISTS, and a
  -- second hand-run raising "constraint already exists" would roll back the
  -- WHOLE file, taking the column add with it.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'project_repos'::regclass
       and conname  = 'project_repos_path_prefix_check'
  ) then
    -- Five independent NEGATIVE rules, each naming one storable-but-unmatchable
    -- prefix. Deliberately not a whitelist character class: that shape is the
    -- one this codebase has already had to widen twice, and it would reject
    -- `My App/ios`, which is a legal git path.
    alter table project_repos
      add constraint project_repos_path_prefix_check
      check (
        path_prefix = ''
        or (    path_prefix !~ '^/'    -- "/apps/ios": leading slash, matches nothing
            and path_prefix !~ '/$'    -- "apps/ios/": trailing slash, same
            and path_prefix !~ '//'    -- "apps//ios": an empty segment
            and path_prefix !~ '^\s'   -- " apps/ios": pasted with a space
            and path_prefix !~ '\s$')  -- "apps/ios ": same, other end
      );
  end if;
end $$;
