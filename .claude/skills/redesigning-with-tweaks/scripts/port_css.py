#!/usr/bin/env python3
"""Port tweaker-keyed exploration stylesheets to shipped, preference-keyed CSS.

During an exploration every rule is keyed on `:root[data-tw-<section>="<id>"]`
(or `^="<prefix>"`, or `:is(...)` of those). Once the owner has picked, each
selector's condition is evaluated against every combination of the shipped
preference AXES (e.g. look x groups), and re-keyed:

  holds for every combination        -> :root
  holds for some values of an axis   -> [attr="v"] for a non-default value,
                                        :not([attr="x"])... for the default
                                        (the default is the absence of the attribute)
  holds nowhere                      -> dropped

Then: structural selectors are re-keyed onto stable hooks, prefixes renamed,
selectors naming a class no shipped component renders are pruned (dead
alternatives inside :is() are dropped, not the whole selector), unused
@keyframes removed, hand patches applied, a header prepended.

Usage:
  port_css.py --config tweaks.json --part 3 --out app/m3/thing.css

See config.example.json beside this script for every key.
"""
import argparse
import itertools
import json
import os
import re
import sys

# ── Config ─────────────────────────────────────────────────────────────────────

ap = argparse.ArgumentParser()
ap.add_argument("--config", required=True)
ap.add_argument("--part", required=True, help="key in config.parts: which combinations this part ships")
ap.add_argument("--out", required=True)
args = ap.parse_args()
base_dir = os.path.dirname(os.path.abspath(args.config))
cfg = json.load(open(args.config))


def rel(p):
    return os.path.expanduser(p) if os.path.isabs(os.path.expanduser(p)) else os.path.join(base_dir, p)


AXES = cfg["axes"]  # {"look": {"attr": "data-panel-look", "values": ["expressive", "calm"], "default": "expressive"}}
AXIS_NAMES = list(AXES)
COMBOS = [dict(zip(AXIS_NAMES, vals)) for vals in itertools.product(*(AXES[a]["values"] for a in AXIS_NAMES))]
KEY = lambda c: tuple(c[a] for a in AXIS_NAMES)  # noqa: E731
SECTIONS = cfg["sections"]  # {"header": {"by": "look", "expressive": "bold-header-x", "calm": "calm-header-y"}, "platforms": {"all": "bold-platforms-z"}}
PART = cfg["parts"][args.part]  # {"look": ["expressive"], "groups": ["headlines"]} — values this part ships


def pick(combo, section):
    s = SECTIONS.get(section)
    if not s:
        return "base"
    if "all" in s:
        return s["all"]
    return s[combo[s["by"]]]


# ── Condition evaluation ───────────────────────────────────────────────────────

ATTR = re.compile(r'\[data-tw-([a-z][a-z0-9-]*)(\^?)="([^"]*)"\]')
ROOT = re.compile(r':root(\.dark)?((?:\[data-tw-[a-z][a-z0-9-]*\^?="[^"]*"\]|:is\((?:\s*\[data-tw-[a-z][a-z0-9-]*\^?="[^"]*"\]\s*,?)+\))+)')


def attr_true(combo, m):
    v = pick(combo, m.group(1))
    return v.startswith(m.group(3)) if m.group(2) == "^" else v == m.group(3)


def chain_truth(chain):
    parts = re.findall(r'\[data-tw-[a-z][a-z0-9-]*\^?="[^"]*"\]|:is\([^)]*\)', chain)
    out = set()
    for combo in COMBOS:
        ok = True
        for p in parts:
            if p.startswith(":is("):
                ok &= any(attr_true(combo, m) for m in ATTR.finditer(p))
            else:
                ok &= attr_true(combo, ATTR.match(p))
        if ok:
            out.add(KEY(combo))
    return out


def axis_cond(axis, values):
    a = AXES[axis]
    if set(values) == set(a["values"]):
        return ""
    if values == {a["default"]}:
        return "".join(f':not([{a["attr"]}="{v}"])' for v in a["values"] if v != a["default"])
    if len(values) == 1:
        return f'[{a["attr"]}="{next(iter(values))}"]'
    return None


def prefix_for(truth, dark):
    base = ":root" + (".dark" if dark else "")
    per_axis = [{t[i] for t in truth} for i in range(len(AXIS_NAMES))]
    product = set(itertools.product(*per_axis))
    if product != truth:
        return None  # not a product of per-axis sets: emit one selector per combination
    cond = ""
    for axis, values in zip(AXIS_NAMES, per_axis):
        c = axis_cond(axis, values)
        if c is None:
            return None
        cond += c
    return base + cond


def split_top(s, sep=","):
    out, depth, cur, q = [], 0, "", None
    for ch in s:
        if q:
            cur += ch
            if ch == q:
                q = None
            continue
        if ch in "\"'":
            q = ch
        elif ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == sep and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return [x.strip() for x in out if x.strip()]


def expand_is(sel):
    """`:is(:root[a] X, .k) rest` -> [':root[a] X rest', '.k rest'] (only when :root sits inside)."""
    if not sel.startswith(":is(") or ":root" not in sel:
        return [sel]
    depth = 0
    for j in range(4, len(sel)):  # 4: past the "(" of ":is(" itself
        if sel[j] == "(":
            depth += 1
        elif sel[j] == ")":
            if depth == 0:
                inner, rest = sel[4:j], sel[j + 1:]
                return [alt + rest for alt in split_top(inner)] if ":root" in inner else [sel]
            depth -= 1
    return [sel]


