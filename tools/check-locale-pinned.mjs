// tools/check-locale-pinned.mjs
//
// Display-locale single-source-of-truth guard.
//
// `check:no-raw-datetime-format` already forces every date formatter through
// `lib/time`, so an appointment can never silently render in the SERVER's
// timezone. The locale is the same axis and had no rule at all:
//
//   new Intl.DateTimeFormat(undefined, …)   ← the RUNTIME decides
//   value.toLocaleString()                  ← the RUNTIME decides
//
// "The runtime" is `LANG`/`LC_ALL` on the server and the VISITOR's browser
// locale in the client bundle — so one node can render two different strings
// either side of hydration. Driven in a real browser on `origin/main`, with a
// clean en-US-vs-en-US null control over 1673 paired text nodes, an `en-GB`
// visitor was served "Wed 8 Jul, 13:00" where a US one saw
// "Wed, Jul 8, 1:00 PM", and a `fr-FR` visitor got "dim. 16 août" inside an
// otherwise English sentence.
//
// So, in app/ and lib/:
//
//   1. no BCP-47 locale literal outside lib/locale.ts — import DISPLAY_LOCALE
//   2. no display formatter with an omitted or `undefined` locale
//
// The `lib/time` display helpers already default their `locale` argument to
// DISPLAY_LOCALE, so the fix at a call site is usually to delete an argument
// rather than add one.
//
// The baseline is NOT a to-do list. Both entries are machine formatters whose
// output never reaches a screen, where a locale is a required positional
// argument rather than a display choice. Entries carry an occurrence COUNT, so
// a THIRD literal appearing in an already-baselined file still fails.
//
// Usage:
//   node tools/check-locale-pinned.mjs
//   node tools/check-locale-pinned.mjs --update-baseline

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const BASELINE_PATH = path.join(ROOT, 'tools/baselines/locale-pinned.txt')

const SCAN_DIRS = ['app', 'lib']

/** lib/locale.ts holds the one literal; everything else imports it. */
const ALLOWED_PREFIXES = ['lib/locale.ts']

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
 * A guard that reads comments reports prose as code — this repo has been
 * bitten by it three times now, most recently by check-brand-resolution
 * flagging the file whose comment said "Do NOT swap this for getBrandConfig()".
 * This guard's own docstring quotes `Intl.DateTimeFormat(undefined, …)` and
 * two locale literals, so it would be its own first violation.
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

/**
 * A BCP-47 language tag written as a literal: 'en-US', 'en-CA',
 * 'en-US-u-hc-h23'. A bare 'en' is deliberately NOT matched — two letters in
 * quotes is any string in the language, and the false positives would drown
 * the signal.
 */
const LOCALE_LITERAL = /'[a-z]{2,3}-[A-Z]{2}(?:-[A-Za-z0-9-]+)?'/g

/**
 * A display formatter whose locale argument is missing or explicitly
 * `undefined`, i.e. one that asks the runtime to choose.
 *
 * `Intl.DateTimeFormat().resolvedOptions()` (no `new`) is NOT matched: that
 * reads the viewer's timezone and formats nothing.
 */
const UNPINNED_FORMATTER =
  /(?:new\s+Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|ListFormat|PluralRules|Collator|DisplayNames|Segmenter)|\.toLocaleString|\.toLocaleDateString|\.toLocaleTimeString)\s*\(\s*(?:\)|undefined\b)/g

