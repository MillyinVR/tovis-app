import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  ClientClaimStatus,
  ContactMethod,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  resolveProBookingClient: vi.fn(),
  createProBooking: vi.fn(),
  createProClientInvite: vi.fn(),
}))

vi.mock('@/lib/booking/resolveProBookingClient', () => ({
  resolveProBookingClient: mocks.resolveProBookingClient,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  createProBooking: mocks.createProBooking,
}))

vi.mock('@/lib/invites/proClientInvite', () => ({
  createProClientInvite: mocks.createProClientInvite,
}))

import { createProBookingWithClient } from './createProBookingWithClient'

const scheduledFor = new Date('2026-03-11T19:30:00.000Z')

function makeResolvedClient(overrides?: {
  clientId?: string
  clientUserId?: string | null
  clientEmail?: string | null
  clientClaimStatus?: ClientClaimStatus
  clientAddressId?: string | null
}) {
  return {
    ok: true as const,
    clientId: overrides?.clientId ?? 'client_1',
    clientUserId:
      overrides?.clientUserId !== undefined
        ? overrides.clientUserId
        : 'user_client_1',
    clientEmail:
      overrides?.clientEmail !== undefined
        ? overrides.clientEmail
        : 'client@example.com',
    clientClaimStatus:
      overrides?.clientClaimStatus ?? ClientClaimStatus.CLAIMED,
    clientAddressId:
      overrides?.clientAddressId !== undefined
        ? overrides.clientAddressId
        : null,
  }
}

function makeBookingResult(overrides?: {
  bookingId?: string
  locationType?: ServiceLocationType
  clientAddressId?: string | null
}) {
  return {
    booking: {
      id: overrides?.bookingId ?? 'booking_1',
      scheduledFor,
      totalDurationMinutes: 60,
      bufferMinutes: 15,
      status: BookingStatus.ACCEPTED,
    },
    subtotalSnapshot: new Prisma.Decimal('50.00'),
    stepMinutes: 15,
    appointmentTimeZone: 'America/Los_Angeles',
    locationId: 'loc_1',
    locationType: overrides?.locationType ?? ServiceLocationType.SALON,
    clientAddressId:
      overrides?.clientAddressId !== undefined
        ? overrides.clientAddressId
        : null,
    serviceName: 'Haircut',
    meta: {
      mutated: true,
      noOp: false,
    },
  }
}

