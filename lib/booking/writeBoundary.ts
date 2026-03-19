// lib/booking/writeBoundary.ts
import {
  BookingServiceItemType,
  BookingSource,
  BookingStatus,
  ClientAddressKind,
  ClientNotificationType,
  OpeningStatus,
  Prisma,
  ServiceLocationType,
  SessionStep,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { lockProfessionalSchedule } from '@/lib/booking/scheduleLock'
import {
  withLockedClientOwnedBookingTransaction,
  withLockedProfessionalTransaction,
} from '@/lib/booking/scheduleTransaction'
import { bookingError, type BookingErrorCode } from '@/lib/booking/errors'
import {
  HOLD_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { addMinutes, normalizeToMinute } from '@/lib/booking/conflicts'
import { logBookingConflict } from '@/lib/booking/conflictLogging'
import {
  resolveValidatedBookingContext,
  type SchedulingReadinessError,
} from '@/lib/booking/locationContext'
import {
  buildAddressSnapshot,
  decimalFromUnknown,
  decimalToNumber,
} from '@/lib/booking/snapshots'
import { DEFAULT_TIME_ZONE } from '@/lib/timeZone'
import { clampInt } from '@/lib/pick'
import {
  normalizeAddress,
  resolveHeldSalonAddressText,
  validateHoldForClientMutation,
} from '@/lib/booking/policies/holdRules'
import { evaluateHoldCreationDecision } from '@/lib/booking/policies/holdPolicy'
import { evaluateRescheduleDecision } from '@/lib/booking/policies/reschedulePolicy'
import { evaluateFinalizeDecision } from '@/lib/booking/policies/finalizePolicy'
import { evaluateProSchedulingDecision } from '@/lib/booking/policies/proSchedulingPolicy'
import { snapToStepMinutes } from '@/lib/booking/serviceItems'
import { getProCreatedBookingStatus } from '@/lib/booking/statusRules'

type MutationMeta = {
  mutated: boolean
  noOp: boolean
}

type CancelActor =
  | {
      kind: 'client'
      clientId: string
    }
  | {
      kind: 'pro'
      professionalId: string
    }
  | {
      kind: 'admin'
      professionalId?: string | null
    }

type CancelBookingArgs = {
  bookingId: string
  actor: CancelActor
  notifyClient?: boolean
  reason?: string | null
  allowedStatuses?: BookingStatus[]
}

type CancelBookingResult = {
  booking: {
    id: string
    status: BookingStatus
    sessionStep: SessionStep
  }
  meta: MutationMeta
}

type ReleaseHoldArgs = {
  holdId: string
  clientId: string
}

type ReleaseHoldResult = {
  holdId: string
  meta: MutationMeta
}

type CreateHoldArgs = {
  clientId: string
  offering: {
    id: string
    professionalId: string
    offersInSalon: boolean
    offersMobile: boolean
    salonDurationMinutes: number | null
    mobileDurationMinutes: number | null
    salonPriceStartingAt: Prisma.Decimal | null
    mobilePriceStartingAt: Prisma.Decimal | null
    professionalTimeZone: string | null
  }
  requestedStart: Date
  requestedLocationId: string | null
  locationType: ServiceLocationType
  clientAddressId: string | null
}

type CreateHoldResult = {
  hold: {
    id: string
    expiresAt: Date
    scheduledFor: Date
    locationType: ServiceLocationType
    locationId: string
    locationTimeZone: string | null
    clientAddressId: string | null
    clientAddressSnapshot: Prisma.JsonValue | null
  }
  meta: MutationMeta
}

type RescheduleBookingFromHoldArgs = {
  bookingId: string
  clientId: string
  holdId: string
  requestedLocationType: ServiceLocationType | null
  fallbackTimeZone?: string
}

type RescheduleBookingFromHoldResult = {
  booking: {
    id: string
    status: BookingStatus
    scheduledFor: Date
    locationType: ServiceLocationType
    bufferMinutes: number
    totalDurationMinutes: number
    locationTimeZone: string | null
  }
  meta: MutationMeta
}

type FinalizeBookingFromHoldArgs = {
  clientId: string
  holdId: string
  openingId: string | null
  addOnIds: string[]
  locationType: ServiceLocationType
  source: BookingSource
  initialStatus: BookingStatus
  rebookOfBookingId: string | null
  fallbackTimeZone?: string
  offering: {
    id: string
    professionalId: string
    serviceId: string
    offersInSalon: boolean
    offersMobile: boolean
    salonPriceStartingAt: Prisma.Decimal | null
    salonDurationMinutes: number | null
    mobilePriceStartingAt: Prisma.Decimal | null
    mobileDurationMinutes: number | null
    professionalTimeZone: string | null
  }
}

type FinalizeBookingFromHoldResult = {
  booking: {
    id: string
    status: BookingStatus
    scheduledFor: Date
    professionalId: string
  }
  meta: MutationMeta
}

type CreateProBookingArgs = {
  professionalId: string
  clientId: string
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

type CreateProBookingResult = {
  booking: {
    id: string
    scheduledFor: Date
    totalDurationMinutes: number
    bufferMinutes: number
    status: BookingStatus
  }
  subtotalSnapshot: Prisma.Decimal
  stepMinutes: number
  appointmentTimeZone: string
  locationId: string
  locationType: ServiceLocationType
  clientAddressId: string | null
  serviceName: string
  meta: MutationMeta
}

type WorkingHoursGuardCode =
  | 'WORKING_HOURS_REQUIRED'
  | 'WORKING_HOURS_INVALID'
  | 'OUTSIDE_WORKING_HOURS'

type HoldConflictType =
  | 'BLOCKED'
  | 'BOOKING'
  | 'HOLD'
  | 'WORKING_HOURS'
  | 'STEP_BOUNDARY'
  | 'TIME_NOT_AVAILABLE'

const WORKING_HOURS_ERROR_PREFIX = 'BOOKING_WORKING_HOURS:'

const CANCEL_BOOKING_SELECT = {
  id: true,
  status: true,
  clientId: true,
  professionalId: true,
  startedAt: true,
  finishedAt: true,
  sessionStep: true,
} satisfies Prisma.BookingSelect

type CancelBookingRecord = Prisma.BookingGetPayload<{
  select: typeof CANCEL_BOOKING_SELECT
}>

const HOLD_OWNERSHIP_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
} satisfies Prisma.BookingHoldSelect

type HoldOwnershipRecord = Prisma.BookingHoldGetPayload<{
  select: typeof HOLD_OWNERSHIP_SELECT
}>

const CLIENT_SERVICE_ADDRESS_SELECT = {
  id: true,
  formattedAddress: true,
  lat: true,
  lng: true,
} satisfies Prisma.ClientAddressSelect

type ClientServiceAddressRecord = Prisma.ClientAddressGetPayload<{
  select: typeof CLIENT_SERVICE_ADDRESS_SELECT
}>

const CREATE_HOLD_SELECT = {
  id: true,
  expiresAt: true,
  scheduledFor: true,
  locationType: true,
  locationId: true,
  locationTimeZone: true,
  clientAddressId: true,
  clientAddressSnapshot: true,
} satisfies Prisma.BookingHoldSelect

type CreateHoldRecord = Prisma.BookingHoldGetPayload<{
  select: typeof CREATE_HOLD_SELECT
}>

const RESCHEDULE_BOOKING_SELECT = {
  id: true,
  status: true,
  clientId: true,
  professionalId: true,
  offeringId: true,
  startedAt: true,
  finishedAt: true,
  totalDurationMinutes: true,
  bufferMinutes: true,
} satisfies Prisma.BookingSelect

const RESCHEDULE_BOOKING_OFFERING_SELECT = {
  id: true,
  offersInSalon: true,
  offersMobile: true,
  salonPriceStartingAt: true,
  salonDurationMinutes: true,
  mobilePriceStartingAt: true,
  mobileDurationMinutes: true,
  professional: {
    select: {
      timeZone: true,
    },
  },
} satisfies Prisma.ProfessionalServiceOfferingSelect

const RESCHEDULE_HOLD_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  offeringId: true,
  scheduledFor: true,
  expiresAt: true,
  locationType: true,
  locationId: true,
  locationTimeZone: true,
  locationAddressSnapshot: true,
  locationLatSnapshot: true,
  locationLngSnapshot: true,
  clientAddressId: true,
  clientAddressSnapshot: true,
  clientAddressLatSnapshot: true,
  clientAddressLngSnapshot: true,
} satisfies Prisma.BookingHoldSelect

const FINALIZE_HOLD_SELECT = {
  id: true,
  offeringId: true,
  professionalId: true,
  clientId: true,
  scheduledFor: true,
  expiresAt: true,
  locationType: true,
  locationId: true,
  locationTimeZone: true,
  locationAddressSnapshot: true,
  locationLatSnapshot: true,
  locationLngSnapshot: true,
  clientAddressId: true,
  clientAddressSnapshot: true,
  clientAddressLatSnapshot: true,
  clientAddressLngSnapshot: true,
} satisfies Prisma.BookingHoldSelect

const PRO_CREATE_CLIENT_SELECT = {
  id: true,
} satisfies Prisma.ClientProfileSelect

const PRO_CREATE_CLIENT_ADDRESS_SELECT = {
  id: true,
  formattedAddress: true,
  lat: true,
  lng: true,
} satisfies Prisma.ClientAddressSelect

const PRO_CREATE_OFFERING_SELECT = {
  id: true,
  serviceId: true,
  offersInSalon: true,
  offersMobile: true,
  salonPriceStartingAt: true,
  mobilePriceStartingAt: true,
  salonDurationMinutes: true,
  mobileDurationMinutes: true,
  professional: {
    select: {
      timeZone: true,
    },
  },
  service: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.ProfessionalServiceOfferingSelect

function buildMeta(mutated: boolean): MutationMeta {
  return {
    mutated,
    noOp: !mutated,
  }
}

function normalizeReason(reason?: string | null): string | null {
  if (typeof reason !== 'string') return null
  const trimmed = reason.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizePositiveDurationMinutes(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return null

  const minutes = Math.trunc(parsed)
  if (minutes <= 0) return null

  return clampInt(minutes, 15, MAX_SLOT_DURATION_MINUTES)
}

function assertNonEmptyBookingId(bookingId: string): void {
  if (!bookingId.trim()) {
    throw bookingError('BOOKING_ID_REQUIRED')
  }
}

function assertNonEmptyHoldId(holdId: string): void {
  if (!holdId.trim()) {
    throw bookingError('HOLD_ID_REQUIRED')
  }
}

function assertNonEmptyClientId(clientId: string): void {
  if (!clientId.trim()) {
    throw bookingError('CLIENT_ID_REQUIRED')
  }
}

function assertNonEmptyProfessionalId(professionalId: string): void {
  if (!professionalId.trim()) {
    throw bookingError('FORBIDDEN')
  }
}

function assertNonEmptyOfferingId(offeringId: string): void {
  if (!offeringId.trim()) {
    throw bookingError('OFFERING_ID_REQUIRED')
  }
}

function assertNonEmptyLocationId(locationId: string): void {
  if (!locationId.trim()) {
    throw bookingError('LOCATION_ID_REQUIRED')
  }
}

function assertValidRequestedStart(requestedStart: Date): void {
  if (!(requestedStart instanceof Date) || Number.isNaN(requestedStart.getTime())) {
    throw bookingError('INVALID_SCHEDULED_FOR')
  }
}

function buildHoldCreateFailure(
  code: BookingErrorCode,
  overrides?: {
    message?: string
    userMessage?: string
  },
): never {
  throw bookingError(code, overrides)
}

function toInputJsonValue(value: Prisma.JsonValue): Prisma.InputJsonValue {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => (item === null ? null : toInputJsonValue(item)))
  }

  if (value === null || typeof value !== 'object') {
    return {}
  }

  const out: Record<string, Prisma.InputJsonValue | null> = {}

  for (const key of Object.keys(value)) {
    const child = value[key]
    if (child === undefined) continue
    out[key] = child === null ? null : toInputJsonValue(child)
  }

  return out
}

function toNullableJsonCreateInput(
  value: Prisma.JsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return toInputJsonValue(value)
}

function mapSchedulingReadinessErrorToBookingCode(
  error: SchedulingReadinessError,
): BookingErrorCode {
  switch (error) {
    case 'LOCATION_NOT_FOUND':
      return 'LOCATION_NOT_FOUND'
    case 'TIMEZONE_REQUIRED':
      return 'TIMEZONE_REQUIRED'
    case 'WORKING_HOURS_REQUIRED':
      return 'WORKING_HOURS_REQUIRED'
    case 'WORKING_HOURS_INVALID':
      return 'WORKING_HOURS_INVALID'
    case 'MODE_NOT_SUPPORTED':
      return 'MODE_NOT_SUPPORTED'
    case 'DURATION_REQUIRED':
      return 'DURATION_REQUIRED'
    case 'PRICE_REQUIRED':
      return 'PRICE_REQUIRED'
    case 'COORDINATES_REQUIRED':
      return 'COORDINATES_REQUIRED'
  }
}

function mapSchedulingReadinessFailure(
  error: SchedulingReadinessError,
): never {
  switch (error) {
    case 'LOCATION_NOT_FOUND':
      return buildHoldCreateFailure('LOCATION_NOT_FOUND')
    case 'TIMEZONE_REQUIRED':
      return buildHoldCreateFailure('TIMEZONE_REQUIRED')
    case 'WORKING_HOURS_REQUIRED':
      return buildHoldCreateFailure('WORKING_HOURS_REQUIRED')
    case 'WORKING_HOURS_INVALID':
      return buildHoldCreateFailure('WORKING_HOURS_INVALID')
    case 'MODE_NOT_SUPPORTED':
      return buildHoldCreateFailure('MODE_NOT_SUPPORTED')
    case 'DURATION_REQUIRED':
      return buildHoldCreateFailure('DURATION_REQUIRED')
    case 'PRICE_REQUIRED':
      return buildHoldCreateFailure('PRICE_REQUIRED')
    case 'COORDINATES_REQUIRED':
      return buildHoldCreateFailure('COORDINATES_REQUIRED')
  }
}

function makeWorkingHoursGuardMessage(code: WorkingHoursGuardCode): string {
  return `${WORKING_HOURS_ERROR_PREFIX}${code}`
}

function parseWorkingHoursGuardMessage(
  value: string,
): WorkingHoursGuardCode | null {
  if (!value.startsWith(WORKING_HOURS_ERROR_PREFIX)) return null

  const code = value.slice(WORKING_HOURS_ERROR_PREFIX.length)

  switch (code) {
    case 'WORKING_HOURS_REQUIRED':
      return 'WORKING_HOURS_REQUIRED'
    case 'WORKING_HOURS_INVALID':
      return 'WORKING_HOURS_INVALID'
    case 'OUTSIDE_WORKING_HOURS':
      return 'OUTSIDE_WORKING_HOURS'
    default:
      return null
  }
}

function getReadableWorkingHoursMessage(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return 'That time is outside working hours.'
  }

  if (value.startsWith(WORKING_HOURS_ERROR_PREFIX)) {
    return 'That time is outside working hours.'
  }

  return value
}

