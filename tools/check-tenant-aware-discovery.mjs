// tools/check-tenant-aware-discovery.mjs
//
// Tenant visibility guard (docs/architecture/tenant-model.md).
//
// Any production file that enumerates professionals (Pro discovery) must
// compose the canonical visibility helpers from lib/tenant instead of
// writing tenant scoping inline — or appear in the baseline.
//
// The baseline exists because route wiring is a Q2 workstream (WS-5):
// today's discovery surfaces are baselined; every NEW discovery surface
// must use the helpers from day one. Shrink the baseline as routes are
// wired; never grow it.
//
// Usage:
//   node tools/check-tenant-aware-discovery.mjs
//   node tools/check-tenant-aware-discovery.mjs --update-baseline

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const BASELINE_PATH = path.join(
  ROOT,
  'tools/baselines/tenant-aware-discovery.txt',
)

// Signals that a file enumerates professionals (a discovery read).
const DISCOVERY_QUERY_PATTERNS = [
  'professionalSearchIndex.findMany',
  'professionalProfile.findMany',
]

// Referencing any of these counts as tenant-aware.
// platformCrossTenantProVisibilityFilter is the explicit opt-out for
// platform-operator surfaces that intentionally read across all tenants.
const TENANT_HELPER_PATTERNS = [
  'proDiscoveryVisibilityFilter',
  'searchIndexVisibilityFilter',
  'searchIndexVisibilitySql',
  'platformCrossTenantProVisibilityFilter',
]

const SCAN_DIRS = ['app', 'lib']

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

function normalize(filePath) {
  return filePath.split(path.sep).join('/')
}

function isTestFile(relPath) {
  return (
    relPath.includes('.test.') ||
    relPath.includes('.spec.') ||
    relPath.includes('/__tests__/')
  )
}

function walk(dir) {
  if (!fs.existsSync(dir)) return []

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        files.push(...walk(fullPath))
      }
      continue
    }

    if (entry.isFile() && TARGET_EXTENSIONS.has(path.extname(fullPath))) {
      files.push(fullPath)
    }
  }

  return files
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

function findViolations() {
  const violations = []

  for (const scanDir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, scanDir))) {
      const rel = normalize(path.relative(ROOT, file))

      if (isTestFile(rel)) continue
      if (rel.startsWith('lib/tenant/')) continue

      const content = fs.readFileSync(file, 'utf8')

      const matchedPatterns = DISCOVERY_QUERY_PATTERNS.filter((pattern) =>
        content.includes(pattern),
      )
      if (matchedPatterns.length === 0) continue

      const isTenantAware = TENANT_HELPER_PATTERNS.some((pattern) =>
        content.includes(pattern),
      )
      if (isTenantAware) continue

      violations.push({ file: rel, patterns: matchedPatterns })
    }
  }

  return violations
}

function writeBaseline(violations) {
  const lines = violations.map((v) => v.file).sort()
  const header = [
    '# Discovery surfaces that pre-date tenant visibility wiring (WS-5).',
    '# Shrink this list as routes adopt lib/tenant visibility helpers.',
    '# Never add new entries — new discovery surfaces must be tenant-aware.',
  ]

  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(BASELINE_PATH, `${header.join('\n')}\n${lines.join('\n')}\n`)

  console.log(
    `check-tenant-aware-discovery: baseline updated with ${lines.length} entries`,
  )
}

function main() {
  const updateBaseline = process.argv.includes('--update-baseline')
  const violations = findViolations()

  if (updateBaseline) {
    writeBaseline(violations)
    return
  }

  const baseline = readBaseline()
  const newViolations = violations.filter((v) => !baseline.has(v.file))
  const resolved = [...baseline].filter(
    (entry) => !violations.some((v) => v.file === entry),
  )

  if (newViolations.length > 0) {
    console.error('\ncheck-tenant-aware-discovery: failed\n')
    console.error(
      'New Pro discovery surfaces must compose the tenant visibility helpers',
    )
    console.error(
      'from lib/tenant (proDiscoveryVisibilityFilter / searchIndexVisibilityFilter).',
    )
    console.error('See docs/architecture/tenant-model.md.\n')

    for (const violation of newViolations) {
      console.error(`${violation.file} — matched: ${violation.patterns.join(', ')}`)
    }

    console.error(`\nFound ${newViolations.length} new violations.`)
    console.error(`Known baseline entries: ${baseline.size}`)
    process.exit(1)
  }

  console.log(
    `check-tenant-aware-discovery: passed (${baseline.size} known baseline entries)`,
  )

  if (resolved.length > 0) {
    console.log(`${resolved.length} baseline entries are now resolved.`)
    console.log('Run with --update-baseline to remove resolved entries.')
  }
}

main()
