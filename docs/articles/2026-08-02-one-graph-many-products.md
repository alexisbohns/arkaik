---
hidden: true
---

# One graph, many products

## The screen that was missing on iOS

Pbbls is a diary app. It ships on web, iOS and Android, and it has a back office
— analytics, glyph moderation, a couple of upload screens — that runs in a
browser and nowhere else. In our map, every one of those admin screens carried
an iOS status and an Android status. Both were empty, and the app renders an
empty per-platform status the way it renders every other one: as work not done
yet. The delivery board counted them against an Android column they could never
join. The acceptance matrix gave them three status columns, two of which would
stay blank forever.

Nothing was broken: every number was correct given the data it was handed. The
data said *this screen exists and has no iOS status*, and the only sentence the
model knew how to build from that was *missing on iOS*.

Two other projects said it louder. Oxymore has an end-user product and an author
product; the author one is web today and may not be forever. teale has four apps
— end user, therapist, an HR dashboard, a back office — of which two are
web-only. And arkaik itself is an app plus a CLI plus an agent plugin: three
things sharing one graph, two of which have no meaningful notion of platform at
all. Three unrelated projects hitting the same wall is not a bug report; it is a
shape problem.

## One axis, two questions

One `platforms` array on every node, drawn from a closed list of `web` / `ios` /
`android`, fed the detail panel's tabs, the per-platform statuses, the delivery
board's columns, the parity rollups and the pyramid's gauges. Load-bearing
everywhere. And it answered two questions at once:

- **Which app is this screen part of?**
- **Which runtime does that app ship on?**

For as long as a project meant one product, the first question had one possible
answer, so nobody asked it out loud. "Platform" quietly absorbed both. The
conflation was not a mistake anybody made — it was invisible, because a
dimension with a single value looks exactly like no dimension at all.

That is the part I would take to any other model. **A conflated dimension stays
invisible while the second dimension has only one value.** You do not find it by
reviewing the schema, which is consistent. You find it when the second value
arrives and the existing axis starts producing statements that are internally
valid and externally false.

## Two options I liked and did not take

The first candidate was to flatten the whole thing: drop the closed platform
enum and let each project define its own **targets** — `app-web`, `app-ios`,
`admin-web`. One dimension everywhere, no inheritance rules, and exotic targets
like watchOS come free.

It dies on denormalisation. Targets are the cross product of products and
platforms: renaming a product means renaming N targets, and every node's array
grows to match. Worse, the parity question — *is this live on iOS?* — loses its
natural axis, and the acceptance matrix is built on exactly that axis. It buys
generality none of the three projects asked for, at the cost of the one column
that surface stands on.

The second candidate was more tempting, because arkaik is a graph browser: make
**product a node species**, with `belongs-to` edges from flows and views. Agents
would edit it like anything else, and it would render on maps.

It dies on locality. Platform containment — a node may only target platforms its
product ships on — stops being checkable by looking at one object: validation
and rollups both need graph traversal to answer a question that is really about
configuration. And every node grows an edge to a pseudo-node that is not part of
the product's anatomy. A variant deriving membership from each product's root
anchor avoids that, but membership then *changes when composition changes*. Fine
as a display heuristic; not something to call truth.

## The choice, and why it stayed small

What shipped is the boring option. Products are project metadata, following the
precedent of stored maps exactly:

```json
"products": [
  { "id": "app",   "title": "Pebbles", "platforms": ["web", "ios", "android"], "root_node_id": "V-landing" },
  { "id": "admin", "title": "Admin",   "platforms": ["web"] }
]
```

Flows and views store a `metadata.product`. Acceptances derive theirs from what
they cover, falling back to a stored key only when they cover nothing yet. Data
models and API endpoints never store membership at all — theirs is derived by
walking outward from the screens that use them, because a data model two apps
both reach genuinely belongs to both. That derivation is a feature rather than a
compromise: an endpoint card can now say *used by: Pebbles, Admin* — the
cross-product traversal a graph exists to answer.

The load-bearing decision is the smallest one. **`node.platforms` stays
authoritative.** The product supplies a *menu*; readers intersect against it
rather than trusting it. No projection had to be re-pointed at a new source of
truth, because there is no new source of truth. That is not to say little
changed: eight surfaces moved, each learning which scope it renders for. What
held still was the thing underneath them.

The discipline I would keep: **a new dimension that constrains an existing one
is far cheaper than one that replaces it.** Constraining is additive, so a
bundle written before products existed still means exactly what it meant. A
project declaring no products resolves to one implicit product spanning every
platform, every node inside it — today's behaviour, unchanged, and enforced by
running every pre-existing test with no product metadata present.

## Where product, design and engineering met

The interesting part was not the model. It was that the *count* of platforms in
scope decides the **shape** of the interface, not merely its contents.

