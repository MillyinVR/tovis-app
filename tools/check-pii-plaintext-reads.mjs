#!/usr/bin/env node

/**
 * Finds high-confidence plaintext PII reads outside approved security/privacy
 * boundaries.
 *
 * This is a PII-contract audit guard, not a complete proof of encryption.
 *
 * It supports a baseline file so accepted Phase 1 expand-phase debt can be
 * tracked without allowing new plaintext reads to sneak in. Baseline growth
 * should require privacy review; baseline reduction is preferred whenever
 * touching related code.
 *
 * Commands:
 * - node tools/check-pii-plaintext-reads.mjs
 * - node tools/check-pii-plaintext-reads.mjs --update-baseline
 *
 * Baseline:
 * - tools/baselines/pii-plaintext-reads.txt
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const updateBaseline = process.argv.includes('--update-baseline')

const BASELINE_PATH = join(repoRoot, 'tools', 'baselines', 'pii-plaintext-reads.txt')

const SCAN_ROOTS = ['app', 'lib']

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

const IGNORED_DIR_NAMES = new Set([
  '.git',
  '.next',
  '.turbo',
  'node_modules',
  'coverage',
  'dist',
  'build',
  'out',
  '.vercel',
])

const ALLOWLISTED_PATH_PREFIXES = [
  `lib${sep}security${sep}`,
  `lib${sep}privacy${sep}`,
  `lib${sep}typed${sep}`,
]

const ALLOWLISTED_FILES = new Set([
  `tools${sep}check-pii-plaintext-reads.mjs`,

  // Centralized client-address input normalization boundary.
  // Raw client address fields are accepted here, normalized, and then callers
  // should write address privacy data through lib/security/addressEncryption.
  `lib${sep}clientAddresses${sep}addressInput.ts`,

  // Centralized professional-location input normalization boundary.
  // Raw professional location address fields are accepted here, normalized,
  // and then callers should write address privacy data through
  // lib/security/addressEncryption.
  `lib${sep}proLocations${sep}locationInput.ts`,
])

const IGNORED_FILE_PATTERNS = [
  /\.test\.[cm]?[tj]sx?$/u,
  /\.spec\.[cm]?[tj]sx?$/u,
  /\.stories\.[cm]?[tj]sx?$/u,
  /\.fixture\.[cm]?[tj]sx?$/u,
]

const IGNORED_PATH_PARTS = [
  `${sep}__fixtures__${sep}`,
  `${sep}fixtures${sep}`,
  `${sep}mocks${sep}`,
  `${sep}__mocks__${sep}`,
]

const PLAINTEXT_PII_FIELDS = [
  'email',
  'emailAddress',
  'phone',
  'phoneNumber',
  'firstName',
  'lastName',
  'fullName',
  'legalName',
  'dateOfBirth',
  'dob',
  'street',
  'street1',
  'street2',
  'addressLine1',
  'addressLine2',
  'postalCode',
  'zip',
  'zipCode',
  'privateNote',
  'privateNotes',
  'clientNotes',
  'consultationNotes',
  'aftercareNotes',
  'stripeAccountId',
  'stripeCustomerId',
]

// Fields flagged ONLY when selected/filtered out of a Prisma model row
// (`lat: true`, `lat: { ... }`), never on a bare `.lat` property read. `lat`
// and `lng` are extremely common identifiers on non-PII objects (Google Maps
// SDK results, map viewports, markers, geometry), so guarding direct property
// reads would drown the guard in noise. Pulling precise coordinates out of a DB
// row is the real leak class — the same one that required coarsening
// /api/pros/nearby (see lib/discovery/nearbyPros.ts). Note: `latApprox`/
// `lngApprox` are intentionally coarsened indexing surrogates and are NOT PII.
const SELECT_ONLY_PII_FIELDS = ['lat', 'lng']

// Direct/optional property reads only match the full plaintext field set;
// select/where patterns additionally match the select-only coordinate fields.
const FIELD_PATTERN = PLAINTEXT_PII_FIELDS.map(escapeRegExp).join('|')
const SELECTABLE_FIELD_PATTERN = [...PLAINTEXT_PII_FIELDS, ...SELECT_ONLY_PII_FIELDS]
  .map(escapeRegExp)
  .join('|')

const VIOLATION_PATTERNS = [
  {
    name: 'direct property read',
    regex: new RegExp(String.raw`\.\s*(?:${FIELD_PATTERN})\b`, 'u'),
  },
  {
    name: 'optional direct property read',
    regex: new RegExp(String.raw`\?\.\s*(?:${FIELD_PATTERN})\b`, 'u'),
  },
  {
    name: 'Prisma select/include plaintext field',
    regex: new RegExp(String.raw`^\s*(?:${SELECTABLE_FIELD_PATTERN})\s*:\s*true\s*,?\s*$`, 'u'),
  },
  {
    name: 'Prisma where/order plaintext field',
    regex: new RegExp(String.raw`^\s*(?:${SELECTABLE_FIELD_PATTERN})\s*:\s*\{`, 'u'),
  },
]

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getExtension(filePath) {
  const slashIndex = filePath.lastIndexOf(sep)
  const fileName = slashIndex === -1 ? filePath : filePath.slice(slashIndex + 1)
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex === -1 ? '' : fileName.slice(dotIndex)
}

function hasSourceExtension(filePath) {
  return SOURCE_EXTENSIONS.has(getExtension(filePath))
}

function normalizeRelativePath(filePath) {
  return relative(repoRoot, filePath).split(sep).join(sep)
}

function isIgnoredPath(relativePath) {
  if (ALLOWLISTED_FILES.has(relativePath)) return true
  if (ALLOWLISTED_PATH_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return true
  if (IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(relativePath))) return true

  return IGNORED_PATH_PARTS.some((part) => relativePath.includes(part))
}

function collectFiles(dirPath, output) {
  let entries

  try {
    entries = readdirSync(dirPath)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return
    }

    throw error
  }

  for (const entry of entries) {
    if (IGNORED_DIR_NAMES.has(entry)) continue

    const fullPath = join(dirPath, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      collectFiles(fullPath, output)
      continue
    }

    if (!stat.isFile()) continue
    if (!hasSourceExtension(fullPath)) continue

    output.push(fullPath)
  }
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, (match) => '\n'.repeat(countNewlines(match)))
    .replace(/\/\/.*$/gmu, '')
}

function countNewlines(value) {
  return value.split('\n').length - 1
}

function lineColumnForIndex(source, index) {
  const before = source.slice(0, index)
  const lines = before.split('\n')

  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  }
}

function hasLocalAllowlistComment(rawLineText) {
  return rawLineText.includes('pii-plaintext-read-ok:')
}

function isLikelyObjectLiteralWrite(lineText) {
  return /^\s*(?:[A-Za-z0-9_]+)\s*:\s*/u.test(lineText) && !lineText.includes(': true')
}

