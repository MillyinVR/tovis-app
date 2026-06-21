import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey, Prisma } from '@prisma/client'

const mockUpsertClientNotification = vi.hoisted(() => vi.fn())
const mockCreateProNotification = vi.hoisted(() => vi.fn())

vi.mock('./clientNotifications', () => ({
  upsertClientNotification: mockUpsertClientNotification,
}))

vi.mock('./proNotifications', () => ({
  createProNotification: mockCreateProNotification,
}))

import {
  emitPaymentActionRequiredNotifications,
  emitPaymentCollectedNotifications,
  emitPaymentRefundedNotifications,
} from './paymentNotifications'

type BookingRow = {
  clientId: string
  professionalId: string
  totalAmount: Prisma.Decimal | null
  stripePaymentIntentId: string | null
  service: { name: string | null } | null
}

const findUnique = vi.fn<() => Promise<BookingRow | null>>()

function makeTx() {
  return {
    booking: {
      findUnique,
    },
  } as unknown as Prisma.TransactionClient
}

const DEFAULT_BOOKING: BookingRow = {
  clientId: 'client_1',
  professionalId: 'pro_1',
  totalAmount: new Prisma.Decimal('120.00'),
  stripePaymentIntentId: 'pi_123',
  service: { name: 'Balayage' },
}

beforeEach(() => {
  mockUpsertClientNotification.mockReset()
  mockCreateProNotification.mockReset()
  mockUpsertClientNotification.mockResolvedValue({ id: 'cn_1' })
  mockCreateProNotification.mockResolvedValue({ id: 'pn_1' })
  findUnique.mockReset()
  findUnique.mockResolvedValue({ ...DEFAULT_BOOKING })
})

describe('emitPaymentCollectedNotifications', () => {
  it('emits a receipt to client and pro exactly once', async () => {
    await emitPaymentCollectedNotifications({
      tx: makeTx(),
      bookingId: 'bk_1',
    })

    expect(mockUpsertClientNotification).toHaveBeenCalledTimes(1)
    expect(mockCreateProNotification).toHaveBeenCalledTimes(1)

    const clientArgs = mockUpsertClientNotification.mock.calls[0]?.[0]
    expect(clientArgs.eventKey).toBe(NotificationEventKey.PAYMENT_COLLECTED)
    expect(clientArgs.clientId).toBe('client_1')
    expect(clientArgs.dedupeKey).toBe('PAYMENT_COLLECTED:bk_1:pi_123')
    expect(clientArgs.body).toContain('$120.00')
    expect(clientArgs.body).toContain('Balayage')

    const proArgs = mockCreateProNotification.mock.calls[0]?.[0]
    expect(proArgs.eventKey).toBe(NotificationEventKey.PAYMENT_COLLECTED)
    expect(proArgs.professionalId).toBe('pro_1')
    expect(proArgs.dedupeKey).toBe('PAYMENT_COLLECTED:bk_1:pi_123')
  })

  it('uses a stable dedupeKey across replays (webhook retries never duplicate)', async () => {
    await emitPaymentCollectedNotifications({ tx: makeTx(), bookingId: 'bk_1' })
    await emitPaymentCollectedNotifications({ tx: makeTx(), bookingId: 'bk_1' })

    const keyA = mockUpsertClientNotification.mock.calls[0]?.[0].dedupeKey
    const keyB = mockUpsertClientNotification.mock.calls[1]?.[0].dedupeKey
    expect(keyA).toBe(keyB)
    // The (clientId, dedupeKey) upsert in the helper collapses these to one row.
  })

  it('does nothing when the booking is missing', async () => {
    findUnique.mockResolvedValueOnce(null)

    await emitPaymentCollectedNotifications({ tx: makeTx(), bookingId: 'gone' })

    expect(mockUpsertClientNotification).not.toHaveBeenCalled()
    expect(mockCreateProNotification).not.toHaveBeenCalled()
  })
})

describe('emitPaymentActionRequiredNotifications', () => {
  it('emits an action-required alert to client and pro', async () => {
    await emitPaymentActionRequiredNotifications({
      tx: makeTx(),
      bookingId: 'bk_2',
      stripePaymentIntentId: 'pi_999',
    })

    const clientArgs = mockUpsertClientNotification.mock.calls[0]?.[0]
    expect(clientArgs.eventKey).toBe(
      NotificationEventKey.PAYMENT_ACTION_REQUIRED,
    )
    expect(clientArgs.dedupeKey).toBe('PAYMENT_ACTION_REQUIRED:bk_2:pi_999')

    const proArgs = mockCreateProNotification.mock.calls[0]?.[0]
    expect(proArgs.eventKey).toBe(NotificationEventKey.PAYMENT_ACTION_REQUIRED)
    expect(proArgs.dedupeKey).toBe('PAYMENT_ACTION_REQUIRED:bk_2:pi_999')
  })
})

describe('emitPaymentRefundedNotifications', () => {
  it('emits a refund receipt keyed by the refund discriminator', async () => {
    await emitPaymentRefundedNotifications({
      tx: makeTx(),
      bookingId: 'bk_3',
      refundDiscriminator: 're_abc',
      amountRefundedCents: 5000,
    })

    const clientArgs = mockUpsertClientNotification.mock.calls[0]?.[0]
    expect(clientArgs.eventKey).toBe(NotificationEventKey.PAYMENT_REFUNDED)
    expect(clientArgs.dedupeKey).toBe('PAYMENT_REFUNDED:bk_3:re_abc')
    expect(clientArgs.body).toContain('$50.00')

    const proArgs = mockCreateProNotification.mock.calls[0]?.[0]
    expect(proArgs.eventKey).toBe(NotificationEventKey.PAYMENT_REFUNDED)
    expect(proArgs.dedupeKey).toBe('PAYMENT_REFUNDED:bk_3:re_abc')
  })

  it('distinct refund ids produce distinct dedupeKeys (partial refunds)', async () => {
    await emitPaymentRefundedNotifications({
      tx: makeTx(),
      bookingId: 'bk_3',
      refundDiscriminator: 're_1',
      amountRefundedCents: 1000,
    })
    await emitPaymentRefundedNotifications({
      tx: makeTx(),
      bookingId: 'bk_3',
      refundDiscriminator: 're_2',
      amountRefundedCents: 2000,
    })

    expect(mockUpsertClientNotification.mock.calls[0]?.[0].dedupeKey).toBe(
      'PAYMENT_REFUNDED:bk_3:re_1',
    )
    expect(mockUpsertClientNotification.mock.calls[1]?.[0].dedupeKey).toBe(
      'PAYMENT_REFUNDED:bk_3:re_2',
    )
  })
})
