// lib/booking/writeBoundary.ts
import {
  AftercareRebookMode,
  BookingServiceItemType,
  BookingSource,
  BookingStatus,
  ClientAddressKind,
  ClientNotificationType,
  ConsultationApprovalStatus,
  MediaPhase,
  MediaType,
  MediaVisibility,
  OpeningStatus,
  Prisma,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  SessionStep,
  ReminderType,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { upper } from '@/lib/booking/guards'
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
import {
  addMinutes,
  durationOrFallback,
  normalizeToMinute,
} from '@/lib/booking/conflicts'
import { logBookingConflict } from '@/lib/booking/conflictLogging'
import {
  normalizeStepMinutes,
  resolveValidatedBookingContext,
  type SchedulingReadinessError,
} from '@/lib/booking/locationContext'
import {
  buildAddressSnapshot,
  decimalFromUnknown,
  decimalToNullableNumber,
  decimalToNumber,
  pickFormattedAddressFromSnapshot,
} from '@/lib/booking/snapshots'
import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  sanitizeTimeZone,
} from '@/lib/timeZone'
import { clampInt } from '@/lib/pick'
import {
  normalizeAddress,
  resolveHeldSalonAddressText,
  validateHoldForClientMutation,
} from '@/lib/booking/policies/holdRules'
import { evaluateHoldCreationDecision } from '@/lib/booking/policies/holdPolicy'
import { evaluateRescheduleDecision } from '@/lib/booking/policies/reschedulePolicy'
import { evaluateFinalizeDecision } from '@/lib/booking/policies/finalizePolicy'
import {
  evaluateProSchedulingDecision,
  type ProSchedulingAppliedOverride,
} from '@/lib/booking/policies/proSchedulingPolicy'
import { bumpScheduleVersion } from '@/lib/booking/cacheVersion'
import {
  type RequestedServiceItemInput,
  buildNormalizedBookingItemsFromRequestedOfferings,
  computeBookingItemLikeTotals,
  snapToStepMinutes,
  sumDecimal,
} from '@/lib/booking/serviceItems'
import { getProCreatedBookingStatus } from '@/lib/booking/statusRules'
import { moneyToFixed2String } from '@/lib/money'
import {
  resolveAppointmentSchedulingContext,
  type AppointmentSchedulingContext,
  type TimeZoneTruthSource,
} from '@/lib/booking/timeZoneTruth'
import crypto from 'node:crypto'
import { buildBookingOverrideAuditRows } from '@/lib/booking/overrideAudit'
import { assertCanUseBookingOverride } from '@/lib/booking/overrideAuthorization'

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

type ApproveConsultationMaterializationArgs = {
  tx: Prisma.TransactionClient
  bookingId: string
  clientId: string
  professionalId: string
  now: Date
}

