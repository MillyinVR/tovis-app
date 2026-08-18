// tools/check-no-unbracketed-arbitrary-value.mjs
//
// Unbracketed-arbitrary-value guard (client-parity audit finding #1,
// docs/design/client-parity-brief.md §0).
//
// Tailwind requires bracket syntax for an arbitrary value — `max-w-[420px]`.
// Writing the value without brackets, `max-w-420px`, is not a smaller or
// looser form of the same utility: Tailwind's class scanner does not
// recognise it as a utility pattern at all, so it emits ZERO CSS. The
// class still typechecks, still lints, and still LOOKS like a width cap in
// the JSX — it silently does nothing. This exact typo shipped ten times
// across the client auth flow, the Looks feed, the admin shell, and a pro
// settings page (all confirmed dead against the compiled `.next` CSS output
// before the fix) before anything caught it.
//
// Scope is deliberately the box-model utilities (size / position / spacing)
// where a raw pixel figure is the natural thing to type by hand — width,
// height, inset, gap, padding, margin, translate. Font-size, radius and
// other categories aren't included: no confirmed instance of this bug has
// occurred there, and each additional prefix is another chance to snag a
// legitimate non-Tailwind identifier. Grow the list only against a real
// hit, the same way the raw-color guard's shapes were each earned by an
// actual bug.
//
// The unit list (px/rem/em/vh/vw/%) is wider than the confirmed bug (all
// ten hits were `px`) on purpose — the failure mode is "value has no
// brackets", not "value happens to be in pixels", and Tailwind drops the
// class identically regardless of which unit the typo used.
//
// No baseline: the audit fixed every confirmed instance in the same change
// that adds this guard, so the starting count is zero and stays zero.
//
// Usage:
//   node tools/check-no-unbracketed-arbitrary-value.mjs

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const SCAN_DIRS = ['app', 'lib']
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx'])
const IGNORE_DIRS = new Set([
  '.git',
  '.next',
  '.claude',
  'node_modules',
  'dist',
  'build',
  'coverage',
])

// Longest-prefix-first so `max-w` matches before a bare `w` could steal it.
const PREFIXES = [
  'max-w',
  'max-h',
  'min-w',
  'min-h',
  'size',
  'w',
  'h',
  'inset-x',
  'inset-y',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'gap-x',
  'gap-y',
  'gap',
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'p',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'm',
  'translate-x',
  'translate-y',
].sort((a, b) => b.length - a.length)

const UNITS = ['px', 'rem', 'em', 'vh', 'vw', '%']

// A leading variant chain (`hover:`, `md:`, `data-[open]:`) is consumed so
// the match starts at the utility itself, matching check-no-raw-color's
// RAW_UTILITY shape. The left edge (`(?<![\w-])`) and right edge
// (`(?![\w-])`) keep this from matching mid-identifier or mid-calc() — a
// bracketed `calc(100vw-24px)` has no bracket immediately after the prefix,
// so `w-[min(380px,calc(100vw-24px))]` never reaches this pattern at all:
// the `-24px` there is preceded by `vw`, which isn't in PREFIXES.
const UNBRACKETED_ARBITRARY = new RegExp(
  `(?<![\\w-])(?:[a-z][a-z0-9-]*(?:-\\[[^\\]]*\\])?:)*(?:${PREFIXES.join('|')})-[0-9]+(?:\\.[0-9]+)?(?:${UNITS.join('|')})(?![\\w-])`,
  'g',
)

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
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) files.push(...walk(fullPath))
      continue
    }
    if (entry.isFile() && TARGET_EXTENSIONS.has(path.extname(fullPath))) {
      files.push(fullPath)
    }
  }
  return files
}

// The whole detector for ONE file, kept pure so it can be probed directly
// with a case that must fail and a case that must pass.
export function scanSource(relPath, src) {
  const violations = []
  const lines = src.split('\n')

  lines.forEach((line, index) => {
    UNBRACKETED_ARBITRARY.lastIndex = 0
    let match
    const seen = new Set()
    while ((match = UNBRACKETED_ARBITRARY.exec(line)) !== null) {
      seen.add(match[0])
    }
    if (seen.size > 0) {
      violations.push({
        file: relPath,
        line: index + 1,
        snippet: line.trim(),
        matches: [...seen],
      })
    }
  })

  return violations
}

function findViolations() {
  const violations = []

  for (const scanDir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, scanDir))) {
      const rel = normalize(path.relative(ROOT, file))
      if (isTestFile(rel)) continue

      const src = fs.readFileSync(file, 'utf8')
      violations.push(...scanSource(rel, src))
    }
  }

  return violations
}

function main() {
  const violations = findViolations()

  if (violations.length > 0) {
    console.error('\ncheck-no-unbracketed-arbitrary-value: failed\n')
    console.error(
      'Tailwind requires brackets around an arbitrary value — `max-w-420px`\n' +
        'generates NO CSS at all (silently dead), while `max-w-[420px]` compiles\n' +
        'correctly. Add the brackets.\n',
    )

    for (const v of violations) {
      console.error(`${v.file}:${v.line}  [${v.matches.join(', ')}]`)
      console.error(`  ${v.snippet}`)
    }

    console.error(`\nFound ${violations.length} unbracketed arbitrary-value class(es).`)
    process.exit(1)
  }

  console.log('check-no-unbracketed-arbitrary-value: passed (no unbracketed arbitrary values found)')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
