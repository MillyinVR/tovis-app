import { ServiceLocationType } from '@prisma/client'

import { createProBooking } from '@/lib/booking/writeBoundary'
import { upsertProClient } from '@/lib/clients/upsertProClient'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'

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

  offeringId: string
  locationId: string
  locationType: ServiceLocationType
  scheduledFor: Date
  clientAddressId: string | null
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
      bookingResult: CreateProBookingResult
    }
  | {
      ok: false
      status: number
      error: string
      code: string
    }

function normalizeOptionalString(value: unknown): string | null {
  const normalized = pickString(value)
  return normalized && normalized.trim() ? normalized.trim() : null
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  return value != null
}

function normalizeNewClientInput(
  value: CreateProBookingWithClientArgs['client'],
): NewClientInput {
  if (!value) return {}

  if (isRecord(value)) {
    return {
      firstName: value.firstName,
      lastName: value.lastName,
      email: value.email,
      phone: value.phone,
    }
  }

  return {}
}

function hasNewClientPayload(input: NewClientInput): boolean {
  return (
    hasMeaningfulValue(input.firstName) ||
    hasMeaningfulValue(input.lastName) ||
    hasMeaningfulValue(input.email) ||
    hasMeaningfulValue(input.phone)
  )
}

async function resolveClientForBooking(args: {
  clientId?: string | null
  client?: NewClientInput | null
}): Promise<
  | {
      ok: true
      clientId: string
      clientUserId: string | null
      clientEmail: string | null
    }
  | {
      ok: false
      status: number
      error: string
      code: string
    }
> {
  const existingClientId = normalizeOptionalString(args.clientId)

  if (existingClientId) {
    return {
      ok: true,
      clientId: existingClientId,
      clientUserId: null,
      clientEmail: null,
    }
  }

  const clientInput = normalizeNewClientInput(args.client)

  if (!hasNewClientPayload(clientInput)) {
    return {
      ok: false,
      status: 400,
      error: 'clientId or client details are required.',
      code: 'VALIDATION_ERROR',
    }
  }

  const upserted = await upsertProClient({
    firstName: clientInput.firstName,
    lastName: clientInput.lastName,
    email: clientInput.email,
    phone: clientInput.phone,
  })

  if (!upserted.ok) {
    return upserted
  }

  return {
    ok: true,
    clientId: upserted.clientId,
    clientUserId: upserted.userId,
    clientEmail: upserted.email,
  }
}

export async function createProBookingWithClient(
  args: CreateProBookingWithClientArgs,
): Promise<CreateProBookingWithClientResult> {
  const resolvedClient = await resolveClientForBooking({
    clientId: args.clientId,
    client: args.client,
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
    clientAddressId: args.clientAddressId,
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
    bookingResult,
  }
}