async function loadBookingForCancel(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<CancelBookingRecord> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: CANCEL_BOOKING_SELECT,
  })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  return booking
}

async function loadClientServiceAddress(args: {
  tx: Prisma.TransactionClient
  clientId: string
  clientAddressId: string
}): Promise<ClientServiceAddressRecord | null> {
  return args.tx.clientAddress.findFirst({
    where: {
      id: args.clientAddressId,
      clientId: args.clientId,
      kind: ClientAddressKind.SERVICE_ADDRESS,
    },
    select: CLIENT_SERVICE_ADDRESS_SELECT,
  })
}

function assertActorOwnsBooking(args: {
  booking: CancelBookingRecord
  actor: CancelActor
}): void {
  const { booking, actor } = args

  if (actor.kind === 'client' && booking.clientId !== actor.clientId) {
    throw bookingError('FORBIDDEN')
  }

  if (actor.kind === 'pro' && booking.professionalId !== actor.professionalId) {
    throw bookingError('FORBIDDEN')
  }
}

function assertAllowedCancelStatus(args: {
  booking: CancelBookingRecord
  allowedStatuses?: BookingStatus[]
}): void {
  const { booking, allowedStatuses } = args

  if (!allowedStatuses || allowedStatuses.length === 0) {
    return
  }

  if (!allowedStatuses.includes(booking.status)) {
    throw bookingError('FORBIDDEN', {
      message: `Booking status ${booking.status} cannot be cancelled in this flow.`,
      userMessage: 'Only pending or accepted bookings can be cancelled.',
    })
  }
}

async function maybeCreateBookingCancelledNotification(args: {
  tx: Prisma.TransactionClient
  booking: CancelBookingRecord
  reason?: string | null
  notifyClient?: boolean
}): Promise<void> {
  const { tx, booking, notifyClient } = args

  if (notifyClient !== true) return

  const reason = normalizeReason(args.reason)
  const body = reason
    ? `Your appointment was cancelled. Reason: ${reason}`
    : 'Your appointment was cancelled.'

  await tx.clientNotification.create({
    data: {
      clientId: booking.clientId,
      bookingId: booking.id,
      type: ClientNotificationType.BOOKING_CANCELLED,
      title: 'Appointment cancelled',
      body,
      dedupeKey: `BOOKING_CANCELLED:${booking.id}`,
    },
  })
}

