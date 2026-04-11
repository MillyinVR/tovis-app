import { ServiceLocationType } from '@prisma/client'

import { createProBooking } from '@/lib/booking/writeBoundary'
import {
  resolveProBookingClient,
  type ProBookingServiceAddressInput,
} from '@/lib/booking/resolveProBookingClient'
import { isRecord } from '@/lib/guards'

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

export type CreateProBookingWithClientResult =
  | {
      ok: true
      clientId: string
      clientUserId: string | null
      clientEmail: string | null
      clientAddressId: string | null
      bookingResult: CreateProBookingResult
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

  if (isRecord(value)) {
    return {
      firstName: value.firstName,
      lastName: value.lastName,
      email: value.email,
      phone: value.phone,
    }
  }

  return null
}

function normalizeServiceAddressInput(
  value: CreateProBookingWithClientArgs['serviceAddress'],
): ProBookingServiceAddressInput | null {
  if (!value) return null
  if (!isRecord(value)) return null
  return value
}

export async function createProBookingWithClient(
  args: CreateProBookingWithClientArgs,
): Promise<CreateProBookingWithClientResult> {
  const resolvedClient = await resolveProBookingClient({
    locationType: args.locationType,
    clientId: args.clientId,
    client: normalizeClientInput(args.client),
    clientAddressId: args.clientAddressId,
    serviceAddress: normalizeServiceAddressInput(args.serviceAddress),
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

  return {
    ok: true,
    clientId: resolvedClient.clientId,
    clientUserId: resolvedClient.clientUserId,
    clientEmail: resolvedClient.clientEmail,
    clientAddressId: resolvedClient.clientAddressId,
    bookingResult,
  }
}