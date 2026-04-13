import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  ClientClaimStatus,
  ContactMethod,
  Prisma,
  ProClientInviteStatus,
  ServiceLocationType,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  resolveProBookingClient: vi.fn(),
  createProBooking: vi.fn(),
  upsertClientClaimLink: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  createClientClaimInviteDelivery: vi.fn(),
}))

vi.mock('@/lib/booking/resolveProBookingClient', () => ({
  resolveProBookingClient: mocks.resolveProBookingClient,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  createProBooking: mocks.createProBooking,
}))

vi.mock('@/lib/clients/clientClaimLinks', () => ({
  upsertClientClaimLink: mocks.upsertClientClaimLink,
}))

vi.mock('@/lib/clientActions/createClientClaimInviteDelivery', () => ({
  createClientClaimInviteDelivery: mocks.createClientClaimInviteDelivery,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: {
      findUnique: mocks.clientProfileFindUnique,
    },
  },
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

function makeInviteClientSnapshot(overrides?: {
  id?: string
  firstName?: string
  lastName?: string
  email?: string | null
  phone?: string | null
  claimStatus?: ClientClaimStatus
}) {
  return {
    id: overrides?.id ?? 'client_1',
    firstName: overrides?.firstName ?? 'Tori',
    lastName: overrides?.lastName ?? 'Morales',
    email:
      overrides?.email !== undefined ? overrides.email : 'tori@example.com',
    phone: overrides?.phone !== undefined ? overrides.phone : null,
    claimStatus: overrides?.claimStatus ?? ClientClaimStatus.UNCLAIMED,
  }
}

function makeInviteResult(overrides?: {
  id?: string
  token?: string
  status?: ProClientInviteStatus
  acceptedAt?: Date | null
  revokedAt?: Date | null
}) {
  return {
    id: overrides?.id ?? 'invite_1',
    token: overrides?.token ?? 'token_1',
    status: overrides?.status ?? ProClientInviteStatus.PENDING,
    acceptedAt:
      overrides?.acceptedAt !== undefined ? overrides.acceptedAt : null,
    revokedAt: overrides?.revokedAt !== undefined ? overrides.revokedAt : null,
  }
}

function makeInviteDeliveryResult() {
  return {
    plan: {
      idempotency: {
        baseKey: 'base_1',
        sendKey: 'send_1',
      },
    },
    link: {
      target: 'CLAIM',
      href: '/claim/token_1',
      tokenIncluded: true,
    },
    dispatch: {
      created: true,
      selectedChannels: [],
      evaluations: [],
      dispatch: {
        id: 'dispatch_1',
      },
    },
  }
}

describe('createProBookingWithClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.resolveProBookingClient.mockResolvedValue(makeResolvedClient())
    mocks.createProBooking.mockResolvedValue(makeBookingResult())
    mocks.clientProfileFindUnique.mockResolvedValue(makeInviteClientSnapshot())
    mocks.upsertClientClaimLink.mockResolvedValue(makeInviteResult())
    mocks.createClientClaimInviteDelivery.mockResolvedValue(
      makeInviteDeliveryResult(),
    )
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
    expect(mocks.upsertClientClaimLink).not.toHaveBeenCalled()
    expect(mocks.clientProfileFindUnique).not.toHaveBeenCalled()
    expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()
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

    mocks.clientProfileFindUnique.mockResolvedValueOnce(
      makeInviteClientSnapshot({
        id: 'client_resolved_1',
        firstName: 'New',
        lastName: 'Client',
        email: 'newclient@example.com',
        phone: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
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

    expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      clientId: 'client_resolved_1',
      bookingId: 'booking_1',
      inviteId: 'invite_1',
      rawToken: 'token_1',
      invitedName: 'New Client',
      invitedEmail: 'newclient@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      issuedByUserId: 'user_1',
      recipientUserId: null,
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

  it('auto-creates an invite for an existing unclaimed clientId path using DB client profile truth', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_existing_1',
        clientUserId: null,
        clientEmail: 'existing-unclaimed@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.clientProfileFindUnique.mockResolvedValueOnce(
      makeInviteClientSnapshot({
        id: 'client_existing_1',
        firstName: 'Existing',
        lastName: 'Unclaimed',
        email: 'existing-unclaimed@example.com',
        phone: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    const result = await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      clientId: 'client_existing_1',
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

    expect(mocks.clientProfileFindUnique).toHaveBeenCalledWith({
      where: { id: 'client_existing_1' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        claimStatus: true,
      },
    })

    expect(mocks.upsertClientClaimLink).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      clientId: 'client_existing_1',
      bookingId: 'booking_1',
      invitedName: 'Existing Unclaimed',
      invitedEmail: 'existing-unclaimed@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      clientId: 'client_existing_1',
      bookingId: 'booking_1',
      inviteId: 'invite_1',
      rawToken: 'token_1',
      invitedName: 'Existing Unclaimed',
      invitedEmail: 'existing-unclaimed@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      issuedByUserId: 'user_1',
      recipientUserId: null,
    })

    expect(result).toEqual({
      ok: true,
      clientId: 'client_existing_1',
      clientUserId: null,
      clientEmail: 'existing-unclaimed@example.com',
      clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      clientAddressId: null,
      bookingResult: makeBookingResult(),
      invite: {
        id: 'invite_1',
        token: 'token_1',
      },
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

    expect(mocks.clientProfileFindUnique).not.toHaveBeenCalled()
    expect(mocks.upsertClientClaimLink).not.toHaveBeenCalled()
    expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()
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

  it('auto-creates an invite for an unclaimed client with email only and infers EMAIL preference from DB truth', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: 'newclient@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.clientProfileFindUnique.mockResolvedValueOnce(
      makeInviteClientSnapshot({
        id: 'client_unclaimed_1',
        firstName: 'New',
        lastName: 'Client',
        email: 'newclient@example.com',
        phone: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    const result = await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      client: {
        firstName: 'Ignored',
        lastName: 'Payload',
        email: 'ignored@example.com',
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

    expect(mocks.upsertClientClaimLink).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      clientId: 'client_unclaimed_1',
      bookingId: 'booking_1',
      invitedName: 'New Client',
      invitedEmail: 'newclient@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      clientId: 'client_unclaimed_1',
      bookingId: 'booking_1',
      inviteId: 'invite_1',
      rawToken: 'token_1',
      invitedName: 'New Client',
      invitedEmail: 'newclient@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      issuedByUserId: 'user_1',
      recipientUserId: null,
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

  it('auto-creates an invite for an unclaimed client with phone only and infers SMS preference from DB truth', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: null,
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.clientProfileFindUnique.mockResolvedValueOnce(
      makeInviteClientSnapshot({
        id: 'client_unclaimed_1',
        firstName: 'Phone',
        lastName: 'Only',
        email: null,
        phone: '+16195551234',
        claimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      client: {
        firstName: 'Ignored',
        lastName: 'Payload',
        phone: '+19999999999',
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

    expect(mocks.upsertClientClaimLink).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      clientId: 'client_unclaimed_1',
      bookingId: 'booking_1',
      invitedName: 'Phone Only',
      invitedEmail: null,
      invitedPhone: '+16195551234',
      preferredContactMethod: ContactMethod.SMS,
    })

    expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      clientId: 'client_unclaimed_1',
      bookingId: 'booking_1',
      inviteId: 'invite_1',
      rawToken: 'token_1',
      invitedName: 'Phone Only',
      invitedEmail: null,
      invitedPhone: '+16195551234',
      preferredContactMethod: ContactMethod.SMS,
      issuedByUserId: 'user_1',
      recipientUserId: null,
    })
  })

  it('auto-creates an invite with null preferredContactMethod when both email and phone exist in DB', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: 'both@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.clientProfileFindUnique.mockResolvedValueOnce(
      makeInviteClientSnapshot({
        id: 'client_unclaimed_1',
        firstName: 'Both',
        lastName: 'Channels',
        email: 'both@example.com',
        phone: '+16195551234',
        claimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      client: {
        firstName: 'Ignored',
        lastName: 'Payload',
        email: 'ignored@example.com',
        phone: '+19999999999',
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

    expect(mocks.upsertClientClaimLink).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      clientId: 'client_unclaimed_1',
      bookingId: 'booking_1',
      invitedName: 'Both Channels',
      invitedEmail: 'both@example.com',
      invitedPhone: '+16195551234',
      preferredContactMethod: null,
    })

    expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      clientId: 'client_unclaimed_1',
      bookingId: 'booking_1',
      inviteId: 'invite_1',
      rawToken: 'token_1',
      invitedName: 'Both Channels',
      invitedEmail: 'both@example.com',
      invitedPhone: '+16195551234',
      preferredContactMethod: null,
      issuedByUserId: 'user_1',
      recipientUserId: null,
    })
  })

  it('does not auto-create an invite when DB client profile cannot build an invited name', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: 'noname@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.clientProfileFindUnique.mockResolvedValueOnce(
      makeInviteClientSnapshot({
        id: 'client_unclaimed_1',
        firstName: '   ',
        lastName: '   ',
        email: 'noname@example.com',
        phone: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    const result = await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      client: {
        email: 'ignored@example.com',
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

    expect(mocks.upsertClientClaimLink).not.toHaveBeenCalled()
    expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()
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

  it('does not auto-create an invite when DB client profile has neither email nor phone', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: null,
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.clientProfileFindUnique.mockResolvedValueOnce(
      makeInviteClientSnapshot({
        id: 'client_unclaimed_1',
        firstName: 'No',
        lastName: 'Channel',
        email: null,
        phone: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    const result = await createProBookingWithClient({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      client: {
        firstName: 'Ignored',
        lastName: 'Payload',
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

    expect(mocks.upsertClientClaimLink).not.toHaveBeenCalled()
    expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      clientId: 'client_unclaimed_1',
      clientUserId: null,
      clientEmail: null,
      clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      clientAddressId: null,
      bookingResult: makeBookingResult(),
      invite: null,
    })
  })

  it('does not return invite payload when helper returns an already accepted invite', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: 'newclient@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.clientProfileFindUnique.mockResolvedValueOnce(
      makeInviteClientSnapshot({
        id: 'client_unclaimed_1',
        firstName: 'New',
        lastName: 'Client',
        email: 'newclient@example.com',
        phone: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.upsertClientClaimLink.mockResolvedValueOnce(
      makeInviteResult({
        status: ProClientInviteStatus.ACCEPTED,
        acceptedAt: new Date('2026-03-11T20:00:00.000Z'),
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

    expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      clientId: 'client_unclaimed_1',
      clientUserId: null,
      clientEmail: 'newclient@example.com',
      clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      clientAddressId: null,
      bookingResult: makeBookingResult(),
      invite: null,
    })
  })

  it('does not return invite payload when helper returns a revoked invite', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: 'newclient@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.clientProfileFindUnique.mockResolvedValueOnce(
      makeInviteClientSnapshot({
        id: 'client_unclaimed_1',
        firstName: 'New',
        lastName: 'Client',
        email: 'newclient@example.com',
        phone: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.upsertClientClaimLink.mockResolvedValueOnce(
      makeInviteResult({
        status: ProClientInviteStatus.REVOKED,
        revokedAt: new Date('2026-03-11T20:00:00.000Z'),
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

    expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      clientId: 'client_unclaimed_1',
      clientUserId: null,
      clientEmail: 'newclient@example.com',
      clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      clientAddressId: null,
      bookingResult: makeBookingResult(),
      invite: null,
    })
  })

  it('still succeeds when invite client lookup fails and returns invite as null', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: 'newclient@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.clientProfileFindUnique.mockResolvedValueOnce(null)

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
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

      expect(mocks.createProBooking).toHaveBeenCalledTimes(1)
      expect(mocks.upsertClientClaimLink).not.toHaveBeenCalled()
      expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'createProBookingWithClient invite client lookup failed',
        {
          professionalId: 'pro_1',
          bookingId: 'booking_1',
          clientId: 'client_unclaimed_1',
        },
      )

      expect(result).toEqual({
        ok: true,
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: 'newclient@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
        clientAddressId: null,
        bookingResult: makeBookingResult(),
        invite: null,
      })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('still succeeds when invite creation throws and returns invite as null', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: 'newclient@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.clientProfileFindUnique.mockResolvedValueOnce(
      makeInviteClientSnapshot({
        id: 'client_unclaimed_1',
        firstName: 'New',
        lastName: 'Client',
        email: 'newclient@example.com',
        phone: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.upsertClientClaimLink.mockRejectedValueOnce(
      new Error('invite creation failed'),
    )

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
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

      expect(mocks.createProBooking).toHaveBeenCalledTimes(1)
      expect(mocks.upsertClientClaimLink).toHaveBeenCalledTimes(1)
      expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'createProBookingWithClient invite creation failed',
        expect.objectContaining({
          professionalId: 'pro_1',
          bookingId: 'booking_1',
          clientId: 'client_unclaimed_1',
          error: expect.any(Error),
        }),
      )

      expect(result).toEqual({
        ok: true,
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: 'newclient@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
        clientAddressId: null,
        bookingResult: makeBookingResult(),
        invite: null,
      })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('still succeeds when invite delivery enqueue throws and returns invite payload', async () => {
    mocks.resolveProBookingClient.mockResolvedValueOnce(
      makeResolvedClient({
        clientId: 'client_unclaimed_1',
        clientUserId: null,
        clientEmail: 'newclient@example.com',
        clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.clientProfileFindUnique.mockResolvedValueOnce(
      makeInviteClientSnapshot({
        id: 'client_unclaimed_1',
        firstName: 'New',
        lastName: 'Client',
        email: 'newclient@example.com',
        phone: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
      }),
    )

    mocks.createClientClaimInviteDelivery.mockRejectedValueOnce(
      new Error('dispatch enqueue failed'),
    )

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
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

      expect(mocks.upsertClientClaimLink).toHaveBeenCalledTimes(1)
      expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledTimes(1)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'createProBookingWithClient invite delivery enqueue failed',
        expect.objectContaining({
          professionalId: 'pro_1',
          bookingId: 'booking_1',
          clientId: 'client_unclaimed_1',
          inviteId: 'invite_1',
          error: expect.any(Error),
        }),
      )

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
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})