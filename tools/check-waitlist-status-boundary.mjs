// tools/check-waitlist-status-boundary.mjs
//
// A WaitlistEntry STATUS transition must go through the booking write boundary.
//
// A waitlist entry is not just a row: while it is live, the pro may have
// promised it a concrete time, and that promise reserves a real slot with a
// `BookingHold` (F14). So cancelling the entry has to withdraw the offer and
// hand the slot back, under the professional's schedule lock — which is
// `cancelClientWaitlistEntry`'s whole job.
//
// B4 (2026-07-25) found `DELETE /api/v1/waitlist` doing the flip by hand:
//   await prisma.waitlistEntry.update({ data: { status: CANCELLED } })
// and stopping there. Driven on the running server, that left the offer PENDING
// with its hold still reserving the slot — invisible to the pro (both pro
// readers filter entries to ACTIVE/NOTIFIED) — and the departed client's
// confirm still returned 201 with a real ACCEPTED booking.
//
// Scope is deliberately narrow, and narrower than the sibling guards: only a
// write whose `data:` payload sets `status` is a transition. A `create` is
// exempt (an entry is born ACTIVE, reserving nothing), and so is any write that
// touches other columns — the same file legitimately PATCHes preferences, and
// its `select` names `status` without writing it, so a guard keyed on the token
// alone would fire on correct code.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

const IGNORE_DIRS = new Set([
  '.git',
  '.next',
  '.claude',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'tools',
  'tests',
  'docs',
])

const TARGET_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const IGNORE_FILE_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx']

function normalize(filePath) {
  return filePath.split(path.sep).join('/')
}

// The write boundary owns every status transition. `check:booking-boundary`
// already pins that Booking/BookingHold writes live here; a waitlist entry's
// status is the same kind of fact, because it gates a reservation.
const BOUNDARY_FILE = normalize('lib/booking/writeBoundary.ts')

// Files allowed to write a status without the boundary, each with the reason it
// cannot strand a reservation.
const ALLOWED_OUTSIDE_BOUNDARY = new Set([
  // Idempotent local test-data seeding: it re-asserts ACTIVE on an entry its own
  // `where` just matched as ACTIVE, so the "transition" is a no-op and it never
  // cancels. Runs only against the local test database (scripts/with-test-db.mjs).
  normalize('prisma/test-data/_shared.cjs'),
])

// Receiver-agnostic (`tx.`, `prisma.`, `db.`), matching the sibling guards.
const ENTRY_WRITE_PATTERN =
  /\.waitlistEntry\.(update|updateMany|upsert|updateManyAndReturn)\s*\(/g

/**
 * The source span of a balanced (…) or {…} starting at `openIndex`, which must
 * be the opening delimiter itself. Returns null when it never closes.
 *
 * String and comment contents are skipped, so a brace inside a template literal
 * or a `//` comment cannot end the span early — the failure mode that made an
 * earlier ad-hoc scanner silently skip whole files.
 */
function balancedSpan(source, openIndex) {
  const open = source[openIndex]
  const close = open === '(' ? ')' : '}'
  let depth = 0

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i]
    const next = source[i + 1]

    if (ch === '/' && next === '/') {
      const nl = source.indexOf('\n', i)
      if (nl === -1) return null
      i = nl
      continue
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end === -1) return null
      i = end + 1
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      for (let j = i + 1; j < source.length; j += 1) {
        if (source[j] === '\\') {
          j += 1
          continue
        }
        if (source[j] === ch) {
          i = j
          break
        }
        if (j === source.length - 1) return null
      }
      continue
    }

    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return source.slice(openIndex, i + 1)
    }
  }

  return null
}

// The keys a Prisma write puts its payload under. `data` covers update/updateMany;
// an `upsert` has no `data` at all — it carries `create` and `update` instead, so a
// guard that only read `data` would wave a status-setting upsert straight through.
const PAYLOAD_KEYS = ['data', 'create', 'update']

/** Does any of this write's payload objects set `status`? */
function writesStatus(argsSpan) {
  for (const key of PAYLOAD_KEYS) {
    const literal = new RegExp(`\\b${key}\\s*:\\s*\\{`).exec(argsSpan)

    if (!literal) {
      // Payload spread from a variable (`data: payload`) — its contents cannot be
      // read here, so treat it as a transition rather than waving it through.
      if (new RegExp(`\\b${key}\\s*:`).test(argsSpan)) return true
      continue
    }

    const braceIndex = literal.index + literal[0].length - 1
    const span = balancedSpan(argsSpan, braceIndex)
    // Unbalanced — fail closed.
    if (span === null) return true
    if (/\bstatus\s*:/.test(span)) return true
  }

  return false
}

function shouldCheckFile(filePath) {
  if (!TARGET_EXTENSIONS.has(path.extname(filePath))) return false
  return !IGNORE_FILE_SUFFIXES.some((suffix) => filePath.endsWith(suffix))
}

function walk(dir) {
  const files = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) files.push(...walk(fullPath))
      continue
    }

    if (entry.isFile() && shouldCheckFile(fullPath)) files.push(fullPath)
  }

  return files
}

function findViolations(files) {
  const violations = []

  for (const file of files) {
    const rel = normalize(path.relative(ROOT, file))
    if (rel === BOUNDARY_FILE) continue
    if (ALLOWED_OUTSIDE_BOUNDARY.has(rel)) continue

    const content = fs.readFileSync(file, 'utf8')

    for (const match of content.matchAll(ENTRY_WRITE_PATTERN)) {
      const parenIndex = match.index + match[0].length - 1
      const argsSpan = balancedSpan(content, parenIndex)
      if (argsSpan === null) continue
      if (!writesStatus(argsSpan)) continue

      const line = content.slice(0, match.index).split('\n').length
      violations.push({ file: rel, line, call: match[0] })
    }
  }

  return violations
}

function main() {
  const violations = findViolations(walk(ROOT))

  if (violations.length > 0) {
    console.error('\nWaitlistEntry status transitions outside the write boundary:\n')
    for (const violation of violations) {
      console.error(`- ${violation.file}:${violation.line}: ${violation.call}`)
    }
    console.error(
      '\nA waitlist entry that stops being live must also give back whatever the pro\n' +
        'promised it: a PENDING WaitlistOffer reserves a real slot with a BookingHold\n' +
        '(F14). Route the transition through lib/booking/writeBoundary.ts — e.g.\n' +
        'cancelClientWaitlistEntry — so it runs under the professional’s schedule lock\n' +
        'and releases the reservation in the same transaction.\n',
    )
    process.exit(1)
  }

  console.log('WaitlistEntry status-boundary check passed.')
}

main()