function logHoldConflict(args: {
  professionalId: string
  locationId: string | null
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  conflictType: HoldConflictType
  offeringId: string
  clientId: string
  clientAddressId?: string | null
  note?: string
  meta?: Record<string, unknown>
}): void {
  logBookingConflict({
    action: 'BOOKING_CREATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: args.conflictType,
    note: args.note ?? null,
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      offeringId: args.offeringId,
      clientId: args.clientId,
      clientAddressId: args.clientAddressId ?? null,
      ...args.meta,
    },
  })
}

function logFinalizePolicyFailure(args: {
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  holdId: string
  logHint: {
    requestedStart: Date
    requestedEnd: Date
    conflictType: HoldConflictType
    meta?: Record<string, unknown>
  }
}): void {
  logBookingConflict({
    action: 'BOOKING_FINALIZE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.logHint.requestedStart,
    requestedEnd: args.logHint.requestedEnd,
    conflictType: args.logHint.conflictType,
    holdId: args.holdId,
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      ...(args.logHint.meta ?? {}),
    },
  })
}

function logAndThrowStepMismatch(args: {
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  offeringId: string
  clientId: string
  stepMinutes: number
  meta?: Record<string, unknown>
}): never {
  logBookingConflict({
    action: 'BOOKING_CREATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: addMinutes(args.requestedStart, 1),
    conflictType: 'STEP_BOUNDARY',
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      offeringId: args.offeringId,
      clientId: args.clientId,
      stepMinutes: args.stepMinutes,
      ...(args.meta ?? {}),
    },
  })

  throw bookingError('STEP_MISMATCH', {
    message: `Start time must be on a ${args.stepMinutes}-minute boundary.`,
    userMessage: `Start time must be on a ${args.stepMinutes}-minute boundary.`,
  })
}

function logAndThrowWorkingHoursFailure(args: {
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  offeringId: string
  clientId: string
  workingHoursError: string
}): never {
  logBookingConflict({
    action: 'BOOKING_CREATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: 'WORKING_HOURS',
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      offeringId: args.offeringId,
      clientId: args.clientId,
      workingHoursError: args.workingHoursError,
    },
  })

  const code = parseWorkingHoursGuardMessage(args.workingHoursError)

  if (code === 'WORKING_HOURS_REQUIRED') {
    throw bookingError('WORKING_HOURS_REQUIRED')
  }

  if (code === 'WORKING_HOURS_INVALID') {
    throw bookingError('WORKING_HOURS_INVALID')
  }

  if (code === 'OUTSIDE_WORKING_HOURS') {
    const message = getReadableWorkingHoursMessage(args.workingHoursError)
    throw bookingError('OUTSIDE_WORKING_HOURS', {
      message,
      userMessage: message,
    })
  }

  const message = getReadableWorkingHoursMessage(args.workingHoursError)
  throw bookingError('OUTSIDE_WORKING_HOURS', {
    message,
    userMessage: message,
  })
}

function logAndThrowAdvanceNoticeFailure(args: {
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  offeringId: string
  clientId: string
  advanceNoticeMinutes: number
}): never {
  logBookingConflict({
    action: 'BOOKING_CREATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: 'TIME_NOT_AVAILABLE',
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      offeringId: args.offeringId,
      clientId: args.clientId,
      rule: 'ADVANCE_NOTICE',
      advanceNoticeMinutes: args.advanceNoticeMinutes,
      allowShortNotice: false,
    },
  })

  throw bookingError('ADVANCE_NOTICE_REQUIRED', {
    userMessage:
      'That booking is too soon unless you explicitly override advance notice.',
  })
}

function logAndThrowMaxDaysAheadFailure(args: {
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  offeringId: string
  clientId: string
  maxDaysAhead: number
}): never {
  logBookingConflict({
    action: 'BOOKING_CREATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: 'TIME_NOT_AVAILABLE',
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      offeringId: args.offeringId,
      clientId: args.clientId,
      rule: 'MAX_DAYS_AHEAD',
      maxDaysAhead: args.maxDaysAhead,
      allowFarFuture: false,
    },
  })

  throw bookingError('MAX_DAYS_AHEAD_EXCEEDED', {
    userMessage:
      'That booking is too far in the future unless you explicitly override the booking window.',
  })
}

function logAndThrowTimeRangeConflict(args: {
  conflict: 'BLOCKED' | 'BOOKING' | 'HOLD'
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  offeringId: string
  clientId: string
}): never {
  logBookingConflict({
    action: 'BOOKING_CREATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: args.conflict,
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      offeringId: args.offeringId,
      clientId: args.clientId,
    },
  })

  switch (args.conflict) {
    case 'BLOCKED':
      throw bookingError('TIME_BLOCKED', {
        userMessage: 'That time is blocked on your calendar.',
      })
    case 'BOOKING':
      throw bookingError('TIME_BOOKED')
    case 'HOLD':
      throw bookingError('TIME_HELD')
  }
}

async function enforceProCreateScheduling(args: {
  tx: Prisma.TransactionClient
  now: Date
  requestedStart: Date
  durationMinutes: number
  bufferMinutes: number
  workingHours: unknown
  timeZone: string
  stepMinutes: number
  advanceNoticeMinutes: number
  maxDaysAhead: number
  allowShortNotice: boolean
  allowFarFuture: boolean
  allowOutsideWorkingHours: boolean
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  offeringId: string
  clientId: string
}): Promise<Date> {
  const decision = await evaluateProSchedulingDecision({
    tx: args.tx,
    now: args.now,
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    durationMinutes: args.durationMinutes,
    bufferMinutes: args.bufferMinutes,
    workingHours: args.workingHours,
    timeZone: args.timeZone,
    stepMinutes: args.stepMinutes,
    advanceNoticeMinutes: args.advanceNoticeMinutes,
    maxDaysAhead: args.maxDaysAhead,
    allowShortNotice: args.allowShortNotice,
    allowFarFuture: args.allowFarFuture,
    allowOutsideWorkingHours: args.allowOutsideWorkingHours,
  })

  if (decision.ok) {
    return decision.value.requestedEnd
  }

  switch (decision.code) {
    case 'STEP_MISMATCH':
      return logAndThrowStepMismatch({
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.requestedStart,
        offeringId: args.offeringId,
        clientId: args.clientId,
        stepMinutes: args.stepMinutes,
        meta: decision.logHint?.meta,
      })

    case 'WORKING_HOURS_REQUIRED':
      return logAndThrowWorkingHoursFailure({
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.requestedStart,
        requestedEnd:
          decision.logHint?.requestedEnd ??
          addMinutes(
            args.requestedStart,
            args.durationMinutes + args.bufferMinutes,
          ),
        offeringId: args.offeringId,
        clientId: args.clientId,
        workingHoursError: makeWorkingHoursGuardMessage(
          'WORKING_HOURS_REQUIRED',
        ),
      })

    case 'WORKING_HOURS_INVALID':
      return logAndThrowWorkingHoursFailure({
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.requestedStart,
        requestedEnd:
          decision.logHint?.requestedEnd ??
          addMinutes(
            args.requestedStart,
            args.durationMinutes + args.bufferMinutes,
          ),
        offeringId: args.offeringId,
        clientId: args.clientId,
        workingHoursError: makeWorkingHoursGuardMessage(
          'WORKING_HOURS_INVALID',
        ),
      })

    case 'OUTSIDE_WORKING_HOURS':
      return logAndThrowWorkingHoursFailure({
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.requestedStart,
        requestedEnd:
          decision.logHint?.requestedEnd ??
          addMinutes(
            args.requestedStart,
            args.durationMinutes + args.bufferMinutes,
          ),
        offeringId: args.offeringId,
        clientId: args.clientId,
        workingHoursError:
          typeof decision.logHint?.meta?.workingHoursError === 'string'
            ? decision.logHint.meta.workingHoursError
            : makeWorkingHoursGuardMessage('OUTSIDE_WORKING_HOURS'),
      })

    case 'ADVANCE_NOTICE_REQUIRED':
      return logAndThrowAdvanceNoticeFailure({
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.requestedStart,
        requestedEnd:
          decision.logHint?.requestedEnd ??
          addMinutes(
            args.requestedStart,
            args.durationMinutes + args.bufferMinutes,
          ),
        offeringId: args.offeringId,
        clientId: args.clientId,
        advanceNoticeMinutes: args.advanceNoticeMinutes,
      })

    case 'MAX_DAYS_AHEAD_EXCEEDED':
      return logAndThrowMaxDaysAheadFailure({
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.requestedStart,
        requestedEnd:
          decision.logHint?.requestedEnd ??
          addMinutes(
            args.requestedStart,
            args.durationMinutes + args.bufferMinutes,
          ),
        offeringId: args.offeringId,
        clientId: args.clientId,
        maxDaysAhead: args.maxDaysAhead,
      })

    case 'TIME_BLOCKED':
      return logAndThrowTimeRangeConflict({
        conflict: 'BLOCKED',
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.requestedStart,
        requestedEnd:
          decision.logHint?.requestedEnd ??
          addMinutes(
            args.requestedStart,
            args.durationMinutes + args.bufferMinutes,
          ),
        offeringId: args.offeringId,
        clientId: args.clientId,
      })

    case 'TIME_BOOKED':
      return logAndThrowTimeRangeConflict({
        conflict: 'BOOKING',
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.requestedStart,
        requestedEnd:
          decision.logHint?.requestedEnd ??
          addMinutes(
            args.requestedStart,
            args.durationMinutes + args.bufferMinutes,
          ),
        offeringId: args.offeringId,
        clientId: args.clientId,
      })

    case 'TIME_HELD':
      return logAndThrowTimeRangeConflict({
        conflict: 'HOLD',
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.requestedStart,
        requestedEnd:
          decision.logHint?.requestedEnd ??
          addMinutes(
            args.requestedStart,
            args.durationMinutes + args.bufferMinutes,
          ),
        offeringId: args.offeringId,
        clientId: args.clientId,
      })
  }

  const exhaustiveCheck: never = decision.code
  throw new Error(
    `Unhandled scheduling decision code: ${String(exhaustiveCheck)}`,
  )
}