/** Every locale violation in one file, comments excluded. */
export function scanSource(relPath, source) {
  const violations = []

  stripComments(source)
    .split('\n')
    .forEach((line, index) => {
      for (const m of line.matchAll(LOCALE_LITERAL)) {
        violations.push({
          file: relPath,
          line: index + 1,
          kind: 'literal',
          token: m[0],
        })
      }

      for (const m of line.matchAll(UNPINNED_FORMATTER)) {
        violations.push({
          file: relPath,
          line: index + 1,
          kind: 'unpinned',
          token: m[0].replace(/\s+/g, ''),
        })
      }
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

/**
 * Baseline entries are `file|kind|token|count`, not `file:line`.
 *
 * A line number moves whenever anything above it does, and a baseline that
 * churns on unrelated edits gets updated without being read. Keying by FILE
 * alone would be worse in the other direction: a third `'en-US'` added to an
 * already-baselined file would inherit the exemption. The count closes that.
 */
const groupKey = (v) => `${v.file}|${v.kind}|${v.token}`

export function summarize(violations) {
  const counts = new Map()

  for (const v of violations) {
    counts.set(groupKey(v), (counts.get(groupKey(v)) ?? 0) + 1)
  }

  return new Map([...counts].map(([k, n]) => [k, `${k}|${n}`]))
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

function writeBaseline(violations) {
  const entries = [...summarize(violations).values()].sort()

  const header = [
    '# Locale literals and unpinned formatters that are NOT display decisions.',
    '#',
    '# NOT a to-do list. Each entry is a MACHINE formatter: the locale is a',
    '# required positional argument whose output is parsed or discarded, never',
    '# read by a person. Migrating one would be a no-op at best.',
    '#',
    "#   lib/timeZone.ts | 'en-US'          — isValidIanaTimeZone builds a",
    '#   formatter purely to see whether the constructor throws. The result is',
    '#   a boolean; the formatted string is discarded.',
    '#',
    "#   lib/timeZone.ts | 'en-US-u-hc-h23' — getZonedParts pins the 24-hour",
    '#   cycle through a locale extension and reads formatToParts to get',
    '#   numeric Y/M/D/h/m/s. This is the timezone MATH engine; a display',
    '#   locale here would change what the parser sees.',
    '#',
    '# Format: file|kind|token|count. The count is load-bearing — a THIRD',
    '# literal in one of these files must still fail. See',
    '# tools/check-locale-pinned.mjs.',
    '',
  ]

  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(BASELINE_PATH, `${header.join('\n')}${entries.join('\n')}\n`)

  console.log(`check-locale-pinned: baseline updated with ${entries.length} entries`)
}

function main() {
  const violations = findViolations()
  const current = summarize(violations)
  const baseline = readBaseline()

  if (process.argv.includes('--update-baseline')) {
    writeBaseline(violations)
    return
  }

  const fresh = [...current.entries()].filter(([, entry]) => !baseline.has(entry))
  const resolved = [...baseline].filter((entry) => ![...current.values()].includes(entry))

  if (fresh.length > 0) {
    console.error('\ncheck-locale-pinned: failed\n')
    console.error(
      'An omitted or hardcoded locale is decided by the RUNTIME — the server\'s LANG,',
    )
    console.error(
      "and the VISITOR's browser locale in the client bundle. Use the app's one:\n",
    )
    console.error("  import { DISPLAY_LOCALE } from '@/lib/locale'\n")
    console.error(
      'The lib/time display helpers already default to it, so the fix at a date',
    )
    console.error('call site is usually to DELETE the locale argument.\n')

    for (const [key] of fresh) {
      const [file, kind, token] = key.split('|')
      const lines = violations
        .filter((v) => groupKey(v) === key)
        .map((v) => v.line)
        .join(', ')
      console.error(`${file}:${lines}  ${kind}  ${token}`)
    }

    console.error(`\nFound ${fresh.length} new group(s).`)
    console.error(`Known baseline entries: ${baseline.size}`)
    process.exit(1)
  }

  console.log(`check-locale-pinned: passed (${baseline.size} known baseline entries)`)

  if (resolved.length > 0) {
    console.log(`${resolved.length} baseline entries are now resolved.`)
    console.log('Run with --update-baseline to remove resolved entries.')
  }
}

// Only sweep the repo when this file IS the command; the detector above is
// imported by check-locale-pinned.test.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
