# A door to `live` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a CI job holding a narrow `release:append` token mark an acceptance `live` on one platform, with evidence, and make `live` a status ref promotions keep rather than re-earn.

**Architecture:** Two stacked PRs. Part 1 (`live-1-schema`) changes `@arkaik/schema`: `computeRefPromotions` refuses to move a `live` scope, the default `ref_policy` maps merged → `releasing`, and `node.status_changed` gains an optional `detail`. Part 2 (`live-2-door`) adds the scope, a DB-free planner (`lib/services/graph/live.ts`), an `annotations` input on `applyMutation` that stamps `detail` onto derived status events, the route `POST /api/graph/projects/{id}/live`, the token checkbox, the journal row, and docs.

**Tech Stack:** TypeScript, Next.js route handlers, zod (schema package), plain-Node test scripts (`check()` harness, `ts.transpileModule` loaders), Postgres for the route suite.

**Spec:** `docs/superpowers/specs/2026-10-08-live-delivery-door-design.md`. Read it first.

**Branching:** Part 1 lives on `live-1-schema` (already created from main, carrying the spec and this plan). Part 2 branches from `live-1-schema` as `live-2-door`. PRs are chained with `gh stack` (use the `gh-stack` skill when you reach Task 12). Each PR body carries a Lab Note (CLAUDE.md § Lab Note requirement).

**Conventions that bite here (from memory, verified):**
- CI diffs generated artifacts: run `npm run generate` after any `packages/schema/src` change and commit the result.
- CI runs eslint and fails on errors: `npm run lint` before every commit that touches `.ts/.tsx`.
- Typecheck is `npx tsc --noEmit -p .` (root tsconfig includes `tests/**/*.ts`).
- A new `@/…` import in a module a test loader compiles needs a rewrite in that loader's table, or the suite fails to load. `tests/services/load-graph-api.js` is the one touched here.
- Count-based assertions (`arr.length === n`) have broken CI repeatedly; assert by identity (`find(...)`, `every(...)`).
- Postgres suites (`test:graph`, `test:github`, `test:tokens`) run locally against a scratchpad cluster; the recipe is in Task 0.

---

## Task 0: Local Postgres for the service suites (run once per session)

Needed by Tasks 2, 5, 8. Skip if `DATABASE_URL` already points at a migrated database.

- [ ] **Step 1: Start a scratchpad cluster**

```bash
SCRATCH=/private/tmp/claude-503/-Users-alexis-code-arkaik/12efde8f-6a76-426c-8852-4320a295c7ed/scratchpad
initdb -D "$SCRATCH/pgdata" -U arkaik --auth=trust
pg_ctl -D "$SCRATCH/pgdata" -l "$SCRATCH/pg.log" \
  -o "-p 5432 -c listen_addresses=localhost -c unix_socket_directories=''" start
createdb -h localhost -p 5432 -U arkaik arkaik_test
cd /Users/alexis/code/arkaik
DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test npm run db:migrate
```

Expected: `pg_ctl` prints `server started`; `db:migrate` lists applied migrations and exits 0.

- [ ] **Step 2: Export it for the rest of the session**

Every Postgres-backed command below is written as `DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test npm run …`. Use that exact prefix.

---

# Part 1 — `live-1-schema`

## Task 1: `live` is kept — the guard in `computeRefPromotions`

**Files:**
- Modify: `packages/schema/src/promote.ts` (SkippedPromotion union ~line 60; the loop body ~lines 130-150; header comment)
- Test: `tests/schema/promote.test.js` (the `// --- Guards` block, ~line 153)

- [ ] **Step 1: Write the failing tests**

In `tests/schema/promote.test.js`, inside `main()`, after the block that checks `"already-there is judged per platform, not on the base status"` (the last block of `// --- Guards`), add:

```js
  // --- Live is kept, not re-earned (#424) --------------------------------
  {
    // A follow-up PR on a shipped platform attaches its ref and moves
    // nothing: users still have the feature, and pulling the status back to
    // development would show a parity gap the product does not have.
    const reopened = acceptance("AC-keep", {
      metadata: { platformStatuses: { ios: "live" }, refs: [ref({ platform: "ios", external_status: "open" })] },
    });
    const plan = computeRefPromotions(bundle([reopened], true));
    check(
      "a reopened PR does not pull a live platform back to development",
      plan.promotions.find((p) => p.node_id === "AC-keep") === undefined,
      JSON.stringify(plan.promotions),
    );
    check("and the skip says live", plan.skipped[0]?.reason === "live", JSON.stringify(plan.skipped));
  }
  {
    const liveBase = acceptance("AC-kb", { status: "live", metadata: { refs: [ref({ external_status: "open" })] } });
    const plan = computeRefPromotions(bundle([liveBase], true));
    check(
      "an unscoped ref does not pull a live base status back either",
      plan.promotions.find((p) => p.node_id === "AC-kb") === undefined && plan.skipped[0]?.reason === "live",
      JSON.stringify(plan),
    );
  }
  {
    // The guard is on the status the ref TARGETS. A base move on a node whose
    // only live status is one platform's own entry still goes through, and
    // the overlay leaves that entry alone — ios stays live by its own entry.
    const mixed = acceptance("AC-mix", {
      status: "releasing",
      metadata: { platformStatuses: { ios: "live" }, refs: [ref({ external_status: "open" })] },
    });
    const plan = computeRefPromotions(bundle([mixed], true));
    const promotion = plan.promotions.find((p) => p.node_id === "AC-mix");
    check(
      "a base move is still planned when only a platform entry is live",
      promotion?.to === "development" && promotion?.platform === undefined,
      JSON.stringify(plan),
    );
    const patch = promotionPatch(mixed, promotion);
    check(
      "and the patch does not touch the live platform entry",
      patch.status === "development" && patch.metadata === undefined,
      JSON.stringify(patch),
    );
  }
  {
    // A mapping that says live on a live scope is still `already-there`, not
    // `live`: the two skips mean different things to the webhook's reporter.
    const liveToLive = acceptance("AC-ll", {
      metadata: { platformStatuses: { ios: "live" }, refs: [ref({ platform: "ios" })] },
    });
    const plan = computeRefPromotions(bundle([liveToLive], { "github-pr": { merged: "live" } }));
    check("live → live is already-there, not live", plan.skipped[0]?.reason === "already-there", JSON.stringify(plan.skipped));
  }
```

- [ ] **Step 2: Run the suite to see the new checks fail**

Run: `npm run test:promote`
Expected: `FAIL: a reopened PR does not pull a live platform back to development`, `FAIL: an unscoped ref does not pull a live base status back either` (the other two new checks pass already). Exit code 1.

- [ ] **Step 3: Implement the guard**

In `packages/schema/src/promote.ts`:

Change the `SkippedPromotion` reason union to:

```ts
  reason: "platform-not-applicable" | "archived" | "already-there" | "no-mapping" | "live";
```

In `computeRefPromotions`, replace the block

```ts
      const from = currentStatus(node, ref.platform);
      if (from === to) {
        skipped.push({ node_id: node.id, ref_id: ref.id, reason: "already-there", detail: to });
        continue;
      }
```

with

```ts
      const from = currentStatus(node, ref.platform);
      if (from === to) {
        skipped.push({ node_id: node.id, ref_id: ref.id, reason: "already-there", detail: to });
        continue;
      }

      // Live is kept, not re-earned (issue #424). A follow-up PR on a shipped
      // scope attaches its ref and moves nothing: users still have the
      // feature, and pulling the status back would show a parity gap the
      // product does not have. Judged on the status the ref TARGETS — the
      // platform entry for a scoped ref, the base for an unscoped one — so a
      // base move still goes through on a node whose only live status is one
      // platform's own entry, which the overlay leaves untouched. Only a
      // human edit moves a status off live.
      if (from === "live") {
        skipped.push({ node_id: node.id, ref_id: ref.id, reason: "live", detail: to });
        continue;
      }
```

In the header comment of the file, after the `── Per-platform, because acceptances are ──` paragraph, add:

```ts
 * ── Live is kept ───────────────────────────────────────────────────────────
 * `archived` has always been terminal for promotions. `live` is too (issue
 * #424): once a scope reads `live`, no mapped ref status moves it. A merge
 * that reworks a shipped acceptance is still a merge of something users have.
```

- [ ] **Step 4: Run the suite to see it pass**

Run: `npm run test:promote`
Expected: every line `PASS:`, ending `All promote checks passed.`

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npx tsc --noEmit -p . && \
git add packages/schema/src/promote.ts tests/schema/promote.test.js && \
git commit -m "feat(schema): live is kept — ref promotions never move a live scope (#424)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: The default policy maps merged → `releasing`

**Files:**
- Modify: `packages/schema/src/promote.ts` (`DEFAULT_REF_POLICY` and its doc comment, ~lines 40-48)
- Modify: `tests/schema/promote.test.js` (two existing checks)
- Modify: `tests/services/pr-plan.test.js` (`bundle()` fixture, ~line 102)
- Modify: `tests/services/github-webhook.test.js` (three fixtures: ~lines 195, 286, 505)
- Modify: `docs/hosted-projects.md` (§6 table, §7 bullets, the "naming no platform" bullet, the guards list)
- Modify: `docs/spec/bundle-format.md` (the "Promotion policy" row, ~line 180)

