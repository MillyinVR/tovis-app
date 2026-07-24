// tools/check-calendar-block-cache-bump.mjs
//
// A CalendarBlock write MUST invalidate the availability cache.
//
// Blocks are occupancy: `loadBusyIntervalsForWindow` folds `calendarBlock` rows
// into the busy set that `/api/v1/availability/*` offers from, and
// `getTimeRangeConflict` refuses a write that lands on one. B1 proved those two
// QUERIES agree — which is exactly why a missing cache bump is user-facing:
// availability keeps serving the pre-block slot grid from Redis while the write
// path already refuses it, so the client is offered a time that dead-ends at
// `TIME_BLOCKED`. Driven and confirmed on the running artifact (B2, 2026-07-24):
// the block route returned 201, `/availability/day` returned the SAME
// `availabilityVersion` and still offered the blocked slot, and `POST /holds` on
// that slot refused.
//
// The busy-intervals cache is keyed on `scheduleVersion` ALONE, so a block write
// must bump THAT counter — `bumpScheduleConfigVersion` moves the day/bootstrap
// keys but leaves the 60s busy entry stale.
//
// This guard is deliberately file-scoped rather than call-graph-aware. Every
// file that mutates `calendarBlock` must also name `bumpScheduleVersion`. That
// is coarse — it cannot prove the bump covers every branch or runs after commit
// — but it makes "add a block write, forget the cache" impossible to land
// silently, which is the failure this card found.

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

const IGNORE_FILE_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
]

// Files allowed to write CalendarBlock without bumping, each with the reason
// the write cannot strand a cached availability surface.
const ALLOWED_WITHOUT_BUMP = new Set([
  // Test-data seeding + reset. Runs only against the local test database via
  // scripts/with-test-db.mjs; no Redis-backed availability surface is serving
  // that data.
  normalize('prisma/test-data/_shared.cjs'),
])

// Receiver-agnostic, matching check-booking-write-boundary.mjs: `tx.`, `prisma.`
// and `db.` all reach the same table, so the receiver name must not decide
// whether the guard fires.
const BLOCK_WRITE_PATTERN =
  /\.calendarBlock\.(create|update|delete|createMany|updateMany|deleteMany|upsert|createManyAndReturn|updateManyAndReturn)\s*\(/g

const BUMP_PATTERN = /\bbumpScheduleVersion\s*\(/

function normalize(filePath) {
  return filePath.split(path.sep).join('/')
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
    if (ALLOWED_WITHOUT_BUMP.has(rel)) continue

    const content = fs.readFileSync(file, 'utf8')
    const writes = [...content.matchAll(BLOCK_WRITE_PATTERN)]
    if (writes.length === 0) continue
    if (BUMP_PATTERN.test(content)) continue

    violations.push({ file: rel, writes: writes.map((m) => m[0]) })
  }

  return violations
}

function main() {
  const violations = findViolations(walk(ROOT))

  if (violations.length > 0) {
    console.error('\nCalendarBlock writes that never invalidate availability:\n')
    for (const violation of violations) {
      console.error(`- ${violation.file}: ${violation.writes.join(', ')}`)
    }
    console.error(
      '\nA CalendarBlock write changes what the pro’s calendar occupies, so it must\n' +
        'call bumpScheduleVersion(professionalId) AFTER the write commits. Without it,\n' +
        '/api/v1/availability/* keeps offering slots the write path refuses with\n' +
        'TIME_BLOCKED until the cache TTL expires.\n',
    )
    process.exit(1)
  }

  console.log('CalendarBlock availability-cache bump check passed.')
}

main()
