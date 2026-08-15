// tools/check-no-private-lib-fork.mjs
//
// "No duplicate logic" — the half a machine can check.
//
// The house rule says search for an existing helper before writing one. Nothing
// enforced it, so helpers were re-typed per component instead of imported:
// `currentPathWithQuery` ×12, `pad2` ×8, `isRecord` ×8, `resolveCookieDomain` ×6,
// `clamp` ×6, `formatDate` ×10, roughly twenty error-message readers under six
// different names. PR #904 consolidated them; this guard is what stops the next
// copy from landing.
//
// The rule: a file may not declare a PRIVATE top-level `function`/`const` whose
// name a CANONICAL DIR already exports as a value. Import the canonical instead
// — or, if the two genuinely mean different things, give yours a different name,
// because two same-named helpers with different behaviour is the more expensive
// bug. (`lib/auth/verification.ts` exported a `pickString` returning `''` while
// `lib/pick.ts` exported one returning `null`. Both compiled; `if (!x)` hid the
// difference at every call site.)
//
// Phase 6 added the UI kit (`app/_components/ui`) as a second canonical dir. The
// same rot had happened there in visual form: `FieldLabel` ×10, `Select` ×7,
// `Card` ×5 re-authored per screen, each with its own class strings — and those
// class strings are where most of the app's raw colors live. Two of them wrote
// `border-[rgb(var(--micro-accent))/0.35]`, where the alpha inside the bracket
// makes the declaration invalid CSS, so the browser dropped it and the element
// rendered unstyled. Nothing caught that for as long as it existed.
//
// The export list is DERIVED from those dirs on every run, so a helper promoted
// into one starts being enforced the moment it is exported — no list to update
// here. Both export FORMS are read: direct (`export function X`) and barrel
// re-export (`export { default as X } from './X'`), because the UI kit exposes
// everything through the second and a matcher that knows only the first would
// see an empty kit and pass vacuously.
//
// NOT flagged: exported declarations (a second module deliberately exposing a
// name is a different smell, and re-exports are legitimate), types/interfaces
// (`Props` and friends collide constantly and harmlessly), anything nested
// inside a function, and test files.
//
// Usage:
//   node tools/check-no-private-lib-fork.mjs

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const BASELINE_PATH = path.join(ROOT, 'tools/baselines/no-private-lib-fork.txt')

const SCAN_DIRS = ['app', 'lib']

// Where canonical VALUES live. `lib/` is the helper layer; `app/_components/ui`
// is the UI kit — Button/Card/Badge/Avatar and the form controls. Both were
// being re-typed per screen, and until phase 6 only the first half was checked.
const CANONICAL_DIRS = ['lib', 'app/_components/ui']
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx'])
const IGNORE_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.claude',
])

// Names too generic to be worth a shared import — a local `format`/`parse` is
// not a fork of anything, it just shares four letters with one.
const IGNORED_NAMES = new Set(['format', 'parse', 'render', 'noop', 'main'])

function normalize(p) {
  return p.split(path.sep).join('/')
}

function isTestFile(rel) {
  return (
    rel.includes('.test.') ||
    rel.includes('.spec.') ||
    rel.includes('/__tests__/')
  )
}

function walk(dir) {
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    .filter((file) => TARGET_EXTENSIONS.has(path.extname(file)))
    .filter(
      (file) =>
        !normalize(path.relative(ROOT, file))
          .split('/')
          .some((segment) => IGNORE_DIRS.has(segment)),
    )
}

/**
 * Names re-exported by a barrel: `export { A, default as B, C as D } from './x'`.
 * The UI kit's index.ts exposes EVERYTHING this way, so a matcher that only knows
 * `export function`/`export const` sees an empty kit and passes vacuously — which
 * is exactly what widening SCAN_DIRS alone would have shipped.
 *
 * Only the LOCAL name matters (what a fork would collide with): in
 * `default as Button` that is `Button`, in `buttonClassName` it is itself. Type
 * re-exports (`export type { … }`) are skipped, same as the rest of the guard.
 */
function readReExportedNames(source) {
  const names = []

  const re = /^export\s+\{([^}]*)\}\s*from\s*['"]/gm
  for (const match of source.matchAll(re)) {
    for (const clause of match[1].split(',')) {
      const parts = clause.trim().split(/\s+as\s+/)
      const local = (parts.length > 1 ? parts[1] : parts[0])?.trim()
      if (local && /^[A-Za-z_$][\w$]*$/.test(local)) names.push(local)
    }
  }

  return names
}

/**
 * Every VALUE name the canonical dirs export, mapped to the module exporting it.
 * Types and interfaces are deliberately excluded — see the header.
 */
