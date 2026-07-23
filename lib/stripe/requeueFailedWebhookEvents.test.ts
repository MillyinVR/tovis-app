import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  transaction: vi.fn(),
  txUpdate: vi.fn(),
  update: vi.fn(),
  handleStripeEvent: vi.fn(),
  captureException: vi.fn(),
  applyLateCaptureCancelRefund: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    stripeWebhookEvent: { findMany: mocks.findMany, update: mocks.update },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/stripe/handleWebhookEvent', () => ({
  handleStripeEvent: mocks.handleStripeEvent,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureException,
}))

vi.mock('@/lib/booking/cancelRefund', () => ({
  applyLateCaptureCancelRefund: mocks.applyLateCaptureCancelRefund,
}))

import { requeueFailedStripeWebhookEvents } from '@/lib/stripe/requeueFailedWebhookEvents'

type RowOverrides = {
  id?: string
  stripeEventId?: string
  eventType?: string
  payload?: unknown
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_1',
    type: 'charge.refunded',
    data: { object: { id: 'ch_1' } },
    ...overrides,
  }
}

function failedRow(overrides: RowOverrides = {}) {
  return {
    id: overrides.id ?? 'whe_1',
    stripeEventId: overrides.stripeEventId ?? 'evt_1',
    eventType: overrides.eventType ?? 'charge.refunded',
    payload: 'payload' in overrides ? overrides.payload : validPayload(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: $transaction runs its callback with a tx stub exposing the update.
  mocks.transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb({ stripeWebhookEvent: { update: mocks.txUpdate } }),
  )
  mocks.txUpdate.mockResolvedValue({})
  mocks.update.mockResolvedValue({})
  mocks.handleStripeEvent.mockResolvedValue({ handled: true, message: 'charge.refunded reconciled.' })
})

describe('requeueFailedStripeWebhookEvents', () => {
  // M1: a replay that applied money onto an already-CANCELLED booking must run
  // the late-capture cancel refund AFTER the replay transaction commits.
  it('settles a late capture on a cancelled booking after the replay commits', async () => {
    mocks.findMany.mockResolvedValue([failedRow()])
    mocks.handleStripeEvent.mockResolvedValue({
      handled: true,
      message: 'payment_intent.succeeded marked booking paid.',
      lateCaptureRefund: { bookingId: 'booking_1', flavor: 'SERVICE' },
    })

    const run = await requeueFailedStripeWebhookEvents()

    expect(run.tally.reprocessed).toBe(1)
    expect(mocks.applyLateCaptureCancelRefund).toHaveBeenCalledExactlyOnceWith({
      bookingId: 'booking_1',
      flavor: 'SERVICE',
    })
  })

  it('replays a failed event and marks it processed', async () => {
    mocks.findMany.mockResolvedValue([failedRow()])

    const run = await requeueFailedStripeWebhookEvents()

    expect(run.tally.reprocessed).toBe(1)
    expect(mocks.applyLateCaptureCancelRefund).not.toHaveBeenCalled()
    expect(mocks.handleStripeEvent).toHaveBeenCalledTimes(1)
    // The stored payload is passed straight through as the Stripe event.
    expect(mocks.handleStripeEvent.mock.calls[0]![1]).toMatchObject({
      id: 'evt_1',
      type: 'charge.refunded',
    })
    // Marked processed + failure cleared inside the transaction.
    expect(mocks.txUpdate).toHaveBeenCalledWith({
      where: { id: 'whe_1' },
      data: { processedAt: expect.any(Date), failedAt: null, lastError: null },
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('marks an event processed even when the handler finds no booking', async () => {
    mocks.findMany.mockResolvedValue([failedRow()])
    mocks.handleStripeEvent.mockResolvedValue({
      handled: false,
      message: 'charge.refunded booking not found.',
    })

    const run = await requeueFailedStripeWebhookEvents()

    expect(run.tally.reprocessed).toBe(1)
    expect(run.results[0]!.handled).toBe(false)
    expect(mocks.txUpdate).toHaveBeenCalledTimes(1)
  })

  it('classifies a row with no replayable payload as invalid_payload without calling the handler', async () => {
    mocks.findMany.mockResolvedValue([
      failedRow({ id: 'whe_null', payload: null }),
      failedRow({ id: 'whe_garbage', payload: { not: 'an event' } }),
    ])

    const run = await requeueFailedStripeWebhookEvents()

    expect(run.tally.invalid_payload).toBe(2)
    expect(mocks.handleStripeEvent).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('re-stamps failedAt and reports still_failing when the replay throws', async () => {
    mocks.findMany.mockResolvedValue([failedRow()])
    mocks.handleStripeEvent.mockRejectedValue(new Error('still broken'))

    const run = await requeueFailedStripeWebhookEvents()

    expect(run.tally.still_failing).toBe(1)
    expect(mocks.captureException).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'whe_1' },
      data: { failedAt: expect.any(Date), lastError: 'still broken' },
    })
  })

  it('isolates one replay failure from the rest of the sweep', async () => {
    mocks.findMany.mockResolvedValue([
      failedRow({ id: 'whe_bad', stripeEventId: 'evt_bad' }),
      failedRow({ id: 'whe_ok', stripeEventId: 'evt_ok' }),
    ])
    // First replay throws, second succeeds.
    mocks.handleStripeEvent
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ handled: true, message: 'ok' })

    const run = await requeueFailedStripeWebhookEvents()

    expect(run.tally.still_failing).toBe(1)
    expect(run.tally.reprocessed).toBe(1)
  })

  it('flags a capped run so truncation is never silent', async () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      failedRow({ id: `whe_${i}`, stripeEventId: `evt_${i}` }),
    )
    mocks.findMany.mockResolvedValue(many)

    const run = await requeueFailedStripeWebhookEvents()

    expect(run.candidatesScanned).toBe(100)
    expect(run.capped).toBe(true)
  })

  it('queries only stuck events past the min-age and within the window', async () => {
    mocks.findMany.mockResolvedValue([])
    const now = new Date('2026-06-24T12:00:00Z')

    await requeueFailedStripeWebhookEvents({ now })

    const args = mocks.findMany.mock.calls[0]![0]
    expect(args.take).toBe(100)
    expect(args.where.processedAt).toBeNull()
    expect(args.where.failedAt).toEqual({
      gte: new Date('2026-06-17T12:00:00Z'), // now - 7 days
      lte: new Date('2026-06-24T11:30:00Z'), // now - 30 minutes
    })
  })
})
