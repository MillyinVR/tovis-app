// tools/check-no-hardcoded-brand-strings.mjs
//
// White-label readiness guard (docs/architecture/tenant-model.md, WS-6).
//
// User-facing brand copy must come from lib/brand (which becomes
// tenant-resolved), not be hardcoded as "TOVIS" in components, emails, SMS,
// or notifications. Existing occurrences are baselined as the WS-6 copy
// migration worklist; new hardcoded brand strings fail the check.
//
// Allowed locations: lib/brand/ (the brand source of truth itself) and
// lib/tenant/constants.ts (the reserved root tenant's display name).
//
// Usage:
//   node tools/check-no-hardcoded-brand-strings.mjs
//   node tools/check-no-hardcoded-brand-strings.mjs --update-baseline

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const BASELINE_PATH = path.join(
  ROOT,
  'tools/baselines/no-hardcoded-brand-strings.txt',
)

const BRAND_PATTERN = /TOVIS|Tovis/

// Identifier-ish tokens that are not user-facing copy. These are STRIPPED
// from the line before the brand pattern runs (never used to skip a whole
// line) so copy like `Contact TOVIS at support@tovis.app` is still caught
// via the remaining standalone "TOVIS".
const IGNORED_TOKEN_PATTERNS = [
  /[\w.+-]*@tovis[\w.-]*/g, // email addresses / package scopes
  /(?:www\.)?tovis\.app/g, // platform domain in links (own WS-6 follow-up)
  /tovis-root/g, // reserved tenant slug
  /tovis-app/g, // repo/package name
  /TOVIS_[A-Z0-9_]+/g, // env var / constant identifiers
]

function stripIgnoredTokens(line) {
  let result = line
  for (const pattern of IGNORED_TOKEN_PATTERNS) {
    result = result.replace(pattern, '')
  }
  return result
}

const ALLOWED_PATH_PREFIXES = ['lib/brand/', 'lib/tenant/constants.ts']

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

function isAllowedPath(relPath) {
  return ALLOWED_PATH_PREFIXES.some((prefix) => relPath.startsWith(prefix))
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

function makeKey(violation) {
  return `${violation.file}|${violation.snippet}`
}

function findViolations() {
  const violations = []

  for (const scanDir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, scanDir))) {
      const rel = normalize(path.relative(ROOT, file))

      if (isTestFile(rel) || isAllowedPath(rel)) continue

      const lines = fs.readFileSync(file, 'utf8').split('\n')

      lines.forEach((line, index) => {
        if (!BRAND_PATTERN.test(stripIgnoredTokens(line))) return

        violations.push({
          file: rel,
          line: index + 1,
          snippet: line.trim(),
        })
      })
    }
  }

  return violations
}

function writeBaseline(violations) {
  const keys = violations.map(makeKey).sort()
  const header = [
    '# Hardcoded brand copy that pre-dates tenant-resolved branding (WS-6).',
    '# Migrate these to lib/brand and shrink the list; never add entries.',
  ]

  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(BASELINE_PATH, `${header.join('\n')}\n${keys.join('\n')}\n`)

  console.log(
    `check-no-hardcoded-brand-strings: baseline updated with ${keys.length} entries`,
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
  const newViolations = violations.filter((v) => !baseline.has(makeKey(v)))
  const currentKeys = new Set(violations.map(makeKey))
  const resolved = [...baseline].filter((entry) => !currentKeys.has(entry))

  if (newViolations.length > 0) {
    console.error('\ncheck-no-hardcoded-brand-strings: failed\n')
    console.error(
      'User-facing brand copy must come from lib/brand (tenant-resolved), not hardcoded TOVIS strings.\n',
    )

    for (const violation of newViolations) {
      console.error(`${violation.file}:${violation.line}`)
      console.error(`  ${violation.snippet}`)
    }

    console.error(`\nFound ${newViolations.length} new violations.`)
    console.error(`Known baseline entries: ${baseline.size}`)
    process.exit(1)
  }

  console.log(
    `check-no-hardcoded-brand-strings: passed (${baseline.size} known baseline entries)`,
  )

  if (resolved.length > 0) {
    console.log(`${resolved.length} baseline entries are now resolved.`)
    console.log('Run with --update-baseline to remove resolved entries.')
  }
}

main()