async function performLockedCancel(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  actor: CancelActor
  notifyClient?: boolean
  reason?: string | null
  allowedStatuses?: BookingStatus[]
}): Promise<CancelBookingResult> {
  const booking = await loadBookingForCancel(args.tx, args.bookingId)

  assertActorOwnsBooking({
    booking,
    actor: args.actor,
  })

  if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
    throw bookingError('BOOKING_CANNOT_EDIT_COMPLETED')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    return {
      booking: {
        id: booking.id,
        status: booking.status,
        sessionStep: booking.sessionStep ?? SessionStep.NONE,
      },
      meta: buildMeta(false),
    }
  }

  assertAllowedCancelStatus({
    booking,
    allowedStatuses: args.allowedStatuses,
  })

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      status: BookingStatus.CANCELLED,
      sessionStep: SessionStep.NONE,
      startedAt: null,
      finishedAt: null,
    },
    select: {
      id: true,
      status: true,
      sessionStep: true,
    } satisfies Prisma.BookingSelect,
  })

  await maybeCreateBookingCancelledNotification({
    tx: args.tx,
    booking,
    notifyClient: args.notifyClient,
    reason: args.reason,
  })

  return {
    booking: {
      id: updated.id,
      status: updated.status,
      sessionStep: updated.sessionStep ?? SessionStep.NONE,
    },
    meta: buildMeta(true),
  }
}

async function performLockedCreateHold(args: {
  tx: Prisma.TransactionClient
  now: Date
  clientId: string
  offering: CreateHoldArgs['offering']
  requestedStart: Date
  requestedLocationId: string | null
  locationType: ServiceLocationType
  clientAddressId: string | null
}): Promise<CreateHoldResult> {
  const {
    tx,
    now,
    clientId,
    offering,
    requestedStart,
    requestedLocationId,
    locationType,
    clientAddressId,
  } = args

  const selectedClientAddress =
    locationType === ServiceLocationType.MOBILE && clientAddressId
      ? await loadClientServiceAddress({
          tx,
          clientId,
          clientAddressId,
        })
      : null

  const clientServiceAddress =
    locationType === ServiceLocationType.MOBILE
      ? normalizeAddress(selectedClientAddress?.formattedAddress)
      : null

  const validatedContextResult = await resolveValidatedBookingContext({
    tx,
    professionalId: offering.professionalId,
    requestedLocationId,
    locationType,
    professionalTimeZone: offering.professionalTimeZone,
    fallbackTimeZone: 'UTC',
    requireValidTimeZone: true,
    allowFallback: !requestedLocationId,
    requireCoordinates: false,
    offering: {
      offersInSalon: offering.offersInSalon,
      offersMobile: offering.offersMobile,
      salonDurationMinutes: offering.salonDurationMinutes,
      mobileDurationMinutes: offering.mobileDurationMinutes,
      salonPriceStartingAt: offering.salonPriceStartingAt,
      mobilePriceStartingAt: offering.mobilePriceStartingAt,
    },
  })

  if (!validatedContextResult.ok) {
    mapSchedulingReadinessFailure(validatedContextResult.error)
  }

  const locationContext = validatedContextResult.context
  const durationMinutes = validatedContextResult.durationMinutes

  const salonLocationAddress =
    locationType === ServiceLocationType.SALON
      ? normalizeAddress(locationContext.formattedAddress)
      : null

  const decision = await evaluateHoldCreationDecision({
    tx,
    now,
    professionalId: offering.professionalId,
    locationId: locationContext.locationId,
    locationType,
    offeringId: offering.id,
    clientId,
    clientAddressId,
    requestedStart,
    durationMinutes,
    bufferMinutes: locationContext.bufferMinutes,
    workingHours: locationContext.workingHours,
    timeZone: locationContext.timeZone,
    stepMinutes: locationContext.stepMinutes,
    advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
    maxDaysAhead: locationContext.maxDaysAhead,
    salonLocationAddress,
    clientServiceAddress,
  })

  if (!decision.ok) {
    if (decision.logHint) {
      logHoldConflict({
        professionalId: offering.professionalId,
        locationId: locationContext.locationId,
        locationType,
        requestedStart: decision.logHint.requestedStart,
        requestedEnd: decision.logHint.requestedEnd,
        conflictType: decision.logHint.conflictType,
        offeringId: offering.id,
        clientId,
        clientAddressId,
        meta: decision.logHint.meta,
      })
    }

    throw bookingError(decision.code, {
      message: decision.message,
      userMessage: decision.userMessage,
    })
  }

  const requestedEnd = decision.value.requestedEnd
  const expiresAt = addMinutes(now, HOLD_MINUTES)

  const locationAddressSnapshotInput:
    | Prisma.InputJsonValue
    | Prisma.NullableJsonNullValueInput =
    locationType === ServiceLocationType.SALON && salonLocationAddress
      ? buildAddressSnapshot(salonLocationAddress) ?? Prisma.JsonNull
      : Prisma.JsonNull

  const clientAddressSnapshotInput:
    | Prisma.InputJsonValue
    | Prisma.NullableJsonNullValueInput =
    locationType === ServiceLocationType.MOBILE && clientServiceAddress
      ? buildAddressSnapshot(clientServiceAddress) ?? Prisma.JsonNull
      : Prisma.JsonNull

  try {
    const hold: CreateHoldRecord = await tx.bookingHold.create({
      data: {
        offeringId: offering.id,
        professionalId: offering.professionalId,
        clientId,
        scheduledFor: requestedStart,
        expiresAt,
        locationType,
        locationId: locationContext.locationId,
        locationTimeZone: locationContext.timeZone,

        locationAddressSnapshot: locationAddressSnapshotInput,
        locationLatSnapshot: locationContext.lat,
        locationLngSnapshot: locationContext.lng,

        clientAddressId:
          locationType === ServiceLocationType.MOBILE && selectedClientAddress
            ? selectedClientAddress.id
            : null,
        clientAddressSnapshot: clientAddressSnapshotInput,
        clientAddressLatSnapshot:
          locationType === ServiceLocationType.MOBILE && selectedClientAddress
            ? decimalToNumber(selectedClientAddress.lat)
            : null,
        clientAddressLngSnapshot:
          locationType === ServiceLocationType.MOBILE && selectedClientAddress
            ? decimalToNumber(selectedClientAddress.lng)
            : null,
      },
      select: CREATE_HOLD_SELECT,
    })

    return {
      hold: {
        id: hold.id,
        expiresAt: hold.expiresAt,
        scheduledFor: hold.scheduledFor,
        locationType: hold.locationType,
        locationId: hold.locationId,
        locationTimeZone: hold.locationTimeZone,
        clientAddressId: hold.clientAddressId,
        clientAddressSnapshot: hold.clientAddressSnapshot,
      },
      meta: buildMeta(true),
    }
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      logHoldConflict({
        professionalId: offering.professionalId,
        locationId: locationContext.locationId,
        locationType,
        requestedStart,
        requestedEnd,
        conflictType: 'HOLD',
        offeringId: offering.id,
        clientId,
        clientAddressId,
        meta: {
          prismaCode: error.code,
        },
      })

      throw bookingError('TIME_HELD')
    }

    throw error
  }
}

