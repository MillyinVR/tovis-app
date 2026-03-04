// scripts/top-imports.mjs
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const EXTS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".git"]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(path.join(dir, ent.name), out);
      continue;
    }
    const ext = path.extname(ent.name);
    if (!EXTS.has(ext)) continue;
    out.push(path.join(dir, ent.name));
  }
  return out;
}

const files = walk(ROOT);
const counts = new Map(); // key -> count

function bump(key) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

  sf.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    const mod = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : "";
    if (!mod.startsWith("@/")) return;

    const clause = node.importClause;
    if (!clause) return;

    // Count module import usage (helps find “hot” modules)
    bump(`module:${mod}`);

    // Count named imports (helps find “hot” helpers)
    const nb = clause.namedBindings;
    if (!nb || !ts.isNamedImports(nb)) return;

    for (const el of nb.elements) {
      const name = el.name.text;
      bump(`import:${mod}:${name}`);
    }
  });
}

// Print top 40 imports (skip module: if you only want helpers)
const top = [...counts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 60);

console.log("\nTop imports:\n");
for (const [k, v] of top) console.log(String(v).padStart(4), k);