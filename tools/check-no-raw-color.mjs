// tools/check-no-raw-color.mjs
//
// White-label colour guard (cleanup register, phase 7).
//
// Every colour a user sees must resolve through a `[data-mode]`-aware token, so
// that light mode is a real mode and a white-label tenant can restyle the app.
// A raw colour is blind to the mode: it renders the same in both, which means
// it is wrong in at least one of them.
//
// Four shapes are flagged:
//
//   1. Raw `white`/`black` Tailwind utilities — `border-white/10`, `bg-black/70`.
//      `border-white/10` is a near-no-op in dark (the paper token is 242,239,231
//      against 255,255,255) and effectively INVISIBLE in light, where a white
//      hairline sits on a #F3F0E7 page. Use `border-surfaceGlass/10`,
//      `bg-surfaceGlass/N`, `bg-overlay/N` for scrims, `text-onCta` on the CTA
//      gradient.
//
//   2. Numeric `rgb()` / `rgba()` in class strings and inline styles. Note the
//      digit in the pattern: `rgb(var(--token))` is the COMPLIANT form and is
//      deliberately not matched.
//
//   3. The alpha-INSIDE-the-arbitrary-bracket shape,
//      `border-[rgb(var(--tone-success))/0.25]`. This one is not a style
//      preference, it is a BUG: it emits `border-color: rgb(var(--x))/.25`,
//      which is invalid CSS, so the browser drops the declaration entirely and
//      the element renders with `currentColor` / `transparent`. Typecheck, lint
//      and every other guard pass on it. Write `border-toneSuccess/25`.
//
//   4. A token handed to `rgba()` with a COMMA before the alpha,
//      `rgba(var(--accent-primary), 0.25)`. Same failure as 3 from the other
//      side: a token is three space-separated channels, so this expands to
//      `rgba(10 115 99, 0.25)` and the browser drops the declaration. It cost
//      /search's location field its whole focus treatment. Write
//      `rgb(var(--accent-primary)/0.25)`.
//
// ── Two traps this guard is built to avoid ────────────────────────────────
//
// COMMENTS ARE NOT CODE. `check:no-bare-tint-token` has twice failed on the
// prose of a comment explaining a fix, and a naive hex sweep here flagged the PR
// references `#829` / `#919`. Comments are stripped before matching — with the
// newlines preserved, so reported line numbers stay true (a previous sweep in
// this programme dropped newlines inside `/* */` and every line number after one
// drifted, which read as a false positive in a correctly-migrated file).
//
// Tailwind also scans comments for class candidates, so a broken class written
// out in a docstring ships a real, permanently dead rule into the stylesheet.
// Stripping comments here means this guard will not stop that; it is called out
// at the one site where it happened.
//
// ── Scope ─────────────────────────────────────────────────────────────────
//
// `.ts`/`.tsx` under app/ and lib/, matching the other 21 guards. `.css` is out
// of scope on purpose: `lib/brand/brand.css` and `app/globals.css` are where the
// tokens are DEFINED, so raw colour is correct there, and the only raw-colour
// match anywhere else in CSS is `proLastMinute.css`'s `[class*="border-white"]`
// shim selector — a class-name match, not a colour.
//
// Test files are skipped: a test that pins a shipped class string as a literal
// is doing its job, and rewriting the pin to a token would make it read the
// module under test.
//
// Usage:
//   node tools/check-no-raw-color.mjs
//   node tools/check-no-raw-color.mjs --update-baseline

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const BASELINE_PATH = path.join(ROOT, 'tools/baselines/no-raw-color.txt')

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

const UTILITY_PREFIXES = [
  'bg',
  'text',
  'border',
  'ring',
  'fill',
  'stroke',
  'shadow',
  'divide',
  'outline',
  'from',
  'via',
  'to',
  'placeholder',
  'decoration',
  'accent',
  'caret',
].join('|')

// A leading variant chain (`hover:`, `focus-visible:`, `md:`, `data-[open]:`,
// `group-hover:`) is consumed so the match starts at the utility itself.
const RAW_UTILITY = new RegExp(
  `(?<![\\w-])(?:[a-z][a-z0-9-]*(?:-\\[[^\\]]*\\])?:)*(?:${UTILITY_PREFIXES})-(?:white|black)(?:\\/[0-9.]+)?(?![\\w-])`,
  'g',
)

