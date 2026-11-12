/**
 * Requires the Arkademy's app-side files — components/arkademy/*.tsx,
 * app/sitemap.ts and whatever they import — in plain Node, for
 * tests/app/arkademy-paragraph.test.js's server-render and sitemap checks.
 *
 * CI runs Node 20, which cannot `require` a `.ts` or `.tsx` file, so this
 * installs a require hook: every `.ts`/`.tsx` file under the repo is
 * transpiled in memory by the `typescript` package (JSX with React's automatic
 * runtime), and every `@/…` specifier resolves to the repo root, as
 * tsconfig.json's `paths` does. There is NO alias table to maintain: a new
 * `@/…` import resolves by the same rule. What cannot run in Node fails the
 * load by name — `server-only` throws on purpose outside React Server
 * Components, so a component that imports a server module at runtime (not
 * `import type`) fails here.
 *
 * Nothing is written to disk. lib/arkademy/*.ts is compiled by this hook too
 * when a component imports it; tests/app/load-arkademy.js (the folder's own
 * loader, with its rules) stays the way to load the pure modules.
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");

let installed = false;

function install() {
  if (installed) return;
  installed = true;

  const compile = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    module._compile(outputText, filename);
  };
  // Node 22+ strips types natively; these handlers replace that for files in
  // the repo so Node 20 and Node 26 run the same code.
  Module._extensions[".ts"] = compile;
  Module._extensions[".tsx"] = compile;

  const resolve = Module._resolveFilename;
  Module._resolveFilename = function resolveAlias(request, parent, ...rest) {
    if (request.startsWith("@/")) request = path.join(ROOT, request.slice(2));
    return resolve.call(this, request, parent, ...rest);
  };
}

/** Requires a repo file by its path from the root: `requireTsx("components/arkademy/ParagraphView.tsx")`. */
function requireTsx(relativePath) {
  install();
  return require(path.join(ROOT, relativePath));
}

module.exports = { requireTsx, ROOT };
