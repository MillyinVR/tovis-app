#!/usr/bin/env node

/**
 * Ensures contact normalization has one canonical source of truth.
 *
 * Allowed:
 * - contact normalization definitions in `lib/security/contactNormalization.ts`
 * - tests for the canonical module
 * - imports/references/calls from other files
 *
 * Banned outside the canonical module:
 * - route-local or utility-local email/phone normalization definitions
 * - domain-specific normalization aliases that re-implement the contract
 * - helper names like `cleanPhone`, `sanitizeEmail`, `normalizeEmailForLookup`,
 *   `normalizePhoneForVerification`, etc.
 *
 * Important:
 * This guard checks definitions, not call sites. Callers should import from:
 *
 *   @/lib/security/contactNormalization
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()

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
])

const ALLOWLISTED_FILES = new Set([
  pathForPlatform('lib/security/contactNormalization.ts'),
  pathForPlatform('lib/security/contactNormalization.test.ts'),
  pathForPlatform('lib/security/redaction.ts'),
  pathForPlatform('lib/security/redaction.test.ts'),
])

/**
 * Function or variable names that usually mean a file is defining its own
 * contact normalization contract instead of importing the canonical one.
 *
 * These names intentionally include historical/domain aliases found in audits.
 */
const BANNED_CONTACT_NORMALIZER_NAMES = [
  'cleanEmail',
  'cleanPhone',
  'normalizeContact',
  'normalizeContactInput',
  'normalizeContactForLookup',
  'normalizeEmail',
  'normalizeEmailForHash',
  'normalizeEmailForLookup',
  'normalizePhone',
  'normalizePhoneForLookup',
  'normalizePhoneForVerification',
  'sanitizeEmail',
  'sanitizePhone',
]

const DEFINITION_PATTERNS = BANNED_CONTACT_NORMALIZER_NAMES.flatMap((name) => [
  {
    name: `function ${name}`,
    regex: new RegExp(`\\bfunction\\s+${escapeRegExp(name)}\\s*\\(`, 'u'),
  },
  {
    name: `const ${name}`,
    regex: new RegExp(`\\bconst\\s+${escapeRegExp(name)}\\s*=`, 'u'),
  },
  {
    name: `let ${name}`,
    regex: new RegExp(`\\blet\\s+${escapeRegExp(name)}\\s*=`, 'u'),
  },
  {
    name: `var ${name}`,
    regex: new RegExp(`\\bvar\\s+${escapeRegExp(name)}\\s*=`, 'u'),
  },
  {
    name: `${name} property function`,
    regex: new RegExp(
      `\\b${escapeRegExp(name)}\\s*:\\s*(?:async\\s*)?(?:function\\s*)?\\(`,
      'u',
    ),
  },
  {
    name: `${name} arrow property`,
    regex: new RegExp(
      `\\b${escapeRegExp(name)}\\s*:\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>`,
      'u',
    ),
  },
])

/**
 * Catch anonymous-looking helpers such as:
 *   const phone = value.replace(/\D/g, '')
 *   const digits = rawPhone.replace(/\D/gu, '')
 *
 * This is intentionally scoped to suspicious local variable assignments.
 * It should not ban legitimate calls to canonical normalizePhone(...).
 */
const SUSPICIOUS_PHONE_DIGIT_PATTERNS = [
  {
    name: 'local phone digit stripping',
    regex:
      /\bconst\s+(?:digits|phoneDigits|normalizedPhone|cleanedPhone|phone)\s*=\s*[^;\n]+\.replace\(\s*\/\\D\/[a-z]*\s*,\s*['"]{2}\s*\)/u,
  },
  {
    name: 'local phone non-digit stripping',
    regex:
      /\bconst\s+(?:digits|phoneDigits|normalizedPhone|cleanedPhone|phone)\s*=\s*[^;\n]+\.replace\(\s*\/\[\^0-9\]\/[a-z]*\s*,\s*['"]{2}\s*\)/u,
  },
]

/**
 * Catch local email lower/trim normalization patterns. This is intentionally
 * narrow to avoid flagging display-only formatting.
 */
const SUSPICIOUS_EMAIL_NORMALIZATION_PATTERNS = [
  {
    name: 'local email trim/lowercase normalization',
    regex:
      /\bconst\s+(?:email|normalizedEmail|cleanedEmail|emailForLookup|emailForHash)\s*=\s*[^;\n]+\.trim\(\)\.toLowerCase\(\)/u,
  },
]

const ALL_PATTERNS = [
  ...DEFINITION_PATTERNS,
  ...SUSPICIOUS_PHONE_DIGIT_PATTERNS,
  ...SUSPICIOUS_EMAIL_NORMALIZATION_PATTERNS,
]

function pathForPlatform(path) {
  return path.split('/').join(sep)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasSourceExtension(filePath) {
  return SOURCE_EXTENSIONS.has(extname(filePath))
}

function normalizeRelativePath(filePath) {
  return relative(repoRoot, filePath).split(sep).join(sep)
}

function isAllowlisted(relativePath) {
  return ALLOWLISTED_FILES.has(relativePath)
}

function collectFiles(dirPath, output) {
  let entries

  try {
    entries = readdirSync(dirPath)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
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

function lineColumnForIndex(source, index) {
  const before = source.slice(0, index)
  const lines = before.split('\n')

  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  }
}

function findViolations(filePath) {
  const relativePath = normalizeRelativePath(filePath)

  if (isAllowlisted(relativePath)) return []

  const source = readFileSync(filePath, 'utf8')
  const sourceLines = source.split('\n')
  const violations = []

  for (const pattern of ALL_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, 'gu')

    for (const match of source.matchAll(regex)) {
      const index = match.index ?? 0
      const location = lineColumnForIndex(source, index)

      violations.push({
        file: relativePath,
        line: location.line,
        column: location.column,
        pattern: pattern.name,
        text: sourceLines[location.line - 1]?.trim() ?? '',
      })
    }
  }

  return violations
}

function main() {
  const files = []

  for (const root of SCAN_ROOTS) {
    collectFiles(join(repoRoot, root), files)
  }

  const violations = files.flatMap(findViolations)

  if (violations.length === 0) {
    console.log('check-canonical-normalization: passed')
    return
  }

  console.error('check-canonical-normalization: failed')
  console.error('')
  console.error(
    'Contact normalization must be defined only in lib/security/contactNormalization.ts.',
  )
  console.error(
    'Import email/phone normalization helpers from @/lib/security/contactNormalization instead of defining local helpers.',
  )
  console.error('')

  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}:${violation.column} - ${violation.pattern}`,
    )
    console.error(`  ${violation.text}`)
  }

  console.error('')
  console.error(
    `Found ${violations.length} violation${
      violations.length === 1 ? '' : 's'
    }.`,
  )

  process.exitCode = 1
}

main()