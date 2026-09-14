// tests/integration/consult-provider-health.test.ts
//
// The daily provider-health rollup, against real Postgres.
//
// Unit tests cover the threshold rule; what they cannot cover is the half that
// actually broke on 2026-09-13 — two grouped queries over a growing table, one
// of them grouping by a NULLABLE column behind a `not` filter, plus a window
// bound. This file drives `readConsultProviderHealth` over rows it really
// wrote, reproducing the production numbers that went unreported for days.

import { ConsultProviderCallKind, ConsultProviderCallOutcome, PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
})

const sentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  withScope: vi.fn((fn: (scope: unknown) => void) =>
    fn({
      setLevel: vi.fn(),
      setTag: vi.fn(),
      setContext: vi.fn(),
      setFingerprint: vi.fn(),
    }),
  ),
}))
vi.mock('@sentry/nextjs', () => sentry)

vi.mock('@/lib/consult/captureStorage', async () => {
  const fakes = await import('./_support/consultLookFakes')
  return fakes.buildFakeCaptureStorageModule()
})

vi.mock('@/lib/consult/inspirationImage', async () => {
  const fakes = await import('./_support/consultLookFakes')
  return { fetchConsultInspirationImage: fakes.fakeFetchConsultInspirationImage }
})

import { GET as consultHealthRoute } from '@/app/api/internal/jobs/consult-health/route'
import { readConsultProviderHealth } from '@/lib/consult/providerHealth'
import { startLookAnchoredConsult } from '@/lib/consult/lookConsultEntry'
import {
  createLook,
  fx,
  seedLookConsultFixture,
  teardownLookConsultFixture,
} from './_support/lookConsultFixture'

const db = new PrismaClient()
let consultSessionId = ''

/**
 * The anchor for every seeded row.
 *
 * 🔴 REAL now, not a fixed date. The window assertions below pass their own
 * `now` and are exact either way, but the cron ROUTE reads `new Date()` — so
 * rows pinned to a hardcoded calendar day would fall out of its 24h window the
 * next morning and fail a test that had nothing wrong with it.
 */
const NOW = new Date()
const hoursAgo = (hours: number) =>
  new Date(NOW.getTime() - hours * 60 * 60 * 1000)

async function call(args: {
  kind: ConsultProviderCallKind
  outcome: ConsultProviderCallOutcome
  failureCheck?: string | null
  costMicroUsd?: number
  createdAt: Date
}) {
  await db.consultProviderCall.create({
    data: {
      consultSessionId,
      kind: args.kind,
      outcome: args.outcome,
      model: 'claude-sonnet-5',
      latencyMs: 1000,
      costMicroUsd: args.costMicroUsd ?? 20_000,
      failureCheck: args.failureCheck ?? null,
      createdAt: args.createdAt,
    },
  })
}

beforeAll(async () => {
  await seedLookConsultFixture(db, { tagPrefix: 'consult_health' })
  const lookPostId = await createLook(db, fx.balayageServiceId)
  const consult = await startLookAnchoredConsult({
    lookPostId,
    clientId: fx.clientId,
    actorUserId: fx.clientUserId,
  })
  consultSessionId = consult.id

  // The real 2026-09-13 shape: INSPIRATION_READ at 4 bad in 9.
  for (let i = 0; i < 5; i += 1) {
    await call({
      kind: ConsultProviderCallKind.INSPIRATION_READ,
      outcome: ConsultProviderCallOutcome.OK,
      createdAt: hoursAgo(3),
    })
  }
  for (const check of ['region_containment', 'region_containment', 'confidence', 'envelope']) {
    await call({
      kind: ConsultProviderCallKind.INSPIRATION_READ,
      outcome: ConsultProviderCallOutcome.BAD_OUTPUT,
      failureCheck: check,
      createdAt: hoursAgo(3),
    })
  }
  // A healthy kind, which must stay out of the alerts.
  for (let i = 0; i < 6; i += 1) {
    await call({
      kind: ConsultProviderCallKind.CAPTURE_GATE,
      outcome: ConsultProviderCallOutcome.OK,
      createdAt: hoursAgo(2),
    })
  }
  // A failure with no recorded check — an older row, pre-migration.
  await call({
    kind: ConsultProviderCallKind.CAPTURE_GATE,
    outcome: ConsultProviderCallOutcome.UNAVAILABLE,
    failureCheck: null,
    createdAt: hoursAgo(2),
  })
  // Outside the 24h window: must not be counted at all.
  for (let i = 0; i < 20; i += 1) {
    await call({
      kind: ConsultProviderCallKind.ANALYSIS_DIRECTION,
      outcome: ConsultProviderCallOutcome.BAD_OUTPUT,
      failureCheck: 'text_empty',
      createdAt: hoursAgo(30),
    })
  }
}, 120_000)