type ApproveConsultationMaterializationResult = {
  booking: {
    id: string
    serviceId: string | null
    offeringId: string | null
    subtotalSnapshot: Prisma.Decimal | null
    totalDurationMinutes: number
    consultationConfirmedAt: Date | null
  }
  approval: {
    id: string
    status: ConsultationApprovalStatus
    approvedAt: Date | null
    rejectedAt: Date | null
  }
  meta: MutationMeta
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
  actorUserId: string
  overrideReason: string | null
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

type StartBookingSessionArgs = {
  bookingId: string
  professionalId: string
}


type StartBookingSessionResult = {
  booking: {
    id: string
    status: BookingStatus
    startedAt: Date | null
    finishedAt: Date | null
    sessionStep: SessionStep
  }
  meta: MutationMeta
}

type FinishBookingSessionArgs = {
  bookingId: string
  professionalId: string
}

type FinishBookingSessionResult = {
  booking: {
    id: string
    status: BookingStatus
    startedAt: Date | null
    finishedAt: Date | null
    sessionStep: SessionStep
  }
  afterCount: number
  meta: MutationMeta
}

type TransitionSessionStepArgs = {
  bookingId: string
  professionalId: string
  nextStep: SessionStep
}

type TransitionSessionStepResult =
  | {
      ok: true
      booking: {
        id: string
        sessionStep: SessionStep
        startedAt: Date | null
      }
      meta: MutationMeta
    }
  | {
      ok: false
      status: number
      error: string
      forcedStep?: SessionStep
      meta: MutationMeta
    }

type UploadProBookingMediaArgs = {
  bookingId: string
  professionalId: string
  uploadedByUserId: string
  storageBucket: string
  storagePath: string
  thumbBucket: string | null
  thumbPath: string | null
  caption: string | null
  phase: MediaPhase
  mediaType: MediaType
}

type UploadProBookingMediaResult = {
  created: {
    id: string
    mediaType: MediaType
    visibility: MediaVisibility
    phase: MediaPhase
    caption: string | null
    createdAt: Date
    reviewId: string | null
    isEligibleForLooks: boolean
    isFeaturedInPortfolio: boolean
    storageBucket: string | null
    storagePath: string | null
    thumbBucket: string | null
    thumbPath: string | null
    url: string | null
    thumbUrl: string | null
  }
  advancedTo: SessionStep | null
  meta: MutationMeta
}

type MarkBookingRemindersSentArgs = {
  bookingIds: string[]
  sentAt?: Date
}

type MarkBookingRemindersSentResult = {
  count: number
  meta: MutationMeta
}
type UpdateBookingLastMinuteDiscountArgs = {
  bookingId: string
  professionalId: string
  discountAmount: Prisma.Decimal
}

type UpdateBookingLastMinuteDiscountResult = {
  bookingId: string
  meta: MutationMeta
}

type CreateRebookedBookingFromCompletedBookingArgs = {
  bookingId: string
  professionalId: string
  scheduledFor: Date
}

type CreateRebookedBookingFromCompletedBookingResult = {
  booking: {
    id: string
    status: BookingStatus
    scheduledFor: Date
  }
  aftercare: {
    id: string
    rebookMode: AftercareRebookMode
    rebookedFor: Date | null
  }
  meta: MutationMeta
}

type CreateClientRebookedBookingFromAftercareArgs = {
  aftercareId: string
  bookingId: string
  clientId: string
  scheduledFor: Date
}

type CreateClientRebookedBookingFromAftercareResult =
  CreateRebookedBookingFromCompletedBookingResult

type PerformLockedCreateRebookedBookingArgs = {
  tx: Prisma.TransactionClient
  now: Date
  bookingId: string
  professionalId: string
  scheduledFor: Date
  initialStatus: BookingStatus
}
type UpsertBookingAftercareArgs = {
  bookingId: string
  professionalId: string
  notes: string | null
  rebookMode: AftercareRebookMode
  rebookedFor: Date | null
  rebookWindowStart: Date | null
  rebookWindowEnd: Date | null
  createRebookReminder: boolean
  rebookReminderDaysBefore: number
  createProductReminder: boolean
  productReminderDaysAfter: number
  recommendedProducts: {
    name: string
    url: string
    note: string | null
  }[]
  sendToClient: boolean
}

type UpsertBookingAftercareResult = {
  aftercare: {
    id: string
    publicToken: string
    rebookMode: AftercareRebookMode
    rebookedFor: Date | null
    rebookWindowStart: Date | null
    rebookWindowEnd: Date | null
  }
  remindersTouched: number
  clientNotified: boolean
  bookingFinished: boolean
  booking: {
    status: BookingStatus
    sessionStep: SessionStep
    finishedAt: Date | null
  } | null
  timeZoneUsed: string
  meta: MutationMeta
}

type UpdateRequestedStatus =
  | typeof BookingStatus.ACCEPTED
  | typeof BookingStatus.CANCELLED

type UpdateProBookingArgs = {
  professionalId: string
  actorUserId: string
  overrideReason: string | null
  bookingId: string
  nextStatus: UpdateRequestedStatus | null
  notifyClient: boolean
  allowOutsideWorkingHours: boolean
  allowShortNotice: boolean
  allowFarFuture: boolean
  nextStart: Date | null
  nextBuffer: number | null
  nextDuration: number | null
  parsedRequestedItems: RequestedServiceItemInput[] | null
  hasBuffer: boolean
  hasDuration: boolean
  hasServiceItems: boolean
}

type UpdateProBookingResult = {
  booking: {
    id: string
    scheduledFor: string
    endsAt: string
    bufferMinutes: number
    durationMinutes: number
    totalDurationMinutes: number
    status: BookingStatus
    subtotalSnapshot: string
    timeZone: string
    timeZoneSource: TimeZoneTruthSource
    locationId: string | null
    locationType: ServiceLocationType | null
    locationAddressSnapshot: string | null
    locationLatSnapshot: number | null
    locationLngSnapshot: number | null
  }
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

const START_BOOKING_SELECT = {
  id: true,
  professionalId: true,
  status: true,
  scheduledFor: true,
  startedAt: true,
  finishedAt: true,
  sessionStep: true,
} satisfies Prisma.BookingSelect

type StartBookingRecord = Prisma.BookingGetPayload<{
  select: typeof START_BOOKING_SELECT
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

const APPROVE_CONSULTATION_BOOKING_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  locationType: true,
  consultationApproval: {
    select: {
      id: true,
      status: true,
      proposedServicesJson: true,
      proposedTotal: true,
      notes: true,
    },
  },
} satisfies Prisma.BookingSelect

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

const FINISH_BOOKING_SELECT = {
  id: true,
  professionalId: true,
  status: true,
  startedAt: true,
  finishedAt: true,
  sessionStep: true,
} satisfies Prisma.BookingSelect

type FinishBookingRecord = Prisma.BookingGetPayload<{
  select: typeof FINISH_BOOKING_SELECT
}>

const TRANSITION_BOOKING_SELECT = {
  id: true,
  professionalId: true,
  status: true,
  finishedAt: true,
  startedAt: true,
  sessionStep: true,
  consultationApproval: {
    select: {
      status: true,
    },
  },
} satisfies Prisma.BookingSelect

type TransitionBookingRecord = Prisma.BookingGetPayload<{
  select: typeof TRANSITION_BOOKING_SELECT
}>

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

const REBOOK_SOURCE_BOOKING_SELECT = {
  id: true,
  status: true,
  clientId: true,
  professionalId: true,

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
  clientTimeZoneAtBooking: true,

  subtotalSnapshot: true,
  totalAmount: true,
  depositAmount: true,
  tipAmount: true,
  taxAmount: true,
  discountAmount: true,
  totalDurationMinutes: true,
  bufferMinutes: true,

  serviceItems: {
    orderBy: { sortOrder: 'asc' },
    select: {
      serviceId: true,
      offeringId: true,
      priceSnapshot: true,
      durationMinutesSnapshot: true,
      sortOrder: true,
    },
  },

  professional: {
    select: {
      timeZone: true,
    },
  },
} satisfies Prisma.BookingSelect

const BOOKING_MEDIA_UPLOAD_SELECT = {
  id: true,
  professionalId: true,
  status: true,
  sessionStep: true,
  finishedAt: true,
} satisfies Prisma.BookingSelect

type BookingMediaUploadRecord = Prisma.BookingGetPayload<{
  select: typeof BOOKING_MEDIA_UPLOAD_SELECT
}>

const BOOKING_MEDIA_ASSET_SELECT = {
  id: true,
  mediaType: true,
  visibility: true,
  phase: true,
  caption: true,
  createdAt: true,
  reviewId: true,
  isEligibleForLooks: true,
  isFeaturedInPortfolio: true,
  storageBucket: true,
  storagePath: true,
  thumbBucket: true,
  thumbPath: true,
  url: true,
  thumbUrl: true,
} satisfies Prisma.MediaAssetSelect

type BookingMediaAssetRecord = Prisma.MediaAssetGetPayload<{
  select: typeof BOOKING_MEDIA_ASSET_SELECT
}>


type RebookSourceBookingRecord = Prisma.BookingGetPayload<{
  select: typeof REBOOK_SOURCE_BOOKING_SELECT
}>

const AFTERCARE_REBOOK_LOCK_SELECT = {
  id: true,
  bookingId: true,
  booking: {
    select: {
      id: true,
      clientId: true,
      professionalId: true,
    },
  },
} satisfies Prisma.AftercareSummarySelect

type AftercareRebookLockRecord = Prisma.AftercareSummaryGetPayload<{
  select: typeof AFTERCARE_REBOOK_LOCK_SELECT
}>

const AFTERCARE_UPSERT_BOOKING_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  status: true,
  sessionStep: true,
  scheduledFor: true,
  finishedAt: true,
  locationTimeZone: true,
  service: {
    select: {
      name: true,
    },
  },
  client: {
    select: {
      firstName: true,
      lastName: true,
    },
  },
  aftercareSummary: {
    select: {
      publicToken: true,
    },
  },
  professional: {
    select: {
      timeZone: true,
    },
  },
} satisfies Prisma.BookingSelect

type AftercareUpsertBookingRecord = Prisma.BookingGetPayload<{
  select: typeof AFTERCARE_UPSERT_BOOKING_SELECT
}>

function buildMeta(mutated: boolean): MutationMeta {
  return {
    mutated,
    noOp: !mutated,
  }
}

async function bumpProfessionalScheduleVersion(
  professionalId: string,
): Promise<void> {
  if (!professionalId.trim()) return
  await bumpScheduleVersion(professionalId)
}

function normalizeReason(reason?: string | null): string | null {
  if (typeof reason !== 'string') return null
  const trimmed = reason.trim()
  return trimmed.length > 0 ? trimmed : null
}

function hasAnyRequestedBookingOverride(args: {
  allowShortNotice: boolean
  allowFarFuture: boolean
  allowOutsideWorkingHours: boolean
}): boolean {
  return (
    args.allowShortNotice ||
    args.allowFarFuture ||
    args.allowOutsideWorkingHours
  )
}

function assertExplicitOverrideReasonIfNeeded(args: {
  allowShortNotice: boolean
  allowFarFuture: boolean
  allowOutsideWorkingHours: boolean
  overrideReason: string | null
}): string | null {
  const reason = normalizeReason(args.overrideReason)

  if (
    hasAnyRequestedBookingOverride({
      allowShortNotice: args.allowShortNotice,
      allowFarFuture: args.allowFarFuture,
      allowOutsideWorkingHours: args.allowOutsideWorkingHours,
    }) &&
    !reason
  ) {
    throw bookingError('FORBIDDEN', {
      message: 'Override reason is required when using booking rule overrides.',
      userMessage: 'Please add a reason for this override.',
    })
  }

  return reason
}

function isWithinStartWindow(scheduledFor: Date, now: Date): boolean {
  const start = scheduledFor.getTime() - 15 * 60 * 1000
  const end = scheduledFor.getTime() + 15 * 60 * 1000
  const t = now.getTime()
  return t >= start && t <= end
}

function newPublicToken(): string {
  return crypto.randomBytes(16).toString('hex')
}

function addDaysByMs(base: Date, days: number): Date | null {
  const ms = base.getTime() + days * 24 * 60 * 60 * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d
}

function makeAftercareReminderDedupeKey(
  bookingId: string,
  type: 'REBOOK' | 'PRODUCT_FOLLOWUP',
): string {
  return `aftercare:${bookingId}:${type}`
}

function makeAftercareClientNotifDedupeKey(bookingId: string): string {
  return `client_aftercare:${bookingId}`
}

function resolveAftercareTimeZone(args: {
  bookingLocationTimeZone?: unknown
  professionalTimeZone?: unknown
}): string {
  const bookingTz =
    typeof args.bookingLocationTimeZone === 'string'
      ? args.bookingLocationTimeZone.trim()
      : ''

  if (bookingTz && isValidIanaTimeZone(bookingTz)) return bookingTz

  const proTz =
    typeof args.professionalTimeZone === 'string'
      ? args.professionalTimeZone.trim()
      : ''

  if (proTz && isValidIanaTimeZone(proTz)) return proTz

  return 'UTC'
}

function formatDateTimeInTimeZone(date: Date, timeZone: string): string {
  const tz = timeZone && isValidIanaTimeZone(timeZone) ? timeZone : 'UTC'

  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function computeRebookReminderDueAt(args: {
  mode: AftercareRebookMode
  rebookedFor: Date | null
  windowStart: Date | null
  daysBefore: number
}): Date | null {
  const base =
    args.mode === AftercareRebookMode.RECOMMENDED_WINDOW
      ? args.windowStart
      : args.rebookedFor

  if (!base) return null
  return addDaysByMs(base, -Math.abs(args.daysBefore))
}

function isAftercareSessionStepEligible(
  step: SessionStep | null | undefined,
): boolean {
  return (
    step === SessionStep.FINISH_REVIEW ||
    step === SessionStep.AFTER_PHOTOS ||
    step === SessionStep.DONE
  )
}

function isTerminalSessionBooking(
  status: BookingStatus,
  finishedAt: Date | null,
): boolean {
  return (
    status === BookingStatus.CANCELLED ||
    status === BookingStatus.COMPLETED ||
    Boolean(finishedAt)
  )
}

function requiresApprovedConsultForStep(step: SessionStep): boolean {
  return (
    step === SessionStep.SERVICE_IN_PROGRESS ||
    step === SessionStep.FINISH_REVIEW ||
    step === SessionStep.AFTER_PHOTOS ||
    step === SessionStep.DONE ||
    step === SessionStep.BEFORE_PHOTOS
  )
}

function isAllowedSessionTransition(
  from: SessionStep,
  to: SessionStep,
): boolean {
  if (from === to) return true

  if (from === SessionStep.NONE) {
    return to === SessionStep.CONSULTATION
  }

  if (from === SessionStep.CONSULTATION) {
    return (
      to === SessionStep.CONSULTATION_PENDING_CLIENT ||
      to === SessionStep.BEFORE_PHOTOS
    )
  }

  if (from === SessionStep.CONSULTATION_PENDING_CLIENT) {
    return (
      to === SessionStep.BEFORE_PHOTOS ||
      to === SessionStep.CONSULTATION
    )
  }

  if (from === SessionStep.BEFORE_PHOTOS) {
    return (
      to === SessionStep.SERVICE_IN_PROGRESS ||
      to === SessionStep.CONSULTATION
    )
  }

  if (from === SessionStep.SERVICE_IN_PROGRESS) {
    return to === SessionStep.FINISH_REVIEW
  }

  if (from === SessionStep.FINISH_REVIEW) {
    return to === SessionStep.AFTER_PHOTOS
  }

  if (from === SessionStep.AFTER_PHOTOS) {
    return (
      to === SessionStep.DONE ||
      to === SessionStep.FINISH_REVIEW
    )
  }

  if (from === SessionStep.DONE) {
    return false
  }

  return false
}

function canUploadBookingMediaPhase(
  sessionStep: SessionStep | null,
  phase: MediaPhase,
): boolean {
  const step = sessionStep ?? SessionStep.NONE

  if (phase === MediaPhase.BEFORE) {
    return (
      step === SessionStep.CONSULTATION ||
      step === SessionStep.CONSULTATION_PENDING_CLIENT ||
      step === SessionStep.BEFORE_PHOTOS ||
      step === SessionStep.SERVICE_IN_PROGRESS ||
      step === SessionStep.FINISH_REVIEW ||
      step === SessionStep.AFTER_PHOTOS ||
      step === SessionStep.DONE
    )
  }

  if (phase === MediaPhase.AFTER) {
    return step === SessionStep.AFTER_PHOTOS || step === SessionStep.DONE
  }

  return true
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

function assertNonEmptyUserId(userId: string): void {
  if (!userId.trim()) {
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

function normalizeOutputTimeZone(value: string): string {
  return isValidIanaTimeZone(value) ? sanitizeTimeZone(value, 'UTC') : 'UTC'
}

function buildBookingOutput(args: {
  id: string
  scheduledFor: Date
  totalDurationMinutes: number
  bufferMinutes: number
  status: BookingStatus
  subtotalSnapshot: Prisma.Decimal
  appointmentTimeZone: string
  timeZoneSource: TimeZoneTruthSource
  locationId?: string | null
  locationType?: ServiceLocationType | null
  locationAddressSnapshot?: string | null
  locationLatSnapshot?: number | null
  locationLngSnapshot?: number | null
}) {
  const {
    id,
    scheduledFor,
    totalDurationMinutes,
    bufferMinutes,
    status,
    subtotalSnapshot,
    appointmentTimeZone,
    timeZoneSource,
    locationId,
    locationType,
    locationAddressSnapshot,
    locationLatSnapshot,
    locationLngSnapshot,
  } = args

  return {
    id,
    scheduledFor: scheduledFor.toISOString(),
    endsAt: addMinutes(
      scheduledFor,
      totalDurationMinutes + bufferMinutes,
    ).toISOString(),
    bufferMinutes,
    durationMinutes: totalDurationMinutes,
    totalDurationMinutes,
    status,
    subtotalSnapshot: moneyToFixed2String(subtotalSnapshot),
    timeZone: appointmentTimeZone,
    timeZoneSource,
    locationId: locationId ?? null,
    locationType: locationType ?? null,
    locationAddressSnapshot: locationAddressSnapshot ?? null,
    locationLatSnapshot: locationLatSnapshot ?? null,
    locationLngSnapshot: locationLngSnapshot ?? null,
  }
}

function buildBookingMutationPayload(args: {
  booking: UpdateProBookingResult['booking']
  mutated: boolean
}): UpdateProBookingResult {
  return {
    booking: args.booking,
    meta: buildMeta(args.mutated),
  }
}

async function createBookingOverrideAuditLogs(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  professionalId: string
  actorUserId: string
  action: 'CREATE' | 'UPDATE'
  route: string
  reason: string
  appliedOverrides: ProSchedulingAppliedOverride[]
  bookingScheduledForBefore?: Date | null
  bookingScheduledForAfter: Date
  advanceNoticeMinutes: number
  maxDaysAhead: number
  workingHours: unknown
  timeZone: string
}): Promise<void> {
  if (args.appliedOverrides.length === 0) return

  const rows = buildBookingOverrideAuditRows({
    bookingId: args.bookingId,
    professionalId: args.professionalId,
    actorUserId: args.actorUserId,
    action: args.action,
    route: args.route,
    reason: args.reason,
    appliedOverrides: args.appliedOverrides,
    bookingScheduledForBefore: args.bookingScheduledForBefore ?? null,
    bookingScheduledForAfter: args.bookingScheduledForAfter,
    advanceNoticeMinutes: args.advanceNoticeMinutes,
    maxDaysAhead: args.maxDaysAhead,
    workingHours: args.workingHours,
    timeZone: args.timeZone,
  })

  if (rows.length === 0) return

  await args.tx.bookingOverrideAuditLog.createMany({
    data: rows,
  })
}

async function createUpdateClientNotification(args: {
  tx: Prisma.TransactionClient
  clientId: string
  bookingId: string
  type: ClientNotificationType
  title: string
  body: string
  dedupeKey: string
}): Promise<void> {
  await args.tx.clientNotification.create({
    data: {
      clientId: args.clientId,
      bookingId: args.bookingId,
      type: args.type,
      title: args.title,
      body: args.body,
      dedupeKey: args.dedupeKey,
    },
  })
}

async function resolveUpdateBookingSchedulingContext(args: {
  bookingLocationTimeZone?: unknown
  locationId?: string | null
  professionalId: string
  professionalTimeZone?: unknown
  fallback?: string
  requireValid?: boolean
}): Promise<AppointmentSchedulingContext> {
  const result = await resolveAppointmentSchedulingContext({
    bookingLocationTimeZone: args.bookingLocationTimeZone,
    locationId: args.locationId ?? null,
    professionalId: args.professionalId,
    professionalTimeZone: args.professionalTimeZone,
    fallback: args.fallback ?? 'UTC',
    requireValid: args.requireValid,
  })

  if (!result.ok) {
    throw bookingError('TIMEZONE_REQUIRED')
  }

  return {
    ...result.context,
    appointmentTimeZone: normalizeOutputTimeZone(
      result.context.appointmentTimeZone,
    ),
  }
}

function logAndThrowUpdateStepMismatch(args: {
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  bookingId: string
  stepMinutes: number
  appointmentTimeZone: string
  timeZoneSource: TimeZoneTruthSource
  meta?: Record<string, unknown>
}): never {
  logBookingConflict({
    action: 'BOOKING_UPDATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: addMinutes(args.requestedStart, 1),
    conflictType: 'STEP_BOUNDARY',
    bookingId: args.bookingId,
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      stepMinutes: args.stepMinutes,
      timeZone: args.appointmentTimeZone,
      timeZoneSource: args.timeZoneSource,
      ...(args.meta ?? {}),
    },
  })

  throw bookingError('STEP_MISMATCH', {
    message: `Start time must be on a ${args.stepMinutes}-minute boundary.`,
    userMessage: `Start time must be on a ${args.stepMinutes}-minute boundary.`,
  })
}

function logAndThrowUpdateWorkingHoursFailure(args: {
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  bookingId: string
  appointmentTimeZone: string
  timeZoneSource: TimeZoneTruthSource
  workingHoursError: string
}): never {
  logBookingConflict({
    action: 'BOOKING_UPDATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: 'WORKING_HOURS',
    bookingId: args.bookingId,
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      workingHoursError: args.workingHoursError,
      timeZone: args.appointmentTimeZone,
      timeZoneSource: args.timeZoneSource,
    },
  })

  const workingHoursCode = parseWorkingHoursGuardMessage(args.workingHoursError)

  if (workingHoursCode === 'WORKING_HOURS_REQUIRED') {
    throw bookingError('WORKING_HOURS_REQUIRED')
  }

  if (workingHoursCode === 'WORKING_HOURS_INVALID') {
    throw bookingError('WORKING_HOURS_INVALID')
  }

  if (workingHoursCode === 'OUTSIDE_WORKING_HOURS') {
    throw bookingError('OUTSIDE_WORKING_HOURS', {
      userMessage: 'That time is outside your working hours.',
    })
  }

  const message = getReadableWorkingHoursMessage(args.workingHoursError)
  throw bookingError('OUTSIDE_WORKING_HOURS', {
    message,
    userMessage: message,
  })
}

function logAndThrowUpdateAdvanceNoticeFailure(args: {
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  bookingId: string
  appointmentTimeZone: string
  timeZoneSource: TimeZoneTruthSource
  advanceNoticeMinutes: number
  meta?: Record<string, unknown>
}): never {
  logBookingConflict({
    action: 'BOOKING_UPDATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: 'TIME_NOT_AVAILABLE',
    bookingId: args.bookingId,
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      rule: 'ADVANCE_NOTICE',
      advanceNoticeMinutes: args.advanceNoticeMinutes,
      allowShortNotice: false,
      timeZone: args.appointmentTimeZone,
      timeZoneSource: args.timeZoneSource,
      ...(args.meta ?? {}),
    },
  })

  throw bookingError('ADVANCE_NOTICE_REQUIRED', {
    userMessage:
      'That booking is too soon unless you explicitly override advance notice.',
  })
}

function logAndThrowUpdateMaxDaysAheadFailure(args: {
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  bookingId: string
  appointmentTimeZone: string
  timeZoneSource: TimeZoneTruthSource
  maxDaysAhead: number
  meta?: Record<string, unknown>
}): never {
  logBookingConflict({
    action: 'BOOKING_UPDATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: 'TIME_NOT_AVAILABLE',
    bookingId: args.bookingId,
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      rule: 'MAX_DAYS_AHEAD',
      maxDaysAhead: args.maxDaysAhead,
      allowFarFuture: false,
      timeZone: args.appointmentTimeZone,
      timeZoneSource: args.timeZoneSource,
      ...(args.meta ?? {}),
    },
  })

  throw bookingError('MAX_DAYS_AHEAD_EXCEEDED', {
    userMessage:
      'That booking is too far in the future unless you explicitly override the booking window.',
  })
}

