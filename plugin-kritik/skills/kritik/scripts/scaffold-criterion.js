#!/usr/bin/env node
/**
 * Kritik custom-criterion scaffolder + issue-skeleton emitter.
 * GENERATED, DO NOT EDIT BY HAND.
 *
 * Built via `npm run generate` from packages/schema/src/cli (the canonical
 * definitions, docs/spec/toolchain.md § @arkaik/schema). Zero dependencies —
 * runnable with nothing but Node.
 */
"use strict";var A=require("node:fs"),b=require("node:path");var y=e=>Array.isArray(e)?e:[];function _(e,t){if(!t||typeof t!="object")return e;let r=[...y(e.domains)];for(let n of y(t.domains)){if(typeof n?.code!="string"||n.code==="")continue;let i=r.findIndex(a=>a?.code===n.code);i>=0?r[i]=n:r.push(n)}let c=[...y(e.criteria)];for(let n of y(t.criteria)){if(typeof n?.id!="string"||n.id==="")continue;let i=c.findIndex(a=>a?.id===n.id);i>=0?c[i]=n:c.push(n)}let s=e.scales||t.scales?{...e.scales??{},...t.scales??{}}:void 0;return{...e,domains:r,criteria:c,...s?{scales:s}:{}}}var f=require("node:fs"),m=require("node:path");var E="docs/quality";var L="criteria.custom.json";function K(e){return[(0,m.join)(e,"..","references","library.json"),(0,m.join)(e,"..","..","..","..","packages","kritik-library","framework.json")]}function h(e){return JSON.parse((0,f.readFileSync)(e,"utf8"))}function Q(e,t){(0,f.mkdirSync)((0,m.dirname)(e),{recursive:!0}),(0,f.writeFileSync)(e,JSON.stringify(t,null,2)+`
`)}function v(e){for(let t of K(e))if((0,f.existsSync)(t))return h(t);throw new Error(`Kritik: no criteria pack found. Looked in:
  ${K(e).map(t=>(0,m.resolve)(t)).join(`
  `)}`)}var x=e=>(0,m.join)(e,E,L);function w(e){let t=x(e);return(0,f.existsSync)(t)?h(t):null}function l(e){process.stderr.write(`${e}
`),process.exit(1)}var F=["l0","l1","l2","l3","l4"],R=`scaffold-criterion.js \u2014 add a project-specific Kritik criterion, or print an issue skeleton

Usage:
  node scaffold-criterion.js --id <ID> --domain <CODE> --name <text> --question <text> \\
       --applies-to <s1,s2> --anchor l0=<text> --anchor l1=<text> ... [options]
  node scaffold-criterion.js --from <criterion.json>
  node scaffold-criterion.js --template
  node scaffold-criterion.js --emit-issue <CRITERION-ID> --surface <surface> [--level <n>]

Scaffolding options:
  --id           project-reserved namespace, e.g. X-01 (never a pack id)
  --domain       owning domain code \u2014 an existing one (SEC, PRV, \u2026) or your own
  --domain-name  display name, required only when --domain is a new code
  --name         short criterion name
  --question     the criterion as one auditable question
  --definition   what good looks like
  --rationale    why it matters for this product
  --applies-to   comma-separated surface ids
  --anchor       lN=<text>, five times (l0..l4) \u2014 what each level looks like HERE
  --weight       1-3, weight in the domain roll-up (default 1)
  --impact       1-5, seeds finding severity (default 3)
  --signal       a mechanically checkable hook; repeatable
  --check        a concrete audit step; repeatable
  --remediation  the typical fix path
  --label        an issue label; repeatable (default: quality)
  --root         repo root (default: the current directory)
  --force        replace an existing criterion with this id

Writes docs/quality/criteria.custom.json`,I={id:"X-01",domain:"ARC",subcategory:"conventions",name:"Short criterion name",question:"The criterion as one question an auditor can actually answer?",definition:"What good looks like on this surface, concretely.",rationale:"Why this matters for this product in particular.",applies_to:["web"],level_anchors:{l0:"Not addressed at all.",l1:"Addressed accidentally or in one spot; no visible intent.",l2:"Deliberately addressed; visible intent; known gaps.",l3:"Systematic across the surface; tested or reviewed.",l4:"Enforced by automation or a CI gate; drift is detected, not hoped against."},default_impact:3,weight:1,references:[],checklist:["The grep, file, or flow an auditor should actually run."],signals:["A check that can run between audits and fail mechanically."],remediation:"The typical fix path.",issue:{title_template:"[Quality] X-01 <name> at level {observed_level} on {surface} (target {target_level})",labels:["quality"],body_skeleton:`## Quality finding: X-01 <name>

**Surface:** {surface}
**Observed level:** {observed_level}
**Target level:** {target_level}

### Evidence
{evidence_bullets_with_file_paths}

### Remediation
- [ ] {remediation_step_1}

### Acceptance criteria
- [ ] Target anchor holds: {target_anchor_text}`}};function O(e){let t={},r={signal:[],check:[],label:[],anchor:[]},c=new Set;for(let s=0;s<e.length;s++){let n=e[s];n.startsWith("--")||l(`scaffold-criterion: unexpected argument "${n}"

${R}`);let i=n.slice(2);if(i==="template"||i==="force"||i==="help"){c.add(i);continue}let a=e[++s];a===void 0&&l(`scaffold-criterion: --${i} needs a value`),i in r?r[i].push(a):t[i]=a}return{single:t,many:r,flags:c}}function P(e,t){return e.replace(/\{(\w+)\}/g,(r,c)=>t[c]??r)}function T(e,t,r,c,s){let n=_(v(t),w(e)),i=(n.criteria??[]).find(k=>k.id===r);i||l(`scaffold-criterion: no criterion "${r}" in the pack or the overlay.
Known ids start with: ${(n.criteria??[]).slice(0,6).map(k=>k.id).join(", ")}\u2026`);let a=i.level_anchors??{},g=s===""?"{observed_level}":s,o=s===""?"{target_level}":String(Math.min(Number(s)+1,4)),u={surface:c,observed_level:g,target_level:o,observed_level_name:a[`l${g}`]??"{observed_level_name}",target_anchor_text:a[`l${o}`]??"{target_anchor_text}",impact:String(i.default_impact??3)},p=i.issue??{},S=P(p.title_template??`[Quality] ${i.id} on {surface}`,u),d=[...p.labels??["quality"],c];process.stdout.write(`Title: ${S}
`),process.stdout.write(`Labels: ${d.join(", ")}

`),process.stdout.write(`${P(p.body_skeleton??"",u)}
`),i.remediation&&process.stdout.write(`
<!-- Typical remediation: ${i.remediation} -->
`)}function C(e,t){let r=["id","domain","name","question","applies-to"];for(let o of r)e[o]||l(`scaffold-criterion: --${o} is required

${R}`);let c=e.id,s={};for(let o of t.anchor){let u=o.indexOf("=");u<=0&&l(`scaffold-criterion: --anchor wants lN=<text> (got "${o}")`),s[o.slice(0,u).trim()]=o.slice(u+1)}let n=F.filter(o=>!s[o]);n.length>0&&l(`scaffold-criterion: missing anchors ${n.join(", ")}.
All five are required: a criterion without observable descriptions of each level cannot be scored consistently,
and an inconsistently scored criterion makes its whole row incomparable.`);let i=e.weight?Number(e.weight):1;(!Number.isInteger(i)||i<1||i>3)&&l("scaffold-criterion: --weight must be 1, 2 or 3");let a=e.impact?Number(e.impact):3;(!Number.isInteger(a)||a<1||a>5)&&l("scaffold-criterion: --impact must be 1-5");let g=t.label.length>0?t.label:["quality"];return{id:c,domain:e.domain,...e.subcategory?{subcategory:e.subcategory}:{},name:e.name,question:e.question,...e.definition?{definition:e.definition}:{},...e.rationale?{rationale:e.rationale}:{},applies_to:e["applies-to"].split(",").map(o=>o.trim()).filter(Boolean),level_anchors:s,default_impact:a,weight:i,references:[],checklist:t.check,signals:t.signal,...e.remediation?{remediation:e.remediation}:{},issue:{title_template:`[Quality] ${c} ${e.name} at level {observed_level} on {surface} (target {target_level})`,labels:g,body_skeleton:`## Quality finding: ${c} ${e.name}

**Surface:** {surface}
**Observed level:** {observed_level}
**Target level:** {target_level}
**Severity seed:** impact {impact} x likelihood {likelihood}

### Evidence
{evidence_bullets_with_file_paths}

### Risk
{risk_narrative}

### Remediation
- [ ] {remediation_step_1}

### Acceptance criteria
- [ ] Target anchor holds: {target_anchor_text}`}}}function D(){let e=process.argv.slice(2),t=(0,b.dirname)((0,b.resolve)(process.argv[1]??".")),{single:r,many:c,flags:s}=O(e);if((s.has("help")||e.length===0)&&(process.stdout.write(`${R}
`),process.exit(e.length===0?1:0)),s.has("template")){process.stdout.write(`${JSON.stringify(I,null,2)}
`);return}let n=r.root??process.cwd();if(r["emit-issue"]){r.surface||l("scaffold-criterion: --emit-issue needs --surface"),T(n,t,r["emit-issue"],r.surface,r.level??"");return}let i=r.from?((0,A.existsSync)(r.from)||l(`scaffold-criterion: no file at ${r.from}`),h(r.from)):C(r,c);(typeof i.id!="string"||i.id==="")&&l("scaffold-criterion: the criterion has no id");let a=v(t);(a.criteria??[]).some(d=>d.id===i.id)&&!s.has("force")&&l(`scaffold-criterion: "${i.id}" is already a pack criterion.
Overriding it changes what every score recorded against that id means.
Use a project-reserved id (X-01, X-02, \u2026) instead, or pass --force if the override is deliberate.`);let g=x(n),o=w(n)??{extends:a.version,criteria:[]};o.criteria=Array.isArray(o.criteria)?o.criteria:[];let u=o.criteria.findIndex(d=>d?.id===i.id);u>=0&&!s.has("force")&&l(`scaffold-criterion: "${i.id}" is already in the overlay \u2014 pass --force to replace it`),u>=0?o.criteria[u]=i:o.criteria.push(i);let p=i.domain;if(!((a.domains??[]).some(d=>d.code===p)||(o.domains??[]).some(d=>d.code===p))){let d=r["domain-name"];d||l(`scaffold-criterion: "${p}" is not a pack domain and the overlay does not define it.
Pass --domain-name "<display name>" to define it, or use an existing domain code.`),o.domains=[...o.domains??[],{code:p,name:d}]}Q(g,o),process.stdout.write(`wrote ${g}
${i.id} (${i.domain}) \u2014 applies to ${(i.applies_to??[]).join(", ")||"every surface"}
issue skeleton: node scaffold-criterion.js --emit-issue ${i.id} --surface <surface>
`)}D();