// The digit after the paren is load-bearing: `rgb(var(--bg-primary))` is the
// compliant form and must not match. The rest of the call is consumed only so
// the reported match reads as a colour rather than as `rgba(0`.
//
// ⚠️ The closing paren is OPTIONAL, and that is not sloppiness. Requiring it
// silently dropped `rgba(255, 255, 255, ${run.alpha})` — a real hit in
// socialExportRender.ts — because the `${` ends the numeric run before the
// paren ever arrives. Held by a test.
//
// ⚠️ The left edge is `(?<![a-zA-Z0-9])`, NOT `\b`. Underscore is a word
// character, and Tailwind arbitrary values spell spaces as underscores — so
// `shadow-[0_10px_30px_rgba(0,0,0,0.35)]` has no word boundary before `rgba`
// and `\b` skipped it silently. That is the repo's standard shadow shape and
// the register's prescribed `shadows -> rgb(var(--shadow-color)/…)` family, so
// the guard had been blind to the whole of it. Held by a test.
const NUMERIC_RGB = /(?<![a-zA-Z0-9])rgba?\(\s*[0-9.][0-9.,%/\s]*\)?/g

const ALPHA_IN_BRACKET =
  /(?<![\w-])(?:bg|text|border|ring|fill|stroke|shadow|outline|divide)-\[rgb\(var\(--[a-z0-9-]+\)\)\/[0-9.]+\]/g

// The same bug wearing the other trouser leg: a token is three SPACE-separated
// channels, so `rgba(var(--accent-primary), 0.25)` expands to
// `rgba(10 115 99, 0.25)` — space-separated components with a comma before the
// alpha, which is not valid CSS in either syntax. The browser drops the whole
// declaration.
//
// Measured on `origin/main`: /search's location field carried this inside a
// `focus-within:shadow-[…]`, and focusing it computed `box-shadow: none` — the
// field LOST its resting inset highlight and gained no focus ring. Invisible to
// typecheck, lint, 22 guards and 9164 tests, and invisible to NUMERIC_RGB too,
// because the digit that pattern requires never arrives: `var(` follows the
// paren. Write `rgb(var(--accent-primary)/0.25)`. Held by a test.
const COMMA_ALPHA_ON_VAR =
  /(?<![a-zA-Z0-9])rgba?\(\s*var\(--[a-z0-9-]+\)\s*,\s*[0-9.]+\s*\)/g

// Replace comment bodies with spaces, keeping every newline, so offsets in the
// stripped text are offsets in the original. String literals are copied
// verbatim and escapes are honoured, so an apostrophe inside a comment can
// never open a phantom string and swallow the rest of a tag.
export function stripComments(src) {
  let out = ''
  let i = 0
  let mode = 'code'
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (mode === 'code') {
      if (c === '/' && d === '/') {
        mode = 'line'
        out += '  '
        i += 2
        continue
      }
      if (c === '/' && d === '*') {
        mode = 'block'
        out += '  '
        i += 2
        continue
      }
      if (c === "'" || c === '"' || c === '`') {
        mode = c
        out += c
        i += 1
        continue
      }
      out += c
      i += 1
      continue
    }
    if (mode === 'line') {
      if (c === '\n') {
        mode = 'code'
        out += '\n'
      } else {
        out += ' '
      }
      i += 1
      continue
    }
    if (mode === 'block') {
      if (c === '*' && d === '/') {
        mode = 'code'
        out += '  '
        i += 2
        continue
      }
      out += c === '\n' ? '\n' : ' '
      i += 1
      continue
    }
    // inside a string literal
    if (c === '\\') {
      out += c + (d ?? '')
      i += 2
      continue
    }
    if (c === mode) mode = 'code'
    out += c
    i += 1
  }
  return out
}

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

