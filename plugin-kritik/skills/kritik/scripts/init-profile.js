#!/usr/bin/env node
/**
 * Kritik install-time surface picker — writes docs/quality/profile.json.
 * GENERATED, DO NOT EDIT BY HAND.
 *
 * Built via `npm run generate` from packages/schema/src/cli (the canonical
 * definitions, docs/spec/toolchain.md § @arkaik/schema). Zero dependencies —
 * runnable with nothing but Node.
 */
"use strict";var m=require("node:fs");var f=["web","ios","android"];var p="cross-surface";function h(e){let i=e.split(":"),n=(i[0]??"").trim();if(n==="")throw new Error(`--surface needs an id (got "${e}")`);if(n===p)throw new Error(`"${p}" is reserved \u2014 it is the contract lens between surfaces. Findings may carry it; it holds no assessments and never becomes a matrix column, so it is not declared here.`);if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n))throw new Error(`surface id "${n}" is not kebab-case \u2014 assessments reference it, so it has to be stable and typo-proof`);let o=(i[1]??"").trim()||n,r=(i[2]??"").trim();if(r!==""&&!f.includes(r))throw new Error(`"${r}" is not an Arkaik platform (${f.join(", ")}). A surface that ships no views simply has none \u2014 leave it off rather than inventing one.`);return r===""?{id:n,title:o}:{id:n,title:o,platform:r}}var d=require("node:fs"),l=require("node:path");var k="docs/quality",S="profile.json";function b(e){let i=(0,d.readFileSync)(e,"utf8");try{return JSON.parse(i)}catch(n){throw new Error(`${e}: not valid JSON \u2014 ${n.message}`)}}function _(e,i){(0,d.mkdirSync)((0,l.dirname)(e),{recursive:!0}),(0,d.writeFileSync)(e,JSON.stringify(i,null,2)+`
`)}var v=e=>(0,l.join)(e,k,S);function a(e){process.stderr.write(`${e}
`),process.exit(1)}var g=`init-profile.js \u2014 write this project's Kritik profile (its surfaces and domain weights)

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
                       --surface supabase:Database contract --weight SEC=2`;function E(e){try{return h(e)}catch(i){return a(`init-profile: ${i.message}`)}}function I(e){let i=e.indexOf("=");i<=0&&a(`init-profile: --weight wants CODE=number (got "${e}")`);let n=e.slice(0,i).trim(),o=Number(e.slice(i+1));return(!Number.isFinite(o)||o<=0)&&a(`init-profile: weight for "${n}" must be a positive number (got "${e}")`),[n,o]}function R(){let e=process.argv.slice(2);(e.length===0||e.includes("--help")||e.includes("-h"))&&(process.stdout.write(`${g}
`),process.exit(e.length===0?1:0));let i=[],n={},o=process.cwd(),r,y=!1;for(let t=0;t<e.length;t++){let s=e[t];if(s==="--surface")i.push(E(e[++t]??""));else if(s==="--weight"){let[w,x]=I(e[++t]??"");n[w]=x}else s==="--config"?r=e[++t]:s==="--root"?o=e[++t]??o:s==="--force"?y=!0:a(`init-profile: unknown option ${s}

${g}`)}let c;if(r!==void 0){(0,m.existsSync)(r)||a(`init-profile: no config at ${r}`);let t=b(r);(!Array.isArray(t?.surfaces)||t.surfaces.length===0)&&a(`init-profile: ${r} declares no surfaces`),c=t}else{i.length===0&&a(`init-profile: at least one --surface is required

${g}`);let t=new Set;for(let s of i)t.has(s.id)&&a(`init-profile: duplicate surface id "${s.id}"`),t.add(s.id);c=Object.keys(n).length>0?{surfaces:i,domain_weights:n}:{surfaces:i}}let u=v(o);(0,m.existsSync)(u)&&!y&&a(`init-profile: ${u} already exists.
Changing the surface list invalidates every score recorded against the old one, so this refuses by default.
Pass --force if that is genuinely what you want.`),_(u,c),process.stdout.write(`wrote ${u}
${c.surfaces.length} surface${c.surfaces.length===1?"":"s"}: ${c.surfaces.map(t=>t.id).join(", ")}
`+(c.domain_weights&&Object.keys(c.domain_weights).length>0?`weights: ${Object.entries(c.domain_weights).map(([t,s])=>`${t}=${s}`).join(" ")}
`:`weights: 1 across every domain
`))}R();
