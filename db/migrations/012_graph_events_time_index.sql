-- 012_graph_events_time_index.sql
--
-- An index on each event's position in TIME — `(ts, id)` — for the History
-- page's paged read, `GET …/journal/page` (docs/spec/services.md § Hosted
-- Graph Projects → Read contract).
--
-- WHY NOT seq. 008's (project_id, seq) is arrival order. History has always
-- shown events where they HAPPENED — `orderEvents`' (ts, id) order from
-- @arkaik/schema — and the two differ whenever an append is minted with an
-- earlier timestamp than rows already stored (a merged PR's deliverable
-- carries the merge time). Paging by seq would move those events; paging by
-- (ts, id) without an index would sort the project's whole journal for every
-- page. Event ids are unique per project (008's primary key), so (ts, id) is
-- a total order and a keyset cursor needs nothing else.
--
-- THE EXPRESSIONS ARE THE CONTRACT. `getJournalPage` must spell them exactly
-- like this to use the index, and they mirror `journalCursorOf`: a ts that is
-- not a JSON string sorts as the empty string. `collate "C"` makes the
-- comparison byte order, which agrees with the JavaScript comparison
-- `orderEvents` uses for the ISO timestamps and ULIDs real journals hold —
-- the database's default collation would not (it ignores punctuation).
--
-- IDEMPOTENT and in-transaction, like 011 — see its note on `concurrently`.
create index if not exists graph_events_project_time_idx
  on graph_events (
    project_id,
    (case when jsonb_typeof(event->'ts') = 'string' then event->>'ts' else '' end) collate "C",
    id collate "C"
  );
