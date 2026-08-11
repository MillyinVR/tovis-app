import type { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prisma } from '@/lib/prisma'

const mocks = vi.hoisted(() => ({
  loadMuted: vi.fn(),
  loadBudgetCounts: vi.fn(),
  upsert: vi.fn(),
  queryRaw: vi.fn(),
}))

vi.mock('@/lib/consult/access', () => ({
  isAiConsultC6ExposureEnabledForPro: () => true,
  isAiConsultC6ExposurePossible: () => true,
}))

vi.mock('@/lib/consult/eligibility', () => ({
  AI_CONSULT_ELIGIBILITY_BOOKING_SELECT: {},
  evaluateAiConsultBookingEligibility: () => ({ eligible: true }),
}))

vi.mock('@/lib/notifications/reEngagementLedger', () => ({
  loadMutedClientsForEvent: mocks.loadMuted,
  loadReEngagementBudgetCounts: mocks.loadBudgetCounts,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsert,
}))

import { maybeCreateAiConsultInvitation } from './aiConsultInvitation'

function tx(): Prisma.TransactionClient {
  const db: Prisma.TransactionClient = Object.create(prisma)
  Object.defineProperties(db, {
    booking: {
      value: {
        findFirst: vi.fn().mockResolvedValue({
          professionalId: 'pro_1',
          sourceConsultSessionId: null,
          consultSession: null,
        }),
      },
    },
    $queryRaw: { value: mocks.queryRaw },
    clientNotification: {
      value: { findFirst: vi.fn().mockResolvedValue(null) },
    },
  })
  return db
}

describe('booking-confirmation AI consult invitation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadMuted.mockResolvedValue(new Set())
    mocks.loadBudgetCounts.mockResolvedValue(new Map([['client_1', 0]]))
    mocks.upsert.mockResolvedValue({ id: 'notification_1' })
    mocks.queryRaw.mockResolvedValue([{ id: 'client_1' }])
  })

  it('creates one deduped content-free invitation through the standard fabric', async () => {
    const db = tx()
    await expect(
      maybeCreateAiConsultInvitation({
        tx: db,
        bookingId: 'booking_1',
        clientId: 'client_1',
        now: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ).resolves.toBe('CREATED')

    expect(mocks.queryRaw).toHaveBeenCalledOnce()
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tx: db,
        clientId: 'client_1',
        bookingId: 'booking_1',
        dedupeKey: 'AI_CONSULT_INVITATION:booking_1',
      }),
    )
    expect(JSON.stringify(mocks.upsert.mock.calls[0])).not.toMatch(
      /storagePath|storageBucket|base64|signedUrl/,
    )
  })

  it('does not enqueue when the pooled weekly budget is exhausted', async () => {
    mocks.loadBudgetCounts.mockResolvedValue(new Map([['client_1', 3]]))

    await expect(
      maybeCreateAiConsultInvitation({
        tx: tx(),
        bookingId: 'booking_1',
        clientId: 'client_1',
        now: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ).resolves.toBe('BUDGET_EXHAUSTED')
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('honors a complete per-event opt-out before spending budget', async () => {
    mocks.loadMuted.mockResolvedValue(new Set(['client_1']))

    await expect(
      maybeCreateAiConsultInvitation({
        tx: tx(),
        bookingId: 'booking_1',
        clientId: 'client_1',
        now: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ).resolves.toBe('MUTED')
    expect(mocks.loadBudgetCounts).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('does not invite a booking already attributed to a completed consult', async () => {
    const db = tx()
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      professionalId: 'pro_1',
      sourceConsultSessionId: 'consult_1',
      consultSession: null,
    } as never)

    await expect(
      maybeCreateAiConsultInvitation({
        tx: db,
        bookingId: 'booking_1',
        clientId: 'client_1',
        now: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ).resolves.toBe('ALREADY_HAS_CONSULT')
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