function findViolations(filePath) {
  const relativePath = normalizeRelativePath(filePath)

  if (isIgnoredPath(relativePath)) return []

  const rawSource = readFileSync(filePath, 'utf8')
  const source = stripComments(rawSource)
  const sourceLines = rawSource.split('\n')
  const violations = []

  for (const pattern of VIOLATION_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, 'gmu')

    for (const match of source.matchAll(regex)) {
      const index = match.index ?? 0
      const location = lineColumnForIndex(source, index)
      const rawLineText = sourceLines[location.line - 1] ?? ''
      const lineText = rawLineText.trim()

      if (hasLocalAllowlistComment(rawLineText)) continue

      if (
        (pattern.name === 'direct property read' ||
          pattern.name === 'optional direct property read') &&
        isLikelyObjectLiteralWrite(lineText)
      ) {
        continue
      }

      violations.push({
        file: relativePath,
        line: location.line,
        pattern: pattern.name,
        text: lineText,
      })
    }
  }

  return violations
}

function violationKey(violation) {
  return `${violation.file}:${violation.pattern}:${violation.text}`
}

function formatViolation(violation) {
  return `${violationKey(violation)}`
}

function readBaseline() {
  try {
    return new Set(
      readFileSync(BASELINE_PATH, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#')),
    )
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return new Set()
    }

    throw error
  }
}

function writeBaseline(violations) {
  const sorted = [...new Set(violations.map(formatViolation))].sort()

  const content = [
    '# Known plaintext PII read debt.',
    '# Generated by: node tools/check-pii-plaintext-reads.mjs --update-baseline',
    '# Remove entries as code moves behind security/privacy helper boundaries.',
    '',
    ...sorted,
    '',
  ].join('\n')

  mkdirSync(dirname(BASELINE_PATH), { recursive: true })
  writeFileSync(BASELINE_PATH, content)
}

function main() {
  const files = []

  for (const root of SCAN_ROOTS) {
    collectFiles(join(repoRoot, root), files)
  }

  const violations = files.flatMap(findViolations)
  const uniqueViolationLines = [...new Set(violations.map(formatViolation))].sort()

  if (updateBaseline) {
    writeBaseline(violations)
    console.log(`check-pii-plaintext-reads: baseline updated with ${uniqueViolationLines.length} entries`)
    console.log(`baseline: ${relative(repoRoot, BASELINE_PATH)}`)
    return
  }

  const baseline = readBaseline()

  const newViolations = uniqueViolationLines.filter((line) => !baseline.has(line))
  const resolvedBaselineEntries = [...baseline].filter((line) => !uniqueViolationLines.includes(line))

  if (newViolations.length === 0) {
    console.log(
      `check-pii-plaintext-reads: passed (${uniqueViolationLines.length} known baseline entries)`,
    )

    if (resolvedBaselineEntries.length > 0) {
      console.log('')
      console.log(
        `${resolvedBaselineEntries.length} baseline entr${resolvedBaselineEntries.length === 1 ? 'y is' : 'ies are'} now resolved.`,
      )
      console.log('Run with --update-baseline to remove resolved entries.')
    }

    return
  }

  console.error('check-pii-plaintext-reads: failed')
  console.error('')
  console.error(
    'New high-confidence plaintext PII reads were found outside approved security/privacy helpers.',
  )
  console.error(
    'Move reads/decryption/redaction into lib/security/ or lib/privacy/, or add a narrow // pii-plaintext-read-ok: <reason> comment for temporary expand-phase compatibility.',
  )
  console.error('')

  for (const line of newViolations) {
    console.error(line)
  }

  console.error('')
  console.error(`Found ${newViolations.length} new violation${newViolations.length === 1 ? '' : 's'}.`)
  console.error(`Known baseline entries: ${baseline.size}`)
  process.exitCode = 1
}

main()