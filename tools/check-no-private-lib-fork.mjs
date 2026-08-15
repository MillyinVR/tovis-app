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
// name `lib/` already exports as a value. Import the canonical instead — or, if
// the two genuinely mean different things, give yours a different name, because
// two same-named helpers with different behaviour is the more expensive bug.
// (`lib/auth/verification.ts` exported a `pickString` returning `''` while
// `lib/pick.ts` exported one returning `null`. Both compiled; `if (!x)` hid the
// difference at every call site.)
//
// The export list is DERIVED from lib/ on every run, so a helper promoted into
// lib/ starts being enforced the moment it is exported — no list to update here.
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
 * Every VALUE name `lib/` exports, mapped to the module that exports it.
 * Types and interfaces are deliberately excluded — see the header.
 */
function readLibExports() {
  const exports = new Map()

  const patterns = [
    /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /^export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)/,
  ]

  for (const file of walk(path.join(ROOT, 'lib'))) {
    const rel = normalize(path.relative(ROOT, file))
    if (isTestFile(rel)) continue

    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      for (const pattern of patterns) {
        const name = line.match(pattern)?.[1]
        if (name && !exports.has(name)) exports.set(name, rel)
      }
    }
  }

  if (exports.size === 0) {
    throw new Error(
      'check-no-private-lib-fork: found no value exports under lib/. Either the ' +
        'scan is broken or the export syntax changed — fix one or the other ' +
        'rather than leaving the guard passing vacuously.',
    )
  }

  return exports
}

// A private top-level declaration: column 0, no `export`.
const PRIVATE_DECL = [
  /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*[=:]/,
]

function findViolations(libExports) {
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

          const owner = libExports.get(name)
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
  let libExports

  try {
    libExports = readLibExports()
  } catch (error) {
    console.error(`\n${error.message}\n`)
    process.exit(1)
  }

  const baseline = readBaseline()
  const violations = findViolations(libExports)

  const fresh = violations.filter((v) => !baseline.has(makeKey(v)))
  const seen = new Set(violations.map(makeKey))
  const stale = [...baseline].filter((key) => !seen.has(key))

  if (fresh.length > 0) {
    console.error('\ncheck-no-private-lib-fork: failed\n')
    console.error(
      'These re-declare a helper lib/ already exports. Import the canonical —\n' +
        'or rename yours, if it does something different.\n',
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
      `(${libExports.size} lib exports checked, ${baseline.size} baselined)`,
  )
}

main()