// pdf-lib exports its own `rgb()`, which takes three 0-1 FLOATS and paints into
// a PDF. It is not CSS, there is no [data-mode] inside a PDF, and a token would
// not even typecheck there. Flagging it would not be style debt on the worklist,
// it would be a category error inflating the count.
function usesPdfLibColor(src) {
  return /from\s+['"]pdf-lib['"]/.test(src)
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

// The whole detector for ONE file, kept pure so it can be probed directly with
// a case that must fail and a case that must pass. Returns one entry per source
// LINE (a line can carry several raw colours), each listing every match on it.
// Throws if comment-stripping moved a byte — a caller must not get line numbers
// it cannot trust.
export function scanSource(relPath, src) {
  const stripped = stripComments(src)
  if (stripped.length !== src.length) {
    throw new Error(
      `comment-stripping changed the length of ${relPath} ` +
        `(${src.length} -> ${stripped.length}); line numbers would be unreliable`,
    )
  }

  const srcLines = src.split('\n')
  const lineStarts = [0]
  for (let i = 0; i < stripped.length; i += 1) {
    if (stripped[i] === '\n') lineStarts.push(i + 1)
  }
  const lineOf = (index) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  const seen = new Map()
  const record = (kind, match) => {
    const line = lineOf(match.index)
    if (!seen.has(line)) {
      seen.set(line, {
        file: relPath,
        line,
        kind,
        matches: [],
        snippet: (srcLines[line - 1] ?? '').trim(),
      })
    }
    const entry = seen.get(line)
    // Trailing separators survive when an interpolation cut the match short.
    entry.matches.push(match[0].replace(/[\s,]+$/, ''))
    // A dropped declaration outranks a mode-blind one when reporting.
    if (kind === 'alpha-in-bracket' || kind === 'comma-alpha-on-var') entry.kind = kind
  }

  for (const m of stripped.matchAll(ALPHA_IN_BRACKET)) record('alpha-in-bracket', m)
  for (const m of stripped.matchAll(COMMA_ALPHA_ON_VAR)) record('comma-alpha-on-var', m)
  for (const m of stripped.matchAll(RAW_UTILITY)) record('raw-utility', m)
  for (const m of stripped.matchAll(NUMERIC_RGB)) record('numeric-rgb', m)

  return [...seen.values()].sort((a, b) => a.line - b.line)
}

function findViolations() {
  const violations = []
  let alignmentFailures = 0

  for (const scanDir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, scanDir))) {
      const rel = normalize(path.relative(ROOT, file))
      if (isTestFile(rel)) continue

      const src = fs.readFileSync(file, 'utf8')
      if (usesPdfLibColor(src)) continue

      try {
        violations.push(...scanSource(rel, src))
      } catch (error) {
        console.error(`check-no-raw-color: ${error.message}`)
        alignmentFailures += 1
      }
    }
  }

  if (alignmentFailures > 0) {
    console.error(
      `\ncheck-no-raw-color: ${alignmentFailures} file(s) failed the ` +
        'comment-stripping self-check. Refusing to report possibly-wrong lines.',
    )
    process.exit(2)
  }

  return violations
}

function makeKey(violation) {
  return `${violation.file}|${violation.snippet}`
}

