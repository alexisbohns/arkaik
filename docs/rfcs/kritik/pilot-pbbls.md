# Kritik pilot: the Pebbles audit (2026-08)

This is the evidence that the [Kritik framework](./framework-spec.md) produces real, actionable signal on a real product. It condenses the full audit that lives in the Pebbles repo (`docs/quality/audits/2026-08/`, [pbbls#738](https://github.com/alexisbohns/pbbls/pull/738)) into what an Arkaik implementer needs to trust the design.

## What was run

Pebbles is a five-surface product (web, iOS, Android, admin, Supabase) sharing one Supabase database. The audit, pinned to commit `10181916`:

- scored **88 criteria** across 11 domains on every applicable surface (**338 (criterion x surface) assessments**), each with `file:line` evidence,
- emitted **246 findings** (1 Critical, 40 High, 174 Medium, 31 Low),
- put every Critical and High finding (41) through an independent adversarial refutation attempt before retention: **41/41 confirmed, 0 fabricated**,
- rolled up to the comparative matrix below via the deterministic projection (`compute-matrix.mjs`), grades and caps included.

The whole run was executed by an agent army (27 auditor cells plus a cross-surface contract auditor and a repo-wide agentic-readiness pass, plus verifier agents), which is itself the argument for the CLI/MCP + scheduled-audit loop in the RFC: the framework is built to be run by agents, repeatedly.

## The comparative matrix

Cell = `score (grade)`; `*` = grade capped by an open finding (open Critical caps at D, open High at B). Read a cell only against others in its row.

| Domain | web | ios | android | admin | supabase |
| --- | --- | --- | --- | --- | --- |
| **SEC** Security | 44 (D) | 50 (D) | 48 (D) | 48 (D) | 62 (D\*) |
| **PRV** Privacy | 56 (C) | 44 (D) | 46 (D) | 41 (D) | 63 (C) |
| **GDP** GDPR | 43 (D) | 43 (D) | 38 (E) | 47 (D) | 42 (D) |
| **SAF** Safety | 32 (E) | 32 (E) | 32 (E) | 38 (E) | 50 (D) |
| **ARC** Architecture | 60 (C) | 67 (C) | 77 (B) | 60 (C) | 75 (B) |
| **TST** Testing | 52 (D) | 50 (D) | 59 (C) | 9 (E) | 49 (D) |
| **PLT** Platform/Store | 35 (E) | 42 (D) | 33 (E) | 30 (E) | 34 (E) |
| **A11Y** Accessibility | 46 (D) | 48 (D) | 52 (D) | 34 (E) | 40 (D) |
| **PRF** Performance | 37 (E) | 54 (D) | 54 (D) | 35 (E) | 50 (D) |
| **REL** Reliability | 45 (D) | 47 (D) | 47 (D) | 37 (E) | 33 (E) |
| **AGT** Agent-readiness | 78 (B) | 63 (C) | 78 (B) | 74 (B) | 70 (B) |
| **Overall (weighted)** | **48 (D)** | **48 (D)** | **50 (D)** | **42 (D)** | **53 (D)** |

## What the matrix says (and why it is believable)

The headline is a two-part finding the matrix shows at a glance: **strong craft, missing launch-hardening.** Architecture (ARC) and agent-readiness (AGT) are the two strongest domains, B-grade across most surfaces; the weak band is Safety, Platform/Store, and GDPR. Because the four clients share one database contract, the weak-band gaps repeat identically across surfaces rather than as separate per-client bugs, which is exactly the shape a per-surface matrix is built to reveal.

The caps do real work: Supabase Security scores 62 on maturity but shows **D\*** because one open Critical caps it. Averaging would have hidden the one exploitable hole behind nine healthy criteria; the cap rule refuses to.

## The Critical (the one exploitable-now finding)

`profiles.is_admin` is a client-writable column: the `profiles_update` RLS policy has `using (user_id = auth.uid())` and no `with check`, and Postgres has no column-level RLS, so any authenticated user can `PATCH` their own row to `is_admin = true` and defeat every `is_admin()` gate in the schema. Impact 5, Likelihood 4, severity 20 (Critical), cost S. This is the kind of finding the framework exists to surface: specific, evidence-pinned, and reproducible by a stranger from the citation alone.

## Why this matters for the Arkaik build

1. **The data shapes are proven.** `scores.json` and `findings.json` in the pilot are exactly the `QualityAssessment[]` and `QualityFinding[]` the RFC proposes for the `quality` bundle section. The implementer can treat them as fixtures.
2. **The projections are proven.** `compute-matrix.mjs` is a runnable reference for `deriveQualityMatrix(bundle)`: it computes weighted domain scores, grade bands, caps, and the surface roll-up from nothing but the data.
3. **The rendering is proven.** `dashboard.html` is a standalone reference for the Quality page (matrix heatmap plus filterable findings explorer), so the app UI has a concrete target.
4. **The library is proven.** [`library.example.json`](./library.example.json) is the pack that produced all of the above; it is the seed pack the plugin ships.

The pilot is not part of Arkaik and does not need to be ported; it is the reference implementation and the fixtures. Links back to the full material live in [pbbls#738](https://github.com/alexisbohns/pbbls/pull/738).
