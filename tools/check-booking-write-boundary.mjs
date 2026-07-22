import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

const ALLOWED_FILES = new Set([
  normalize('lib/booking/writeBoundary.ts'),
  // Refund service. Owns the BookingRefund table and the refund-settle
  // transaction (under its own per-booking advisory lock). Its only Booking
  // write is the narrow payment field Booking.stripePaymentStatus -> REFUNDED
  // when a booking is fully refunded; it never writes the lifecycle fields
  // (status / sessionStep), which check-lifecycle-field-writes.mjs enforces
  // independently. See lib/booking/refunds.ts.
  normalize('lib/booking/refunds.ts'),
  // Internal helper module of the write boundary. Only called from
  // writeBoundary.ts (`deleteExpiredHoldsForProfessional`,
  // `deleteActiveHoldsForClient`); not a user-facing surface.
  normalize('lib/booking/holdCleanup.ts'),
  // One-time operational backfill for legacy Booking / BookingHold address
  // snapshots. It is intentionally dry-run by default and only writes encrypted
  // dedicated address snapshot columns plus approximate coordinates.
  normalize('prisma/scripts/backfillAddressEncryption.ts'),
  // Expand-phase tenant backfill. Dry-run by default; writes only the
  // proTenantId/clientHomeTenantId attribution columns (never lifecycle
  // fields). See docs/architecture/tenant-model.md.
  normalize('prisma/scripts/backfillTenantFoundation.ts'),
  // Expand-phase tier-3 note encryption backfill. Dry-run by default; writes
  // only the encrypted note-envelope columns (e.g. Booking.consultationNotesEncrypted),
  // never lifecycle fields. See docs/security/ticket-encrypt-tier3-health-notes.md.
  normalize('prisma/scripts/backfillNotesEncryption.ts'),
  // Test-data reset script for the last-minute booking suite. Runs only
  // against the test database via `scripts/with-test-db.mjs`.
  normalize('prisma/test-data/resetLastMinuteTestData.cjs'),
  // Referral reward application. Only writes discountAmount/totalAmount on
  // Booking when a referral reward is applied; never touches lifecycle fields.
  normalize('lib/referral/referralConversion.ts'),
  // Account erasure. Its only BookingHold write is deleteMany over the erased
  // user's own holds (client- or pro-side), which RELEASES reserved time —
  // it can never create, move, or double-book an appointment, and the confirm
  // paths all re-run the full conflict gate, so a hold vanishing early only
  // reopens a slot. Bookings themselves are anonymized, not written, here.
  normalize('lib/privacy/deleteUserData.ts'),
  // Test-DB seed fixtures (`pnpm db:test:seed` → prisma/seed.cjs requires
  // this). Creates bookings directly because the boundary's locks/policies are
  // the thing the integration suites exercise against these rows. The seed
  // refuses to run without `requireSafeScriptRun` clearing it
  // (scripts/_safe-script-guard.cjs, ALLOW_SEED_SCRIPT opt-in, destructive
  // mode), and `seed:test` pins DATABASE_URL to the local test Postgres.
  normalize('prisma/test-data/_shared.cjs'),
])

const TEMP_ALLOWED_FILES = new Set([
])

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
])

const TARGET_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
])

const IGNORE_FILE_BASENAMES = new Set([
  'wipe_test_data.cjs',
])

const IGNORE_FILE_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
]

// Receiver-agnostic on purpose. This used to be a list of literal
// `prisma.booking.create(` / `tx.bookingHold.update(` strings, so a client
// bound to ANY other name — `db.bookingHold.deleteMany(…)`,
// `prismaClient.booking.create(…)` — walked straight past the guard
// (found in the 2026-07-22 re-audit; both shapes existed). The receiver name
// is irrelevant: the write verb on the model is what the boundary owns.
// `upsert` and the *AndReturn variants are included even though nothing uses
// them today — they create/update rows just the same.
const FORBIDDEN_PATTERN =
  /\.(booking|bookingHold)\.(create|update|delete|createMany|updateMany|deleteMany|upsert|createManyAndReturn|updateManyAndReturn)\s*\(/g

function normalize(filePath) {
  return filePath.split(path.sep).join('/')
}

function shouldIgnoreDir(name) {
  return IGNORE_DIRS.has(name)
}

function hasAllowedExtension(filePath) {
  return TARGET_EXTENSIONS.has(path.extname(filePath))
}

function shouldIgnoreFile(filePath) {
  const baseName = path.basename(filePath)

  if (IGNORE_FILE_BASENAMES.has(baseName)) {
    return true
  }

  return IGNORE_FILE_SUFFIXES.some((suffix) => filePath.endsWith(suffix))
}

function shouldCheckFile(filePath) {
  return hasAllowedExtension(filePath) && !shouldIgnoreFile(filePath)
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (!shouldIgnoreDir(entry.name)) {
        files.push(...walk(fullPath))
      }
      continue
    }

    if (entry.isFile() && shouldCheckFile(fullPath)) {
      files.push(fullPath)
    }
  }

  return files
}

function isAllowedFile(relPath) {
  return ALLOWED_FILES.has(relPath) || TEMP_ALLOWED_FILES.has(relPath)
}

function findViolations(files) {
  const violations = []

  for (const file of files) {
    const rel = normalize(path.relative(ROOT, file))

    if (isAllowedFile(rel)) {
      continue
    }

    const content = fs.readFileSync(file, 'utf8')

    for (const match of content.matchAll(FORBIDDEN_PATTERN)) {
      violations.push({ file: rel, pattern: match[0] })
    }
  }

  return violations
}

function printAllowedMigrationStatus() {
  if (TEMP_ALLOWED_FILES.size === 0) {
    return
  }

  console.log('\nTemporarily allowlisted during migration:\n')
  for (const file of [...TEMP_ALLOWED_FILES].sort()) {
    console.log(`- ${file}`)
  }
  console.log('')
}

function main() {
  const files = walk(ROOT)
  const violations = findViolations(files)

  if (violations.length > 0) {
    console.error('\nBooking write boundary violations found:\n')
    for (const violation of violations) {
      console.error(`- ${violation.file}: ${violation.pattern}`)
    }
    console.error(
      '\nAll Booking / BookingHold writes must go through lib/booking/writeBoundary.ts\n',
    )
    printAllowedMigrationStatus()
    process.exit(1)
  }

  console.log('Booking write boundary check passed.')
  printAllowedMigrationStatus()
}

main()