Scoped to a three-platform product, a card shows an aggregate ring plus one ring
per platform. Scoped to the web-only Admin, the aggregate ring and the single
platform ring carry identical numbers — four rings collapse into one. The
mechanical answer is to render one ring. The design answer is that you must not,
because a lone ring sitting where three-ring cards sat a moment ago reads as
*data missing*, not as *absent*. The user's eye counts rings. Removing two of
them looks like a loading failure.

So at one platform, and at zero, the card renders a single bar with the count
beside it. A bar is unambiguously one track; it cannot be misread as a
depopulated set of three.

Two consequences fell out of that. The first: one platform and zero platforms
render *identically*, on purpose. At one, the bar carries no platform icon
either — the scope selector already names the product and says "Web only", so
stamping a web icon on every card repeats it. Keep the icon and the two arities
differ by an icon and its gutter, which makes "identical" something you maintain
by hand rather than something that is true. The threshold now lives in one line
—

```text
platforms.length >= 2 ? rings : bar
```

— and one component switches on it. Every surface composes that component rather
than deciding for itself, so the pyramid and the overview cannot drift apart.

The second consequence is subtler. Two questions both look like "what
platforms?", and they read different sources:

| Question | Reads |
|---|---|
| How many columns, rings or tabs does this surface show? | the **scope's** platform menu |
| What does this node actually ship on? | the node's own platforms, intersected with **its own product's** menu |

Call it shape versus fact. Shape is a property of the scope you are looking
through; fact is a property of the thing you are looking at. They are easy to
swap because both read a list of platforms, and swapping them fails in both
directions. Drive a *fact* from the scope and you get the original bug back:
under "All products" the scope's menu is the union of every product, so a
web-only admin view lands in the Android column exactly as it did before any of
this. Drive a *shape* from the node and you break something far worse — a
project that has never declared a product. The node fact degrades to
`node.platforms` when there is nothing to intersect against, so a
single-platform view's tab strip would silently collapse from three tabs to one,
in a graph that had never heard of products. Our own example bundle has ten
views that would have demonstrated it.

Splitting an axis is not finished when the data model splits. It is finished
when every consumer knows which of the two halves it is asking about.

## Two judgement calls

Every product validation finding is a **warning**, never an error, containment
included. Its structural twin — per-platform metadata keys must be a subset of
the node's own platforms — *is* an error, correctly: both fields sit on the same
object, so a violation is always a local authoring mistake. Containment is not
local. It spans two objects that different people edit at different times, and
narrowing Admin from `[web, ios]` to `[web]` is a product decision that must not
fail CI on somebody else's branch. Readers intersect anyway, so an out-of-menu
platform drops out of the display; an error would buy no safety the intersection
does not already provide.

The second call is that the editing UI has not shipped. Products are project
metadata, so an agent can author them through the existing mutation path the day
the schema lands; a human currently cannot, short of editing JSON. That is a bet
on who the first author is, defensible only in a tool whose committed users keep
their map in the repository next to their code. If it is wrong, it is wrong
loudly and cheap to fix.

## What is still open

The scope is global — one selector in the shell, every surface obeys it. A
per-surface override is the end vision, and all the work done for it so far is
negative: projections take the product as an argument and never read scope
state, and surfaces ask one resolver hook rather than the store. An override is
then a different argument, not a different code path. Acceptance intake — file
an idea before it has screens, decompose it later — the model supports it;
nothing implements it.

"Product" may not even be the right word. It collides with arkaik's own framing,
where a project is one product's anatomy; "app" fails for a CLI or a public API;
"target" is spoken for by build tooling. It won because it is how PMs talk about
the back office — a weak reason that happens to be the strongest available.

## The same mistake, one level down

The most honest wrinkle was in our own example project, and it turned out to be
worse than a wrinkle. Alexis opened the seed, switched to Admin, and saw the
end-user app's screens under Admin's name, platform chips clamped to a menu
those screens had never belonged to. Every test passed; they were written by the
person holding the misunderstanding.

I had scoped the journey by its anchor rather than by membership, to avoid
cutting a shared view out of the middle of a compose chain and truncating
everything below it. That cannot happen. Membership is single per flow and view,
and a surface two apps genuinely share is duplicated under distinct ids, so a
compose edge cannot cross a product boundary — none of the seed's seventy-six
do. The guard cost more than the case it was guarding against.

And it hid something. The System map had been filtering by membership all along,
so two built-in maps in the same sidebar group meant different things by the
word "scope" — invisible for as long as every product had a journey of its own
to anchor on. Admin, four views and no flows, was the first scope different
enough to show it: the same conflation as the rest of this essay, one level
down, arriving after I thought I had finished with it. The maps index had also
been advertising 68 nodes for a journey the canvas drew with 22, under every
scope, since before products existed.

All of it is fixed. None of it has been used yet.
