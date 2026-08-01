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
  offeringFindMany: vi.fn(),
  consentRecordFindMany: vi.fn(),
  isClientTechnicalRecordEnabled: vi.fn(),
  safeError: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
}))

// Only the DATABASE is mocked — `loadUnsignedConsentFormsForBooking` and the
// whole K15 resolution chain underneath it run for real, so these tests measure
// the rule rather than a stub of it (the shape `app/api/v1/pro/session` uses).
vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findFirst: mocks.bookingFindFirst,
    },
    professionalServiceOffering: {
      findMany: mocks.offeringFindMany,
    },
    clientConsentRecord: {
      findMany: mocks.consentRecordFindMany,
    },
  },
}))

vi.mock('@/lib/clients/technicalRecord', () => ({
  isClientTechnicalRecordEnabled: mocks.isClientTechnicalRecordEnabled,
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

  mocks.isClientTechnicalRecordEnabled.mockReturnValue(false)
  mocks.offeringFindMany.mockResolvedValue([])
  mocks.consentRecordFindMany.mockResolvedValue([])
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

  // ── K17-A: the unsigned-consent list the native session hub renders ────────
  //
  // The hub is a PER-BOOKING screen and this route is its spine. #812 put the
  // same list on `GET /api/v1/pro/session`, but that payload answers for
  // whichever booking the footer is acting on — open a session from the booking
  // detail instead and the warning had no path to the screen.
  describe('unsigned consent forms', () => {
    const FORM_ID = 'form_1'
    const VERSION_ID = 'version_1'

    /** The pro requires a waiver on the booking's own service. */
    function bindRequirement() {
      mocks.isClientTechnicalRecordEnabled.mockReturnValue(true)
      mocks.offeringFindMany.mockResolvedValue([
        {
          serviceId: 'service_base',
          consentFormId: FORM_ID,
          consentForm: {
            id: FORM_ID,
            kind: 'SERVICE_WAIVER',
            isActive: true,
            versions: [{ id: VERSION_ID, title: 'Corrective colour waiver' }],
          },
        },
      ])
    }

    /** The state query, then the consent query — in the order the route makes them. */
    function respondWith(consentRow: unknown) {
      mocks.bookingFindFirst
        .mockResolvedValueOnce(makeBookingRow())
        .mockResolvedValueOnce(consentRow)
    }

    const ownConsentRow = {
      id: 'booking_1',
      clientId: 'client_1',
      serviceId: 'service_base',
      serviceItems: [],
    }

    it('carries the outstanding form for this booking', async () => {
      bindRequirement()
      respondWith(ownConsentRow)

      await GET(makeRequest(), makeCtx())

      expect(mocks.jsonOk).toHaveBeenCalledWith(
        expect.objectContaining({
          unsignedConsentForms: [
            {
              formId: FORM_ID,
              title: 'Corrective colour waiver',
              kindLabel: 'Service waiver',
            },
          ],
        }),
        200,
      )
    })

    it('finds a waiver bound to a SECOND service of a multi-service visit', async () => {
      // The booking's own service carries nothing; the requirement hangs off an
      // item. This is the axis #812's `take: 1` removal opened up, and the reason
      // the consent query selects `serviceItems` at all.
      mocks.isClientTechnicalRecordEnabled.mockReturnValue(true)
      mocks.offeringFindMany.mockResolvedValue([
        {
          serviceId: 'service_addon',
          consentFormId: FORM_ID,
          consentForm: {
            id: FORM_ID,
            kind: 'PATCH_TEST',
            isActive: true,
            versions: [{ id: VERSION_ID, title: 'Patch test record' }],
          },
        },
      ])
      respondWith({
        ...ownConsentRow,
        serviceId: 'service_other',
        serviceItems: [{ serviceId: 'service_addon' }],
      })

      await GET(makeRequest(), makeCtx())

      expect(mocks.jsonOk).toHaveBeenCalledWith(
        expect.objectContaining({
          unsignedConsentForms: [
            expect.objectContaining({ title: 'Patch test record' }),
          ],
        }),
        200,
      )
    })

    it('omits the key once the client has signed', async () => {
      bindRequirement()
      mocks.consentRecordFindMany.mockResolvedValue([
        { clientId: 'client_1', formVersion: { formId: FORM_ID } },
      ])
      respondWith(ownConsentRow)

      await GET(makeRequest(), makeCtx())

      const [payload] = mocks.jsonOk.mock.calls[0] ?? []
      expect(payload).not.toHaveProperty('unsignedConsentForms')
    })

    it('is NOT suppressed for an appointment whose time has arrived', async () => {
      // 🔴 The point of the whole field. The calendar badge goes quiet once
      // `scheduledFor <= now`, which at session start is true by definition — a
      // hub that reused that gate would blank the warning exactly when the pro
      // is standing in front of the client.
      bindRequirement()
      respondWith(ownConsentRow)

      await GET(makeRequest(), makeCtx())

      expect(mocks.jsonOk).toHaveBeenCalledWith(
        expect.objectContaining({
          state: expect.objectContaining({ startedAt: expect.any(String) }),
          unsignedConsentForms: expect.arrayContaining([
            expect.objectContaining({ formId: FORM_ID }),
          ]),
        }),
        200,
      )
    })

    it('leaves the hash to `state` alone', async () => {
      // The list must not enter the poll hash: it would put two DB round trips
      // on every tick and refresh web's server-rendered page on a signature.
      bindRequirement()
      respondWith(ownConsentRow)

      await GET(makeRequest(), makeCtx())

      const [payload] = mocks.jsonOk.mock.calls[0] ?? []
      const withForms = payload as {
        state: Parameters<typeof computeProSessionStateHash>[0]
        stateHash: string
      }
      expect(withForms.stateHash).toBe(
        computeProSessionStateHash(buildProSessionState(makeBookingRow())),
      )
    })

    it('issues NO consent query at all while the gate is off', async () => {
      // The kill switch reaches the QUERY, not just the payload — this route is
      // POLLED, so an ungated pro must pay nothing for a feature they cannot see.
      bindRequirement()
      mocks.isClientTechnicalRecordEnabled.mockReturnValue(false)
      respondWith(ownConsentRow)

      await GET(makeRequest(), makeCtx())

      const [payload] = mocks.jsonOk.mock.calls[0] ?? []
      expect(payload).not.toHaveProperty('unsignedConsentForms')
      expect(mocks.offeringFindMany).not.toHaveBeenCalled()
      // And not even the row read: one query, exactly as before K17-A.
      expect(mocks.bookingFindFirst).toHaveBeenCalledTimes(1)
    })

    it('scopes the consent read to the authed pro', async () => {
      bindRequirement()
      respondWith(ownConsentRow)

      await GET(makeRequest(), makeCtx())

      expect(mocks.bookingFindFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: 'booking_1', professionalId: PRO_ID },
        }),
      )
    })
  })

  it('fails with 500 when the database read throws', async () => {
    mocks.bookingFindFirst.mockRejectedValue(new Error('db down'))

    const res = await GET(makeRequest(), makeCtx())

    expect(res).toMatchObject({ kind: 'fail', status: 500 })
    expect(mocks.safeError).toHaveBeenCalled()
  })
})
