// tools/check-no-raw-datetime-format.mjs
//
// Time/timezone single-source-of-truth guard.
//
// All date/time formatting and timezone math must go through the helper layer
// re-exported from `lib/time` (lib/timeZone, lib/formatInTimeZone,
// lib/bookingTime, lib/booking/dateTime, lib/booking/timeZoneTruth). Those
// helpers sanitize the timezone and force an explicit `timeZone`, so an
// appointment never silently renders in the server's zone (UTC on Vercel).
//
// Raw `Intl.DateTimeFormat(...)` / `.toLocaleDateString` / `.toLocaleTimeString`
// / date-shaped `.toLocaleString(...)` calls outside the helper layer bypass
// that and are the source of timezone drift, so new ones fail the check.
// Existing occurrences are baselined as a migration worklist; migrate them to
// `@/lib/time` and shrink the list — never add entries.
//
// Number formatting via `.toLocaleString()` is intentionally NOT flagged: the
// call-site heuristic only matches date/time usage (date-option keywords or a
// `new Date(...)` receiver), so `count.toLocaleString()` stays allowed.
//
// Usage:
//   node tools/check-no-raw-datetime-format.mjs
//   node tools/check-no-raw-datetime-format.mjs --update-baseline

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const BASELINE_PATH = path.join(
  ROOT,
  'tools/baselines/no-raw-datetime-format.txt',
)

// Always-flag patterns: these never format numbers.
//  - Intl.DateTimeFormat(...)            (formatting AND resolvedOptions().timeZone)
//  - .toLocaleDateString( / .toLocaleTimeString(
const ALWAYS_FLAG_PATTERN =
  /Intl\.DateTimeFormat|\.toLocaleDateString\(|\.toLocaleTimeString\(/

// `.toLocaleString(` is ambiguous (numbers vs dates). Only flag it when the
// call-site is date-shaped — see isDateShapedToLocaleString below.
const TO_LOCALE_STRING_PATTERN = /\.toLocaleString\(/

// Date/time option keys that mark a toLocaleString/Intl call as date formatting.
const DATE_OPTION_KEYWORD =
  /\b(timeZone|timeZoneName|weekday|era|year|month|day|hour|minute|second|dateStyle|timeStyle|hour12|hourCycle|fractionalSecondDigits)\b/

// A `new Date(...)` receiver on the same line is a strong date signal.
const NEW_DATE_RECEIVER = /new Date\([^)]*\)\s*\.toLocaleString\(/

const ALLOWED_PATH_PREFIXES = [
  'lib/time/', // the facade + relative-time helper
  'lib/timeZone.ts', // timezone math engine (single source of truth)
  'lib/formatInTimeZone.ts', // sanitized display formatters
  'lib/bookingTime.ts', // booking-edge time helpers
  'lib/bookingDateTimeClient.ts', // client input <-> UTC helpers
  'lib/booking/dateTime.ts', // datetime-local <-> UTC + local-day bounds
  'lib/booking/timeZoneTruth.ts', // which-timezone-wins resolver
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

// `.toLocaleString(` is only a violation when it formats a date. We treat it as
// date-shaped when the receiver is `new Date(...)` OR the call window (this
// line plus the next few, to cover multi-line option objects) contains a
// date/time option key. Number calls — `count.toLocaleString()`,
// `Math.round(n).toLocaleString()` — have neither and are left alone.
function isDateShapedToLocaleString(lines, index) {
  const line = lines[index]
  if (NEW_DATE_RECEIVER.test(line)) return true

  const windowText = lines.slice(index, index + 4).join('\n')
  return DATE_OPTION_KEYWORD.test(windowText)
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
        const flagged =
          ALWAYS_FLAG_PATTERN.test(line) ||
          (TO_LOCALE_STRING_PATTERN.test(line) &&
            isDateShapedToLocaleString(lines, index))

        if (!flagged) return

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
  const keys = [...new Set(violations.map(makeKey))].sort()
  const header = [
    '# Raw date/time formatting that pre-dates the lib/time single source of truth.',
    '# Migrate these to @/lib/time helpers and shrink the list; never add entries.',
  ]

  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(BASELINE_PATH, `${header.join('\n')}\n${keys.join('\n')}\n`)

  console.log(
    `check-no-raw-datetime-format: baseline updated with ${keys.length} entries`,
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
    console.error('\ncheck-no-raw-datetime-format: failed\n')
    console.error(
      'Format dates/times via @/lib/time (sanitized + explicit timeZone), not raw\n' +
        'Intl.DateTimeFormat / toLocaleDateString / toLocaleTimeString / date toLocaleString.\n',
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
    `check-no-raw-datetime-format: passed (${baseline.size} known baseline entries)`,
  )

  if (resolved.length > 0) {
    console.log(`${resolved.length} baseline entries are now resolved.`)
    console.log('Run with --update-baseline to remove resolved entries.')
  }
}

main()