function readCanonicalExports() {
  const exports = new Map()

  const patterns = [
    /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /^export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)/,
  ]

  const perDir = new Map()

  for (const dir of CANONICAL_DIRS) {
    const tally = { direct: 0, reExport: 0, barrels: 0 }

    for (const file of walk(path.join(ROOT, dir))) {
      const rel = normalize(path.relative(ROOT, file))
      if (isTestFile(rel)) continue

      const source = fs.readFileSync(file, 'utf8')

      for (const line of source.split('\n')) {
        for (const pattern of patterns) {
          const name = line.match(pattern)?.[1]
          if (!name) continue
          tally.direct += 1
          if (!exports.has(name)) exports.set(name, rel)
        }
      }

      // Counted independently of the parser's result, so a parser that returns
      // nothing cannot also hide the fact that there was something to find.
      if (/^export\s+\{[^}]*\}\s*from\s*['"]/m.test(source)) tally.barrels += 1

      for (const name of readReExportedNames(source)) {
        tally.reExport += 1
        if (!exports.has(name)) exports.set(name, rel)
      }
    }

    perDir.set(dir, tally)
  }

  // Assert PER DIRECTORY and PER FORM. lib/ alone exports hundreds, so a
  // total-only check would stay green while the kit half found nothing; and a
  // direct-only check would stay green if the re-export matcher regressed, which
  // is the exact failure this guard was widened to avoid.
  for (const [dir, tally] of perDir) {
    if (tally.direct + tally.reExport === 0) {
      throw new Error(
        `check-no-private-lib-fork: found no value exports under ${dir}/. Either ` +
          'the scan is broken or the export syntax changed — fix one or the ' +
          'other rather than leaving the guard passing vacuously.',
      )
    }

    if (tally.barrels > 0 && tally.reExport === 0) {
      throw new Error(
        `check-no-private-lib-fork: ${dir}/ has ${tally.barrels} barrel file(s) ` +
          'using `export { … } from`, but the re-export matcher extracted no ' +
          'names from them. Fix the matcher rather than leaving those exports ' +
          'unenforced.',
      )
    }
  }

  return exports
}

// A private top-level declaration: column 0, no `export`.
const PRIVATE_DECL = [
  /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*[=:]/,
]

function findViolations(canonicalExports) {
  const violations = []

  for (const scanDir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, scanDir))) {
      const rel = normalize(path.relative(ROOT, file))
      if (isTestFile(rel)) continue

      const lines = fs.readFileSync(file, 'utf8').split('\n')

      lines.forEach((line, index) => {
        for (const pattern of PRIVATE_DECL) {
          const name = line.match(pattern)?.[1]
          if (!name) continue
          if (IGNORED_NAMES.has(name)) continue

          const owner = canonicalExports.get(name)
          if (!owner) continue
          if (owner === rel) continue

          violations.push({
            file: rel,
            line: index + 1,
            name,
            owner,
            snippet: line.trim(),
          })
          break
        }
      })
    }
  }

  return violations
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
  return `${violation.file}|${violation.name}`
}

function main() {
  let canonicalExports

  try {
    canonicalExports = readCanonicalExports()
  } catch (error) {
    console.error(`\n${error.message}\n`)
    process.exit(1)
  }

  const baseline = readBaseline()
  const violations = findViolations(canonicalExports)

  const fresh = violations.filter((v) => !baseline.has(makeKey(v)))
  const seen = new Set(violations.map(makeKey))
  const stale = [...baseline].filter((key) => !seen.has(key))

  if (fresh.length > 0) {
    console.error('\ncheck-no-private-lib-fork: failed\n')
    console.error(
      'These re-declare something lib/ or the UI kit already exports. Import the\n' +
        'canonical — or rename yours, if it does something different.\n',
    )

    for (const v of fresh) {
      console.error(`${v.file}:${v.line}`)
      console.error(`  ${v.snippet}`)
      console.error(`  → ${v.name} is already exported by ${v.owner}`)
    }

    console.error(`\nFound ${fresh.length} private fork(s) of a lib/ export.`)
    process.exit(1)
  }

  if (stale.length > 0) {
    console.error('\ncheck-no-private-lib-fork: stale baseline entries\n')
    console.error(
      'These are listed in the baseline but no longer exist. Delete them from\n' +
        `${path.relative(ROOT, BASELINE_PATH)} so the list keeps meaning something.\n`,
    )
    for (const key of stale) console.error(`  ${key}`)
    process.exit(1)
  }

  console.log(
    `check-no-private-lib-fork: passed ` +
      `(${canonicalExports.size} canonical exports checked, ${baseline.size} baselined)`,
  )
}

main()
