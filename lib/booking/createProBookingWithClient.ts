import {
  ClientClaimStatus,
  ContactMethod,
  ServiceLocationType,
} from '@prisma/client'

import {
  resolveProBookingClient,
  type ProBookingServiceAddressInput,
} from '@/lib/booking/resolveProBookingClient'
import { createProBooking } from '@/lib/booking/writeBoundary'
import { isRecord } from '@/lib/guards'
import { createProClientInvite } from '@/lib/invites/proClientInvite'

type NewClientInput = {
  firstName?: unknown
  lastName?: unknown
  email?: unknown
  phone?: unknown
}

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

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  return value != null
}

function shouldAutoCreateInvite(args: {
  rawClientId?: string | null
  normalizedClient: NewClientInput | null
  resolvedClientClaimStatus: ClientClaimStatus
}): boolean {
  if (typeof args.rawClientId === 'string' && args.rawClientId.trim()) {
    return false
  }

  if (args.resolvedClientClaimStatus !== ClientClaimStatus.UNCLAIMED) {
    return false
  }

  const client = args.normalizedClient
  if (!client) return false

  return (
    hasMeaningfulValue(client.firstName) ||
    hasMeaningfulValue(client.lastName) ||
    hasMeaningfulValue(client.email) ||
    hasMeaningfulValue(client.phone)
  )
}

function buildInvitedName(client: NewClientInput | null): string | null {
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

  let invite: CreatedInviteResult | null = null

  if (
    shouldAutoCreateInvite({
      rawClientId: args.clientId,
      normalizedClient,
      resolvedClientClaimStatus: resolvedClient.clientClaimStatus,
    })
  ) {
    const invitedName = buildInvitedName(normalizedClient)
    const invitedEmail = normalizeOptionalString(normalizedClient?.email)
    const invitedPhone = normalizeOptionalString(normalizedClient?.phone)

    if (invitedName && (invitedEmail || invitedPhone)) {
      const createdInvite = await createProClientInvite({
        professionalId: args.professionalId,
        bookingId: bookingResult.booking.id,
        invitedName,
        invitedEmail,
        invitedPhone,
        preferredContactMethod: inferPreferredContactMethod({
          email: invitedEmail,
          phone: invitedPhone,
        }),
      })

      invite = {
        id: createdInvite.id,
        token: createdInvite.token,
      }
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
    invite,
  }
}