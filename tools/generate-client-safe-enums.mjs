// tools/generate-client-safe-enums.mjs
//
// Generates AND guards lib/prismaEnums.ts — the client-safe copy of the handful
// of Prisma enums that client-rendered code needs the VALUES of.
//
// ## Why the file has to exist
//
// `import { BookingStatus } from '@prisma/client'` is a VALUE import. It cannot
// be erased, so every client component downstream of it pulls @prisma/client's
// browser build: 155 `ScalarFieldEnum` maps naming every column of every model,
// plus the error classes. One 121.5 KB chunk, on 53 of this app's routes,
// bought so that `BOOKING_STATUS_LABELS` can be keyed by `BookingStatus.PENDING`
// instead of `'PENDING'`.
//
// @prisma/client@6.19.2 exposes no `./enums` subpath — there is no supported way
// to import just the enum objects — so the client-safe copy has to be authored
// here. #1029's guard (check-no-client-prisma-import) names this file as its
// prerequisite: "Build that surface, then widen this guard."
//
// ## Why it is GENERATED rather than hand-written
//
// A hand-written copy is a fork of the schema, and the repo already knows how
// that ends — check-no-prisma-enum-shadow exists because 28 hand-typed unions
// had drifted from their enums. The failure is silent by construction: add
// `RESCHEDULED` to BookingStatus, and a hand-written copy still compiles, still
// passes typecheck, and simply has no arm for the new value. The bug surfaces as
// a row the UI cannot render.
//
// So the copy is derived from prisma/schema.prisma, and the SAME script that
// derives it also checks it. That is the load-bearing choice: a separate checker
// could disagree with a separate generator, and then the check is theatre.
// Because there is exactly one function that renders the file, the check is a
// literal byte comparison of "what the schema says" against "what is on disk" —
// it catches a value added, a value removed, a value reordered, a member
// hand-edited, and the file being deleted, without enumerating those cases.
//
// ## Scope: only what client code actually needs
//
// CLIENT_SAFE_ENUMS is an explicit list, not "every enum in the schema" (there
// are 117). A client-safe copy of an enum nothing client-side touches is dead
// weight that still has to be kept honest. Adding one is deliberate: put the
// name in the list, run `--write`, commit the result.
//
// SERVER code must keep importing from '@prisma/client'. Two definitions of the
// same enum are fine while they are proven equal, but they are still two
// objects, and `Object.values(X)` from one is not reference-equal to the other.
// check-server-enum-imports-prisma.mjs holds that line.
//
// Usage:
//   node tools/generate-client-safe-enums.mjs            # check (CI/guards)
//   node tools/generate-client-safe-enums.mjs --write    # regenerate the file

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SCHEMA_PATH = path.join(ROOT, 'prisma/schema.prisma')
const OUTPUT_PATH = path.join(ROOT, 'lib/prismaEnums.ts')
const OUTPUT_REL = 'lib/prismaEnums.ts'

/**
 * The enums that client-rendered code names at all — as a value OR as a type.
 *
 * Derived (2026-08-29) by walking the value-import graph out of every
 * 'use client' module and collecting the Prisma enums the reachable modules
 * import.
 *
 * Deliberately NOT "only the ones dereferenced today". A type-only import is
 * free, so the narrower rule looks tempting — but it makes the bundle depend on
 * how each enum happens to be USED, and the day somebody adds `X.MEMBER` to a
 * file that imports `type X` they have to notice that the import must change
 * kind too. Nobody notices; the 121.5 KB chunk comes back, silently, which is
 * the exact failure this whole exercise is about. One rule instead: code that
 * reaches the browser takes its enums from here, value or type.
 * check-no-client-prisma-import enforces it.
 */