- [ ] **Step 1: Change the existing promote expectations first**

In `tests/schema/promote.test.js`:

Replace

```js
    check("a merged PR means live", plan.promotions[0]?.to === "live", JSON.stringify(plan.promotions[0]));
```

with

```js
    // #424: a merge is not a release. `live` is what a deploy signal says,
    // through the release:append door — never a merge.
    check("a merged PR means releasing, not live", plan.promotions[0]?.to === "releasing", JSON.stringify(plan.promotions[0]));
```

Replace the custom-policy block

```js
    const plan = computeRefPromotions(bundle([node], { "github-pr": { merged: "releasing" } }));
    check("a custom policy is honoured", plan.promotions[0]?.to === "releasing");
```

with

```js
    const plan = computeRefPromotions(bundle([node], { "github-pr": { merged: "live" } }));
    check("a custom policy is honoured — merge-means-live is now an explicit choice", plan.promotions[0]?.to === "live");
```

- [ ] **Step 2: Run the suite to see the first check fail**

Run: `npm run test:promote`
Expected: `FAIL: a merged PR means releasing, not live`. Exit code 1.

- [ ] **Step 3: Change the default**

In `packages/schema/src/promote.ts` replace

```ts
/**
 * The policy a project gets when it opts in without naming one. PR opened →
 * being worked on; merged → shipped; closed → deliberately nothing.
 */
export const DEFAULT_REF_POLICY: RefPolicy = {
  "github-pr": { open: "development", merged: "live", closed: null },
  "gitlab-mr": { open: "development", merged: "live", closed: null },
};
```

with

```ts
/**
 * The policy a project gets when it opts in without naming one. PR opened →
 * being worked on; merged → releasing; closed → deliberately nothing.
 *
 * Merged means `releasing`, not `live` (issue #424): a merge is not a
 * release. Web goes live when the production deploy succeeds; iOS and
 * Android when a store accepts a build, days later. That last hop has its own
 * writer — `POST …/live` behind the `release:append` scope — so the default
 * no longer claims it on merge. A project that wants merge-means-live says so:
 * `{ "github-pr": { "open": "development", "merged": "live", "closed": null } }`.
 */
export const DEFAULT_REF_POLICY: RefPolicy = {
  "github-pr": { open: "development", merged: "releasing", closed: null },
  "gitlab-mr": { open: "development", merged: "releasing", closed: null },
};
```

- [ ] **Step 4: Run the promote suite**

Run: `npm run test:promote`
Expected: all `PASS`, `All promote checks passed.`

- [ ] **Step 5: Pin the planner suites to merge-means-live**

The PR-planner and webhook suites test mention grammar and platform scoping, not what the default says; about thirty of their checks assert a merge lands on `live`, and several rely on `live` being a *delivered* status (`hasParityGap` disappearing). Keep their meaning by giving them the explicit map the default used to be.

In `tests/services/pr-plan.test.js`, replace the `bundle` fixture

```js
function bundle(nodes, policy) {
  return {
    project: {
      id: "gp",
      title: "T",
      ...(policy === undefined ? {} : { metadata: { ref_policy: policy } }),
    },
    nodes,
    edges: [],
  };
}
```

with

```js
/**
 * The mapping the defaults said before #424 moved merged → `releasing`. This
 * suite is about the planner's grammar and platform scoping, and a run of its
 * checks need a merge to land on a DELIVERED status (`hasParityGap` has to
 * disappear). What `ref_policy: true` means is promote.test.js's to assert;
 * here `true` is shorthand for this explicit map.
 */
const MERGE_MEANS_LIVE = { "github-pr": { open: "development", merged: "live", closed: null } };

function bundle(nodes, policy) {
  const declared = policy === true ? MERGE_MEANS_LIVE : policy;
  return {
    project: {
      id: "gp",
      title: "T",
      ...(declared === undefined ? {} : { metadata: { ref_policy: declared } }),
    },
    nodes,
    edges: [],
  };
}
```

In `tests/services/github-webhook.test.js`, add near the top of the file (after the `check` helper):

```js
// The explicit merge-means-live map — see pr-plan.test.js's MERGE_MEANS_LIVE
// for why these suites do not lean on the default (#424).
const MERGE_MEANS_LIVE = { "github-pr": { open: "development", merged: "live", closed: null } };
```

and replace each of the three occurrences of `metadata: { ref_policy: true }` with `metadata: { ref_policy: MERGE_MEANS_LIVE }`.

- [ ] **Step 6: Run both suites**

Run: `npm run test:pr-plan`
Expected: all `PASS`.

Run: `DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test npm run test:github`
Expected: all `PASS`.

- [ ] **Step 7: Update the docs that state the default**

`docs/hosted-projects.md`, §6 table: change the row `| merged | \`live\` |` to `| merged | \`releasing\` |`. Replace the paragraph and example that follow the table

```markdown
To choose your own mapping, give an object instead. `null` means "recognised,
moves nothing":

```json
"ref_policy": { "github-pr": { "open": "development", "merged": "releasing", "closed": null } }
```
```

with

```markdown
A merge is not a release: the default stops at `releasing`, and `live` is what
a deployment says — see [A token for deployments](#a-token-for-deployments-releaseappend).
To choose your own mapping, give an object instead. `null` means "recognised,
moves nothing"; this is the map that makes a merge mean live:

```json
"ref_policy": { "github-pr": { "open": "development", "merged": "live", "closed": null } }
```
```

§7, change

```markdown
- on merge → `live`, on the platform that repository builds for — or, in a
  [monorepo](#monorepos), the platform of the folder the PR touched
```

to

```markdown
- on merge → `releasing`, on the platform that repository builds for — or, in a
  [monorepo](#monorepos), the platform of the folder the PR touched
- on deploy → `live`, when your deploy or release workflow says so through the
  [`release:append` door](#a-token-for-deployments-releaseappend)
```

In "Naming the platform in the mention", rewrite the bullet that begins **naming no platform is the biggest claim** so its example no longer assumes the default lands on `live`:

```markdown
- **naming no platform is the biggest claim, not the smallest** — an unscoped
  mention moves the acceptance's *base* status, which every platform without its
  own entry falls back to. On a three-platform acceptance with nothing pinned
  that moves all three at once. On a *partly* shipped one it is worse, not
  better: under a merge-means-live policy, `{web: "live"}` with a base of
  `backlog` is a real parity gap, and moving the base to `live` makes iOS and
  Android inherit it, so the gap **disappears**. Either way the delivery
  response names the platforms it is about to mark, one line per acceptance.
```

In the "Guards that keep this honest" list, after the **archived** bullet, add:

```markdown
- **`live` is kept, not re-earned** — a follow-up pull request on an acceptance
  that already reads `live` on that platform attaches its ref and moves
  nothing. Users still have the feature; only a human edit moves a status off
  `live`;
```

`docs/spec/bundle-format.md`, in the "Promotion policy" row, change `merged → \`live\`` to `merged → \`releasing\`` and change the sentence `Archived nodes are never promoted; a node already at the target is skipped, making re-runs no-ops.` to `Archived nodes are never promoted, and neither is a scope that already reads \`live\` — live is kept, not re-earned (issue #424); a node already at the target is skipped, making re-runs no-ops.`