function logAndThrowUpdateTimeRangeConflict(args: {
  conflict: 'BLOCKED' | 'BOOKING' | 'HOLD'
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  bookingId: string
  appointmentTimeZone: string
  timeZoneSource: TimeZoneTruthSource
}): never {
  logBookingConflict({
    action: 'BOOKING_UPDATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: args.conflict,
    bookingId: args.bookingId,
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      timeZone: args.appointmentTimeZone,
      timeZoneSource: args.timeZoneSource,
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

async function enforceUpdateBookingScheduling(args: {
  tx: Prisma.TransactionClient
  now: Date
  finalStart: Date
  finalDuration: number
  finalBuffer: number
  workingHours: unknown
  appointmentTimeZone: string
  stepMinutes: number
  advanceNoticeMinutes: number
  maxDaysAhead: number
  allowShortNotice: boolean
  allowFarFuture: boolean
  allowOutsideWorkingHours: boolean
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  bookingId: string
  timeZoneSource: TimeZoneTruthSource
}): Promise<{
  requestedEnd: Date
  appliedOverrides: ProSchedulingAppliedOverride[]
}> {
  const decision = await evaluateProSchedulingDecision({
    tx: args.tx,
    now: args.now,
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.finalStart,
    durationMinutes: args.finalDuration,
    bufferMinutes: args.finalBuffer,
    workingHours: args.workingHours,
    timeZone: args.appointmentTimeZone,
    stepMinutes: args.stepMinutes,
    advanceNoticeMinutes: args.advanceNoticeMinutes,
    maxDaysAhead: args.maxDaysAhead,
    allowShortNotice: args.allowShortNotice,
    allowFarFuture: args.allowFarFuture,
    allowOutsideWorkingHours: args.allowOutsideWorkingHours,
    excludeBookingId: args.bookingId,
  })

    if (decision.ok) {
    return {
      requestedEnd: decision.value.requestedEnd,
      appliedOverrides: decision.value.appliedOverrides,
    }
  }

  const requestedEnd =
    decision.logHint?.requestedEnd ??
    addMinutes(args.finalStart, args.finalDuration + args.finalBuffer)

  switch (decision.code) {
    case 'STEP_MISMATCH':
      return logAndThrowUpdateStepMismatch({
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.finalStart,
        bookingId: args.bookingId,
        stepMinutes: args.stepMinutes,
        appointmentTimeZone: args.appointmentTimeZone,
        timeZoneSource: args.timeZoneSource,
        meta: decision.logHint?.meta,
      })

    case 'WORKING_HOURS_REQUIRED':
      return logAndThrowUpdateWorkingHoursFailure({
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.finalStart,
        requestedEnd,
        bookingId: args.bookingId,
        appointmentTimeZone: args.appointmentTimeZone,
        timeZoneSource: args.timeZoneSource,
        workingHoursError: makeWorkingHoursGuardMessage(
          'WORKING_HOURS_REQUIRED',
        ),
      })

    case 'WORKING_HOURS_INVALID':
      return logAndThrowUpdateWorkingHoursFailure({
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.finalStart,
        requestedEnd,
        bookingId: args.bookingId,
        appointmentTimeZone: args.appointmentTimeZone,
        timeZoneSource: args.timeZoneSource,
        workingHoursError: makeWorkingHoursGuardMessage(
          'WORKING_HOURS_INVALID',
        ),
      })

    case 'OUTSIDE_WORKING_HOURS':
      return logAndThrowUpdateWorkingHoursFailure({
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.finalStart,
        requestedEnd,
        bookingId: args.bookingId,
        appointmentTimeZone: args.appointmentTimeZone,
        timeZoneSource: args.timeZoneSource,
        workingHoursError:
          typeof decision.logHint?.meta?.workingHoursError === 'string'
            ? decision.logHint.meta.workingHoursError
            : makeWorkingHoursGuardMessage('OUTSIDE_WORKING_HOURS'),
      })

    case 'ADVANCE_NOTICE_REQUIRED':
      return logAndThrowUpdateAdvanceNoticeFailure({
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.finalStart,
        requestedEnd,
        bookingId: args.bookingId,
        appointmentTimeZone: args.appointmentTimeZone,
        timeZoneSource: args.timeZoneSource,
        advanceNoticeMinutes: args.advanceNoticeMinutes,
        meta: decision.logHint?.meta,
      })

    case 'MAX_DAYS_AHEAD_EXCEEDED':
      return logAndThrowUpdateMaxDaysAheadFailure({
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.finalStart,
        requestedEnd,
        bookingId: args.bookingId,
        appointmentTimeZone: args.appointmentTimeZone,
        timeZoneSource: args.timeZoneSource,
        maxDaysAhead: args.maxDaysAhead,
        meta: decision.logHint?.meta,
      })

    case 'TIME_BLOCKED':
      return logAndThrowUpdateTimeRangeConflict({
        conflict: 'BLOCKED',
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.finalStart,
        requestedEnd,
        bookingId: args.bookingId,
        appointmentTimeZone: args.appointmentTimeZone,
        timeZoneSource: args.timeZoneSource,
      })

    case 'TIME_BOOKED':
      return logAndThrowUpdateTimeRangeConflict({
        conflict: 'BOOKING',
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.finalStart,
        requestedEnd,
        bookingId: args.bookingId,
        appointmentTimeZone: args.appointmentTimeZone,
        timeZoneSource: args.timeZoneSource,
      })

    case 'TIME_HELD':
      return logAndThrowUpdateTimeRangeConflict({
        conflict: 'HOLD',
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.finalStart,
        requestedEnd,
        bookingId: args.bookingId,
        appointmentTimeZone: args.appointmentTimeZone,
        timeZoneSource: args.timeZoneSource,
      })
  }

  const exhaustiveCheck: never = decision.code
  throw new Error(
    `Unhandled scheduling decision code: ${String(exhaustiveCheck)}`,
  )
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
}): Promise<{
  requestedEnd: Date
  appliedOverrides: ProSchedulingAppliedOverride[]
}> {
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
    return {
      requestedEnd: decision.value.requestedEnd,
      appliedOverrides: decision.value.appliedOverrides,
    }
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

  await bumpProfessionalScheduleVersion(booking.professionalId)

  return {
    booking: {
      id: updated.id,
      status: updated.status,
      sessionStep: updated.sessionStep ?? SessionStep.NONE,
    },
    meta: buildMeta(true),
  }
}

async function performLockedStartBookingSession(args: {
  tx: Prisma.TransactionClient
  now: Date
  bookingId: string
  professionalId: string
}): Promise<StartBookingSessionResult> {
  const booking: StartBookingRecord | null = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: START_BOOKING_SELECT,
  })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.professionalId !== args.professionalId) {
    throw bookingError('FORBIDDEN')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED', {
      message: 'Cancelled bookings cannot be started.',
      userMessage: 'Cancelled bookings cannot be started.',
    })
  }

  if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
    throw bookingError('BOOKING_CANNOT_EDIT_COMPLETED', {
      message: 'This session is already finished.',
      userMessage: 'This session is already finished.',
    })
  }

  if (booking.status === BookingStatus.PENDING) {
    throw bookingError('FORBIDDEN', {
      message: 'You must accept this appointment before you can start it.',
      userMessage: 'You must accept this appointment before you can start it.',
    })
  }

  if (booking.startedAt) {
    if (booking.sessionStep && booking.sessionStep !== SessionStep.NONE) {
      return {
        booking: {
          id: booking.id,
          status: booking.status,
          startedAt: booking.startedAt,
          finishedAt: booking.finishedAt,
          sessionStep: booking.sessionStep,
        },
        meta: buildMeta(false),
      }
    }

    const healed = await args.tx.booking.update({
      where: { id: booking.id },
      data: {
        sessionStep: SessionStep.CONSULTATION,
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
      } satisfies Prisma.BookingSelect,
    })

    return {
      booking: {
        id: healed.id,
        status: healed.status,
        startedAt: healed.startedAt,
        finishedAt: healed.finishedAt,
        sessionStep: healed.sessionStep ?? SessionStep.NONE,
      },
      meta: buildMeta(true),
    }
  }

  if (!isWithinStartWindow(booking.scheduledFor, args.now)) {
    throw bookingError('FORBIDDEN', {
      message:
        'You can start this appointment 15 minutes before or after the scheduled time.',
      userMessage:
        'You can start this appointment 15 minutes before or after the scheduled time.',
    })
  }

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      startedAt: args.now,
      sessionStep: SessionStep.CONSULTATION,
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      sessionStep: true,
    } satisfies Prisma.BookingSelect,
  })

  return {
    booking: {
      id: updated.id,
      status: updated.status,
      startedAt: updated.startedAt,
      finishedAt: updated.finishedAt,
      sessionStep: updated.sessionStep ?? SessionStep.NONE,
    },
    meta: buildMeta(true),
  }
} 


