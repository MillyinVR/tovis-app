// tests/integration/event-countdown.test.ts
//
// Real-Postgres coverage for runEventCountdownNotifications (personalization spec
// §8, gated by the §8.1 re-engagement budget). Exercises the end-to-end scan on a
// real DB: a dated board inside a milestone window produces exactly one
// EVENT_DATE_COUNTDOWN client notification + its dispatch (the budget ledger),
// while boards outside every window (too far out, day-of) produce none — and a
// second run in the same milestone is idempotent (dedupe).
//
// Runs via `npm run test:integration` (test DB :5433). The shared test DB is
// SEEDED — this test scopes every fixture with a unique tag and cleans up only its
// own rows.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BoardType, NotificationEventKey, Role } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { runEventCountdownNotifications } from '@/lib/notifications/eventCountdownNotifications'

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: npm run test:integration',
  )
}

const NOW = new Date('2026-07-15T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const TAG = `evtcd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

/** A UTC-midnight @db.Date value `days` out from NOW. */
function eventDateDaysOut(days: number): Date {
  const d = new Date(NOW.getTime() + days * DAY_MS)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

type Ids = {
  tenantId: string
  clientEligibleId: string
  clientFarId: string
  clientTodayId: string
  eligibleBoardId: string
  userIds: string[]
}

let ids: Ids

async function cleanup(): Promise<void> {
  if (!ids) return
  const clientIds = [ids.clientEligibleId, ids.clientFarId, ids.clientTodayId]

  await prisma.notificationDispatch.deleteMany({
    where: { clientId: { in: clientIds } },
  })
  await prisma.clientNotification.deleteMany({
    where: { clientId: { in: clientIds } },
  })
  await prisma.board.deleteMany({ where: { clientId: { in: clientIds } } })
  await prisma.clientProfile.deleteMany({ where: { id: { in: clientIds } } })
  await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } })
}

async function seed(): Promise<Ids> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  const userIds: string[] = []

  const makeClient = async (suffix: string) => {
    const user = await prisma.user.create({
      data: {
        email: `${TAG}_${suffix}@example.com`,
        password: 'test-password',
        role: Role.CLIENT,
        emailVerifiedAt: NOW,
      },
      select: { id: true },
    })
    userIds.push(user.id)
    const client = await prisma.clientProfile.create({
      data: { userId: user.id, homeTenantId: tenant.id, firstName: 'Client' },
      select: { id: true },
    })
    return client.id
  }

  const clientEligibleId = await makeClient('eligible')
  const clientFarId = await makeClient('far')
  const clientTodayId = await makeClient('today')

  const makeBoard = async (args: {
    clientId: string
    suffix: string
    type: BoardType
    daysOut: number
  }) => {
    const b = await prisma.board.create({
      data: {
        clientId: args.clientId,
        name: `${TAG} ${args.suffix}`,
        slug: `${TAG}-${args.suffix}`,
        type: args.type,
        eventDate: eventDateDaysOut(args.daysOut),
      },
      select: { id: true },
    })
    return b.id
  }

  // Eligible: a bridal board 14 days out → milestone 14.
  const eligibleBoardId = await makeBoard({
    clientId: clientEligibleId,
    suffix: 'bridal',
    type: BoardType.BRIDAL,
    daysOut: 14,
  })
  // Excluded — 45 days out, beyond the furthest milestone.
  await makeBoard({
    clientId: clientFarId,
    suffix: 'prom-far',
    type: BoardType.PROM,
    daysOut: 45,
  })
  // Excluded — day-of.
  await makeBoard({
    clientId: clientTodayId,
    suffix: 'prom-today',
    type: BoardType.PROM,
    daysOut: 0,
  })

  return {
    tenantId: tenant.id,
    clientEligibleId,
    clientFarId,
    clientTodayId,
    eligibleBoardId,
    userIds,
  }
}

async function countCountdownNotifications(clientId: string): Promise<number> {
  return prisma.clientNotification.count({
    where: {
      clientId,
      eventKey: NotificationEventKey.EVENT_DATE_COUNTDOWN,
    },
  })
}

beforeAll(async () => {
  ids = await seed()
})

afterAll(async () => {
  await cleanup()
})

describe('runEventCountdownNotifications (real DB)', () => {
  it('nudges only the in-window dated board, and is idempotent', async () => {
    const first = await runEventCountdownNotifications(prisma, { now: NOW })

    // At least our three dated boards are in the generous SQL horizon, but only
    // the 14-day board survives the pure milestone filter + budget.
    expect(first.sent).toBe(1)

    expect(await countCountdownNotifications(ids.clientEligibleId)).toBe(1)
    expect(await countCountdownNotifications(ids.clientFarId)).toBe(0)
    expect(await countCountdownNotifications(ids.clientTodayId)).toBe(0)

    // The send created a dispatch — the pooled budget ledger (§8.1).
    const dispatches = await prisma.notificationDispatch.count({
      where: {
        clientId: ids.clientEligibleId,
        eventKey: NotificationEventKey.EVENT_DATE_COUNTDOWN,
      },
    })
    expect(dispatches).toBe(1)

    // The inbox row deep-links to the board and carries the milestone dedupeKey.
    const row = await prisma.clientNotification.findFirst({
      where: {
        clientId: ids.clientEligibleId,
        eventKey: NotificationEventKey.EVENT_DATE_COUNTDOWN,
      },
      select: { href: true, dedupeKey: true, title: true },
    })
    expect(row?.href).toBe(`/client/boards/${ids.eligibleBoardId}`)
    expect(row?.dedupeKey).toBe(`event-countdown:${ids.eligibleBoardId}:14`)
    expect(row?.title).toBe('14 days until your wedding')

    // Idempotent: a second run in the same milestone sends nothing new.
    const second = await runEventCountdownNotifications(prisma, { now: NOW })
    expect(second.sent).toBe(0)
    expect(await countCountdownNotifications(ids.clientEligibleId)).toBe(1)
  })
})