function occurrenceCount(violations) {
  return violations.reduce((sum, v) => sum + v.matches.length, 0)
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
  const keys = [...new Set(violations.map(makeKey))].sort()
  const header = [
    '# Raw colours that pre-date the token system — the phase-7 migration worklist.',
    '#',
    '# One entry per SOURCE LINE, not per occurrence: a single line can carry',
    `# several (\`'bg-black/45 text-white hover:bg-black/60'\`). At the time this`,
    `# baseline was written that was ${keys.length} lines carrying`,
    `# ${occurrenceCount(violations)} raw colours.`,
    '#',
    '# Shrink this list; never add to it. Replacements:',
    '#   border-white/N  -> border-surfaceGlass/N   (invisible in light mode today)',
    '#   bg-white/N      -> bg-surfaceGlass/N',
    '#   bg-black/N      -> bg-overlay/N            (modal scrims ONLY)',
    '#   rgba(0,0,0,a)   -> rgb(var(--shadow-color) / a)',
    '#',
    '# ⚠️ NOT every entry should be migrated. Three classes below are PERMANENT',
    '# residents — they are raw on purpose, and "fixing" them is the regression:',
    '#',
    '#   1. Anything painted on a PHOTOGRAPH. A photo is dark in both modes, so',
    '#      its scrim, caption chip and overlay text must be too. Includes',
    '#      MediaFullscreenViewer, LookSlide, SheetCover, the media letterboxes',
    '#      in MediaUploader / ImageEditModal / NewMediaPostForm.',
    '#   2. Anything rendered to an IMAGE rather than to the DOM. An exported PNG',
    '#      carries no [data-mode]: lib/media/socialExportRender.ts composites on',
    '#      a <canvas> and its colours are the artwork.',
    '#   3. The BRAND MARK. lib/brand/brand.css keeps --on-cta and the --coin-*',
    '#      stops constant across modes on purpose (the feather is drawn to read',
    '#      on a dark disc); TovisFeatherMark and lib/brand/eyeSvg.ts are the same',
    '#      artwork. Their drift is phase 8 of the register, not a colour swap.',
    '#',
    '# Classify by what the class lands on before touching it.',
  ]
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(BASELINE_PATH, `${header.join('\n')}\n${keys.join('\n')}\n`)
  console.log(
    `check-no-raw-color: baseline updated with ${keys.length} entries ` +
      `(${occurrenceCount(violations)} raw colours)`,
  )
}

function main() {
  if (process.argv.includes('--update-baseline')) {
    writeBaseline(findViolations())
    return
  }

  const violations = findViolations()
  const baseline = readBaseline()
  const newViolations = violations.filter((v) => !baseline.has(makeKey(v)))
  const currentKeys = new Set(violations.map(makeKey))
  const resolved = [...baseline].filter((entry) => !currentKeys.has(entry))

  // Both of these are invalid CSS that the browser drops, not a style
  // preference, so they fail even when the line is already baselined.
  const dropped = violations.filter((v) => v.kind === 'alpha-in-bracket')
  const varAlpha = violations.filter((v) => v.kind === 'comma-alpha-on-var')

  if (newViolations.length > 0 || dropped.length > 0 || varAlpha.length > 0) {
    console.error('\ncheck-no-raw-color: failed\n')

    if (varAlpha.length > 0) {
      console.error(
        'These pass a TOKEN to rgba() with a comma before the alpha. A token is\n' +
          'three space-separated channels, so this expands to `rgba(10 115 99, .25)`\n' +
          '— invalid in either CSS syntax, and the browser drops the whole\n' +
          'declaration. Write `rgb(var(--accent-primary)/0.25)` instead.\n',
      )
      for (const v of varAlpha) {
        console.error(`${v.file}:${v.line}`)
        console.error(`  ${v.snippet}`)
      }
      console.error('')
    }

    if (dropped.length > 0) {
      console.error(
        'These put the alpha INSIDE the arbitrary bracket. That emits invalid\n' +
          'CSS, so the browser drops the declaration and the element renders with\n' +
          'currentColor / transparent. Write `border-toneSuccess/25` instead.\n',
      )
      for (const v of dropped) {
        console.error(`${v.file}:${v.line}`)
        console.error(`  ${v.snippet}`)
      }
      console.error('')
    }

    if (newViolations.length > 0) {
      console.error(
        'Raw colours are blind to [data-mode]: they render identically in light\n' +
          'and dark, so they are wrong in at least one of them. Use a token.\n',
      )
      for (const v of newViolations) {
        console.error(`${v.file}:${v.line}  [${[...new Set(v.matches)].join(' ')}]`)
        console.error(`  ${v.snippet}`)
      }
      console.error(`\nFound ${newViolations.length} new violations.`)
    }

    console.error(`Known baseline entries: ${baseline.size}`)
    process.exit(1)
  }

  console.log(
    `check-no-raw-color: passed (${baseline.size} known baseline entries, ` +
      `${occurrenceCount(violations)} raw colours)`,
  )

  if (resolved.length > 0) {
    console.log(`${resolved.length} baseline entries are now resolved.`)
    console.log('Run with --update-baseline to remove resolved entries.')
  }
}

// Run only as the entry point, so the test can import the detector without the
// guard scanning the repo and calling process.exit() on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