async function performLockedFinishBookingSession(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  professionalId: string
}): Promise<FinishBookingSessionResult> {
  const booking: FinishBookingRecord | null = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: FINISH_BOOKING_SELECT,
  })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.professionalId !== args.professionalId) {
    throw bookingError('FORBIDDEN', {
      message: 'You can only finish your own bookings.',
      userMessage: 'You can only finish your own bookings.',
    })
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED', {
      message: 'Cancelled bookings cannot be finished.',
      userMessage: 'Cancelled bookings cannot be finished.',
    })
  }

  if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
    throw bookingError('BOOKING_CANNOT_EDIT_COMPLETED', {
      message: 'This booking is already completed.',
      userMessage: 'This booking is already completed.',
    })
  }

  if (!booking.startedAt) {
    throw bookingError('FORBIDDEN', {
      message: 'You can only finish after the session has started.',
      userMessage: 'You can only finish after the session has started.',
    })
  }

  const afterCount = await args.tx.mediaAsset.count({
    where: {
      bookingId: booking.id,
      phase: MediaPhase.AFTER,
      uploadedByRole: Role.PRO,
    },
  })

  const step = booking.sessionStep ?? SessionStep.NONE

  if (
    step === SessionStep.FINISH_REVIEW ||
    step === SessionStep.AFTER_PHOTOS ||
    step === SessionStep.DONE
  ) {
    return {
      booking: {
        id: booking.id,
        status: booking.status,
        startedAt: booking.startedAt,
        finishedAt: booking.finishedAt,
        sessionStep: step,
      },
      afterCount,
      meta: buildMeta(false),
    }
  }

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: { sessionStep: SessionStep.FINISH_REVIEW },
    select: {
      id: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      sessionStep: true,
    } satisfies Prisma.BookingSelect,
  })

  return {
    booking: {
      id: updated.id,
      status: updated.status,
      startedAt: updated.startedAt,
      finishedAt: updated.finishedAt,
      sessionStep: updated.sessionStep ?? SessionStep.NONE,
    },
    afterCount,
    meta: buildMeta(true),
  }
}

async function performLockedTransitionSessionStep(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  professionalId: string
  nextStep: SessionStep
}): Promise<TransitionSessionStepResult> {
  const booking: TransitionBookingRecord | null = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: TRANSITION_BOOKING_SELECT,
  })

  if (!booking) {
    return {
      ok: false,
      status: 404,
      error: 'Booking not found.',
      meta: buildMeta(false),
    }
  }

  if (booking.professionalId !== args.professionalId) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden.',
      meta: buildMeta(false),
    }
  }

  if (isTerminalSessionBooking(booking.status, booking.finishedAt)) {
    return {
      ok: false,
      status: 409,
      error: 'Booking is completed/cancelled.',
      meta: buildMeta(false),
    }
  }

  if (booking.status === BookingStatus.PENDING) {
    if (
      args.nextStep !== SessionStep.CONSULTATION &&
      args.nextStep !== SessionStep.NONE
    ) {
      await args.tx.booking.update({
        where: { id: booking.id },
        data: { sessionStep: SessionStep.CONSULTATION },
        select: { id: true } satisfies Prisma.BookingSelect,
      })

      return {
        ok: false,
        status: 409,
        error: 'Pending bookings are consultation-only.',
        forcedStep: SessionStep.CONSULTATION,
        meta: buildMeta(true),
      }
    }
  }

  const from = booking.sessionStep ?? SessionStep.NONE

  if (!isAllowedSessionTransition(from, args.nextStep)) {
    return {
      ok: false,
      status: 409,
      error: `Invalid transition: ${from} → ${args.nextStep}.`,
      meta: buildMeta(false),
    }
  }

  const approval = upper(booking.consultationApproval?.status)

  if (
    requiresApprovedConsultForStep(args.nextStep) &&
    approval !== 'APPROVED'
  ) {
    await args.tx.booking.update({
      where: { id: booking.id },
      data: { sessionStep: SessionStep.CONSULTATION },
      select: { id: true } satisfies Prisma.BookingSelect,
    })

    return {
      ok: false,
      status: 409,
      error: 'Waiting for client approval.',
      forcedStep: SessionStep.CONSULTATION,
      meta: buildMeta(true),
    }
  }

  if (args.nextStep === SessionStep.SERVICE_IN_PROGRESS) {
    const beforeCount = await args.tx.mediaAsset.count({
      where: {
        bookingId: booking.id,
        phase: MediaPhase.BEFORE,
        uploadedByRole: Role.PRO,
      },
    })

    if (beforeCount <= 0) {
      return {
        ok: false,
        status: 409,
        error: 'Upload at least one BEFORE photo before starting service.',
        meta: buildMeta(false),
      }
    }
  }

  if (args.nextStep === SessionStep.DONE) {
    const [beforeCount, afterCount, aftercare] = await Promise.all([
      args.tx.mediaAsset.count({
        where: {
          bookingId: booking.id,
          phase: MediaPhase.BEFORE,
          uploadedByRole: Role.PRO,
        },
      }),
      args.tx.mediaAsset.count({
        where: {
          bookingId: booking.id,
          phase: MediaPhase.AFTER,
          uploadedByRole: Role.PRO,
        },
      }),
      args.tx.aftercareSummary.findFirst({
        where: { bookingId: booking.id },
        select: { id: true },
      }),
    ])

    const missing: string[] = []
    if (beforeCount <= 0) missing.push('BEFORE photo')
    if (afterCount <= 0) missing.push('AFTER photo')
    if (!aftercare?.id) missing.push('aftercare')

    if (missing.length > 0) {
      return {
        ok: false,
        status: 409,
        error: `Wrap-up incomplete: add ${missing.join(' + ')} before completing the session.`,
        forcedStep: SessionStep.AFTER_PHOTOS,
        meta: buildMeta(false),
      }
    }
  }

  const shouldSetStartedAt =
    args.nextStep === SessionStep.SERVICE_IN_PROGRESS &&
    !booking.startedAt

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      sessionStep: args.nextStep,
      ...(shouldSetStartedAt ? { startedAt: new Date() } : {}),
    },
    select: {
      id: true,
      sessionStep: true,
      startedAt: true,
    } satisfies Prisma.BookingSelect,
  })

  return {
    ok: true,
    booking: {
      id: updated.id,
      sessionStep: updated.sessionStep ?? SessionStep.NONE,
      startedAt: updated.startedAt,
    },
    meta: buildMeta(true),
  }
}

async function performLockedUploadProBookingMedia(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  professionalId: string
  uploadedByUserId: string
  storageBucket: string
  storagePath: string
  thumbBucket: string | null
  thumbPath: string | null
  caption: string | null
  phase: MediaPhase
  mediaType: MediaType
}): Promise<UploadProBookingMediaResult> {
  const booking: BookingMediaUploadRecord | null = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: BOOKING_MEDIA_UPLOAD_SELECT,
  })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.professionalId !== args.professionalId) {
    throw bookingError('FORBIDDEN')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED', {
      message: 'This booking is cancelled.',
      userMessage: 'This booking is cancelled.',
    })
  }

  if (booking.status === BookingStatus.PENDING) {
    throw bookingError('FORBIDDEN', {
      message: 'Media uploads require an accepted booking.',
      userMessage: 'Media uploads require an accepted booking.',
    })
  }

  if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
    throw bookingError('BOOKING_CANNOT_EDIT_COMPLETED', {
      message: 'This booking is completed. Media uploads are locked.',
      userMessage: 'This booking is completed. Media uploads are locked.',
    })
  }

  if (!canUploadBookingMediaPhase(booking.sessionStep, args.phase)) {
    const step = booking.sessionStep ?? SessionStep.NONE
    throw bookingError('STEP_MISMATCH', {
      message: `You can’t upload ${args.phase} media at session step: ${String(step)}.`,
      userMessage: `You can’t upload ${args.phase} media at session step: ${String(step)}.`,
    })
  }

  const created: BookingMediaAssetRecord = await args.tx.mediaAsset.create({
    data: {
      professionalId: booking.professionalId,
      bookingId: booking.id,
      uploadedByUserId: args.uploadedByUserId,
      uploadedByRole: Role.PRO,

      storageBucket: args.storageBucket,
      storagePath: args.storagePath,
      thumbBucket: args.thumbBucket,
      thumbPath: args.thumbPath,

      url: null,
      thumbUrl: null,

      mediaType: args.mediaType,
      phase: args.phase,
      caption: args.caption,

      visibility: MediaVisibility.PRO_CLIENT,
      isEligibleForLooks: false,
      isFeaturedInPortfolio: false,

      reviewId: null,
      reviewLocked: false,
    },
    select: BOOKING_MEDIA_ASSET_SELECT,
  })

  let advancedTo: SessionStep | null = null
  const step = booking.sessionStep ?? SessionStep.NONE

  if (
    args.phase === MediaPhase.BEFORE &&
    (step === SessionStep.CONSULTATION ||
      step === SessionStep.CONSULTATION_PENDING_CLIENT ||
      step === SessionStep.BEFORE_PHOTOS)
  ) {
    await args.tx.booking.update({
      where: { id: booking.id },
      data: { sessionStep: SessionStep.SERVICE_IN_PROGRESS },
      select: { id: true } satisfies Prisma.BookingSelect,
    })
    advancedTo = SessionStep.SERVICE_IN_PROGRESS
  }

  if (
    args.phase === MediaPhase.AFTER &&
    booking.sessionStep === SessionStep.AFTER_PHOTOS
  ) {
    await args.tx.booking.update({
      where: { id: booking.id },
      data: { sessionStep: SessionStep.DONE },
      select: { id: true } satisfies Prisma.BookingSelect,
    })
    advancedTo = SessionStep.DONE
  }

  return {
    created,
    advancedTo,
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

    await bumpProfessionalScheduleVersion(offering.professionalId)

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

  await bumpProfessionalScheduleVersion(booking.professionalId)

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

type ConsultationProposedServiceItem = {
  offeringId: string
  sortOrder: number
}

function isJsonObjectRecord(
  value: Prisma.JsonValue,
): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function performLockedApproveConsultationMaterialization(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  clientId: string
  professionalId: string
  now: Date
}): Promise<ApproveConsultationMaterializationResult> {
  const booking = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: APPROVE_CONSULTATION_BOOKING_SELECT,
  })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.clientId !== args.clientId) {
    throw bookingError('FORBIDDEN')
  }

  if (booking.professionalId !== args.professionalId) {
    throw bookingError('FORBIDDEN')
  }

  const approval = booking.consultationApproval
  if (!approval?.id) {
    throw bookingError('FORBIDDEN', {
      message: 'No consultation proposal exists for this booking.',
      userMessage: 'No consultation proposal exists for this booking.',
    })
  }

  if (approval.status !== ConsultationApprovalStatus.PENDING) {
    throw bookingError('FORBIDDEN', {
      message: 'Consultation proposal is no longer pending.',
      userMessage: 'Consultation proposal is no longer pending.',
    })
  }

  const proposed = approval.proposedServicesJson

  if (!Array.isArray(proposed) || proposed.length === 0) {
    throw bookingError('INVALID_SERVICE_ITEMS')
  }

  const proposedItems: ConsultationProposedServiceItem[] = proposed.map((row, index) => {
  if (!isJsonObjectRecord(row)) {
    throw bookingError('INVALID_SERVICE_ITEMS')
  }

  const offeringId =
    typeof row.offeringId === 'string' ? row.offeringId.trim() : ''

  if (!offeringId) {
    throw bookingError('INVALID_SERVICE_ITEMS')
  }

  return {
    offeringId,
    sortOrder:
      typeof row.sortOrder === 'number' ? row.sortOrder : index,
  }
})