(The anchor `#a-token-for-deployments-releaseappend` is created in Part 2, Task 11. A dangling anchor in Part 1 is acceptable for the stack's duration.)

- [ ] **Step 8: Lint, typecheck, commit**

```bash
npm run lint && npx tsc --noEmit -p . && \
git add packages/schema/src/promote.ts tests/schema/promote.test.js tests/services/pr-plan.test.js tests/services/github-webhook.test.js docs/hosted-projects.md docs/spec/bundle-format.md && \
git commit -m "feat(schema): a merge is not a release — the default ref policy stops at releasing (#424)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: `detail` on `node.status_changed`

**Files:**
- Modify: `packages/schema/src/journal.ts` (`NodeStatusChangedEvent`, ~line 90)
- Modify: `packages/schema/src/journal-events.ts` (`NodeStatusChangedEventSchema`, ~line 58)
- Modify: `docs/spec/journal.md` (the vocabulary row, line ~71; the actor examples, line ~52)
- Test: `tests/schema/journal.test.js`
- Regenerate: `npm run generate`

- [ ] **Step 1: Write the failing test**

Open `tests/schema/journal.test.js` and find how it loads the schema and validates an event (it uses `loadSchema()` and the `check()` harness like every other suite; look for an existing `parseJournalEvent` / `JournalEventSchema` call to copy the exact API). Add, at the end of `main()` before the failure summary:

```js
  // --- detail on node.status_changed (#424) --------------------------------
  {
    const { JournalEventSchema } = loadSchema();
    const withDetail = JournalEventSchema.safeParse({
      id: "01J0000000000000000000DETAIL",
      ts: "2026-10-08T00:00:00.000Z",
      actor: "arkaik-ci",
      type: "node.status_changed",
      node_id: "AC-x",
      from: "releasing",
      to: "live",
      platform: "ios",
      detail: "App Store 2.4.1 (build 318)",
    });
    check("a status change may carry its evidence as detail", withDetail.success, JSON.stringify(withDetail.error?.issues));
    const badDetail = JournalEventSchema.safeParse({
      id: "01J0000000000000000000DETAIL",
      ts: "2026-10-08T00:00:00.000Z",
      type: "node.status_changed",
      node_id: "AC-x",
      from: "releasing",
      to: "live",
      detail: 42,
    });
    check("detail must be a string when present", !badDetail.success, JSON.stringify(badDetail.data));
  }
```

If the suite does not already destructure `loadSchema` at the top, keep the inline `loadSchema()` call as written. If `JournalEventSchema` is exported under a different name, use the name `grep -n 'JournalEventSchema' packages/schema/src/index.ts packages/schema/src/journal-events.ts` reports.

- [ ] **Step 2: Run it to see the second check fail**

Run: `npm run test:journal`
Expected: `PASS: a status change may carry its evidence as detail` (catchall accepts it already) and `FAIL: detail must be a string when present`.

- [ ] **Step 3: Make `detail` explicit**

`packages/schema/src/journal.ts`:

```ts
export interface NodeStatusChangedEvent extends JournalEvent {
  type: "node.status_changed";
  node_id: string;
  from: StatusId;
  to: StatusId;
  platform?: PlatformId;
  /**
   * Free-form evidence for the move — the deployment URL, the store build
   * number. Written by the `release:append` door (issue #424), the one writer
   * that always knows it; absent on human and agent edits.
   */
  detail?: string;
}
```

`packages/schema/src/journal-events.ts`, in `NodeStatusChangedEventSchema`, after `platform: PlatformSchema.optional(),` add:

```ts
    detail: z.string().optional(),
```

`docs/spec/journal.md`: change the `node.status_changed` row's field list from `` `node_id`, `from`, `to`, `platform?` `` to `` `node_id`, `from`, `to`, `platform?`, `detail?` `` and append to its description: `` `detail` is free-form evidence for the move — a deployment URL, a store build number — written by the hosted `release:append` door (issue #424) and absent on human and agent edits ``. In the envelope's `actor` comment line, change `"ci"` to `"arkaik-ci"` so the example names the actor the door writes.

- [ ] **Step 4: Run the suite, then regenerate**

Run: `npm run test:journal`
Expected: all `PASS`.

Run: `npm run generate`
Expected: exits 0; `git status` shows `lib/prompts/generated/schema.ts` modified (the `NodeStatusChangedEvent` interface gains `detail?: string;`) and possibly `public/schema/project-bundle.json`, `docs/arkaik-skill/references/schema.md`, `plugin/**`.

- [ ] **Step 5: Lint, typecheck, commit everything generate touched**

```bash
npm run lint && npx tsc --noEmit -p . && \
git add -A packages/schema/src docs/spec/journal.md tests/schema/journal.test.js lib/prompts/generated public/schema docs/arkaik-skill plugin plugin-kritik lib/landing/generated lib/wobble app/wobble.generated.css && \
git commit -m "feat(schema): node.status_changed carries its evidence as detail (#424)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: Part 1 verification and PR

- [ ] **Step 1: Run the whole affected set**

```bash
npm run test:promote && npm run test:journal && npm run test:pr-plan && npm run test:schema && npm run test:mutate && \
DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test npm run test:github && \
npm run lint && npx tsc --noEmit -p . && npm run generate && git diff --exit-code --stat
```

Expected: every suite ends with its `All … passed.` line; `git diff --exit-code` prints nothing (generated artifacts are committed).

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin live-1-schema
gh pr create --base main --head live-1-schema --title "Live is kept: ref promotions stop at releasing and never move a live scope (#424, part 1)" --body-file - <<'PRBODY'
Part 1 of 2 for #424 (part 2 adds the `release:append` door).

- `computeRefPromotions` never moves a scope that already reads `live` (new skip reason `live`). `archived` was terminal; `live` is now too.
- `ref_policy: true` maps merged → `releasing`. A merge is not a release; `live` gets its own writer in part 2. Merge-means-live stays available as an explicit mapping.
- `node.status_changed` gains an optional `detail` for the evidence the door will carry.
- The PR-planner and webhook suites pin an explicit merge-means-live map so their grammar checks keep meaning what they meant.

## Lab Note

```yaml
en:
  title: "Shipped stays shipped"
  summary: "Once an acceptance is live on a platform, a follow-up pull request no longer pulls it back. And a merge now lands on Releasing, not Live — Live is for what actually reached your users."
fr:
  title: "Ce qui est livré reste livré"
  summary: "Une fois qu'un critère est live sur une plateforme, une PR de suivi ne le fait plus reculer. Et une fusion le place désormais en Releasing, pas en Live — Live, c'est pour ce qui est vraiment arrivé chez tes utilisateurs."
suggested:
  molecule: arkaik
  type: improvement
  tags: [lifecycle, github-app]
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
```

- [ ] **Step 3: Read the PR's comments after a minute**

Run: `gh pr view --comments`
Expected: no Lab Note reminder comment (or one that reports no problem). If it names a problem, fix the body with `gh pr edit --body-file`.

---

# Part 2 — `live-2-door`

```bash
git checkout -b live-2-door live-1-schema
```

## Task 5: The `release:append` scope

**Files:**
- Modify: `lib/services/tokens.ts` (`TOKEN_SCOPES` and its doc comment, ~lines 40-55)
- Modify: `components/settings/TokenManager.tsx` (`SCOPE_OPTIONS`, ~line 30)
- Test: `tests/services/token-auth.test.js` (`checkScopeVocabulary`, ~line 95; the round-trip block, ~line 170)

- [ ] **Step 1: Write the failing tests**

In `tests/services/token-auth.test.js`, inside `checkScopeVocabulary()` after the `quality:append` checks, add:

```js
  // #424: the deployment door's credential. Same posture as quality:append —
  // one route, one kind of write, never a default.
  check("release:append is a recognized scope", isTokenScope("release:append"));
  check("release:append is not a default", !DEFAULT_TOKEN_SCOPES.includes("release:append"));
```

In the Postgres section, after the `quality:append-only token round-trips` check, add:

```js
    const releaseOnly = await tokens.mintToken({
      ownerId: ownerA,
      userId: userA,
      name: "deploy-ci",
      scopes: ["release:append"],
    });
    const releaseResolved = await tokens.verifyToken(releaseOnly.plaintext);
    check(
      "a release:append-only token round-trips with exactly that scope",
      releaseResolved && releaseResolved.scopes.join(",") === "release:append",
      releaseResolved && releaseResolved.scopes.join(","),
    );
```

- [ ] **Step 2: Run to see them fail**

Run: `DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test npm run test:tokens`
Expected: `FAIL: release:append is a recognized scope`, and the round-trip check fails with an empty scope string (unknown scopes are dropped at mint).

- [ ] **Step 3: Add the scope**

`lib/services/tokens.ts`: change the constant to

```ts
export const TOKEN_SCOPES = ["graph:read", "graph:write", "synk", "quality:append", "release:append"] as const;
```

and extend the doc comment above it, after the `quality:append` paragraph:

```ts
 *
 * `release:append` is its sibling for the delivery lifecycle (#424): the scope
 * a deploy or release workflow holds to say "this acceptance reached `live`
 * on this platform", through `POST …/live` and nothing else. It cannot read
 * the graph, cannot move a status anywhere but `live`, cannot touch anything
 * but an acceptance, and must name the platform. Not a default, for the same
 * reason as `quality:append`.
```

`components/settings/TokenManager.tsx`: add to `SCOPE_OPTIONS` after the `quality:append` entry:

```ts
  { id: "release:append", label: "Mark acceptances live", hint: "Record that an acceptance reached live on one platform — nothing else: no reads, no other writes" },
```

- [ ] **Step 4: Run to see them pass**

Run: `DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test npm run test:tokens`
Expected: all `PASS`.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npx tsc --noEmit -p . && \
git add lib/services/tokens.ts components/settings/TokenManager.tsx tests/services/token-auth.test.js && \
git commit -m "feat(tokens): a release:append scope for the deployment door (#424)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: The DB-free planner — `lib/services/graph/live.ts`

**Files:**
- Create: `lib/services/graph/live.ts`
- Create: `tests/services/load-live.js`
- Create: `tests/services/live.test.js`
- Modify: `package.json` (add `"test:live"` beside `"test:quality-events"`)
- Modify: `.github/workflows/ci.yml` (a step after `Kritik hosted-events tests`)
- Modify: `.gitignore` (add `/tests/services/.test-build-live/`)

- [ ] **Step 1: Write the loader**

`tests/services/load-live.js`:

```js
/**
 * Loads lib/services/graph/live.ts into a plain Node process — the
 * tests/services/load-quality-events.js idiom.
 *
 * The planner has NO db/auth imports and no `server-only`: its only runtime
 * dependency is `@arkaik/schema`, so one rewrite is all it takes.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-live");

function loadLive() {
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");
  const source = fs.readFileSync(path.join(ROOT, "lib", "services", "graph", "live.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "live.ts",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const rewritten = outputText.replace(
    /require\((['"])@arkaik\/schema\1\)/g,
    `require(${JSON.stringify(schemaIndex)})`,
  );
  const outFile = path.join(BUILD_DIR, "live.js");
  fs.writeFileSync(outFile, rewritten);
  delete require.cache[outFile];
  return require(outFile);
}

module.exports = { loadLive, BUILD_DIR };
```

- [ ] **Step 2: Write the failing test suite**

`tests/services/live.test.js`:

```js
#!/usr/bin/env node

/**
 * The pure core behind `POST /api/graph/projects/{id}/live` (issue #424):
 * lib/services/graph/live.ts. DB-free by construction — `parseLiveEntries`
 * is shape validation with no I/O, and `planLive` takes the project's nodes
 * as a plain argument rather than reading them, the same seam
 * quality-events.ts uses. This is why it runs in CI's fast build job.
 *
 * Assertions are by identity (`find`, `every`), never by count — a count
 * passes when the code under test does nothing.
 */

const fs = require("fs");
const { loadLive, BUILD_DIR } = require("./load-live");

const { parseLiveEntries, planLive } = loadLive();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

function acceptance(id, extra = {}) {
  return {
    id,
    project_id: "p",
    species: "acceptance",
    title: id,
    status: "releasing",
    platforms: ["web", "ios"],
    ...extra,
  };
}

const isError = (r) => !Array.isArray(r) && typeof r.error === "string";

// --- parseLiveEntries ----------------------------------------------------------

{
  const ok = parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios", detail: "App Store 2.4.1 (318)" }] });
  check("a full entry parses", Array.isArray(ok) && ok[0].node_id === "AC-x" && ok[0].platform === "ios" && ok[0].detail === "App Store 2.4.1 (318)", JSON.stringify(ok));
}
{
  const ok = parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "web" }] });
  check("detail is optional", Array.isArray(ok) && ok[0].detail === undefined, JSON.stringify(ok));
}
check("a non-object body is an error", isError(parseLiveEntries(null)) && isError(parseLiveEntries([])));
check("a missing entries array is an error", isError(parseLiveEntries({})));
check("an empty entries array is an error", isError(parseLiveEntries({ entries: [] })));
{
  const many = Array.from({ length: 51 }, (_, i) => ({ node_id: `AC-${i}`, platform: "web" }));
  check("more than 50 entries is an error", isError(parseLiveEntries({ entries: many })));
}
check("an entry that is not an object is an error", isError(parseLiveEntries({ entries: ["AC-x"] })));
check("node_id is required", isError(parseLiveEntries({ entries: [{ platform: "ios" }] })));
check("node_id must be non-empty", isError(parseLiveEntries({ entries: [{ node_id: "", platform: "ios" }] })));
{
  const r = parseLiveEntries({ entries: [{ node_id: "AC-x" }] });
  check("platform is REQUIRED — an unscoped live is the biggest claim in the system", isError(r) && /platform/.test(r.error), JSON.stringify(r));
}
{
  const r = parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "windows" }] });
  check("an unknown platform is an error naming the valid ones", isError(r) && /web, ios, android/.test(r.error), JSON.stringify(r));
}
check("detail must be non-empty when present", isError(parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios", detail: "" }] })));
check("detail must be a string", isError(parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios", detail: 7 }] })));
check("detail is capped at 2000 characters", isError(parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios", detail: "x".repeat(2001) }] })));
check("2000 characters of detail is fine", Array.isArray(parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios", detail: "x".repeat(2000) }] })));
{
  const r = parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios" }, { node_id: "AC-x", platform: "ios" }] });
  check("the same (node, platform) twice in one batch is an error", isError(r) && /entries\[1\]/.test(r.error), JSON.stringify(r));
}
check(
  "the same node on two platforms is fine",
  Array.isArray(parseLiveEntries({ entries: [{ node_id: "AC-x", platform: "ios" }, { node_id: "AC-x", platform: "web" }] })),
);

// --- planLive: refusals --------------------------------------------------------

{
  const plan = planLive([acceptance("AC-x")], [{ node_id: "AC-nope", platform: "ios" }]);
  check("an unknown node is refused", !plan.ok && plan.refusals.find((r) => r.index === 0 && r.node_id === "AC-nope" && r.reason === "unknown_node") !== undefined, JSON.stringify(plan));
}
{
  const view = { id: "V-a", project_id: "p", species: "view", title: "A", status: "releasing", platforms: ["web"] };
  const plan = planLive([view], [{ node_id: "V-a", platform: "web" }]);
  check("only acceptances go live", !plan.ok && plan.refusals[0]?.reason === "not_acceptance", JSON.stringify(plan));
}
{
  const plan = planLive([acceptance("AC-x", { status: "archived" })], [{ node_id: "AC-x", platform: "ios" }]);
  check("an archived acceptance is never resurrected by a deploy", !plan.ok && plan.refusals[0]?.reason === "archived", JSON.stringify(plan));
}
{
  const plan = planLive([acceptance("AC-x")], [{ node_id: "AC-x", platform: "android" }]);
  check(
    "a platform the acceptance does not list is refused, never guessed",
    !plan.ok && plan.refusals[0]?.reason === "platform_not_applicable" && /web, ios/.test(plan.refusals[0]?.detail ?? ""),
    JSON.stringify(plan),
  );
}
{
  // All-or-nothing: one bad entry refuses the batch, and the good one is not applied.
  const plan = planLive([acceptance("AC-x")], [{ node_id: "AC-x", platform: "ios" }, { node_id: "AC-x", platform: "android" }]);
  check("one refused entry refuses the whole batch", !plan.ok && plan.refusals.every((r) => r.index === 1), JSON.stringify(plan));
}

// --- planLive: the write -------------------------------------------------------

{
  const node = acceptance("AC-x");
  const plan = planLive([node], [{ node_id: "AC-x", platform: "ios", detail: "App Store 2.4.1 (318)" }]);
  check("a valid entry plans", plan.ok, JSON.stringify(plan));
  const op = plan.ok && plan.ops.find((o) => o.op === "update_node" && o.node_id === "AC-x");
  check("as one update_node op", op !== undefined && op !== false, JSON.stringify(plan));
  check("that patches only platformStatuses", op && op.patch.status === undefined && op.patch.metadata.platformStatuses.ios === "live", JSON.stringify(op));
  check("and leaves the other platform alone", op && op.patch.metadata.platformStatuses.web === undefined, JSON.stringify(op));
  check(
    "applied records where it came from",
    plan.ok && plan.applied.find((a) => a.node_id === "AC-x" && a.platform === "ios" && a.from === "releasing" && a.to === "live") !== undefined,
    JSON.stringify(plan),
  );
  check(
    "the detail becomes an annotation for the store to stamp on the event",
    plan.ok && plan.annotations.find((a) => a.node_id === "AC-x" && a.platform === "ios" && a.detail === "App Store 2.4.1 (318)") !== undefined,
    JSON.stringify(plan),
  );
  check("nothing was skipped", plan.ok && plan.skipped[0] === undefined, JSON.stringify(plan));
}
{
  const node = acceptance("AC-x", { metadata: { note: "keep me", platformStatuses: { web: "development" } } });
  const plan = planLive([node], [{ node_id: "AC-x", platform: "ios" }]);
  const op = plan.ok && plan.ops.find((o) => o.node_id === "AC-x");
  check("existing metadata survives the patch (applyOps replaces metadata wholesale)", op && op.patch.metadata.note === "keep me", JSON.stringify(op));
  check("and so does the other platform's entry", op && op.patch.metadata.platformStatuses.web === "development", JSON.stringify(op));
  check("from is the platform's resolved status, falling back to the base", plan.ok && plan.applied[0].from === "releasing", JSON.stringify(plan));
}
{
  // Two platforms, one node → ONE op, each step reading the node as the
  // previous left it. Two ops from the same pre-write node would erase each other.
  const plan = planLive([acceptance("AC-x")], [{ node_id: "AC-x", platform: "ios" }, { node_id: "AC-x", platform: "web" }]);
  const ops = plan.ok ? plan.ops.filter((o) => o.node_id === "AC-x") : [];
  check("two platforms fold into one op", ops[0] !== undefined && ops[1] === undefined, JSON.stringify(plan));
  check("carrying both entries", ops[0] && ops[0].patch.metadata.platformStatuses.ios === "live" && ops[0].patch.metadata.platformStatuses.web === "live", JSON.stringify(ops));
}
{
  const node = acceptance("AC-x", { metadata: { platformStatuses: { ios: "live" } } });
  const plan = planLive([node], [{ node_id: "AC-x", platform: "ios", detail: "re-run" }]);
  check("already live is a skip, not a refusal — a re-run deploy job gets a 200", plan.ok, JSON.stringify(plan));
  check("reported as already_live with its index", plan.ok && plan.skipped.find((s) => s.index === 0 && s.node_id === "AC-x" && s.platform === "ios" && s.reason === "already_live") !== undefined, JSON.stringify(plan));
  check("and plans no op", plan.ok && plan.ops[0] === undefined, JSON.stringify(plan));
  check("and no annotation", plan.ok && plan.annotations[0] === undefined, JSON.stringify(plan));
}
{
  const node = acceptance("AC-x", { status: "live" });
  const plan = planLive([node], [{ node_id: "AC-x", platform: "ios" }]);
  check("a platform inheriting a live base is already live too", plan.ok && plan.skipped[0]?.reason === "already_live", JSON.stringify(plan));
}
{
  const live = acceptance("AC-l", { metadata: { platformStatuses: { ios: "live" } } });
  const fresh = acceptance("AC-f");
  const plan = planLive([live, fresh], [{ node_id: "AC-l", platform: "ios" }, { node_id: "AC-f", platform: "ios" }]);
  check("a skip beside an applied entry: the applied one still lands", plan.ok && plan.applied.find((a) => a.node_id === "AC-f") !== undefined && plan.skipped.find((s) => s.node_id === "AC-l") !== undefined, JSON.stringify(plan));
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll live checks passed.");
```

- [ ] **Step 3: Wire the script, run it, see it fail to load**

`package.json`, after `"test:quality-events": …`, add:

```json
    "test:live": "node tests/services/live.test.js",
```

Run: `npm run test:live`
Expected: a thrown error (`ENOENT … lib/services/graph/live.ts`). Exit code 1.

- [ ] **Step 4: Write the planner**

`lib/services/graph/live.ts`:

```ts
import { PLATFORM_IDS, resolvePlatformStatus, type MutationOp, type Node, type PlatformId, type StatusId } from "@arkaik/schema";

/**
 * The pure core behind `POST /api/graph/projects/{id}/live` (issue #424) —
 * the one write a deployment is allowed to make: *this acceptance reached
 * `live` on this platform*.
 *
 * Shape validation plus the same all-or-nothing refusal posture
 * `persistMutation` and `planQualityEvents` use, with the project's nodes
 * taken as a plain argument rather than read here. That is what keeps this
 * module DB-free (no db/auth imports, no `server-only`) and importable by the
 * DB-free test loader (tests/services/load-live.js); the route in
 * `app/api/graph/projects/[projectId]/live/route.ts` is the only caller that
 * supplies real data.
 *
 * **What this door cannot do is the design.** It moves exactly one status,
 * `live`; only on `species: acceptance`; only on a platform the acceptance
 * lists; and never the base status — an unscoped `live` would mark every
 * platform without an entry of its own as delivered, the strongest claim in
 * the system and the last one a CI job should make by omission. So
 * `platform` is required, and a platform the acceptance does not list is
 * refused and reported, never guessed at (the webhook's posture,
 * lib/services/github/pull-request.ts).
 *
 * **Already live is a skip, not a refusal.** A deploy job re-runs; the
 * second run must get a 200 and write nothing. Everything else that is wrong
 * refuses the whole batch, so a caller never reasons about a partial write.
 *
 * The write itself is an ordinary `update_node` op through `applyMutation`,
 * so the row lock, the validators, the entity limits and the version bump all
 * apply unchanged, and the journal gets an ordinary `node.status_changed`
 * carrying `platform` — plus the `detail` this planner hands back as an
 * annotation for the store to stamp on that event.
 */

/** One caller-supplied entry, after the shape check. */
export interface LiveEntry {
  node_id: string;
  platform: PlatformId;
  /** Free-form evidence: the deployment URL, the store build number. */
  detail?: string;
}

export type LiveRefusalReason = "unknown_node" | "not_acceptance" | "archived" | "platform_not_applicable";

/** Why one entry refused the batch. `index` is its position in `entries`. */
export interface LiveRefusal {
  index: number;
  node_id: string;
  platform: PlatformId;
  reason: LiveRefusalReason;
  detail?: string;
}

/** An entry that wrote nothing because there was nothing to write. */
export interface LiveSkip {
  index: number;
  node_id: string;
  platform: PlatformId;
  reason: "already_live";
}

export interface LiveApplied {
  node_id: string;
  platform: PlatformId;
  from: StatusId;
  to: "live";
}

/** What the store stamps onto the matching derived `node.status_changed`. */
export interface LiveAnnotation {
  node_id: string;
  platform: PlatformId;
  detail: string;
}

export type LivePlan =
  | { ok: true; ops: MutationOp[]; applied: LiveApplied[]; skipped: LiveSkip[]; annotations: LiveAnnotation[] }
  | { ok: false; refusals: LiveRefusal[] };

const MAX_ENTRIES = 50;
const MAX_DETAIL_LENGTH = 2000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isPlatformId(value: unknown): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value as string);
}

/**
 * Shape-validate a request body into a batch of {@link LiveEntry}. Purely
 * structural: it never looks at a node, so it cannot refuse `unknown_node` —
 * that is {@link planLive}'s job. 1–50 entries; `node_id` a non-empty string;
 * `platform` required and one of `PLATFORM_IDS`; `detail` a non-empty string
 * of at most 2000 characters when present; no (node_id, platform) pair twice.
 */
export function parseLiveEntries(body: unknown): LiveEntry[] | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "body must be an object with an entries array" };
  }
  const { entries } = body as { entries?: unknown };
  if (!Array.isArray(entries)) return { error: "entries must be an array" };
  if (entries.length === 0) return { error: "entries must contain at least one entry" };
  if (entries.length > MAX_ENTRIES) return { error: `entries must contain at most ${MAX_ENTRIES} entries` };

  const parsed: LiveEntry[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of entries.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { error: `entries[${index}] must be an object` };
    }
    const entry = raw as Record<string, unknown>;
    if (!isNonEmptyString(entry.node_id)) {
      return { error: `entries[${index}].node_id must be a non-empty string` };
    }
    if (!isPlatformId(entry.platform)) {
      return {
        error: `entries[${index}].platform is required and must be one of: ${PLATFORM_IDS.join(", ")}`,
      };
    }
    if (entry.detail !== undefined) {
      if (!isNonEmptyString(entry.detail)) {
        return { error: `entries[${index}].detail must be a non-empty string when present` };
      }
      if (entry.detail.length > MAX_DETAIL_LENGTH) {
        return { error: `entries[${index}].detail must be at most ${MAX_DETAIL_LENGTH} characters` };
      }
    }
    const key = `${entry.node_id}@${entry.platform}`;
    if (seen.has(key)) {
      return { error: `entries[${index}] repeats ${key}; each (node_id, platform) pair may appear once` };
    }
    seen.add(key);
    parsed.push({
      node_id: entry.node_id,
      platform: entry.platform,
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    });
  }
  return parsed;
}

/**
 * Decide the batch against the project's nodes. Refusals are per entry and
 * all-or-nothing; `already_live` is reported under `skipped` and writes
 * nothing. Every surviving entry folds into ONE `update_node` op per node,
 * each step reading the node as the previous one left it — `applyOps`
 * replaces `metadata` wholesale, so two ops built from the same pre-write
 * node would silently erase each other's platform entry.
 */
export function planLive(nodes: readonly Node[], entries: readonly LiveEntry[]): LivePlan {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const refusals: LiveRefusal[] = [];
  const skipped: LiveSkip[] = [];
  const applied: LiveApplied[] = [];
  const annotations: LiveAnnotation[] = [];
  const additions = new Map<string, Partial<Record<PlatformId, StatusId>>>();

  entries.forEach((entry, index) => {
    const { node_id, platform } = entry;
    const node = byId.get(node_id);
    if (!node) {
      refusals.push({ index, node_id, platform, reason: "unknown_node" });
      return;
    }
    if (node.species !== "acceptance") {
      refusals.push({
        index,
        node_id,
        platform,
        reason: "not_acceptance",
        detail: `${node_id} is a ${node.species}; only acceptances go live`,
      });
      return;
    }
    if (node.status === "archived") {
      refusals.push({ index, node_id, platform, reason: "archived" });
      return;
    }
    if (!node.platforms.includes(platform)) {
      refusals.push({
        index,
        node_id,
        platform,
        reason: "platform_not_applicable",
        detail: `${node_id} lists: ${node.platforms.join(", ")}`,
      });
      return;
    }
    // Defined: `includes` just passed. The fallback is only for the type.
    const from = resolvePlatformStatus(node, platform) ?? node.status;
    if (from === "live") {
      skipped.push({ index, node_id, platform, reason: "already_live" });
      return;
    }
    applied.push({ node_id, platform, from, to: "live" });
    additions.set(node_id, { ...additions.get(node_id), [platform]: "live" });
    if (entry.detail !== undefined) annotations.push({ node_id, platform, detail: entry.detail });
  });

  if (refusals.length > 0) return { ok: false, refusals };

  const ops: MutationOp[] = [];
  for (const [nodeId, platformStatuses] of additions) {
    const node = byId.get(nodeId);
    if (!node) continue;
    ops.push({
      op: "update_node",
      node_id: nodeId,
      patch: {
        metadata: {
          ...node.metadata,
          platformStatuses: { ...node.metadata?.platformStatuses, ...platformStatuses },
        },
      },
    });
  }
  return { ok: true, ops, applied, skipped, annotations };
}
```

If `tsc` complains that `MutationOp`'s `update_node` member names its patch field differently, check `packages/schema/src/mutate.ts` (~line 40, the `MutationOp` union) and match it exactly; the webhook pushes `{ op: "update_node", node_id, patch }` at `lib/services/github/pull-request.ts:1956`, so `patch` is expected to be right.

- [ ] **Step 5: Run the suite**

Run: `npm run test:live`
Expected: all `PASS`, `All live checks passed.`

- [ ] **Step 6: Wire CI and gitignore**

`.github/workflows/ci.yml`, after the `Kritik hosted-events tests` step (~line 174), add:

```yaml
      # The deployment door's planner (issue #424): the pure core behind
      # POST .../live. DB-free the same way — the nodes are injected, not read.
      - name: Live door planner tests (platform required, all-or-nothing, already_live skip)
        run: npm run test:live
```

`.gitignore`, after `/tests/services/.test-build-graph/`, add:

```
/tests/services/.test-build-live/
```

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npm run lint && npx tsc --noEmit -p . && \
git add lib/services/graph/live.ts tests/services/load-live.js tests/services/live.test.js package.json .github/workflows/ci.yml .gitignore && \
git commit -m "feat(graph): the live door's planner — platform required, acceptances only, already_live is a skip (#424)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: `applyMutation` stamps annotations onto derived status events

**Files:**
- Modify: `lib/services/graph/store.ts` (`ApplyMutationInput` ~line 918; the `toJournalEvents` call ~line 991; the schema import block ~lines 7-32)
- Test: covered end-to-end by Task 8's route tests (the store has no DB-free seam; the webhook is tested the same way)

- [ ] **Step 1: Add the input and the stamping**

In the `@arkaik/schema` import block at the top of `lib/services/graph/store.ts`, add `type EventInput` to the imported names (alphabetical, beside the other `type` imports).

Change `ApplyMutationInput`:

```ts
/** Evidence for a platform-scoped status change — see {@link ApplyMutationInput.annotations}. */
export interface StatusAnnotation {
  node_id: string;
  platform: string;
  detail: string;
}

export interface ApplyMutationInput {
  projectId: string;
  ownerIds: readonly string[];
  ops: readonly MutationOp[];
  actor: string;
  tier: string;
  /** When given, the mutation is refused unless the stored version matches. */
  expectedVersion?: string;
  /**
   * `detail` to stamp onto the derived `node.status_changed` events matching
   * each (node_id, platform) — the live door's evidence (issue #424). Events
   * are derived from the diff, never supplied by the caller, so this is the
   * one way a writer that knows WHY a status moved can say so without being
   * allowed to write the event itself. An annotation matching no derived
   * event is dropped: it can only mean the plan and the diff disagreed, and
   * the diff is the truth. No other caller passes this.
   */
  annotations?: readonly StatusAnnotation[];
}
```

Add a helper beside `toMutationFailure` (the `// Helpers` section):

```ts
/** Stamp each annotation's `detail` onto the derived status event it names. */
function annotateStatusChanges(
  inputs: readonly EventInput[],
  annotations: readonly StatusAnnotation[],
): EventInput[] {
  if (annotations.length === 0) return [...inputs];
  return inputs.map((input) => {
    if (input.type !== "node.status_changed") return input;
    const match = annotations.find(
      (a) => a.node_id === input.payload.node_id && a.platform === input.payload.platform,
    );
    return match ? { ...input, payload: { ...input.payload, detail: match.detail } } : input;
  });
}
```

Change the line

```ts
    const events = toJournalEvents(outcome.eventInputs, input.actor);
```

to

```ts
    const events = toJournalEvents(
      annotateStatusChanges(outcome.eventInputs, input.annotations ?? []),
      input.actor,
    );
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit -p . && npm run lint`
Expected: clean. If `EventInput` is not exported from the schema index, check `packages/schema/src/index.ts` line 16 (`export * from "./derive"`) — it is.

- [ ] **Step 3: Commit**

```bash
git add lib/services/graph/store.ts && \
git commit -m "feat(store): applyMutation can stamp evidence onto a derived status change (#424)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 8: The route — `POST /api/graph/projects/{id}/live`

**Files:**
- Create: `app/api/graph/projects/[projectId]/live/route.ts`
- Modify: `tests/services/load-graph-api.js` (COMMON table, a `live.js` write, the `routes` map, the return object)
- Test: `tests/services/graph-api.test.js` (a new section before `setSession(sessionFor(userA));` that precedes `// --- Archive`)

- [ ] **Step 1: Teach the loader about the new module and route**

In `tests/services/load-graph-api.js`:

Add to `COMMON` after the `quality-events` line:

```js
    ["@/lib/services/graph/live", "./live.js"],
```

After the `quality-events.js` write, add:

```js
  // The live door's planner (issue #424) — pure, over @arkaik/schema.
  write("live.js", transpile(src("lib", "services", "graph", "live.ts"), "live.ts", COMMON));
```

Add to `routes`:

```js
    "live-route.js": src("app", "api", "graph", "projects", "[projectId]", "live", "route.ts"),
```

Add to the returned object after `QUALITY_EVENTS`:

```js
    LIVE: req("live-route.js").POST,
```

- [ ] **Step 2: Write the failing route tests**

In `tests/services/graph-api.test.js`, immediately before the line `setSession(sessionFor(userA));` that precedes `// --- Archive ---`, insert:

```js
    // --- POST .../live: the deployment door (issue #424) --------------------
    // A fresh owner, as for quality/events above: userA sits at its project cap.
    const userL = await seedUser(client, "live");
    const ownerL = (await owners.resolveOwnerIds(userL))[0];
    const liveToken = await tokens.mintToken({ ownerId: ownerL, userId: userL, name: "deploy-ci", scopes: ["release:append"] });
    const readOnlyL = await tokens.mintToken({ ownerId: ownerL, userId: userL, name: "reader", scopes: ["graph:read"] });

    setSession(sessionFor(userL));
    const liveSeed = bundle([
      node("AC-x", "acceptance", { status: "releasing", platforms: ["web", "ios"] }),
      node("V-a", "view", { status: "releasing" }),
    ]);
    const liveCreated = await api.CREATE_PROJECT(jsonReq(`${ORIGIN}/api/graph/projects`, "POST", liveSeed));
    const liveCreatedBody = await liveCreated.json();
    check("live fixture project imports", liveCreated.status === 201, `${liveCreated.status} ${JSON.stringify(liveCreatedBody)}`);
    const liveProjectId = liveCreatedBody.id;
    setSession(null);

    const livePost = (entries, token) =>
      api.LIVE(
        jsonReq(`${ORIGIN}/api/graph/projects/${liveProjectId}/live`, "POST", { entries }, token ? bearer(token) : {}),
        ctx(liveProjectId),
      );

    // 1. The scope posture: release:append opens this door and nothing else.
    check("live without credentials is 401", (await livePost([{ node_id: "AC-x", platform: "ios" }])).status === 401);
    {
      const res = await livePost([{ node_id: "AC-x", platform: "ios" }], readOnlyL.plaintext);
      const body = await res.json();
      check("a graph:read token is refused 403 naming graph:write", res.status === 403 && body.required === "graph:write", `${res.status} ${JSON.stringify(body)}`);
    }
    check(
      "a release:append-only token cannot read the project",
      (await api.GET_PROJECT(new Request(ORIGIN, { headers: bearer(liveToken.plaintext) }), ctx(liveProjectId))).status === 403,
    );
    check(
      "a release:append-only token cannot use the mutations route",
      (await api.MUTATE(
        jsonReq(`${ORIGIN}/api/graph/projects/${liveProjectId}/mutations`, "POST", { ops: [{ op: "update_node", node_id: "AC-x", patch: { status: "live" } }] }, bearer(liveToken.plaintext)),
        ctx(liveProjectId),
      )).status === 403,
    );
    check(
      "a release:append-only token cannot post quality events",
      (await api.QUALITY_EVENTS(
        jsonReq(`${ORIGIN}/api/graph/projects/${liveProjectId}/quality/events`, "POST", { events: [{ type: "quality.signal.tripped", criterion_id: "SEC-01", surface: "web", signal: "s", commit: "c" }] }, bearer(liveToken.plaintext)),
        ctx(liveProjectId),
      )).status === 403,
    );

    // 2. Shape: platform is required; an unknown one is a 400, not a guess.
    {
      const res = await livePost([{ node_id: "AC-x" }], liveToken.plaintext);
      const body = await res.json();
      check("an entry without a platform is 400", res.status === 400 && /platform/.test(body.message ?? ""), `${res.status} ${JSON.stringify(body)}`);
    }

    // 3. The write.
    {
      const res = await livePost([{ node_id: "AC-x", platform: "ios", detail: "App Store 2.4.1 (build 318)" }], liveToken.plaintext);
      const body = await res.json();
      check("a release:append token marks a platform live", res.status === 200, `${res.status} ${JSON.stringify(body)}`);
      check(
        "applied names the move",
        body.applied?.find((a) => a.node_id === "AC-x" && a.platform === "ios" && a.from === "releasing" && a.to === "live") !== undefined,
        JSON.stringify(body.applied),
      );
      const ev = body.events?.find((e) => e.type === "node.status_changed" && e.node_id === "AC-x");
      check("the event is an ordinary node.status_changed scoped to the platform", ev?.platform === "ios" && ev?.from === "releasing" && ev?.to === "live", JSON.stringify(body.events));
      check("carrying the evidence as detail", ev?.detail === "App Store 2.4.1 (build 318)", JSON.stringify(ev));
      check("written by arkaik-ci, so the journal says what acted", ev?.actor === "arkaik-ci", JSON.stringify(ev));
      check("the version bumped", body.version === "2", body.version);

      setSession(sessionFor(userL));
      const after = await (await api.GET_PROJECT(new Request(ORIGIN), ctx(liveProjectId))).json();
      const acx = after.bundle?.nodes?.find((n) => n.id === "AC-x") ?? after.nodes?.find((n) => n.id === "AC-x");
      check("the snapshot carries ios live and web untouched", acx?.metadata?.platformStatuses?.ios === "live" && acx?.metadata?.platformStatuses?.web === undefined, JSON.stringify(acx?.metadata));
      check("and the base status is never moved by this door", acx?.status === "releasing", JSON.stringify(acx?.status));
      const journal = await (await api.GET_JOURNAL(new Request(ORIGIN), ctx(liveProjectId))).json();
      const stored = (journal.events ?? journal).find?.((e) => e.type === "node.status_changed" && e.node_id === "AC-x" && e.platform === "ios");
      check("the stored event carries the detail", stored?.detail === "App Store 2.4.1 (build 318)", JSON.stringify(stored));
      setSession(null);
    }

    // 4. Idempotence: a re-run deploy job gets a 200 and writes nothing.
    {
      const res = await livePost([{ node_id: "AC-x", platform: "ios", detail: "re-run" }], liveToken.plaintext);
      const body = await res.json();
      check("a re-run is a 200", res.status === 200, `${res.status} ${JSON.stringify(body)}`);
      check("with the entry skipped as already_live", body.skipped?.find((s) => s.index === 0 && s.reason === "already_live") !== undefined && body.applied?.[0] === undefined, JSON.stringify(body));
      check("and the version unchanged", body.version === "2", body.version);
    }

    // 5. Refusals write nothing.
    {
      const res = await livePost([{ node_id: "AC-x", platform: "web" }, { node_id: "AC-x", platform: "android" }], liveToken.plaintext);
      const body = await res.json();
      check("a platform the acceptance does not list is refused 422", res.status === 422 && body.refusals?.find((r) => r.index === 1 && r.reason === "platform_not_applicable") !== undefined, `${res.status} ${JSON.stringify(body)}`);
      const notAcceptance = await livePost([{ node_id: "V-a", platform: "web" }], liveToken.plaintext);
      check("a view is refused as not_acceptance", notAcceptance.status === 422 && (await notAcceptance.json()).refusals?.[0]?.reason === "not_acceptance");
      const unknown = await livePost([{ node_id: "AC-nope", platform: "web" }], liveToken.plaintext);
      check("an unknown node is refused as unknown_node", unknown.status === 422 && (await unknown.json()).refusals?.[0]?.reason === "unknown_node");
      setSession(sessionFor(userL));
      const after = await (await api.GET_PROJECT(new Request(ORIGIN), ctx(liveProjectId))).json();
      check("the refused batch wrote nothing — web is still not live and the version is still 2", after.version === "2", after.version);
      setSession(null);
    }

    // 6. A session caller writes as arkaik-app; another owner's project is 404.
    {
      setSession(sessionFor(userL));
      const res = await api.LIVE(jsonReq(`${ORIGIN}/api/graph/projects/${liveProjectId}/live`, "POST", { entries: [{ node_id: "AC-x", platform: "web" }] }), ctx(liveProjectId));
      const body = await res.json();
      check("a signed-in human can use the door too", res.status === 200, `${res.status} ${JSON.stringify(body)}`);
      check("and writes as arkaik-app", body.events?.[0]?.actor === "arkaik-app", JSON.stringify(body.events));
      setSession(null);
      check(
        "another owner's project is 404, never 403",
        (await livePost([{ node_id: "AC-x", platform: "web" }], qualityAppendToken.plaintext)).status === 404,
      );
    }
```

Note on `GET_PROJECT`'s body shape: look at how an earlier check in this file reads nodes off the project GET (search for `.bundle.nodes` or `.nodes.find` near the first `GET_PROJECT` call) and use that exact path instead of the `??` fallback written above. Same for `GET_JOURNAL`'s body (`journal.events` vs a bare array): copy what the existing journal checks do.

- [ ] **Step 3: Run the suite to see it fail at load**

Run: `DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test npm run test:graph`
Expected: a thrown error from the loader (`ENOENT … live/route.ts`). Exit code 1.

- [ ] **Step 4: Write the route**

`app/api/graph/projects/[projectId]/live/route.ts`:

```ts
import { getCaller, hasScope } from "@/lib/services/auth";
import { MAX_BUNDLE_BYTES, servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { parseLiveEntries, planLive } from "@/lib/services/graph/live";
import { applyMutation, getProject, getUserTier } from "@/lib/services/graph/store";
import type { Node } from "@arkaik/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST` — the deployment door (issue #424): *this acceptance reached `live`
 * on this platform*, and nothing else.
 *
 * This is the last hop of the delivery lifecycle, the one no repository event
 * marks: web goes live when the production deploy succeeds, iOS and Android
 * when a store accepts a build, days after the merge. The signals all live in
 * CI, and CI is where a broad credential must not go — so this route is what
 * `release:append` opens, the way `quality:append` opens `…/quality/events`:
 * a token that can read nothing, move a status nowhere but `live`, touch
 * nothing but an acceptance, and must name the platform. A caller holding
 * neither `graph:write` nor `release:append` gets a 403 naming the broad
 * scope, as on the quality route.
 *
 * The decision is `planLive` (lib/services/graph/live.ts, DB-free); the write
 * is `applyMutation`, so the row lock, the validators, the entity limits and
 * the version bump all apply unchanged and the journal gets an ordinary
 * `node.status_changed` carrying `platform`, the entry's `detail` (stamped by
 * the store from the plan's annotations) and an actor the journal can tell
 * apart: `arkaik-ci` for a token, `arkaik-app` for a session.
 *
 * **The plan is computed from a read outside the lock.** The patch replaces
 * `metadata` wholesale, so a concurrent edit between our read and our write
 * would be clobbered. `applyMutation` is therefore called with the version we
 * read as `expectedVersion`, and a conflict re-reads and re-plans, up to
 * three times — the plan is idempotent (`already_live`), so a retry can only
 * ever converge. The webhook and the mutations route accept the same hazard
 * without the retry; this route's callers are unattended jobs, which is why
 * it does not.
 */
const MAX_ATTEMPTS = 3;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Graph");

  const caller = await getCaller(req);
  if (!caller) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasScope(caller, "graph:write") && !hasScope(caller, "release:append")) {
    return Response.json({ error: "insufficient_scope", required: "graph:write" }, { status: 403 });
  }

  const { projectId } = await params;

  // Size before parse, against the shared cap, as on every other write route.
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BUNDLE_BYTES) {
    return Response.json({ error: "payload_too_large", limit: MAX_BUNDLE_BYTES }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const entries = parseLiveEntries(body);
  if (!Array.isArray(entries)) {
    return Response.json({ error: "invalid_entries", message: entries.error }, { status: 400 });
  }

  const actor = caller.via === "token" ? "arkaik-ci" : "arkaik-app";

  try {
    const tier = await getUserTier(caller.userId);
    for (let attempt = 1; ; attempt++) {
      const found = await getProject(projectId, caller.ownerIds);
      if (!found) return Response.json({ error: "not_found" }, { status: 404 });

      const plan = planLive(found.bundle.nodes as Node[], entries);
      if (!plan.ok) {
        return Response.json({ error: "refused", refusals: plan.refusals }, { status: 422 });
      }
      if (plan.ops.length === 0) {
        // Every entry was already live: a re-run. Nothing to write, 200.
        return Response.json(
          { version: found.version, applied: [], skipped: plan.skipped, events: [] },
          { status: 200, headers: { ETag: `"${found.version}"` } },
        );
      }

      const result = await applyMutation({
        projectId,
        ownerIds: caller.ownerIds,
        ops: plan.ops,
        actor,
        tier,
        expectedVersion: found.version,
        annotations: plan.annotations,
      });

      if (result.ok) {
        return Response.json(
          { version: result.version, applied: plan.applied, skipped: plan.skipped, events: result.events },
          { status: 200, headers: { ETag: `"${result.version}"` } },
        );
      }
      switch (result.reason) {
        case "conflict":
          if (attempt < MAX_ATTEMPTS) continue;
          return Response.json(
            { error: "version_conflict", version: result.version },
            { status: 409, headers: { ETag: `"${result.version}"` } },
          );
        case "not_found":
          return Response.json({ error: "not_found" }, { status: 404 });
        case "validation":
          return Response.json({ error: "invalid_bundle", errors: result.errors }, { status: 422 });
        case "mutation":
          return Response.json({ error: "mutation_refused", code: result.code, message: result.message }, { status: 422 });
        case "limit":
          return Response.json(
            { error: "limit_exceeded", limit: result.limit, actual: result.actual, tier: result.tier },
            { status: 403 },
          );
      }
    }
  } catch (err) {
    console.error("[graph] POST live failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to mark live." }, { status: 500 });
  }
}
```

If `found.bundle.nodes` is already typed `Node[]` (check `SnapshotShape` in store.ts), drop the cast and the `Node` import.

- [ ] **Step 5: Run the loader without a database, then the suite**

Run: `node -e "require('./tests/services/load-graph-api.js').loadGraphApi()"`
Expected: no output, exit 0 (a missing rewrite shows up here as a `Cannot find module '@/…'` error).

Run: `DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test npm run test:graph`
Expected: all `PASS` including every new `live` check. If the two body-shape checks (`GET_PROJECT`, `GET_JOURNAL`) fail on shape alone, fix the test's access path to match the existing checks in the file, not the route.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run lint && npx tsc --noEmit -p . && \
git add 'app/api/graph/projects/[projectId]/live/route.ts' tests/services/load-graph-api.js tests/services/graph-api.test.js && \
git commit -m "feat(graph): POST …/live — a deployment marks an acceptance live on one platform (#424)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 9: The journal row shows the evidence

**Files:**
- Modify: `components/journal/describe-event.ts` (the `node.status_changed` case, ~line 117)

- [ ] **Step 1: Show `detail` beside the platform**

Replace the case with:

```ts
    case "node.status_changed": {
      const from = str(event.from);
      const to = str(event.to);
      const platform = str(event.platform);
      // The live door writes its evidence here (#424): a deploy URL, a store
      // build number. Shown where the move is, after the platform.
      const detail = str(event.detail);
      const meta = [platform ? PLATFORM_LABEL[platform] ?? platform : undefined, detail].filter(Boolean).join(" · ");
      return {
        icon,
        text: `${resolveTitle(event.node_id, nodesById)}: ${from ? STATUS_LABEL[from] ?? from : "?"} → ${to ? STATUS_LABEL[to] ?? to : "?"}`,
        meta: meta || undefined,
      };
    }
```

- [ ] **Step 2: Typecheck, lint, commit**

```bash
npx tsc --noEmit -p . && npm run lint && \
git add components/journal/describe-event.ts && \
git commit -m "feat(journal): a status change shows the evidence it was written with (#424)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 10: Docs — services and journal specs

**Files:**
- Modify: `docs/spec/services.md` (the Scopes bullet ~line 170; the write-path table ~line 181)

- [ ] **Step 1: The scopes bullet**

Replace

```markdown
- **Scopes.** `graph:read` and `graph:write`. A token carries the scopes it was minted with; a session caller carries all of them — scopes exist to limit machines, not people. A caller without the scope gets `403 { error: "insufficient_scope", required }`.
```

with

```markdown
- **Scopes.** `graph:read` and `graph:write` are the agent plane; `synk` is the backup API. Two append-only scopes exist for credentials that live in a public repository's CI secrets, and neither is a default: `quality:append` opens `…/quality/events` for a batch of trips, and `release:append` opens `…/live` (issue #424). A token carries the scopes it was minted with; a session caller carries all of them — scopes exist to limit machines, not people. A caller without the scope gets `403 { error: "insufficient_scope", required }`.
```

- [ ] **Step 2: The route row**

After the `…/quality/events` row in the write-path table, add:

```markdown
| `POST /api/graph/projects/{id}/live` | `graph:write` or `release:append` | The deployment door (issue #424): `{ entries: [{ node_id, platform, detail? }] }` marks each acceptance `live` on that platform and nothing else — `platform` required, acceptances only, never the base status. An ordinary mutation (`applyMutation`: lock, validators, version bump) landing as `node.status_changed` with `platform`, the entry's `detail` and actor `arkaik-ci` (`arkaik-app` for a session). All-or-nothing refusals (`unknown_node`, `not_acceptance`, `archived`, `platform_not_applicable`) are 422; `already_live` is a 200 under `skipped`, so a re-run writes nothing (`lib/services/graph/live.ts`) |
```

- [ ] **Step 3: Commit**

```bash
git add docs/spec/services.md && \
git commit -m "docs(services): the live door and the release:append scope (#424)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 11: Docs — the how-to in `hosted-projects.md`

**Files:**
- Modify: `docs/hosted-projects.md` (a new `###` after "A token for CI: `quality:append`", before `## 2. Get a hosted project`)

- [ ] **Step 1: Write the section**

Insert, immediately before `## 2. Get a hosted project`:

````markdown
### A token for deployments: `release:append`

A merge is not a release. `ref_policy` carries an acceptance to `releasing`
when its pull request merges; what carries it to `live` is the deployment —
and the signals for that live in CI, which is exactly where a broad credential
must not go. `release:append` is `quality:append`'s sibling: one route, one
kind of write, and you have to ask for it when minting.

What it can do: say *this acceptance reached `live` on this platform*. What it
cannot: read your graph, move a status anywhere but `live`, touch anything but
an acceptance, or skip the platform. An unscoped "live" would mark every
platform without an entry of its own as delivered — the biggest claim in the
system, and the last one a CI job should make by omission — so `platform` is
required, and a platform the acceptance does not list is refused and reported,
never guessed. Everything else is also refused rather than guessed; an
acceptance already `live` on that platform is skipped with a 200, so a re-run
job is harmless.

```bash
curl -sS -X POST "$ARKAIK_URL/api/graph/projects/$PROJECT_ID/live" \
  -H "Authorization: Bearer $ARKAIK_RELEASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entries":[{"node_id":"AC-guest-checkout","platform":"ios","detail":"App Store 2.4.1 (build 318)"}]}'
```

`detail` is free text and is the one thing worth sending: the deployment URL,
the store build number — whatever lets someone reading the journal later see
*why* this went live. It lands on the `node.status_changed` event, written by
`arkaik-ci`, beside the platform.

Where the call goes depends on the platform, because each one has a different
moment:

| platform | the moment | where the call goes |
|---|---|---|
| web | the production deploy succeeded | a step at the end of the deploy workflow, after the deploy step reports success |
| android | the release was promoted to the production track | a step at the end of the Play release workflow, after the track upload |
| ios | the store accepted the build (`READY_FOR_SALE`) | a **scheduled** workflow that asks App Store Connect for the state and posts when it reads ready for sale — approval is asynchronous, and no repository event marks it |

Which acceptances a deploy carried is the part no API can know for you. Keep
it simple: list them in the workflow input, or read them off the pull
requests merged since the last release and pass the ids along. The door
accepts up to fifty entries per call.
````

- [ ] **Step 2: Check the anchor Part 1 linked to**

Run: `grep -n 'a-token-for-deployments-releaseappend' docs/hosted-projects.md`
Expected: the two links from §6 and §7 (Task 2) resolve to the new heading's GitHub-style slug `#a-token-for-deployments-releaseappend` (GitHub strips the backticks and the colon). If the docs site uses a different slugger, check how the existing `#a-token-for-ci-qualityappend`-style links are written elsewhere in the file and match.

- [ ] **Step 3: Commit**

```bash
git add docs/hosted-projects.md && \
git commit -m "docs(hosted): a token for deployments — the release:append how-to (#424)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 12: Part 2 verification, the stack, and the PR

- [ ] **Step 1: Run everything the stack touches**

```bash
npm run test:live && npm run test:promote && npm run test:journal && npm run test:pr-plan && npm run test:quality-events && \
DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test npm run test:tokens && \
DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test npm run test:graph && \
DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test npm run test:github && \
npm run lint && npx tsc --noEmit -p . && npm run generate && git diff --exit-code --stat && npm run build
```

Expected: every suite passes, lint and tsc are clean, `generate` leaves no diff, `next build` succeeds.

- [ ] **Step 2: Chain the stack and open the PR**

Use the `gh-stack` skill for the exact commands. The intent: `live-2-door` is stacked on `live-1-schema`, pushed, and its PR targets `live-1-schema`. The PR body:

```markdown
Part 2 of 2 for #424 — the door itself. Stacked on part 1.

- `release:append`: a fifth token scope, never a default. One route, one kind of write.
- `POST /api/graph/projects/{id}/live`: marks acceptances `live` on one platform each, with evidence in `detail`. Platform required; acceptances only; the base status is never touched; `already_live` is a 200 skip so re-runs are harmless. Writes through `applyMutation` as an ordinary `node.status_changed`, actor `arkaik-ci`.
- `applyMutation` takes `annotations` to stamp `detail` on the derived status events.
- The journal row shows the detail beside the platform; the token UI offers the scope; hosted-projects and services docs explain the recipe per platform.

Closes #424.

## Lab Note

```yaml
en:
  title: "Your deploys can now say what went live"
  summary: "A new deployment-only token lets your CI tell arkaik that an acceptance reached Live on a platform — web on deploy, iOS and Android when the store says yes — with the build number or deploy URL right there in the journal. It can do that one thing and nothing else, so it is safe in a public repo's secrets."
fr:
  title: "Tes déploiements peuvent maintenant dire ce qui est en ligne"
  summary: "Un nouveau jeton réservé aux déploiements permet à ta CI de dire à arkaik qu'un critère est passé Live sur une plateforme — web au déploiement, iOS et Android quand le store dit oui — avec le numéro de build ou l'URL de déploiement directement dans le journal. Il ne sait faire que ça, donc il a sa place dans les secrets d'un dépôt public."
suggested:
  molecule: arkaik
  type: feature
  tags: [lifecycle, ci, tokens]
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 3: Read both PRs' comments**

Run: `gh pr view --comments` on each PR.
Expected: no Lab Note problem reported. Fix the body if one is.

- [ ] **Step 4: Stop the scratchpad cluster**

```bash
pg_ctl -D /private/tmp/claude-503/-Users-alexis-code-arkaik/12efde8f-6a76-426c-8852-4320a295c7ed/scratchpad/pgdata stop
```
