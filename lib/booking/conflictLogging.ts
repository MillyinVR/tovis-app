// lib/booking/conflictLogging.ts
export type BookingConflictType =
  | 'BLOCKED'
  | 'BOOKING'
  | 'HOLD'
  | 'WORKING_HOURS'
  | 'STEP_BOUNDARY'
  | 'TIME_NOT_AVAILABLE'
  | 'UNKNOWN'

export type BookingConflictAction =
  | 'BLOCK_CREATE'
  | 'BLOCK_UPDATE'
  | 'BOOKING_CREATE'
  | 'BOOKING_UPDATE'
  | 'BOOKING_RESCHEDULE'
  | 'BOOKING_FINALIZE'

export type BookingConflictLogArgs = {
  action: BookingConflictAction
  professionalId: string
  locationId: string | null
  locationType?: string | null
  requestedStart: Date
  requestedEnd: Date
  conflictType: BookingConflictType
  bookingId?: string | null
  holdId?: string | null
  blockId?: string | null
  note?: string | null
  meta?: Record<string, unknown>
}

type BookingConflictLogPayload = {
  event: 'booking_conflict'
  action: BookingConflictAction
  professionalId: string
  locationId: string | null
  locationType: string | null
  requestedStart: string | null
  requestedEnd: string | null
  conflictType: BookingConflictType
  bookingId: string | null
  holdId: string | null
  blockId: string | null
  note: string | null
  meta: Record<string, unknown> | null
  loggedAt: string
}

function toIsoOrNull(value: Date | null | undefined): string | null {
  if (!(value instanceof Date)) return null
  return Number.isFinite(value.getTime()) ? value.toISOString() : null
}

export function logBookingConflict(args: BookingConflictLogArgs) {
  const payload: BookingConflictLogPayload = {
    event: 'booking_conflict',
    action: args.action,
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType ?? null,
    requestedStart: toIsoOrNull(args.requestedStart),
    requestedEnd: toIsoOrNull(args.requestedEnd),
    conflictType: args.conflictType,
    bookingId: args.bookingId ?? null,
    holdId: args.holdId ?? null,
    blockId: args.blockId ?? null,
    note: args.note ?? null,
    meta: args.meta ?? null,
    loggedAt: new Date().toISOString(),
  }

  globalThis.console.warn(JSON.stringify(payload))
}