const offeringIds = Array.from(
  new Set(proposedItems.map((item) => item.offeringId)),
).slice(0, 50)

  const offerings = await args.tx.professionalServiceOffering.findMany({
    where: {
      id: { in: offeringIds },
      professionalId: booking.professionalId,
      isActive: true,
    },
    select: {
      id: true,
      serviceId: true,
      offersInSalon: true,
      offersMobile: true,
      salonDurationMinutes: true,
      mobileDurationMinutes: true,
      salonPriceStartingAt: true,
      mobilePriceStartingAt: true,
      service: {
        select: {
          defaultDurationMinutes: true,
        },
      },
    },
    take: 100,
  })

  const offeringById = new Map(
    offerings.map((offering) => [offering.id, offering]),
  )

  const requestedItems: RequestedServiceItemInput[] = proposedItems.map((item) => {
  const offering = offeringById.get(item.offeringId)

  if (!offering) {
    throw bookingError('INVALID_SERVICE_ITEMS')
  }

  return {
    serviceId: offering.serviceId,
    offeringId: offering.id,
    sortOrder: item.sortOrder,
  }
})

  const normalizedItems = buildNormalizedBookingItemsFromRequestedOfferings({
    requestedItems,
    locationType: booking.locationType,
    stepMinutes: 15,
    offeringById,
    badItemsCode: 'INVALID_SERVICE_ITEMS',
  })

  const {
    primaryServiceId,
    primaryOfferingId,
    computedDurationMinutes,
    computedSubtotal,
  } = computeBookingItemLikeTotals(
    normalizedItems.map((item, index) => ({
      serviceId: item.serviceId,
      offeringId: item.offeringId,
      durationMinutesSnapshot: item.durationMinutesSnapshot,
      priceSnapshot: item.priceSnapshot,
      itemType:
        index === 0
          ? BookingServiceItemType.BASE
          : BookingServiceItemType.ADD_ON,
    })),
    'INVALID_SERVICE_ITEMS',
  )

  await args.tx.bookingServiceItem.deleteMany({
    where: { bookingId: booking.id },
  })

  const baseItem = normalizedItems[0]
  if (!baseItem) {
    throw bookingError('INVALID_SERVICE_ITEMS')
  }

  const createdBaseItem = await args.tx.bookingServiceItem.create({
    data: {
      bookingId: booking.id,
      serviceId: baseItem.serviceId,
      offeringId: baseItem.offeringId,
      itemType: BookingServiceItemType.BASE,
      parentItemId: null,
      priceSnapshot: baseItem.priceSnapshot,
      durationMinutesSnapshot: baseItem.durationMinutesSnapshot,
      sortOrder: 0,
    },
    select: { id: true },
  })

  const addOnItems = normalizedItems.slice(1)
  if (addOnItems.length > 0) {
    await args.tx.bookingServiceItem.createMany({
      data: addOnItems.map((item, index) => ({
        bookingId: booking.id,
        serviceId: item.serviceId,
        offeringId: item.offeringId,
        itemType: BookingServiceItemType.ADD_ON,
        parentItemId: createdBaseItem.id,
        priceSnapshot: item.priceSnapshot,
        durationMinutesSnapshot: item.durationMinutesSnapshot,
        sortOrder: index + 1,
        notes: 'CONSULTATION_APPROVED',
      })),
    })
  }

  const updatedBooking = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      serviceId: primaryServiceId,
      offeringId: primaryOfferingId,
      subtotalSnapshot: computedSubtotal,
      totalDurationMinutes: computedDurationMinutes,
      consultationConfirmedAt: args.now,
    },
    select: {
      id: true,
      serviceId: true,
      offeringId: true,
      subtotalSnapshot: true,
      totalDurationMinutes: true,
      consultationConfirmedAt: true,
    },
  })

  const updatedApproval = await args.tx.consultationApproval.update({
    where: { bookingId: booking.id },
    data: {
      status: ConsultationApprovalStatus.APPROVED,
      approvedAt: args.now,
      rejectedAt: null,
      clientId: args.clientId,
      proId: args.professionalId,
    },
    select: {
      id: true,
      status: true,
      approvedAt: true,
      rejectedAt: true,
    },
  })

  return {
    booking: updatedBooking,
    approval: updatedApproval,
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

  await bumpProfessionalScheduleVersion(created.professionalId)

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
  actorUserId: string
  overrideReason: string | null
}): Promise<CreateProBookingResult> {

    assertNonEmptyUserId(args.actorUserId)

  const normalizedOverrideReason = assertExplicitOverrideReasonIfNeeded({
    allowShortNotice: args.allowShortNotice,
    allowFarFuture: args.allowFarFuture,
    allowOutsideWorkingHours: args.allowOutsideWorkingHours,
    overrideReason: args.overrideReason,
  })

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

    const schedulingDecision = await enforceProCreateScheduling({
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
if (
  schedulingDecision.appliedOverrides.length > 0 &&
  normalizedOverrideReason
) {
  for (const rule of schedulingDecision.appliedOverrides) {
    await assertCanUseBookingOverride({
      actorUserId: args.actorUserId,
      professionalId: args.professionalId,
      rule,
    })
  }

  await createBookingOverrideAuditLogs({
    tx: args.tx,
    bookingId: booking.id,
    professionalId: args.professionalId,
    actorUserId: args.actorUserId,
    action: 'CREATE',
    route: 'lib/booking/writeBoundary.ts:createProBooking',
    reason: normalizedOverrideReason,
    appliedOverrides: schedulingDecision.appliedOverrides,
    bookingScheduledForBefore: null,
    bookingScheduledForAfter: requestedStart,
    advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
    maxDaysAhead: locationContext.maxDaysAhead,
    workingHours: locationContext.workingHours,
    timeZone: locationContext.timeZone,
  })
}

  await bumpProfessionalScheduleVersion(args.professionalId)

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

async function performLockedCreateRebookedBooking(
  args: PerformLockedCreateRebookedBookingArgs,
): Promise<CreateRebookedBookingFromCompletedBookingResult> {
  const source: RebookSourceBookingRecord | null = await args.tx.booking.findFirst({
    where: {
      id: args.bookingId,
      professionalId: args.professionalId,
    },
    select: REBOOK_SOURCE_BOOKING_SELECT,
  })

  if (!source) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (source.status !== BookingStatus.COMPLETED) {
    throw bookingError('AFTERCARE_NOT_COMPLETED', {
      message: 'Only COMPLETED bookings can be rebooked.',
      userMessage: 'Only COMPLETED bookings can be rebooked.',
    })
  }

  const requestedStart = normalizeToMinute(new Date(args.scheduledFor))
  if (!Number.isFinite(requestedStart.getTime())) {
    throw bookingError('INVALID_SCHEDULED_FOR')
  }

  if (requestedStart.getTime() < args.now.getTime() + 60_000) {
    throw bookingError('INVALID_SCHEDULED_FOR', {
      message: 'scheduledFor must be at least 1 minute in the future.',
      userMessage: 'scheduledFor must be at least 1 minute in the future.',
    })
  }

  if (!source.locationId) {
    throw bookingError('BAD_LOCATION')
  }

  const items = source.serviceItems ?? []
  const primary = items[0] ?? null

  if (!primary?.serviceId || !primary.offeringId) {
    throw bookingError('INVALID_SERVICE_ITEMS', {
      message: 'This booking has no service items to rebook.',
      userMessage: 'This booking has no service items to rebook.',
    })
  }

  const normalizedItems = items.map((item, index) => ({
    serviceId: item.serviceId,
    offeringId: item.offeringId,
    priceSnapshot: item.priceSnapshot ?? new Prisma.Decimal(0),
    durationMinutesSnapshot:
      normalizePositiveDurationMinutes(item.durationMinutesSnapshot) ?? 60,
    itemType:
      index === 0
        ? BookingServiceItemType.BASE
        : BookingServiceItemType.ADD_ON,
    sortOrder: index,
  }))

  const subtotalFromItems = normalizedItems.reduce(
    (sum, item) => sum.plus(item.priceSnapshot),
    new Prisma.Decimal(0),
  )

  const subtotalSnapshot = source.subtotalSnapshot ?? subtotalFromItems

  const totalDurationFromItems = normalizedItems.reduce(
    (sum, item) => sum + item.durationMinutesSnapshot,
    0,
  )

  const totalDurationMinutes =
    totalDurationFromItems > 0
      ? clampInt(totalDurationFromItems, 15, MAX_SLOT_DURATION_MINUTES)
      : normalizePositiveDurationMinutes(source.totalDurationMinutes) ?? 60

  const bufferMinutes = clampInt(
    Number(source.bufferMinutes ?? 0),
    0,
    MAX_BUFFER_MINUTES,
  )

  const validatedContextResult = await resolveValidatedBookingContext({
    tx: args.tx,
    professionalId: source.professionalId,
    requestedLocationId: source.locationId,
    locationType: source.locationType,
    holdLocationTimeZone: null,
    professionalTimeZone: source.professional?.timeZone ?? null,
    fallbackTimeZone: source.professional?.timeZone ?? DEFAULT_TIME_ZONE,
    requireValidTimeZone: true,
    allowFallback: false,
    requireCoordinates: false,
    offering: {
      offersInSalon: source.locationType === ServiceLocationType.SALON,
      offersMobile: source.locationType === ServiceLocationType.MOBILE,
      salonDurationMinutes:
        source.locationType === ServiceLocationType.SALON
          ? totalDurationMinutes
          : null,
      mobileDurationMinutes:
        source.locationType === ServiceLocationType.MOBILE
          ? totalDurationMinutes
          : null,
      salonPriceStartingAt:
        source.locationType === ServiceLocationType.SALON
          ? subtotalSnapshot
          : null,
      mobilePriceStartingAt:
        source.locationType === ServiceLocationType.MOBILE
          ? subtotalSnapshot
          : null,
    },
  })

  if (!validatedContextResult.ok) {
    throw bookingError(
      mapSchedulingReadinessErrorToBookingCode(validatedContextResult.error),
    )
  }

  const locationContext = validatedContextResult.context

  await enforceProCreateScheduling({
    tx: args.tx,
    now: args.now,
    requestedStart,
    durationMinutes: totalDurationMinutes,
    bufferMinutes,
    workingHours: locationContext.workingHours,
    timeZone: locationContext.timeZone,
    stepMinutes: locationContext.stepMinutes,
    advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
    maxDaysAhead: locationContext.maxDaysAhead,
    allowShortNotice: false,
    allowFarFuture: false,
    allowOutsideWorkingHours: false,
    professionalId: source.professionalId,
    locationId: locationContext.locationId,
    locationType: source.locationType,
    offeringId: primary.offeringId,
    clientId: source.clientId,
  })

  const salonAddressSnapshot =
    source.locationType === ServiceLocationType.SALON
      ? source.locationAddressSnapshot != null
        ? toNullableJsonCreateInput(source.locationAddressSnapshot)
        : locationContext.formattedAddress
          ? buildAddressSnapshot(locationContext.formattedAddress) ?? Prisma.JsonNull
          : Prisma.JsonNull
      : Prisma.JsonNull

  let createdBooking: {
    id: string
    status: BookingStatus
    scheduledFor: Date
  }

  try {
    createdBooking = await args.tx.booking.create({
      data: {
        clientId: source.clientId,
        professionalId: source.professionalId,

        serviceId: primary.serviceId,
        offeringId: primary.offeringId,

        scheduledFor: requestedStart,
        status: args.initialStatus,
        source: BookingSource.AFTERCARE,
        rebookOfBookingId: source.id,

        locationType: source.locationType,
        locationId: locationContext.locationId,
        locationTimeZone: locationContext.timeZone,

        locationAddressSnapshot: salonAddressSnapshot,
        locationLatSnapshot:
          decimalToNumber(source.locationLatSnapshot) ?? locationContext.lat,
        locationLngSnapshot:
          decimalToNumber(source.locationLngSnapshot) ?? locationContext.lng,

        clientAddressId:
          source.locationType === ServiceLocationType.MOBILE
            ? source.clientAddressId
            : null,
        clientAddressSnapshot:
          source.locationType === ServiceLocationType.MOBILE
            ? toNullableJsonCreateInput(source.clientAddressSnapshot)
            : Prisma.JsonNull,
        clientAddressLatSnapshot:
          source.locationType === ServiceLocationType.MOBILE
            ? decimalToNumber(source.clientAddressLatSnapshot)
            : null,
        clientAddressLngSnapshot:
          source.locationType === ServiceLocationType.MOBILE
            ? decimalToNumber(source.clientAddressLngSnapshot)
            : null,

        clientTimeZoneAtBooking: source.clientTimeZoneAtBooking ?? undefined,

        subtotalSnapshot,
        totalAmount: source.totalAmount ?? undefined,
        depositAmount: source.depositAmount ?? undefined,
        tipAmount: source.tipAmount ?? undefined,
        taxAmount: source.taxAmount ?? undefined,
        discountAmount: source.discountAmount ?? undefined,
        totalDurationMinutes,
        bufferMinutes,

        sessionStep: SessionStep.NONE,
      },
      select: {
        id: true,
        status: true,
        scheduledFor: true,
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

  const baseItem = await args.tx.bookingServiceItem.create({
    data: {
      bookingId: createdBooking.id,
      serviceId: primary.serviceId,
      offeringId: primary.offeringId,
      itemType: BookingServiceItemType.BASE,
      parentItemId: null,
      priceSnapshot: normalizedItems[0]?.priceSnapshot ?? new Prisma.Decimal(0),
      durationMinutesSnapshot:
        normalizedItems[0]?.durationMinutesSnapshot ?? totalDurationMinutes,
      sortOrder: 0,
    },
    select: { id: true },
  })

  const addOnItems = normalizedItems.slice(1)
  if (addOnItems.length > 0) {
    await args.tx.bookingServiceItem.createMany({
      data: addOnItems.map((item, index) => ({
        bookingId: createdBooking.id,
        serviceId: item.serviceId,
        offeringId: item.offeringId,
        itemType: BookingServiceItemType.ADD_ON,
        parentItemId: baseItem.id,
        priceSnapshot: item.priceSnapshot,
        durationMinutesSnapshot: item.durationMinutesSnapshot,
        sortOrder: index + 1,
      })),
    })
  }

  const aftercare = await args.tx.aftercareSummary.upsert({
    where: { bookingId: source.id },
    create: {
      bookingId: source.id,
      rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      rebookedFor: requestedStart,
      rebookWindowStart: null,
      rebookWindowEnd: null,
    },
    update: {
      rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      rebookedFor: requestedStart,
      rebookWindowStart: null,
      rebookWindowEnd: null,
    },
    select: {
      id: true,
      rebookMode: true,
      rebookedFor: true,
    },
  })

    await bumpProfessionalScheduleVersion(source.professionalId)

  return {
    booking: {
      id: createdBooking.id,
      status: createdBooking.status,
      scheduledFor: createdBooking.scheduledFor,
    },
    aftercare,
    meta: buildMeta(true),
  }
}

async function performLockedCreateRebookedBookingFromCompletedBooking(args: {
  tx: Prisma.TransactionClient
  now: Date
  bookingId: string
  professionalId: string
  scheduledFor: Date
}): Promise<CreateRebookedBookingFromCompletedBookingResult> {
  return performLockedCreateRebookedBooking({
    tx: args.tx,
    now: args.now,
    bookingId: args.bookingId,
    professionalId: args.professionalId,
    scheduledFor: args.scheduledFor,
    initialStatus: BookingStatus.ACCEPTED,
  })
}

async function performLockedUpdateProBooking(args: {
  tx: Prisma.TransactionClient
  now: Date
  professionalId: string
  bookingId: string
  nextStatus: UpdateRequestedStatus | null
  notifyClient: boolean
  allowOutsideWorkingHours: boolean
  allowShortNotice: boolean
  allowFarFuture: boolean
  nextStart: Date | null
  nextBuffer: number | null
  nextDuration: number | null
  parsedRequestedItems: RequestedServiceItemInput[] | null
  hasBuffer: boolean
  hasDuration: boolean
  hasServiceItems: boolean
  actorUserId: string
  overrideReason: string | null
}): Promise<UpdateProBookingResult> {
    assertNonEmptyUserId(args.actorUserId)

  const normalizedOverrideReason = assertExplicitOverrideReasonIfNeeded({
    allowShortNotice: args.allowShortNotice,
    allowFarFuture: args.allowFarFuture,
    allowOutsideWorkingHours: args.allowOutsideWorkingHours,
    overrideReason: args.overrideReason,
  })

  const existing = await args.tx.booking.findFirst({
    where: { id: args.bookingId, professionalId: args.professionalId },
    select: {
      id: true,
      status: true,
      scheduledFor: true,
      locationType: true,
      bufferMinutes: true,
      totalDurationMinutes: true,
      subtotalSnapshot: true,
      clientId: true,
      locationId: true,
      locationTimeZone: true,
      locationAddressSnapshot: true,
      locationLatSnapshot: true,
      locationLngSnapshot: true,
      professionalId: true,
      professional: {
        select: { timeZone: true },
      },
    },
  })

  if (!existing) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (existing.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED')
  }

  if (existing.status === BookingStatus.COMPLETED) {
    throw bookingError('BOOKING_CANNOT_EDIT_COMPLETED')
  }

  const outputSchedulingContext = await resolveUpdateBookingSchedulingContext({
    bookingLocationTimeZone: existing.locationTimeZone,
    locationId: existing.locationId ?? null,
    professionalId: existing.professionalId,
    professionalTimeZone: existing.professional?.timeZone,
    fallback: 'UTC',
    requireValid: false,
  })

  const existingScheduledFor = normalizeToMinute(new Date(existing.scheduledFor))
  const existingBufferMinutes = Math.max(0, Number(existing.bufferMinutes ?? 0))
  const existingDurationMinutes = durationOrFallback(existing.totalDurationMinutes)

  const existingLocationAddressSnapshot = pickFormattedAddressFromSnapshot(
    existing.locationAddressSnapshot,
  )
  const existingLocationLatSnapshot = decimalToNullableNumber(
    existing.locationLatSnapshot,
  )
  const existingLocationLngSnapshot = decimalToNullableNumber(
    existing.locationLngSnapshot,
  )

  const wantsMutation =
    args.nextStatus != null ||
    args.nextStart != null ||
    args.hasBuffer ||
    args.hasDuration ||
    args.hasServiceItems

  if (!wantsMutation) {
    return buildBookingMutationPayload({
      booking: buildBookingOutput({
        id: existing.id,
        scheduledFor: existingScheduledFor,
        totalDurationMinutes: existingDurationMinutes,
        bufferMinutes: existingBufferMinutes,
        status: existing.status,
        subtotalSnapshot: existing.subtotalSnapshot ?? new Prisma.Decimal(0),
        appointmentTimeZone: outputSchedulingContext.appointmentTimeZone,
        timeZoneSource: outputSchedulingContext.timeZoneSource,
        locationId: existing.locationId ?? null,
        locationType: existing.locationType,
        locationAddressSnapshot: existingLocationAddressSnapshot,
        locationLatSnapshot: existingLocationLatSnapshot,
        locationLngSnapshot: existingLocationLngSnapshot,
      }),
      mutated: false,
    })
  }

  if (args.nextStatus === BookingStatus.CANCELLED) {
    const updated = await args.tx.booking.update({
      where: { id: existing.id },
      data: { status: BookingStatus.CANCELLED },
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        bufferMinutes: true,
        totalDurationMinutes: true,
        subtotalSnapshot: true,
      } satisfies Prisma.BookingSelect,
    })

    if (args.notifyClient) {
      await createUpdateClientNotification({
        tx: args.tx,
        clientId: existing.clientId,
        bookingId: updated.id,
        type: ClientNotificationType.BOOKING_CANCELLED,
        title: 'Appointment cancelled',
        body: 'Your appointment was cancelled.',
        dedupeKey: `BOOKING_CANCELLED:${updated.id}:${new Date(
          updated.scheduledFor,
        ).toISOString()}`,
      })
    }

    await bumpProfessionalScheduleVersion(existing.professionalId)

    return buildBookingMutationPayload({
      booking: buildBookingOutput({
        id: updated.id,
        scheduledFor: new Date(updated.scheduledFor),
        totalDurationMinutes: durationOrFallback(updated.totalDurationMinutes),
        bufferMinutes: Math.max(0, Number(updated.bufferMinutes ?? 0)),
        status: updated.status,
        subtotalSnapshot: updated.subtotalSnapshot ?? new Prisma.Decimal(0),
        appointmentTimeZone: outputSchedulingContext.appointmentTimeZone,
        timeZoneSource: outputSchedulingContext.timeZoneSource,
        locationId: existing.locationId ?? null,
        locationType: existing.locationType,
        locationAddressSnapshot: existingLocationAddressSnapshot,
        locationLatSnapshot: existingLocationLatSnapshot,
        locationLngSnapshot: existingLocationLngSnapshot,
      }),
      mutated: true,
    })
  }

  if (!existing.locationId) {
    throw bookingError('BAD_LOCATION')
  }

  const location = await args.tx.professionalLocation.findFirst({
    where: {
      id: existing.locationId,
      professionalId: existing.professionalId,
      isBookable: true,
    },
    select: {
      id: true,
      type: true,
      timeZone: true,
      workingHours: true,
      stepMinutes: true,
      bufferMinutes: true,
      advanceNoticeMinutes: true,
      maxDaysAhead: true,
    },
  })

  if (!location) {
    throw bookingError('BAD_LOCATION')
  }

  if (
    existing.locationType === ServiceLocationType.MOBILE &&
    location.type !== ProfessionalLocationType.MOBILE_BASE
  ) {
    throw bookingError('BAD_LOCATION_MODE')
  }

  if (
    existing.locationType === ServiceLocationType.SALON &&
    location.type === ProfessionalLocationType.MOBILE_BASE
  ) {
    throw bookingError('BAD_LOCATION_MODE')
  }

  const schedulingContextResult = await resolveAppointmentSchedulingContext({
    bookingLocationTimeZone: existing.locationTimeZone,
    location: { id: location.id, timeZone: location.timeZone },
    professionalId: existing.professionalId,
    professionalTimeZone: existing.professional?.timeZone,
    fallback: 'UTC',
    requireValid: true,
  })

  if (!schedulingContextResult.ok) {
    console.error(
      'updateProBooking invalid appointment timezone',
      {
        route: 'lib/booking/writeBoundary.ts',
        bookingId: existing.id,
        professionalId: existing.professionalId,
        bookingLocationTimeZone: existing.locationTimeZone,
        locationId: location.id,
        locationTimeZone: location.timeZone,
        professionalTimeZone: existing.professional?.timeZone ?? null,
        resolveResult: schedulingContextResult,
      },
    )
    throw bookingError('TIMEZONE_REQUIRED')
  }

  const schedulingContext = {
    ...schedulingContextResult.context,
    appointmentTimeZone: normalizeOutputTimeZone(
      schedulingContextResult.context.appointmentTimeZone,
    ),
  }

  const appointmentTimeZone = schedulingContext.appointmentTimeZone
  const appointmentTimeZoneSource = schedulingContext.timeZoneSource

  const stepMinutes = normalizeStepMinutes(location.stepMinutes, 15)

  if (
    args.nextBuffer != null &&
    (args.nextBuffer < 0 || args.nextBuffer > MAX_BUFFER_MINUTES)
  ) {
    throw bookingError('INVALID_BUFFER_MINUTES')
  }

  if (
    args.nextDuration != null &&
    (args.nextDuration < 15 || args.nextDuration > MAX_SLOT_DURATION_MINUTES)
  ) {
    throw bookingError('INVALID_DURATION_MINUTES')
  }

  const finalStart = args.nextStart
    ? normalizeToMinute(args.nextStart)
    : normalizeToMinute(new Date(existing.scheduledFor))

  if (!Number.isFinite(finalStart.getTime())) {
    throw bookingError('INVALID_SCHEDULED_FOR')
  }

  const finalBuffer =
    args.nextBuffer != null
      ? clampInt(
          snapToStepMinutes(args.nextBuffer, stepMinutes),
          0,
          MAX_BUFFER_MINUTES,
        )
      : existingBufferMinutes

  let normalizedServiceItems:
    | ReturnType<typeof buildNormalizedBookingItemsFromRequestedOfferings>
    | null = null

  if (args.parsedRequestedItems) {
    const offeringIds = Array.from(
      new Set(args.parsedRequestedItems.map((item) => item.offeringId)),
    ).slice(0, 50)

    const offerings = await args.tx.professionalServiceOffering.findMany({
      where: {
        id: { in: offeringIds },
        professionalId: existing.professionalId,
        isActive: true,
      },
      select: {
        id: true,
        serviceId: true,
        offersInSalon: true,
        offersMobile: true,
        salonDurationMinutes: true,
        mobileDurationMinutes: true,
        salonPriceStartingAt: true,
        mobilePriceStartingAt: true,
        service: {
          select: {
            defaultDurationMinutes: true,
          },
        },
      },
      take: 100,
    })

    const offeringById = new Map(
      offerings.map((offering) => [offering.id, offering]),
    )

    normalizedServiceItems =
      buildNormalizedBookingItemsFromRequestedOfferings({
        requestedItems: args.parsedRequestedItems,
        locationType: existing.locationType,
        stepMinutes,
        offeringById,
        badItemsCode: 'INVALID_SERVICE_ITEMS',
      })
  }

  const previewItems =
    normalizedServiceItems?.map((item, index) => ({
      serviceId: item.serviceId,
      offeringId: item.offeringId,
      durationMinutesSnapshot: item.durationMinutesSnapshot,
      priceSnapshot: item.priceSnapshot,
      itemType:
        index === 0
          ? BookingServiceItemType.BASE
          : BookingServiceItemType.ADD_ON,
    })) ??
    (await args.tx.bookingServiceItem.findMany({
      where: { bookingId: existing.id },
      orderBy: { sortOrder: 'asc' },
      select: {
        serviceId: true,
        offeringId: true,
        priceSnapshot: true,
        durationMinutesSnapshot: true,
        itemType: true,
      },
    }))

  const {
    primaryServiceId,
    primaryOfferingId,
    computedDurationMinutes,
    computedSubtotal,
  } = computeBookingItemLikeTotals(previewItems, 'INVALID_SERVICE_ITEMS')

  const snappedNextDuration =
    args.nextDuration != null
      ? clampInt(
          snapToStepMinutes(args.nextDuration, stepMinutes),
          15,
          MAX_SLOT_DURATION_MINUTES,
        )
      : null

  if (
    normalizedServiceItems &&
    snappedNextDuration != null &&
    snappedNextDuration !== computedDurationMinutes
  ) {
    throw bookingError('DURATION_MISMATCH')
  }

    const finalDuration = normalizedServiceItems
    ? computedDurationMinutes
    : snappedNextDuration != null
      ? snappedNextDuration
      : existingDurationMinutes

  const occupancyChanged =
    finalStart.getTime() !== existingScheduledFor.getTime() ||
    finalBuffer !== existingBufferMinutes ||
    finalDuration !== existingDurationMinutes

  const schedulingDecision = await enforceUpdateBookingScheduling({
    tx: args.tx,
    now: args.now,
    finalStart,
    finalDuration,
    finalBuffer,
    workingHours: location.workingHours,
    appointmentTimeZone,
    stepMinutes,
    advanceNoticeMinutes: Math.max(
      0,
      Number(location.advanceNoticeMinutes ?? 0),
    ),
    maxDaysAhead: Math.max(1, Number(location.maxDaysAhead ?? 1)),
    allowShortNotice: args.allowShortNotice,
    allowFarFuture: args.allowFarFuture,
    allowOutsideWorkingHours: args.allowOutsideWorkingHours,
    professionalId: existing.professionalId,
    locationId: location.id,
    locationType: existing.locationType,
    bookingId: existing.id,
    timeZoneSource: appointmentTimeZoneSource,
  })

  if (normalizedServiceItems) {
    await args.tx.bookingServiceItem.deleteMany({
      where: { bookingId: existing.id },
    })

    const baseItem = normalizedServiceItems[0]
    if (!baseItem) {
      throw bookingError('INVALID_SERVICE_ITEMS')
    }

    const createdBaseItem = await args.tx.bookingServiceItem.create({
      data: {
        bookingId: existing.id,
        serviceId: baseItem.serviceId,
        offeringId: baseItem.offeringId,
        itemType: BookingServiceItemType.BASE,
        parentItemId: null,
        priceSnapshot: baseItem.priceSnapshot,
        durationMinutesSnapshot: baseItem.durationMinutesSnapshot,
        sortOrder: 0,
      },
      select: { id: true },
    })

    const addOnItems = normalizedServiceItems.slice(1)

    if (addOnItems.length > 0) {
      await args.tx.bookingServiceItem.createMany({
        data: addOnItems.map((item, index) => ({
          bookingId: existing.id,
          serviceId: item.serviceId,
          offeringId: item.offeringId,
          itemType: BookingServiceItemType.ADD_ON,
          parentItemId: createdBaseItem.id,
          priceSnapshot: item.priceSnapshot,
          durationMinutesSnapshot: item.durationMinutesSnapshot,
          sortOrder: index + 1,
          notes: 'MANUAL_ADDON',
        })),
      })
    }
  }

  const updated = await args.tx.booking.update({
    where: { id: existing.id },
    data: {
      ...(args.nextStatus === BookingStatus.ACCEPTED
        ? { status: BookingStatus.ACCEPTED }
        : {}),
      scheduledFor: finalStart,
      bufferMinutes: finalBuffer,
      totalDurationMinutes: finalDuration,
      subtotalSnapshot: computedSubtotal,
      serviceId: primaryServiceId,
      offeringId: primaryOfferingId,
    },
    select: {
      id: true,
      scheduledFor: true,
      bufferMinutes: true,
      totalDurationMinutes: true,
      status: true,
      subtotalSnapshot: true,
    } satisfies Prisma.BookingSelect,
  })

    if (
  schedulingDecision.appliedOverrides.length > 0 &&
  normalizedOverrideReason
) {
  for (const rule of schedulingDecision.appliedOverrides) {
    await assertCanUseBookingOverride({
      actorUserId: args.actorUserId,
      professionalId: existing.professionalId,
      rule,
    })
  }

  await createBookingOverrideAuditLogs({
    tx: args.tx,
    bookingId: updated.id,
    professionalId: existing.professionalId,
    actorUserId: args.actorUserId,
    action: 'UPDATE',
    route: 'lib/booking/writeBoundary.ts:updateProBooking',
    reason: normalizedOverrideReason,
    appliedOverrides: schedulingDecision.appliedOverrides,
    bookingScheduledForBefore: existingScheduledFor,
    bookingScheduledForAfter: finalStart,
    advanceNoticeMinutes: Math.max(
      0,
      Number(location.advanceNoticeMinutes ?? 0),
    ),
    maxDaysAhead: Math.max(1, Number(location.maxDaysAhead ?? 1)),
    workingHours: location.workingHours,
    timeZone: appointmentTimeZone,
  })
}

  if (args.notifyClient) {
    const isConfirm = args.nextStatus === BookingStatus.ACCEPTED
    const title = isConfirm ? 'Appointment confirmed' : 'Appointment updated'
    const bodyText = isConfirm
      ? 'Your appointment has been confirmed.'
      : 'Your appointment details were updated.'
    const type = isConfirm
      ? ClientNotificationType.BOOKING_CONFIRMED
      : ClientNotificationType.BOOKING_RESCHEDULED

    await createUpdateClientNotification({
      tx: args.tx,
      clientId: existing.clientId,
      bookingId: updated.id,
      type,
      title,
      body: bodyText,
      dedupeKey: `BOOKING_UPDATED:${updated.id}:${finalStart.toISOString()}:${finalDuration}:${finalBuffer}:${String(updated.status)}`,
    })
  }

  if (occupancyChanged) {
    await bumpProfessionalScheduleVersion(existing.professionalId)
  }

  return buildBookingMutationPayload({
    booking: buildBookingOutput({
      id: updated.id,
      scheduledFor: new Date(updated.scheduledFor),
      totalDurationMinutes: Number(updated.totalDurationMinutes),
      bufferMinutes: Math.max(0, Number(updated.bufferMinutes)),
      status: updated.status,
      subtotalSnapshot: updated.subtotalSnapshot ?? computedSubtotal,
      appointmentTimeZone,
      timeZoneSource: appointmentTimeZoneSource,
      locationId: existing.locationId ?? null,
      locationType: existing.locationType,
      locationAddressSnapshot: existingLocationAddressSnapshot,
      locationLatSnapshot: existingLocationLatSnapshot,
      locationLngSnapshot: existingLocationLngSnapshot,
    }),
    mutated: true,
  })
}

async function performLockedUpsertBookingAftercare(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  professionalId: string
  notes: string | null
  rebookMode: AftercareRebookMode
  rebookedFor: Date | null
  rebookWindowStart: Date | null
  rebookWindowEnd: Date | null
  createRebookReminder: boolean
  rebookReminderDaysBefore: number
  createProductReminder: boolean
  productReminderDaysAfter: number
  recommendedProducts: {
    name: string
    url: string
    note: string | null
  }[]
  sendToClient: boolean
}): Promise<UpsertBookingAftercareResult> {
  const booking: AftercareUpsertBookingRecord | null =
    await args.tx.booking.findUnique({
      where: { id: args.bookingId },
      select: AFTERCARE_UPSERT_BOOKING_SELECT,
    })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.professionalId !== args.professionalId) {
    throw bookingError('FORBIDDEN')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED', {
      message: 'This booking is cancelled.',
      userMessage: 'This booking is cancelled.',
    })
  }

  if (booking.status === BookingStatus.PENDING) {
    throw bookingError('FORBIDDEN', {
      message: 'Aftercare can’t be posted until the booking is confirmed.',
      userMessage: 'Aftercare can’t be posted until the booking is confirmed.',
    })
  }

  if (!isAftercareSessionStepEligible(booking.sessionStep)) {
    throw bookingError('FORBIDDEN', {
      message: `Aftercare isn’t available yet. Current step: ${booking.sessionStep ?? 'NONE'}.`,
      userMessage: `Aftercare isn’t available yet. Current step: ${booking.sessionStep ?? 'NONE'}.`,
    })
  }

  const timeZoneUsed = resolveAftercareTimeZone({
    bookingLocationTimeZone: booking.locationTimeZone,
    professionalTimeZone: booking.professional?.timeZone,
  })

  const tokenToUse = booking.aftercareSummary?.publicToken ?? newPublicToken()

  const aftercare = await args.tx.aftercareSummary.upsert({
    where: { bookingId: booking.id },
    create: {
      bookingId: booking.id,
      publicToken: tokenToUse,
      notes: args.notes,
      rebookMode: args.rebookMode,
      rebookedFor: args.rebookedFor,
      rebookWindowStart: args.rebookWindowStart,
      rebookWindowEnd: args.rebookWindowEnd,
    },
    update: {
      publicToken: tokenToUse,
      notes: args.notes,
      rebookMode: args.rebookMode,
      rebookedFor: args.rebookedFor,
      rebookWindowStart: args.rebookWindowStart,
      rebookWindowEnd: args.rebookWindowEnd,
    },
    select: {
      id: true,
      publicToken: true,
      rebookMode: true,
      rebookedFor: true,
      rebookWindowStart: true,
      rebookWindowEnd: true,
    },
  })

  await args.tx.productRecommendation.deleteMany({
    where: { aftercareSummaryId: aftercare.id },
  })

  if (args.recommendedProducts.length > 0) {
    await args.tx.productRecommendation.createMany({
      data: args.recommendedProducts.map((product) => ({
        aftercareSummaryId: aftercare.id,
        productId: null,
        externalName: product.name,
        externalUrl: product.url,
        note: product.note,
      })),
    })
  }

  let clientNotified = false

  if (args.sendToClient) {
    const notifKey = makeAftercareClientNotifDedupeKey(booking.id)
    const notifTitle = `Aftercare: ${booking.service?.name ?? 'Your appointment'}`
    const bodyPreview =
      (args.notes ?? '').trim().length > 0
        ? (args.notes ?? '').trim().slice(0, 240)
        : null

    await args.tx.clientNotification.upsert({
      where: { dedupeKey: notifKey },
      create: {
        dedupeKey: notifKey,
        clientId: booking.clientId,
        type: ClientNotificationType.AFTERCARE,
        title: notifTitle,
        body: bodyPreview,
        bookingId: booking.id,
        aftercareId: aftercare.id,
        readAt: null,
      },
      update: {
        type: ClientNotificationType.AFTERCARE,
        title: notifTitle,
        body: bodyPreview,
        bookingId: booking.id,
        aftercareId: aftercare.id,
        readAt: null,
      },
    })

    clientNotified = true
  }

  let remindersTouched = 0

  const clientName =
    `${(booking.client?.firstName ?? '').trim()} ${(booking.client?.lastName ?? '').trim()}`.trim()
  const serviceName = (booking.service?.name ?? 'service').trim()

  const rebookKey = makeAftercareReminderDedupeKey(booking.id, 'REBOOK')
  const rebookDue = computeRebookReminderDueAt({
    mode: args.rebookMode,
    rebookedFor: args.rebookedFor,
    windowStart: args.rebookWindowStart,
    daysBefore: args.rebookReminderDaysBefore,
  })

  if (
    args.createRebookReminder &&
    rebookDue &&
    args.rebookMode !== AftercareRebookMode.NONE
  ) {
    const title = clientName ? `Rebook: ${clientName}` : 'Rebook reminder'

    const bodyText =
      args.rebookMode === AftercareRebookMode.RECOMMENDED_WINDOW &&
      args.rebookWindowStart &&
      args.rebookWindowEnd
        ? `Recommended booking window for ${serviceName}: ${formatDateTimeInTimeZone(
            args.rebookWindowStart,
            timeZoneUsed,
          )} → ${formatDateTimeInTimeZone(args.rebookWindowEnd, timeZoneUsed)} (${timeZoneUsed})`
        : args.rebookedFor
          ? `Recommended next visit for ${serviceName}: ${formatDateTimeInTimeZone(
              args.rebookedFor,
              timeZoneUsed,
            )} (${timeZoneUsed})`
          : `Follow up for ${serviceName}.`

    await args.tx.reminder.upsert({
      where: { dedupeKey: rebookKey },
      create: {
        dedupeKey: rebookKey,
        professionalId: booking.professionalId,
        clientId: booking.clientId,
        bookingId: booking.id,
        type: ReminderType.REBOOK,
        title,
        body: bodyText,
        dueAt: rebookDue,
      },
      update: {
        title,
        body: bodyText,
        dueAt: rebookDue,
        completedAt: null,
      },
    })

    remindersTouched += 1
  } else {
    const del = await args.tx.reminder.deleteMany({
      where: { dedupeKey: rebookKey, completedAt: null },
    })
    remindersTouched += del.count
  }

  const productKey = makeAftercareReminderDedupeKey(
    booking.id,
    'PRODUCT_FOLLOWUP',
  )

  if (args.createProductReminder) {
    const base = booking.finishedAt ?? booking.scheduledFor ?? new Date()
    const due = addDaysByMs(base, args.productReminderDaysAfter)

    if (due) {
      const title = clientName
        ? `Product follow-up: ${clientName}`
        : 'Product follow-up'

      const bodyText = `Follow up on products after ${serviceName}. Due: ${formatDateTimeInTimeZone(
        due,
        timeZoneUsed,
      )} (${timeZoneUsed})`

      await args.tx.reminder.upsert({
        where: { dedupeKey: productKey },
        create: {
          dedupeKey: productKey,
          professionalId: booking.professionalId,
          clientId: booking.clientId,
          bookingId: booking.id,
          type: ReminderType.PRODUCT_FOLLOWUP,
          title,
          body: bodyText,
          dueAt: due,
        },
        update: {
          title,
          body: bodyText,
          dueAt: due,
          completedAt: null,
        },
      })

      remindersTouched += 1
    }
  } else {
    const del = await args.tx.reminder.deleteMany({
      where: { dedupeKey: productKey, completedAt: null },
    })
    remindersTouched += del.count
  }

  let bookingFinished = false
  let bookingNow: {
    status: BookingStatus
    sessionStep: SessionStep
    finishedAt: Date | null
  } | null = null

  if (args.sendToClient) {
    const now = new Date()

    const updatedBooking = await args.tx.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.COMPLETED,
        sessionStep: SessionStep.DONE,
        finishedAt: booking.finishedAt ?? now,
      },
      select: {
        status: true,
        sessionStep: true,
        finishedAt: true,
      } satisfies Prisma.BookingSelect,
    })

    bookingNow = {
      status: updatedBooking.status,
      sessionStep: updatedBooking.sessionStep ?? SessionStep.NONE,
      finishedAt: updatedBooking.finishedAt,
    }

    bookingFinished = true
  }

  return {
    aftercare: {
      id: aftercare.id,
      publicToken: aftercare.publicToken,
      rebookMode: aftercare.rebookMode,
      rebookedFor: aftercare.rebookedFor,
      rebookWindowStart: aftercare.rebookWindowStart,
      rebookWindowEnd: aftercare.rebookWindowEnd,
    },
    remindersTouched,
    clientNotified,
    bookingFinished,
    booking: bookingNow,
    timeZoneUsed,
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

export async function startBookingSession(
  args: StartBookingSessionArgs,
): Promise<StartBookingSessionResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) =>
      performLockedStartBookingSession({
        tx,
        now,
        bookingId: args.bookingId,
        professionalId: args.professionalId,
      }),
  )
}

