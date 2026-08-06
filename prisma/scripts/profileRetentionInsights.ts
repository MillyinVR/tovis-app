// prisma/scripts/profileRetentionInsights.ts
//
// Profiles loadProRetentionInsights (lib/analytics/proRetentionInsights.ts) against
// whatever pro/roster is already in the LOCAL dev DB — run
// seedRetentionRosterPerf.ts first for a realistic 500-client/24-month roster.
//
// Reports: wall-clock time, DB query count, sum of per-query DB time, and query
// text grouped by normalized shape (N+1 detection — the same query fired once per
// client is the signature to watch for).
//
// Usage:
//   pnpm db:dev:profile:retention-insights [-- --runs=5]
//
// (equivalent to, if you need to point at a different local DB — NODE_ENV=development
// is REQUIRED, lib/prisma.ts only enables query logging in development:
//   DATABASE_URL="postgresql://postgres:postgres@localhost:5434/tovis_dev" \
//   DIRECT_URL="postgresql://postgres:postgres@localhost:5434/tovis_dev" \
//   NODE_ENV=development \
//   NODE_OPTIONS="--import tsx --require ./prisma/scripts/_serverOnlyCjsHook.cjs" \
//     node prisma/scripts/profileRetentionInsights.ts --runs=5)
import { performance } from 'node:perf_hooks'

import { PrismaClient } from '@prisma/client'

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
function requireLocalDatabase(): void {
  const raw = process.env.DATABASE_URL ?? ''
  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    throw new Error('[profileRetentionInsights] DATABASE_URL is not a parseable URL.')
  }
  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(
      `[profileRetentionInsights] Refusing non-local database host "${host}".`,
    )
  }
}
requireLocalDatabase()

if (process.env.NODE_ENV !== 'development') {
  throw new Error(
    '[profileRetentionInsights] NODE_ENV=development is required — ' +
      'lib/prisma.ts only enables Prisma query logging in development.',
  )
}

function parseArg(argv: string[], name: string, fallback: string): string {
  const flag = argv.find((arg) => arg.startsWith(`--${name}=`))
  return flag ? flag.slice(name.length + 3) : fallback
}

type QueryEvent = { query: string; duration: number; params: string }

function normalizeQuery(sql: string): string {
  // Collapse literal $1, $2, ... param placeholders and IN-list lengths so
  // "same shape, different client id" queries group together — that grouping IS
  // the N+1 signal.
  return sql
    .replace(/\$\d+/g, '$N')
    .replace(/\s+/g, ' ')
    .trim()
}