const CLIENT_SAFE_ENUMS = [
  'AftercareRebookMode',
  'BoardType',
  'BookingCheckoutStatus',
  'BookingDepositStatus',
  'BookingDiscoveryProvenance',
  'BookingRefundStatus',
  'BookingServiceItemType',
  'BookingSource',
  'BookingStatus',
  'ClientChartShareStatus',
  'ClientConsentKind',
  'ClientCreatorTier',
  'ClientNoteKind',
  'ClientNoteVisibility',
  'ClientRelationshipLabel',
  'ConsentProofMethod',
  'DepositType',
  'LookPostStatus',
  'LookPostVisibility',
  'MediaType',
  'MediaVisibility',
  'ModerationStatus',
  'NoShowFeeReason',
  'NoShowFeeStatus',
  'NotificationEventKey',
  'OfferingPrepayScope',
  'PatchTestResult',
  'PhotoReleaseStatus',
  'ProNameDisplay',
  'ProfessionType',
  'Role',
  'SessionStep',
  'StripePaymentStatus',
  'VerificationStatus',
]

/**
 * enum name -> ordered member list, read from schema.prisma.
 *
 * Order is preserved deliberately: the generated file is compared byte for byte,
 * so reordering members in the schema is drift the guard should report rather
 * than quietly absorb.
 */
function readSchemaEnums() {
  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(
      `cannot find ${path.relative(ROOT, SCHEMA_PATH)}. The enum values are derived ` +
        'from it; if the schema moved, update SCHEMA_PATH.',
    )
  }

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8')
  const enums = new Map()

  for (const match of schema.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)) {
    const members = []

    for (const raw of match[2].split('\n')) {
      // the schema comments members liberally; strip those, and skip attributes
      const line = raw.split('//')[0].trim()
      if (!line || line.startsWith('@')) continue
      members.push(line)
    }

    enums.set(match[1], members)
  }

  if (enums.size === 0) {
    throw new Error(
      'parsed zero enums out of schema.prisma. Either the schema syntax changed ' +
        'or this generator is now dead — fix one or the other rather than ' +
        'emitting an empty file.',
    )
  }

  return enums
}

function renderFile(enums) {
  const missing = CLIENT_SAFE_ENUMS.filter((name) => !enums.has(name))
  if (missing.length > 0) {
    throw new Error(
      `CLIENT_SAFE_ENUMS names ${missing.length} enum(s) that no longer exist in ` +
        `schema.prisma: ${missing.join(', ')}.\n` +
        'A renamed or deleted enum must be removed from the list (and from every ' +
        'importer of lib/prismaEnums) rather than left to emit a phantom.',
    )
  }

  const sorted = [...CLIENT_SAFE_ENUMS].sort()
  if (sorted.join() !== CLIENT_SAFE_ENUMS.join()) {
    throw new Error(
      'CLIENT_SAFE_ENUMS must stay alphabetically sorted so the generated file ' +
        'has one canonical form and a diff means real drift.',
    )
  }

  const blocks = sorted.map((name) => {
    const members = enums.get(name)
    const entries = members.map((m) => `  ${m}: '${m}',`).join('\n')

    // wrap the alias the way the rest of the repo wraps at ~80 columns
    const alias = `export type ${name} = (typeof ${name})[keyof typeof ${name}]`
    const wrapped =
      alias.length > 80
        ? `export type ${name} =\n  (typeof ${name})[keyof typeof ${name}]`
        : alias

    return `export const ${name} = {\n${entries}\n} as const\n\n${wrapped}\n`
  })

  return (
    `// lib/prismaEnums.ts\n` +
    `//\n` +
    `// GENERATED FILE — DO NOT EDIT BY HAND.\n` +
    `// Source of truth: prisma/schema.prisma\n` +
    `// Regenerate:     node tools/generate-client-safe-enums.mjs --write\n` +
    `// Guarded by:     pnpm check:client-safe-enums (runs in check:static-guards)\n` +
    `//\n` +
    `// The client-safe copy of the Prisma enums whose VALUES client-rendered code\n` +
    `// reads. Importing these from '@prisma/client' is a value import, which drags\n` +
    `// that package's browser build (every column of every model, by name) into the\n` +
    `// browser bundle — 121.5 KB across 53 routes before this file existed.\n` +
    `//\n` +
    `// Each export is shaped exactly like Prisma's own generated enum: an as-const\n` +
    `// object plus a same-named string-literal union — so the two are mutually\n` +
    `// assignable and call sites read identically.\n` +
    `//\n` +
    `// ⚠️ SERVER code keeps importing from '@prisma/client'. This file is for code\n` +
    `// that reaches the browser. Types are free either way: 'import type { X } from\n` +
    `// \"@prisma/client\"' is erased at compile time and costs the bundle nothing.\n` +
    `\n` +
    blocks.join('\n')
  )
}

