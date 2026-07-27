-- 009_project_repos.sql
--
-- Linking a hosted project to the repositories that implement it, so a PR can
-- find the acceptance it delivers (docs/spec/bundle-format.md § References).
--
-- THE PLATFORM COLUMN is the interesting one. Acceptances carry per-platform
-- statuses, and a product's platforms usually live in different repositories.
-- Recording the platform on the LINK means a PR merged in the iOS repo marks
-- only iOS shipped — with no per-PR annotation, and no way for someone to
-- forget. Web and Android then show up as a real parity gap, which is what the
-- gap projection is for. A repo that serves every platform leaves it null.
--
-- `installation_id` is the GitHub App installation that delivers the webhook.
-- It is stored per link rather than per owner because one account can install
-- the App on several organisations.
--
-- Deliveries are recorded so a redelivered webhook — GitHub retries, and its
-- "Redeliver" button is one click — cannot apply the same transition twice.
--
-- Every statement uses IF NOT EXISTS so the file is safe to re-run by hand.

create table if not exists project_repos (
  project_id      text        not null references graph_projects(id) on delete cascade,
  provider        text        not null default 'github',
  -- "owner/name", lowercased on write: GitHub treats these case-insensitively
  -- and webhook payloads do not promise a particular case.
  repo_full_name  text        not null,
  platform        text,
  installation_id text,
  created_at      timestamptz not null default now(),
  primary key (project_id, provider, repo_full_name),
  constraint project_repos_platform_check
    check (platform is null or platform in ('web', 'ios', 'android'))
);

-- The webhook's lookup: given a repo, which projects care about it? A repo can
-- legitimately serve more than one project (a monorepo), so this is not unique.
create index if not exists project_repos_lookup_idx on project_repos (provider, repo_full_name);

-- Webhook delivery ledger, for replay protection. GitHub retries failed
-- deliveries and offers a manual redeliver button; without this, a retry after
-- a partially-successful run would re-apply transitions.
create table if not exists github_deliveries (
  delivery_id text        not null,
  received_at timestamptz not null default now(),
  primary key (delivery_id)
);

-- Deliveries older than a day cannot be replayed by GitHub any more, so the
-- ledger is pruned opportunistically on write rather than kept forever.
create index if not exists github_deliveries_received_idx on github_deliveries (received_at);