async function performLockedRescheduleBookingFromHold(args: {
  tx: Prisma.TransactionClient
  now: Date
  bookingId: string
  clientId: string
  holdId: string
  requestedLocationType: ServiceLocationType | null
  fallbackTimeZone: string
}): Promise<RescheduleBookingFromHoldResult> {
  const booking = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: RESCHEDULE_BOOKING_SELECT,
  })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.clientId !== args.clientId) {
    throw bookingError('FORBIDDEN')
  }

  if (
    booking.status === BookingStatus.COMPLETED ||
    booking.status === BookingStatus.CANCELLED
  ) {
    throw bookingError('BOOKING_NOT_RESCHEDULABLE')
  }

  if (booking.startedAt || booking.finishedAt) {
    throw bookingError('BOOKING_ALREADY_STARTED')
  }

  if (!booking.offeringId) {
    throw bookingError('BOOKING_MISSING_OFFERING')
  }

  const bookingOffering = await args.tx.professionalServiceOffering.findUnique({
    where: { id: booking.offeringId },
    select: RESCHEDULE_BOOKING_OFFERING_SELECT,
  })

  if (!bookingOffering) {
    throw bookingError('OFFERING_NOT_FOUND')
  }

  const rawDuration = Number(booking.totalDurationMinutes ?? 0)
  if (
    !Number.isFinite(rawDuration) ||
    rawDuration < 15 ||
    rawDuration > MAX_SLOT_DURATION_MINUTES
  ) {
    throw bookingError('INVALID_DURATION')
  }

  const totalDurationMinutes = clampInt(
    Math.trunc(rawDuration),
    15,
    MAX_SLOT_DURATION_MINUTES,
  )

  const hold = await args.tx.bookingHold.findUnique({
    where: { id: args.holdId },
    select: RESCHEDULE_HOLD_SELECT,
  })

  const validatedHold = await validateHoldForClientMutation({
    tx: args.tx,
    hold,
    clientId: args.clientId,
    now: args.now,
    expectedProfessionalId: booking.professionalId,
    expectedOfferingId: booking.offeringId,
    expectedLocationType: args.requestedLocationType,
  })

  if (!validatedHold.ok) {
    throw bookingError(validatedHold.code, {
      message: validatedHold.message,
      userMessage: validatedHold.userMessage,
    })
  }

  if (!hold) {
    throw bookingError('HOLD_NOT_FOUND')
  }

  const validatedContextResult = await resolveValidatedBookingContext({
    tx: args.tx,
    professionalId: booking.professionalId,
    requestedLocationId: validatedHold.value.locationId,
    locationType: validatedHold.value.locationType,
    holdLocationTimeZone: validatedHold.value.locationTimeZone,
    professionalTimeZone: bookingOffering.professional?.timeZone ?? null,
    fallbackTimeZone: args.fallbackTimeZone,
    requireValidTimeZone: true,
    allowFallback: false,
    requireCoordinates: false,
    offering: {
      offersInSalon: bookingOffering.offersInSalon,
      offersMobile: bookingOffering.offersMobile,
      salonDurationMinutes: bookingOffering.salonDurationMinutes,
      mobileDurationMinutes: bookingOffering.mobileDurationMinutes,
      salonPriceStartingAt: bookingOffering.salonPriceStartingAt,
      mobilePriceStartingAt: bookingOffering.mobilePriceStartingAt,
    },
  })

  if (!validatedContextResult.ok) {
    throw bookingError(
      mapSchedulingReadinessErrorToBookingCode(validatedContextResult.error),
    )
  }

  const locationContext = validatedContextResult.context

  const salonAddressResolution = resolveHeldSalonAddressText({
    holdLocationType: validatedHold.value.locationType,
    holdLocationAddressSnapshot: hold.locationAddressSnapshot,
    fallbackFormattedAddress: locationContext.formattedAddress,
  })

  if (!salonAddressResolution.ok) {
    throw bookingError(salonAddressResolution.code, {
      message: salonAddressResolution.message,
      userMessage: salonAddressResolution.userMessage,
    })
  }

  const newStart = normalizeToMinute(new Date(hold.scheduledFor))

  const decision = await evaluateRescheduleDecision({
    tx: args.tx,
    now: args.now,
    professionalId: booking.professionalId,
    bookingId: booking.id,
    holdId: hold.id,
    requestedStart: newStart,
    durationMinutes: totalDurationMinutes,
    bufferMinutes: locationContext.bufferMinutes,
    locationId: locationContext.locationId,
    workingHours: locationContext.workingHours,
    timeZone: locationContext.timeZone,
    stepMinutes: locationContext.stepMinutes,
    advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
    maxDaysAhead: locationContext.maxDaysAhead,
    fallbackTimeZone: args.fallbackTimeZone,
  })

  if (!decision.ok) {
    throw bookingError(decision.code, {
      message: decision.message,
      userMessage: decision.userMessage,
    })
  }

  const salonLocationAddressSnapshotInput:
    | Prisma.InputJsonValue
    | Prisma.NullableJsonNullValueInput =
    validatedHold.value.locationType === ServiceLocationType.SALON &&
    salonAddressResolution.value
      ? buildAddressSnapshot(salonAddressResolution.value) ?? Prisma.JsonNull
      : Prisma.JsonNull

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      scheduledFor: newStart,
      locationType: validatedHold.value.locationType,
      bufferMinutes: locationContext.bufferMinutes,
      locationId: locationContext.locationId,
      locationTimeZone: locationContext.timeZone,

      locationAddressSnapshot: salonLocationAddressSnapshotInput,
      locationLatSnapshot:
        decimalToNumber(hold.locationLatSnapshot) ?? locationContext.lat,
      locationLngSnapshot:
        decimalToNumber(hold.locationLngSnapshot) ?? locationContext.lng,

      clientAddressId:
        validatedHold.value.locationType === ServiceLocationType.MOBILE
          ? validatedHold.value.holdClientAddressId
          : null,
      clientAddressSnapshot:
        validatedHold.value.locationType === ServiceLocationType.MOBILE
          ? toNullableJsonCreateInput(hold.clientAddressSnapshot)
          : Prisma.JsonNull,
      clientAddressLatSnapshot:
        validatedHold.value.locationType === ServiceLocationType.MOBILE
          ? decimalToNumber(hold.clientAddressLatSnapshot)
          : null,
      clientAddressLngSnapshot:
        validatedHold.value.locationType === ServiceLocationType.MOBILE
          ? decimalToNumber(hold.clientAddressLngSnapshot)
          : null,
    },
    select: {
      id: true,
      status: true,
      scheduledFor: true,
      locationType: true,
      bufferMinutes: true,
      totalDurationMinutes: true,
      locationTimeZone: true,
    } satisfies Prisma.BookingSelect,
  })

  await args.tx.bookingHold.delete({
    where: { id: hold.id },
  })

  return {
    booking: {
      id: updated.id,
      status: updated.status,
      scheduledFor: updated.scheduledFor,
      locationType: updated.locationType,
      bufferMinutes: updated.bufferMinutes ?? 0,
      totalDurationMinutes: updated.totalDurationMinutes ?? 0,
      locationTimeZone: updated.locationTimeZone ?? null,
    },
    meta: buildMeta(true),
  }
}