function main() {
  const write = process.argv.includes('--write')

  let expected
  try {
    expected = renderFile(readSchemaEnums())
  } catch (error) {
    console.error(`\ngenerate-client-safe-enums: ${error.message}\n`)
    process.exit(1)
  }

  if (write) {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
    fs.writeFileSync(OUTPUT_PATH, expected)
    console.log(
      `generate-client-safe-enums: wrote ${OUTPUT_REL} ` +
        `(${CLIENT_SAFE_ENUMS.length} enums)`,
    )
    return
  }

  const actual = fs.existsSync(OUTPUT_PATH)
    ? fs.readFileSync(OUTPUT_PATH, 'utf8')
    : null

  if (actual === expected) {
    console.log(
      `check-client-safe-enums: passed ` +
        `(${CLIENT_SAFE_ENUMS.length} enums match prisma/schema.prisma)`,
    )
    return
  }

  console.error('\ncheck-client-safe-enums: failed\n')

  if (actual === null) {
    console.error(
      `${OUTPUT_REL} does not exist, but code imports from it.\n` +
        'Run: node tools/generate-client-safe-enums.mjs --write\n',
    )
    process.exit(1)
  }

  console.error(
    `${OUTPUT_REL} has drifted from prisma/schema.prisma.\n\n` +
      'This is the failure the file exists to prevent: the copy still compiles\n' +
      'and still typechecks while disagreeing with the database, so the bug\n' +
      'surfaces as a value the UI has no arm for.\n\n' +
      'Fix it by regenerating — never by editing the generated file:\n' +
      '  node tools/generate-client-safe-enums.mjs --write\n\n' +
      'Then check every exhaustive map over the changed enum. A `Record<Enum, …>`\n' +
      'will fail to compile (which is the point); a `switch` with a default will\n' +
      'not, and is where a new value silently lands in the wrong bucket.\n',
  )

  // Report the drift per enum — the whole-file diff is noisy and the useful
  // question is always "which values moved".
  const parseMembers = (source) => {
    const found = new Map()
    for (const m of source.matchAll(
      /export const (\w+) = \{([\s\S]*?)\} as const/g,
    )) {
      found.set(
        m[1],
        [...m[2].matchAll(/^\s*(\w+):/gm)].map((x) => x[1]),
      )
    }
    return found
  }

  const want = parseMembers(expected)
  const have = parseMembers(actual)

  for (const [name, members] of want) {
    const onDisk = have.get(name)
    if (!onDisk) {
      console.error(`  ${name}: missing from ${OUTPUT_REL} entirely`)
      continue
    }
    const added = members.filter((m) => !onDisk.includes(m))
    const removed = onDisk.filter((m) => !members.includes(m))
    if (added.length === 0 && removed.length === 0) {
      if (members.join() !== onDisk.join()) {
        console.error(`  ${name}: same values, different order`)
      }
      continue
    }
    if (added.length > 0) {
      console.error(`  ${name}: in the schema, NOT in the copy → ${added.join(', ')}`)
    }
    if (removed.length > 0) {
      console.error(`  ${name}: in the copy, NOT in the schema → ${removed.join(', ')}`)
    }
  }

  for (const name of have.keys()) {
    if (!want.has(name)) {
      console.error(`  ${name}: on disk but not in CLIENT_SAFE_ENUMS`)
    }
  }

  console.error('')
  process.exit(1)
}

main()
