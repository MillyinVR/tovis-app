import {
  ClientClaimStatus,
  ContactMethod,
  Prisma,
  ProClientInviteStatus,
  ServiceLocationType,
} from '@prisma/client'

import {
  resolveProBookingClient,
  type ProBookingServiceAddressInput,
} from '@/lib/booking/resolveProBookingClient'
import { createProBooking } from '@/lib/booking/writeBoundary'
import { createClientClaimInviteDelivery } from '@/lib/clientActions/createClientClaimInviteDelivery'
import { upsertClientClaimLink } from '@/lib/clients/clientClaimLinks'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'

type NewClientInput = {
  firstName?: unknown
  lastName?: unknown
  email?: unknown
  phone?: unknown
}

const inviteClientSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  claimStatus: true,
} satisfies Prisma.ClientProfileSelect

type InviteClientSnapshot = Prisma.ClientProfileGetPayload<{
  select: typeof inviteClientSelect
}>

export type CreateProBookingWithClientArgs = {
  professionalId: string
  actorUserId: string
  overrideReason: string | null

  clientId?: string | null
  client?: NewClientInput | null
  clientAddressId?: string | null
  serviceAddress?: ProBookingServiceAddressInput | null

  offeringId: string
  locationId: string
  locationType: ServiceLocationType
  scheduledFor: Date
  internalNotes: string | null
  requestedBufferMinutes: number | null
  requestedTotalDurationMinutes: number | null
  allowOutsideWorkingHours: boolean
  allowShortNotice: boolean
  allowFarFuture: boolean
}

type CreateProBookingResult = Awaited<ReturnType<typeof createProBooking>>

type CreatedInviteResult = {
  id: string
  token: string
}

type CreatedInviteDeliveryCandidate = CreatedInviteResult & {
  invitedName: string
  invitedEmail: string | null
  invitedPhone: string | null
  preferredContactMethod: ContactMethod | null
}

export type CreateProBookingWithClientResult =
  | {
      ok: true
      clientId: string
      clientUserId: string | null
      clientEmail: string | null
      clientClaimStatus: ClientClaimStatus
      clientAddressId: string | null
      bookingResult: CreateProBookingResult
      invite: CreatedInviteResult | null
    }
  | {
      ok: false
      status: number
      error: string
      code: string
    }

function normalizeClientInput(
  value: CreateProBookingWithClientArgs['client'],
): NewClientInput | null {
  if (!value) return null
  if (!isRecord(value)) return null

  return {
    firstName: value.firstName,
    lastName: value.lastName,
    email: value.email,
    phone: value.phone,
  }
}

function normalizeServiceAddressInput(
  value: CreateProBookingWithClientArgs['serviceAddress'],
): ProBookingServiceAddressInput | null {
  if (!value) return null
  if (!isRecord(value)) return null
  return value
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function shouldAutoCreateInvite(args: {
  resolvedClientClaimStatus: ClientClaimStatus
}): boolean {
  return args.resolvedClientClaimStatus === ClientClaimStatus.UNCLAIMED
}

function buildInvitedName(client: InviteClientSnapshot | null): string | null {
  if (!client) return null

  const firstName = normalizeOptionalString(client.firstName)
  const lastName = normalizeOptionalString(client.lastName)
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()

  return fullName || null
}

function inferPreferredContactMethod(args: {
  email: string | null
  phone: string | null
}): ContactMethod | null {
  if (args.email && !args.phone) return ContactMethod.EMAIL
  if (args.phone && !args.email) return ContactMethod.SMS
  return null
}

function toPublicInviteResult(
  invite: CreatedInviteDeliveryCandidate,
): CreatedInviteResult {
  return {
    id: invite.id,
    token: invite.token,
  }
}

async function loadInviteClientSnapshot(
  clientId: string,
): Promise<InviteClientSnapshot | null> {
  return prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: inviteClientSelect,
  })
}

