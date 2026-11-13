// Flatten CSS nesting — and only nesting — so port_css.py can see every selector.
//
//   node .claude/skills/redesigning-with-tweaks/scripts/flatten.mjs <in.css> <out.css>
//
// port_css.py reads flat rules: it keys each selector's `:root[data-tw-…]`
// condition, and a nested rule hides its child selectors inside a block it
// does not descend into. Authors write nested CSS freely, so flatten every
// source first and point the porter's `sources` at the flattened copies.
// lightningcss (a Next/Tailwind dependency, resolved from the repo's
// node_modules) also reorders declarations, merges identical adjacent rules and
// resolves constant color-mix() values: the output means the same, it just
// won't read like the author's file.
import fs from "node:fs";
import { transform, Features } from "lightningcss";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.log("usage: node flatten.mjs <in.css> <out.css>");
  process.exit(1);
}
const { code } = transform({
  filename: input,
  code: fs.readFileSync(input),
  minify: false,
  include: Features.Nesting,
  errorRecovery: false,
});
fs.writeFileSync(output, code);
console.log(`${output}: ${code.length} bytes`);