async function main() {
  const argv = process.argv.slice(2)
  const email = parseArg(argv, 'email', 'retention-perf-pro@tovis.app')
  const runs = Number(parseArg(argv, 'runs', '3'))

  // Import the shared singleton the loader itself uses AFTER the local-DB /
  // NODE_ENV guards above, and after the `server-only` shim is wired via
  // NODE_OPTIONS — both are load-bearing for this module graph.
  const { prisma } = await import('@/lib/prisma')
  const { loadProRetentionInsights } = await import('@/lib/analytics/proRetentionInsights')
  const { proClientVisibilityWhere } = await import('@/lib/clientVisibility')

  const introspection = new PrismaClient()
  const pro = await introspection.professionalProfile.findFirst({
    where: { user: { email } },
    select: { id: true, timeZone: true },
  })
  if (!pro) {
    throw new Error(
      `[profileRetentionInsights] No professional found for user email "${email}". ` +
        'Run seedRetentionRosterPerf.ts first.',
    )
  }
  const clientCount = await introspection.clientProfile.count({
    where: { bookings: { some: { professionalId: pro.id } } },
  })
  const bookingCount = await introspection.booking.count({
    where: { professionalId: pro.id },
  })
  // The exact WHERE the loader's roster query runs (proClientVisibilityWhere +
  // professionalId), so we know whether this run actually exercises the
  // `take: RETENTION_ROSTER_LIMIT` cap (500) — not just how many clients exist.
  const visibleRosterCount = await introspection.clientProfile.count({
    where: {
      bookings: {
        some: { professionalId: pro.id, ...proClientVisibilityWhere(new Date()) },
      },
    },
  })
  await introspection.$disconnect()

  console.log(`[profileRetentionInsights] professionalId=${pro.id}`)
  console.log(
    `[profileRetentionInsights] visible roster (pre-take-cap): ${visibleRosterCount}` +
      (visibleRosterCount >= 500 ? '  ⇒ take:500 cap IS exercised' : '  ⇒ under the 500 cap'),
  )
  console.log(
    `[profileRetentionInsights] roster: ${clientCount} clients with bookings, ${bookingCount} total bookings`,
  )
  console.log(`[profileRetentionInsights] running ${runs} timed pass(es)…\n`)

  // One listener for the whole script — Prisma's client has no $off, so
  // reattaching per run would leave prior runs' listeners firing (and
  // double-counting) on every subsequent query. Route each event into
  // whichever bucket is "current" instead.
  let currentBucket: QueryEvent[] = []
  // lib/prisma.ts constructs the shared client with a plain string log level
  // array (`log: PRISMA_LOG`), not a `{ level: 'query', emit: 'event' }`
  // LogDefinition — so Prisma's own types don't offer an event-based `$on`
  // overload for it, even though the client still emits the event at runtime
  // (verified against this Prisma version). This local interface describes
  // only the call this script actually makes.
  type QueryEventEmitter = {
    $on(
      event: 'query',
      callback: (event: { query: string; duration: number; params: string }) => void,
    ): void
  }
  ;(prisma as QueryEventEmitter).$on('query', (e) => {
    currentBucket.push({ query: e.query, duration: e.duration, params: e.params })
  })

  for (let run = 1; run <= runs; run += 1) {
    const events: QueryEvent[] = []
    currentBucket = events

    const start = performance.now()
    const result = await loadProRetentionInsights({
      professionalId: pro.id,
      professionalTimeZone: pro.timeZone,
      now: new Date(),
    })
    const wallMs = performance.now() - start

    const dbTotalMs = events.reduce((sum, e) => sum + e.duration, 0)

    console.log(`── run ${run} ──────────────────────────────────────`)
    console.log(`  state:          ${result.state}`)
    console.log(`  wall time:      ${wallMs.toFixed(1)}ms`)
    console.log(`  query count:    ${events.length}`)
    console.log(`  sum query time: ${dbTotalMs.toFixed(1)}ms`)
    if (result.state === 'ready') {
      console.log(`  headline:       ${result.headlineRebookRatePct}% (Δ${result.headlineDeltaPoints})`)
      console.log(
        `  buckets:        ${result.buckets.map((b) => `${b.label}=${b.count}`).join(', ')}`,
      )
      console.log(
        `  trend:          ${result.trend.map((t) => (t.rebookRatePct === null ? '—' : `${t.rebookRatePct}%`)).join(' ')}`,
      )
      console.log(`  notEnoughHistory: ${result.notEnoughHistoryCount}, unmeasuredMonths: ${result.unmeasuredMonths}`)
    }

    const byShape = new Map<string, { count: number; totalMs: number }>()
    for (const e of events) {
      const key = normalizeQuery(e.query)
      const entry = byShape.get(key) ?? { count: 0, totalMs: 0 }
      entry.count += 1
      entry.totalMs += e.duration
      byShape.set(key, entry)
    }
    const shapes = [...byShape.entries()].sort((a, b) => b[1].count - a[1].count)
    console.log(`  distinct query shapes: ${shapes.length}`)
    for (const [shape, stat] of shapes) {
      const flag = stat.count > 3 ? '  ⚠️ repeats — possible N+1' : ''
      console.log(
        `    x${String(stat.count).padEnd(4)} ${stat.totalMs.toFixed(1).padStart(7)}ms  ${shape.slice(0, 140)}${flag}`,
      )
    }
    console.log('')
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
