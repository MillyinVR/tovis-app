// tools/check-no-prisma-enum-shadow.mjs
//
// "Prisma schema is the single source of truth for data shapes" — the half a
// machine can check.
//
// A hand-written `type MediaType = 'IMAGE' | 'VIDEO'` compiles perfectly and is
// wrong the moment someone adds a member to the enum. Nothing connects the two:
// typecheck is happy, the union silently disagrees with the database, and the
// mismatch only shows up as a row the UI cannot render. There were 28 of these
// (plus 3 deliberate narrowings) before PR #905.
//
// The rule: a TS type whose NAME matches a Prisma enum may not be a hand-typed
// union of string literals. Import the enum instead —
// `import type { MediaType } from '@prisma/client'`. Type-only imports are
// erased at compile time, so there is no bundle cost even in a 'use client'
// component; a dozen of them already do this.
//
// The enum list is DERIVED from schema.prisma on every run, so a new enum is
// covered the moment it is declared.
//
// Genuinely narrower than the schema? Derive it and give it its own name:
//
//     type PanelWaitlistPreferenceType = Exclude<WaitlistPreferenceType, 'TIME_RANGE'>
//
// which keeps the constraint, tracks the schema, and — the point — does not
// leave a reader believing `WaitlistPreferenceType` is the full set.
//
// NOT flagged, deliberately:
//   • deliberately-open types (`| (string & Record<never, never>)`), which exist
//     so unknown backend values still parse — narrowing those would be a bug
//   • object/shape types that merely share a name (`type VerificationStatus = {…}`)
//   • any union with a non-literal member
//   • test files
//
// Usage:
//   node tools/check-no-prisma-enum-shadow.mjs

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SCHEMA_PATH = path.join(ROOT, 'prisma/schema.prisma')

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

/** enum name -> Set of its members, read from schema.prisma. */
function readSchemaEnums() {
  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(
      `check-no-prisma-enum-shadow: cannot find ${path.relative(ROOT, SCHEMA_PATH)}. ` +
        'The enum list is derived from it; if the schema moved, update SCHEMA_PATH.',
    )
  }

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8')
  const enums = new Map()

  for (const match of schema.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)) {
    const members = new Set()

    for (const raw of match[2].split('\n')) {
      // strip the inline `// why` comments the schema uses liberally
      const line = raw.split('//')[0].trim()
      if (!line || line.startsWith('@')) continue
      members.add(line)
    }

    enums.set(match[1], members)
  }

  if (enums.size === 0) {
    throw new Error(
      'check-no-prisma-enum-shadow: parsed zero enums out of schema.prisma. ' +
        'Either the schema syntax changed or this guard is now dead — fix one ' +
        'or the other rather than leaving it passing vacuously.',
    )
  }

  return enums
}

/**
 * The right-hand side of a `type X =`, following `|`-continuation onto the
 * following lines. Reading the WHOLE body matters: stopping early turns a
 * deliberately-open `'BASE' | 'ADD_ON' | (string & Record<never, never>)` into
 * what looks like a closed two-member union, and the guard "finds" a fork that
 * is not one.
 */
function readTypeBody(source, declStart) {
  const eq = source.indexOf('=', declStart)
  if (eq === -1) return ''

  const lines = source.slice(eq + 1).split('\n')
  const parts = []

  const first = lines[0]?.trim() ?? ''
  if (first) parts.push(first)

  for (const raw of lines.slice(1)) {
    const line = raw.trim()

    if (!line) {
      if (parts.length > 0) break
      continue
    }

    const continues =
      line.startsWith('|') || (parts.length > 0 && parts.at(-1).endsWith('|'))

    if (!continues) break
    parts.push(line)
  }

  return parts.join(' ')
}

const LITERAL_MEMBER = /^'[A-Z0-9_]+'$/

function findViolations(enums) {
  const violations = []

  for (const scanDir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, scanDir))) {
      const rel = normalize(path.relative(ROOT, file))
      if (isTestFile(rel)) continue

      const source = fs.readFileSync(file, 'utf8')

      for (const match of source.matchAll(/^(?:export\s+)?type\s+(\w+)\s*=/gm)) {
        const name = match[1]
        const schemaMembers = enums.get(name)
        if (!schemaMembers) continue

        const body = readTypeBody(source, match.index)
        const members = body
          .split('|')
          .map((m) => m.trim())
          .filter(Boolean)

        // Every member must be an ALL-CAPS string literal. Anything else — an
        // open `(string & …)` tail, a referenced type, an object shape — means
        // this is not a hand-typed copy of the enum.
        if (members.length === 0) continue
        if (!members.every((m) => LITERAL_MEMBER.test(m))) continue

        const written = new Set(members.map((m) => m.slice(1, -1)))
        const missing = [...schemaMembers].filter((m) => !written.has(m))
        const extra = [...written].filter((m) => !schemaMembers.has(m))

        violations.push({
          file: rel,
          line: source.slice(0, match.index).split('\n').length,
          name,
          missing,
          extra,
        })
      }
    }
  }

  return violations
}

function main() {
  let enums

  try {
    enums = readSchemaEnums()
  } catch (error) {
    console.error(`\n${error.message}\n`)
    process.exit(1)
  }

  const violations = findViolations(enums)

  if (violations.length > 0) {
    console.error('\ncheck-no-prisma-enum-shadow: failed\n')
    console.error(
      'These hand-write a union that shadows a Prisma enum. Import the enum:\n' +
        "  import type { Name } from '@prisma/client'\n" +
        'If yours is deliberately narrower, derive it and rename it:\n' +
        "  type PanelName = Exclude<Name, 'UNSUPPORTED_MEMBER'>\n",
    )

    for (const v of violations) {
      console.error(`${v.file}:${v.line}`)
      console.error(`  type ${v.name} — shadows the Prisma enum of the same name`)
      if (v.missing.length > 0) {
        console.error(`  → already missing: ${v.missing.join(', ')}`)
      }
      if (v.extra.length > 0) {
        console.error(`  → not in the schema: ${v.extra.join(', ')}`)
      }
    }

    console.error(`\nFound ${violations.length} enum-shadowing union(s).`)
    process.exit(1)
  }

  console.log(
    `check-no-prisma-enum-shadow: passed (${enums.size} schema enums, no hand-written copies)`,
  )
}

main()