def port_selector(sel):
    out = []
    for s in expand_is(sel):
        m = ROOT.search(s)
        if not m:
            out.append(({KEY(c) for c in COMBOS}, s))
            continue
        truth = chain_truth(m.group(2))
        if not truth:
            continue
        dark = bool(m.group(1))
        pre = prefix_for(truth, dark)
        if pre is None:
            for t in sorted(truth):
                out.append(({t}, s[: m.start()] + prefix_for({t}, dark) + s[m.end():]))
        else:
            out.append((truth, s[: m.start()] + pre + s[m.end():]))
    return out


def ships(truth):
    allowed = [set(PART.get(a, AXES[a]["values"])) for a in AXIS_NAMES]
    return any(all(t[i] in allowed[i] for i in range(len(AXIS_NAMES))) for t in truth)


# ── A tiny CSS tree ────────────────────────────────────────────────────────────

def parse(css):
    nodes, i, n = [], 0, len(css)
    while i < n:
        j = css.find("{", i)
        if j == -1:
            break
        prelude = css[i:j].strip()
        depth, k = 1, j + 1
        while depth and k < n:
            depth += {"{": 1, "}": -1}.get(css[k], 0)
            k += 1
        body = css[j + 1: k - 1]
        if prelude.startswith(("@media", "@supports", "@container")):
            nodes.append(("at", prelude, parse(body)))
        elif prelude.startswith("@keyframes"):
            nodes.append(("raw", prelude, body.strip()))
        else:
            nodes.append(("rule", prelude, body.strip()))
        i = k
    return nodes


def emit(nodes, keep, indent=""):
    out = []
    for kind, prelude, body in nodes:
        if kind == "at":
            inner = emit(body, keep, indent + "  ")
            if inner.strip():
                out.append(f"{indent}{prelude} {{\n{inner}{indent}}}\n")
        elif kind == "raw":
            out.append(f"{indent}{prelude} {{\n{indent}  {body}\n{indent}}}\n")
        else:
            sels = []
            for sel in split_top(prelude):
                new = keep(sel)
                for s in new:
                    if s not in sels:
                        sels.append(s)
            if sels:
                decl = "\n".join(f"{indent}  {d.strip()};" for d in body.split(";") if d.strip())
                out.append(f"{indent}{(',' + chr(10) + indent).join(sels)} {{\n{decl}\n{indent}}}\n")
    return "".join(out)


# ── Pass 1: conditions -> preference attributes ───────────────────────────────

css = "".join(re.sub(r"/\*.*?\*/", "", open(rel(p)).read(), flags=re.S) for p in cfg["sources"])
css = emit(parse(css), lambda sel: [new for truth, new in port_selector(sel) if ships(truth)])

# ── Pass 2: structural re-keys, then renames ───────────────────────────────────

for old, new in cfg.get("rekey", []):
    css = css.replace(old, new)
for pattern, new in cfg.get("rename", []):  # [regex, replacement]: exploration prefixes -> shipped
    css = re.sub(pattern, new, css)
for old, new in cfg.get("post_replace", []):  # literal fixes after renaming (e.g. attribute values)
    css = css.replace(old, new)

# ── Pass 3: prune classes nothing renders ──────────────────────────────────────

prefix = cfg["class_prefix"]  # e.g. "np-"
used = set()
for root in cfg["components"]:
    for base, _, files in os.walk(rel(root)):
        if any(x in base for x in ("node_modules", ".next", ".git")):
            continue
        for f in files:
            if f.endswith((".tsx", ".ts", ".jsx", ".js")):
                used.update(re.findall(rf"{re.escape(prefix)}[a-z0-9-]+", open(os.path.join(base, f), encoding="utf8").read()))
CLASS = re.compile(rf"\.({re.escape(prefix)}[a-z0-9-]+)")
IS = re.compile(r":is\(([^()]*)\)")


def alive(sel):
    def repl(m):
        alts = [a for a in split_top(m.group(1)) if all(c in used for c in CLASS.findall(a))]
        if not alts:
            raise ValueError
        return alts[0] if len(alts) == 1 else ":is(" + ", ".join(alts) + ")"
    try:
        sel = IS.sub(repl, sel)
    except ValueError:
        return []
    return [sel] if all(c in used for c in CLASS.findall(sel)) else []


css = emit(parse(css), alive)
for name in set(re.findall(r"@keyframes ([\w-]+)", css)):
    if len(re.findall(rf"\b{re.escape(name)}\b", css)) == 1:
        css = re.sub(rf"@keyframes {re.escape(name)} \{{.*?\n\}}\n", "", css, flags=re.S)

# ── Pass 4: hand patches, appends, header ──────────────────────────────────────

for patch in cfg.get("patches", []):
    old, new = patch["old"], patch["new"]
    if css.count(old) != 1:
        sys.exit(f"patch did not match exactly once ({css.count(old)}x): {old[:80]!r}")
    css = css.replace(old, new)
for extra in cfg.get("appends", []):
    if args.part in extra.get("parts", [args.part]):
        css += "\n" + open(rel(extra["file"])).read()
header = open(rel(cfg["header"])).read() if cfg.get("header") else ""
open(args.out, "w").write(header + css)
print(f"{args.out}: {css.count('{')} blocks, {len(set(CLASS.findall(css)))} {prefix} classes")