export async function finishBookingSession(
  args: FinishBookingSessionArgs,
): Promise<FinishBookingSessionResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx }) =>
      performLockedFinishBookingSession({
        tx,
        bookingId: args.bookingId,
        professionalId: args.professionalId,
      }),
  )
}

export async function transitionSessionStepInTransaction(
  tx: Prisma.TransactionClient,
  args: TransitionSessionStepArgs,
): Promise<TransitionSessionStepResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)

  return performLockedTransitionSessionStep({
    tx,
    bookingId: args.bookingId,
    professionalId: args.professionalId,
    nextStep: args.nextStep,
  })
}

export async function approveConsultationAndMaterializeBooking(args: {
  bookingId: string
  clientId: string
  professionalId: string
}): Promise<ApproveConsultationMaterializationResult> {
  return withLockedClientOwnedBookingTransaction({
    bookingId: args.bookingId,
    clientId: args.clientId,
    run: async ({ tx, now }) =>
      performLockedApproveConsultationMaterialization({
        tx,
        bookingId: args.bookingId,
        clientId: args.clientId,
        professionalId: args.professionalId,
        now,
      }),
  })
}

export async function transitionSessionStep(
  args: TransitionSessionStepArgs,
): Promise<TransitionSessionStepResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx }) =>
      performLockedTransitionSessionStep({
        tx,
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        nextStep: args.nextStep,
      }),
  )
}