async function performLockedFinalizeBookingFromHold(args: {
  tx: Prisma.TransactionClient
  now: Date
  clientId: string
  holdId: string
  openingId: string | null
  addOnIds: string[]
  locationType: ServiceLocationType
  source: BookingSource
  initialStatus: BookingStatus
  rebookOfBookingId: string | null
  fallbackTimeZone: string
  offering: FinalizeBookingFromHoldArgs['offering']
}): Promise<FinalizeBookingFromHoldResult> {
  const hold = await args.tx.bookingHold.findUnique({
    where: { id: args.holdId },
    select: FINALIZE_HOLD_SELECT,
  })

  const validatedHold = await validateHoldForClientMutation({
    tx: args.tx,
    hold,
    clientId: args.clientId,
    now: args.now,
    expectedProfessionalId: args.offering.professionalId,
    expectedOfferingId: args.offering.id,
    expectedLocationType: args.locationType,
  })

  if (!validatedHold.ok) {
    throw bookingError(validatedHold.code, {
      message: validatedHold.message,
      userMessage: validatedHold.userMessage,
    })
  }

  if (!hold) {
    throw bookingError('HOLD_NOT_FOUND')
  }

  const validatedContextResult = await resolveValidatedBookingContext({
    tx: args.tx,
    professionalId: args.offering.professionalId,
    requestedLocationId: validatedHold.value.locationId,
    locationType: validatedHold.value.locationType,
    holdLocationTimeZone: validatedHold.value.locationTimeZone,
    professionalTimeZone: args.offering.professionalTimeZone,
    fallbackTimeZone: args.fallbackTimeZone,
    requireValidTimeZone: true,
    allowFallback: false,
    requireCoordinates: false,
    offering: {
      offersInSalon: args.offering.offersInSalon,
      offersMobile: args.offering.offersMobile,
      salonDurationMinutes: args.offering.salonDurationMinutes,
      mobileDurationMinutes: args.offering.mobileDurationMinutes,
      salonPriceStartingAt: args.offering.salonPriceStartingAt,
      mobilePriceStartingAt: args.offering.mobilePriceStartingAt,
    },
  })

  if (!validatedContextResult.ok) {
    throw bookingError(
      mapSchedulingReadinessErrorToBookingCode(validatedContextResult.error),
    )
  }

  const locationContext = validatedContextResult.context
  const baseDurationMinutes = validatedContextResult.durationMinutes
  const priceStartingAt = validatedContextResult.priceStartingAt

  const salonAddressResolution = resolveHeldSalonAddressText({
    holdLocationType: validatedHold.value.locationType,
    holdLocationAddressSnapshot: hold.locationAddressSnapshot,
    fallbackFormattedAddress: locationContext.formattedAddress,
  })

  if (!salonAddressResolution.ok) {
    throw bookingError(salonAddressResolution.code, {
      message: salonAddressResolution.message,
      userMessage: salonAddressResolution.userMessage,
    })
  }

  const requestedStart = normalizeToMinute(new Date(hold.scheduledFor))

  if (args.openingId) {
    const activeOpening = await args.tx.lastMinuteOpening.findFirst({
      where: {
        id: args.openingId,
        status: OpeningStatus.ACTIVE,
      },
      select: {
        id: true,
        startAt: true,
        professionalId: true,
        offeringId: true,
        serviceId: true,
      },
    })

    if (!activeOpening) {
      throw bookingError('OPENING_NOT_AVAILABLE')
    }

    if (activeOpening.professionalId !== args.offering.professionalId) {
      throw bookingError('OPENING_NOT_AVAILABLE')
    }

    if (
      activeOpening.offeringId &&
      activeOpening.offeringId !== args.offering.id
    ) {
      throw bookingError('OPENING_NOT_AVAILABLE')
    }

    if (
      activeOpening.serviceId &&
      activeOpening.serviceId !== args.offering.serviceId
    ) {
      throw bookingError('OPENING_NOT_AVAILABLE')
    }

    if (
      normalizeToMinute(new Date(activeOpening.startAt)).getTime() !==
      requestedStart.getTime()
    ) {
      throw bookingError('OPENING_NOT_AVAILABLE')
    }

    const updatedOpening = await args.tx.lastMinuteOpening.updateMany({
      where: {
        id: args.openingId,
        status: OpeningStatus.ACTIVE,
      },
      data: {
        status: OpeningStatus.BOOKED,
      },
    })

    if (updatedOpening.count !== 1) {
      throw bookingError('OPENING_NOT_AVAILABLE')
    }
  }

  const addOnLinks = args.addOnIds.length
    ? await args.tx.offeringAddOn.findMany({
        where: {
          id: { in: args.addOnIds },
          offeringId: args.offering.id,
          isActive: true,
          OR: [{ locationType: null }, { locationType: args.locationType }],
          addOnService: {
            isActive: true,
            isAddOnEligible: true,
          },
        },
        select: {
          id: true,
          addOnServiceId: true,
          sortOrder: true,
          priceOverride: true,
          durationOverrideMinutes: true,
          addOnService: {
            select: {
              id: true,
              defaultDurationMinutes: true,
              minPrice: true,
            },
          },
        },
        take: 50,
      })
    : []

  if (args.addOnIds.length && addOnLinks.length !== args.addOnIds.length) {
    throw bookingError('ADDONS_INVALID')
  }

  const addOnServiceIds = addOnLinks.map((row) => row.addOnServiceId)

  const proAddOnOfferings = addOnServiceIds.length
    ? await args.tx.professionalServiceOffering.findMany({
        where: {
          professionalId: args.offering.professionalId,
          isActive: true,
          serviceId: { in: addOnServiceIds },
        },
        select: {
          serviceId: true,
          salonPriceStartingAt: true,
          salonDurationMinutes: true,
          mobilePriceStartingAt: true,
          mobileDurationMinutes: true,
        },
        take: 200,
      })
    : []

  const addOnOfferingByServiceId = new Map(
    proAddOnOfferings.map((row) => [row.serviceId, row]),
  )

  const resolvedAddOns = addOnLinks.map((row) => {
    const service = row.addOnService
    const proOffering = addOnOfferingByServiceId.get(service.id) ?? null

    const durationRaw =
      row.durationOverrideMinutes ??
      (args.locationType === ServiceLocationType.MOBILE
        ? proOffering?.mobileDurationMinutes
        : proOffering?.salonDurationMinutes) ??
      service.defaultDurationMinutes

    const durationMinutesSnapshot = normalizePositiveDurationMinutes(durationRaw)

    const priceRaw =
      row.priceOverride ??
      (args.locationType === ServiceLocationType.MOBILE
        ? proOffering?.mobilePriceStartingAt
        : proOffering?.salonPriceStartingAt) ??
      service.minPrice

    return {
      offeringAddOnId: row.id,
      serviceId: service.id,
      durationMinutesSnapshot,
      priceSnapshot: decimalFromUnknown(priceRaw),
      sortOrder: row.sortOrder ?? 0,
    }
  })

  for (const addOn of resolvedAddOns) {
    if (addOn.durationMinutesSnapshot == null) {
      throw bookingError('ADDONS_INVALID')
    }
  }

  const basePrice = decimalFromUnknown(priceStartingAt)

  const addOnsPriceTotal = resolvedAddOns.reduce(
    (acc, row) => acc.add(row.priceSnapshot),
    new Prisma.Decimal(0),
  )

  const subtotal = basePrice.add(addOnsPriceTotal)

  const addOnsDurationTotal = resolvedAddOns.reduce(
    (sum, row) => sum + (row.durationMinutesSnapshot ?? 0),
    0,
  )

  const totalDurationMinutes = clampInt(
    baseDurationMinutes + addOnsDurationTotal,
    15,
    MAX_SLOT_DURATION_MINUTES,
  )

  const decision = await evaluateFinalizeDecision({
    tx: args.tx,
    now: args.now,
    professionalId: args.offering.professionalId,
    holdId: hold.id,
    requestedStart,
    durationMinutes: totalDurationMinutes,
    bufferMinutes: locationContext.bufferMinutes,
    locationId: locationContext.locationId,
    locationType: validatedHold.value.locationType,
    workingHours: locationContext.workingHours,
    timeZone: locationContext.timeZone,
    stepMinutes: locationContext.stepMinutes,
    advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
    maxDaysAhead: locationContext.maxDaysAhead,
    fallbackTimeZone: args.fallbackTimeZone,
  })

  if (!decision.ok) {
    if (decision.logHint) {
      logFinalizePolicyFailure({
        professionalId: args.offering.professionalId,
        locationId: locationContext.locationId,
        locationType: validatedHold.value.locationType,
        holdId: hold.id,
        logHint: decision.logHint,
      })
    }

    throw bookingError(decision.code, {
      message: decision.message,
      userMessage: decision.userMessage,
    })
  }

  const salonLocationAddressSnapshotInput:
    | Prisma.InputJsonValue
    | Prisma.NullableJsonNullValueInput =
    validatedHold.value.locationType === ServiceLocationType.SALON &&
    salonAddressResolution.value
      ? buildAddressSnapshot(salonAddressResolution.value) ?? Prisma.JsonNull
      : Prisma.JsonNull

  let created: {
    id: string
    status: BookingStatus
    scheduledFor: Date
    professionalId: string
  }

  try {
    created = await args.tx.booking.create({
      data: {
        clientId: args.clientId,
        professionalId: args.offering.professionalId,
        serviceId: args.offering.serviceId,
        offeringId: args.offering.id,
        scheduledFor: requestedStart,
        status: args.initialStatus,
        source: args.source,
        locationType: args.locationType,
        rebookOfBookingId: args.rebookOfBookingId,
        subtotalSnapshot: subtotal,
        totalDurationMinutes,
        bufferMinutes: locationContext.bufferMinutes,
        locationId: locationContext.locationId,
        locationTimeZone: locationContext.timeZone,

        locationAddressSnapshot: salonLocationAddressSnapshotInput,
        locationLatSnapshot:
          decimalToNumber(hold.locationLatSnapshot) ?? locationContext.lat,
        locationLngSnapshot:
          decimalToNumber(hold.locationLngSnapshot) ?? locationContext.lng,

        clientAddressId:
          validatedHold.value.locationType === ServiceLocationType.MOBILE
            ? validatedHold.value.holdClientAddressId
            : null,
        clientAddressSnapshot:
          validatedHold.value.locationType === ServiceLocationType.MOBILE
            ? toNullableJsonCreateInput(hold.clientAddressSnapshot)
            : Prisma.JsonNull,
        clientAddressLatSnapshot:
          validatedHold.value.locationType === ServiceLocationType.MOBILE
            ? decimalToNumber(hold.clientAddressLatSnapshot)
            : null,
        clientAddressLngSnapshot:
          validatedHold.value.locationType === ServiceLocationType.MOBILE
            ? decimalToNumber(hold.clientAddressLngSnapshot)
            : null,
      },
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        professionalId: true,
      } satisfies Prisma.BookingSelect,
    })
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw bookingError('TIME_NOT_AVAILABLE')
    }

    throw error
  }

  const baseItem = await args.tx.bookingServiceItem.create({
    data: {
      bookingId: created.id,
      serviceId: args.offering.serviceId,
      offeringId: args.offering.id,
      itemType: BookingServiceItemType.BASE,
      priceSnapshot: basePrice,
      durationMinutesSnapshot: baseDurationMinutes,
      sortOrder: 0,
    },
    select: { id: true },
  })

  if (resolvedAddOns.length) {
    await args.tx.bookingServiceItem.createMany({
      data: resolvedAddOns.map((row, index) => ({
        bookingId: created.id,
        serviceId: row.serviceId,
        offeringId: null,
        itemType: BookingServiceItemType.ADD_ON,
        parentItemId: baseItem.id,
        priceSnapshot: row.priceSnapshot,
        durationMinutesSnapshot: row.durationMinutesSnapshot ?? 0,
        sortOrder: index + 1,
        notes: `ADDON:${row.offeringAddOnId}`,
      })),
    })
  }

  if (args.openingId) {
    await args.tx.openingNotification.updateMany({
      where: {
        clientId: args.clientId,
        openingId: args.openingId,
        bookedAt: null,
      },
      data: {
        bookedAt: new Date(),
      },
    })
  }

  await args.tx.bookingHold.delete({
    where: { id: hold.id },
  })

  return {
    booking: {
      id: created.id,
      status: created.status,
      scheduledFor: created.scheduledFor,
      professionalId: created.professionalId,
    },
    meta: buildMeta(true),
  }
}

