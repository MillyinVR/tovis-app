// tests/integration/consult-stall-nudge.test.ts
//
// The unfinished-consult half of the 2026-09-13 reliability work, against real
// Postgres.
//
// Unit tests cover the selection rules. What they cannot cover is the half that
// only a database can answer: a grouped query over sessions, the input-window
// rule applied to a REAL anchor, the capture counts that decide whether the copy
// is allowed to say "pick up where you left off" — and whether a second run of
// the same cron sends a second message.
//
// The shared test DB is SEEDED and other suites' consults live in it, so every
// count here is asserted as a DELTA against a baseline taken in the same run,
// never as an absolute.

import { ConsultSessionStatus, PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
})

vi.mock('@/lib/consult/captureStorage', async () => {
  const fakes = await import('./_support/consultLookFakes')
  return fakes.buildFakeCaptureStorageModule()
})

vi.mock('@/lib/consult/inspirationImage', async () => {
  const fakes = await import('./_support/consultLookFakes')
  return { fetchConsultInspirationImage: fakes.fakeFetchConsultInspirationImage }
})

import { NotificationEventKey } from '@prisma/client'

import { GET as consultHealthRoute } from '@/app/api/internal/jobs/consult-health/route'
import { GET as stalledConsultRoute } from '@/app/api/internal/jobs/stalled-consult/route'

import { readConsultStallFunnel } from '@/lib/consult/stallFunnel'
import { startLookAnchoredConsult } from '@/lib/consult/lookConsultEntry'
import {
  gatherStalledConsultCandidates,
  runStalledConsultNudges,
} from '@/lib/notifications/stalledConsultNudge'
import {
  createLook,
  fx,
  seedLookConsultFixture,
  teardownLookConsultFixture,
} from './_support/lookConsultFixture'

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: npm run test:integration',
  )
}

const db = new PrismaClient()
const NOW = new Date()
const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS)

let stalledId = ''
let freshId = ''

/**
 * Backdate a consult's last activity.
 *
 * Raw SQL because `updatedAt` is `@updatedAt` — Prisma overwrites it with the
 * clock on every write it makes, so the ONE thing this test needs to control is
 * the one thing the ORM will not let it set.
 */
async function idleSince(consultSessionId: string, when: Date): Promise<void> {
  await db.$executeRaw`
    UPDATE "ConsultSession" SET "updatedAt" = ${when} WHERE "id" = ${consultSessionId}
  `
}

beforeAll(async () => {
  await seedLookConsultFixture(db, { tagPrefix: 'consult_stall' })

  const stalled = await startLookAnchoredConsult({
    lookPostId: await createLook(db, fx.balayageServiceId),
    clientId: fx.clientId,
    actorUserId: fx.clientUserId,
  })
  stalledId = stalled.id
  await idleSince(stalledId, daysAgo(10))

  // A second consult for the SAME client, touched yesterday. It must never be
  // chosen — both because it is inside the idle floor and because one client
  // gets at most one reminder.
  const fresh = await startLookAnchoredConsult({
    lookPostId: await createLook(db, fx.glossServiceId),
    clientId: fx.clientId,
    actorUserId: fx.clientUserId,
  })
  freshId = fresh.id
  await idleSince(freshId, daysAgo(1))
}, 120_000)

afterAll(async () => {
  await teardownLookConsultFixture(db, async () => {
    await db.clientNotification.deleteMany({ where: { clientId: fx.clientId } })
    await db.consultSession.deleteMany({
      where: { id: { in: [stalledId, freshId] } },
    })
  })
  await db.$disconnect()
})

describe('the stall funnel counts what nothing was counting', () => {
  it('counts the idle consult under its own status, and marks whose move is next', async () => {
    const report = await readConsultStallFunnel({ now: NOW, minAgeHours: 24 })

    const row = report.byStatus.find(
      (item) => item.status === ConsultSessionStatus.CONSENT_REQUIRED,
    )
    expect(row).toBeDefined()
    expect(row!.sessions).toBeGreaterThanOrEqual(1)
    // A consult sitting at CONSENT_REQUIRED is waiting on HER, and that flag is
    // what decides whether it may ever be nudged.
    expect(row!.awaitingClient).toBe(true)
    expect(row!.oldestAgeHours).toBeGreaterThanOrEqual(24)
    expect(report.awaitingClient + report.awaitingSystem).toBe(report.totalStalled)
  })

  it('does not count a consult touched inside the window', async () => {
    // The 1-day-idle consult is excluded by a 48h floor and included by a 12h
    // one — the same row, so this measures the bound and nothing else.
    const tight = await readConsultStallFunnel({ now: NOW, minAgeHours: 48 })
    const loose = await readConsultStallFunnel({ now: NOW, minAgeHours: 12 })
    expect(loose.totalStalled).toBeGreaterThan(tight.totalStalled)
  })
})

