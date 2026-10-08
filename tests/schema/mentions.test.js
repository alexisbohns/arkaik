#!/usr/bin/env node

/**
 * The `AC-id@platform` mention grammar (packages/schema/src/mentions.ts),
 * moved out of the GitHub App's webhook so the CLI and the mark-live
 * workflow read pull requests with the same rules the webhook does.
 *
 * The invariant under test: a mention is scoped to a platform ONLY IF the
 * suffix, after trimming trailing prose punctuation, equals a PlatformId
 * exactly (case-insensitively). Anything else is reported, never shortened.
 */

const { loadSchema } = require("./load-schema");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const { mentionedAcceptances, isPlatformId } = loadSchema();

const scan = (title, body) => mentionedAcceptances({ title, body });
const has = (list, id, platform) => list.find((m) => m.id === id && m.platform === platform) !== undefined;

{
  const s = scan("x", "closes AC-guest-checkout");
  check("a bare mention has no platform", has(s.mentions, "AC-guest-checkout", null), JSON.stringify(s));
  check("and reports nothing unknown", s.unknown[0] === undefined, JSON.stringify(s));
}
{
  const s = scan("AC-a11y-labels: fix", "");
  check("the title is scanned too", has(s.mentions, "AC-a11y-labels", null), JSON.stringify(s));
}
{
  const s = scan("t", "fixes AC-guest-checkout@ios");
  check("an explicit suffix scopes the mention", has(s.mentions, "AC-guest-checkout", "ios"), JSON.stringify(s));
}
for (const platform of ["web", "ios", "android"]) {
  const s = scan("t", `AC-x@${platform}`);
  check(`@${platform} is a platform`, has(s.mentions, "AC-x", platform), JSON.stringify(s));
}
{
  const s = scan("t", "AC-x@iOS");
  check("a platform suffix is case-folded", has(s.mentions, "AC-x", "ios"), JSON.stringify(s));
}
{
  const s = scan("t", "AC-x\\@ios");
  check("a backslash-escaped @ still scopes", has(s.mentions, "AC-x", "ios"), JSON.stringify(s));
}
for (const written of ["AC-x@ios.", "(AC-x@ios)", "**AC-x@ios**", "`AC-x@ios`", "AC-x@ios,"]) {
  const s = scan("t", written);
  check(`trailing prose is trimmed: ${written}`, has(s.mentions, "AC-x", "ios"), JSON.stringify(s));
}
{
  const s = scan("t", "AC-x@android-tv");
  check("a near-miss suffix is NOT shortened to a platform", !has(s.mentions, "AC-x", "android"), JSON.stringify(s));
  check("it is reported whole", s.unknown.find((u) => u.id === "AC-x" && u.platform === "android-tv") !== undefined, JSON.stringify(s));
}
for (const written of ["@android_tv", "@ios.tv", "@ios/ipad", "@ios2", "@windows"]) {
  const s = scan("t", `AC-x${written}`);
  check(`unknown suffix ${written} is reported, not guessed`, s.mentions.find((m) => m.id === "AC-x") === undefined && s.unknown[0]?.id === "AC-x", JSON.stringify(s));
}
{
  const s = scan("t", "AC-x@windows.");
  check("an unknown suffix is quoted back without its trailing prose", s.unknown.find((u) => u.id === "AC-x" && u.platform === "windows") !== undefined, JSON.stringify(s));
}
{
  const s = scan("t", "AC-x@ and AC-y@ ios");
  check("a dangling @ with nothing after it is a bare mention", has(s.mentions, "AC-x", null) && has(s.mentions, "AC-y", null), JSON.stringify(s));
  check("and not an unknown suffix", s.unknown[0] === undefined, JSON.stringify(s));
}
{
  const s = scan("t", "TRAC-457 and MY_AC-123 are not acceptances");
  check("AC- inside another word is not a mention", s.mentions[0] === undefined && s.unknown[0] === undefined, JSON.stringify(s));
}
{
  const s = scan("t", "AC-x@iOS");
  check("a case-folded platform reports nothing unknown", s.unknown[0] === undefined, JSON.stringify(s));
}
{
  const s = scan("t", "AC-x@.");
  check("a suffix that trims to nothing is unknown, not bare", !has(s.mentions, "AC-x", null) && s.unknown[0]?.id === "AC-x", JSON.stringify(s));
}
{
  const s = scan("t", "AC-x@ios and AC-x@android");
  check("one id can be scoped to two platforms", has(s.mentions, "AC-x", "ios") && has(s.mentions, "AC-x", "android"), JSON.stringify(s));
}
{
  const s = scan("t", "AC-x and AC-x@ios");
  check("a bare and a scoped mention of one id are both kept", has(s.mentions, "AC-x", null) && has(s.mentions, "AC-x", "ios"), JSON.stringify(s));
}
{
  const s = scan("AC-x@ios", "AC-x@ios again");
  check("duplicates collapse on (id, platform)", s.mentions.filter((m) => m.id === "AC-x").length === 1 && has(s.mentions, "AC-x", "ios"), JSON.stringify(s));
}
{
  const s = scan("t", "AC-a@ios,AC-b@web");
  check("two mentions with no space between parse as two", has(s.mentions, "AC-a", "ios") && has(s.mentions, "AC-b", "web"), JSON.stringify(s));
}
{
  const s = scan("t", "AC-x@iosAC-y");
  check("no word boundary means one unknown token, not a confident ios", !has(s.mentions, "AC-x", "ios") && s.unknown[0]?.id === "AC-x", JSON.stringify(s));
}
{
  const s = scan("t", "ac-Lower-CASE");
  check("the AC- prefix is normalised, the rest kept as written", has(s.mentions, "AC-Lower-CASE", null), JSON.stringify(s));
}
check("isPlatformId accepts the three platforms", isPlatformId("web") && isPlatformId("ios") && isPlatformId("android"));
check("isPlatformId rejects anything else", !isPlatformId("windows") && !isPlatformId("") && !isPlatformId("IOS"));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll mentions checks passed.");
