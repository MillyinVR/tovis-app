// app/api/internal/jobs/last-minute/process/route.test.ts

import {
  LastMinuteOfferType,
  LastMinuteRecipientStatus,
  LastMinuteTier,
  NotificationEventKey,
  OpeningStatus,
  ServiceLocationType,
} from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const NOW = new Date('2026-04-13T18:30:00.000Z')

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  isValidIanaTimeZone: vi.fn(),

  lastMinuteTierPlanFindMany: vi.fn(),
  lastMinuteTierPlanFindUnique: vi.fn(),
  lastMinuteTierPlanUpdate: vi.fn(),
  lastMinuteTierPlanUpdateMany: vi.fn(),
  lastMinuteRecipientFindUnique: vi.fn(),
  lastMinuteRecipientCreate: vi.fn(),
  lastMinuteRecipientUpdate: vi.fn(),
  transaction: vi.fn(),

  upsertClientNotification: vi.fn(),

  buildTier1WaitlistAudience: vi.fn(),
  buildTier2ReactivationAudience: vi.fn(),
  buildTier3DiscoveryAudience: vi.fn(),

  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lastMinuteTierPlan: {
      findMany: mocks.lastMinuteTierPlanFindMany,
      update: mocks.lastMinuteTierPlanUpdate,
      updateMany: mocks.lastMinuteTierPlanUpdateMany,
    },
    lastMinuteRecipient: {
      update: mocks.lastMinuteRecipientUpdate,
    },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/timeZone', () => ({
  isValidIanaTimeZone: mocks.isValidIanaTimeZone,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
}))

vi.mock('@/lib/lastMinute/audience/buildTier1WaitlistAudience', () => ({
  buildTier1WaitlistAudience: mocks.buildTier1WaitlistAudience,
}))

vi.mock('@/lib/lastMinute/audience/buildTier2ReactivationAudience', () => ({
  buildTier2ReactivationAudience: mocks.buildTier2ReactivationAudience,
}))

