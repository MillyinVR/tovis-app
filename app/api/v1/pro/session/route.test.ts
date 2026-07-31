import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, MediaPhase, Role, SessionStep } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  bookingFindFirst: vi.fn(),
  bookingFindMany: vi.fn(),
  mediaAssetGroupBy: vi.fn(),
  offeringFindMany: vi.fn(),
  consentRecordFindMany: vi.fn(),
  isClientTechnicalRecordEnabled: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findFirst: mocks.bookingFindFirst,
      findMany: mocks.bookingFindMany,
    },
    mediaAsset: {
      groupBy: mocks.mediaAssetGroupBy,
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

import { GET } from './route'

const PRO_ID = 'pro_1'

function makeBooking(overrides?: {
  id?: string
  clientId?: string
  serviceId?: string
  scheduledFor?: Date
  sessionStep?: SessionStep | null
  firstName?: string
  lastName?: string
  email?: string | null
  serviceName?: string
  serviceItemName?: string | null
}) {
  const serviceItemName =
    overrides && 'serviceItemName' in overrides
      ? overrides.serviceItemName
      : null

  return {
    id: overrides?.id ?? 'booking_1',
    scheduledFor: overrides?.scheduledFor ?? new Date('2026-04-12T18:00:00.000Z'),
    sessionStep: overrides?.sessionStep ?? SessionStep.NONE,
    // K17-web: the consent chain keys on these, and a mock that omits them is a
    // fixture that has drifted from the row the route actually receives.
    clientId: overrides?.clientId ?? 'client_1',
    serviceId: overrides?.serviceId ?? 'service_base',
    client: {
      firstName: overrides?.firstName ?? 'Tori',
      lastName: overrides?.lastName ?? 'Morales',
      user: {
        email: overrides?.email ?? 'tori@example.com',
      },
    },
    service: {
      name: overrides?.serviceName ?? 'Haircut',
    },
    serviceItems:
      serviceItemName === null
        ? []
        : [
            {
              sortOrder: 0,
              serviceId: overrides?.serviceId ?? 'service_base',
              service: {
                name: serviceItemName,
              },
            },
          ],
  }
}

function expectActiveFindFirst() {
  expect(mocks.bookingFindFirst).toHaveBeenCalledWith({
    where: {
      professionalId: PRO_ID,
      status: { in: [BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS] },
      startedAt: {
        not: null,
      },
      finishedAt: null,
      // Bookings whose aftercare has already been sent are no longer the
      // active hands-on session, so the footer clears once aftercare goes out.
      OR: [
        { aftercareSummary: { is: null } },
        { aftercareSummary: { sentToClientAt: null } },
      ],
    },
    orderBy: {
      startedAt: 'desc',
    },
    select: expect.any(Object),
  })
}

describe('GET /api/v1/pro/session', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-12T18:00:00.000Z'))
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: PRO_ID,
      userId: 'user_1',
      user: { id: 'user_1' },
    })

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.jsonFail.mockImplementation((status: number, error: string) => ({
      ok: false,
      status,
      error,
    }))

    mocks.bookingFindFirst.mockResolvedValue(null)
    mocks.bookingFindMany.mockResolvedValue([])
    mocks.mediaAssetGroupBy.mockResolvedValue([])
    // Ship-dark default: no pro is gated in, so the consent chain never runs.
    mocks.isClientTechnicalRecordEnabled.mockReturnValue(false)
    mocks.offeringFindMany.mockResolvedValue([])
    mocks.consentRecordFindMany.mockResolvedValue([])
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await GET()

    expect(result).toBe(authRes)
    expect(mocks.bookingFindFirst).not.toHaveBeenCalled()
    expect(mocks.bookingFindMany).not.toHaveBeenCalled()
    expect(mocks.mediaAssetGroupBy).not.toHaveBeenCalled()
  })

  it('returns an active session when a started booking exists', async () => {
    mocks.bookingFindFirst.mockResolvedValueOnce(
      makeBooking({
        id: 'booking_active',
        sessionStep: SessionStep.BEFORE_PHOTOS,
        serviceItemName: 'Balayage',
      }),
    )

    mocks.mediaAssetGroupBy.mockResolvedValueOnce([
      {
        phase: MediaPhase.BEFORE,
        _count: { _all: 1 },
      },
    ])

    const result = await GET()

    expectActiveFindFirst()

    expect(mocks.mediaAssetGroupBy).toHaveBeenCalledWith({
      by: ['phase'],
      where: {
        bookingId: 'booking_active',
        phase: {
          in: [MediaPhase.BEFORE, MediaPhase.AFTER],
        },
        uploadedByRole: Role.PRO,
      },
      _count: {
        _all: true,
      },
    })

    expect(mocks.bookingFindMany).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        ok: true,
        mode: 'ACTIVE',
        targetStep: 'session',
        booking: {
          id: 'booking_active',
          sessionStep: SessionStep.BEFORE_PHOTOS,
          serviceName: 'Balayage',
          clientName: 'Tori Morales',
          scheduledFor: '2026-04-12T18:00:00.000Z',
        },
        eligibleBookings: null,
        center: {
          label: 'Start service',
          action: 'NAVIGATE',
          href: '/pro/bookings/booking_active/session',
        },
      },
    })
  })

  it('excludes bookings whose aftercare was already sent from the active session', async () => {
    // Default mocks return no active booking; assert the query itself filters
    // out aftercare-sent bookings so the footer clears once aftercare goes out.
    await GET()

    expect(mocks.bookingFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          finishedAt: null,
          OR: [
            { aftercareSummary: { is: null } },
            { aftercareSummary: { sentToClientAt: null } },
          ],
        }),
      }),
    )
  })

  it('uses fallback service name and client email when name fields are blank', async () => {
    mocks.bookingFindFirst.mockResolvedValueOnce(
      makeBooking({
        id: 'booking_active',
        sessionStep: SessionStep.NONE,
        firstName: '',
        lastName: '',
        email: 'client@example.com',
        serviceName: 'Color',
        serviceItemName: null,
      }),
    )

    const result = await GET()

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: expect.objectContaining({
        mode: 'ACTIVE',
        booking: expect.objectContaining({
          id: 'booking_active',
          serviceName: 'Color',
          clientName: 'client@example.com',
        }),
        center: {
          label: 'Consult',
          action: 'NAVIGATE',
          href: '/pro/bookings/booking_active/session',
        },
      }),
    })
  })

  it('returns one upcoming booking inside the start window as one-tap start', async () => {
    mocks.bookingFindMany.mockResolvedValueOnce([
      makeBooking({
        id: 'booking_upcoming',
        sessionStep: SessionStep.NONE,
      }),
    ])

    const result = await GET()

    expect(mocks.bookingFindMany).toHaveBeenCalledWith({
      where: {
        professionalId: PRO_ID,
        status: BookingStatus.ACCEPTED,
        startedAt: null,
        finishedAt: null,
        scheduledFor: {
          gte: new Date('2026-04-12T17:45:00.000Z'),
          lte: new Date('2026-04-12T18:15:00.000Z'),
        },
      },
      orderBy: [
        {
          scheduledFor: 'asc',
        },
        {
          id: 'asc',
        },
      ],
      select: expect.any(Object),
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        ok: true,
        mode: 'UPCOMING',
        targetStep: 'consult',
        booking: {
          id: 'booking_upcoming',
          sessionStep: SessionStep.NONE,
          serviceName: 'Haircut',
          clientName: 'Tori Morales',
          scheduledFor: '2026-04-12T18:00:00.000Z',
        },
        eligibleBookings: null,
        center: {
          label: 'Start',
          action: 'START',
          href: '/pro/bookings/booking_upcoming/session',
        },
      },
    })
  })

  it('returns a picker when multiple upcoming bookings are inside the start window', async () => {
    mocks.bookingFindMany.mockResolvedValueOnce([
      makeBooking({
        id: 'booking_a',
        scheduledFor: new Date('2026-04-12T17:55:00.000Z'),
        serviceName: 'Cut',
      }),
      makeBooking({
        id: 'booking_b',
        scheduledFor: new Date('2026-04-12T18:05:00.000Z'),
        serviceName: 'Color',
      }),
    ])

    const result = await GET()

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        ok: true,
        mode: 'UPCOMING_PICKER',
        targetStep: 'consult',
        booking: null,
        eligibleBookings: [
          {
            id: 'booking_a',
            sessionStep: SessionStep.NONE,
            serviceName: 'Cut',
            clientName: 'Tori Morales',
            scheduledFor: '2026-04-12T17:55:00.000Z',
          },
          {
            id: 'booking_b',
            sessionStep: SessionStep.NONE,
            serviceName: 'Color',
            clientName: 'Tori Morales',
            scheduledFor: '2026-04-12T18:05:00.000Z',
          },
        ],
        center: {
          label: 'Choose booking',
          action: 'PICK_BOOKING',
          href: null,
        },
      },
    })
  })

  it('returns idle payload when there is no active or eligible upcoming booking', async () => {
    const result = await GET()

    expect(mocks.bookingFindFirst).toHaveBeenCalled()
    expect(mocks.bookingFindMany).toHaveBeenCalled()

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        ok: true,
        mode: 'IDLE',
        targetStep: null,
        booking: null,
        eligibleBookings: null,
        center: {
          label: 'Start',
          action: 'NONE',
          href: null,
        },
      },
    })
  })

  it('returns 500 when the route throws unexpectedly', async () => {
    mocks.bookingFindFirst.mockRejectedValueOnce(new Error('db exploded'))

    const result = await GET()

    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')
    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Internal server error',
    })
  })
})