afterAll(async () => {
  await teardownLookConsultFixture(db, async () => {
    await db.consultProviderCall.deleteMany({ where: { consultSessionId } })
    await db.consultSession.deleteMany({ where: { id: consultSessionId } })
  })
  await db.$disconnect()
})

describe('consult provider health, against real Postgres', () => {
  it('aggregates the window and raises the inspiration read', async () => {
    const report = await readConsultProviderHealth({ now: NOW })

    const inspiration = report.byKind.find(
      (row) => row.kind === ConsultProviderCallKind.INSPIRATION_READ,
    )
    expect(inspiration).toMatchObject({
      totalCalls: 9,
      okCalls: 5,
      failedCalls: 4,
      badOutputCalls: 4,
      failureRate: 0.4444,
    })
    // Grouping by the nullable failureCheck, ranked — the half that only a real
    // database can prove.
    expect(inspiration?.topFailureChecks).toEqual([
      { check: 'region_containment', count: 2 },
      expect.objectContaining({ count: 1 }),
      expect.objectContaining({ count: 1 }),
    ])

    expect(report.alerts.map((alert) => alert.kind)).toEqual([
      ConsultProviderCallKind.INSPIRATION_READ,
    ])
  })

  it('counts an unnamed failure in the totals without inventing a check', async () => {
    const report = await readConsultProviderHealth({ now: NOW })
    const gate = report.byKind.find(
      (row) => row.kind === ConsultProviderCallKind.CAPTURE_GATE,
    )
    // 1 failure in 7 — counted, below the alert rate, and with nothing to name.
    expect(gate).toMatchObject({ totalCalls: 7, failedCalls: 1 })
    expect(gate?.topFailureChecks).toEqual([])
    expect(report.alerts.map((alert) => alert.kind)).not.toContain(
      ConsultProviderCallKind.CAPTURE_GATE,
    )
  })

  it('excludes everything older than the window', async () => {
    const report = await readConsultProviderHealth({ now: NOW })
    expect(
      report.byKind.find(
        (row) => row.kind === ConsultProviderCallKind.ANALYSIS_DIRECTION,
      ),
    ).toBeUndefined()
    expect(report.totalCalls).toBe(16)
    // …and is picked up when the window is widened to reach it.
    const wide = await readConsultProviderHealth({ now: NOW, windowHours: 48 })
    expect(
      wide.byKind.find(
        (row) => row.kind === ConsultProviderCallKind.ANALYSIS_DIRECTION,
      ),
    ).toMatchObject({ totalCalls: 20, failedCalls: 20, failureRate: 1 })
  })

  it('sums cost across the window', async () => {
    const report = await readConsultProviderHealth({ now: NOW })
    expect(report.costMicroUsd).toBe(16 * 20_000)
  })
})

describe('the cron route itself', () => {
  const request = (headers?: Record<string, string>) =>
    new Request('http://internal/api/internal/jobs/consult-health', { headers })

  it('refuses an unauthenticated caller', async () => {
    vi.stubEnv('INTERNAL_JOB_SECRET', 'health-route-secret')
    const response = await consultHealthRoute(request())
    expect(response.status).toBe(401)
  })

  it('runs, reports, and pages once for the unhealthy kind', async () => {
    vi.stubEnv('INTERNAL_JOB_SECRET', 'health-route-secret')
    sentry.captureMessage.mockClear()
    const response = await consultHealthRoute(
      request({ authorization: 'Bearer health-route-secret' }),
    )
    expect(response.status).toBe(200)
    // `jsonOk` spreads its payload flat — there is no `data` envelope.
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      alerted: [ConsultProviderCallKind.INSPIRATION_READ],
      totalCalls: 16,
      failedCalls: 5,
    })
    // One issue for the one broken kind — not one per failed call.
    expect(sentry.captureMessage).toHaveBeenCalledOnce()
    expect(sentry.captureMessage.mock.calls[0]?.[0]).toContain('INSPIRATION_READ')
  })
})
