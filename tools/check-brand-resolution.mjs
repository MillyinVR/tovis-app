// tools/check-brand-resolution.mjs
//
// Brand resolution guard (docs/architecture/tenant-model.md).
//
// Two functions answer "which brand?":
//
//   getBrandConfig()            tenant -> host -> NEXT_PUBLIC_BRAND -> tovis
//   getBrandForTenantContext()  exact registry lookup, tovis otherwise
//
// Only the second is safe on a tenant-facing surface. The first walks a
// fallback chain that ends at the DEPLOYMENT's env var, so on a white-label
// domain it renders whatever brand that deployment was configured with —
// one tenant's branding leaking into another's. `getBrandConfig({ host })`
// is no better: the host map in lib/brand/index.ts knows tovis.app and
// localhost and nothing else, so a tenant's custom domain falls straight
// through to the same env var.
//
// So: outside lib/brand, resolve the brand from a TenantContext.
//
//   server component / page   getBrandForTenantContext(
//                               await resolveTenantContextForLayout())
//   route handler             getBrandForTenantContext(
//                               await resolveTenantContextForRequest(req))
//   client component          const { brand } = useBrand()
//
// The baseline is not a to-do list here — it is one surface that genuinely
// cannot do any of the above, written down so the next person does not
// re-litigate it. Never grow it; a new entry needs the same kind of reason.
//
// Usage:
//   node tools/check-brand-resolution.mjs
//   node tools/check-brand-resolution.mjs --update-baseline

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const BASELINE_PATH = path.join(ROOT, 'tools/baselines/brand-resolution.txt')

const SCAN_DIRS = ['app', 'lib']

// lib/brand owns the resolver, its own fallback, and the registry.
const ALLOWED_PREFIXES = ['lib/brand/']

const IGNORE_DIRS = new Set([
  '.git',
  '.next',
  '.claude',
  'node_modules',
  'dist',
  'build',
  'coverage',
])

const TARGET_EXTENSIONS = new Set(['.ts', '.tsx'])

const normalize = (p) => p.split(path.sep).join('/')

const isTestFile = (rel) =>
  rel.includes('.test.') || rel.includes('.spec.') || rel.includes('/__tests__/')

function walk(dir) {
  if (!fs.existsSync(dir)) return []

  const files = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) files.push(...walk(full))
      continue
    }

    if (entry.isFile() && TARGET_EXTENSIONS.has(path.extname(full))) {
      files.push(full)
    }
  }

  return files
}

/**
 * Blank out line and block comments, preserving line count and offsets.
 *
 * A guard that reads comments reports prose as code. This repo has already
 * been bitten twice by that — a docstring's example class shipped a real CSS
 * rule, and check-no-bare-tint-token flagged the sentence explaining its own
 * fix. Here the prose in question is lib/booking/writeBoundary.ts, which says
 * "Do NOT swap this for `getBrandConfig()`" — the one file most obviously
 * doing the right thing would have been the guard's first violation.
 *
 * The `[^:]` before `//` keeps `https://…` inside a string from opening a
 * comment that swallows the rest of the line.
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) =>
      lead + ' '.repeat(m.length - lead.length),
    )
}

/** Every getBrandConfig call site in one file, comments excluded. */
export function scanSource(relPath, source) {
  const violations = []

  stripComments(source)
    .split('\n')
    .forEach((line, index) => {
      if (!/\bgetBrandConfig\s*\(/.test(line)) return

      violations.push({ file: relPath, line: index + 1 })
    })

  return violations
}

/** Whether this guard has an opinion about a given file at all. */
export function isGuardedPath(rel) {
  if (isTestFile(rel)) return false

  return !ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix))
}

function findViolations() {
  const violations = []

  for (const scanDir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, scanDir))) {
      const rel = normalize(path.relative(ROOT, file))

      if (!isGuardedPath(rel)) continue

      violations.push(...scanSource(rel, fs.readFileSync(file, 'utf8')))
    }
  }

  return violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  )
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return new Set()

  return new Set(
    fs
      .readFileSync(BASELINE_PATH, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith('#')),
  )
}

// Keyed by file, not by file:line — a line number moves whenever anything
// above it does, and a baseline that churns on unrelated edits gets updated
// without being read.
const keyOf = (violation) => violation.file

function writeBaseline(violations) {
  const header = [
    '# Files outside lib/brand that still call getBrandConfig().',
    '#',
    '# NOT a to-do list. Each entry is a surface that cannot resolve a tenant',
    '# context at all, with the reason. Never add an entry that merely has not',
    '# been migrated yet — migrate it. See tools/check-brand-resolution.mjs.',
    '#',
    '#   app/global-error.tsx — replaces the ROOT layout when the root layout',
    '#   itself throws, so there is no BrandProvider above it to read and no',
    '#   request scope to resolve a tenant from. The env chain is all it has.',
    '',
  ]

  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(
    BASELINE_PATH,
    `${header.join('\n')}${[...new Set(violations.map(keyOf))].sort().join('\n')}\n`,
  )

  console.log(
    `check-brand-resolution: baseline updated with ${new Set(violations.map(keyOf)).size} entries`,
  )
}

function main() {
  const violations = findViolations()

  if (process.argv.includes('--update-baseline')) {
    writeBaseline(violations)
    return
  }

  const baseline = readBaseline()
  const fresh = violations.filter((v) => !baseline.has(keyOf(v)))
  const resolved = [...baseline].filter(
    (entry) => !violations.some((v) => keyOf(v) === entry),
  )

  if (fresh.length > 0) {
    console.error('\ncheck-brand-resolution: failed\n')
    console.error(
      'getBrandConfig() falls back to the DEPLOYMENT\'s NEXT_PUBLIC_BRAND, so on a',
    )
    console.error(
      'white-label domain it renders the wrong tenant\'s branding. Resolve from a',
    )
    console.error('TenantContext instead:\n')
    console.error(
      '  page / server component  getBrandForTenantContext(await resolveTenantContextForLayout())',
    )
    console.error(
      '  route handler            getBrandForTenantContext(await resolveTenantContextForRequest(req))',
    )
    console.error('  client component         const { brand } = useBrand()\n')

    for (const violation of fresh) {
      console.error(`${violation.file}:${violation.line}`)
    }

    console.error(`\nFound ${fresh.length} new call site(s).`)
    console.error(`Known baseline entries: ${baseline.size}`)
    process.exit(1)
  }

  console.log(
    `check-brand-resolution: passed (${baseline.size} known baseline entries)`,
  )

  if (resolved.length > 0) {
    console.log(`${resolved.length} baseline entries are now resolved.`)
    console.log('Run with --update-baseline to remove resolved entries.')
  }
}

// Only sweep the repo when this file IS the command; the detector above is
// imported by check-brand-resolution.test.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