// ─── K17-web: the unsigned-consent mark on the session-start payload ─────────
//
// Web's session page renders `UnsignedConsentBanner`; before this the device's
// session hub had no way to learn a form was outstanding. These tests drive the
// REAL consent chain (the offering + record queries are mocked, the resolution
// is not) rather than stubbing the loader, so they fail if the wiring is wrong
// and not only if the helper is.

describe('GET /api/v1/pro/session — unsigned consent (K17-web)', () => {
  const FORM_ID = 'form_waiver'
  const VERSION_ID = 'ver_1'

  /** The pro has bound a SERVICE_WAIVER to the booking's base service. */
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

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-12T18:00:00.000Z'))
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: PRO_ID,
      userId: 'user_1',
      user: { id: 'user_1' },
    })
    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))
    mocks.jsonFail.mockImplementation((status: number, error: string) => ({
      ok: false,
      status,
      error,
    }))
    mocks.bookingFindFirst.mockResolvedValue(null)
    mocks.bookingFindMany.mockResolvedValue([])
    mocks.mediaAssetGroupBy.mockResolvedValue([])
    mocks.isClientTechnicalRecordEnabled.mockReturnValue(false)
    mocks.offeringFindMany.mockResolvedValue([])
    mocks.consentRecordFindMany.mockResolvedValue([])
  })

  it('omits the key entirely when the technical-record gate is off', async () => {
    bindRequirement()
    mocks.isClientTechnicalRecordEnabled.mockReturnValue(false)
    mocks.bookingFindFirst.mockResolvedValueOnce(makeBooking())

    const result = await GET()

    expect(result).not.toHaveProperty('data.booking.unsignedConsentForms')
    // The kill switch reaches the QUERY, not just the payload — an ungated pro
    // pays nothing for a feature they cannot see.
    expect(mocks.offeringFindMany).not.toHaveBeenCalled()
  })

  it('carries the outstanding form on the ACTIVE booking', async () => {
    bindRequirement()
    mocks.bookingFindFirst.mockResolvedValueOnce(makeBooking())

    const result = await GET()

    expect(result).toHaveProperty('data.booking.unsignedConsentForms', [
      {
        formId: FORM_ID,
        title: 'Corrective colour waiver',
        kindLabel: 'Service waiver',
      },
    ])
  })

  it('omits the key once the client has signed', async () => {
    bindRequirement()
    mocks.consentRecordFindMany.mockResolvedValue([
      { clientId: 'client_1', formVersion: { formId: FORM_ID } },
    ])
    mocks.bookingFindFirst.mockResolvedValueOnce(makeBooking())

    const result = await GET()

    expect(result).not.toHaveProperty('data.booking.unsignedConsentForms')
  })

  it('resolves the PICKER’s bookings in one batch, not one query each', async () => {
    bindRequirement()
    mocks.bookingFindMany.mockResolvedValueOnce([
      makeBooking({ id: 'b1', clientId: 'client_1' }),
      makeBooking({ id: 'b2', clientId: 'client_2' }),
      makeBooking({ id: 'b3', clientId: 'client_3' }),
    ])

    const result = await GET()
    const outstanding = [
      { formId: FORM_ID, title: 'Corrective colour waiver', kindLabel: 'Service waiver' },
    ]

    // Every one of the three carries its own answer — the batch must not
    // resolve only the first booking and leave the rest blank.
    expect(result).toHaveProperty('data.eligibleBookings', [
      expect.objectContaining({ id: 'b1', unsignedConsentForms: outstanding }),
      expect.objectContaining({ id: 'b2', unsignedConsentForms: outstanding }),
      expect.objectContaining({ id: 'b3', unsignedConsentForms: outstanding }),
    ])
    // Two queries total for three bookings — the reason the helper is batched.
    // A per-booking loop would make this surface 2N queries on every app open.
    expect(mocks.offeringFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.consentRecordFindMany).toHaveBeenCalledTimes(1)
  })

  // 🔴 These two are split on purpose, because prisma is MOCKED here: the mock
  // returns the fixture whatever `select` it is handed, so no assertion on the
  // RESULT can prove anything about the select. The select is therefore pinned
  // DIRECTLY, and the naming behaviour separately.
  it('asks for EVERY service item, and for the ids the consent chain needs', async () => {
    // `take: 1` used to sit on serviceItems — enough for the display name, and
    // silently blind to a waiver bound to the second service of a visit.
    mocks.bookingFindFirst.mockResolvedValueOnce(makeBooking())

    await GET()

    const select = mocks.bookingFindFirst.mock.calls[0]?.[0]?.select
    expect(select).toMatchObject({
      clientId: true,
      serviceId: true,
      serviceItems: { select: { serviceId: true } },
    })
    expect(select.serviceItems).not.toHaveProperty('take')
  })

  it('still names the service from the first item', async () => {
    // The card's displayed name must not move with the widened select.
    mocks.bookingFindFirst.mockResolvedValueOnce(
      makeBooking({ serviceItemName: 'Balayage', serviceName: 'Haircut' }),
    )

    const result = await GET()

    expect(result).toHaveProperty('data.booking.serviceName', 'Balayage')
  })
})
