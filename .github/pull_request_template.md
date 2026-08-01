<!-- Summary: what changed and why. Keep it short. -->

## Summary

-

<!--
  LAB NOTE — required for any change a user, visitor, or listener would notice.
  Merging this PR posts the note below to the Ariko inbox automatically.
  Fill in the fields (see CLAUDE.md § Lab Note requirement, or the lab-note skill).
  Chore / refactor / infra / docs-only change? Delete this whole section — that's
  the gate. (If the reminder still comments, add the `no-lab-note` label.)
  Keep the quotes around every title and summary: a colon in a sentence breaks
  an unquoted YAML value, and that is the most common malformed note.
-->
## Lab Note

```yaml
en:
  title: "Short, benefit-first title"            # required — always quoted
  summary: "One or two sentences, user-facing."  # required — always quoted
fr:                                              # recommended — adaptation, informal "Tu"
  title: "Titre court, orienté bénéfice"
  summary: "Une ou deux phrases, adaptées, pas traduites littéralement."
suggested:                                       # optional — prefills triage
  molecule: arkaik
  type: feature                                  # feature | improvement | fix | announcement
  tags: [changelog]
```
