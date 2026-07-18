// app/_components/booking/moneyTrailIdempotency.test.ts
//
// The money-trail inspector's two irreversible actions — REFUND and WAIVE —
// used to mint a fresh `crypto.randomUUID()` per click, so a double-click was
// two distinct server-side actions. These tests drive the REAL refund route
// through the REAL idempotency ledger (only the Stripe-facing refund service
// and the Prisma store are faked) to prove the deterministic key now replays.
//
// Deliberately NOT mocking `withRouteIdempotency` / `beginIdempotency`: a test
// that mocks the dedup layer proves nothing about dedup ([[wire-shape-vs-mock-drift]]).

import { IdempotencyStatus, Role } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'

const BOOKING_ID = 'booking_1'
const PRO_USER_ID = 'user_pro_1'
const PROFESSIONAL_ID = 'pro_1'

// ─── An in-memory stand-in for the IdempotencyKey table ──────────────────────
// Implements exactly the four operations the ledger uses, including the
// (actorKey, route, key) composite unique.

type Row = {
  id: string
  actorUserId: string | null
  actorKey: string
  actorRole: Role
  route: string
  key: string
  requestHash: string
  status: IdempotencyStatus
  lockedUntil: Date
  responseStatus: number | null
  responseBodyJson: unknown
  completedAt: Date | null
}

const store = vi.hoisted(() => ({ rows: [] as Row[], nextId: 1 }))

function findRow(where: {
  actorKey_route_key?: { actorKey: string; route: string; key: string }
}): Row | null {
  const composite = where.actorKey_route_key
  if (!composite) return null
  return (
    store.rows.find(
      (r) =>
        r.actorKey === composite.actorKey &&
        r.route === composite.route &&
        r.key === composite.key,
    ) ?? null
  )
}

const mocks = vi.hoisted(() => ({
  refundBookingPayment: vi.fn(),
  waiveNoShowFee: vi.fn(),
  requireUser: vi.fn(),
  kickNotificationDrain: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: vi.fn(async () => ({
        id: BOOKING_ID,
        professionalId: PROFESSIONAL_ID,
      })),
    },
    idempotencyKey: {
      findUnique: vi.fn(async (args: { where: Parameters<typeof findRow>[0] }) =>
        findRow(args.where),
      ),
      create: vi.fn(async (args: { data: Omit<Row, 'id'> }) => {
        const existing = findRow({
          actorKey_route_key: {
            actorKey: args.data.actorKey,
            route: args.data.route,
            key: args.data.key,
          },
        })
        if (existing) {
          const err: Error & { code?: string } = new Error('Unique constraint')
          err.code = 'P2002'
          throw err
        }

        const row: Row = {
          ...args.data,
          id: `idem_${store.nextId++}`,
          responseStatus: args.data.responseStatus ?? null,
          responseBodyJson: args.data.responseBodyJson ?? null,
          completedAt: args.data.completedAt ?? null,
        }
        store.rows.push(row)
        return { id: row.id }
      }),
      update: vi.fn(
        async (args: { where: { id: string }; data: Partial<Row> }) => {
          const row = store.rows.find((r) => r.id === args.where.id)
          if (!row) throw new Error('Record not found')
          Object.assign(row, args.data)
          return row
        },
      ),
      updateMany: vi.fn(
        async (args: {
          where: {
            id: string
            requestHash: string
            lockedUntil: { lte: Date }
            status: { in: IdempotencyStatus[] }
          }
          data: Partial<Row>
        }) => {
          const row = store.rows.find(
            (r) =>
              r.id === args.where.id &&
              r.requestHash === args.where.requestHash &&
              r.lockedUntil <= args.where.lockedUntil.lte &&
              args.where.status.in.includes(r.status),
          )
          if (!row) return { count: 0 }
          Object.assign(row, args.data)
          return { count: 1 }
        },
      ),
    },
  },
}))

vi.mock('@/lib/prismaErrors', () => ({
  isUniqueConstraintError: (e: unknown) =>
    typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002',
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/lib/booking/refunds', () => ({
  refundBookingPayment: mocks.refundBookingPayment,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  waiveNoShowFee: mocks.waiveNoShowFee,
}))

vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: mocks.kickNotificationDrain,
}))

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: vi.fn(async () => ({ allowed: true })),
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  proRateLimitKey: () => 'rl-key',
}))

vi.mock('@/lib/rateLimit/response', () => ({
  rateLimitExceededResponse: () => new Response('rate limited', { status: 429 }),
}))

import { POST as refundPOST } from '@/app/api/v1/bookings/[id]/refund/route'
import { POST as waivePOST } from '@/app/api/v1/bookings/[id]/no-show-fee/waive/route'

function refundRequest(key: string, body: Record<string, unknown>) {
  return new Request(
    `http://localhost/api/v1/bookings/${BOOKING_ID}/refund`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...idempotencyHeaders(key),
      },
      body: JSON.stringify(body),
    },
  )
}

function waiveRequest(key: string) {
  return new Request(
    `http://localhost/api/v1/bookings/${BOOKING_ID}/no-show-fee/waive`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...idempotencyHeaders(key),
      },
      body: '{}',
    },
  )
}

const ctx = { params: Promise.resolve({ id: BOOKING_ID }) }

