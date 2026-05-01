import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  ClientClaimStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { bookingError } from '@/lib/booking/errors'

const scheduledForIso = '2026-03-11T19:30:00.000Z'
const scheduledFor = new Date(scheduledForIso)
const endsAt = new Date('2026-03-11T20:45:00.000Z')
const IDEMPOTENCY_ROUTE = 'POST /api/pro/bookings'

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

  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  failIdempotency: vi.fn(),
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

vi.mock('@/lib/idempotency', () => ({
  beginIdempotency: mocks.beginIdempotency,
  completeIdempotency: mocks.completeIdempotency,
  failIdempotency: mocks.failIdempotency,
  IDEMPOTENCY_ROUTES: {
    PRO_BOOKING_CREATE: 'POST /api/pro/bookings',
  },
}))

import { POST } from './route'

function makeRequest(
  body: unknown,
  headers?: Record<string, string>,
): Request {
  return new Request('http://localhost/api/pro/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

function makeIdempotentRequest(
  body: unknown,
  key = 'idem_pro_booking_1',
): Request {
  return makeRequest(body, {
    'idempotency-key': key,
  })
}

function validBody(overrides?: Record<string, unknown>) {
  return {
    clientId: 'client_1',
    scheduledFor: scheduledForIso,
    locationId: 'loc_1',
    locationType: 'SALON',
    offeringId: 'offering_1',
    ...(overrides ?? {}),
  }
}

function expectedBaseClientPayload() {
  return {
    firstName: undefined,
    lastName: undefined,
    email: undefined,
    phone: undefined,
  }
}

function expectedBaseServiceAddressPayload() {
  return {
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
  }
}

function expectedSuccessBody(overrides?: {
  bookingId?: string
  clientId?: string
  clientUserId?: string | null
  clientEmail?: string | null
  claimStatus?: ClientClaimStatus
  invite?: unknown
}) {
  const clientId = overrides?.clientId ?? 'client_1'

  const clientUserId =
    overrides && 'clientUserId' in overrides
      ? overrides.clientUserId
      : 'user_client_1'

  const clientEmail =
    overrides && 'clientEmail' in overrides
      ? overrides.clientEmail
      : 'client@example.com'

  const claimStatus =
    overrides && 'claimStatus' in overrides
      ? overrides.claimStatus
      : ClientClaimStatus.CLAIMED

  const body: Record<string, unknown> = {
    booking: {
      id: overrides?.bookingId ?? 'booking_1',
      clientId,
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
      id: clientId,
      userId: clientUserId,
      email: clientEmail,
      claimStatus,
    },
  }

  if (overrides && 'invite' in overrides && overrides.invite !== null) {
    body.invite = overrides.invite
  }

  return body
}

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

    mocks.beginIdempotency.mockImplementation(
      async (args: { key: string | null }) => {
        const key = args.key?.trim()

        if (!key) {
          return { kind: 'missing_key' }
        }

        return {
          kind: 'started',
          idempotencyRecordId: 'idem_record_1',
          requestHash: 'hash_1',
        }
      },
    )

    mocks.completeIdempotency.mockResolvedValue(undefined)
    mocks.failIdempotency.mockResolvedValue(undefined)

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
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
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
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
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
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
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
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
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
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.createProBookingWithClient).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'OFFERING_ID_REQUIRED',
      }),
    )
  })

  it('returns missing idempotency key when valid authenticated request has no idempotency header', async () => {
    const result = await POST(makeRequest(validBody()))

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_123',
        actorRole: 'PRO',
      },
      route: IDEMPOTENCY_ROUTE,
      key: null,
      requestBody: {
        professionalId: 'pro_123',
        actorUserId: 'user_123',
        clientId: 'client_1',
        client: expectedBaseClientPayload(),
        clientAddressId: null,
        serviceAddress: expectedBaseServiceAddressPayload(),
        offeringId: 'offering_1',
        locationId: 'loc_1',
        locationType: ServiceLocationType.SALON,
        scheduledFor: scheduledForIso,
        internalNotes: null,
        overrideReason: null,
        requestedBufferMinutes: null,
        requestedTotalDurationMinutes: null,
        allowOutsideWorkingHours: false,
        allowShortNotice: false,
        allowFarFuture: false,
      },
    })
    expect(mocks.createProBookingWithClient).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('returns in-progress when idempotency ledger has an active matching request', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'in_progress',
    })

    const result = await POST(makeIdempotentRequest(validBody()))

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'A matching pro booking request is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    })

    expect(mocks.createProBookingWithClient).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('returns conflict when idempotency key was reused with a different body', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'conflict',
    })

    const result = await POST(makeIdempotentRequest(validBody()))

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    })

    expect(mocks.createProBookingWithClient).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('replays completed idempotency response without creating another booking', async () => {
    const replayBody = expectedSuccessBody({
      bookingId: 'booking_replay_1',
    })

    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'replay',
      responseStatus: 201,
      responseBody: replayBody,
    })

    const result = await POST(makeIdempotentRequest(validBody()))

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: replayBody,
    })

    expect(mocks.createProBookingWithClient).not.toHaveBeenCalled()
    expect(mocks.completeIdempotency).not.toHaveBeenCalled()
  })

  it('calls createProBookingWithClient with the parsed request payload', async () => {
    await POST(
      makeIdempotentRequest(
        {
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
        },
        'idem_parsed_payload_1',
      ),
    )

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_123',
        actorRole: 'PRO',
      },
      route: IDEMPOTENCY_ROUTE,
      key: 'idem_parsed_payload_1',
      requestBody: {
        professionalId: 'pro_123',
        actorUserId: 'user_123',
        clientId: 'client_1',
        client: expectedBaseClientPayload(),
        clientAddressId: 'addr_1',
        serviceAddress: expectedBaseServiceAddressPayload(),
        offeringId: 'offering_1',
        locationId: 'loc_1',
        locationType: ServiceLocationType.MOBILE,
        scheduledFor: scheduledForIso,
        internalNotes: 'bring reference photos',
        overrideReason: 'VIP manual exception',
        requestedBufferMinutes: 20,
        requestedTotalDurationMinutes: 90,
        allowOutsideWorkingHours: true,
        allowShortNotice: false,
        allowFarFuture: true,
      },
    })

    expect(mocks.createProBookingWithClient).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      actorUserId: 'user_123',
      overrideReason: 'VIP manual exception',
      clientId: 'client_1',
      client: expectedBaseClientPayload(),
      clientAddressId: 'addr_1',
      serviceAddress: expectedBaseServiceAddressPayload(),
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
      idempotencyKey: 'idem_parsed_payload_1',
    })
  })

  it('passes nested client and serviceAddress payloads through to createProBookingWithClient', async () => {
    await POST(
      makeIdempotentRequest(
        {
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
        },
        'idem_nested_payload_1',
      ),
    )

    const client = {
      firstName: 'Tori',
      lastName: 'Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
    }

    const serviceAddress = {
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
    }

    expect(mocks.beginIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem_nested_payload_1',
        requestBody: expect.objectContaining({
          client,
          serviceAddress,
          locationType: ServiceLocationType.MOBILE,
        }),
      }),
    )

    expect(mocks.createProBookingWithClient).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      actorUserId: 'user_123',
      overrideReason: null,
      clientId: null,
      client,
      clientAddressId: null,
      serviceAddress,
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
      idempotencyKey: 'idem_nested_payload_1',
    })
  })

  it('passes through helper validation failures and marks idempotency failed', async () => {
    mocks.createProBookingWithClient.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error:
        'That email and phone match different client profiles. Please double check with the client before continuing.',
      code: 'IDENTITY_CONFLICT',
    })

    const result = await POST(
      makeIdempotentRequest(
        {
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
        },
        'idem_identity_conflict_1',
      ),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

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

  it('creates a booking successfully, completes idempotency, and formats the response', async () => {
    const result = await POST(
      makeIdempotentRequest(validBody(), 'idem_success_1'),
    )

    expect(mocks.createProBookingWithClient).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      actorUserId: 'user_123',
      overrideReason: null,
      clientId: 'client_1',
      client: expectedBaseClientPayload(),
      clientAddressId: null,
      serviceAddress: expectedBaseServiceAddressPayload(),
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
      idempotencyKey: 'idem_success_1',
    })

    expect(mocks.computeRequestedEndUtc).toHaveBeenCalledWith({
      startUtc: scheduledFor,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    const responseBody = expectedSuccessBody()

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 201,
      responseBody,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(responseBody, 201)

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: responseBody,
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
      makeIdempotentRequest(
        {
          scheduledFor: scheduledForIso,
          locationId: 'loc_1',
          locationType: 'SALON',
          offeringId: 'offering_1',
          client: {
            firstName: 'New',
            lastName: 'Client',
            email: 'newclient@example.com',
          },
        },
        'idem_invite_1',
      ),
    )

    const responseBody = expectedSuccessBody({
      bookingId: 'booking_invite_1',
      clientId: 'client_unclaimed_1',
      clientUserId: null,
      clientEmail: 'newclient@example.com',
      claimStatus: ClientClaimStatus.UNCLAIMED,
      invite: {
        id: 'invite_1',
        token: 'token_1',
      },
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 201,
      responseBody,
    })

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: responseBody,
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
      makeIdempotentRequest(
        {
          scheduledFor: scheduledForIso,
          locationId: 'loc_1',
          locationType: 'SALON',
          offeringId: 'offering_1',
          client: {
            firstName: 'No',
            lastName: 'Invite',
            email: 'nudgefree@example.com',
          },
        },
        'idem_no_invite_1',
      ),
    )

    const responseBody = expectedSuccessBody({
      bookingId: 'booking_no_invite_1',
      clientId: 'client_unclaimed_2',
      clientUserId: null,
      clientEmail: 'nudgefree@example.com',
      claimStatus: ClientClaimStatus.UNCLAIMED,
      invite: null,
    })

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: responseBody,
    })
  })

  it('maps booking errors to jsonFail and marks idempotency failed', async () => {
    mocks.createProBookingWithClient.mockRejectedValueOnce(
      bookingError('TIME_BLOCKED', {
        message: 'Requested time is blocked.',
        userMessage: 'That time is blocked on your calendar.',
      }),
    )

    const result = await POST(
      makeIdempotentRequest(validBody(), 'idem_time_blocked_1'),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

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