async function performLockedCreateProBooking(args: {
  tx: Prisma.TransactionClient
  now: Date
  professionalId: string
  clientId: string
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
}): Promise<CreateProBookingResult> {
  const requestedStart = normalizeToMinute(args.scheduledFor)

  const [client, clientAddress, offering] = await Promise.all([
    args.tx.clientProfile.findUnique({
      where: { id: args.clientId },
      select: PRO_CREATE_CLIENT_SELECT,
    }),
    args.locationType === ServiceLocationType.MOBILE && args.clientAddressId
      ? args.tx.clientAddress.findFirst({
          where: {
            id: args.clientAddressId,
            clientId: args.clientId,
            kind: ClientAddressKind.SERVICE_ADDRESS,
          },
          select: PRO_CREATE_CLIENT_ADDRESS_SELECT,
        })
      : Promise.resolve(null),
    args.tx.professionalServiceOffering.findFirst({
      where: {
        id: args.offeringId,
        professionalId: args.professionalId,
        isActive: true,
      },
      select: PRO_CREATE_OFFERING_SELECT,
    }),
  ])

  if (!client) {
    throw bookingError('CLIENT_NOT_FOUND')
  }

  if (!offering) {
    throw bookingError('OFFERING_NOT_FOUND')
  }

  if (!offering.service) {
    throw bookingError('BOOKING_MISSING_OFFERING', {
      message: 'Offering is missing its service relation.',
      userMessage:
        'This booking is missing service information and cannot be processed.',
    })
  }

  const clientServiceAddress =
    args.locationType === ServiceLocationType.MOBILE
      ? normalizeAddress(clientAddress?.formattedAddress)
      : null

  if (args.locationType === ServiceLocationType.MOBILE) {
    if (!clientAddress) {
      throw bookingError('CLIENT_SERVICE_ADDRESS_REQUIRED', {
        userMessage: 'Mobile bookings require a saved client service address.',
      })
    }

    if (!clientServiceAddress) {
      throw bookingError('CLIENT_SERVICE_ADDRESS_INVALID', {
        userMessage:
          'The selected client service address is incomplete. Please update it before booking mobile.',
      })
    }
  }

  const validatedContextResult = await resolveValidatedBookingContext({
    tx: args.tx,
    professionalId: args.professionalId,
    requestedLocationId: args.locationId,
    locationType: args.locationType,
    professionalTimeZone: offering.professional?.timeZone ?? null,
    fallbackTimeZone: 'UTC',
    requireValidTimeZone: true,
    allowFallback: false,
    requireCoordinates: false,
    offering: {
      offersInSalon: offering.offersInSalon,
      offersMobile: offering.offersMobile,
      salonDurationMinutes: offering.salonDurationMinutes,
      mobileDurationMinutes: offering.mobileDurationMinutes,
      salonPriceStartingAt: offering.salonPriceStartingAt,
      mobilePriceStartingAt: offering.mobilePriceStartingAt,
    },
  })

  if (!validatedContextResult.ok) {
    throw bookingError(
      mapSchedulingReadinessErrorToBookingCode(validatedContextResult.error),
    )
  }

  const locationContext = validatedContextResult.context
  const baseDurationMinutes = validatedContextResult.durationMinutes
  const basePrice = decimalFromUnknown(validatedContextResult.priceStartingAt)

  const salonLocationAddress =
    args.locationType === ServiceLocationType.SALON
      ? normalizeAddress(locationContext.formattedAddress)
      : null

  if (
    args.locationType === ServiceLocationType.SALON &&
    !salonLocationAddress
  ) {
    throw bookingError('SALON_LOCATION_ADDRESS_REQUIRED')
  }

  if (requestedStart.getTime() < args.now.getTime()) {
    throw bookingError('TIME_IN_PAST')
  }

  const stepMinutes = locationContext.stepMinutes

  const locationBufferMinutes = clampInt(
    Number(locationContext.bufferMinutes ?? 0),
    0,
    MAX_BUFFER_MINUTES,
  )

  const bufferMinutes =
    args.requestedBufferMinutes == null
      ? locationBufferMinutes
      : clampInt(
          snapToStepMinutes(
            clampInt(args.requestedBufferMinutes, 0, MAX_BUFFER_MINUTES),
            stepMinutes,
          ),
          0,
          MAX_BUFFER_MINUTES,
        )

  const computedDurationMinutes = clampInt(
    snapToStepMinutes(baseDurationMinutes, stepMinutes),
    stepMinutes,
    MAX_SLOT_DURATION_MINUTES,
  )

  const totalDurationMinutes =
    args.requestedTotalDurationMinutes != null &&
    args.requestedTotalDurationMinutes >= computedDurationMinutes &&
    args.requestedTotalDurationMinutes <= MAX_SLOT_DURATION_MINUTES
      ? clampInt(
          snapToStepMinutes(args.requestedTotalDurationMinutes, stepMinutes),
          computedDurationMinutes,
          MAX_SLOT_DURATION_MINUTES,
        )
      : computedDurationMinutes

  await enforceProCreateScheduling({
    tx: args.tx,
    now: args.now,
    requestedStart,
    durationMinutes: totalDurationMinutes,
    bufferMinutes,
    workingHours: locationContext.workingHours,
    timeZone: locationContext.timeZone,
    stepMinutes,
    advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
    maxDaysAhead: locationContext.maxDaysAhead,
    allowShortNotice: args.allowShortNotice,
    allowFarFuture: args.allowFarFuture,
    allowOutsideWorkingHours: args.allowOutsideWorkingHours,
    professionalId: args.professionalId,
    locationId: locationContext.locationId,
    locationType: args.locationType,
    offeringId: args.offeringId,
    clientId: args.clientId,
  })

  const salonLocationAddressSnapshot:
    | Prisma.InputJsonValue
    | Prisma.NullableJsonNullValueInput =
    args.locationType === ServiceLocationType.SALON && salonLocationAddress
      ? buildAddressSnapshot(salonLocationAddress) ?? Prisma.JsonNull
      : Prisma.JsonNull

  const clientAddressSnapshot:
    | Prisma.InputJsonValue
    | Prisma.NullableJsonNullValueInput =
    args.locationType === ServiceLocationType.MOBILE && clientServiceAddress
      ? buildAddressSnapshot(clientServiceAddress) ?? Prisma.JsonNull
      : Prisma.JsonNull

  const locationLatSnapshot = locationContext.lat ?? null
  const locationLngSnapshot = locationContext.lng ?? null

  const clientAddressLatSnapshot =
    args.locationType === ServiceLocationType.MOBILE && clientAddress
      ? decimalToNumber(clientAddress.lat)
      : null

  const clientAddressLngSnapshot =
    args.locationType === ServiceLocationType.MOBILE && clientAddress
      ? decimalToNumber(clientAddress.lng)
      : null

  let booking: {
    id: string
    scheduledFor: Date
    totalDurationMinutes: number
    bufferMinutes: number
    status: BookingStatus
  }

  try {
    booking = await args.tx.booking.create({
      data: {
        professionalId: args.professionalId,
        clientId: args.clientId,
        serviceId: offering.serviceId,
        offeringId: offering.id,
        scheduledFor: requestedStart,
        status: getProCreatedBookingStatus(),

        locationType: args.locationType,
        locationId: locationContext.locationId,
        locationTimeZone: locationContext.timeZone,

        locationAddressSnapshot: salonLocationAddressSnapshot,
        locationLatSnapshot,
        locationLngSnapshot,

        clientAddressId:
          args.locationType === ServiceLocationType.MOBILE && clientAddress
            ? clientAddress.id
            : null,
        clientAddressSnapshot,
        clientAddressLatSnapshot,
        clientAddressLngSnapshot,

        internalNotes: args.internalNotes ?? null,
        bufferMinutes,
        totalDurationMinutes,
        subtotalSnapshot: basePrice,
      },
      select: {
        id: true,
        scheduledFor: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
        status: true,
      } satisfies Prisma.BookingSelect,
    })
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw bookingError('TIME_BOOKED')
    }

    throw error
  }

  await args.tx.bookingServiceItem.create({
    data: {
      bookingId: booking.id,
      serviceId: offering.serviceId,
      offeringId: offering.id,
      itemType: BookingServiceItemType.BASE,
      priceSnapshot: basePrice,
      durationMinutesSnapshot: computedDurationMinutes,
      sortOrder: 0,
    },
  })

  return {
    booking: {
      id: booking.id,
      scheduledFor: booking.scheduledFor,
      totalDurationMinutes: booking.totalDurationMinutes,
      bufferMinutes: booking.bufferMinutes,
      status: booking.status,
    },
    subtotalSnapshot: basePrice,
    stepMinutes,
    appointmentTimeZone: locationContext.timeZone,
    locationId: locationContext.locationId,
    locationType: args.locationType,
    clientAddressId:
      args.locationType === ServiceLocationType.MOBILE && clientAddress
        ? clientAddress.id
        : null,
    serviceName: offering.service.name || 'Appointment',
    meta: buildMeta(true),
  }
}

