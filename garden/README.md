# Arkaik in the Ariko garden

Arkaik is planted in [Ariko](https://www.ariko.app) as **six pods** under the
`arkaik` plant, one manifest each. A pod is one reader's question; its
narrative walks that reader through its beans in order; every bean carries
its own narrative (`content`, EN and FR) saying what the feature is now and how
it got there, and the dated milestones, essays and decisions live in a
top-level `sprouts:` list, each one `about:` the bean it concerns.

| File | Pod | Reader question |
|---|---|---|
| `ark-read.yml` | One graph, four maps | How do I read my product? |
| `ark-truth.yml` | Track truth, not fields | How do I know what is really shipped? |
| `ark-honest.yml` | Keep it honest | How good is it, and what first? |
| `ark-agents.yml` | Maintained by agents | Who keeps the map alive? |
| `ark-modes.yml` | Run it your way | Where does my data live? |
| `ark-atelier.yml` | The making of | Why is it built this way? |

`shots/` holds one cover per bean, captured from arkaik.app at 2x. Paths in
the manifests are relative to this folder.

Planting happens from the Ariko repo, one file at a time:

```
npm run garden:plant -- ../arkaik/garden/ark-read.yml --dry-run
npm run garden:plant -- ../arkaik/garden/ark-read.yml
```

Everything lands private. Publish in the Ariko admin.

Two rules keep the tree honest on re-plant:

- **A bean's narrative is its `content`, rewritten in place.** There is no
  evergreen `note` sprout any more: the old `<bean>-note` entries became each
  bean's own `content`, and a sprout is a dated journal entry (`kind:` is one
  of `log`, `milestone`, `release`, `essay`, `decision`), never a version of
  the bean's text. A change to a feature edits the narrative; it does not add
  a sprout that restates it.
- A cover is never overwritten by `--update`; swap it in the admin.

**Re-planting and published beans.** `--update` keeps the narrative of anything
already public (the plan marks it `(narrative kept: published)`), the same way
it never replaces a stored cover. So a bean's narrative only lands while the
bean is still private: re-plant with the beans private, then publish them in the
admin. A narrative changed after publishing is edited in the admin.