describe('createProBookingWithClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.resolveProBookingClient.mockResolvedValue(makeResolvedClient())
    mocks.createProBooking.mockResolvedValue(makeBookingResult())
    mocks.createProClientInvite.mockResolvedValue({
      id: 'invite_1',
      token: 'token_1',
    })
  })

  it('passes through resolveProBookingClient failures unchanged', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error:
        'That email and phone match different client profiles. Please double check with the client before continuing.',
      code: 'IDENTITY_CONFLICT',
    })

    const result = await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      client: {
        firstName: 'Tori',
        lastName: 'Morales',
        email: 'tori@example.com',
        phone: '+16195551234',
      },
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      scheduledFor,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error:
        'That email and phone match different client profiles. Please double check with the client before continuing.',
      code: 'IDENTITY_CONFLICT',
    })

    expect(mocks.createProBooking).not.toHaveBeenCalled()
    expect(mocks.createProClientInvite).not.toHaveBeenCalled()
  })

  it('passes normalized client and service address data to resolveProBookingClient', async () => {
    await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
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
        placeId: 'place_1',
        lat: 32.7157,
        lng: -117.1611,
        isDefault: true,
      },
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.MOBILE,
      scheduledFor,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
    })

    expect(mocks.resolveProBookingClient).toHaveBeenCalledWith({
      locationType: ServiceLocationType.MOBILE,
      clientId: undefined,
      client: {
        firstName: 'Tori',
        lastName: 'Morales',
        email: 'tori@example.com',
        phone: '+16195551234',
      },
      clientAddressId: undefined,
      serviceAddress: {
        label: 'Home',
        formattedAddress: '123 Main St, San Diego, CA',
        addressLine1: '123 Main St',
        city: 'San Diego',
        state: 'CA',
        postalCode: '92101',
        countryCode: 'US',
        placeId: 'place_1',
        lat: 32.7157,
        lng: -117.1611,
        isDefault: true,
      },
    })
  })

  it('creates the booking with the resolved client identity and address', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_resolved_1',
        clientUserId: null,
        clientEmail: 'newclient@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
        clientAddressId: 'addr_1',
      }),
    )

    const result = await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: 'VIP exception',
      client: {
        firstName: 'New',
        lastName: 'Client',
        email: 'newclient@example.com',
      },
      clientAddressId: 'addr_1',
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.MOBILE,
      scheduledFor,
      internalNotes: 'Bring photos',
      requestedBufferMinutes: 20,
      requestedTotalDurationMinutes: 90,
      allowOutsideWorkingHours: true,
      allowShortNotice: true,
      allowFarFuture: false,
    })

    expect(mocks.createProBooking).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: 'VIP exception',
      clientId: 'client_resolved_1',
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.MOBILE,
      scheduledFor,
      clientAddressId: 'addr_1',
      internalNotes: 'Bring photos',
      requestedBufferMinutes: 20,
      requestedTotalDurationMinutes: 90,
      allowOutsideWorkingHours: true,
      allowShortNotice: true,
      allowFarFuture: false,
    })

    expect(result).toEqual({
      ok: true,
      clientId: 'client_resolved_1',
      clientUserId: null,
      clientEmail: 'newclient@example.com',
      clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      clientAddressId: 'addr_1',
      bookingResult: makeBookingResult(),
      invite: {
        id: 'invite_1',
        token: 'token_1',
      },
    })
  })

  it('does not auto-create an invite when a raw clientId was provided', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_existing_1',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    const result = await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      clientId: 'client_existing_1',
      client: {
        firstName: 'Tori',
        lastName: 'Morales',
        email: 'tori@example.com',
      },
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      scheduledFor,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
    })

    expect(mocks.createProClientInvite).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      clientId: 'client_existing_1',
      clientUserId: 'user_client_1',
      clientEmail: 'client@example.com',
      clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      clientAddressId: null,
      bookingResult: makeBookingResult(),
      invite: null,
    })
  })

  it('does not auto-create an invite when the resolved client is already claimed', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_claimed_1',
        clientUserId: 'user_claimed_1',
        clientEmail: 'claimed@example.com',
        clientClaimStatus: ClientClaimStatus.CLAIMED,
      }),
    )

    const result = await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      client: {
        firstName: 'Claimed',
        lastName: 'Client',
        email: 'claimed@example.com',
      },
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      scheduledFor,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
    })

    expect(mocks.createProClientInvite).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      clientId: 'client_claimed_1',
      clientUserId: 'user_claimed_1',
      clientEmail: 'claimed@example.com',
      clientClaimStatus: ClientClaimStatus.CLAIMED,
      clientAddressId: null,
      bookingResult: makeBookingResult(),
      invite: null,
    })
  })

  it('auto-creates an invite for a new unclaimed client with email only and infers EMAIL preference', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: 'newclient@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    const result = await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      client: {
        firstName: 'New',
        lastName: 'Client',
        email: 'newclient@example.com',
      },
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      scheduledFor,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
    })

    expect(mocks.createProClientInvite).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      bookingId: 'booking_1',
      invitedName: 'New Client',
      invitedEmail: 'newclient@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    expect(result).toEqual({
      ok: true,
      clientId: 'client_unclaimed_1',
      clientUserId: null,
      clientEmail: 'newclient@example.com',
      clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      clientAddressId: null,
      bookingResult: makeBookingResult(),
      invite: {
        id: 'invite_1',
        token: 'token_1',
      },
    })
  })

  it('auto-creates an invite for a new unclaimed client with phone only and infers SMS preference', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: null,
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      client: {
        firstName: 'Phone',
        lastName: 'Only',
        phone: '+16195551234',
      },
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      scheduledFor,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
    })

    expect(mocks.createProClientInvite).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      bookingId: 'booking_1',
      invitedName: 'Phone Only',
      invitedEmail: null,
      invitedPhone: '+16195551234',
      preferredContactMethod: ContactMethod.SMS,
    })
  })

  it('auto-creates an invite with null preferredContactMethod when both email and phone exist', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: 'both@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      client: {
        firstName: 'Both',
        lastName: 'Channels',
        email: 'both@example.com',
        phone: '+16195551234',
      },
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      scheduledFor,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
    })

    expect(mocks.createProClientInvite).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      bookingId: 'booking_1',
      invitedName: 'Both Channels',
      invitedEmail: 'both@example.com',
      invitedPhone: '+16195551234',
      preferredContactMethod: null,
    })
  })

  it('does not auto-create an invite when the unclaimed client payload cannot build an invited name', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: 'noname@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    const result = await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      client: {
        email: 'noname@example.com',
      },
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      scheduledFor,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
    })

    expect(mocks.createProClientInvite).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      clientId: 'client_unclaimed_1',
      clientUserId: null,
      clientEmail: 'noname@example.com',
      clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      clientAddressId: null,
      bookingResult: makeBookingResult(),
      invite: null,
    })
  })
})