async function resolveAdminProfessionalId(bookingId: string): Promise<string> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      professionalId: true,
    } satisfies Prisma.BookingSelect,
  })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  return booking.professionalId
}

async function withLockedClientOwnedHoldTransaction<T>(args: {
  holdId: string
  clientId: string
  run: (ctx: {
    tx: Prisma.TransactionClient
    now: Date
    hold: HoldOwnershipRecord
  }) => Promise<T>
}): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const holdRef = await tx.bookingHold.findUnique({
      where: { id: args.holdId },
      select: HOLD_OWNERSHIP_SELECT,
    })

    if (!holdRef) {
      throw bookingError('HOLD_NOT_FOUND')
    }

    if (holdRef.clientId !== args.clientId) {
      throw bookingError('HOLD_FORBIDDEN')
    }

    await lockProfessionalSchedule(tx, holdRef.professionalId)

    const lockedHold = await tx.bookingHold.findUnique({
      where: { id: args.holdId },
      select: HOLD_OWNERSHIP_SELECT,
    })

    if (!lockedHold) {
      throw bookingError('HOLD_NOT_FOUND')
    }

    if (lockedHold.clientId !== args.clientId) {
      throw bookingError('HOLD_FORBIDDEN')
    }

    return args.run({
      tx,
      now: new Date(),
      hold: lockedHold,
    })
  })
}

/**
 * Single internal boundary for booking cancellation.
 *
 * Every caller lands inside the professional schedule lock before mutating
 * booking occupancy state, even though cancel does not require overlap checks.
 */
export async function cancelBooking(
  args: CancelBookingArgs,
): Promise<CancelBookingResult> {
  assertNonEmptyBookingId(args.bookingId)

  if (args.actor.kind === 'client') {
    assertNonEmptyClientId(args.actor.clientId)

    return withLockedClientOwnedBookingTransaction({
      bookingId: args.bookingId,
      clientId: args.actor.clientId,
      run: async ({ tx }) =>
        performLockedCancel({
          tx,
          bookingId: args.bookingId,
          actor: args.actor,
          notifyClient: args.notifyClient,
          reason: args.reason,
          allowedStatuses: args.allowedStatuses,
        }),
    })
  }

  if (args.actor.kind === 'pro') {
    assertNonEmptyProfessionalId(args.actor.professionalId)

    return withLockedProfessionalTransaction(
      args.actor.professionalId,
      async ({ tx }) =>
        performLockedCancel({
          tx,
          bookingId: args.bookingId,
          actor: args.actor,
          notifyClient: args.notifyClient,
          reason: args.reason,
          allowedStatuses: args.allowedStatuses,
        }),
    )
  }

  const professionalId =
    args.actor.professionalId?.trim() ||
    (await resolveAdminProfessionalId(args.bookingId))

  return withLockedProfessionalTransaction(professionalId, async ({ tx }) =>
    performLockedCancel({
      tx,
      bookingId: args.bookingId,
      actor: args.actor,
      notifyClient: args.notifyClient,
      reason: args.reason,
      allowedStatuses: args.allowedStatuses,
    }),
  )
}

/**
 * Single internal boundary for hold creation.
 *
 * All hold writes must happen inside the professional scheduling lock and use
 * the shared validated location / hold policy flow before creating BookingHold.
 */
export async function createHold(
  args: CreateHoldArgs,
): Promise<CreateHoldResult> {
  assertNonEmptyClientId(args.clientId)
  assertValidRequestedStart(args.requestedStart)

  return withLockedProfessionalTransaction(
    args.offering.professionalId,
    async ({ tx, now }) =>
      performLockedCreateHold({
        tx,
        now,
        clientId: args.clientId,
        offering: args.offering,
        requestedStart: args.requestedStart,
        requestedLocationId: args.requestedLocationId,
        locationType: args.locationType,
        clientAddressId: args.clientAddressId,
      }),
  )
}

/**
 * Single internal boundary for hold release.
 *
 * Even though delete is occupancy-removal only, it still acquires the
 * professional schedule lock so all booking/hold state transitions serialize
 * the same way.
 */
export async function releaseHold(
  args: ReleaseHoldArgs,
): Promise<ReleaseHoldResult> {
  assertNonEmptyHoldId(args.holdId)
  assertNonEmptyClientId(args.clientId)

  return withLockedClientOwnedHoldTransaction({
    holdId: args.holdId,
    clientId: args.clientId,
    run: async ({ tx, hold }) => {
      await tx.bookingHold.delete({
        where: { id: hold.id },
      })

      return {
        holdId: hold.id,
        meta: buildMeta(true),
      }
    },
  })
}

export async function rescheduleBookingFromHold(
  args: RescheduleBookingFromHoldArgs,
): Promise<RescheduleBookingFromHoldResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyClientId(args.clientId)
  assertNonEmptyHoldId(args.holdId)

  return withLockedClientOwnedBookingTransaction({
    bookingId: args.bookingId,
    clientId: args.clientId,
    run: async ({ tx, now }) =>
      performLockedRescheduleBookingFromHold({
        tx,
        now,
        bookingId: args.bookingId,
        clientId: args.clientId,
        holdId: args.holdId,
        requestedLocationType: args.requestedLocationType,
        fallbackTimeZone: args.fallbackTimeZone ?? DEFAULT_TIME_ZONE,
      }),
  })
}

export async function finalizeBookingFromHold(
  args: FinalizeBookingFromHoldArgs,
): Promise<FinalizeBookingFromHoldResult> {
  assertNonEmptyClientId(args.clientId)
  assertNonEmptyHoldId(args.holdId)

  return withLockedProfessionalTransaction(
    args.offering.professionalId,
    async ({ tx, now }) =>
      performLockedFinalizeBookingFromHold({
        tx,
        now,
        clientId: args.clientId,
        holdId: args.holdId,
        openingId: args.openingId,
        addOnIds: args.addOnIds,
        locationType: args.locationType,
        source: args.source,
        initialStatus: args.initialStatus,
        rebookOfBookingId: args.rebookOfBookingId,
        fallbackTimeZone: args.fallbackTimeZone ?? 'UTC',
        offering: args.offering,
      }),
  )
}

/**
 * Single internal boundary for pro-created bookings.
 *
 * All professional-side booking creation must happen inside the professional
 * schedule lock and use the shared scheduling/conflict checks before creating
 * Booking and BookingServiceItem rows.
 */
export async function createProBooking(
  args: CreateProBookingArgs,
): Promise<CreateProBookingResult> {
  assertNonEmptyProfessionalId(args.professionalId)
  assertNonEmptyClientId(args.clientId)
  assertNonEmptyOfferingId(args.offeringId)
  assertNonEmptyLocationId(args.locationId)
  assertValidRequestedStart(args.scheduledFor)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) =>
      performLockedCreateProBooking({
        tx,
        now,
        professionalId: args.professionalId,
        clientId: args.clientId,
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
      }),
  )
}