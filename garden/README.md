# Arkaik in the Ariko garden

Arkaik is planted in [Ariko](https://www.ariko.app) as **six pods** under the
`arkaik` plant, one manifest each. A pod is one reader's question; its
narrative walks that reader through its beans in order; every bean carries
one evergreen `note` sprout plus dated milestones, essays and decisions.

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

- A `milestone` sprout has no `content`, so it never replaces a bean's `note`
  as the bean's article (the bean page shows the newest published sprout that
  carries content).
- A cover is never overwritten by `--update`; swap it in the admin.
