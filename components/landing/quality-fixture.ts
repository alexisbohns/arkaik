import type { JournalEvent, QualitySection } from "@arkaik/schema";

/**
 * The quality section the landing page renders — ILLUSTRATIVE, not an audit.
 *
 * Neither shipped seed carries Kritik data, so the `quality` chapter reads the
 * Pebbles bundle with this section attached (`lib/landing/seeds.ts`,
 * source `pilot-audit`). Shapes, ids and criteria are lifted from the real
 * Pebbles pilot audit (`tests/fixtures/quality/pilot-2026-08.json` and
 * `packages/kritik-library/framework.json`); the levels, evidence and
 * findings are invented to show every state the UI has. Replacing it with a
 * real audit is a fixture swap. `tests/landing/landing.test.js` parses it with
 * the schema and derives the matrix from it, so it cannot drift silently.
 */
const AUDIT_ID = "2026-08";
const TS = "2026-08-26T00:00:00.000Z";
const COMMIT = "9f2c1e4d";

export const LANDING_QUALITY: QualitySection = {
  framework_version: "0.1.0",
  library: {
    version: "0.1.0",
    domains: [
      { code: "SEC", name: "Security" },
      { code: "A11Y", name: "Accessibility & Inclusion" },
      { code: "TST", name: "Testing & Verification" },
      { code: "REL", name: "Reliability & Observability" },
    ],
    criteria: [
      { id: "SEC-01", domain: "SEC", name: "Authentication and session lifecycle integrity", weight: 3,
        question: "Do all authentication flows and session lifecycles go through the vetted auth SDK and behave consistently on every client surface?" },
      { id: "SEC-03", domain: "SEC", name: "Security-definer RPC and privileged-role hygiene", weight: 3,
        question: "Does every security-definer function pin its search_path and verify caller ownership inside the function body?" },
      { id: "A11Y-01", domain: "A11Y", name: "Keyboard operability and accessible semantics", weight: 3,
        question: "Can every interactive flow be completed with a keyboard alone, with a visible focus indicator at every step?" },
      { id: "TST-01", domain: "TST", name: "Core user paths have automated tests", weight: 3,
        question: "Is every core user path exercised by at least one automated test that would fail if the path broke?" },
      { id: "REL-01", domain: "REL", name: "Failure states distinct from empty states", weight: 3,
        question: "Does every data load distinguish failure from emptiness, with a recoverable error state?" },
    ],
  },
  profile: {
    surfaces: [
      { id: "web", title: "Web app", platform: "web", path: "apps/web" },
      { id: "ios", title: "iOS", platform: "ios", path: "apps/ios" },
      { id: "android", title: "Android", platform: "android", path: "apps/android" },
    ],
    domain_weights: { SEC: 2, A11Y: 1, TST: 1, REL: 1 },
  },
  assessments: [
    // web
    a("SEC-01", "web", 3, "Sign-in, refresh and sign-out all go through the SDK; one shared sign-out helper."),
    a("SEC-03", "web", 1, "Two definer functions read `select *` across user rows; search_path unpinned on one."),
    a("A11Y-01", "web", 2, "Overlays are accessible primitives; three custom controls lack a focus ring."),
    a("TST-01", "web", 3, "Every core path has a Playwright spec; CI runs them on each PR."),
    a("REL-01", "web", 2, "Lists distinguish failure from empty; the pebble detail swallows one fetch error."),
    // ios
    a("SEC-01", "ios", 3, "Keychain-backed session via the SDK; refresh handled centrally."),
    a("SEC-03", "ios", 4, "No privileged calls from the client; every RPC is allowlisted server side."),
    a("A11Y-01", "ios", 3, "VoiceOver labels on every control; Dynamic Type verified at the largest size."),
    a("TST-01", "ios", 2, "Unit tests on the domain layer; no UI test covers the draw flow."),
    a("REL-01", "ios", 3, "Every screen has an error state with retry; errors logged with cause."),
    // android
    a("SEC-01", "android", 2, "Session refresh implemented twice; one path bypasses the SDK."),
    a("SEC-03", "android", 4, "No privileged calls from the client; every RPC is allowlisted server side."),
    a("A11Y-01", "android", 1, "TalkBack reads unlabeled icons on the timeline; no focus order defined."),
    a("TST-01", "android", 1, "One smoke test; no CI job runs the Android test command."),
    a("REL-01", "android", 2, "Empty and failed loads share one placeholder on two screens."),
  ],
  findings: [
    {
      id: "F-2026-08-SEC-web-01",
      criterion_id: "SEC-03",
      surface: "web",
      title: "Two security-definer functions return whole rows across user boundaries",
      detail: "`pebble_feed` and `soul_lookup` are definer functions that `select *` from tables holding other users' rows, so any caller reads columns the RLS policies were written to hide.",
      evidence: "supabase/migrations/20260411000001_core_tables.sql:159-188",
      impact: 4,
      likelihood: 4,
      cost: "S",
      status: "open",
      remediation: "Return an explicit column allowlist and pin `search_path` on both functions.",
      node_ids: ["V-pebble-detail", "V-souls-list"],
      verification: { verdict: "CONFIRMED" },
    },
    {
      id: "F-2026-08-A11Y-android-01",
      criterion_id: "A11Y-01",
      surface: "android",
      title: "Timeline icon buttons have no content description",
      detail: "TalkBack announces the emotion glyphs on the timeline as \"button\" with no label, so the primary navigation is unusable without sight.",
      evidence: "apps/android/app/src/main/java/timeline/TimelineRow.kt:41-58",
      impact: 3,
      likelihood: 4,
      cost: "S",
      status: "resolved",
      node_ids: ["V-timeline"],
      verification: { verdict: "CONFIRMED" },
    },
    {
      id: "F-2026-08-TST-android-01",
      criterion_id: "TST-01",
      surface: "android",
      title: "No CI job runs the Android test command",
      detail: "The Android workspace has a test target but no workflow invokes it, so a broken draw flow ships unnoticed.",
      evidence: ".github/workflows/*.yml — no `gradlew test` step",
      impact: 3,
      likelihood: 3,
      cost: "M",
      status: "open",
      node_ids: ["V-home"],
      verification: { verdict: "CONFIRMED" },
    },
  ],
};

/**
 * The journal facts the findings board's feed row shows: a CI-tripped signal
 * (the prompt to go look, not a finding) and the resolution of the A11Y
 * finding above. Appended to the Pebbles journal by `lib/landing/seeds.ts`.
 */
export const LANDING_QUALITY_EVENTS: JournalEvent[] = [
  {
    id: "01K3Y0000000000000000QF001",
    ts: "2026-08-27T09:12:00.000Z",
    actor: "github-app",
    type: "quality.finding.resolved",
    finding_id: "F-2026-08-A11Y-android-01",
    resolved_by: "https://github.com/pebbles/pebbles/pull/745",
    node_ids: ["V-timeline"],
  },
  {
    id: "01K3Y0000000000000000QS001",
    ts: "2026-08-28T14:03:00.000Z",
    actor: "ci",
    type: "quality.signal.tripped",
    criterion_id: "TST-01",
    surface: "android",
    signal: "CI workflow exists per surface that runs its test command",
    commit: COMMIT,
    detail: "android.yml removed its `gradlew test` step in #751.",
  },
];

function a(criterion_id: string, surface: string, level: 0 | 1 | 2 | 3 | 4, evidence: string) {
  return { criterion_id, surface, level, evidence, audit_id: AUDIT_ID, commit: COMMIT, ts: TS };
}
