// prisma/scripts/_serverOnlyCjsHook.cjs
//
// Node preload (--require) that makes bare `import 'server-only'` / 'client-only'
// resolvable outside Next's bundler.
//
// Next.js ships its OWN internal copy of these two packages
// (next/dist/compiled/server-only) and aliases them for webpack/turbopack, so
// `next dev`/`next build` never needs them in node_modules — which is why the repo
// has neither as a real dependency (see test/mocks/server-only.ts for vitest's
// equivalent alias). A plain `tsx`/`node` script has no such bundler, so
// `import 'server-only'` 404s with MODULE_NOT_FOUND the moment a script imports a
// lib/ module that carries that guard (e.g. lib/analytics/proMonthlyAnalytics.ts).
//
// This patches CJS resolution only (Module._resolveFilename) — the import compiles
// to a `require()` call under tsx's CJS interop, not an ESM import, so a
// module.register() resolve hook does not see it.
//
// Usage: NODE_OPTIONS="--import tsx --require ./prisma/scripts/_serverOnlyCjsHook.cjs" node <script>.ts
const Module = require('module')
const path = require('path')

const EMPTY_MODULE_PATH = path.join(__dirname, '_emptyServerOnlyShim.cjs')
const SHIMMED = new Set(['server-only', 'client-only'])

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (SHIMMED.has(request)) return EMPTY_MODULE_PATH
  return originalResolveFilename.call(this, request, ...rest)
}
