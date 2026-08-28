// tools/check-no-client-prisma-import.mjs
//
// `lib/prisma.ts` must never be reachable from a client component.
//
// The module constructs its client at module scope — `new PrismaClient({ log })`
// plus a read of `DATABASE_URL_READ` — so it can never be tree-shaken. Anything
// that pulls it into the browser graph ships that construction, and drags
// @prisma/client's browser build (155 `ScalarFieldEnum` maps naming every column
// of every model) along with it. That is exactly what #1027 fixed: the
// `@/lib/time` barrel re-exported three DB-backed resolvers, and 124 client
// components across 136 routes shipped the result.
//
// #1027 found that by accident, during an unrelated bundle audit. Nothing in the
// repo would have reported it, and nothing would report the next one — which is
// the actual defect this guard closes. The obvious mechanism, `import
// 'server-only'` at the top of lib/prisma.ts, is NOT available here and the
// reason is recorded in that file: `server-only` is not an installed package
// (Next and vitest each alias it internally), so it resolves under the bundler
// and under vitest but not under `tsx`/`node`. Ten CLI entry points import
// lib/prisma directly — scripts/backfill-*, scripts/importLicensePermissions,
// prisma/seeds/*, prisma/scripts/profileRetentionInsights — and every one of
// them dies with MODULE_NOT_FOUND before its first line. Verified by running it,
// not by reading about it.
//
// (`prisma/scripts/_serverOnlyCjsHook.cjs` does shim the specifier, and three
// scripts already run under it. Wiring the rest would make `server-only` viable
// — but it only helps invocations that go through the hooked npm script. A
// direct `npx tsx scripts/backfill-search-index.ts`, which is how these are
// normally driven and how #1027 verified its own fix, would still break. A guard
// costs nothing at runtime and cannot be bypassed by how you launch a script.)
//
// What counts as reachable:
//
//   - Only imports that SURVIVE TypeScript erasure. `import type { X } from`
//     and a specifier list that is entirely inline `type` specifiers both
//     compile to nothing, and client components legitimately import Prisma-
//     derived TYPES all over this repo (Prisma is the schema SSOT — house
//     rules require deriving types from it). A guard that flagged those would
//     be wrong on its face and would be silenced within a day.
//
//   - Traversal STOPS at a `'use server'` module. A Server Action imported by a
//     client component is replaced with an RPC reference in the browser bundle;
//     the implementation stays on the server. `app/pro/aftercare/actions.ts`
//     reaches lib/prisma through lib/booking/writeBoundary.ts and is correct as
//     it stands — treating that as a violation would be a false positive.
//
// NOT covered, deliberately: a direct `@prisma/client` VALUE import in a client
// component (importing an enum object rather than a type). That is a real and
// separate problem — it is what still puts a 124 KB chunk on 53 routes — but it
// needs a client-safe enum surface designed first, and a guard that starts out
// failing teaches people to append to an allowlist. Build that surface, then
// widen this guard.
//
// Usage:
//   node tools/check-no-client-prisma-import.mjs

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const TARGET = 'lib/prisma.ts'
const SCAN_DIRS = ['app', 'lib', 'components', 'hooks', 'contexts', 'providers']
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs']
const IGNORE_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.claude',
])

const TARGET_ABS = path.join(ROOT, TARGET)

// `import ... from '…'` / `export ... from '…'`, capturing the clause so a
// type-only import can be told apart from a value one.
const FROM_RE = /(?:^|\n)[ \t]*(?:import|export)[ \t]+([\s\S]*?)[ \t]*from[ \t]*['"]([^'"]+)['"]/g
// Bare side-effect import: `import '…'`
const SIDE_EFFECT_RE = /(?:^|\n)[ \t]*import[ \t]*['"]([^'"]+)['"]/g
// Dynamic `import('…')`
const DYNAMIC_RE = /\bimport[ \t]*\([ \t]*['"]([^'"]+)['"][ \t]*\)/g

const DIRECTIVE_RE = (name) =>
  new RegExp(`^\\s*(?:\\/\\/[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/\\s*)*['"]use ${name}['"]`)
const USE_CLIENT_RE = DIRECTIVE_RE('client')
const USE_SERVER_RE = DIRECTIVE_RE('server')

function listFiles(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listFiles(full, out)
    else if (EXTENSIONS.includes(path.extname(entry.name))) out.push(full)
  }
  return out
}