vi.mock('@/lib/lastMinute/audience/buildTier3DiscoveryAudience', () => ({
  buildTier3DiscoveryAudience: mocks.buildTier3DiscoveryAudience,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { GET, POST } from './route'

type Tx = {
  lastMinuteTierPlan: {
    findUnique: typeof mocks.lastMinuteTierPlanFindUnique
    update: typeof mocks.lastMinuteTierPlanUpdate
  }
  lastMinuteRecipient: {
    findUnique: typeof mocks.lastMinuteRecipientFindUnique
    create: typeof mocks.lastMinuteRecipientCreate
  }
}

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeRequest(args?: {
  method?: 'GET' | 'POST'
  url?: string
  authorization?: string
  internalSecret?: string
}): Request {
  const headers = new Headers()

  if (args?.authorization) {
    headers.set('authorization', args.authorization)
  }

  if (args?.internalSecret) {
    headers.set('x-internal-job-secret', args.internalSecret)
  }

  return new Request(
    args?.url ?? 'http://localhost/api/internal/jobs/last-minute/process',
    {
      method: args?.method ?? 'GET',
      headers,
    },
  )
}

function makePlan(
  overrides?: Partial<{
    id: string
    openingId: string
    tier: LastMinuteTier
    scheduledFor: Date
    offerType: LastMinuteOfferType
    percentOff: number | null
    amountOff: unknown | null
    freeAddOnServiceId: string | null
    freeAddOnService: { id: string; name: string } | null
  }>,
) {
  return {
    id: overrides?.id ?? 'tier_plan_1',
    openingId: overrides?.openingId ?? 'opening_1',
    tier: overrides?.tier ?? LastMinuteTier.WAITLIST,
    scheduledFor:
      overrides?.scheduledFor ?? new Date('2026-04-13T18:00:00.000Z'),
    processedAt: null,
    cancelledAt: null,
    lastError: null,
    offerType: overrides?.offerType ?? LastMinuteOfferType.PERCENT_OFF,
    percentOff: overrides?.percentOff ?? 15,
    amountOff: overrides?.amountOff ?? null,
    freeAddOnServiceId: overrides?.freeAddOnServiceId ?? null,
    freeAddOnService: overrides?.freeAddOnService ?? null,
    opening: {
      id: overrides?.openingId ?? 'opening_1',
      professionalId: 'pro_1',
      status: OpeningStatus.ACTIVE,
      startAt: new Date('2026-04-14T18:00:00.000Z'),
      endAt: new Date('2026-04-14T19:00:00.000Z'),
      bookedAt: null,
      cancelledAt: null,
      timeZone: 'America/Los_Angeles',
      locationType: ServiceLocationType.SALON,
      note: 'Last-minute slot',
      professional: {
        id: 'pro_1',
        businessName: 'TOVIS Studio',
        handle: 'tovis-studio',
        mobileRadiusMiles: null,
      },
      location: {
        lat: 34.05,
        lng: -118.24,
      },
      services: [
        {
          id: 'opening_service_1',
          serviceId: 'service_1',
          offeringId: 'offering_1',
          sortOrder: 0,
          service: {
            id: 'service_1',
            name: 'Gel X',
          },
          offering: {
            id: 'offering_1',
          },
        },
      ],
    },
  }
}

function makeCurrentPlan(
  plan = makePlan(),
  overrides?: Partial<{
    processedAt: Date | null
    cancelledAt: Date | null
    scheduledFor: Date
    openingStatus: OpeningStatus
    openingStartAt: Date
    bookedAt: Date | null
    openingCancelledAt: Date | null
    timeZone: string
  }>,
) {
  return {
    id: plan.id,
    tier: plan.tier,
    openingId: plan.openingId,
    processedAt:
      overrides && 'processedAt' in overrides ? overrides.processedAt : null,
    cancelledAt:
      overrides && 'cancelledAt' in overrides ? overrides.cancelledAt : null,
    scheduledFor: overrides?.scheduledFor ?? plan.scheduledFor,
    opening: {
      id: plan.opening.id,
      status: overrides?.openingStatus ?? OpeningStatus.ACTIVE,
      startAt: overrides?.openingStartAt ?? plan.opening.startAt,
      endAt: plan.opening.endAt,
      bookedAt: overrides && 'bookedAt' in overrides ? overrides.bookedAt : null,
      cancelledAt:
        overrides && 'openingCancelledAt' in overrides
          ? overrides.openingCancelledAt
          : null,
      timeZone: overrides?.timeZone ?? plan.opening.timeZone,
    },
  }
}

function makeTx(): Tx {
  return {
    lastMinuteTierPlan: {
      findUnique: mocks.lastMinuteTierPlanFindUnique,
      update: mocks.lastMinuteTierPlanUpdate,
    },
    lastMinuteRecipient: {
      findUnique: mocks.lastMinuteRecipientFindUnique,
      create: mocks.lastMinuteRecipientCreate,
    },
  }
}

describe('app/api/internal/jobs/last-minute/process/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)

    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET

    process.env.INTERNAL_JOB_SECRET = 'job_secret_1'

    mocks.jsonFail.mockImplementation((status: number, error: string) =>
      makeJsonResponse(status, {
        ok: false,
        error,
      }),
    )

    mocks.jsonOk.mockImplementation((data: Record<string, unknown>) =>
      makeJsonResponse(200, {
        ok: true,
        ...data,
      }),
    )

    mocks.isValidIanaTimeZone.mockReturnValue(true)

    mocks.lastMinuteTierPlanFindMany.mockResolvedValue([])

    mocks.transaction.mockImplementation(
      async (callback: (tx: Tx) => Promise<unknown>) => callback(makeTx()),
    )

    mocks.lastMinuteTierPlanFindUnique.mockImplementation(async () =>
      makeCurrentPlan(),
    )

    mocks.lastMinuteTierPlanUpdate.mockResolvedValue({})
    mocks.lastMinuteTierPlanUpdateMany.mockResolvedValue({ count: 1 })

    mocks.lastMinuteRecipientFindUnique.mockResolvedValue(null)
    mocks.lastMinuteRecipientCreate.mockResolvedValue({ id: 'recipient_1' })
    mocks.lastMinuteRecipientUpdate.mockResolvedValue({})

    mocks.upsertClientNotification.mockResolvedValue({
      id: 'client_notification_1',
    })

    mocks.buildTier1WaitlistAudience.mockResolvedValue([
      {
        clientId: 'client_1',
        matchedTier: LastMinuteTier.WAITLIST,
      },
    ])

    mocks.buildTier2ReactivationAudience.mockResolvedValue([
      {
        clientId: 'client_2',
        matchedTier: LastMinuteTier.REACTIVATION,
      },
    ])

    mocks.buildTier3DiscoveryAudience.mockResolvedValue([
      {
        clientId: 'client_3',
        matchedTier: LastMinuteTier.DISCOVERY,
      },
    ])
  })

  afterEach(() => {
    vi.useRealTimers()

    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET
  })

  it('GET returns 500 when no job secret is configured', async () => {
    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    })

    expect(mocks.lastMinuteTierPlanFindMany).not.toHaveBeenCalled()
  })

  it('GET returns 401 when request is not authorized', async () => {
    const result = await GET(makeRequest())

    expect(result.status).toBe(401)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.lastMinuteTierPlanFindMany).not.toHaveBeenCalled()
  })

  it('GET reads due plans using default take and returns empty result summary', async () => {
    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.lastMinuteTierPlanFindMany).toHaveBeenCalledWith({
      where: {
        processedAt: null,
        cancelledAt: null,
        scheduledFor: {
          lte: NOW,
        },
        opening: {
          status: OpeningStatus.ACTIVE,
          bookedAt: null,
          cancelledAt: null,
        },
      },
      orderBy: [
        { scheduledFor: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: 25,
      select: expect.any(Object),
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 0,
      processedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      createdRecipients: 0,
      failed: [],
      processed: [],
    })
  })

  it('GET clamps take query param to the maximum', async () => {
    await GET(
      makeRequest({
        url: 'http://localhost/api/internal/jobs/last-minute/process?take=999',
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.lastMinuteTierPlanFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
      }),
    )
  })

  it('POST runs the same job path and accepts x-internal-job-secret', async () => {
    const result = await POST(
      makeRequest({
        method: 'POST',
        internalSecret: 'job_secret_1',
      }),
    )

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 0,
      processedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      createdRecipients: 0,
      failed: [],
      processed: [],
    })
  })

  it('processes WAITLIST plan, creates recipient, sends notification, and stores dispatch key', async () => {
    const plan = makePlan({
      id: 'tier_plan_waitlist_1',
      openingId: 'opening_1',
      tier: LastMinuteTier.WAITLIST,
    })

    mocks.lastMinuteTierPlanFindMany.mockResolvedValueOnce([plan])
    mocks.lastMinuteTierPlanFindUnique.mockResolvedValueOnce(
      makeCurrentPlan(plan),
    )

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.buildTier1WaitlistAudience).toHaveBeenCalledWith({
      tx: expect.any(Object),
      opening: plan.opening,
      now: NOW,
    })

    expect(mocks.lastMinuteRecipientFindUnique).toHaveBeenCalledWith({
      where: {
        openingId_clientId: {
          openingId: 'opening_1',
          clientId: 'client_1',
        },
      },
      select: {
        id: true,
      },
    })

    expect(mocks.lastMinuteRecipientCreate).toHaveBeenCalledWith({
      data: {
        openingId: 'opening_1',
        clientId: 'client_1',
        firstMatchedTier: LastMinuteTier.WAITLIST,
        notifiedTier: LastMinuteTier.WAITLIST,
        status: LastMinuteRecipientStatus.ENQUEUED,
        notifiedAt: NOW,
        matchedContext: {
          tier: LastMinuteTier.WAITLIST,
          source: 'last-minute-job',
          scheduledFor: '2026-04-13T18:00:00.000Z',
        },
      },
      select: {
        id: true,
      },
    })

    expect(mocks.lastMinuteTierPlanUpdate).toHaveBeenCalledWith({
      where: {
        id: 'tier_plan_waitlist_1',
      },
      data: {
        processedAt: NOW,
        lastError: null,
      },
    })

    expect(mocks.upsertClientNotification).toHaveBeenCalledWith({
      clientId: 'client_1',
      eventKey: NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE,
      title: 'Last-minute opening available',
      body: expect.stringContaining('TOVIS Studio has a last-minute opening for Gel X'),
      href: '/offerings/offering_1?scheduledFor=2026-04-14T18%3A00%3A00.000Z&source=DISCOVERY&openingId=opening_1&proTimeZone=America%2FLos_Angeles',
      dedupeKey: 'last-minute-opening:opening_1:client:client_1',
      data: expect.objectContaining({
        openingId: 'opening_1',
        professionalId: 'pro_1',
        tier: LastMinuteTier.WAITLIST,
        recipientId: 'recipient_1',
        incentiveLabel: '15% off',
      }),
    })

    expect(mocks.lastMinuteRecipientUpdate).toHaveBeenCalledWith({
      where: {
        id: 'recipient_1',
      },
      data: {
        sourceDispatchKey: 'client-notification:client_notification_1',
      },
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      createdRecipients: 1,
      failed: [],
      processed: [
        {
          id: 'tier_plan_waitlist_1',
          openingId: 'opening_1',
          tier: LastMinuteTier.WAITLIST,
          createdRecipients: 1,
        },
      ],
    })
  })

  it('uses REACTIVATION audience builder for reactivation tier', async () => {
    const plan = makePlan({
      id: 'tier_plan_reactivation_1',
      openingId: 'opening_2',
      tier: LastMinuteTier.REACTIVATION,
    })

    mocks.lastMinuteTierPlanFindMany.mockResolvedValueOnce([plan])
    mocks.lastMinuteTierPlanFindUnique.mockResolvedValueOnce(
      makeCurrentPlan(plan),
    )

    await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.buildTier2ReactivationAudience).toHaveBeenCalledWith({
      tx: expect.any(Object),
      opening: plan.opening,
      now: NOW,
    })

    expect(mocks.buildTier1WaitlistAudience).not.toHaveBeenCalled()
    expect(mocks.buildTier3DiscoveryAudience).not.toHaveBeenCalled()
  })

  it('uses DISCOVERY audience builder for discovery tier', async () => {
    const plan = makePlan({
      id: 'tier_plan_discovery_1',
      openingId: 'opening_3',
      tier: LastMinuteTier.DISCOVERY,
    })

    mocks.lastMinuteTierPlanFindMany.mockResolvedValueOnce([plan])
    mocks.lastMinuteTierPlanFindUnique.mockResolvedValueOnce(
      makeCurrentPlan(plan),
    )

    await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.buildTier3DiscoveryAudience).toHaveBeenCalledWith({
      tx: expect.any(Object),
      opening: plan.opening,
      now: NOW,
    })

    expect(mocks.buildTier1WaitlistAudience).not.toHaveBeenCalled()
    expect(mocks.buildTier2ReactivationAudience).not.toHaveBeenCalled()
  })

  it('skips current plan when it was already processed inside the transaction', async () => {
    const plan = makePlan({
      id: 'tier_plan_skipped_1',
    })

    mocks.lastMinuteTierPlanFindMany.mockResolvedValueOnce([plan])
    mocks.lastMinuteTierPlanFindUnique.mockResolvedValueOnce(
      makeCurrentPlan(plan, {
        processedAt: new Date('2026-04-13T18:20:00.000Z'),
      }),
    )

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.buildTier1WaitlistAudience).not.toHaveBeenCalled()
    expect(mocks.lastMinuteTierPlanUpdate).not.toHaveBeenCalled()
    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 0,
      skippedCount: 1,
      failedCount: 0,
      createdRecipients: 0,
      failed: [],
      processed: [],
    })
  })

  it('marks plan processed with lastError when opening is no longer active', async () => {
    const plan = makePlan({
      id: 'tier_plan_inactive_1',
    })

    mocks.lastMinuteTierPlanFindMany.mockResolvedValueOnce([plan])
    mocks.lastMinuteTierPlanFindUnique.mockResolvedValueOnce(
      makeCurrentPlan(plan, {
        openingStatus: OpeningStatus.CANCELLED,
      }),
    )

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.lastMinuteTierPlanUpdate).toHaveBeenCalledWith({
      where: {
        id: 'tier_plan_inactive_1',
      },
      data: {
        processedAt: NOW,
        lastError: 'Skipped because the opening is no longer active or already started.',
      },
    })

    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      createdRecipients: 0,
      failed: [],
      processed: [
        {
          id: 'tier_plan_inactive_1',
          openingId: 'opening_1',
          tier: LastMinuteTier.WAITLIST,
          createdRecipients: 0,
        },
      ],
    })
  })

  it('marks plan processed with lastError when opening timezone is invalid', async () => {
    const plan = makePlan({
      id: 'tier_plan_bad_tz_1',
    })

    mocks.lastMinuteTierPlanFindMany.mockResolvedValueOnce([plan])
    mocks.lastMinuteTierPlanFindUnique.mockResolvedValueOnce(
      makeCurrentPlan(plan, {
        timeZone: 'Mars/Olympus_Mons',
      }),
    )
    mocks.isValidIanaTimeZone.mockReturnValueOnce(false)

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.lastMinuteTierPlanUpdate).toHaveBeenCalledWith({
      where: {
        id: 'tier_plan_bad_tz_1',
      },
      data: {
        processedAt: NOW,
        lastError: 'Skipped because the opening timezone is invalid.',
      },
    })

    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      createdRecipients: 0,
      failed: [],
      processed: [
        {
          id: 'tier_plan_bad_tz_1',
          openingId: 'opening_1',
          tier: LastMinuteTier.WAITLIST,
          createdRecipients: 0,
        },
      ],
    })
  })

  it('does not create duplicate recipients', async () => {
    const plan = makePlan({
      id: 'tier_plan_duplicate_1',
    })

    mocks.lastMinuteTierPlanFindMany.mockResolvedValueOnce([plan])
    mocks.lastMinuteTierPlanFindUnique.mockResolvedValueOnce(
      makeCurrentPlan(plan),
    )
    mocks.lastMinuteRecipientFindUnique.mockResolvedValueOnce({
      id: 'existing_recipient_1',
    })

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.lastMinuteRecipientCreate).not.toHaveBeenCalled()
    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      createdRecipients: 0,
      failed: [],
      processed: [
        {
          id: 'tier_plan_duplicate_1',
          openingId: 'opening_1',
          tier: LastMinuteTier.WAITLIST,
          createdRecipients: 0,
        },
      ],
    })
  })

  it('records failed plan result and updateMany lastError when processing throws', async () => {
    const plan = makePlan({
      id: 'tier_plan_failed_1',
    })

    mocks.lastMinuteTierPlanFindMany.mockResolvedValueOnce([plan])
    mocks.lastMinuteTierPlanFindUnique.mockRejectedValueOnce(
      new Error('transaction exploded'),
    )

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.lastMinuteTierPlanUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'tier_plan_failed_1',
        processedAt: null,
      },
      data: {
        lastError: 'transaction exploded',
      },
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedCount: 1,
      processedCount: 0,
      skippedCount: 0,
      failedCount: 1,
      createdRecipients: 0,
      failed: [
        {
          id: 'tier_plan_failed_1',
          openingId: 'opening_1',
          tier: LastMinuteTier.WAITLIST,
          error: 'transaction exploded',
        },
      ],
      processed: [],
    })
  })

  it('GET logs safely and returns generic 500 when top-level job scan throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error('db failed for tori@example.com token secret_123')
    mocks.lastMinuteTierPlanFindMany.mockRejectedValueOnce(thrown)

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'GET /api/internal/jobs/last-minute/process error',
      {
        error: {
          name: 'Error',
          message: 'db failed for tori@example.com token secret_123',
        },
      },
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    consoleErrorSpy.mockRestore()
  })

  it('POST logs safely and returns generic 500 when top-level job scan throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error('post db failed for token secret_123')
    mocks.lastMinuteTierPlanFindMany.mockRejectedValueOnce(thrown)

    const result = await POST(
      makeRequest({
        method: 'POST',
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/internal/jobs/last-minute/process error',
      {
        error: {
          name: 'Error',
          message: 'post db failed for token secret_123',
        },
      },
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    consoleErrorSpy.mockRestore()
  })
})