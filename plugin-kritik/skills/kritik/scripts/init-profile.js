#!/usr/bin/env node
/**
 * Kritik install-time surface picker — writes docs/quality/profile.json.
 * GENERATED, DO NOT EDIT BY HAND.
 *
 * Built via `npm run generate` from packages/schema/src/cli (the canonical
 * definitions, docs/spec/toolchain.md § @arkaik/schema). Zero dependencies —
 * runnable with nothing but Node.
 */
"use strict";var p=require("node:fs");var g="cross-surface";var d=require("node:fs"),l=require("node:path");var _="docs/quality",S="profile.json";function y(i){return JSON.parse((0,d.readFileSync)(i,"utf8"))}function h(i,t){(0,d.mkdirSync)((0,l.dirname)(i),{recursive:!0}),(0,d.writeFileSync)(i,JSON.stringify(t,null,2)+`
`)}var b=i=>(0,l.join)(i,_,S);function n(i){process.stderr.write(`${i}
`),process.exit(1)}var k=["web","ios","android"],u=`init-profile.js \u2014 write this project's Kritik profile (its surfaces and domain weights)

Usage:
  node init-profile.js --surface <id>[:<title>[:<platform>]] [--surface ...] [--weight <CODE>=<n>] [...]
  node init-profile.js --config <path.json>

  --surface   one audit target. \`id\` is what assessments reference; \`title\` is
              what the matrix column reads; \`platform\` (web|ios|android) is the
              optional bridge to the Arkaik product map, for surfaces that ship
              views. Omit it for a database contract, an admin back-office, a CLI.
  --weight    how hard this product is graded on a domain (default 1 for all).
              e.g. --weight SEC=2 --weight PRV=2
  --config    read {"surfaces":[...],"domain_weights":{...}} from a file instead
  --root      repo root to write into (default: the current directory)
  --force     overwrite an existing profile

Writes docs/quality/profile.json

Examples:
  node init-profile.js --surface web:Web app:web
  node init-profile.js --surface web:Web:web --surface ios:iOS:ios \\
                       --surface supabase:Database contract --weight SEC=2`;function v(i){let t=i.split(":"),r=(t[0]??"").trim();r===""&&n(`init-profile: --surface needs an id (got "${i}")

${u}`),r===g&&n(`init-profile: "${g}" is reserved \u2014 it is the contract lens between surfaces.
Findings may carry it; it holds no assessments and never becomes a matrix column, so it is not declared here.`),/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r)||n(`init-profile: surface id "${r}" is not kebab-case \u2014 assessments reference it, so it has to be stable and typo-proof`);let a=(t[1]??"").trim()||r,o=(t[2]??"").trim();return o!==""&&!k.includes(o)&&n(`init-profile: "${o}" is not an Arkaik platform (${k.join(", ")}).
A surface that ships no views simply has none \u2014 leave it off rather than inventing one.`),o===""?{id:r,title:a}:{id:r,title:a,platform:o}}function R(i){let t=i.indexOf("=");t<=0&&n(`init-profile: --weight wants CODE=number (got "${i}")`);let r=i.slice(0,t).trim(),a=Number(i.slice(t+1));return(!Number.isFinite(a)||a<=0)&&n(`init-profile: weight for "${r}" must be a positive number (got "${i}")`),[r,a]}function P(){let i=process.argv.slice(2);(i.length===0||i.includes("--help")||i.includes("-h"))&&(process.stdout.write(`${u}
`),process.exit(i.length===0?1:0));let t=[],r={},a=process.cwd(),o,m=!1;for(let e=0;e<i.length;e++){let s=i[e];if(s==="--surface")t.push(v(i[++e]??""));else if(s==="--weight"){let[w,x]=R(i[++e]??"");r[w]=x}else s==="--config"?o=i[++e]:s==="--root"?a=i[++e]??a:s==="--force"?m=!0:n(`init-profile: unknown option ${s}

${u}`)}let c;if(o!==void 0){(0,p.existsSync)(o)||n(`init-profile: no config at ${o}`);let e=y(o);(!Array.isArray(e?.surfaces)||e.surfaces.length===0)&&n(`init-profile: ${o} declares no surfaces`),c=e}else{t.length===0&&n(`init-profile: at least one --surface is required

${u}`);let e=new Set;for(let s of t)e.has(s.id)&&n(`init-profile: duplicate surface id "${s.id}"`),e.add(s.id);c=Object.keys(r).length>0?{surfaces:t,domain_weights:r}:{surfaces:t}}let f=b(a);(0,p.existsSync)(f)&&!m&&n(`init-profile: ${f} already exists.
Changing the surface list invalidates every score recorded against the old one, so this refuses by default.
Pass --force if that is genuinely what you want.`),h(f,c),process.stdout.write(`wrote ${f}
${c.surfaces.length} surface${c.surfaces.length===1?"":"s"}: ${c.surfaces.map(e=>e.id).join(", ")}
`+(c.domain_weights&&Object.keys(c.domain_weights).length>0?`weights: ${Object.entries(c.domain_weights).map(([e,s])=>`${e}=${s}`).join(" ")}
`:`weights: 1 across every domain
`))}P();