export async function uploadProBookingMedia(
  args: UploadProBookingMediaArgs,
): Promise<UploadProBookingMediaResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)
  assertNonEmptyUserId(args.uploadedByUserId)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx }) =>
      performLockedUploadProBookingMedia({
        tx,
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        uploadedByUserId: args.uploadedByUserId,
        storageBucket: args.storageBucket,
        storagePath: args.storagePath,
        thumbBucket: args.thumbBucket,
        thumbPath: args.thumbPath,
        caption: args.caption,
        phase: args.phase,
        mediaType: args.mediaType,
      }),
  )
}

export async function markBookingRemindersSent(
  args: MarkBookingRemindersSentArgs,
): Promise<MarkBookingRemindersSentResult> {
  const bookingIds = Array.from(
    new Set(args.bookingIds.map((id) => id.trim()).filter(Boolean)),
  )

  if (bookingIds.length === 0) {
    return {
      count: 0,
      meta: buildMeta(false),
    }
  }

  const result = await prisma.booking.updateMany({
    where: { id: { in: bookingIds } },
    data: {
      reminderSentAt: args.sentAt ?? new Date(),
    },
  })

  return {
    count: result.count,
    meta: buildMeta(result.count > 0),
  }
}

export async function upsertBookingAftercare(
  args: UpsertBookingAftercareArgs,
): Promise<UpsertBookingAftercareResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx }) =>
      performLockedUpsertBookingAftercare({
        tx,
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        notes: args.notes,
        rebookMode: args.rebookMode,
        rebookedFor: args.rebookedFor,
        rebookWindowStart: args.rebookWindowStart,
        rebookWindowEnd: args.rebookWindowEnd,
        createRebookReminder: args.createRebookReminder,
        rebookReminderDaysBefore: args.rebookReminderDaysBefore,
        createProductReminder: args.createProductReminder,
        productReminderDaysAfter: args.productReminderDaysAfter,
        recommendedProducts: args.recommendedProducts,
        sendToClient: args.sendToClient,
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

export async function updateBookingLastMinuteDiscount(
  args: UpdateBookingLastMinuteDiscountArgs,
): Promise<UpdateBookingLastMinuteDiscountResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)

  const booking = await prisma.booking.findUnique({
    where: { id: args.bookingId },
    select: {
      id: true,
      professionalId: true,
    } satisfies Prisma.BookingSelect,
  })

  if (!booking || booking.professionalId !== args.professionalId) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      discountAmount: args.discountAmount,
    },
    select: { id: true } satisfies Prisma.BookingSelect,
  })

  return {
    bookingId: booking.id,
    meta: buildMeta(true),
  }
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

      await bumpProfessionalScheduleVersion(hold.professionalId)

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
  assertNonEmptyUserId(args.actorUserId)
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
        actorUserId: args.actorUserId,
        overrideReason: args.overrideReason,
      }),
  )
}

