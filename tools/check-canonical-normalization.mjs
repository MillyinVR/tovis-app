#!/usr/bin/env node

/**
 * Ensures contact normalization has one canonical source of truth.
 *
 * Allowed:
 * - `normalizeEmail` / `normalizePhone` definitions in
 *   `lib/security/contactNormalization.ts`
 * - imports/references to those functions from other files
 * - tests for the canonical module
 *
 * Banned:
 * - route-local or utility-local `normalizeEmail(...)` definitions
 * - route-local or utility-local `normalizePhone(...)` definitions
 * - duplicate exported aliases that redefine the normalization contract
 *
 * This guard intentionally checks definitions, not call sites. Callers should
 * import from `@/lib/security/contactNormalization`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
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
  `lib${sep}security${sep}contactNormalization.ts`,
  `lib${sep}security${sep}contactNormalization.test.ts`,
])

const DEFINITION_PATTERNS = [
  {
    name: 'function normalizeEmail',
    regex: /\bfunction\s+normalizeEmail\s*\(/u,
  },
  {
    name: 'function normalizePhone',
    regex: /\bfunction\s+normalizePhone\s*\(/u,
  },
  {
    name: 'const normalizeEmail',
    regex: /\bconst\s+normalizeEmail\s*=/u,
  },
  {
    name: 'const normalizePhone',
    regex: /\bconst\s+normalizePhone\s*=/u,
  },
  {
    name: 'let normalizeEmail',
    regex: /\blet\s+normalizeEmail\s*=/u,
  },
  {
    name: 'let normalizePhone',
    regex: /\blet\s+normalizePhone\s*=/u,
  },
  {
    name: 'var normalizeEmail',
    regex: /\bvar\s+normalizeEmail\s*=/u,
  },
  {
    name: 'var normalizePhone',
    regex: /\bvar\s+normalizePhone\s*=/u,
  },
  {
    name: 'normalizeEmail property function',
    regex: /\bnormalizeEmail\s*:\s*(?:async\s*)?(?:function\s*)?\(/u,
  },
  {
    name: 'normalizePhone property function',
    regex: /\bnormalizePhone\s*:\s*(?:async\s*)?(?:function\s*)?\(/u,
  },
  {
    name: 'normalizeEmail arrow property',
    regex: /\bnormalizeEmail\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/u,
  },
  {
    name: 'normalizePhone arrow property',
    regex: /\bnormalizePhone\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/u,
  },
]

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

function isAllowlisted(relativePath) {
  return ALLOWLISTED_FILES.has(relativePath)
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

  for (const pattern of DEFINITION_PATTERNS) {
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
    'Import normalizeEmail/normalizePhone from @/lib/security/contactNormalization instead of defining local helpers.',
  )
  console.error('')

  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}:${violation.column} - ${violation.pattern}`,
    )
    console.error(`  ${violation.text}`)
  }

  console.error('')
  console.error(`Found ${violations.length} violation${violations.length === 1 ? '' : 's'}.`)
  process.exitCode = 1
}

main()