async function tryCreateInvite(args: {
  professionalId: string
  bookingId: string
  clientId: string
}): Promise<CreatedInviteDeliveryCandidate | null> {
  const clientSnapshot = await loadInviteClientSnapshot(args.clientId)

  if (!clientSnapshot) {
    console.error('createProBookingWithClient invite client lookup failed', {
      professionalId: args.professionalId,
      bookingId: args.bookingId,
      clientId: args.clientId,
    })
    return null
  }

  if (clientSnapshot.claimStatus !== ClientClaimStatus.UNCLAIMED) {
    return null
  }

  const invitedName = buildInvitedName(clientSnapshot)
  const invitedEmail = normalizeOptionalString(clientSnapshot.email)
  const invitedPhone = normalizeOptionalString(clientSnapshot.phone)
  const preferredContactMethod = inferPreferredContactMethod({
    email: invitedEmail,
    phone: invitedPhone,
  })

  if (!invitedName || (!invitedEmail && !invitedPhone)) {
    return null
  }

  try {
    const createdInvite = await upsertClientClaimLink({
      professionalId: args.professionalId,
      clientId: args.clientId,
      bookingId: args.bookingId,
      invitedName,
      invitedEmail,
      invitedPhone,
      preferredContactMethod,
    })

    if (
      createdInvite.status !== ProClientInviteStatus.PENDING ||
      createdInvite.acceptedAt != null ||
      createdInvite.revokedAt != null
    ) {
      return null
    }

    return {
      id: createdInvite.id,
      token: createdInvite.token,
      invitedName,
      invitedEmail,
      invitedPhone,
      preferredContactMethod,
    }
  } catch (error: unknown) {
    console.error('createProBookingWithClient invite creation failed', {
      professionalId: args.professionalId,
      bookingId: args.bookingId,
      clientId: args.clientId,
      error,
    })
    return null
  }
}

async function tryEnqueueInviteDelivery(args: {
  professionalId: string
  actorUserId: string
  bookingId: string
  clientId: string
  clientUserId: string | null
  invite: CreatedInviteDeliveryCandidate
}): Promise<void> {
  try {
    await createClientClaimInviteDelivery({
      professionalId: args.professionalId,
      clientId: args.clientId,
      bookingId: args.bookingId,
      inviteId: args.invite.id,
      rawToken: args.invite.token,
      invitedName: args.invite.invitedName,
      invitedEmail: args.invite.invitedEmail,
      invitedPhone: args.invite.invitedPhone,
      preferredContactMethod: args.invite.preferredContactMethod,
      issuedByUserId: args.actorUserId,
      recipientUserId: args.clientUserId,
    })
  } catch (error: unknown) {
    console.error('createProBookingWithClient invite delivery enqueue failed', {
      professionalId: args.professionalId,
      bookingId: args.bookingId,
      clientId: args.clientId,
      inviteId: args.invite.id,
      error,
    })
  }
}

export async function createProBookingWithClient(
  args: CreateProBookingWithClientArgs,
): Promise<CreateProBookingWithClientResult> {
  const normalizedClient = normalizeClientInput(args.client)
  const normalizedServiceAddress = normalizeServiceAddressInput(
    args.serviceAddress,
  )

  const resolvedClient = await resolveProBookingClient({
    locationType: args.locationType,
    clientId: args.clientId,
    client: normalizedClient,
    clientAddressId: args.clientAddressId,
    serviceAddress: normalizedServiceAddress,
  })

  if (!resolvedClient.ok) {
    return resolvedClient
  }

  const bookingResult = await createProBooking({
    professionalId: args.professionalId,
    actorUserId: args.actorUserId,
    overrideReason: args.overrideReason,
    clientId: resolvedClient.clientId,
    offeringId: args.offeringId,
    locationId: args.locationId,
    locationType: args.locationType,
    scheduledFor: args.scheduledFor,
    clientAddressId: resolvedClient.clientAddressId,
    internalNotes: args.internalNotes,
    requestedBufferMinutes: args.requestedBufferMinutes,
    requestedTotalDurationMinutes: args.requestedTotalDurationMinutes,
    allowOutsideWorkingHours: args.allowOutsideWorkingHours,
    allowShortNotice: args.allowShortNotice,
    allowFarFuture: args.allowFarFuture,
  })

  let inviteCandidate: CreatedInviteDeliveryCandidate | null = null

  if (
    shouldAutoCreateInvite({
      resolvedClientClaimStatus: resolvedClient.clientClaimStatus,
    })
  ) {
    inviteCandidate = await tryCreateInvite({
      professionalId: args.professionalId,
      bookingId: bookingResult.booking.id,
      clientId: resolvedClient.clientId,
    })

    if (inviteCandidate) {
      await tryEnqueueInviteDelivery({
        professionalId: args.professionalId,
        actorUserId: args.actorUserId,
        bookingId: bookingResult.booking.id,
        clientId: resolvedClient.clientId,
        clientUserId: resolvedClient.clientUserId,
        invite: inviteCandidate,
      })
    }
  }

  return {
    ok: true,
    clientId: resolvedClient.clientId,
    clientUserId: resolvedClient.clientUserId,
    clientEmail: resolvedClient.clientEmail,
    clientClaimStatus: resolvedClient.clientClaimStatus,
    clientAddressId: resolvedClient.clientAddressId,
    bookingResult,
    invite: inviteCandidate ? toPublicInviteResult(inviteCandidate) : null,
  }
}