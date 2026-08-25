// scripts/verify-test-db-constraints.mjs
//
// Prove the local test database carries the overlap EXCLUDE constraints.
//
// `prisma db push` builds a schema from prisma/schema.prisma alone, and an
// EXCLUDE constraint cannot be expressed there — it exists only in raw
// migration SQL. So a pushed database looks complete, has every table, and is
// silently missing the exact invariant `tests/integration/
// booking-overlap-concurrency.test.ts` exists to prove. Five of its cases then
// fail identically on every branch, which reads like a code regression and is
// not one. (That is not hypothetical: it is why this script exists.)
//
// integration.yml runs the same assertion after `prisma migrate deploy`; this
// is its local twin, so the local setup path cannot quietly diverge from CI.
import { execFileSync } from 'node:child_process'

const CONTAINER = process.env.TEST_DB_CONTAINER ?? 'tovis-test-postgres'
const EXPECTED = [
  'Booking_no_active_professional_overlap',
  'BookingHold_no_active_professional_overlap',
]

const query = `SELECT conname FROM pg_constraint WHERE conname IN (${EXPECTED.map(
  (n) => `'${n}'`,
).join(',')}) ORDER BY conname;`

let found = []
try {
  found = execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'tovis_test', '-tAc', query],
    { encoding: 'utf8' },
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
} catch (error) {
  console.error(
    `Could not query the test database in container "${CONTAINER}": ${error.message}`,
  )
  process.exit(1)
}

const missing = EXPECTED.filter((name) => !found.includes(name))

if (missing.length > 0) {
  console.error('✖ overlap EXCLUDE constraints missing from the test database:')
  for (const name of missing) console.error(`    - ${name}`)
  console.error(
    '\n  The database was almost certainly built with `prisma db push`, which',
  )
  console.error('  cannot create them. Rebuild it with:  pnpm db:test:reset')
  process.exit(1)
}

console.log(`overlap EXCLUDE constraints present (${found.length}/2)`)