describe('money-trail idempotency keys', () => {
  beforeEach(() => {
    store.rows = []
    store.nextId = 1
    vi.clearAllMocks()

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: {
        id: PRO_USER_ID,
        role: Role.PRO,
        professionalProfile: { id: PROFESSIONAL_ID },
      },
    })

    mocks.refundBookingPayment.mockResolvedValue({
      outcome: 'REFUNDED',
      refund: {
        id: 'refund_1',
        bookingId: BOOKING_ID,
        amountCents: 2500,
        currency: 'usd',
        status: 'SUCCEEDED',
      },
      bookingFullyRefunded: false,
    })

    mocks.waiveNoShowFee.mockResolvedValue({
      status: 'WAIVED',
      meta: { mutated: true },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── Key shape ─────────────────────────────────────────────────────────────

  it('refund and waive on the same booking never collide', () => {
    const refundKey = buildClientIdempotencyKey({
      scope: 'money-trail',
      entityId: BOOKING_ID,
      action: 'refund',
    })
    const waiveKey = buildClientIdempotencyKey({
      scope: 'money-trail',
      entityId: BOOKING_ID,
      action: 'waive',
    })

    expect(refundKey).not.toBe(waiveKey)
    expect(refundKey).toMatch(/^money-trail:booking_1:refund:/)
    expect(waiveKey).toMatch(/^money-trail:booking_1:waive:/)
  })

  it('the same intent within a bucket builds the same key; a different booking does not', () => {
    const now = 1_752_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(now)

    const first = buildClientIdempotencyKey({
      scope: 'money-trail',
      entityId: BOOKING_ID,
      action: 'refund',
    })
    const second = buildClientIdempotencyKey({
      scope: 'money-trail',
      entityId: BOOKING_ID,
      action: 'refund',
    })
    const otherBooking = buildClientIdempotencyKey({
      scope: 'money-trail',
      entityId: 'booking_2',
      action: 'refund',
    })

    expect(second).toBe(first)
    expect(otherBooking).not.toBe(first)
  })

  // ─── The behavior that actually matters: driving the real route ────────────

  it('a double-submitted refund REPLAYS — the refund service runs exactly once', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_752_000_000_000)

    // Exactly what the inspector now sends for a full refund, twice — the two
    // clicks land in the same bucket, so they build the identical key.
    const key = buildClientIdempotencyKey({
      scope: 'money-trail',
      entityId: BOOKING_ID,
      action: 'refund',
    })

    const first = await refundPOST(refundRequest(key, {}), ctx)
    const second = await refundPOST(refundRequest(key, {}), ctx)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    // The whole point: the money moved once.
    expect(mocks.refundBookingPayment).toHaveBeenCalledTimes(1)

    // And the second caller still gets the real result, not an error.
    const firstBody = await first.json()
    const secondBody = await second.json()
    expect(secondBody).toEqual(firstBody)
    expect(secondBody.refund.id).toBe('refund_1')
  })

  it('a DIFFERENT refund amount under the same key 409s instead of silently refunding again', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_752_000_000_000)

    const key = buildClientIdempotencyKey({
      scope: 'money-trail',
      entityId: BOOKING_ID,
      action: 'refund',
    })

    const first = await refundPOST(refundRequest(key, { amountCents: 2500 }), ctx)
    const second = await refundPOST(
      refundRequest(key, { amountCents: 9900 }),
      ctx,
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)

    const body = await second.json()
    expect(body.code).toBe('IDEMPOTENCY_KEY_CONFLICT')

    // Still only one actual refund.
    expect(mocks.refundBookingPayment).toHaveBeenCalledTimes(1)
  })

  it('a double-submitted waive REPLAYS — the waive runs exactly once', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_752_000_000_000)

    const key = buildClientIdempotencyKey({
      scope: 'money-trail',
      entityId: BOOKING_ID,
      action: 'waive',
    })

    const first = await waivePOST(waiveRequest(key), ctx)
    const second = await waivePOST(waiveRequest(key), ctx)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(mocks.waiveNoShowFee).toHaveBeenCalledTimes(1)

    expect(await second.json()).toEqual(await first.json())
  })

  it('refund and waive keys stay in separate ledger buckets end-to-end', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_752_000_000_000)

    const refundKey = buildClientIdempotencyKey({
      scope: 'money-trail',
      entityId: BOOKING_ID,
      action: 'refund',
    })
    const waiveKey = buildClientIdempotencyKey({
      scope: 'money-trail',
      entityId: BOOKING_ID,
      action: 'waive',
    })

    // Waiving must NOT be swallowed as a replay of the refund on the same
    // booking in the same bucket — both side effects must run.
    await refundPOST(refundRequest(refundKey, {}), ctx)
    const waive = await waivePOST(waiveRequest(waiveKey), ctx)

    expect(waive.status).toBe(200)
    expect(mocks.refundBookingPayment).toHaveBeenCalledTimes(1)
    expect(mocks.waiveNoShowFee).toHaveBeenCalledTimes(1)
  })

  it('the old random-UUID behavior would have double-refunded (regression guard)', async () => {
    // Two distinct keys — what `crypto.randomUUID()` produced per click.
    const first = await refundPOST(refundRequest('uuid-click-1', {}), ctx)
    const second = await refundPOST(refundRequest('uuid-click-2', {}), ctx)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    // Two side effects. This is the bug the deterministic key removes; the
    // test documents WHY the builders had to be consolidated.
    expect(mocks.refundBookingPayment).toHaveBeenCalledTimes(2)
  })
})
