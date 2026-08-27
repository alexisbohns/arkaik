# @arkaik/kritik-library

The reusable **Kritik** quality-criteria pack and its meta-model spec. MIT-licensed, so it can be pasted into other organizations' repositories, exactly like `@arkaik/schema` and the rest of the toolchain (`CONTRIBUTING.md` § License).

| File | What it is |
| --- | --- |
| [`framework.json`](./framework.json) | The criteria pack: scales, 11 domains, 88 criteria (each with a definition, 0-4 maturity anchors, references, an executable checklist, monitoring signals, and an issue skeleton), plus an example profile. This is the seed pack the Kritik plugin ships. |
| [`SPEC.md`](./SPEC.md) | The reusable meta-model: entities, the 0-4 maturity scale, risk = impact x likelihood, cost, priority, and the roll-up + anti-averaging cap rules. |

The criteria are written for a product **class** (multi-client + shared database), calibrated to the Next.js / SwiftUI / Compose / Supabase stack; a consuming project supplies its own **profile** (surface list + domain weights) and may extend the pack with its own criteria in a project-local overlay. See the design in [`docs/rfcs/kritik.md`](../../docs/rfcs/kritik.md) and the real-world pilot in [`docs/rfcs/kritik/pilot-pbbls.md`](../../docs/rfcs/kritik/pilot-pbbls.md).

## Status

v0.1.0, authored on the Pebbles audit (see the pilot). `private: true` for now: the pack is not yet published to npm. The implementation handoff (arkaik#382) decides packaging and publishing, plus whether the plugin embeds this pack or depends on it.

## Stability

Criteria are **append-and-supersede**: an id is never redefined, only deprecated (`superseded_by`) with a new id introduced, so maturity scores stay comparable across audits and across pack versions.