function resolveSpecifier(spec, fromFile) {
  let base
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else return null // bare package — not ours to walk

  for (const ext of ['', ...EXTENSIONS]) {
    const candidate = base + ext
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  for (const ext of EXTENSIONS) {
    const candidate = path.join(base, `index${ext}`)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/** True when the import clause is erased by TypeScript and reaches no bundler. */
function isTypeOnlyClause(clause) {
  if (/^type\b/.test(clause)) return true
  const braced = clause.match(/\{([\s\S]*)\}/)
  if (!braced) return false
  // A default or namespace binding before the brace is a value import.
  if (clause.slice(0, clause.indexOf('{')).trim().replace(/,$/, '').length > 0) return false
  const names = braced[1].split(',').map((s) => s.trim()).filter(Boolean)
  return names.length > 0 && names.every((n) => /^type\s/.test(n))
}

function valueImportsOf(file, sourceOverride) {
  let src = sourceOverride
  if (src === undefined) {
    try {
      src = fs.readFileSync(file, 'utf8')
    } catch {
      return []
    }
  }
  const out = []
  for (const m of src.matchAll(FROM_RE)) {
    if (isTypeOnlyClause(m[1])) continue
    const resolved = resolveSpecifier(m[2], file)
    if (resolved) out.push(resolved)
  }
  for (const m of src.matchAll(SIDE_EFFECT_RE)) {
    const resolved = resolveSpecifier(m[1], file)
    if (resolved) out.push(resolved)
  }
  for (const m of src.matchAll(DYNAMIC_RE)) {
    const resolved = resolveSpecifier(m[1], file)
    if (resolved) out.push(resolved)
  }
  return out
}

function readHead(file) {
  try {
    return fs.readFileSync(file, 'utf8').slice(0, 500)
  } catch {
    return ''
  }
}

const isClientModule = (file) => USE_CLIENT_RE.test(readHead(file))
const isServerActionModule = (file) => USE_SERVER_RE.test(readHead(file))

/** Shortest value-import path from `entry` to lib/prisma.ts, or null. */
function findPathToPrisma(entry, depsCache) {
  const seen = new Set([entry])
  const queue = [[entry, [entry]]]
  while (queue.length > 0) {
    const [current, trail] = queue.shift()
    let deps = depsCache.get(current)
    if (deps === undefined) {
      deps = valueImportsOf(current)
      depsCache.set(current, deps)
    }
    for (const dep of deps) {
      if (dep === TARGET_ABS) return [...trail, dep]
      if (seen.has(dep)) continue
      seen.add(dep)
      // A Server Action is an RPC boundary: its body never reaches the browser.
      if (isServerActionModule(dep)) continue
      queue.push([dep, [...trail, dep]])
    }
  }
  return null
}

/**
 * Self-test. A guard whose matchers silently stop matching is worse than no
 * guard, so prove the three behaviours that carry this one before trusting it.
 */
function assertMatchersWork() {
  const cases = [
    ["import type { A } from '@/lib/prisma'", true, 'type-only import'],
    ["import { type A, type B } from '@/lib/prisma'", true, 'all-inline-type specifiers'],
    ["import { prisma } from '@/lib/prisma'", false, 'value import'],
    ["import { type A, prisma } from '@/lib/prisma'", false, 'mixed specifiers'],
    ["import prisma from '@/lib/prisma'", false, 'default import'],
    ["import * as db from '@/lib/prisma'", false, 'namespace import'],
  ]
  for (const [line, expectedTypeOnly, label] of cases) {
    const clause = line.match(/^import[ \t]+([\s\S]*?)[ \t]*from[ \t]*['"]/)
    if (!clause) throw new Error(`check-no-client-prisma-import self-test: could not parse ${label}`)
    const got = isTypeOnlyClause(clause[1])
    if (got !== expectedTypeOnly) {
      throw new Error(
        `check-no-client-prisma-import self-test failed: ${label}\n` +
          `  ${line}\n  expected type-only=${expectedTypeOnly}, got ${got}`,
      )
    }
  }

  if (!USE_CLIENT_RE.test("'use client'\nimport x from 'y'")) {
    throw new Error("check-no-client-prisma-import self-test: 'use client' not detected")
  }
  if (!USE_CLIENT_RE.test("// leading comment\n'use client'\n")) {
    throw new Error("check-no-client-prisma-import self-test: 'use client' after comment not detected")
  }
  if (!USE_SERVER_RE.test("// app/x/actions.ts\n'use server'\n")) {
    throw new Error("check-no-client-prisma-import self-test: 'use server' not detected")
  }
  if (USE_CLIENT_RE.test("import x from 'y'\n'use client'")) {
    throw new Error('check-no-client-prisma-import self-test: directive must lead the file')
  }

  if (!fs.existsSync(TARGET_ABS)) {
    throw new Error(
      `check-no-client-prisma-import: ${TARGET} does not exist. If it moved, update this guard.`,
    )
  }
}

function main() {
  try {
    assertMatchersWork()
  } catch (error) {
    console.error(`\n${error.message}\n`)
    process.exit(1)
  }

  const files = SCAN_DIRS.flatMap((dir) => listFiles(path.join(ROOT, dir)))
  const clientModules = files.filter(isClientModule)
  const depsCache = new Map()

  const violations = []
  for (const entry of clientModules) {
    const trail = findPathToPrisma(entry, depsCache)
    if (trail) violations.push(trail)
  }

  if (violations.length > 0) {
    console.error('\ncheck-no-client-prisma-import: failed\n')
    console.error(
      `A client component reaches ${TARGET}. That module builds its PrismaClient at\n` +
        'module scope, so it cannot be tree-shaken — the browser bundle gets a real\n' +
        "`new PrismaClient()`, a read of DATABASE_URL_READ, and @prisma/client's\n" +
        'browser build (every column of every model, by name).\n\n' +
        'Fix it by splitting the module the chain runs through, the way #1027 did:\n' +
        'a client-safe half holding the pure types/rules, and a server half that\n' +
        'keeps the query and the name. Do not patch the leaf component — the next\n' +
        'importer re-arms the leak.\n',
    )

    for (const trail of violations) {
      const rel = trail.map((f) => path.relative(ROOT, f))
      console.error(`${rel[0]}`)
      for (let i = 1; i < rel.length; i++) console.error(`  ${'  '.repeat(i - 1)}→ ${rel[i]}`)
      console.error('')
    }

    console.error(`Found ${violations.length} client component(s) reaching ${TARGET}.`)
    process.exit(1)
  }

  console.log(
    `check-no-client-prisma-import: passed ` +
      `(${clientModules.length} client modules, none reach ${TARGET})`,
  )
}

main()
