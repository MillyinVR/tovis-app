// tests/integration/busy-window-sql-parity.test.ts
//
// Busy-window parity: the JS/runtime conflict math must never reserve a SHORTER
// window than the durable database EXCLUDE constraint, or availability could
// clear a slot Postgres then rejects with a 23P01.
//
// The database floor is `tovis_booking_overlap_range`
// (GREATEST(1, COALESCE(dur,0)+COALESCE(buf,0)); see
// prisma/migrations/20260522000000_add_booking_overlap_exclusion). The JS
// builders intentionally reserve >= that (duration floored to 15 / defaulted to
// 60, buffer clamped). This pins, against the REAL Postgres function:
//   - sqlBusyWindowMinutes() mirrors the SQL function EXACTLY (the shared floor)
//   - every JS/runtime builder window is >= the SQL window across the matrix
//   - and EQUALS it on the realistic domain (dur in [15,720], buf in [0,180])
//
// Requires the migrated function, so it runs against a `migrate deploy` DB (a
// `db push` DB lacks raw-SQL migration objects):
//   pnpm test:integration   (or the scratch-DB recipe in the premortem handoff)

import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'

import {
  bookingToBusyInterval,
  holdToBusyInterval,
  normalizeToMinute,
  sqlBusyWindowMinutes,
} from '@/lib/booking/conflicts'
import { calculateWindowEnd } from '@/lib/booking/schedulingConflicts'
import {
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
})

afterAll(async () => {
  await db.$disconnect()
})

const START = new Date('2030-05-01T18:00:00.000Z')

// How the higher-level builders relate to the SQL floor for each input class:
//  - 'equal'       storable domain (post-write-clamp): builders == SQL exactly
//  - 'gte'         malformed-but-bounded: builders over-reserve (>= SQL), safe
//  - 'mirror-only' out-of-cap: the write path clamps duration to
//                  [15, MAX_SLOT] and buffer to [0, MAX_BUFFER] BEFORE storing,
//                  so the DB constraint never receives these values and the
//                  builders (which cap at the same limits) are never asked to
//                  reserve them. We still assert the shared helper mirrors SQL.
type BuilderCheck = 'equal' | 'gte' | 'mirror-only'

type Scenario = {
  name: string
  duration: number | null
  buffer: number | null
  builderCheck: BuilderCheck
}

const SCENARIOS: Scenario[] = [
  { name: 'typical salon service + buffer', duration: 60, buffer: 15, builderCheck: 'equal' },
  { name: 'longer service, no buffer', duration: 90, buffer: 0, builderCheck: 'equal' },
  { name: 'short-but-valid service', duration: 15, buffer: 30, builderCheck: 'equal' },
  { name: 'max valid duration + max buffer', duration: MAX_SLOT_DURATION_MINUTES, buffer: MAX_BUFFER_MINUTES, builderCheck: 'equal' },
  // Malformed but within caps — JS over-reserves, SQL is the bare floor.
  { name: 'sub-minimum duration', duration: 5, buffer: 10, builderCheck: 'gte' },
  { name: 'null duration', duration: null, buffer: 20, builderCheck: 'gte' },
  { name: 'null duration and buffer', duration: null, buffer: null, builderCheck: 'gte' },
  { name: 'zero duration and buffer', duration: 0, buffer: 0, builderCheck: 'gte' },
  // Out-of-cap — unreachable post-write-clamp; only the SQL mirror is asserted.
  { name: 'over-cap duration', duration: MAX_SLOT_DURATION_MINUTES + 600, buffer: 0, builderCheck: 'mirror-only' },
  { name: 'over-cap buffer', duration: 60, buffer: MAX_BUFFER_MINUTES + 120, builderCheck: 'mirror-only' },
]

async function sqlWindowMinutes(
  duration: number | null,
  buffer: number | null,
): Promise<number> {
  const rows = await db.$queryRaw<{ minutes: number }[]>`
    SELECT (
      EXTRACT(
        EPOCH FROM (
          upper("tovis_booking_overlap_range"(${START}::timestamp, ${duration}::int, ${buffer}::int))
          - lower("tovis_booking_overlap_range"(${START}::timestamp, ${duration}::int, ${buffer}::int))
        )
      ) / 60
    )::int AS minutes
  `
  return Number(rows[0]?.minutes)
}

function intervalMinutes(interval: { start: Date; end: Date }): number {
  return (interval.end.getTime() - interval.start.getTime()) / 60_000
}

describe('busy-window parity vs the SQL overlap-range constraint', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: JS windows are never shorter than the DB floor`, async () => {
      const sqlMinutes = await sqlWindowMinutes(scenario.duration, scenario.buffer)

      // 1. The shared helper mirrors the SQL function EXACTLY — for every input,
      //    including null/out-of-cap. This is the single JS source of truth for
      //    "what the database constraint considers occupied".
      expect(sqlBusyWindowMinutes(scenario.duration, scenario.buffer)).toBe(
        sqlMinutes,
      )

      if (scenario.builderCheck === 'mirror-only') return

      // 2. The higher-level builders reserve >= the DB floor (never shorter than
      //    what the database treats as occupied) on every storable input class,
      //    and EQUAL it on the realistic domain.
      const bookingMinutes = intervalMinutes(
        bookingToBusyInterval({
          scheduledFor: START,
          totalDurationMinutes: scenario.duration,
          bufferMinutes: scenario.buffer,
        }),
      )

      const holdMinutes = intervalMinutes(
        holdToBusyInterval({
          hold: { scheduledFor: START, locationType: 'SALON' },
          salonDurationMinutes: scenario.duration,
          mobileDurationMinutes: scenario.duration,
          bufferMinutes: scenario.buffer ?? 0,
        }),
      )

      const runtimeMinutes =
        (calculateWindowEnd({
          startsAt: normalizeToMinute(START),
          durationMinutes: scenario.duration,
          bufferMinutes: scenario.buffer,
        }).getTime() -
          normalizeToMinute(START).getTime()) /
        60_000

      expect(bookingMinutes).toBeGreaterThanOrEqual(sqlMinutes)
      expect(holdMinutes).toBeGreaterThanOrEqual(sqlMinutes)
      expect(runtimeMinutes).toBeGreaterThanOrEqual(sqlMinutes)

      if (scenario.builderCheck === 'equal') {
        expect(bookingMinutes).toBe(sqlMinutes)
        expect(holdMinutes).toBe(sqlMinutes)
        expect(runtimeMinutes).toBe(sqlMinutes)
      }
    })
  }
})
