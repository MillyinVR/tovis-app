import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  ClientClaimStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { bookingError } from '@/lib/booking/errors'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),
  pickBool: vi.fn(),
  pickInt: vi.fn(),

  moneyToString: vi.fn(),
  computeRequestedEndUtc: vi.fn(),

  normalizeLocationType: vi.fn(),

  createProBookingWithClient: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
}))

vi.mock('@/lib/pick', () => ({
  pickBool: mocks.pickBool,
  pickInt: mocks.pickInt,
}))

vi.mock('@/lib/money', () => ({
  moneyToString: mocks.moneyToString,
}))

vi.mock('@/lib/booking/slotReadiness', () => ({
  computeRequestedEndUtc: mocks.computeRequestedEndUtc,
}))

vi.mock('@/lib/booking/locationContext', () => ({
  normalizeLocationType: mocks.normalizeLocationType,
}))

vi.mock('@/lib/booking/createProBookingWithClient', () => ({
  createProBookingWithClient: mocks.createProBookingWithClient,
}))

import { POST } from './route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const scheduledForIso = '2026-03-11T19:30:00.000Z'
const scheduledFor = new Date(scheduledForIso)
const endsAt = new Date('2026-03-11T20:45:00.000Z')

describe('POST /api/pro/bookings', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
      proId: 'pro_123',
      user: {
        id: 'user_123',
      },
    })

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: unknown) => ({
        ok: false,
        status,
        error,
        ...(extra && typeof extra === 'object' ? extra : {}),
      }),
    )

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.pickString.mockImplementation((value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null,
    )

    mocks.pickBool.mockImplementation((value: unknown) =>
      typeof value === 'boolean' ? value : null,
    )

    mocks.pickInt.mockImplementation((value: unknown) => {
      if (typeof value === 'number' && Number.isInteger(value)) return value
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10)
        return Number.isFinite(parsed) ? parsed : null
      }
      return null
    })

    mocks.normalizeLocationType.mockImplementation((value: unknown) => {
      if (value === 'SALON') return ServiceLocationType.SALON
      if (value === 'MOBILE') return ServiceLocationType.MOBILE
      return null
    })

    mocks.computeRequestedEndUtc.mockReturnValue(endsAt)
    mocks.moneyToString.mockReturnValue('50.00')

    mocks.createProBookingWithClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      clientUserId: 'user_client_1',
      clientEmail: 'client@example.com',
      clientClaimStatus: ClientClaimStatus.CLAIMED,
      clientAddressId: null,
      bookingResult: {
        booking: {
          id: 'booking_1',
          scheduledFor,
          totalDurationMinutes: 60,
          bufferMinutes: 15,
          status: BookingStatus.ACCEPTED,
        },
        subtotalSnapshot: new Prisma.Decimal('50.00'),
        stepMinutes: 15,
        appointmentTimeZone: 'America/Los_Angeles',
        locationId: 'loc_1',
        locationType: ServiceLocationType.SALON,
        clientAddressId: null,
        serviceName: 'Haircut',
        meta: {
          mutated: true,
          noOp: false,
        },
      },
      invite: null,
    })
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(makeRequest({}))

    expect(result).toBe(authRes)
    expect(mocks.createProBookingWithClient).not.toHaveBeenCalled()
  })

  it('returns INVALID_SCHEDULED_FOR when scheduledFor is missing or invalid', async () => {
    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: 'not-a-date',
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'INVALID_SCHEDULED_FOR',
      }),
    )
    expect(mocks.createProBookingWithClient).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'INVALID_SCHEDULED_FOR',
      }),
    )
  })

  it('returns LOCATION_ID_REQUIRED when locationId is missing', async () => {
    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: scheduledForIso,
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'LOCATION_ID_REQUIRED',
      }),
    )
    expect(mocks.createProBookingWithClient).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'LOCATION_ID_REQUIRED',
      }),
    )
  })

  it('returns LOCATION_TYPE_REQUIRED when locationType is missing or invalid', async () => {
    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: scheduledForIso,
        locationId: 'loc_1',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'LOCATION_TYPE_REQUIRED',
      }),
    )
    expect(mocks.createProBookingWithClient).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'LOCATION_TYPE_REQUIRED',
      }),
    )
  })

  it('returns OFFERING_ID_REQUIRED when offeringId is missing', async () => {
    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: scheduledForIso,
        locationId: 'loc_1',
        locationType: 'SALON',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'OFFERING_ID_REQUIRED',
      }),
    )
    expect(mocks.createProBookingWithClient).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'OFFERING_ID_REQUIRED',
      }),
    )
  })

  it('calls createProBookingWithClient with the parsed request payload', async () => {
    await POST(
      makeRequest({
        clientId: 'client_1',
        clientAddressId: 'addr_1',
        scheduledFor: scheduledForIso,
        locationId: 'loc_1',
        locationType: 'MOBILE',
        offeringId: 'offering_1',
        internalNotes: '  bring reference photos  ',
        bufferMinutes: '20',
        totalDurationMinutes: '90',
        allowOutsideWorkingHours: true,
        allowShortNotice: false,
        allowFarFuture: true,
        overrideReason: '  VIP manual exception  ',
      }),
    )

    expect(mocks.createProBookingWithClient).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      actorUserId: 'user_123',
      overrideReason: 'VIP manual exception',
      clientId: 'client_1',
      client: {
        firstName: undefined,
        lastName: undefined,
        email: undefined,
        phone: undefined,
      },
      clientAddressId: 'addr_1',
      serviceAddress: {
        label: undefined,
        formattedAddress: undefined,
        addressLine1: undefined,
        addressLine2: undefined,
        city: undefined,
        state: undefined,
        postalCode: undefined,
        countryCode: undefined,
        placeId: undefined,
        lat: undefined,
        lng: undefined,
        isDefault: undefined,
      },
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.MOBILE,
      scheduledFor: new Date(scheduledForIso),
      internalNotes: 'bring reference photos',
      requestedBufferMinutes: 20,
      requestedTotalDurationMinutes: 90,
      allowOutsideWorkingHours: true,
      allowShortNotice: false,
      allowFarFuture: true,
      requestId: null,
      idempotencyKey: null,
    })
  })

  it('passes nested client and serviceAddress payloads through to createProBookingWithClient', async () => {
    await POST(
      makeRequest({
        scheduledFor: scheduledForIso,
        locationId: 'loc_1',
        locationType: 'MOBILE',
        offeringId: 'offering_1',
        client: {
          firstName: 'Tori',
          lastName: 'Morales',
          email: 'tori@example.com',
          phone: '+16195551234',
        },
        serviceAddress: {
          label: 'Home',
          formattedAddress: '123 Main St, San Diego, CA',
          addressLine1: '123 Main St',
          city: 'San Diego',
          state: 'CA',
          postalCode: '92101',
          countryCode: 'US',
          placeId: 'place_123',
          lat: 32.7157,
          lng: -117.1611,
          isDefault: true,
        },
      }),
    )

    expect(mocks.createProBookingWithClient).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      actorUserId: 'user_123',
      overrideReason: null,
      clientId: null,
      client: {
        firstName: 'Tori',
        lastName: 'Morales',
        email: 'tori@example.com',
        phone: '+16195551234',
      },
      clientAddressId: null,
      serviceAddress: {
        label: 'Home',
        formattedAddress: '123 Main St, San Diego, CA',
        addressLine1: '123 Main St',
        addressLine2: undefined,
        city: 'San Diego',
        state: 'CA',
        postalCode: '92101',
        countryCode: 'US',
        placeId: 'place_123',
        lat: 32.7157,
        lng: -117.1611,
        isDefault: true,
      },
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.MOBILE,
      scheduledFor: new Date(scheduledForIso),
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
      requestId: null,
      idempotencyKey: null,
    })
  })

  it('passes through helper validation failures', async () => {
    mocks.createProBookingWithClient.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error:
        'That email and phone match different client profiles. Please double check with the client before continuing.',
      code: 'IDENTITY_CONFLICT',
    })

    const result = await POST(
      makeRequest({
        scheduledFor: scheduledForIso,
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
        client: {
          firstName: 'Tori',
          lastName: 'Morales',
          email: 'tori@example.com',
          phone: '+16195551234',
        },
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'That email and phone match different client profiles. Please double check with the client before continuing.',
      {
        code: 'IDENTITY_CONFLICT',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error:
        'That email and phone match different client profiles. Please double check with the client before continuing.',
      code: 'IDENTITY_CONFLICT',
    })
  })

  it('creates a booking successfully and formats the response', async () => {
    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: scheduledForIso,
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.createProBookingWithClient).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      actorUserId: 'user_123',
      overrideReason: null,
      clientId: 'client_1',
      client: {
        firstName: undefined,
        lastName: undefined,
        email: undefined,
        phone: undefined,
      },
      clientAddressId: null,
      serviceAddress: {
        label: undefined,
        formattedAddress: undefined,
        addressLine1: undefined,
        addressLine2: undefined,
        city: undefined,
        state: undefined,
        postalCode: undefined,
        countryCode: undefined,
        placeId: undefined,
        lat: undefined,
        lng: undefined,
        isDefault: undefined,
      },
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      scheduledFor: new Date(scheduledForIso),
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
      requestId: null,
      idempotencyKey: null,
    })

    expect(mocks.computeRequestedEndUtc).toHaveBeenCalledWith({
      startUtc: scheduledFor,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
        booking: {
          id: 'booking_1',
          clientId: 'client_1',
          scheduledFor: '2026-03-11T19:30:00.000Z',
          endsAt: '2026-03-11T20:45:00.000Z',
          totalDurationMinutes: 60,
          bufferMinutes: 15,
          status: BookingStatus.ACCEPTED,
          serviceName: 'Haircut',
          subtotalSnapshot: '50.00',
          subtotalCents: 5000,
          locationId: 'loc_1',
          locationType: ServiceLocationType.SALON,
          clientAddressId: null,
          stepMinutes: 15,
          timeZone: 'America/Los_Angeles',
        },
        client: {
          id: 'client_1',
          userId: 'user_client_1',
          email: 'client@example.com',
          claimStatus: ClientClaimStatus.CLAIMED,
        },
        invite: null,
      },
      201,
    )

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: {
        booking: {
          id: 'booking_1',
          clientId: 'client_1',
          scheduledFor: '2026-03-11T19:30:00.000Z',
          endsAt: '2026-03-11T20:45:00.000Z',
          totalDurationMinutes: 60,
          bufferMinutes: 15,
          status: BookingStatus.ACCEPTED,
          serviceName: 'Haircut',
          subtotalSnapshot: '50.00',
          subtotalCents: 5000,
          locationId: 'loc_1',
          locationType: ServiceLocationType.SALON,
          clientAddressId: null,
          stepMinutes: 15,
          timeZone: 'America/Los_Angeles',
        },
        client: {
          id: 'client_1',
          userId: 'user_client_1',
          email: 'client@example.com',
          claimStatus: ClientClaimStatus.CLAIMED,
        },
        invite: null,
      },
    })
  })

  it('returns invite payload when helper created an invite for an unclaimed client', async () => {
    mocks.createProBookingWithClient.mockResolvedValueOnce({
      ok: true,
      clientId: 'client_unclaimed_1',
      clientUserId: null,
      clientEmail: 'newclient@example.com',
      clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      clientAddressId: null,
      bookingResult: {
        booking: {
          id: 'booking_invite_1',
          scheduledFor,
          totalDurationMinutes: 60,
          bufferMinutes: 15,
          status: BookingStatus.ACCEPTED,
        },
        subtotalSnapshot: new Prisma.Decimal('50.00'),
        stepMinutes: 15,
        appointmentTimeZone: 'America/Los_Angeles',
        locationId: 'loc_1',
        locationType: ServiceLocationType.SALON,
        clientAddressId: null,
        serviceName: 'Haircut',
        meta: {
          mutated: true,
          noOp: false,
        },
      },
      invite: {
        id: 'invite_1',
        token: 'token_1',
      },
    })

    const result = await POST(
      makeRequest({
        scheduledFor: scheduledForIso,
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
        client: {
          firstName: 'New',
          lastName: 'Client',
          email: 'newclient@example.com',
        },
      }),
    )

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: {
        booking: {
          id: 'booking_invite_1',
          clientId: 'client_unclaimed_1',
          scheduledFor: '2026-03-11T19:30:00.000Z',
          endsAt: '2026-03-11T20:45:00.000Z',
          totalDurationMinutes: 60,
          bufferMinutes: 15,
          status: BookingStatus.ACCEPTED,
          serviceName: 'Haircut',
          subtotalSnapshot: '50.00',
          subtotalCents: 5000,
          locationId: 'loc_1',
          locationType: ServiceLocationType.SALON,
          clientAddressId: null,
          stepMinutes: 15,
          timeZone: 'America/Los_Angeles',
        },
        client: {
          id: 'client_unclaimed_1',
          userId: null,
          email: 'newclient@example.com',
          claimStatus: ClientClaimStatus.UNCLAIMED,
        },
        invite: {
          id: 'invite_1',
          token: 'token_1',
        },
      },
    })
  })

  it('still returns booking success for an unclaimed client when invite is null', async () => {
  mocks.createProBookingWithClient.mockResolvedValueOnce({
    ok: true,
    clientId: 'client_unclaimed_2',
    clientUserId: null,
    clientEmail: 'nudgefree@example.com',
    clientClaimStatus: ClientClaimStatus.UNCLAIMED,
    clientAddressId: null,
    bookingResult: {
      booking: {
        id: 'booking_no_invite_1',
        scheduledFor,
        totalDurationMinutes: 60,
        bufferMinutes: 15,
        status: BookingStatus.ACCEPTED,
      },
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      stepMinutes: 15,
      appointmentTimeZone: 'America/Los_Angeles',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      clientAddressId: null,
      serviceName: 'Haircut',
      meta: {
        mutated: true,
        noOp: false,
      },
    },
    invite: null,
  })

  const result = await POST(
    makeRequest({
      scheduledFor: scheduledForIso,
      locationId: 'loc_1',
      locationType: 'SALON',
      offeringId: 'offering_1',
      client: {
        firstName: 'No',
        lastName: 'Invite',
        email: 'nudgefree@example.com',
      },
    }),
  )

  expect(result).toEqual({
    ok: true,
    status: 201,
    data: {
      booking: {
        id: 'booking_no_invite_1',
        clientId: 'client_unclaimed_2',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        endsAt: '2026-03-11T20:45:00.000Z',
        totalDurationMinutes: 60,
        bufferMinutes: 15,
        status: BookingStatus.ACCEPTED,
        serviceName: 'Haircut',
        subtotalSnapshot: '50.00',
        subtotalCents: 5000,
        locationId: 'loc_1',
        locationType: ServiceLocationType.SALON,
        clientAddressId: null,
        stepMinutes: 15,
        timeZone: 'America/Los_Angeles',
      },
      client: {
        id: 'client_unclaimed_2',
        userId: null,
        email: 'nudgefree@example.com',
        claimStatus: ClientClaimStatus.UNCLAIMED,
      },
      invite: null,
    },
  })
})

  it('maps booking errors to jsonFail', async () => {
    mocks.createProBookingWithClient.mockRejectedValueOnce(
      bookingError('TIME_BLOCKED', {
        message: 'Requested time is blocked.',
        userMessage: 'That time is blocked on your calendar.',
      }),
    )

    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: scheduledForIso,
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'That time is blocked on your calendar.',
      expect.objectContaining({
        code: 'TIME_BLOCKED',
      }),
    )

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 409,
        code: 'TIME_BLOCKED',
      }),
    )
  })
})