describe('the nudge, end to end', () => {
  it('picks the idle consult and tells the truth about the photos', async () => {
    const gathered = await gatherStalledConsultCandidates(db, { now: NOW })
    const mine = gathered.candidates.filter((c) => c.clientId === fx.clientId)

    // One client, one reminder — and it is the consult she left, not the one
    // she touched yesterday.
    expect(mine).toHaveLength(1)
    expect(mine[0]!.consultSessionId).toBe(stalledId)
    // She never got as far as a photo on this consult, so the copy must not
    // mention one at all.
    expect(mine[0]!.photoState).toBe('START')

    const summary = await runStalledConsultNudges(db, { now: NOW })
    expect(summary.sent).toBeGreaterThanOrEqual(1)

    const sent = await db.clientNotification.findMany({
      where: {
        clientId: fx.clientId,
        eventKey: NotificationEventKey.CONSULT_STALLED_NUDGE,
      },
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.href).toBe(`/client/consult/${stalledId}`)
    expect(sent[0]!.body).not.toContain('expired')
    expect(sent[0]!.body).not.toContain('photo')
  })

  it('🔴 sends nothing on a second run — one reminder, not a campaign', async () => {
    const before = await db.clientNotification.count({
      where: {
        clientId: fx.clientId,
        eventKey: NotificationEventKey.CONSULT_STALLED_NUDGE,
      },
    })
    const summary = await runStalledConsultNudges(db, { now: NOW })
    expect(summary.candidates).toBe(0)

    const after = await db.clientNotification.count({
      where: {
        clientId: fx.clientId,
        eventKey: NotificationEventKey.CONSULT_STALLED_NUDGE,
      },
    })
    expect(after).toBe(before)
  })
})

describe('🔴 the cron routes themselves', () => {
  // The recurring failure mode this guards against: the library is correct, the
  // tests are green, and the artifact is broken because nobody ever opened it.
  const request = (path: string, headers?: Record<string, string>) =>
    new Request(`http://internal${path}`, { headers })

  it('refuses an unauthenticated caller', async () => {
    vi.stubEnv('INTERNAL_JOB_SECRET', 'stall-route-secret')
    expect(
      (await stalledConsultRoute(request('/api/internal/jobs/stalled-consult')))
        .status,
    ).toBe(401)
  })

  it('runs the nudge cron end to end', async () => {
    vi.stubEnv('INTERNAL_JOB_SECRET', 'stall-route-secret')
    // The unified dispatcher is OFF by default in production, so THIS route is
    // the path that actually runs — which is why it is driven here rather than
    // only the function underneath it.
    vi.stubEnv('ENABLE_UNIFIED_REENGAGEMENT_DISPATCH', '')
    const response = await stalledConsultRoute(
      request('/api/internal/jobs/stalled-consult', {
        authorization: 'Bearer stall-route-secret',
      }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.scanCapped).toBe(false)
    expect(typeof body.sent).toBe('number')
  })

  it('no-ops while the unified dispatcher owns the trigger', async () => {
    vi.stubEnv('INTERNAL_JOB_SECRET', 'stall-route-secret')
    vi.stubEnv('ENABLE_UNIFIED_REENGAGEMENT_DISPATCH', '1')
    const response = await stalledConsultRoute(
      request('/api/internal/jobs/stalled-consult', {
        authorization: 'Bearer stall-route-secret',
      }),
    )
    expect(await response.json()).toMatchObject({
      skipped: true,
      reason: 'unified-dispatch',
      sent: 0,
    })
    vi.unstubAllEnvs()
  })

  it('reports the stall funnel from the daily health cron', async () => {
    vi.stubEnv('INTERNAL_JOB_SECRET', 'stall-route-secret')
    const response = await consultHealthRoute(
      request('/api/internal/jobs/consult-health', {
        authorization: 'Bearer stall-route-secret',
      }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    // The funnel now rides the same daily job as the provider meter.
    expect(typeof body.totalStalled).toBe('number')
    expect(body.awaitingClient + body.awaitingSystem).toBe(body.totalStalled)
    vi.unstubAllEnvs()
  })
})