export async function updateProBooking(
  args: UpdateProBookingArgs,
): Promise<UpdateProBookingResult> {
  assertNonEmptyProfessionalId(args.professionalId)
  assertNonEmptyUserId(args.actorUserId)
  assertNonEmptyBookingId(args.bookingId)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) =>
      performLockedUpdateProBooking({
        tx,
        now,
        professionalId: args.professionalId,
        bookingId: args.bookingId,
        nextStatus: args.nextStatus,
        notifyClient: args.notifyClient,
        allowOutsideWorkingHours: args.allowOutsideWorkingHours,
        allowShortNotice: args.allowShortNotice,
        allowFarFuture: args.allowFarFuture,
        nextStart: args.nextStart,
        nextBuffer: args.nextBuffer,
        nextDuration: args.nextDuration,
        parsedRequestedItems: args.parsedRequestedItems,
        hasBuffer: args.hasBuffer,
        hasDuration: args.hasDuration,
        hasServiceItems: args.hasServiceItems,
        actorUserId: args.actorUserId,
        overrideReason: args.overrideReason,
      }),
  )
}

export async function createRebookedBookingFromCompletedBooking(
  args: CreateRebookedBookingFromCompletedBookingArgs,
): Promise<CreateRebookedBookingFromCompletedBookingResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)
  assertValidRequestedStart(args.scheduledFor)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) =>
      performLockedCreateRebookedBookingFromCompletedBooking({
        tx,
        now,
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        scheduledFor: args.scheduledFor,
      }),
  )
}
export async function createClientRebookedBookingFromAftercare(
  args: CreateClientRebookedBookingFromAftercareArgs,
): Promise<CreateClientRebookedBookingFromAftercareResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyClientId(args.clientId)
  assertValidRequestedStart(args.scheduledFor)

  return prisma.$transaction(async (tx) => {
    const aftercareRef: AftercareRebookLockRecord | null =
      await tx.aftercareSummary.findUnique({
        where: { id: args.aftercareId },
        select: AFTERCARE_REBOOK_LOCK_SELECT,
      })

    if (!aftercareRef || !aftercareRef.booking) {
      throw bookingError('BOOKING_NOT_FOUND')
    }

    if (
      aftercareRef.bookingId !== args.bookingId ||
      aftercareRef.booking.id !== args.bookingId
    ) {
      throw bookingError('BOOKING_NOT_FOUND')
    }

    if (aftercareRef.booking.clientId !== args.clientId) {
      throw bookingError('FORBIDDEN')
    }

    await lockProfessionalSchedule(tx, aftercareRef.booking.professionalId)

    const lockedAftercareRef: AftercareRebookLockRecord | null =
      await tx.aftercareSummary.findUnique({
        where: { id: args.aftercareId },
        select: AFTERCARE_REBOOK_LOCK_SELECT,
      })

    if (!lockedAftercareRef || !lockedAftercareRef.booking) {
      throw bookingError('BOOKING_NOT_FOUND')
    }

    if (
      lockedAftercareRef.bookingId !== args.bookingId ||
      lockedAftercareRef.booking.id !== args.bookingId
    ) {
      throw bookingError('BOOKING_NOT_FOUND')
    }

    if (lockedAftercareRef.booking.clientId !== args.clientId) {
      throw bookingError('FORBIDDEN')
    }

    return performLockedCreateRebookedBooking({
      tx,
      now: new Date(),
      bookingId: lockedAftercareRef.booking.id,
      professionalId: lockedAftercareRef.booking.professionalId,
      scheduledFor: args.scheduledFor,
      initialStatus: BookingStatus.PENDING,
    })
  })
}