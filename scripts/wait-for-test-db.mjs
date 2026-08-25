// scripts/wait-for-test-db.mjs
//
// Wait until the test database can actually serve a connection.
//
// Two checks that look like readiness and are not:
//
//   1. `docker exec … pg_isready` (no -h). The Postgres entrypoint runs a
//      temporary server on a UNIX SOCKET while it applies initdb scripts, so
//      the socket answers seconds before any TCP listener exists.
//   2. Opening a TCP socket to the mapped host port. `docker run -p` publishes
//      the port through docker-proxy, which accepts connections IMMEDIATELY —
//      measured: host TCP was open at t=1s while Postgres first accepted TCP
//      at t=10s. A connect() test therefore returns instantly and proves
//      nothing.
//
// Either one sends the caller straight into `prisma migrate deploy`, which
// dies with `P1001: Can't reach database server at localhost:5433`.
//
// What discriminates is `pg_isready -h 127.0.0.1` INSIDE the container: during
// initdb the server is bound to the socket only, so a TCP probe fails until
// the real server is up.
import { execFileSync } from 'node:child_process'

const CONTAINER = process.env.TEST_DB_CONTAINER ?? 'tovis-test-postgres'
const TIMEOUT_MS = Number(process.env.TEST_DB_WAIT_TIMEOUT_MS ?? 120_000)

const isReady = () => {
  try {
    execFileSync(
      'docker',
      ['exec', CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres'],
      { stdio: 'ignore' },
    )
    return true
  } catch {
    return false
  }
}

const startedAt = Date.now()
while (Date.now() - startedAt < TIMEOUT_MS) {
  if (isReady()) {
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(`test database accepting TCP connections after ${secs}s`)
    process.exit(0)
  }
  await new Promise((r) => setTimeout(r, 1_000))
}

console.error(
  `Timed out after ${TIMEOUT_MS}ms waiting for "${CONTAINER}" to accept TCP connections.`,
)
process.exit(1)
