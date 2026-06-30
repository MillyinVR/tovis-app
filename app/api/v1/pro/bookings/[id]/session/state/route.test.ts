// app/api/v1/pro/bookings/[id]/session/state/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingStatus,
  ConsultationApprovalStatus,
  SessionStep,
} from '@prisma/client'

import {
  buildProSessionState,
  computeProSessionStateHash,
  type ProSessionStateBookingRow,
} from '@/lib/proSession/sessionState'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),
  bookingFindFirst: vi.fn(),
  safeError: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findFirst: mocks.bookingFindFirst,
    },
  },
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { GET } from './route'

const PRO_ID = 'pro_1'

function makeBookingRow(
  overrides: Partial<ProSessionStateBookingRow & { professionalId: string }> = {},
): ProSessionStateBookingRow & { professionalId: string } {
  return {
    id: 'booking_1',
    professionalId: PRO_ID,
    status: BookingStatus.IN_PROGRESS,
    sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
    startedAt: new Date('2026-06-09T10:00:00.000Z'),
    finishedAt: null,
    updatedAt: new Date('2026-06-09T10:05:00.000Z'),
    checkoutStatus: BookingCheckoutStatus.NOT_READY,
    selectedPaymentMethod: null,
    paymentCollectedAt: null,
    paymentAuthorizedAt: null,
    stripePaymentStatus: null,
    consultationApproval: {
      status: ConsultationApprovalStatus.PENDING,
      approvedAt: null,
      rejectedAt: null,
      updatedAt: new Date('2026-06-09T10:01:00.000Z'),
      proof: null,
    },
    aftercareSummary: null,
    ...overrides,
  }
}

function makeRequest(): Request {
  return new Request(
    'http://localhost/api/v1/pro/bookings/booking_1/session/state',
    { method: 'GET' },
  )
}

function makeCtx(id = 'booking_1') {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.requirePro.mockResolvedValue({
    ok: true,
    professionalId: PRO_ID,
    proId: PRO_ID,
    userId: 'user_1',
    user: { id: 'user_1' },
  })

  mocks.pickString.mockImplementation((value: unknown) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  })

  mocks.jsonOk.mockImplementation((body: unknown, status: number) => ({
    kind: 'ok',
    body,
    status,
  }))

  mocks.jsonFail.mockImplementation((status: number, message: string) => ({
    kind: 'fail',
    status,
    message,
  }))
})

describe('GET /api/v1/pro/bookings/[id]/session/state', () => {
  it('returns the auth failure response when requirePro fails', async () => {
    const failRes = { kind: 'auth-fail' }
    mocks.requirePro.mockResolvedValue({ ok: false, res: failRes })

    const res = await GET(makeRequest(), makeCtx())

    expect(res).toBe(failRes)
    expect(mocks.bookingFindFirst).not.toHaveBeenCalled()
  })

  it('fails with 400 when the booking id is missing', async () => {
    const res = await GET(makeRequest(), makeCtx('   '))

    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Missing booking id.')
    expect(res).toMatchObject({ kind: 'fail', status: 400 })
    expect(mocks.bookingFindFirst).not.toHaveBeenCalled()
  })

  it('fails with 404 when the booking does not exist', async () => {
    mocks.bookingFindFirst.mockResolvedValue(null)

    const res = await GET(makeRequest(), makeCtx())

    expect(res).toMatchObject({ kind: 'fail', status: 404 })
  })

  it('fails with 404 when the booking belongs to another pro', async () => {
    // The ownership query is scoped to the pro, so a foreign booking returns
    // no row and is indistinguishable from a missing one: both 404.
    mocks.bookingFindFirst.mockResolvedValue(null)

    const res = await GET(makeRequest(), makeCtx())

    expect(res).toMatchObject({ kind: 'fail', status: 404 })
  })

  it('returns the compact state and a matching hash', async () => {
    const row = makeBookingRow()
    mocks.bookingFindFirst.mockResolvedValue(row)

    const res = await GET(makeRequest(), makeCtx())

    expect(res).toMatchObject({ kind: 'ok', status: 200 })

    const expectedState = buildProSessionState(row)
    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
        state: expectedState,
        stateHash: computeProSessionStateHash(expectedState),
      },
      200,
    )

    expect(mocks.bookingFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'booking_1', professionalId: PRO_ID },
      }),
    )
  })

  it('reports terminal state for completed bookings', async () => {
    mocks.bookingFindFirst.mockResolvedValue(
      makeBookingRow({
        status: BookingStatus.COMPLETED,
        sessionStep: SessionStep.DONE,
        finishedAt: new Date('2026-06-09T12:00:00.000Z'),
      }),
    )

    await GET(makeRequest(), makeCtx())

    expect(mocks.jsonOk).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({ terminal: true }),
      }),
      200,
    )
  })

  it('fails with 500 when the database read throws', async () => {
    mocks.bookingFindFirst.mockRejectedValue(new Error('db down'))

    const res = await GET(makeRequest(), makeCtx())

    expect(res).toMatchObject({ kind: 'fail', status: 500 })
    expect(mocks.safeError).toHaveBeenCalled()
  })
})
