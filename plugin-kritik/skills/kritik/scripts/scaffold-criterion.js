#!/usr/bin/env node
/**
 * Kritik custom-criterion scaffolder + issue-skeleton emitter.
 * GENERATED, DO NOT EDIT BY HAND.
 *
 * Built via `npm run generate` from packages/schema/src/cli (the canonical
 * definitions, docs/spec/toolchain.md § @arkaik/schema). Zero dependencies —
 * runnable with nothing but Node.
 */
"use strict";var D=require("node:fs"),h=require("node:path");var g=e=>Array.isArray(e)?e:[];var x=["critical","high","medium","low","info"];var O={critical:[20,25],high:[12,19],medium:[6,11],low:[2,5],info:[1,1]};function v(e,t){if(!t||typeof t!="object")return e;let i=[...g(e.domains)];for(let r of g(t.domains)){if(typeof r?.code!="string"||r.code==="")continue;let o=i.findIndex(a=>a?.code===r.code);o>=0?i[o]=r:i.push(r)}let n=[...g(e.criteria)];for(let r of g(t.criteria)){if(typeof r?.id!="string"||r.id==="")continue;let o=n.findIndex(a=>a?.id===r.id);o>=0?n[o]=r:n.push(r)}let s=e.scales||t.scales?{...e.scales??{},...t.scales??{}}:void 0;return{...e,domains:i,criteria:n,...s?{scales:s}:{}}}function $(e){let t=e?.scales?.severity_buckets,i={...O};if(!t||typeof t!="object")return i;for(let n of x){let s=t[n];Array.isArray(s)&&typeof s[0]=="number"&&typeof s[1]=="number"&&(i[n]=[s[0],s[1]])}return i}function b(e,t){let i=typeof e.impact=="number"?e.impact:0,n=typeof e.likelihood=="number"?e.likelihood:0,s=i*n,r=$(t),o=[...x].sort((a,c)=>r[c][0]-r[a][0]);for(let a of o)if(s>=r[a][0])return a;return"info"}function S(e,t){let i=b(e,t),n=e.cost==="S";return i==="critical"?"P0":i==="high"?n?"P0":"P1":i==="medium"?n?"P1":"P2":i==="low"&&n?"P2":"P3"}function E(e,t){return e.replace(/\{(\w+)\}/g,(i,n)=>t[n]??i)}function R(e,t){let{surface:i,finding:n,library:s}=t,r=e.level_anchors??{},o=t.level===void 0||t.level===""?"":String(t.level),a=o===""?"{observed_level}":o,c=t.targetLevel!==void 0&&t.targetLevel!==""?String(t.targetLevel):o===""?"{target_level}":String(Math.min(Number(o)+1,4)),d={surface:i,observed_level:a,target_level:c,observed_level_name:r[`l${a}`]??"{observed_level_name}",target_level_name:r[`l${c}`]??"{target_level_name}",target_anchor_text:r[`l${c}`]??"{target_anchor_text}",impact:String(n?.impact??e.default_impact??3)};n!==void 0&&(d.likelihood=String(n.likelihood),d.evidence_bullets_with_file_paths=n.evidence,d.risk_narrative=n.detail,typeof n.remediation=="string"&&n.remediation!==""&&(d.remediation_step_1=n.remediation));let l=e.issue??{},C=[...new Set([...l.labels??["quality"],i])],w=E(l.body_skeleton??"",d);return{title:E(l.title_template??`[Quality] ${e.id} on {surface}`,d),labels:C,body:n===void 0?w:`${w}
${q(n,s)}`,...typeof e.remediation=="string"&&e.remediation!==""?{remediation:e.remediation}:{}}}function q(e,t){let i=["","---",`<sub>Kritik finding \`${e.id}\` \u2014 **${b(e,t)} / ${S(e,t)}** (impact ${e.impact} x likelihood ${e.likelihood}, cost ${e.cost})</sub>`,"","**Evidence**",e.evidence];return typeof e.remediation=="string"&&e.remediation!==""&&i.push("","**Remediation**",e.remediation),i.join(`
`)}var f=require("node:fs"),u=require("node:path");var F="docs/quality";var N="criteria.custom.json";var I="library.json";function Q(e,t){return[...t!==void 0?[(0,u.join)(t,F,I)]:[],(0,u.join)(e,"..","references",I),(0,u.join)(e,"..","..","..","..","packages","kritik-library","framework.json")]}function m(e){let t=(0,f.readFileSync)(e,"utf8");try{return JSON.parse(t)}catch(i){throw new Error(`${e}: not valid JSON \u2014 ${i.message}`)}}function K(e,t){(0,f.mkdirSync)((0,u.dirname)(e),{recursive:!0}),(0,f.writeFileSync)(e,JSON.stringify(t,null,2)+`
`)}function _(e,t){for(let i of Q(e,t))if((0,f.existsSync)(i))return m(i);throw new Error(`Kritik: no criteria pack found. Looked in:
  ${Q(e,t).map(i=>(0,u.resolve)(i)).join(`
  `)}`)}var k=e=>(0,u.join)(e,F,N);function y(e){let t=k(e);return(0,f.existsSync)(t)?m(t):null}function p(e){process.stderr.write(`${e}
`),process.exit(1)}var G=["l0","l1","l2","l3","l4"],T={id:"X-01",domain:"ARC",subcategory:"conventions",name:"Short criterion name",question:"The criterion as one question an auditor can actually answer?",definition:"What good looks like on this surface, concretely.",rationale:"Why this matters for this product in particular.",applies_to:["web"],level_anchors:{l0:"Not addressed at all.",l1:"Addressed accidentally or in one spot; no visible intent.",l2:"Deliberately addressed; visible intent; known gaps.",l3:"Systematic across the surface; tested or reviewed.",l4:"Enforced by automation or a CI gate; drift is detected, not hoped against."},default_impact:3,weight:1,references:[],checklist:["The grep, file, or flow an auditor should actually run."],signals:["A check that can run between audits and fail mechanically."],remediation:"The typical fix path.",issue:{title_template:"[Quality] X-01 <name> at level {observed_level} on {surface} (target {target_level})",labels:["quality"],body_skeleton:`## Quality finding: X-01 <name>

**Surface:** {surface}
**Observed level:** {observed_level}
**Target level:** {target_level}

### Evidence
{evidence_bullets_with_file_paths}

### Remediation
- [ ] {remediation_step_1}

### Acceptance criteria
- [ ] Target anchor holds: {target_anchor_text}`}};function A(e){for(let[o,a]of[["id",e.id],["domain",e.domain],["name",e.name],["question",e.question]])if(typeof a!="string"||a.trim()==="")throw new Error(`--${o} is required`);if(e.appliesTo.length===0)throw new Error("--applies-to is required \u2014 a criterion applies to at least one surface");let t=G.filter(o=>!e.anchors[o]);if(t.length>0)throw new Error(`missing anchors ${t.join(", ")}.
All five are required: a criterion without observable descriptions of each level cannot be scored consistently,
and an inconsistently scored criterion makes its whole row incomparable.`);let i=e.weight??1;if(!Number.isInteger(i)||i<1||i>3)throw new Error("--weight must be 1, 2 or 3");let n=e.impact??3;if(!Number.isInteger(n)||n<1||n>5)throw new Error("--impact must be 1-5");let{id:s,name:r}=e;return{id:s,domain:e.domain,...e.subcategory?{subcategory:e.subcategory}:{},name:r,question:e.question,...e.definition?{definition:e.definition}:{},...e.rationale?{rationale:e.rationale}:{},applies_to:e.appliesTo,level_anchors:e.anchors,default_impact:n,weight:i,references:[],checklist:e.checklist??[],signals:e.signals??[],...e.remediation?{remediation:e.remediation}:{},issue:{title_template:`[Quality] ${s} ${r} at level {observed_level} on {surface} (target {target_level})`,labels:e.labels&&e.labels.length>0?e.labels:["quality"],body_skeleton:`## Quality finding: ${s} ${r}

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
- [ ] Target anchor holds: {target_anchor_text}`}}}function L(e,t,i,n={}){if(typeof i.id!="string"||i.id==="")throw new Error("the criterion has no id");if((t.criteria??[]).some(l=>l.id===i.id)&&!n.force)throw new Error(`"${i.id}" is already a pack criterion.
Overriding it changes what every score recorded against that id means.
Use a project-reserved id (X-01, X-02, \u2026) instead, or pass --force if the override is deliberate.`);let s=k(e),r=y(e)??{extends:t.version,criteria:[]};r.criteria=Array.isArray(r.criteria)?r.criteria:[];let o=r.criteria.findIndex(l=>l?.id===i.id);if(o>=0&&!n.force)throw new Error(`"${i.id}" is already in the overlay \u2014 pass --force to replace it`);o>=0?r.criteria[o]=i:r.criteria.push(i);let a=i.domain,c=(t.domains??[]).some(l=>l.code===a)||(r.domains??[]).some(l=>l.code===a),d;if(!c){if(!n.domainName)throw new Error(`"${a}" is not a pack domain and the overlay does not define it.
Pass --domain-name "<display name>" to define it, or use an existing domain code.`);r.domains=[...r.domains??[],{code:a,name:n.domainName}],d=a}return K(s,r),{path:s,overlay:r,replaced:o>=0,...d!==void 0?{addedDomain:d}:{}}}var P=`scaffold-criterion.js \u2014 add a project-specific Kritik criterion, or print an issue skeleton

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

Writes docs/quality/criteria.custom.json`;function M(e){let t={},i={signal:[],check:[],label:[],anchor:[]},n=new Set;for(let s=0;s<e.length;s++){let r=e[s];r.startsWith("--")||p(`scaffold-criterion: unexpected argument "${r}"

${P}`);let o=r.slice(2);if(o==="template"||o==="force"||o==="help"){n.add(o);continue}let a=e[++s];a===void 0&&p(`scaffold-criterion: --${o} needs a value`),o in i?i[o].push(a):t[o]=a}return{single:t,many:i,flags:n}}function j(e,t,i,n,s){let r=v(_(t,e),y(e)),o=(r.criteria??[]).find(c=>c.id===i);o||p(`scaffold-criterion: no criterion "${i}" in the pack or the overlay.
Known ids start with: ${(r.criteria??[]).slice(0,6).map(c=>c.id).join(", ")}\u2026`);let a=R(o,{surface:n,level:s});process.stdout.write(`Title: ${a.title}
`),process.stdout.write(`Labels: ${a.labels.join(", ")}

`),process.stdout.write(`${a.body}
`),a.remediation&&process.stdout.write(`
<!-- Typical remediation: ${a.remediation} -->
`)}function U(e,t){let i={};for(let n of t.anchor){let s=n.indexOf("=");s<=0&&p(`scaffold-criterion: --anchor wants lN=<text> (got "${n}")`),i[n.slice(0,s).trim()]=n.slice(s+1)}return{id:e.id??"",domain:e.domain??"",...e.subcategory?{subcategory:e.subcategory}:{},name:e.name??"",question:e.question??"",...e.definition?{definition:e.definition}:{},...e.rationale?{rationale:e.rationale}:{},appliesTo:(e["applies-to"]??"").split(",").map(n=>n.trim()).filter(Boolean),anchors:i,...e.weight?{weight:Number(e.weight)}:{},...e.impact?{impact:Number(e.impact)}:{},signals:t.signal,checklist:t.check,...e.remediation?{remediation:e.remediation}:{},labels:t.label}}function V(){let e=process.argv.slice(2),t=(0,h.dirname)((0,h.resolve)(process.argv[1]??".")),{single:i,many:n,flags:s}=M(e);if((s.has("help")||e.length===0)&&(process.stdout.write(`${P}
`),process.exit(e.length===0?1:0)),s.has("template")){process.stdout.write(`${JSON.stringify(T,null,2)}
`);return}let r=i.root??process.cwd();if(i["emit-issue"]){i.surface||p("scaffold-criterion: --emit-issue needs --surface"),j(r,t,i["emit-issue"],i.surface,i.level??"");return}let o;try{o=i.from?((0,D.existsSync)(i.from)||p(`scaffold-criterion: no file at ${i.from}`),m(i.from)):A(U(i,n))}catch(d){return p(`scaffold-criterion: ${d.message}`)}let a=_(t,r),c;try{c=L(r,a,o,{force:s.has("force"),...i["domain-name"]?{domainName:i["domain-name"]}:{}})}catch(d){return p(`scaffold-criterion: ${d.message}`)}process.stdout.write(`wrote ${c.path}
${o.id} (${o.domain}) \u2014 applies to ${(o.applies_to??[]).join(", ")||"every surface"}
issue skeleton: node scaffold-criterion.js --emit-issue ${o.id} --surface <surface>
`)}V();
