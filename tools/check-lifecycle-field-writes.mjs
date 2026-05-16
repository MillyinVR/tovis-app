#!/usr/bin/env node

/**
 * tools/check-lifecycle-field-writes.mjs
 *
 * Blocks direct writes to Booking lifecycle fields outside approved write
 * boundaries. This protects the Booking lifecycle contract from being bypassed
 * by route handlers, pages, helpers, or one-off scripts.
 *
 * This tool is intentionally dependency-free and conservative. It scans source
 * text for Prisma Booking write calls and reports files that appear to write:
 *
 * - status
 * - sessionStep
 * - startedAt
 * - finishedAt
 *
 * Approved files may still write these fields because they are the canonical
 * mutation surfaces.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.mjs',
  '.cts',
  '.cjs',
])

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'build',
  'node_modules',
  'playwright-report',
  'test-results',
])

const LIFECYCLE_FIELDS = [
  'status',
  'sessionStep',
  'startedAt',
  'finishedAt',
]

/**
 * Files allowed to write Booking lifecycle fields directly.
 *
 * Keep this list small. If a new file needs to mutate these fields, the default
 * answer should be "route through writeBoundary", not "add another allowlist."
 */
const ALLOWED_FILE_PATTERNS = [
  /^lib\/booking\/writeBoundary\.ts$/,
  /^lib\/booking\/holdCleanup\.ts$/,

  // Static-analysis tools often contain Prisma write patterns as strings,
  // regexes, allowlists, or examples. They are not runtime mutation paths.
  /^tools\/check-[\w-]+\.mjs$/,

  // Tests and fixtures are allowed to construct illegal examples.
  /(^|\/)__tests__(\/|$)/,
  /(^|\/)tests?(\/|$)/,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /^tools\/fixtures\//,

  // Prisma generated/migration files are not application write paths.
  /^prisma\/migrations\//,
  /^prisma\/seed\.[cm]?[jt]s$/,
]

const BOOKING_WRITE_CALL_PATTERN =
  /\b(?:prisma|tx|db|client)\.booking\.(?:create|createMany|update|updateMany|upsert)\s*\(/g

function toRepoPath(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/')
}

function isAllowedFile(repoPath) {
  return ALLOWED_FILE_PATTERNS.some((pattern) => pattern.test(repoPath))
}

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name)
}

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath))
}

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        walk(absPath, out)
      }
      continue
    }

    if (entry.isFile() && isSourceFile(absPath)) {
      out.push(absPath)
    }
  }

  return out
}

function findMatchingParen(source, openParenIndex) {
  let depth = 0
  let quote = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let i = openParenIndex; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]

    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        i += 1
      }
      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === quote) {
        quote = null
      }

      continue
    }

    if (char === '/' && next === '/') {
      lineComment = true
      i += 1
      continue
    }

    if (char === '/' && next === '*') {
      blockComment = true
      i += 1
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }

    if (char === '(') {
      depth += 1
      continue
    }

    if (char === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }

  return -1
}

function stripCommentsAndStrings(source) {
  let out = ''
  let quote = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]

    if (lineComment) {
      out += char === '\n' ? '\n' : ' '
      if (char === '\n') lineComment = false
      continue
    }

    if (blockComment) {
      out += char === '\n' ? '\n' : ' '
      if (char === '*' && next === '/') {
        out += ' '
        blockComment = false
        i += 1
      }
      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
        out += ' '
        continue
      }

      if (char === '\\') {
        escaped = true
        out += ' '
        continue
      }

      if (char === quote) {
        quote = null
      }

      out += char === '\n' ? '\n' : ' '
      continue
    }

    if (char === '/' && next === '/') {
      out += '  '
      lineComment = true
      i += 1
      continue
    }

    if (char === '/' && next === '*') {
      out += '  '
      blockComment = true
      i += 1
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      out += ' '
      continue
    }

    out += char
  }

  return out
}

function lineNumberAt(source, index) {
  let line = 1

  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') line += 1
  }

  return line
}

function hasLifecycleFieldWrite(callSource) {
  const sanitized = stripCommentsAndStrings(callSource)

  return LIFECYCLE_FIELDS.filter((field) => {
    const propertyPattern = new RegExp(`\\b${field}\\s*:`)
    return propertyPattern.test(sanitized)
  })
}

function findViolationsInFile(absPath) {
  const repoPath = toRepoPath(absPath)

  if (isAllowedFile(repoPath)) {
    return []
  }

  const source = fs.readFileSync(absPath, 'utf8')
  const violations = []

  BOOKING_WRITE_CALL_PATTERN.lastIndex = 0

  let match
  while ((match = BOOKING_WRITE_CALL_PATTERN.exec(source)) !== null) {
    const callStart = match.index
    const openParenIndex = source.indexOf('(', callStart)

    if (openParenIndex === -1) continue

    const closeParenIndex = findMatchingParen(source, openParenIndex)

    if (closeParenIndex === -1) {
      violations.push({
        file: repoPath,
        line: lineNumberAt(source, callStart),
        fields: ['unknown'],
        reason:
          'Could not parse Booking write call; inspect manually for lifecycle writes.',
      })
      continue
    }

    const callSource = source.slice(callStart, closeParenIndex + 1)
    const fields = hasLifecycleFieldWrite(callSource)

    if (fields.length > 0) {
      violations.push({
        file: repoPath,
        line: lineNumberAt(source, callStart),
        fields,
        reason: 'Direct Booking lifecycle field write outside approved boundary.',
      })
    }

    BOOKING_WRITE_CALL_PATTERN.lastIndex = closeParenIndex + 1
  }

  return violations
}

function formatViolation(violation) {
  const fields =
    violation.fields.length === 1
      ? violation.fields[0]
      : violation.fields.join(', ')

  return [
    `- ${violation.file}:${violation.line}`,
    `  fields: ${fields}`,
    `  reason: ${violation.reason}`,
  ].join('\n')
}

function main() {
  const sourceFiles = walk(ROOT)
  const violations = sourceFiles.flatMap(findViolationsInFile)

  if (violations.length === 0) {
    console.log(
      '✅ Lifecycle field write guard passed: no unauthorized Booking lifecycle writes found.',
    )
    return
  }

  console.error(
    [
      '❌ Unauthorized Booking lifecycle field writes found.',
      '',
      'Lifecycle fields must be mutated through the approved booking write boundary.',
      '',
      `Guarded fields: ${LIFECYCLE_FIELDS.join(', ')}`,
      '',
      'Violations:',
      ...violations.map(formatViolation),
      '',
      'Allowed direct writers:',
      '- lib/booking/writeBoundary.ts',
      '- lib/booking/holdCleanup.ts',
      '',
      'Fix:',
      '- Move the mutation into lib/booking/writeBoundary.ts, or',
      '- Route the caller through an existing writeBoundary function.',
      '',
    ].join('\n'),
  )

  process.exitCode = 1
}

main()