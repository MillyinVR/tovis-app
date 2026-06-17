// lib/booking/writeBoundary.ts
import {
  AftercareRebookMode,
  BookingCheckoutStatus,
  BookingCloseoutAuditAction,
  BookingOverrideAction,
  BookingOverrideRule,
  BookingServiceItemType,
  BookingSource,
  BookingStatus,
  ClientAddressKind,
  ConsultationApprovalProofMethod,
  ConsultationApprovalStatus,
  ConsultationDecision,
  ContactMethod,
  LastMinuteOfferType,
  LastMinuteRecipientStatus,
  MediaPhase,
  MediaType,
  MediaVisibility,
  NotificationEventKey,
  NotificationPriority,
  OpeningStatus,
  PaymentMethod,
  PaymentProvider,
  Prisma,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  SessionStep,
  StripeCheckoutSessionStatus,
  StripePaymentStatus,
  ReminderType,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { computeLastMinuteDiscount } from '@/lib/lastMinutePricing'
import { parseMoney } from '@/lib/money'
import {
  pickPublicTierPlan,
  pickRecipientTierPlan,
} from '@/lib/lastMinute/pickTierPlan'
import {
  resolveBookingTenantAttribution,
  resolveProTenantId,
} from '@/lib/tenant/bookingAttribution'
import { upper } from '@/lib/booking/guards'
import { lockProfessionalSchedule } from '@/lib/booking/scheduleLock'
import {
  pickOfferingModeRamp,
  resolveChargedUnitPrice,
} from '@/lib/booking/rampedUnitPrice'
import { snapStartToWorkingWindowStep } from '@/lib/booking/slotReadiness'
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
import { safeError, safeLogMeta } from '@/lib/security/logging'
import { buildMediaAssetCreateData } from '@/lib/media/recordMediaAsset'
import { createAftercareAccessDelivery } from '@/lib/clientActions/createAftercareAccessDelivery'
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
import {
  bumpScheduleConfigVersion,
  bumpScheduleVersion,
} from '@/lib/booking/cacheVersion'
import {
  deleteActiveHoldsForClient,
  deleteExpiredHoldsForProfessional,
} from '@/lib/booking/holdCleanup'
import {
  type RequestedServiceItemInput,
  buildNormalizedBookingItemsFromRequestedOfferings,
  computeBookingItemLikeTotals,
  snapToStepMinutes,
} from '@/lib/booking/serviceItems'
import { getProCreatedBookingStatus } from '@/lib/booking/statusRules'
import { moneyToFixed2String } from '@/lib/money'
import {
  resolveAppointmentSchedulingContext,
  type AppointmentSchedulingContext,
  type TimeZoneTruthSource,
} from '@/lib/booking/timeZoneTruth'
import { buildBookingOverrideAuditRows } from '@/lib/booking/overrideAudit'
import { assertCanUseBookingOverride } from '@/lib/booking/overrideAuthorization'
import {
  areAuditValuesEqual,
  createBookingCloseoutAuditLog,
} from '@/lib/booking/closeoutAudit'
import { upsertClientNotification } from '@/lib/notifications/clientNotifications'
import {
  cancelBookingAppointmentReminders,
  syncBookingAppointmentReminders,
} from '@/lib/notifications/appointmentReminders'
import { createProNotification } from '@/lib/notifications/proNotifications'
import {
  consumeConsultationActionToken,
  revokeConsultationActionTokensForBooking,
} from '@/lib/consultation/clientActionTokens'
import {
  buildConsultationApprovalProofSnapshot,
  createConsultationApprovalProof,
} from '@/lib/consultation/consultationConfirmationProof'
import {
  recordStatusTransition,
  recordStepTransition,
} from '@/lib/booking/lifecycleContract'
import {
  checkProReadinessForEntryPointWithDb,
  type ProBookingEntryPoint,
} from '@/lib/pro/readiness/proReadiness'
import {
  decideBookingOverlapPermission,
  type BookingOverlapActor,
  type BookingOverlapSource,
  type BookingWindow,
} from '@/lib/booking/overlapPolicy'
import { findSchedulingConflicts } from '@/lib/booking/schedulingConflicts'
import { resolveAftercarePreselectedSlot } from '@/lib/booking/aftercarePreselectedSlot'
import { validateAftercareRebookSlotOwnership } from '@/lib/booking/aftercareRebookSlotOwnership'
import {
  isCheckoutCloseoutComplete,
  isCloseoutPaymentAndAftercareComplete,
} from '@/lib/booking/closeoutState'
// Side-effect import: registers the Sentry sink for lifecycle drift events.
// Must come after recordStepTransition import so the contract module loads first.
import '@/lib/observability/bookingEvents'
import {
  ADDRESS_KEY_VERSION,
  buildAddressPrivacyWriteData,
  isAddressPrivacyEnvelopeV1 as isReusableAddressPrivacyEnvelope,
} from '@/lib/security/addressEncryption'


type MutationMeta = {
  mutated: boolean
  noOp: boolean
}

type AftercarePublicAccessSummary = {
  accessMode: 'SECURE_LINK' | 'NONE'
  hasPublicAccess: boolean
  clientAftercareHref: string | null
}

type AftercareAccessDeliverySummary = {
  attempted: boolean
  queued: boolean
  href: string | null
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

type ConsultationDecisionProvenance =
  | {
      method: 'REMOTE_SECURE_LINK'
      recordedByUserId: null
      clientActionTokenId: string | null
      contactMethod: ContactMethod | null
      destinationSnapshot: string | null
      ipAddress: string | null
      userAgent: string | null
    }
  | {
      method: 'IN_PERSON_PRO_DEVICE'
      recordedByUserId: string
      clientActionTokenId: null
      contactMethod: null
      destinationSnapshot: null
      ipAddress: null
      userAgent: string | null
    }

type ApproveConsultationMaterializationArgs = {
  tx: Prisma.TransactionClient
  bookingId: string
  clientId: string
  professionalId: string
  now: Date
  provenance: ConsultationDecisionProvenance
  requestId?: string | null
  idempotencyKey?: string | null
}

type ConsultationProofResult = {
  id: string
  decision: ConsultationDecision
  method: ConsultationApprovalProofMethod
  actedAt: Date
  recordedByUserId: string | null
  clientActionTokenId: string | null
  contactMethod: ContactMethod | null
  destinationSnapshot: string | null
}

type ApproveConsultationMaterializationResult = {
  booking: {
    id: string
    serviceId: string | null
    offeringId: string | null
    subtotalSnapshot: Prisma.Decimal | null
    totalDurationMinutes: number
    consultationConfirmedAt: Date | null
    sessionStep: SessionStep
  }
  approval: {
    id: string
    status: ConsultationApprovalStatus
    approvedAt: Date | null
    rejectedAt: Date | null
  }
  proof: ConsultationProofResult
  meta: MutationMeta
}

type ApproveConsultationByClientActionTokenArgs = {
  rawToken: string
  requestId?: string | null
  idempotencyKey?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

type RejectConsultationByClientActionTokenArgs = {
  rawToken: string
  requestId?: string | null
  idempotencyKey?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

type RejectConsultationResult = {
  approval: {
    id: string
    status: ConsultationApprovalStatus
    approvedAt: Date | null
    rejectedAt: Date | null
  }
  proof: ConsultationProofResult
  meta: MutationMeta
}

type RecordInPersonConsultationDecisionArgs = {
  bookingId: string
  professionalId: string
  recordedByUserId: string
  decision: ConsultationDecision
  requestId?: string | null
  idempotencyKey?: string | null
  userAgent?: string | null
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
  bookingEntryPoint: ProBookingEntryPoint
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
  bookingEntryPoint: ProBookingEntryPoint
  holdId: string
  aftercareClientActionTokenId?: string | null
  openingId: string | null
  addOnIds: string[]
  locationType: ServiceLocationType
  source: BookingSource
  initialStatus: BookingStatus
  rebookOfBookingId: string | null
  fallbackTimeZone?: string
  requestId?: string | null
  idempotencyKey?: string | null
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
    // Catalog minimum + price-grace ramps, loaded by the route. Absent → no ramp.
    serviceMinPrice?: Prisma.Decimal | null
    priceRamps?: Array<{
      mode: ServiceLocationType
      currentPrice: Prisma.Decimal
      targetPrice: Prisma.Decimal
      startedAt: Date
    }>
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
  requestId?: string | null
  idempotencyKey?: string | null
  // Calendar-migration import: source = IMPORTED, price snapshotted at 0
  // (excluded from revenue until edited), and client notifications/reminders
  // suppressed (the migrated client has no account yet). Overlap is already
  // permitted for PRO actors. Defaults to a normal pro booking.
  importMode?: boolean
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
  requestId?: string | null
  idempotencyKey?: string | null
  explicitSelection?: boolean
  actorUserId?: string | null
}

type FinishBookingSessionArgs = {
  bookingId: string
  professionalId: string
  requestId?: string | null
  idempotencyKey?: string | null
}

type ConfirmBookingFinalReviewArgs = {
  bookingId: string
  professionalId: string
  finalLineItems: ConfirmBookingFinalReviewLineItemInput[]
  expectedSubtotal?: Prisma.Decimal | string | number | null
  recommendedProducts?: RecommendedProductInput[]
  rebookMode?: AftercareRebookMode | null
  rebookedFor?: Date | null
  rebookWindowStart?: Date | null
  rebookWindowEnd?: Date | null
  requestId?: string | null
  idempotencyKey?: string | null
}

type TransitionSessionStepArgs = {
  bookingId: string
  professionalId: string
  nextStep: SessionStep
  requestId?: string | null
  idempotencyKey?: string | null
}

type UpdateBookingCheckoutArgs = {
  bookingId: string
  professionalId: string
  tipAmount?: Prisma.Decimal | string | number | null
  taxAmount?: Prisma.Decimal | string | number | null
  discountAmount?: Prisma.Decimal | string | number | null
  selectedPaymentMethod?: PaymentMethod | null
  checkoutStatus?: BookingCheckoutStatus | null
  markPaymentAuthorized?: boolean
  markPaymentCollected?: boolean
  requestId?: string | null
  idempotencyKey?: string | null
}

type MarkProBookingCheckoutPaidArgs = {
  bookingId: string
  professionalId: string
  actorUserId: string
  requestId?: string | null
  idempotencyKey?: string | null
}

type WaiveProBookingCheckoutArgs = {
  bookingId: string
  professionalId: string
  actorUserId: string
  requestId: string | null
  idempotencyKey: string
  reason?: string | null
}

type UpdateClientBookingCheckoutArgs = {
  bookingId: string
  clientId: string
  tipAmount?: Prisma.Decimal | string | number | null
  selectedPaymentMethod?: PaymentMethod | null
  checkoutStatus?: BookingCheckoutStatus | null
  markPaymentAuthorized?: boolean
  markPaymentCollected?: boolean
  requestId?: string | null
  idempotencyKey?: string | null
}

type UpsertClientBookingCheckoutProductsArgs = {
  bookingId: string
  clientId: string
  items: ClientCheckoutProductSelectionInput[]
  requestId?: string | null
  idempotencyKey?: string | null
}

type PrepareClientStripeCheckoutSessionArgs = {
  bookingId: string
  clientId: string
  tipAmount?: Prisma.Decimal | string | number | null
  requestId?: string | null
  idempotencyKey?: string | null
}

type PrepareClientStripeCheckoutSessionResult = {
  booking: {
    id: string
    professionalId: string
    serviceSubtotalSnapshot: Prisma.Decimal | null
    productSubtotalSnapshot: Prisma.Decimal | null
    subtotalSnapshot: Prisma.Decimal | null
    tipAmount: Prisma.Decimal | null
    taxAmount: Prisma.Decimal | null
    discountAmount: Prisma.Decimal | null
    totalAmount: Prisma.Decimal | null
    checkoutStatus: BookingCheckoutStatus
    selectedPaymentMethod: PaymentMethod | null
    paymentProvider: PaymentProvider
  }
  stripe: {
    amountCents: number
    currency: string
    lineItemDescription: string
    connectedAccountId: string
  }
  meta: MutationMeta
}

type RecordStripeCheckoutSessionAttachedArgs = {
  bookingId: string
  clientId: string
  stripeCheckoutSessionId: string
  stripePaymentIntentId: string | null
  stripeConnectedAccountId: string
  stripeAmountSubtotal: number | null
  stripeAmountTotal: number | null
  stripeCurrency: string
  requestId?: string | null
  idempotencyKey?: string | null
}

type RecordStripeCheckoutSessionAttachedResult = {
  booking: {
    id: string
    checkoutStatus: BookingCheckoutStatus
    selectedPaymentMethod: PaymentMethod | null
    paymentProvider: PaymentProvider
    stripeCheckoutSessionId: string | null
    stripePaymentIntentId: string | null
    stripeCheckoutSessionStatus: StripeCheckoutSessionStatus | null
    stripePaymentStatus: StripePaymentStatus | null
    stripeAmountSubtotal: number | null
    stripeAmountTotal: number | null
    stripeCurrency: string | null
  }
  meta: MutationMeta
}

type ApplyStripePaymentSucceededArgs = {
  stripePaymentIntentId: string
  stripeEventId: string
  amountReceivedCents: number | null
  currency: string | null
  bookingIdHint?: string | null
  occurredAt?: Date
}

type ApplyStripePaymentResult = {
  bookingId: string
  bookingCompleted: boolean
  meta: MutationMeta
}

type ApplyStripePaymentFailedArgs = {
  stripePaymentIntentId: string
  stripeEventId: string
  bookingIdHint?: string | null
}

type ApplyStripeCheckoutSessionStatusArgs = {
  stripeCheckoutSessionId: string
  stripePaymentIntentId: string | null
  stripeAmountSubtotal: number | null
  stripeAmountTotal: number | null
  stripeCurrency: string | null
  status: StripeCheckoutSessionStatus
  bookingIdHint?: string | null
}

type CreateRebookedBookingFromCompletedBookingArgs = {
  bookingId: string
  professionalId: string
  scheduledFor: Date
  requestId?: string | null
  idempotencyKey?: string | null
}

type CreateClientRebookedBookingFromAftercareArgs = {
  aftercareId: string
  bookingId: string
  clientId: string
  aftercareClientActionTokenId: string
  scheduledFor: Date
  requestId?: string | null
  idempotencyKey?: string | null
}

type PerformLockedCreateRebookedBookingArgs = {
  tx: Prisma.TransactionClient
  now: Date
  bookingId: string
  professionalId: string
  scheduledFor: Date
  initialStatus: BookingStatus
  clientId?: string | null
  aftercareId?: string | null
  aftercareClientActionTokenId?: string | null
  requestId?: string | null
  idempotencyKey?: string | null
}

type UpsertBookingAftercareArgs = {
  bookingId: string
  professionalId: string
  actorUserId: string
  notes: string | null
  rebookMode: AftercareRebookMode
  rebookedFor: Date | null
  rebookWindowStart: Date | null
  rebookWindowEnd: Date | null
  rebookSlot: {
    offeringId: string | null
    locationId: string
    locationType: ServiceLocationType
    startsAt: Date
    endsAt: Date
  } | null
  createRebookReminder: boolean
  rebookReminderDaysBefore: number
  createProductReminder: boolean
  productReminderDaysAfter: number
  recommendedProducts: RecommendedProductInput[]
  sendToClient: boolean
  version: number | null
  requestId?: string | null
  idempotencyKey?: string | null
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

type ConfirmBookingFinalReviewLineItemInput = {
  bookingServiceItemId?: string | null
  serviceId: string
  offeringId: string | null
  itemType: BookingServiceItemType
  price: Prisma.Decimal | string | number
  durationMinutes: number
  notes?: string | null
  sortOrder: number
}

type RecommendedProductInput =
  | {
      productId: string
      externalName: null
      externalUrl: null
      note: string | null
    }
  | {
      productId: null
      externalName: string
      externalUrl: string
      note: string | null
    }
    

type ConfirmBookingFinalReviewResult = {
  booking: {
    id: string
    status: BookingStatus
    sessionStep: SessionStep
    serviceId: string | null
    offeringId: string | null
    subtotalSnapshot: Prisma.Decimal | null
    totalDurationMinutes: number
  }
  meta: MutationMeta
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
  requestId?: string | null
  idempotencyKey?: string | null
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


type UpdateBookingLastMinuteDiscountArgs = {
  bookingId: string
  professionalId: string
  discountAmount: Prisma.Decimal
}

type UpdateBookingLastMinuteDiscountResult = {
  bookingId: string
  meta: MutationMeta
}


type UpdateBookingCheckoutResult = {
  booking: {
    id: string
    checkoutStatus: BookingCheckoutStatus
    selectedPaymentMethod: PaymentMethod | null
    serviceSubtotalSnapshot: Prisma.Decimal | null
    productSubtotalSnapshot: Prisma.Decimal | null
    subtotalSnapshot: Prisma.Decimal | null
    tipAmount: Prisma.Decimal | null
    taxAmount: Prisma.Decimal | null
    discountAmount: Prisma.Decimal | null
    totalAmount: Prisma.Decimal | null
    paymentAuthorizedAt: Date | null
    paymentCollectedAt: Date | null
  }
  meta: MutationMeta
}

type ProCheckoutCloseoutResult = {
  booking: {
    id: string
    status: BookingStatus
    sessionStep: SessionStep
    checkoutStatus: BookingCheckoutStatus
    paymentCollectedAt: Date | null
  }
  meta: MutationMeta & {
    completedBooking: boolean
  }
}

type ClientCheckoutProductSelectionInput = {
  recommendationId: string
  productId: string
  quantity: number
}

type AssertClientBookingReviewEligibilityArgs = {
  bookingId: string
  clientId: string
}

type AssertClientBookingReviewEligibilityResult = {
  booking: {
    id: string
    professionalId: string
    status: BookingStatus
    finishedAt: Date | null
    checkoutStatus: BookingCheckoutStatus
    paymentCollectedAt: Date | null
    aftercareSentAt: Date | null
  }
  meta: MutationMeta
}


type UpsertClientBookingCheckoutProductsResult = {
  booking: {
    id: string
    checkoutStatus: BookingCheckoutStatus
    serviceSubtotalSnapshot: Prisma.Decimal | null
    productSubtotalSnapshot: Prisma.Decimal | null
    subtotalSnapshot: Prisma.Decimal | null
    tipAmount: Prisma.Decimal | null
    taxAmount: Prisma.Decimal | null
    discountAmount: Prisma.Decimal | null
    totalAmount: Prisma.Decimal | null
    paymentAuthorizedAt: Date | null
    paymentCollectedAt: Date | null
  }
  selectedProducts: {
    recommendationId: string
    productId: string
    quantity: number
    unitPrice: Prisma.Decimal
    lineTotal: Prisma.Decimal
  }[]
  meta: MutationMeta
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


type CreateClientRebookedBookingFromAftercareResult =
  CreateRebookedBookingFromCompletedBookingResult

type UpsertBookingAftercareResult = {
  aftercare: {
    id: string
    publicAccess: AftercarePublicAccessSummary
    rebookMode: AftercareRebookMode
    rebookedFor: Date | null
    rebookWindowStart: Date | null
    rebookWindowEnd: Date | null
    draftSavedAt: Date | null
    sentToClientAt: Date | null
    lastEditedAt: Date | null
    version: number
  }
  remindersTouched: number
  clientNotified: boolean
  aftercareAccessDelivery: AftercareAccessDeliverySummary
  bookingFinished: boolean
  /** Populated when sendToClient=true but booking could not be completed. */
  completionBlockers: string[]
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
  requestId?: string | null
  idempotencyKey?: string | null
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
  clientId: true,
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
  serviceId: true,
  offeringId: true,
  scheduledFor: true,
  subtotalSnapshot: true,
  totalDurationMinutes: true,
  consultationConfirmedAt: true,
  sessionStep: true,
  consultationApproval: {
    select: {
      id: true,
      status: true,
      proposedServicesJson: true,
      proposedTotal: true,
      notes: true,
      approvedAt: true,
      rejectedAt: true,
      clientId: true,
      proId: true,
      proof: {
        select: {
          id: true,
          decision: true,
          method: true,
          actedAt: true,
          recordedByUserId: true,
          clientActionTokenId: true,
          contactMethod: true,
          destinationSnapshot: true,
        },
      },
    },
  },
} satisfies Prisma.BookingSelect

const RESCHEDULE_BOOKING_SELECT = {
  id: true,
  status: true,
  clientId: true,
  professionalId: true,
  offeringId: true,
  scheduledFor: true,
  locationType: true,
  locationTimeZone: true,
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
  locationAddressSnapshotKeyVersion: true,
  locationLatSnapshot: true,
  locationLngSnapshot: true,
  encryptedLocationAddressSnapshotJson: true,
  locationLatApprox: true,
  locationLngApprox: true,
  clientAddressId: true,
  clientAddressSnapshot: true,
  clientAddressSnapshotKeyVersion: true,
  clientAddressLatSnapshot: true,
  clientAddressLngSnapshot: true,
  encryptedClientAddressSnapshotJson: true,
  clientAddressLatApprox: true,
  clientAddressLngApprox: true,
  addressSnapshotsEncryptedAt: true,
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
  locationAddressSnapshotKeyVersion: true,
  locationLatSnapshot: true,
  locationLngSnapshot: true,
  encryptedLocationAddressSnapshotJson: true,
  locationLatApprox: true,
  locationLngApprox: true,
  clientAddressId: true,
  clientAddressSnapshot: true,
  clientAddressSnapshotKeyVersion: true,
  clientAddressLatSnapshot: true,
  clientAddressLngSnapshot: true,
  encryptedClientAddressSnapshotJson: true,
  clientAddressLatApprox: true,
  clientAddressLngApprox: true,
  addressSnapshotsEncryptedAt: true,
} satisfies Prisma.BookingHoldSelect

const FINISH_BOOKING_SELECT = {
  id: true,
  professionalId: true,
  status: true,
  startedAt: true,
  finishedAt: true,
  sessionStep: true,
  consultationApproval: {
    select: {
      status: true,
    },
  },
} satisfies Prisma.BookingSelect

type FinishBookingRecord = Prisma.BookingGetPayload<{
  select: typeof FINISH_BOOKING_SELECT
}>

const FINAL_REVIEW_BOOKING_SELECT = {
  id: true,
  professionalId: true,
  status: true,
  startedAt: true,
  finishedAt: true,
  sessionStep: true,
  serviceId: true,
  offeringId: true,
  subtotalSnapshot: true,
  totalDurationMinutes: true,
  serviceItems: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      serviceId: true,
      offeringId: true,
      itemType: true,
      priceSnapshot: true,
      durationMinutesSnapshot: true,
      notes: true,
      sortOrder: true,
    },
  },
  aftercareSummary: {
    select: {
      id: true,
      notes: true,
      rebookMode: true,
      rebookedFor: true,
      rebookWindowStart: true,
      rebookWindowEnd: true,
      draftSavedAt: true,
      sentToClientAt: true,
      lastEditedAt: true,
      version: true,
      recommendedProducts: {
        select: {
          productId: true,
          externalName: true,
          externalUrl: true,
          note: true,
        },
      },
    },
  },
} satisfies Prisma.BookingSelect

type FinalReviewBookingRecord = Prisma.BookingGetPayload<{
  select: typeof FINAL_REVIEW_BOOKING_SELECT
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
      minPrice: true,
    },
  },
  priceRamps: {
    select: {
      mode: true,
      currentPrice: true,
      targetPrice: true,
      startedAt: true,
    },
  },
} satisfies Prisma.ProfessionalServiceOfferingSelect

const REBOOK_SOURCE_BOOKING_SELECT = {
  id: true,
  status: true,
  clientId: true,
  professionalId: true,
  finishedAt: true,
  checkoutStatus: true,
  paymentCollectedAt: true,
  aftercareSummary: {
    select: {
      id: true,
      sentToClientAt: true,
      rebookSlot: {
        select: {
          id: true,
          professionalId: true,
          offeringId: true,
          locationId: true,
          locationType: true,
          startsAt: true,
          endsAt: true,
        },
      },
    },
  },

  locationType: true,
  locationId: true,
  locationTimeZone: true,
  locationAddressSnapshot: true,
  locationAddressSnapshotKeyVersion: true,
  locationLatSnapshot: true,
  locationLngSnapshot: true,
  encryptedLocationAddressSnapshotJson: true,
  locationLatApprox: true,
  locationLngApprox: true,

  clientAddressId: true,
  clientAddressSnapshot: true,
  clientAddressSnapshotKeyVersion: true,
  clientAddressLatSnapshot: true,
  clientAddressLngSnapshot: true,
  encryptedClientAddressSnapshotJson: true,
  clientAddressLatApprox: true,
  clientAddressLngApprox: true,
  clientTimeZoneAtBooking: true,
  addressSnapshotsEncryptedAt: true,

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
  startedAt: true,
  finishedAt: true,
  sessionStep: true,
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
  checkoutStatus: true,
  paymentCollectedAt: true,
  locationTimeZone: true,
  service: {
    select: {
      name: true,
    },
  },
  clientTimeZoneAtBooking: true,
  client: {
    select: {
      id: true,
      userId: true,
      email: true,
      phone: true,
      preferredContactMethod: true,
      firstName: true,
      lastName: true,
      user: {
        select: {
          email: true,
          phone: true,
        },
      },
    },
  },
  aftercareSummary: {
    select: {
      id: true,
      notes: true,
      rebookMode: true,
      rebookedFor: true,
      rebookWindowStart: true,
      rebookWindowEnd: true,
      draftSavedAt: true,
      sentToClientAt: true,
      lastEditedAt: true,
      version: true,
      rebookSlot: {
        select: {
          id: true,
          offeringId: true,
          locationId: true,
          locationType: true,
          startsAt: true,
          endsAt: true,
        },
      },
      recommendedProducts: {
        select: {
          productId: true,
          externalName: true,
          externalUrl: true,
          note: true,
        },
      },
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

const BOOKING_CHECKOUT_SELECT = {
  id: true,
  professionalId: true,
  status: true,
  sessionStep: true,
  finishedAt: true,
  subtotalSnapshot: true,
  serviceSubtotalSnapshot: true,
  productSubtotalSnapshot: true,
  tipAmount: true,
  taxAmount: true,
  discountAmount: true,
  totalAmount: true,
  checkoutStatus: true,
  selectedPaymentMethod: true,
  paymentAuthorizedAt: true,
  paymentCollectedAt: true,
  aftercareSummary: {
    select: {
      id: true,
      sentToClientAt: true,
    },
  },
  productSales: {
    select: {
      unitPrice: true,
      quantity: true,
    },
  },
} satisfies Prisma.BookingSelect

type BookingCheckoutRecord = Prisma.BookingGetPayload<{
  select: typeof BOOKING_CHECKOUT_SELECT
}>

const PRO_CHECKOUT_CLOSEOUT_SELECT = {
  id: true,
  professionalId: true,
  status: true,
  sessionStep: true,
  finishedAt: true,
  checkoutStatus: true,
  selectedPaymentMethod: true,
  serviceSubtotalSnapshot: true,
  productSubtotalSnapshot: true,
  subtotalSnapshot: true,
  tipAmount: true,
  taxAmount: true,
  discountAmount: true,
  totalAmount: true,
  paymentAuthorizedAt: true,
  paymentCollectedAt: true,
  aftercareSummary: {
    select: {
      id: true,
      sentToClientAt: true,
    },
  },
} satisfies Prisma.BookingSelect

type ProCheckoutCloseoutRecord = Prisma.BookingGetPayload<{
  select: typeof PRO_CHECKOUT_CLOSEOUT_SELECT
}>

const CLIENT_BOOKING_CHECKOUT_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  status: true,
  sessionStep: true,
  finishedAt: true,
  subtotalSnapshot: true,
  serviceSubtotalSnapshot: true,
  productSubtotalSnapshot: true,
  tipAmount: true,
  taxAmount: true,
  discountAmount: true,
  totalAmount: true,
  checkoutStatus: true,
  selectedPaymentMethod: true,
  paymentAuthorizedAt: true,
  paymentCollectedAt: true,
  aftercareSummary: {
    select: {
      id: true,
      sentToClientAt: true,
    },
  },
  productSales: {
    select: {
      unitPrice: true,
      quantity: true,
    },
  },
} satisfies Prisma.BookingSelect

type ClientBookingCheckoutRecord = Prisma.BookingGetPayload<{
  select: typeof CLIENT_BOOKING_CHECKOUT_SELECT
}>

const CLIENT_STRIPE_CHECKOUT_BOOKING_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  status: true,
  finishedAt: true,
  subtotalSnapshot: true,
  serviceSubtotalSnapshot: true,
  productSubtotalSnapshot: true,
  tipAmount: true,
  taxAmount: true,
  discountAmount: true,
  totalAmount: true,
  checkoutStatus: true,
  selectedPaymentMethod: true,
  paymentProvider: true,
  paymentAuthorizedAt: true,
  paymentCollectedAt: true,
  stripeCheckoutSessionId: true,
  stripePaymentIntentId: true,
  stripeConnectedAccountId: true,
  stripeCheckoutSessionStatus: true,
  stripePaymentStatus: true,
  stripeAmountSubtotal: true,
  stripeAmountTotal: true,
  stripeCurrency: true,
  aftercareSummary: {
    select: {
      id: true,
      sentToClientAt: true,
    },
  },
  productSales: {
    select: {
      unitPrice: true,
      quantity: true,
    },
  },
  service: {
    select: {
      name: true,
    },
  },
  professional: {
    select: {
      paymentSettings: {
        select: {
          acceptStripeCard: true,
          stripeAccountId: true,
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
          tipsEnabled: true,
        },
      },
    },
  },
} satisfies Prisma.BookingSelect

type ClientStripeCheckoutBookingRecord = Prisma.BookingGetPayload<{
  select: typeof CLIENT_STRIPE_CHECKOUT_BOOKING_SELECT
}>

const STRIPE_WEBHOOK_BOOKING_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  status: true,
  finishedAt: true,
  sessionStep: true,
  subtotalSnapshot: true,
  serviceSubtotalSnapshot: true,
  productSubtotalSnapshot: true,
  tipAmount: true,
  taxAmount: true,
  discountAmount: true,
  totalAmount: true,
  checkoutStatus: true,
  selectedPaymentMethod: true,
  paymentProvider: true,
  paymentAuthorizedAt: true,
  paymentCollectedAt: true,
  stripeCheckoutSessionId: true,
  stripePaymentIntentId: true,
  stripeConnectedAccountId: true,
  stripeCheckoutSessionStatus: true,
  stripePaymentStatus: true,
  stripeAmountSubtotal: true,
  stripeAmountTotal: true,
  stripeCurrency: true,
  stripePaidAt: true,
  stripeLastEventId: true,
  aftercareSummary: {
    select: {
      id: true,
      sentToClientAt: true,
    },
  },
} satisfies Prisma.BookingSelect

type StripeWebhookBookingRecord = Prisma.BookingGetPayload<{
  select: typeof STRIPE_WEBHOOK_BOOKING_SELECT
}>

const CLIENT_CHECKOUT_PRODUCTS_BOOKING_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  status: true,
  finishedAt: true,
  checkoutStatus: true,
  paymentAuthorizedAt: true,
  paymentCollectedAt: true,
  serviceSubtotalSnapshot: true,
  productSubtotalSnapshot: true,
  subtotalSnapshot: true,
  tipAmount: true,
  taxAmount: true,
  discountAmount: true,
  totalAmount: true,
  aftercareSummary: {
    select: {
      id: true,
      sentToClientAt: true,
      recommendedProducts: {
        select: {
          id: true,
          productId: true,
        },
      },
    },
  },

  // REQUIRES SCHEMA RELATION
  checkoutProductItems: {
    select: {
      id: true,
      recommendationId: true,
      productId: true,
      quantity: true,
      unitPrice: true,
    },
    orderBy: [{ createdAt: 'asc' }],
  },
} satisfies Prisma.BookingSelect

const CLIENT_REVIEW_ELIGIBILITY_BOOKING_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  status: true,
  finishedAt: true,
  checkoutStatus: true,
  paymentCollectedAt: true,
  aftercareSummary: {
    select: {
      id: true,
      sentToClientAt: true,
    },
  },
  reviews: {
    select: {
      id: true,
      clientId: true,
    },
    take: 10,
  },
} satisfies Prisma.BookingSelect

type ClientReviewEligibilityBookingRecord = Prisma.BookingGetPayload<{
  select: typeof CLIENT_REVIEW_ELIGIBILITY_BOOKING_SELECT
}>

type ClientCheckoutProductsBookingRecord = Prisma.BookingGetPayload<{
  select: typeof CLIENT_CHECKOUT_PRODUCTS_BOOKING_SELECT
}>

function buildMeta(mutated: boolean): MutationMeta {
  return {
    mutated,
    noOp: !mutated,
  }
}

function normalizeDecimalCmp(
  value: Prisma.Decimal | null | undefined,
): string | null {
  return value ? value.toFixed(2) : null
}

function normalizeDateCmp(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function buildSessionAuditSnapshot(args: {
  status: BookingStatus
  startedAt: Date | null | undefined
  finishedAt: Date | null | undefined
  sessionStep: SessionStep | null | undefined
}) {
  return {
    status: args.status,
    startedAt: normalizeDateCmp(args.startedAt),
    finishedAt: normalizeDateCmp(args.finishedAt),
    sessionStep: args.sessionStep ?? SessionStep.NONE,
  }
}

function normalizeFinalReviewLineItemsForComparison(
  items: ConfirmBookingFinalReviewLineItemInput[],
) {
  return [...items]
    .map((item, index) => {
      const price = normalizePositiveMoneyDecimal(item.price)
      const duration = normalizePositiveDurationMinutes(item.durationMinutes)

      if (!price || duration == null) {
        throw bookingError('INVALID_SERVICE_ITEMS')
      }

      return {
        serviceId: item.serviceId.trim(),
        offeringId: item.offeringId?.trim() || null,
        itemType: item.itemType,
        priceSnapshot: price.toFixed(2),
        durationMinutesSnapshot: duration,
        notes: normalizeReason(item.notes),
        sortOrder: Number.isFinite(item.sortOrder)
          ? Math.max(0, Math.trunc(item.sortOrder))
          : index,
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

function buildExistingFinalReviewItemsForComparison(
  items: FinalReviewBookingRecord['serviceItems'],
) {
  return items
    .map((item) => ({
      serviceId: item.serviceId,
      offeringId: item.offeringId ?? null,
      itemType: item.itemType,
      priceSnapshot: normalizeDecimalCmp(item.priceSnapshot),
      durationMinutesSnapshot: item.durationMinutesSnapshot,
      notes: normalizeReason(item.notes),
      sortOrder: item.sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

function normalizeAftercareRebookSlotForComparison(
  slot:
    | {
        offeringId: string | null
        locationId: string
        locationType: ServiceLocationType
        startsAt: Date
        endsAt: Date
      }
    | null
    | undefined,
) {
  if (!slot) return null

  return {
    offeringId: slot.offeringId ?? null,
    locationId: slot.locationId,
    locationType: slot.locationType,
    startsAt: normalizeDateCmp(slot.startsAt),
    endsAt: normalizeDateCmp(slot.endsAt),
  }
}

function normalizeRecommendedProductsForComparison(
  products: RecommendedProductInput[],
) {
  return [...products]
    .map((product) => ({
      productId: product.productId?.trim() || null,
      externalName: product.externalName?.trim() || null,
      externalUrl: product.externalUrl?.trim() || null,
      note: normalizeReason(product.note),
    }))
    .sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    )
}

function buildExistingRecommendedProductsForComparison(
  products:
    | Array<{
        productId: string | null
        externalName: string | null
        externalUrl: string | null
        note: string | null
      }>
    | null
    | undefined,
) {
  return [...(products ?? [])]
    .map((product) => ({
      productId: product.productId ?? null,
      externalName: product.externalName ?? null,
      externalUrl: product.externalUrl ?? null,
      note: normalizeReason(product.note),
    }))
    .sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    )
}

function normalizeCheckoutSelectionForComparison(
  items: ClientCheckoutProductSelectionInput[],
) {
  return [...items]
    .map((item) => ({
      recommendationId: item.recommendationId,
      productId: item.productId,
      quantity: Math.max(1, Math.trunc(item.quantity)),
    }))
    .sort((a, b) =>
      `${a.recommendationId}:${a.productId}`.localeCompare(
        `${b.recommendationId}:${b.productId}`,
      ),
    )
}

function buildExistingCheckoutSelectionForComparison(
  items: ClientCheckoutProductsBookingRecord['checkoutProductItems'],
) {
  return [...items]
    .map((item) => ({
      recommendationId: item.recommendationId,
      productId: item.productId,
      quantity: item.quantity,
    }))
    .sort((a, b) =>
      `${a.recommendationId}:${a.productId}`.localeCompare(
        `${b.recommendationId}:${b.productId}`,
      ),
    )
}

function buildCheckoutAuditSnapshot(args: {
  checkoutStatus: BookingCheckoutStatus | null | undefined
  selectedPaymentMethod: PaymentMethod | null | undefined
  serviceSubtotalSnapshot: Prisma.Decimal | null | undefined
  productSubtotalSnapshot: Prisma.Decimal | null | undefined
  subtotalSnapshot: Prisma.Decimal | null | undefined
  tipAmount: Prisma.Decimal | null | undefined
  taxAmount: Prisma.Decimal | null | undefined
  discountAmount: Prisma.Decimal | null | undefined
  totalAmount: Prisma.Decimal | null | undefined
  paymentAuthorizedAt: Date | null | undefined
  paymentCollectedAt: Date | null | undefined
}) {
  return {
    checkoutStatus: args.checkoutStatus ?? null,
    selectedPaymentMethod: args.selectedPaymentMethod ?? null,
    serviceSubtotalSnapshot: normalizeDecimalCmp(args.serviceSubtotalSnapshot),
    productSubtotalSnapshot: normalizeDecimalCmp(args.productSubtotalSnapshot),
    subtotalSnapshot: normalizeDecimalCmp(args.subtotalSnapshot),
    tipAmount: normalizeDecimalCmp(args.tipAmount),
    taxAmount: normalizeDecimalCmp(args.taxAmount),
    discountAmount: normalizeDecimalCmp(args.discountAmount),
    totalAmount: normalizeDecimalCmp(args.totalAmount),
    paymentAuthorizedAt: normalizeDateCmp(args.paymentAuthorizedAt),
    paymentCollectedAt: normalizeDateCmp(args.paymentCollectedAt),
  }
}

  function throwAftercareDeliveryFailed(overrides?: {
    message?: string
    userMessage?: string
  }): never {
    throw bookingError('AFTERCARE_DELIVERY_FAILED', {
      message:
        overrides?.message ??
        'Aftercare access delivery could not be queued.',
      userMessage:
        overrides?.userMessage ??
        'We could not send aftercare to the client. Please try again.',
    })
  }

async function createCheckoutAuditLogs(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  professionalId: string
  route: string
  requestId?: string | null
  idempotencyKey?: string | null
  oldState: ReturnType<typeof buildCheckoutAuditSnapshot>
  newState: ReturnType<typeof buildCheckoutAuditSnapshot>
}): Promise<void> {
  if (!areAuditValuesEqual(args.oldState, args.newState)) {
    await createBookingCloseoutAuditLog({
      tx: args.tx,
      bookingId: args.bookingId,
      professionalId: args.professionalId,
      action: BookingCloseoutAuditAction.CHECKOUT_UPDATED,
      route: args.route,
      requestId: args.requestId,
      idempotencyKey: args.idempotencyKey,
      oldValue: args.oldState,
      newValue: args.newState,
    })
  }

  if (args.oldState.selectedPaymentMethod !== args.newState.selectedPaymentMethod) {
    await createBookingCloseoutAuditLog({
      tx: args.tx,
      bookingId: args.bookingId,
      professionalId: args.professionalId,
      action: BookingCloseoutAuditAction.PAYMENT_METHOD_UPDATED,
      route: args.route,
      requestId: args.requestId,
      idempotencyKey: args.idempotencyKey,
      oldValue: {
        selectedPaymentMethod: args.oldState.selectedPaymentMethod,
      },
      newValue: {
        selectedPaymentMethod: args.newState.selectedPaymentMethod,
      },
    })
  }

  if (
    args.oldState.paymentAuthorizedAt !== args.newState.paymentAuthorizedAt &&
    args.newState.paymentAuthorizedAt
  ) {
    await createBookingCloseoutAuditLog({
      tx: args.tx,
      bookingId: args.bookingId,
      professionalId: args.professionalId,
      action: BookingCloseoutAuditAction.PAYMENT_AUTHORIZED,
      route: args.route,
      requestId: args.requestId,
      idempotencyKey: args.idempotencyKey,
      oldValue: {
        paymentAuthorizedAt: args.oldState.paymentAuthorizedAt,
        checkoutStatus: args.oldState.checkoutStatus,
        totalAmount: args.oldState.totalAmount,
      },
      newValue: {
        paymentAuthorizedAt: args.newState.paymentAuthorizedAt,
        checkoutStatus: args.newState.checkoutStatus,
        totalAmount: args.newState.totalAmount,
      },
    })
  }

  if (
    args.oldState.paymentCollectedAt !== args.newState.paymentCollectedAt &&
    args.newState.paymentCollectedAt
  ) {
    await createBookingCloseoutAuditLog({
      tx: args.tx,
      bookingId: args.bookingId,
      professionalId: args.professionalId,
      action: BookingCloseoutAuditAction.PAYMENT_COLLECTED,
      route: args.route,
      requestId: args.requestId,
      idempotencyKey: args.idempotencyKey,
      oldValue: {
        paymentCollectedAt: args.oldState.paymentCollectedAt,
        checkoutStatus: args.oldState.checkoutStatus,
        totalAmount: args.oldState.totalAmount,
      },
      newValue: {
        paymentCollectedAt: args.newState.paymentCollectedAt,
        checkoutStatus: args.newState.checkoutStatus,
        totalAmount: args.newState.totalAmount,
      },
    })
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


function isWithinStartWindow(scheduledFor: Date, now: Date): boolean {
  const start = scheduledFor.getTime() - 15 * 60 * 1000
  const end = scheduledFor.getTime() + 15 * 60 * 1000
  const t = now.getTime()
  return t >= start && t <= end
}

function buildAftercarePublicAccess(): AftercarePublicAccessSummary {
  return {
    accessMode: 'NONE',
    hasPublicAccess: false,
    clientAftercareHref: null,
  }
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

function pickFirstNonEmpty(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const normalized = normalizeReason(value)
    if (normalized) return normalized
  }
  return null
}

function inferPreferredContactMethod(args: {
  email: string | null
  phone: string | null
  existingPreference: ContactMethod | null | undefined
}): ContactMethod | null {
  if (args.existingPreference) return args.existingPreference
  if (args.email && !args.phone) return ContactMethod.EMAIL
  if (args.phone && !args.email) return ContactMethod.SMS
  return null
}

function resolveAftercareRecipientTimeZone(
  booking: AftercareUpsertBookingRecord,
): string | null {
  const clientTimeZoneAtBooking = normalizeReason(booking.clientTimeZoneAtBooking)
  if (clientTimeZoneAtBooking && isValidIanaTimeZone(clientTimeZoneAtBooking)) {
    return clientTimeZoneAtBooking
  }

  const locationTimeZone = normalizeReason(booking.locationTimeZone)
  if (locationTimeZone && isValidIanaTimeZone(locationTimeZone)) {
    return locationTimeZone
  }

  return null
}

async function maybeCreateAftercareAccessDeliveryInBoundary(args: {
  tx: Prisma.TransactionClient
  booking: AftercareUpsertBookingRecord
  aftercareId: string
  aftercareVersion: number
  actorUserId: string
  shouldAttempt: boolean
}): Promise<AftercareAccessDeliverySummary> {
  if (!args.shouldAttempt) {
    return {
      attempted: false,
      queued: false,
      href: null,
    }
  }

  const recipientEmail = pickFirstNonEmpty(
    args.booking.client.email,
    args.booking.client.user?.email ?? null,
  )

  const recipientPhone = pickFirstNonEmpty(
    args.booking.client.phone,
    args.booking.client.user?.phone ?? null,
  )

  if (!recipientEmail && !recipientPhone) {
    console.error(
      'writeBoundary upsertBookingAftercare delivery failed: no client destination',
      {
        bookingId: args.booking.id,
        professionalId: args.booking.professionalId,
        aftercareId: args.aftercareId,
        clientId: args.booking.clientId,
      },
    )

    return throwAftercareDeliveryFailed({
      message:
        'Aftercare access delivery could not be queued because the client has no email or phone.',
      userMessage:
        'This client needs an email or phone number before aftercare can be sent.',
    })
  }

  try {
    const delivery = await createAftercareAccessDelivery({
      tx: args.tx,
      professionalId: args.booking.professionalId,
      clientId: args.booking.clientId,
      bookingId: args.booking.id,
      aftercareId: args.aftercareId,
      aftercareVersion: args.aftercareVersion,
      issuedByUserId: args.actorUserId,
      recipientUserId: args.booking.client.userId ?? null,
      recipientEmail,
      recipientPhone,
      preferredContactMethod: inferPreferredContactMethod({
        email: recipientEmail,
        phone: recipientPhone,
        existingPreference: args.booking.client.preferredContactMethod,
      }),
      recipientTimeZone: resolveAftercareRecipientTimeZone(args.booking),
    })

    return {
      attempted: true,
      queued: true,
      href: delivery.link.href,
    }
  } catch (error: unknown) {
    console.error(
      'writeBoundary upsertBookingAftercare access delivery enqueue failed',
      {
        bookingId: args.booking.id,
        professionalId: args.booking.professionalId,
        aftercareId: args.aftercareId,
        clientId: args.booking.clientId,
        error: safeError(error),
      },
    )

    return throwAftercareDeliveryFailed()
  }
}

function getConsultationApprovalAuditAction(
  decision: ConsultationDecision,
  method: ConsultationApprovalProofMethod,
): BookingCloseoutAuditAction {
  if (decision === ConsultationDecision.APPROVED) {
    return method === ConsultationApprovalProofMethod.REMOTE_SECURE_LINK
      ? BookingCloseoutAuditAction.CONSULTATION_APPROVED_REMOTE
      : BookingCloseoutAuditAction.CONSULTATION_APPROVED_IN_PERSON
  }

  return method === ConsultationApprovalProofMethod.REMOTE_SECURE_LINK
    ? BookingCloseoutAuditAction.CONSULTATION_REJECTED_REMOTE
    : BookingCloseoutAuditAction.CONSULTATION_REJECTED_IN_PERSON
}

function buildConsultationProofDestinationSnapshot(args: {
  contactMethod: ContactMethod | null
  destinationSnapshot: string | null
}): string | null {
  return args.destinationSnapshot ?? null
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

// Read the unique-constraint target field name(s) from a P2002 error.
// Prisma sets `meta.target` to either a string or string[] depending on driver.
function p2002TargetIncludes(
  error: Prisma.PrismaClientKnownRequestError,
  fieldName: string,
): boolean {
  const target = error.meta?.target
  if (Array.isArray(target)) {
    return target.some(
      (entry) => typeof entry === 'string' && entry.includes(fieldName),
    )
  }
  if (typeof target === 'string') {
    return target.includes(fieldName)
  }
  return false
}

// Re-hydrate a CreateProBookingResult from a previously-created booking when an
// idempotency replay is detected. Returns null if no matching booking exists.
async function tryHydrateProBookingByIdempotency(args: {
  tx: Prisma.TransactionClient
  clientId: string
  idempotencyKey: string
}): Promise<CreateProBookingResult | null> {
  const existing = await args.tx.booking.findFirst({
    where: {
      clientId: args.clientId,
      creationIdempotencyKey: args.idempotencyKey,
    },
    select: {
      id: true,
      scheduledFor: true,
      totalDurationMinutes: true,
      bufferMinutes: true,
      status: true,
      subtotalSnapshot: true,
      locationId: true,
      locationType: true,
      locationTimeZone: true,
      clientAddressId: true,
      service: { select: { name: true } },
    } satisfies Prisma.BookingSelect,
  })

  if (!existing) return null

  return {
    booking: {
      id: existing.id,
      scheduledFor: existing.scheduledFor,
      totalDurationMinutes: existing.totalDurationMinutes,
      bufferMinutes: existing.bufferMinutes,
      status: existing.status,
    },
    subtotalSnapshot: existing.subtotalSnapshot,
    // stepMinutes is a derived display value; on replay we cannot recompute it
    // without re-running location resolution. The booking is already persisted
    // with its final duration/buffer, so 0 is a safe sentinel for clients that
    // only navigate to the booking; the original create response carried the
    // authoritative value.
    stepMinutes: 0,
    appointmentTimeZone: existing.locationTimeZone ?? 'UTC',
    locationId: existing.locationId,
    locationType: existing.locationType,
    clientAddressId: existing.clientAddressId,
    serviceName: existing.service?.name || 'Appointment',
    meta: buildMeta(false),
  }
}

async function maybeCompleteBookingCloseout(args: {
  tx: Prisma.TransactionClient
  now: Date
  booking: {
    id: string
    professionalId: string
    status: BookingStatus
    sessionStep: SessionStep | null
    finishedAt: Date | null
    aftercareSummary?: {
      sentToClientAt: Date | null
    } | null
  }
  checkoutStatus: BookingCheckoutStatus | null | undefined
  paymentCollectedAt: Date | null | undefined
  actor: 'PRO' | 'SYSTEM'
  route: string
}): Promise<boolean> {
  const closeoutCandidate = isPaymentAndAftercareCloseoutCandidate({
    bookingStatus: args.booking.status,
    aftercareSentAt: args.booking.aftercareSummary?.sentToClientAt,
    checkoutStatus: args.checkoutStatus,
    paymentCollectedAt: args.paymentCollectedAt,
  })

  const afterMediaCount = closeoutCandidate
    ? await countProAfterMediaForBooking({
        tx: args.tx,
        bookingId: args.booking.id,
      })
    : 0

  const shouldCompleteBooking = canCompleteBookingCloseout({
    bookingStatus: args.booking.status,
    aftercareSentAt: args.booking.aftercareSummary?.sentToClientAt,
    checkoutStatus: args.checkoutStatus,
    paymentCollectedAt: args.paymentCollectedAt,
    afterMediaCount,
  })

  if (
    !shouldCompleteBooking ||
    (
      args.booking.status === BookingStatus.COMPLETED &&
      args.booking.sessionStep === SessionStep.DONE &&
      args.booking.finishedAt
    )
  ) {
    return false
  }

  recordStepTransition({
    from: args.booking.sessionStep ?? SessionStep.NONE,
    to: SessionStep.DONE,
    actor: args.actor,
    route: `${args.route}#complete`,
    bookingId: args.booking.id,
    professionalId: args.booking.professionalId,
  })

  recordStatusTransition({
    from: args.booking.status,
    to: BookingStatus.COMPLETED,
    actor: args.actor,
    route: `${args.route}#complete`,
    bookingId: args.booking.id,
    professionalId: args.booking.professionalId,
  })

  await args.tx.booking.update({
    where: { id: args.booking.id },
    data: {
      status: BookingStatus.COMPLETED,
      sessionStep: SessionStep.DONE,
      finishedAt: args.booking.finishedAt ?? args.now,
    },
    select: { id: true } satisfies Prisma.BookingSelect,
  })

  return true
}

async function countProAfterMediaForBooking(args: {
  tx: Prisma.TransactionClient
  bookingId: string
}): Promise<number> {
  return args.tx.mediaAsset.count({
    where: {
      bookingId: args.bookingId,
      phase: MediaPhase.AFTER,
      uploadedByRole: Role.PRO,
    },
  })
}

function hasRequiredAfterPhotos(
  afterMediaCount: number | null | undefined,
): boolean {
  return (afterMediaCount ?? 0) > 0
}

function isPaymentAndAftercareCloseoutCandidate(args: {
  bookingStatus: BookingStatus | null | undefined
  aftercareSentAt: Date | null | undefined
  checkoutStatus: BookingCheckoutStatus | null | undefined
  paymentCollectedAt: Date | null | undefined
}): boolean {
  if (
    args.bookingStatus === BookingStatus.CANCELLED ||
    args.bookingStatus === BookingStatus.COMPLETED
  ) {
    return false
  }

  return isCloseoutPaymentAndAftercareComplete({
    aftercareSentAt: args.aftercareSentAt,
    checkoutStatus: args.checkoutStatus,
    paymentCollectedAt: args.paymentCollectedAt,
  })
}

function canCompleteBookingCloseout(args: {
  bookingStatus: BookingStatus | null | undefined
  aftercareSentAt: Date | null | undefined
  checkoutStatus: BookingCheckoutStatus | null | undefined
  paymentCollectedAt: Date | null | undefined
  afterMediaCount: number | null | undefined
}): boolean {
  return (
    isPaymentAndAftercareCloseoutCandidate(args) &&
    hasRequiredAfterPhotos(args.afterMediaCount)
  )
}

function isReviewEligibleCloseout(args: {
  bookingStatus: BookingStatus | null | undefined
  finishedAt: Date | null | undefined
  aftercareSentAt: Date | null | undefined
  checkoutStatus: BookingCheckoutStatus | null | undefined
  paymentCollectedAt: Date | null | undefined
}): boolean {
  return (
    args.bookingStatus === BookingStatus.COMPLETED &&
    Boolean(args.finishedAt) &&
    isCloseoutPaymentAndAftercareComplete({
      aftercareSentAt: args.aftercareSentAt,
      checkoutStatus: args.checkoutStatus,
      paymentCollectedAt: args.paymentCollectedAt,
    })
  )
}

/**
 * Returns a list of human-readable error codes that explain why a
 * `sendToClient = true` aftercare submission did not complete the booking.
 * Empty array means the booking was (or will be) completed normally.
 *
 * NOTE: This mirrors the conditions checked in `isReviewEligibleCloseout`.
 * If you change the completion criteria in either function, update both.
 */
function buildCompletionBlockers(args: {
  sendToClient: boolean
  bookingFinished: boolean
  checkoutStatus: BookingCheckoutStatus | null | undefined
  paymentCollectedAt: Date | null | undefined
  afterMediaCount: number | null | undefined
}): string[] {
  if (!args.sendToClient || args.bookingFinished) return []

  const blockers: string[] = []

  if (!args.paymentCollectedAt) {
    blockers.push('PAYMENT_NOT_COLLECTED')
  }

  if (!isCheckoutCloseoutComplete(args.checkoutStatus)) {
    blockers.push('CHECKOUT_NOT_COMPLETE')
  }

  if (!hasRequiredAfterPhotos(args.afterMediaCount)) {
    blockers.push('AFTER_PHOTOS_REQUIRED')
  }
  return blockers
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
function getBookingMediaUploadAuditAction(
  phase: MediaPhase,
): BookingCloseoutAuditAction | null {
  if (phase === MediaPhase.BEFORE) {
    return BookingCloseoutAuditAction.BEFORE_PHOTO_UPLOADED
  }

  if (phase === MediaPhase.AFTER) {
    return BookingCloseoutAuditAction.AFTER_PHOTO_UPLOADED
  }

  return null
}

function canUploadBookingMediaPhase(
  sessionStep: SessionStep | null | undefined,
  phase: MediaPhase,
): boolean {
  const step = sessionStep ?? SessionStep.NONE

  if (phase === MediaPhase.BEFORE) {
    return (
      step === SessionStep.CONSULTATION ||
      step === SessionStep.CONSULTATION_PENDING_CLIENT ||
      step === SessionStep.BEFORE_PHOTOS
    )
  }

  if (phase === MediaPhase.AFTER) {
    return step === SessionStep.AFTER_PHOTOS
  }

  return true
}

function isValidLatitude(value: number | null | undefined): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -90 &&
    value <= 90
  )
}

function isValidLongitude(value: number | null | undefined): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -180 &&
    value <= 180
  )
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180
}

function distanceMilesBetweenCoordinates(args: {
  fromLat: number
  fromLng: number
  toLat: number
  toLng: number
}): number {
  const earthRadiusMiles = 3958.7613

  const fromLatRad = degreesToRadians(args.fromLat)
  const toLatRad = degreesToRadians(args.toLat)
  const deltaLatRad = degreesToRadians(args.toLat - args.fromLat)
  const deltaLngRad = degreesToRadians(args.toLng - args.fromLng)

  const sinDeltaLat = Math.sin(deltaLatRad / 2)
  const sinDeltaLng = Math.sin(deltaLngRad / 2)

  const a =
    sinDeltaLat * sinDeltaLat +
    Math.cos(fromLatRad) *
      Math.cos(toLatRad) *
      sinDeltaLng *
      sinDeltaLng

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return earthRadiusMiles * c
}

async function getProfessionalMobileRadiusMiles(args: {
  tx: Prisma.TransactionClient
  professionalId: string
}): Promise<number | null> {
  const professional = await args.tx.professionalProfile.findUnique({
    where: { id: args.professionalId },
    select: {
      mobileRadiusMiles: true,
    } satisfies Prisma.ProfessionalProfileSelect,
  })

  return professional?.mobileRadiusMiles ?? null
}

async function assertMobileBookingWithinRadius(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  locationType: ServiceLocationType
  locationLat: number | null | undefined
  locationLng: number | null | undefined
  clientAddressId: string | null | undefined
  clientLat: number | null | undefined
  clientLng: number | null | undefined
}): Promise<void> {
  if (args.locationType !== ServiceLocationType.MOBILE) {
    return
  }

  if (!args.clientAddressId) {
    throw bookingError('CLIENT_SERVICE_ADDRESS_REQUIRED')
  }

  const radiusMiles = await getProfessionalMobileRadiusMiles({
    tx: args.tx,
    professionalId: args.professionalId,
  })

  if (
    typeof radiusMiles !== 'number' ||
    !Number.isFinite(radiusMiles) ||
    radiusMiles <= 0
  ) {
    throw bookingError('BAD_LOCATION', {
      message: 'Professional mobile service radius is not configured.',
      userMessage:
        'This professional has not finished mobile travel settings.',
    })
  }

  if (
    !isValidLatitude(args.locationLat) ||
    !isValidLongitude(args.locationLng)
  ) {
    throw bookingError('COORDINATES_REQUIRED', {
      message:
        'Mobile base coordinates are required before booking mobile services.',
      userMessage:
        'This professional mobile base is missing map coordinates.',
    })
  }

  if (!isValidLatitude(args.clientLat) || !isValidLongitude(args.clientLng)) {
    throw bookingError('CLIENT_SERVICE_ADDRESS_INVALID', {
      message:
        'Client service address coordinates are required before booking mobile services.',
      userMessage:
        'This service address is missing map coordinates. Please update the address and try again.',
    })
  }

  const distanceMiles = distanceMilesBetweenCoordinates({
    fromLat: args.locationLat,
    fromLng: args.locationLng,
    toLat: args.clientLat,
    toLng: args.clientLng,
  })

  if (distanceMiles > radiusMiles) {
    throw bookingError('CLIENT_SERVICE_ADDRESS_INVALID', {
      message: `Client service address is ${distanceMiles.toFixed(
        2,
      )} miles from the professional mobile base, which exceeds the ${radiusMiles}-mile service radius.`,
      userMessage: `This service address is outside this professional's ${radiusMiles}-mile mobile service area.`,
    })
  }
}

function normalizePositiveDurationMinutes(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return null

  const minutes = Math.trunc(parsed)
  if (minutes <= 0) return null

  return clampInt(minutes, 15, MAX_SLOT_DURATION_MINUTES)
}

function normalizePositiveMoneyDecimal(value: unknown): Prisma.Decimal | null {
  try {
    const dec = decimalFromUnknown(value)
    if (dec.lt(0)) return null
    return dec
  } catch {
    return null
  }
}

function zeroMoney(): Prisma.Decimal {
  return new Prisma.Decimal(0)
}

function decimalOrZero(
  value: Prisma.Decimal | null | undefined,
): Prisma.Decimal {
  return value ?? zeroMoney()
}

function computeProductSubtotalFromSales(
  sales: Array<{
    unitPrice: Prisma.Decimal | null
    quantity: number | null
  }>,
): Prisma.Decimal {
  return sales.reduce((sum, sale) => {
    const unitPrice = sale.unitPrice ?? zeroMoney()
    const quantity =
      typeof sale.quantity === 'number' && Number.isFinite(sale.quantity)
        ? Math.max(0, Math.trunc(sale.quantity))
        : 0

    return sum.add(unitPrice.mul(quantity))
  }, zeroMoney())
}

function assertClientCanEditBookingCheckoutProducts(
  booking: ClientCheckoutProductsBookingRecord,
  clientId: string,
): void {
  if (booking.clientId !== clientId) {
    throw bookingError('FORBIDDEN')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED')
  }

  if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
    throw bookingError('BOOKING_CANNOT_EDIT_COMPLETED', {
      message: 'Completed bookings cannot be changed.',
      userMessage: 'This booking is already completed.',
    })
  }

  if (!booking.aftercareSummary?.id || !booking.aftercareSummary.sentToClientAt) {
    throw bookingError('FORBIDDEN', {
      message: 'Product checkout requires finalized aftercare.',
      userMessage: 'Products can only be selected after aftercare is finalized.',
    })
  }

  if (booking.paymentAuthorizedAt) {
    throw bookingError('FORBIDDEN', {
      message: 'Payment has already been authorized for this booking.',
      userMessage:
        'This checkout is already in payment and cannot be changed.',
    })
  }

  if (booking.paymentCollectedAt) {
    throw bookingError('FORBIDDEN', {
      message: 'Checkout is already paid and cannot be changed.',
      userMessage: 'This checkout is already paid and cannot be changed.',
    })
  }

  if (
    booking.checkoutStatus === BookingCheckoutStatus.PARTIALLY_PAID ||
    booking.checkoutStatus === BookingCheckoutStatus.PAID ||
    booking.checkoutStatus === BookingCheckoutStatus.WAIVED
  ) {
    throw bookingError('FORBIDDEN', {
      message: 'Checkout status is locked and cannot be changed.',
      userMessage: 'This checkout is already locked and cannot be changed.',
    })
  }
}

function assertClientCanUpdateBookingCheckout(
  booking: ClientBookingCheckoutRecord,
  clientId: string,
): void {
  if (booking.clientId !== clientId) {
    throw bookingError('FORBIDDEN')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED')
  }

  if (!booking.aftercareSummary?.id || !booking.aftercareSummary.sentToClientAt) {
    throw bookingError('FORBIDDEN', {
      message: 'Client checkout requires finalized aftercare.',
      userMessage: 'Checkout becomes available after aftercare is finalized.',
    })
  }

  if (booking.paymentCollectedAt) {
    throw bookingError('FORBIDDEN', {
      message: 'Payment has already been confirmed for this booking.',
      userMessage: 'This checkout is already finished.',
    })
  }

  if (
    booking.checkoutStatus === BookingCheckoutStatus.PAID ||
    booking.checkoutStatus === BookingCheckoutStatus.WAIVED
  ) {
    throw bookingError('FORBIDDEN', {
      message: 'Checkout is already closed.',
      userMessage: 'This checkout is already finished.',
    })
  }
}

function assertClientCanCreateBookingReview(
  booking: ClientReviewEligibilityBookingRecord,
  clientId: string,
): void {
  if (booking.clientId !== clientId) {
    throw bookingError('FORBIDDEN')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED', {
      message: 'Cancelled bookings cannot be reviewed.',
      userMessage: 'Cancelled bookings cannot be reviewed.',
    })
  }

  const alreadyReviewed = booking.reviews.some(
    (review) => review.clientId === clientId,
  )

  if (alreadyReviewed) {
    throw bookingError('FORBIDDEN', {
      message: 'A review already exists for this booking and client.',
      userMessage: 'You already reviewed this appointment.',
    })
  }

  const closeoutComplete = isReviewEligibleCloseout({
    bookingStatus: booking.status,
    finishedAt: booking.finishedAt,
    aftercareSentAt: booking.aftercareSummary?.sentToClientAt,
    checkoutStatus: booking.checkoutStatus,
    paymentCollectedAt: booking.paymentCollectedAt,
  })

  if (!closeoutComplete) {
    throw bookingError('FORBIDDEN', {
      message:
        'Review is only available after booking closeout is complete: completed booking, finalized aftercare, and collected payment are required.',
      userMessage:
        'You can leave a review after checkout is finished and aftercare has been sent.',
    })
  }
}

function computeCheckoutTotal(args: {
  serviceSubtotal: Prisma.Decimal
  productSubtotal: Prisma.Decimal
  tipAmount: Prisma.Decimal
  taxAmount: Prisma.Decimal
  discountAmount: Prisma.Decimal
}): Prisma.Decimal {
  return args.serviceSubtotal
    .add(args.productSubtotal)
    .add(args.tipAmount)
    .add(args.taxAmount)
    .sub(args.discountAmount)
}

async function buildBookingCheckoutRollupUpdate(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  nextServiceSubtotal?: Prisma.Decimal | null
  nextProductSubtotal?: Prisma.Decimal | null
  nextTipAmount?: Prisma.Decimal | null
  nextTaxAmount?: Prisma.Decimal | null
  nextDiscountAmount?: Prisma.Decimal | null
}): Promise<{
  serviceSubtotalSnapshot: Prisma.Decimal
  productSubtotalSnapshot: Prisma.Decimal
  subtotalSnapshot: Prisma.Decimal
  tipAmount: Prisma.Decimal
  taxAmount: Prisma.Decimal
  discountAmount: Prisma.Decimal
  totalAmount: Prisma.Decimal
}> {
  const booking: BookingCheckoutRecord | null = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: BOOKING_CHECKOUT_SELECT,
  })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  const serviceSubtotal =
    args.nextServiceSubtotal ??
    booking.serviceSubtotalSnapshot ??
    booking.subtotalSnapshot ??
    zeroMoney()

  const productSubtotal =
    args.nextProductSubtotal ??
    computeProductSubtotalFromSales(
      booking.productSales.map((sale) => ({
        unitPrice: sale.unitPrice,
        quantity: sale.quantity,
      })),
    )

  const tipAmount = args.nextTipAmount ?? decimalOrZero(booking.tipAmount)
  const taxAmount = args.nextTaxAmount ?? decimalOrZero(booking.taxAmount)
  const discountAmount =
    args.nextDiscountAmount ?? decimalOrZero(booking.discountAmount)

  const subtotal = serviceSubtotal.add(productSubtotal)

  const totalAmount = computeCheckoutTotal({
    serviceSubtotal,
    productSubtotal,
    tipAmount,
    taxAmount,
    discountAmount,
  })

  return {
    serviceSubtotalSnapshot: serviceSubtotal,
    productSubtotalSnapshot: productSubtotal,
    subtotalSnapshot: subtotal,
    tipAmount,
    taxAmount,
    discountAmount,
    totalAmount,
  }
}

function assertValidFinalReviewLineItems(
  items: ConfirmBookingFinalReviewLineItemInput[],
): void {
  if (!Array.isArray(items) || items.length <= 0) {
    throw bookingError('INVALID_SERVICE_ITEMS', {
      message: 'Final review requires at least one service item.',
      userMessage: 'Add at least one final service item.',
    })
  }

  const baseCount = items.filter((item) => item.itemType === BookingServiceItemType.BASE).length
  if (baseCount !== 1) {
    throw bookingError('INVALID_SERVICE_ITEMS', {
      message: 'Final review requires exactly one BASE service item.',
      userMessage: 'You must have exactly one main service.',
    })
  }

  for (const item of items) {
    if (!item.serviceId.trim()) {
      throw bookingError('INVALID_SERVICE_ITEMS')
    }

    const duration = normalizePositiveDurationMinutes(item.durationMinutes)
    if (duration == null) {
      throw bookingError('INVALID_SERVICE_ITEMS', {
        message: 'Every final review line item needs a valid duration.',
        userMessage: 'Each item needs a valid duration.',
      })
    }

    const price = normalizePositiveMoneyDecimal(item.price)
    if (price == null) {
      throw bookingError('INVALID_SERVICE_ITEMS', {
        message: 'Every final review line item needs a valid non-negative price.',
        userMessage: 'Each item needs a valid price.',
      })
    }
  }
}

function assertValidRecommendedProducts(
  products: RecommendedProductInput[],
): void {
  for (const product of products) {
    const hasInternal =
      typeof product.productId === 'string' && product.productId.trim().length > 0
    const hasExternalName =
      typeof product.externalName === 'string' &&
      product.externalName.trim().length > 0
    const hasExternalUrl =
      typeof product.externalUrl === 'string' &&
      product.externalUrl.trim().length > 0

    if (hasInternal && (hasExternalName || hasExternalUrl)) {
      throw bookingError('FORBIDDEN', {
        message:
          'Recommended product cannot contain both productId and external link fields.',
        userMessage:
          'Pick either an internal product or an external link for each recommendation.',
      })
    }

    if (!hasInternal && (!hasExternalName || !hasExternalUrl)) {
      throw bookingError('FORBIDDEN', {
        message:
          'External recommended products require both externalName and externalUrl.',
        userMessage:
          'External recommendations need both a name and a link.',
      })
    }
  }
}

function assertValidFinalReviewRebookFields(args: {
  rebookMode: AftercareRebookMode | null
  rebookedFor: Date | null
  rebookWindowStart: Date | null
  rebookWindowEnd: Date | null
}): void {
  const {
    rebookMode,
    rebookedFor,
    rebookWindowStart,
    rebookWindowEnd,
  } = args

  if (rebookMode == null) {
    if (rebookedFor || rebookWindowStart || rebookWindowEnd) {
      throw bookingError('FORBIDDEN', {
        message:
          'Rebook fields were provided without a rebookMode.',
        userMessage: 'Choose a rebook option before saving rebook details.',
      })
    }
    return
  }

  if (rebookMode === AftercareRebookMode.NONE) {
    if (rebookedFor || rebookWindowStart || rebookWindowEnd) {
      throw bookingError('FORBIDDEN', {
        message: 'Rebook details must be empty when rebookMode is NONE.',
        userMessage:
          'Clear rebook dates if no follow-up booking is being recommended.',
      })
    }
    return
  }

  if (rebookMode === AftercareRebookMode.BOOKED_NEXT_APPOINTMENT) {
    if (!rebookedFor) {
      throw bookingError('FORBIDDEN', {
        message: 'rebookedFor is required for BOOKED_NEXT_APPOINTMENT.',
        userMessage: 'Add the next appointment date.',
      })
    }

    if (rebookWindowStart || rebookWindowEnd) {
      throw bookingError('FORBIDDEN', {
        message:
          'Recommended window fields are not allowed for BOOKED_NEXT_APPOINTMENT.',
        userMessage:
          'Use either a booked appointment date or a recommended window, not both.',
      })
    }

    return
  }

  if (rebookMode === AftercareRebookMode.RECOMMENDED_WINDOW) {
    if (!rebookWindowStart || !rebookWindowEnd) {
      throw bookingError('FORBIDDEN', {
        message:
          'rebookWindowStart and rebookWindowEnd are required for RECOMMENDED_WINDOW.',
        userMessage: 'Add both a recommended start and end date.',
      })
    }

    if (rebookedFor) {
      throw bookingError('FORBIDDEN', {
        message:
          'rebookedFor is not allowed for RECOMMENDED_WINDOW.',
        userMessage:
          'Use either a booked appointment date or a recommended window, not both.',
      })
    }

    if (rebookWindowStart.getTime() > rebookWindowEnd.getTime()) {
      throw bookingError('FORBIDDEN', {
        message:
          'rebookWindowStart must be before or equal to rebookWindowEnd.',
        userMessage:
          'The recommended rebook window start must be before the end.',
      })
    }
  }
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

type AddressSnapshotEncryptionInput = {
  formattedAddress: string | null
  lat: Prisma.Decimal | number | string | null | undefined
  lng: Prisma.Decimal | number | string | null | undefined
}

type AddressSnapshotWriteData = {
  legacySnapshot: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
  encryptedSnapshot: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
  keyVersion: string | null
  encryptedAt: Date | null
  latApprox: number | null
  lngApprox: number | null
}

function coarsenCoordinate(value: unknown): number | null {
  const numberValue = decimalToNumber(value)
  if (numberValue === undefined) return null

  return Number(numberValue.toFixed(4))
}

function buildNullAddressSnapshotData(input: {
  lat?: unknown
  lng?: unknown
} = {}): AddressSnapshotWriteData {
  return {
    legacySnapshot: Prisma.JsonNull,
    encryptedSnapshot: Prisma.JsonNull,
    keyVersion: null,
    encryptedAt: null,
    latApprox: coarsenCoordinate(input.lat),
    lngApprox: coarsenCoordinate(input.lng),
  }
}

function toValidatedEncryptedAddressSnapshotInput(
  snapshot: Prisma.JsonValue | null | undefined,
): Prisma.InputJsonValue | null {
  if (!isReusableAddressPrivacyEnvelope(snapshot)) return null

  return toInputJsonValue(snapshot)
}

function toValidatedLegacyAddressSnapshotInput(
  snapshot: Prisma.JsonValue | null | undefined,
): Prisma.InputJsonValue | null {
  if (snapshot == null) return null
  if (isReusableAddressPrivacyEnvelope(snapshot)) return null

  return toInputJsonValue(snapshot)
}

function buildEncryptedAddressSnapshotData(
  input: AddressSnapshotEncryptionInput,
): AddressSnapshotWriteData {
  const formattedAddress = normalizeAddress(input.formattedAddress)

  if (!formattedAddress) {
    return buildNullAddressSnapshotData(input)
  }

  const legacySnapshot = toInputJsonValue({
    formattedAddress,
  })

  const privacyData = buildAddressPrivacyWriteData({
    formattedAddress,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    countryCode: null,
    placeId: null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
  })

  return {
    legacySnapshot,
    encryptedSnapshot: privacyData.encryptedAddressJson,
    keyVersion: ADDRESS_KEY_VERSION,
    encryptedAt: new Date(),
    latApprox: decimalToNullableNumber(privacyData.latApprox),
    lngApprox: decimalToNullableNumber(privacyData.lngApprox),
  }
}

function reuseEncryptedAddressSnapshotData(
  input: {
    legacySnapshot: Prisma.JsonValue | null | undefined
    dedicatedEncryptedSnapshot?: Prisma.JsonValue | null | undefined
    keyVersion: string | null | undefined
    encryptedAt: Date | null | undefined
    latApprox?: unknown
    lngApprox?: unknown
    legacyLat?: unknown
    legacyLng?: unknown
    fallbackLat?: unknown
    fallbackLng?: unknown
  },
): AddressSnapshotWriteData {
  const dedicatedEncryptedSnapshot = toValidatedEncryptedAddressSnapshotInput(
    input.dedicatedEncryptedSnapshot,
  )
  const legacyEncryptedSnapshot = toValidatedEncryptedAddressSnapshotInput(
    input.legacySnapshot,
  )
  const encryptedSnapshot =
    dedicatedEncryptedSnapshot ?? legacyEncryptedSnapshot
  const hasEncryptedSnapshot = encryptedSnapshot !== null

  return {
  legacySnapshot:
    toValidatedLegacyAddressSnapshotInput(input.legacySnapshot) ?? Prisma.JsonNull,
    encryptedSnapshot: encryptedSnapshot ?? Prisma.JsonNull,
    keyVersion: hasEncryptedSnapshot
      ? input.keyVersion ?? ADDRESS_KEY_VERSION
      : null,
    encryptedAt: hasEncryptedSnapshot
      ? input.encryptedAt ?? new Date()
      : null,
    latApprox:
      coarsenCoordinate(input.latApprox) ??
      coarsenCoordinate(input.legacyLat) ??
      coarsenCoordinate(input.fallbackLat),
    lngApprox:
      coarsenCoordinate(input.lngApprox) ??
      coarsenCoordinate(input.legacyLng) ??
      coarsenCoordinate(input.fallbackLng),
  }
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

async function assertProfessionalIsBookingReady(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  bookingEntryPoint: ProBookingEntryPoint
}): Promise<void> {
  const readiness = await checkProReadinessForEntryPointWithDb({
    db: args.tx,
    professionalId: args.professionalId,
    entryPoint: args.bookingEntryPoint,
  })

  if (readiness.ok) return

  throw bookingError('PRO_NOT_READY', {
    message: `Professional is not ready to accept bookings: ${readiness.blockers.join(', ')}`,
  })
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
    subtotalSnapshot: moneyToFixed2String(subtotalSnapshot) ?? '0.00',
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
  reason: string | null
  appliedOverrides: ProSchedulingAppliedOverride[]
  bookingScheduledForBefore?: Date | null
  bookingScheduledForAfter: Date
  advanceNoticeMinutes: number
  maxDaysAhead: number
  workingHours: unknown
  timeZone: string
  requestId?: string | null
  idempotencyKey?: string | null
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
async function assertCanUseBookingOverrides(args: {
  actorUserId: string
  professionalId: string
  appliedOverrides: ProSchedulingAppliedOverride[]
}): Promise<void> {
  for (const rule of args.appliedOverrides) {
    await assertCanUseBookingOverride({
      actorUserId: args.actorUserId,
      professionalId: args.professionalId,
      rule,
    })
  }
}
async function createUpdateClientNotification(args: {
  tx: Prisma.TransactionClient
  clientId: string
  bookingId: string
  eventKey: NotificationEventKey
  title: string
  body: string | null
  dedupeKey: string
  aftercareId?: string | null
  href?: string | null
  data?: Prisma.InputJsonValue | null
}): Promise<void> {
  await upsertClientNotification({
    tx: args.tx,
    clientId: args.clientId,
    bookingId: args.bookingId,
    aftercareId: args.aftercareId ?? null,
    eventKey: args.eventKey,
    title: args.title,
    body: args.body,
    dedupeKey: args.dedupeKey,
    href: args.href ?? `/client/bookings/${args.bookingId}`,
    data: args.data,
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
  actor: CancelActor
  reason?: string | null
  notifyClient?: boolean
}): Promise<void> {
  const { booking, notifyClient } = args

  if (notifyClient !== true) return

  const reason = normalizeReason(args.reason)
  const eventKey =
    args.actor.kind === 'client'
      ? NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT
      : args.actor.kind === 'pro'
        ? NotificationEventKey.BOOKING_CANCELLED_BY_PRO
        : NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN

  const body = reason
    ? `Your appointment was cancelled. Reason: ${reason}`
    : 'Your appointment was cancelled.'

  await createUpdateClientNotification({
    tx: args.tx,
    clientId: booking.clientId,
    bookingId: booking.id,
    eventKey,
    title: 'Appointment cancelled',
    body,
    dedupeKey: `BOOKING_CANCELLED:${booking.id}`,
    href: `/client/bookings/${booking.id}?step=overview`,
    data: {
      bookingId: booking.id,
      reason: reason ?? null,
      cancelledBy: args.actor.kind,
      eventKey,
    },
  })
}

async function maybeCreateProBookingCancelledNotification(args: {
  tx: Prisma.TransactionClient
  booking: CancelBookingRecord
  actor: CancelActor
  reason?: string | null
}): Promise<void> {
  const reason = normalizeReason(args.reason)
  let eventKey: NotificationEventKey
  let title: string
  let body: string

  if (args.actor.kind === 'client') {
    eventKey = NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT
    title = 'Booking cancelled by client'
    body = reason
      ? `Client cancelled this booking. Reason: ${reason}`
      : 'Client cancelled this booking.'
  } else if (args.actor.kind === 'admin') {
    eventKey = NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN
    title = 'Booking cancelled by admin'
    body = reason
      ? `An admin cancelled this booking. Reason: ${reason}`
      : 'An admin cancelled this booking.'
  } else {
    // Pro cancelled their own booking.
    // Do not create a pro inbox notification for self-cancel.
    return
  }

  await createProNotification({
    tx: args.tx,
    professionalId: args.booking.professionalId,
    eventKey,
    priority: NotificationPriority.HIGH,
    title,
    body,
    href: `/pro/bookings/${args.booking.id}`,
    actorUserId: null,
    bookingId: args.booking.id,
    dedupeKey: `PRO_NOTIF:${eventKey}:${args.booking.id}`,
    data: {
      bookingId: args.booking.id,
      cancelledBy: args.actor.kind,
      reason: reason ?? null,
      previousStatus: args.booking.status,
      previousSessionStep: args.booking.sessionStep ?? SessionStep.NONE,
    },
  })
}

function toOptionalIsoString(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }

  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }

  return null
}

async function createProBookingRescheduledNotification(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  professionalId: string
  actorUserId: string | null
  previousScheduledFor: Date | string | null | undefined
  nextScheduledFor: Date | string | null | undefined
  previousLocationType: ServiceLocationType
  nextLocationType: ServiceLocationType
  previousLocationTimeZone: string | null
  nextLocationTimeZone: string | null
}): Promise<void> {
  await createProNotification({
    tx: args.tx,
    professionalId: args.professionalId,
    eventKey: NotificationEventKey.BOOKING_RESCHEDULED,
    priority: NotificationPriority.HIGH,
    title: 'Booking rescheduled',
    body: 'A booking was rescheduled.',
    href: `/pro/bookings/${args.bookingId}`,
    actorUserId: args.actorUserId,
    bookingId: args.bookingId,
    dedupeKey: `PRO_NOTIF:${NotificationEventKey.BOOKING_RESCHEDULED}:${args.bookingId}`,
    data: {
      bookingId: args.bookingId,
      previousScheduledFor: toOptionalIsoString(args.previousScheduledFor),
      nextScheduledFor: toOptionalIsoString(args.nextScheduledFor),
      previousLocationType: args.previousLocationType,
      nextLocationType: args.nextLocationType,
      previousLocationTimeZone: args.previousLocationTimeZone,
      nextLocationTimeZone: args.nextLocationTimeZone,
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

function logHoldCreateInternalError(args: {
  error: unknown
  clientId: string
  offeringId: string
  professionalId: string
  requestedStart: Date
  locationType: ServiceLocationType
  requestedLocationId: string | null
  resolvedLocationId: string
  resolvedTimeZone: string
  clientAddressId: string | null
  selectedClientAddressId: string | null
  durationMinutes: number
  bufferMinutes: number
}): void {
  // Route through safeError/safeLogMeta. Raw addresses, the salon/client
  // formatted address strings, and the BookingHold create payload (which
  // contains the address privacy envelope) are intentionally NOT logged —
  // hold-create failures must not leak PII into operational logs.
  console.error(
    'performLockedCreateHold internal error',
    {
      error: safeError(args.error),
      meta: safeLogMeta({
        clientId: args.clientId,
        offeringId: args.offeringId,
        professionalId: args.professionalId,
        requestedStart: args.requestedStart.toISOString(),
        locationType: args.locationType,
        requestedLocationId: args.requestedLocationId,
        resolvedLocationId: args.resolvedLocationId,
        resolvedTimeZone: args.resolvedTimeZone,
        clientAddressId: args.clientAddressId,
        selectedClientAddressId: args.selectedClientAddressId,
        durationMinutes: args.durationMinutes,
        bufferMinutes: args.bufferMinutes,
      }),
    },
  )
}

function logHoldCreateTiming(args: {
  outcome:
    | 'created'
    | 'policy_conflict'
    | 'p2002_conflict'
    | 'internal_error'
  clientId: string
  offeringId: string
  professionalId: string
  requestedStart: Date
  locationType: ServiceLocationType
  requestedLocationId: string | null
  resolvedLocationId?: string | null
  resolvedTimeZone?: string | null
  selectedClientAddressId?: string | null
  durationMinutes?: number | null
  bufferMinutes?: number | null
  totalMs: number
  clientAddressLoadMs: number
  validatedContextMs: number
  holdPolicyMs: number
  holdInsertMs: number
  scheduleVersionMs: number
  meta?: Record<string, unknown>
}): void {
  if (process.env.NODE_ENV !== 'test') return

  console.info('performLockedCreateHold timing', {
    outcome: args.outcome,
    clientId: args.clientId,
    offeringId: args.offeringId,
    professionalId: args.professionalId,
    requestedStart: args.requestedStart.toISOString(),
    locationType: args.locationType,
    requestedLocationId: args.requestedLocationId,
    resolvedLocationId: args.resolvedLocationId ?? null,
    resolvedTimeZone: args.resolvedTimeZone ?? null,
    selectedClientAddressId: args.selectedClientAddressId ?? null,
    durationMinutes: args.durationMinutes ?? null,
    bufferMinutes: args.bufferMinutes ?? null,
    totalMs: args.totalMs,
    clientAddressLoadMs: args.clientAddressLoadMs,
    validatedContextMs: args.validatedContextMs,
    holdPolicyMs: args.holdPolicyMs,
    holdInsertMs: args.holdInsertMs,
    scheduleVersionMs: args.scheduleVersionMs,
    ...(args.meta ?? {}),
  })
}
function mapAftercareRebookSlotOwnershipFailureToBookingError(
  code:
    | 'PROFESSIONAL_REQUIRED'
    | 'LOCATION_REQUIRED'
    | 'LOCATION_NOT_FOUND'
    | 'LOCATION_NOT_BOOKABLE'
    | 'LOCATION_TYPE_UNSUPPORTED'
    | 'OFFERING_NOT_FOUND'
    | 'OFFERING_INACTIVE'
    | 'OFFERING_LOCATION_TYPE_UNSUPPORTED',
): BookingErrorCode {
  switch (code) {
    case 'PROFESSIONAL_REQUIRED':
      return 'FORBIDDEN'
    case 'LOCATION_REQUIRED':
      return 'LOCATION_ID_REQUIRED'
    case 'LOCATION_NOT_FOUND':
      return 'LOCATION_NOT_FOUND'
    case 'LOCATION_NOT_BOOKABLE':
      return 'BAD_LOCATION'
    case 'LOCATION_TYPE_UNSUPPORTED':
      return 'MODE_NOT_SUPPORTED'
    case 'OFFERING_NOT_FOUND':
      return 'OFFERING_NOT_FOUND'
    case 'OFFERING_INACTIVE':
      return 'OFFERING_NOT_FOUND'
    case 'OFFERING_LOCATION_TYPE_UNSUPPORTED':
      return 'MODE_NOT_SUPPORTED'
  }
}

async function assertAftercareRebookSlotOwnership(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  rebookSlot: {
    offeringId: string
    locationId: string
    locationType: ServiceLocationType
  }
}): Promise<void> {
  const ownership = await validateAftercareRebookSlotOwnership({
    db: args.tx,
    slot: {
      professionalId: args.professionalId,
      offeringId: args.rebookSlot.offeringId,
      locationId: args.rebookSlot.locationId,
      locationType: args.rebookSlot.locationType,
    },
  })

  if (ownership.ok) return

  throw bookingError(
    mapAftercareRebookSlotOwnershipFailureToBookingError(ownership.code),
    {
      message: ownership.code,
      userMessage: ownership.userMessage,
    },
  )
}

function mapBookingOverlapBlockedCodeToBookingError(
  code:
    | 'CLIENT_OVERLAP_NOT_ALLOWED'
    | 'AFTERCARE_PRESELECTED_SLOT_REQUIRED'
    | 'AFTERCARE_PRESELECTED_SLOT_MISMATCH'
    | 'INVALID_BOOKING_WINDOW',
): BookingErrorCode {
  switch (code) {
    case 'CLIENT_OVERLAP_NOT_ALLOWED':
      return 'TIME_BOOKED'
    case 'AFTERCARE_PRESELECTED_SLOT_REQUIRED':
      return 'TIME_BOOKED'
    case 'AFTERCARE_PRESELECTED_SLOT_MISMATCH':
      return 'TIME_BOOKED'
    case 'INVALID_BOOKING_WINDOW':
      return 'INVALID_SCHEDULED_FOR'
  }
}

function logOverlapDecisionBlocked(args: {
  action: 'BOOKING_CREATE' | 'BOOKING_FINALIZE' | 'BOOKING_UPDATE'
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  offeringId: string | null
  clientId: string
  holdId?: string | null
  code:
    | 'CLIENT_OVERLAP_NOT_ALLOWED'
    | 'AFTERCARE_PRESELECTED_SLOT_REQUIRED'
    | 'AFTERCARE_PRESELECTED_SLOT_MISMATCH'
    | 'INVALID_BOOKING_WINDOW'
  conflictKinds: string[]
  sourceKind: string
  actorKind: string
}): void {
  logBookingConflict({
    action: args.action,
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: 'BOOKING',
    holdId: args.holdId ?? undefined,
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      offeringId: args.offeringId,
      clientId: args.clientId,
      overlapDecisionCode: args.code,
      conflictKinds: args.conflictKinds,
      sourceKind: args.sourceKind,
      actorKind: args.actorKind,
    },
  })
}

async function enforceBookingOverlapPolicy(args: {
  tx: Prisma.TransactionClient
  actor: BookingOverlapActor
  source: BookingOverlapSource
  requestedWindow: BookingWindow
  locationId: string
  locationType: ServiceLocationType
  offeringId: string | null
  clientId: string
  action: 'BOOKING_CREATE' | 'BOOKING_FINALIZE' | 'BOOKING_UPDATE'
  excludeHoldId?: string | null
  excludeBookingId?: string | null
  now: Date
}): Promise<void> {
  const conflicts = await findSchedulingConflicts({
    tx: args.tx,
    professionalId: args.requestedWindow.professionalId,
    startsAt: args.requestedWindow.startsAt,
    endsAt: args.requestedWindow.endsAt,
    excludeHoldId: args.excludeHoldId ?? null,
    excludeBookingId: args.excludeBookingId ?? null,
    now: args.now,
  })

  const decision = decideBookingOverlapPermission({
    actor: args.actor,
    source: args.source,
    requestedWindow: args.requestedWindow,
    conflicts: conflicts.all,
  })

  if (decision.ok) {
    return
  }

  logOverlapDecisionBlocked({
    action: args.action,
    professionalId: args.requestedWindow.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedWindow.startsAt,
    requestedEnd: args.requestedWindow.endsAt,
    offeringId: args.offeringId,
    clientId: args.clientId,
    holdId: args.excludeHoldId ?? null,
    code: decision.code,
    conflictKinds: decision.conflicts.map((conflict) => conflict.kind),
    sourceKind: args.source.kind,
    actorKind: args.actor.kind,
  })

  throw bookingError(
    mapBookingOverlapBlockedCodeToBookingError(decision.code),
    {
      message: decision.userMessage,
      userMessage: decision.userMessage,
    },
  )
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

  await cancelBookingAppointmentReminders({
    tx: args.tx,
    bookingId: booking.id,
  })

await maybeCreateBookingCancelledNotification({
  tx: args.tx,
  booking,
  actor: args.actor,
  notifyClient: args.notifyClient,
  reason: args.reason,
})
  await maybeCreateProBookingCancelledNotification({
    tx: args.tx,
    booking,
    actor: args.actor,
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
  requestId?: string | null
  idempotencyKey?: string | null
  explicitSelection?: boolean
  actorUserId?: string | null
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

    recordStepTransition({
      from: booking.sessionStep ?? SessionStep.NONE,
      to: SessionStep.CONSULTATION,
      actor: 'PRO',
      route: 'lib/booking/writeBoundary.ts:startBookingSession#heal',
      bookingId: booking.id,
      professionalId: args.professionalId,
    })
    recordStatusTransition({
      from: booking.status,
      to: BookingStatus.IN_PROGRESS,
      actor: 'PRO',
      route: 'lib/booking/writeBoundary.ts:startBookingSession#heal',
      bookingId: booking.id,
      professionalId: args.professionalId,
    })

    const healed = await args.tx.booking.update({
      where: { id: booking.id },
      data: {
        sessionStep: SessionStep.CONSULTATION,
        status: BookingStatus.IN_PROGRESS,
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
      } satisfies Prisma.BookingSelect,
    })

    await createBookingCloseoutAuditLog({
      tx: args.tx,
      bookingId: healed.id,
      professionalId: args.professionalId,
      action: BookingCloseoutAuditAction.SESSION_STEP_CHANGED,
      route: 'lib/booking/writeBoundary.ts:startBookingSession',
      requestId: args.requestId,
      idempotencyKey: args.idempotencyKey,
      oldValue: {
        startedAt: normalizeDateCmp(booking.startedAt),
        finishedAt: normalizeDateCmp(booking.finishedAt),
        sessionStep: booking.sessionStep ?? SessionStep.NONE,
        status: booking.status,
      },
      newValue: {
        startedAt: normalizeDateCmp(healed.startedAt),
        finishedAt: normalizeDateCmp(healed.finishedAt),
        sessionStep: healed.sessionStep ?? SessionStep.NONE,
        status: healed.status,
      },
      metadata: {
        trigger: 'heal_missing_session_step',
      },
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

  const outsideWindow = !isWithinStartWindow(booking.scheduledFor, args.now)

  if (outsideWindow && !args.explicitSelection) {
    throw bookingError('FORBIDDEN', {
      message:
        'You can start this appointment 15 minutes before or after the scheduled time.',
      userMessage:
        'You can start this appointment 15 minutes before or after the scheduled time.',
    })
  }

  if (outsideWindow && args.explicitSelection && args.actorUserId) {
    await args.tx.bookingOverrideAuditLog.create({
      data: {
        bookingId: booking.id,
        professionalId: args.professionalId,
        actorUserId: args.actorUserId,
        action: BookingOverrideAction.START,
        rule: BookingOverrideRule.START_WINDOW,
        reason: null,
        route: 'lib/booking/writeBoundary.ts:startBookingSession',
        requestId: args.requestId ?? null,
        oldValue: {
          withinWindow: false,
          scheduledFor: booking.scheduledFor.toISOString(),
          now: args.now.toISOString(),
          windowMinutes: 15,
        },
        newValue: {
          withinWindow: true,
          explicitSelection: true,
        },
        bookingScheduledForBefore: null,
        bookingScheduledForAfter: booking.scheduledFor,
        metadata: {
          source: 'explicit_selection_start',
          trigger: 'pro_explicit_start',
        },
      },
    })
  }

  recordStepTransition({
    from: booking.sessionStep ?? SessionStep.NONE,
    to: SessionStep.CONSULTATION,
    actor: 'PRO',
    route: 'lib/booking/writeBoundary.ts:startBookingSession',
    bookingId: booking.id,
    professionalId: args.professionalId,
  })
  recordStatusTransition({
    from: booking.status,
    to: BookingStatus.IN_PROGRESS,
    actor: 'PRO',
    route: 'lib/booking/writeBoundary.ts:startBookingSession',
    bookingId: booking.id,
    professionalId: args.professionalId,
  })

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      startedAt: args.now,
      sessionStep: SessionStep.CONSULTATION,
      status: BookingStatus.IN_PROGRESS,
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      sessionStep: true,
    } satisfies Prisma.BookingSelect,
  })

  await createBookingCloseoutAuditLog({
    tx: args.tx,
    bookingId: updated.id,
    professionalId: args.professionalId,
    action: BookingCloseoutAuditAction.SESSION_STARTED,
    route: 'lib/booking/writeBoundary.ts:startBookingSession',
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    oldValue: {
      startedAt: normalizeDateCmp(booking.startedAt),
      finishedAt: normalizeDateCmp(booking.finishedAt),
      sessionStep: booking.sessionStep ?? SessionStep.NONE,
      status: booking.status,
    },
    newValue: {
      startedAt: normalizeDateCmp(updated.startedAt),
      finishedAt: normalizeDateCmp(updated.finishedAt),
      sessionStep: updated.sessionStep ?? SessionStep.NONE,
      status: updated.status,
    },
  })

  await upsertClientNotification({
    tx: args.tx,
    clientId: booking.clientId,
    bookingId: booking.id,
    eventKey: NotificationEventKey.BOOKING_STARTED,
    title: 'Your appointment has started',
    body: "Your pro has started your session. They'll be with you shortly.",
    dedupeKey: `BOOKING_STARTED:${booking.id}`,
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
  requestId?: string | null
  idempotencyKey?: string | null
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

const approval = upper(booking.consultationApproval?.status)

if (approval !== 'APPROVED') {
  throw bookingError('FORBIDDEN', {
    message: 'Consultation must be approved before finishing the service.',
    userMessage:
      'Consultation must be approved before finishing the service.',
  })
}

if (step !== SessionStep.SERVICE_IN_PROGRESS) {
  throw bookingError('STEP_MISMATCH', {
    message: `Finish is only allowed from SERVICE_IN_PROGRESS. Current step: ${step}.`,
    userMessage:
      'Move through the required session steps before finishing the service.',
  })
}

recordStepTransition({
  from: step,
  to: SessionStep.FINISH_REVIEW,
  actor: 'PRO',
  route: 'lib/booking/writeBoundary.ts:finishBookingSession',
  bookingId: booking.id,
  professionalId: args.professionalId,
})

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

  const oldSessionState = buildSessionAuditSnapshot({
    status: booking.status,
    startedAt: booking.startedAt,
    finishedAt: booking.finishedAt,
    sessionStep: step,
  })

  const newSessionState = buildSessionAuditSnapshot({
    status: updated.status,
    startedAt: updated.startedAt,
    finishedAt: updated.finishedAt,
    sessionStep: updated.sessionStep,
  })

  await createBookingCloseoutAuditLog({
    tx: args.tx,
    bookingId: booking.id,
    professionalId: args.professionalId,
    action: BookingCloseoutAuditAction.SESSION_FINISHED,
    route: 'lib/booking/writeBoundary.ts:finishBookingSession',
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    oldValue: oldSessionState,
    newValue: newSessionState,
    metadata: {
      previousStep: step,
      nextStep: updated.sessionStep ?? SessionStep.NONE,
      afterCount,
    },
  })

  await createBookingCloseoutAuditLog({
    tx: args.tx,
    bookingId: booking.id,
    professionalId: args.professionalId,
    action: BookingCloseoutAuditAction.SESSION_STEP_CHANGED,
    route: 'lib/booking/writeBoundary.ts:finishBookingSession',
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    oldValue: {
      sessionStep: step,
    },
    newValue: {
      sessionStep: updated.sessionStep ?? SessionStep.NONE,
    },
    metadata: {
      trigger: 'finish_booking_session',
      afterCount,
    },
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

async function performLockedConfirmBookingFinalReview(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  professionalId: string
  finalLineItems: ConfirmBookingFinalReviewLineItemInput[]
  expectedSubtotal?: Prisma.Decimal | string | number | null
  recommendedProducts?: RecommendedProductInput[]
  rebookMode?: AftercareRebookMode | null
  rebookedFor?: Date | null
  rebookWindowStart?: Date | null
  rebookWindowEnd?: Date | null
  requestId?: string | null
  idempotencyKey?: string | null
}): Promise<ConfirmBookingFinalReviewResult> {
  const booking: FinalReviewBookingRecord | null = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: FINAL_REVIEW_BOOKING_SELECT,
  })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.professionalId !== args.professionalId) {
    throw bookingError('FORBIDDEN')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED')
  }

  if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
    throw bookingError('BOOKING_CANNOT_EDIT_COMPLETED')
  }

  if (!booking.startedAt) {
    throw bookingError('FORBIDDEN', {
      message: 'Final review is only available after the session has started.',
      userMessage: 'Start the session first.',
    })
  }

  const currentStep = booking.sessionStep ?? SessionStep.NONE

  if (
    currentStep !== SessionStep.FINISH_REVIEW &&
    currentStep !== SessionStep.AFTER_PHOTOS
  ) {
    throw bookingError('STEP_MISMATCH', {
      message: `Final review is only allowed in FINISH_REVIEW or as an idempotent retry from AFTER_PHOTOS. Current step: ${currentStep}.`,
      userMessage:
        'You can only confirm final review from the Finish Review step.',
    })
  }

  assertValidFinalReviewLineItems(args.finalLineItems)

  const recommendedProducts = args.recommendedProducts ?? []
  const rebookMode = args.rebookMode ?? AftercareRebookMode.NONE
  const rebookedFor = args.rebookedFor ?? null
  const rebookWindowStart = args.rebookWindowStart ?? null
  const rebookWindowEnd = args.rebookWindowEnd ?? null

  assertValidRecommendedProducts(recommendedProducts)
  assertValidFinalReviewRebookFields({
    rebookMode,
    rebookedFor,
    rebookWindowStart,
    rebookWindowEnd,
  })

  const normalizedIncomingItemsForComparison =
    normalizeFinalReviewLineItemsForComparison(args.finalLineItems)

  const existingItemsForComparison =
    buildExistingFinalReviewItemsForComparison(booking.serviceItems)

  const normalizedIncomingProductsForComparison =
    normalizeRecommendedProductsForComparison(recommendedProducts)

  const existingProductsForComparison =
    buildExistingRecommendedProductsForComparison(
      booking.aftercareSummary?.recommendedProducts,
    )

  const existingRebookMode =
    booking.aftercareSummary?.rebookMode ?? AftercareRebookMode.NONE

  const existingRebookedFor = normalizeDateCmp(
    booking.aftercareSummary?.rebookedFor,
  )
  const incomingRebookedFor = normalizeDateCmp(rebookedFor)

  const existingRebookWindowStart = normalizeDateCmp(
    booking.aftercareSummary?.rebookWindowStart,
  )
  const incomingRebookWindowStart = normalizeDateCmp(rebookWindowStart)

  const existingRebookWindowEnd = normalizeDateCmp(
    booking.aftercareSummary?.rebookWindowEnd,
  )
  const incomingRebookWindowEnd = normalizeDateCmp(rebookWindowEnd)

  const itemsUnchanged =
    JSON.stringify(normalizedIncomingItemsForComparison) ===
    JSON.stringify(existingItemsForComparison)

  const productsUnchanged =
    JSON.stringify(normalizedIncomingProductsForComparison) ===
    JSON.stringify(existingProductsForComparison)

  const rebookUnchanged =
    existingRebookMode === rebookMode &&
    existingRebookedFor === incomingRebookedFor &&
    existingRebookWindowStart === incomingRebookWindowStart &&
    existingRebookWindowEnd === incomingRebookWindowEnd

  if (
    itemsUnchanged &&
    productsUnchanged &&
    rebookUnchanged &&
    booking.sessionStep === SessionStep.AFTER_PHOTOS
  ) {
    return {
      booking: {
        id: booking.id,
        status: booking.status,
        sessionStep: booking.sessionStep ?? SessionStep.NONE,
        serviceId: booking.serviceId,
        offeringId: booking.offeringId,
        subtotalSnapshot: booking.subtotalSnapshot,
        totalDurationMinutes: booking.totalDurationMinutes ?? 0,
      },
      meta: buildMeta(false),
    }
  }

  const normalizedItems = [...args.finalLineItems]
    .map((item, index) => {
      const durationMinutes = normalizePositiveDurationMinutes(item.durationMinutes)
      const priceSnapshot = normalizePositiveMoneyDecimal(item.price)

      if (durationMinutes == null || priceSnapshot == null) {
        throw bookingError('INVALID_SERVICE_ITEMS')
      }

      return {
        bookingServiceItemId: item.bookingServiceItemId?.trim() || null,
        serviceId: item.serviceId.trim(),
        offeringId: item.offeringId?.trim() || null,
        itemType: item.itemType,
        priceSnapshot,
        durationMinutesSnapshot: durationMinutes,
        notes: normalizeReason(item.notes),
        sortOrder: Number.isFinite(item.sortOrder) ? Math.max(0, Math.trunc(item.sortOrder)) : index,
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const {
    primaryServiceId,
    primaryOfferingId,
    computedDurationMinutes,
    computedSubtotal,
  } = computeBookingItemLikeTotals(
    normalizedItems.map((item) => ({
      serviceId: item.serviceId,
      offeringId: item.offeringId,
      durationMinutesSnapshot: item.durationMinutesSnapshot,
      priceSnapshot: item.priceSnapshot,
      itemType: item.itemType,
    })),
    'INVALID_SERVICE_ITEMS',
  )

  if (args.expectedSubtotal != null) {
    const expectedSubtotal = normalizePositiveMoneyDecimal(args.expectedSubtotal)
    if (!expectedSubtotal || !expectedSubtotal.eq(computedSubtotal)) {
      throw bookingError('INVALID_SERVICE_ITEMS', {
        message: 'Submitted subtotal does not match computed line item subtotal.',
        userMessage: 'Subtotal does not match the final line items.',
      })
    }
  }

  await args.tx.bookingServiceItem.deleteMany({
    where: { bookingId: booking.id },
  })

  const baseItem = normalizedItems.find(
    (item) => item.itemType === BookingServiceItemType.BASE,
  )

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
      notes: baseItem.notes,
      sortOrder: 0,
    },
    select: { id: true },
  })

  const addOnItems = normalizedItems.filter(
    (item) => item.itemType === BookingServiceItemType.ADD_ON,
  )

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
        notes: item.notes,
        sortOrder: index + 1,
      })),
    })
  }

  const checkoutRollup = await buildBookingCheckoutRollupUpdate({
    tx: args.tx,
    bookingId: booking.id,
    nextServiceSubtotal: computedSubtotal,
  })


  const now = new Date()
  const nextVersion = (booking.aftercareSummary?.version ?? 0) + 1

  const aftercare = await args.tx.aftercareSummary.upsert({
    where: { bookingId: booking.id },
    create: {
      bookingId: booking.id,
      notes: booking.aftercareSummary?.notes ?? null,
      rebookMode,
      rebookedFor,
      rebookWindowStart,
      rebookWindowEnd,
      draftSavedAt: now,
      sentToClientAt: booking.aftercareSummary?.sentToClientAt ?? null,
      lastEditedAt: now,
      version: 1,
    },
    update: {
      notes: booking.aftercareSummary?.notes ?? null,
      rebookMode,
      rebookedFor,
      rebookWindowStart,
      rebookWindowEnd,
      draftSavedAt: now,
      sentToClientAt: booking.aftercareSummary?.sentToClientAt ?? null,
      lastEditedAt: now,
      version: nextVersion,
    },
    select: {
      id: true,
    },
  })

  await args.tx.productRecommendation.deleteMany({
    where: { aftercareSummaryId: aftercare.id },
  })

  const internalProductIds = Array.from(
    new Set(
      recommendedProducts
        .map((product) => product.productId)
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0,
        ),
    ),
  )

  if (internalProductIds.length > 0) {
    const validProducts = await args.tx.product.findMany({
      where: {
        id: { in: internalProductIds },
        isActive: true,
      },
      select: { id: true },
      take: internalProductIds.length,
    })

    if (validProducts.length !== internalProductIds.length) {
      throw bookingError('FORBIDDEN', {
        message: 'One or more recommended products are invalid.',
        userMessage: 'One or more selected products are no longer available.',
      })
    }
  }

  if (recommendedProducts.length > 0) {
    await args.tx.productRecommendation.createMany({
      data: recommendedProducts.map((product) => ({
        aftercareSummaryId: aftercare.id,
        productId: product.productId,
        externalName: product.externalName,
        externalUrl: product.externalUrl,
        note: product.note,
      })),
    })
  }

  recordStepTransition({
    from: currentStep,
    to: SessionStep.AFTER_PHOTOS,
    actor: 'PRO',
    route: 'lib/booking/writeBoundary.ts:confirmBookingFinalReview',
    bookingId: booking.id,
    professionalId: args.professionalId,
  })

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      serviceId: primaryServiceId,
      offeringId: primaryOfferingId,
      subtotalSnapshot: checkoutRollup.subtotalSnapshot,
      serviceSubtotalSnapshot: checkoutRollup.serviceSubtotalSnapshot,
      productSubtotalSnapshot: checkoutRollup.productSubtotalSnapshot,
      tipAmount: checkoutRollup.tipAmount,
      taxAmount: checkoutRollup.taxAmount,
      discountAmount: checkoutRollup.discountAmount,
      totalAmount: checkoutRollup.totalAmount,
      totalDurationMinutes: computedDurationMinutes,
      sessionStep: SessionStep.AFTER_PHOTOS,
      checkoutStatus: BookingCheckoutStatus.READY,
    },
    select: {
      id: true,
      status: true,
      sessionStep: true,
      serviceId: true,
      offeringId: true,
      subtotalSnapshot: true,
      totalDurationMinutes: true,
    } satisfies Prisma.BookingSelect,
  })

  const oldFinalReviewState = {
  sessionStep: booking.sessionStep ?? SessionStep.NONE,
  serviceId: booking.serviceId,
  offeringId: booking.offeringId,
  subtotalSnapshot: normalizeDecimalCmp(booking.subtotalSnapshot),
  totalDurationMinutes: booking.totalDurationMinutes ?? 0,
  finalLineItems: existingItemsForComparison,
  recommendedProducts: existingProductsForComparison,
  rebookMode: existingRebookMode,
  rebookedFor: existingRebookedFor,
  rebookWindowStart: existingRebookWindowStart,
  rebookWindowEnd: existingRebookWindowEnd,
}

const newFinalReviewState = {
  sessionStep: updated.sessionStep ?? SessionStep.NONE,
  serviceId: updated.serviceId,
  offeringId: updated.offeringId,
  subtotalSnapshot: normalizeDecimalCmp(updated.subtotalSnapshot),
  totalDurationMinutes: updated.totalDurationMinutes ?? 0,
  finalLineItems: normalizedIncomingItemsForComparison,
  recommendedProducts: normalizedIncomingProductsForComparison,
  rebookMode,
  rebookedFor: incomingRebookedFor,
  rebookWindowStart: incomingRebookWindowStart,
  rebookWindowEnd: incomingRebookWindowEnd,
}

if (!areAuditValuesEqual(oldFinalReviewState, newFinalReviewState)) {
  await createBookingCloseoutAuditLog({
    tx: args.tx,
    bookingId: booking.id,
    professionalId: args.professionalId,
    action: BookingCloseoutAuditAction.FINAL_REVIEW_CONFIRMED,
    route: 'lib/booking/writeBoundary.ts:confirmBookingFinalReview',
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    oldValue: oldFinalReviewState,
    newValue: newFinalReviewState,
  })
}

  return {
    booking: {
      id: updated.id,
      status: updated.status,
      sessionStep: updated.sessionStep ?? SessionStep.NONE,
      serviceId: updated.serviceId,
      offeringId: updated.offeringId,
      subtotalSnapshot: updated.subtotalSnapshot,
      totalDurationMinutes: updated.totalDurationMinutes ?? 0,
    },
    meta: buildMeta(true),
  }
}

async function performLockedTransitionSessionStep(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  professionalId: string
  nextStep: SessionStep
  requestId?: string | null
  idempotencyKey?: string | null
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

  const from = booking.sessionStep ?? SessionStep.NONE

  if (booking.status === BookingStatus.PENDING) {
    if (
      args.nextStep !== SessionStep.CONSULTATION &&
      args.nextStep !== SessionStep.NONE
    ) {
      const forced = await args.tx.booking.update({
        where: { id: booking.id },
        data: { sessionStep: SessionStep.CONSULTATION },
        select: {
          id: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          sessionStep: true,
        } satisfies Prisma.BookingSelect,
      })

      if (from !== (forced.sessionStep ?? SessionStep.NONE)) {
        await createBookingCloseoutAuditLog({
          tx: args.tx,
          bookingId: booking.id,
          professionalId: args.professionalId,
          action: BookingCloseoutAuditAction.SESSION_STEP_CHANGED,
          route: 'lib/booking/writeBoundary.ts:transitionSessionStep',
          requestId: args.requestId,
          idempotencyKey: args.idempotencyKey,
          oldValue: {
            sessionStep: from,
          },
          newValue: {
            sessionStep: forced.sessionStep ?? SessionStep.NONE,
          },
          metadata: {
            trigger: 'forced_reset_pending_booking',
            requestedStep: args.nextStep,
          },
        })
      }

      return {
        ok: false,
        status: 409,
        error: 'Pending bookings are consultation-only.',
        forcedStep: SessionStep.CONSULTATION,
        meta: buildMeta(true),
      }
    }
  }

  if (from === args.nextStep) {
    return {
      ok: true,
      booking: {
        id: booking.id,
        sessionStep: from,
        startedAt: booking.startedAt,
      },
      meta: buildMeta(false),
    }
  }

  const approval = upper(booking.consultationApproval?.status)

  const shouldHealApprovedPendingConsultation =
    from === SessionStep.CONSULTATION_PENDING_CLIENT &&
    approval === 'APPROVED' &&
    (
      args.nextStep === SessionStep.BEFORE_PHOTOS ||
      args.nextStep === SessionStep.SERVICE_IN_PROGRESS
    )

  const effectiveFrom = shouldHealApprovedPendingConsultation
    ? SessionStep.BEFORE_PHOTOS
    : from

  if (!isAllowedSessionTransition(effectiveFrom, args.nextStep)) {
    return {
      ok: false,
      status: 409,
      error: `Invalid transition: ${from} → ${args.nextStep}.`,
      meta: buildMeta(false),
    }
  }

  if (
    effectiveFrom === SessionStep.FINISH_REVIEW &&
    args.nextStep === SessionStep.AFTER_PHOTOS
  ) {

    return {
      ok: false,
      status: 409,
      error: 'Use confirmBookingFinalReview before moving past Finish Review.',
      meta: buildMeta(false),
    }
  }

  if (
    requiresApprovedConsultForStep(args.nextStep) &&
    approval !== 'APPROVED'
  ) {
    const forced = await args.tx.booking.update({
      where: { id: booking.id },
      data: { sessionStep: SessionStep.CONSULTATION },
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
      } satisfies Prisma.BookingSelect,
    })

    if (from !== (forced.sessionStep ?? SessionStep.NONE)) {
      await createBookingCloseoutAuditLog({
        tx: args.tx,
        bookingId: booking.id,
        professionalId: args.professionalId,
        action: BookingCloseoutAuditAction.SESSION_STEP_CHANGED,
        route: 'lib/booking/writeBoundary.ts:transitionSessionStep',
        requestId: args.requestId,
        idempotencyKey: args.idempotencyKey,
        oldValue: {
          sessionStep: from,
        },
        newValue: {
          sessionStep: forced.sessionStep ?? SessionStep.NONE,
        },
        metadata: {
          trigger: 'forced_reset_consultation_required',
          requestedStep: args.nextStep,
          approvalStatus: approval ?? null,
        },
      })
    }

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
  return {
    ok: false,
    status: 409,
    error:
      'Use aftercare and checkout completion before marking the booking done.',
    forcedStep: SessionStep.AFTER_PHOTOS,
    meta: buildMeta(false),
  }
}

  const shouldSetStartedAt =
    args.nextStep === SessionStep.SERVICE_IN_PROGRESS &&
    !booking.startedAt

  recordStepTransition({
    from: effectiveFrom,
    to: args.nextStep,
    actor: 'PRO',
    route: 'lib/booking/writeBoundary.ts:transitionSessionStep',
    bookingId: booking.id,
    professionalId: args.professionalId,
  })
  if (shouldSetStartedAt) {
    recordStatusTransition({
      from: booking.status,
      to: BookingStatus.IN_PROGRESS,
      actor: 'PRO',
      route: 'lib/booking/writeBoundary.ts:transitionSessionStep#implicitStart',
      bookingId: booking.id,
      professionalId: args.professionalId,
    })
  }

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      sessionStep: args.nextStep,
      ...(shouldSetStartedAt
        ? { startedAt: new Date(), status: BookingStatus.IN_PROGRESS }
        : {}),
    },
    select: {
      id: true,
      status: true,
      sessionStep: true,
      startedAt: true,
      finishedAt: true,
    } satisfies Prisma.BookingSelect,
  })

    const oldSessionState = buildSessionAuditSnapshot({
    status: booking.status,
    startedAt: booking.startedAt,
    finishedAt: booking.finishedAt,
    sessionStep: effectiveFrom,
  })

  const newSessionState = buildSessionAuditSnapshot({
    status: updated.status,
    startedAt: updated.startedAt,
    finishedAt: updated.finishedAt,
    sessionStep: updated.sessionStep,
  })

  if (shouldSetStartedAt && !booking.startedAt && updated.startedAt) {
    await createBookingCloseoutAuditLog({
      tx: args.tx,
      bookingId: booking.id,
      professionalId: args.professionalId,
      action: BookingCloseoutAuditAction.SESSION_STARTED,
      route: 'lib/booking/writeBoundary.ts:transitionSessionStep',
      requestId: args.requestId,
      idempotencyKey: args.idempotencyKey,
      oldValue: oldSessionState,
      newValue: newSessionState,
      metadata: {
        trigger: 'implicit_start_from_session_step_transition',
        previousStep: effectiveFrom,
        nextStep: updated.sessionStep ?? SessionStep.NONE,
      },
    })
  }

  await createBookingCloseoutAuditLog({
    tx: args.tx,
    bookingId: booking.id,
    professionalId: args.professionalId,
    action: BookingCloseoutAuditAction.SESSION_STEP_CHANGED,
    route: 'lib/booking/writeBoundary.ts:transitionSessionStep',
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    oldValue: {
      sessionStep: effectiveFrom,
    },
    newValue: {
      sessionStep: updated.sessionStep ?? SessionStep.NONE,
    },
    metadata: {
      previousStep: effectiveFrom,
      nextStep: updated.sessionStep ?? SessionStep.NONE,
      implicitStart: shouldSetStartedAt && !booking.startedAt,
    },
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
  requestId?: string | null
  idempotencyKey?: string | null
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

  if (args.phase === MediaPhase.AFTER && !booking.startedAt) {
    throw bookingError('STEP_MISMATCH', {
      message: 'AFTER media uploads require a started booking session.',
      userMessage: 'After photos can only be uploaded after the booking session has started.',
    })
  }

  const proTenantId = await resolveProTenantId(args.tx, booking.professionalId)

  const created: BookingMediaAssetRecord = await args.tx.mediaAsset.create({
    data: {
      ...buildMediaAssetCreateData({
        professionalId: booking.professionalId,
        proTenantId,
        bookingId: booking.id,
        uploadedByUserId: args.uploadedByUserId,
        uploadedByRole: Role.PRO,

        storageBucket: args.storageBucket,
        storagePath: args.storagePath,
        thumbBucket: args.thumbBucket,
        thumbPath: args.thumbPath,

        mediaType: args.mediaType,
        phase: args.phase,
        caption: args.caption,

        visibility: MediaVisibility.PRO_CLIENT,
      }),
    },
    select: BOOKING_MEDIA_ASSET_SELECT,
  })

  const auditAction = getBookingMediaUploadAuditAction(args.phase)

  if (auditAction) {
    await createBookingCloseoutAuditLog({
      tx: args.tx,
      bookingId: booking.id,
      professionalId: args.professionalId,
      action: auditAction,
      route: 'lib/booking/writeBoundary.ts:uploadProBookingMedia',
      requestId: args.requestId,
      idempotencyKey: args.idempotencyKey,
      oldValue: {
        mediaAssetId: null,
      },
      newValue: {
        mediaAssetId: created.id,
        phase: created.phase,
        mediaType: created.mediaType,
        visibility: created.visibility,
        caption: created.caption,
        storageBucket: created.storageBucket,
        storagePath: created.storagePath,
        thumbBucket: created.thumbBucket,
        thumbPath: created.thumbPath,
        uploadedByUserId: args.uploadedByUserId,
        uploadedByRole: Role.PRO,
      },
      metadata: {
        trigger: 'pro_booking_media_upload',
        previousSessionStep: booking.sessionStep ?? SessionStep.NONE,
      },
    })
  }

  const advancedTo: SessionStep | null = null

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
  bookingEntryPoint: ProBookingEntryPoint
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
    bookingEntryPoint,
    offering,
    requestedStart,
    requestedLocationId,
    locationType,
    clientAddressId,
  } = args

  await assertProfessionalIsBookingReady({
    tx,
    professionalId: offering.professionalId,
    bookingEntryPoint,
  })

  const startedAtMs = Date.now()
  let afterClientAddressLoadMs = startedAtMs
  let afterValidatedContextMs = startedAtMs
  let afterHoldPolicyMs = startedAtMs
  let afterHoldInsertMs = startedAtMs
  let afterScheduleVersionMs = startedAtMs

  const buildHoldCreateTiming = (
    outcome: 'created' | 'policy_conflict' | 'p2002_conflict' | 'internal_error',
    meta?: Record<string, unknown>,
  ) => ({
    outcome,
    clientId,
    offeringId: offering.id,
    professionalId: offering.professionalId,
    requestedStart,
    locationType,
    requestedLocationId,
    resolvedLocationId: locationContextOrNull?.locationId ?? null,
    resolvedTimeZone: locationContextOrNull?.timeZone ?? null,
    selectedClientAddressId: selectedClientAddress?.id ?? null,
    durationMinutes: durationMinutesOrNull,
    bufferMinutes: locationContextOrNull?.bufferMinutes ?? null,
    totalMs: Date.now() - startedAtMs,
    clientAddressLoadMs: afterClientAddressLoadMs - startedAtMs,
    validatedContextMs: afterValidatedContextMs - afterClientAddressLoadMs,
    holdPolicyMs: afterHoldPolicyMs - afterValidatedContextMs,
    holdInsertMs: afterHoldInsertMs - afterHoldPolicyMs,
    scheduleVersionMs: afterScheduleVersionMs - afterHoldInsertMs,
    meta,
  })

    let locationContextOrNull: {
    locationId: string
    timeZone: string
    bufferMinutes: number
  } | null = null

  let durationMinutesOrNull: number | null = null

  const selectedClientAddress =
    locationType === ServiceLocationType.MOBILE && clientAddressId
      ? await loadClientServiceAddress({
          tx,
          clientId,
          clientAddressId,
        })
      : null

      afterClientAddressLoadMs = Date.now()

if (locationType === ServiceLocationType.MOBILE && clientAddressId && !selectedClientAddress) {
  throw bookingError('CLIENT_SERVICE_ADDRESS_INVALID', {
    message: 'Selected client service address was not found or is not owned by this client.',
    userMessage: 'Please choose a valid saved service address.',
  })
}

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

  afterValidatedContextMs = Date.now()

  if (!validatedContextResult.ok) {
    mapSchedulingReadinessFailure(validatedContextResult.error)
  }

  const locationContext = validatedContextResult.context
  const durationMinutes = validatedContextResult.durationMinutes

  locationContextOrNull = locationContext
  durationMinutesOrNull = durationMinutes

  await assertMobileBookingWithinRadius({
    tx,
    professionalId: offering.professionalId,
    locationType,
    locationLat: locationContext.lat,
    locationLng: locationContext.lng,
    clientAddressId:
      locationType === ServiceLocationType.MOBILE
        ? selectedClientAddress?.id ?? clientAddressId
        : null,
    clientLat:
      locationType === ServiceLocationType.MOBILE && selectedClientAddress
        ? decimalToNumber(selectedClientAddress.lat)
        : null,
    clientLng:
      locationType === ServiceLocationType.MOBILE && selectedClientAddress
        ? decimalToNumber(selectedClientAddress.lng)
        : null,
  })

  const salonLocationAddress =
    locationType === ServiceLocationType.SALON
      ? normalizeAddress(locationContext.formattedAddress)
      : null

  const deletedExpiredHoldCount = await deleteExpiredHoldsForProfessional({
    tx,
    professionalId: offering.professionalId,
    now,
  })

  const deletedClientHoldCount = await deleteActiveHoldsForClient({
    tx,
    professionalId: offering.professionalId,
    clientId,
    now,
  })

  const didDeleteExistingHolds =
    deletedExpiredHoldCount > 0 || deletedClientHoldCount > 0

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

afterHoldPolicyMs = Date.now()

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

    afterHoldInsertMs = afterHoldPolicyMs

    if (didDeleteExistingHolds) {
      await bumpProfessionalScheduleVersion(offering.professionalId)
      afterScheduleVersionMs = Date.now()
    } else {
      afterScheduleVersionMs = afterHoldPolicyMs
    }

    logHoldCreateTiming(
      buildHoldCreateTiming('policy_conflict', {
        decisionCode: decision.code,
      }),
    )

    throw bookingError(decision.code, {
      message: decision.message,
      userMessage: decision.userMessage,
    })
  }

  const requestedEnd = decision.value.requestedEnd
  const expiresAt = addMinutes(now, HOLD_MINUTES)

  const locationAddressSnapshotData =
    locationType === ServiceLocationType.SALON
      ? buildEncryptedAddressSnapshotData({
          formattedAddress: salonLocationAddress,
          lat: locationContext.lat,
          lng: locationContext.lng,
        })
      : buildNullAddressSnapshotData({
          lat: locationContext.lat,
          lng: locationContext.lng,
        })

  const clientAddressSnapshotData =
    locationType === ServiceLocationType.MOBILE && selectedClientAddress
      ? buildEncryptedAddressSnapshotData({
          formattedAddress: clientServiceAddress,
          lat: selectedClientAddress.lat,
          lng: selectedClientAddress.lng,
        })
      : buildNullAddressSnapshotData()

  const addressSnapshotsEncryptedAt =
    locationAddressSnapshotData.encryptedAt ??
    clientAddressSnapshotData.encryptedAt

  const holdCreateData = {
    offeringId: offering.id,
    professionalId: offering.professionalId,
    clientId,
    scheduledFor: requestedStart,
    endsAtSnapshot: requestedEnd,
    durationMinutesSnapshot: durationMinutes,
    bufferMinutesSnapshot: locationContext.bufferMinutes,
    expiresAt,
    locationType,
    locationId: locationContext.locationId,
    locationTimeZone: locationContext.timeZone,

    // Legacy expand-phase columns (kept populated for backward compatibility
    // with readers that have not migrated to the dedicated columns yet).
    locationAddressSnapshot: locationAddressSnapshotData.legacySnapshot,
    locationAddressSnapshotKeyVersion: locationAddressSnapshotData.keyVersion,
    locationLatSnapshot: locationAddressSnapshotData.latApprox,
    locationLngSnapshot: locationAddressSnapshotData.lngApprox,

    // Dedicated encrypted snapshot columns (canonical going forward).
    encryptedLocationAddressSnapshotJson:
      locationAddressSnapshotData.encryptedSnapshot,
    locationLatApprox: locationAddressSnapshotData.latApprox,
    locationLngApprox: locationAddressSnapshotData.lngApprox,

    clientAddressId:
      locationType === ServiceLocationType.MOBILE && selectedClientAddress
        ? selectedClientAddress.id
        : null,

    // Legacy
    clientAddressSnapshot: clientAddressSnapshotData.legacySnapshot,
    clientAddressSnapshotKeyVersion: clientAddressSnapshotData.keyVersion,
    clientAddressLatSnapshot: clientAddressSnapshotData.latApprox,
    clientAddressLngSnapshot: clientAddressSnapshotData.lngApprox,

    // Dedicated
    encryptedClientAddressSnapshotJson:
      clientAddressSnapshotData.encryptedSnapshot,
    clientAddressLatApprox: clientAddressSnapshotData.latApprox,
    clientAddressLngApprox: clientAddressSnapshotData.lngApprox,

    addressSnapshotsEncryptedAt,
  } satisfies Prisma.BookingHoldUncheckedCreateInput

  try {
    const hold: CreateHoldRecord = await tx.bookingHold.create({
      data: holdCreateData,
      select: CREATE_HOLD_SELECT,
    })

      afterHoldInsertMs = Date.now()

    await bumpProfessionalScheduleVersion(offering.professionalId)

    afterScheduleVersionMs = Date.now()

    logHoldCreateTiming(buildHoldCreateTiming('created'))

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

            afterHoldInsertMs = Date.now()
      afterScheduleVersionMs = afterHoldInsertMs

      logHoldCreateTiming(
        buildHoldCreateTiming('p2002_conflict', {
          prismaCode: error.code,
        }),
      )
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

    afterHoldInsertMs = Date.now()
    afterScheduleVersionMs = afterHoldInsertMs

    logHoldCreateTiming(buildHoldCreateTiming('internal_error'))

    logHoldCreateInternalError({
      error,
      clientId,
      offeringId: offering.id,
      professionalId: offering.professionalId,
      requestedStart,
      locationType,
      requestedLocationId,
      resolvedLocationId: locationContext.locationId,
      resolvedTimeZone: locationContext.timeZone,
      clientAddressId,
      selectedClientAddressId: selectedClientAddress?.id ?? null,
      durationMinutes,
      bufferMinutes: locationContext.bufferMinutes,
    })

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

await enforceBookingOverlapPolicy({
  tx: args.tx,
  actor: {
    kind: 'CLIENT',
    userId: args.clientId,
    clientId: args.clientId,
  },
  source: {
    kind: 'DIRECT_PROFILE',
  },
  requestedWindow: {
    professionalId: booking.professionalId,
    startsAt: newStart,
    endsAt: decision.value.requestedEnd,
  },
  locationId: locationContext.locationId,
  locationType: validatedHold.value.locationType,
  offeringId: booking.offeringId,
  clientId: args.clientId,
  action: 'BOOKING_UPDATE',
  excludeHoldId: hold.id,
  excludeBookingId: booking.id,
  now: args.now,
})

  const salonLocationAddressSnapshotData =
    validatedHold.value.locationType === ServiceLocationType.SALON
      ? reuseEncryptedAddressSnapshotData({
          legacySnapshot: hold.locationAddressSnapshot,
          dedicatedEncryptedSnapshot:
            hold.encryptedLocationAddressSnapshotJson,
          keyVersion: hold.locationAddressSnapshotKeyVersion,
          encryptedAt: hold.addressSnapshotsEncryptedAt,
          latApprox: hold.locationLatApprox,
          lngApprox: hold.locationLngApprox,
          legacyLat: hold.locationLatSnapshot,
          legacyLng: hold.locationLngSnapshot,
          fallbackLat: locationContext.lat,
          fallbackLng: locationContext.lng,
        })
      : buildNullAddressSnapshotData({
          lat: hold.locationLatApprox ?? hold.locationLatSnapshot,
          lng: hold.locationLngApprox ?? hold.locationLngSnapshot,
        })

  const mobileClientAddressSnapshotData =
    validatedHold.value.locationType === ServiceLocationType.MOBILE
      ? reuseEncryptedAddressSnapshotData({
          legacySnapshot: hold.clientAddressSnapshot,
          dedicatedEncryptedSnapshot: hold.encryptedClientAddressSnapshotJson,
          keyVersion: hold.clientAddressSnapshotKeyVersion,
          encryptedAt: hold.addressSnapshotsEncryptedAt,
          latApprox: hold.clientAddressLatApprox,
          lngApprox: hold.clientAddressLngApprox,
          legacyLat: hold.clientAddressLatSnapshot,
          legacyLng: hold.clientAddressLngSnapshot,
        })
      : buildNullAddressSnapshotData()

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      scheduledFor: newStart,
      locationType: validatedHold.value.locationType,
      bufferMinutes: locationContext.bufferMinutes,
      locationId: locationContext.locationId,
      locationTimeZone: locationContext.timeZone,

      // Legacy expand-phase columns.
      locationAddressSnapshot: salonLocationAddressSnapshotData.legacySnapshot,
      locationAddressSnapshotKeyVersion: salonLocationAddressSnapshotData.keyVersion,
      locationLatSnapshot:
        decimalToNumber(hold.locationLatSnapshot) ?? locationContext.lat,
      locationLngSnapshot:
        decimalToNumber(hold.locationLngSnapshot) ?? locationContext.lng,

      // Dedicated encrypted snapshot columns.
      encryptedLocationAddressSnapshotJson:
        salonLocationAddressSnapshotData.encryptedSnapshot,
      locationLatApprox: salonLocationAddressSnapshotData.latApprox,
      locationLngApprox: salonLocationAddressSnapshotData.lngApprox,

      clientAddressId:
        validatedHold.value.locationType === ServiceLocationType.MOBILE
          ? validatedHold.value.holdClientAddressId
          : null,

      // Legacy
      clientAddressSnapshot: mobileClientAddressSnapshotData.legacySnapshot,
      clientAddressSnapshotKeyVersion: mobileClientAddressSnapshotData.keyVersion,
      clientAddressLatSnapshot:
        validatedHold.value.locationType === ServiceLocationType.MOBILE
          ? decimalToNumber(hold.clientAddressLatSnapshot)
          : null,
      clientAddressLngSnapshot:
        validatedHold.value.locationType === ServiceLocationType.MOBILE
          ? decimalToNumber(hold.clientAddressLngSnapshot)
          : null,

      // Dedicated
      encryptedClientAddressSnapshotJson:
        mobileClientAddressSnapshotData.encryptedSnapshot,
      clientAddressLatApprox: mobileClientAddressSnapshotData.latApprox,
      clientAddressLngApprox: mobileClientAddressSnapshotData.lngApprox,

      addressSnapshotsEncryptedAt:
        salonLocationAddressSnapshotData.encryptedAt ??
        mobileClientAddressSnapshotData.encryptedAt,
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

  await syncBookingAppointmentReminders({
    tx: args.tx,
    bookingId: updated.id,
  })

  await createProBookingRescheduledNotification({
    tx: args.tx,
    bookingId: updated.id,
    professionalId: booking.professionalId,
    actorUserId: null,
    previousScheduledFor: booking.scheduledFor,
    nextScheduledFor: updated.scheduledFor,
    previousLocationType: booking.locationType,
    nextLocationType: updated.locationType,
    previousLocationTimeZone: booking.locationTimeZone ?? null,
    nextLocationTimeZone: updated.locationTimeZone ?? null,
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

function parseConsultationProposedItems(
  value: Prisma.JsonValue,
): ConsultationProposedServiceItem[] {
  if (!isJsonObjectRecord(value)) {
    throw bookingError('INVALID_SERVICE_ITEMS')
  }

  const rawItems = value.items

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw bookingError('INVALID_SERVICE_ITEMS')
  }

  return rawItems.map((row, index) => {
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
        typeof row.sortOrder === 'number' && Number.isFinite(row.sortOrder)
          ? row.sortOrder
          : index,
    }
  })
}

async function performLockedApproveConsultationMaterialization(
  args: ApproveConsultationMaterializationArgs,
): Promise<ApproveConsultationMaterializationResult> {
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

  if (approval.proof?.id) {
    throw bookingError('FORBIDDEN', {
      message: 'Consultation approval already has proof recorded.',
      userMessage: 'Consultation proposal is no longer pending.',
    })
  }

  const proposedItems = parseConsultationProposedItems(
    approval.proposedServicesJson,
  )

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

  const checkoutRollup = await buildBookingCheckoutRollupUpdate({
    tx: args.tx,
    bookingId: booking.id,
    nextServiceSubtotal: computedSubtotal,
  })

  const updatedBooking = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      serviceId: primaryServiceId,
      offeringId: primaryOfferingId,
      subtotalSnapshot: checkoutRollup.subtotalSnapshot,
      serviceSubtotalSnapshot: checkoutRollup.serviceSubtotalSnapshot,
      productSubtotalSnapshot: checkoutRollup.productSubtotalSnapshot,
      tipAmount: checkoutRollup.tipAmount,
      taxAmount: checkoutRollup.taxAmount,
      discountAmount: checkoutRollup.discountAmount,
      totalAmount: checkoutRollup.totalAmount,
      totalDurationMinutes: computedDurationMinutes,
      consultationConfirmedAt: args.now,
      sessionStep: SessionStep.BEFORE_PHOTOS,
    },
    select: {
      id: true,
      serviceId: true,
      offeringId: true,
      subtotalSnapshot: true,
      totalDurationMinutes: true,
      consultationConfirmedAt: true,
      sessionStep: true,
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

  const createdProof = await createConsultationApprovalProof({
    tx: args.tx,
    consultationApprovalId: approval.id,
    bookingId: booking.id,
    clientId: args.clientId,
    professionalId: args.professionalId,
    decision: ConsultationDecision.APPROVED,
    method: args.provenance.method,
    recordedByUserId: args.provenance.recordedByUserId,
    clientActionTokenId: args.provenance.clientActionTokenId,
    contactMethod: args.provenance.contactMethod,
    destinationSnapshot: buildConsultationProofDestinationSnapshot({
      contactMethod: args.provenance.contactMethod,
      destinationSnapshot: args.provenance.destinationSnapshot,
    }),
    ipAddress: args.provenance.ipAddress,
    userAgent: args.provenance.userAgent,
    contextJson: {
      bookingId: booking.id,
      requestId: args.requestId ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
      source: 'approveConsultationAndMaterializeBooking',
    },
    actedAt: args.now,
  })

  await syncBookingAppointmentReminders({
    tx: args.tx,
    bookingId: booking.id,
  })

  await createBookingCloseoutAuditLog({
    tx: args.tx,
    bookingId: booking.id,
    professionalId: args.professionalId,
    action: getConsultationApprovalAuditAction(
      ConsultationDecision.APPROVED,
      args.provenance.method,
    ),
    route: 'lib/booking/writeBoundary.ts:approveConsultationAndMaterializeBooking',
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    oldValue: {
      consultationApproval: {
        status: approval.status,
        approvedAt: normalizeDateCmp(approval.approvedAt),
        rejectedAt: normalizeDateCmp(approval.rejectedAt),
        proposedTotal: normalizeDecimalCmp(approval.proposedTotal),
      },
      booking: {
        serviceId: booking.serviceId,
        offeringId: booking.offeringId,
        subtotalSnapshot: normalizeDecimalCmp(booking.subtotalSnapshot),
        totalDurationMinutes: booking.totalDurationMinutes ?? 0,
        consultationConfirmedAt: normalizeDateCmp(
          booking.consultationConfirmedAt,
        ),
        sessionStep: booking.sessionStep ?? SessionStep.NONE,
      },
      proof: approval.proof
        ? buildConsultationApprovalProofSnapshot(approval.proof)
        : null,
    },
    newValue: {
      consultationApproval: {
        status: updatedApproval.status,
        approvedAt: normalizeDateCmp(updatedApproval.approvedAt),
        rejectedAt: normalizeDateCmp(updatedApproval.rejectedAt),
        proposedTotal: normalizeDecimalCmp(approval.proposedTotal),
      },
      booking: {
        serviceId: updatedBooking.serviceId,
        offeringId: updatedBooking.offeringId,
        subtotalSnapshot: normalizeDecimalCmp(updatedBooking.subtotalSnapshot),
        totalDurationMinutes: updatedBooking.totalDurationMinutes ?? 0,
        consultationConfirmedAt: normalizeDateCmp(
          updatedBooking.consultationConfirmedAt,
        ),
        sessionStep: updatedBooking.sessionStep ?? SessionStep.NONE,
      },
      proof: buildConsultationApprovalProofSnapshot(createdProof),
    },
    metadata: {
      proposalItemCount: proposedItems.length,
      proofMethod: createdProof.method,
      clientActionTokenId: createdProof.clientActionTokenId,
    },
  })

  await revokeConsultationActionTokensForBooking({
    tx: args.tx,
    bookingId: booking.id,
    revokeReason: 'Consultation decision completed.',
    revokedAt: args.now,
  })

  return {
    booking: updatedBooking,
    approval: updatedApproval,
    proof: {
      id: createdProof.id,
      decision: createdProof.decision,
      method: createdProof.method,
      actedAt: createdProof.actedAt,
      recordedByUserId: createdProof.recordedByUserId,
      clientActionTokenId: createdProof.clientActionTokenId,
      contactMethod: createdProof.contactMethod,
      destinationSnapshot: createdProof.destinationSnapshot,
    },
    meta: buildMeta(true),
  }
}

async function performLockedRejectConsultationDecision(
  args: ApproveConsultationMaterializationArgs,
): Promise<RejectConsultationResult> {
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

  if (!approval) {
    throw bookingError('FORBIDDEN', {
      message: 'Consultation proposal was not found for this booking.',
      userMessage: 'Consultation proposal is no longer available.',
    })
  }

  if (approval.status !== ConsultationApprovalStatus.PENDING) {
    throw bookingError('FORBIDDEN', {
      message: 'Consultation proposal is no longer pending.',
      userMessage: 'Consultation proposal is no longer pending.',
    })
  }

  if (approval.proof?.id) {
    throw bookingError('FORBIDDEN', {
      message: 'Consultation decision already has proof recorded.',
      userMessage: 'Consultation proposal is no longer pending.',
    })
  }

  const updatedApproval = await args.tx.consultationApproval.update({
    where: { bookingId: booking.id },
    data: {
      status: ConsultationApprovalStatus.REJECTED,
      approvedAt: null,
      rejectedAt: args.now,
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

  const createdProof = await createConsultationApprovalProof({
    tx: args.tx,
    consultationApprovalId: approval.id,
    bookingId: booking.id,
    clientId: args.clientId,
    professionalId: args.professionalId,
    decision: ConsultationDecision.REJECTED,
    method: args.provenance.method,
    recordedByUserId: args.provenance.recordedByUserId,
    clientActionTokenId: args.provenance.clientActionTokenId,
    contactMethod: args.provenance.contactMethod,
    destinationSnapshot: buildConsultationProofDestinationSnapshot({
      contactMethod: args.provenance.contactMethod,
      destinationSnapshot: args.provenance.destinationSnapshot,
    }),
    ipAddress: args.provenance.ipAddress,
    userAgent: args.provenance.userAgent,
    contextJson: {
      bookingId: booking.id,
      requestId: args.requestId ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
      source: 'rejectConsultationDecision',
    },
    actedAt: args.now,
  })

  await createBookingCloseoutAuditLog({
    tx: args.tx,
    bookingId: booking.id,
    professionalId: args.professionalId,
    action: getConsultationApprovalAuditAction(
      ConsultationDecision.REJECTED,
      args.provenance.method,
    ),
    route: 'lib/booking/writeBoundary.ts:rejectConsultationDecision',
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    oldValue: {
      consultationApproval: {
        status: approval.status,
        approvedAt: normalizeDateCmp(approval.approvedAt),
        rejectedAt: normalizeDateCmp(approval.rejectedAt),
        proposedTotal: normalizeDecimalCmp(approval.proposedTotal),
      },
      proof: approval.proof
        ? buildConsultationApprovalProofSnapshot(approval.proof)
        : null,
    },
    newValue: {
      consultationApproval: {
        status: updatedApproval.status,
        approvedAt: normalizeDateCmp(updatedApproval.approvedAt),
        rejectedAt: normalizeDateCmp(updatedApproval.rejectedAt),
        proposedTotal: normalizeDecimalCmp(approval.proposedTotal),
      },
      proof: buildConsultationApprovalProofSnapshot(createdProof),
    },
    metadata: {
      proofMethod: createdProof.method,
      clientActionTokenId: createdProof.clientActionTokenId,
    },
  })

  await revokeConsultationActionTokensForBooking({
    tx: args.tx,
    bookingId: booking.id,
    revokeReason: 'Consultation decision completed.',
    revokedAt: args.now,
  })

  return {
    approval: {
      id: updatedApproval.id,
      status: updatedApproval.status,
      approvedAt: updatedApproval.approvedAt,
      rejectedAt: updatedApproval.rejectedAt,
    },
    proof: {
      id: createdProof.id,
      decision: createdProof.decision,
      method: createdProof.method,
      actedAt: createdProof.actedAt,
      recordedByUserId: createdProof.recordedByUserId,
      clientActionTokenId: createdProof.clientActionTokenId,
      contactMethod: createdProof.contactMethod,
      destinationSnapshot: createdProof.destinationSnapshot,
    },
    meta: buildMeta(true),
  }
}

async function performLockedFinalizeBookingFromHold(args: {
  tx: Prisma.TransactionClient
  now: Date
  clientId: string
  bookingEntryPoint: ProBookingEntryPoint
  holdId: string
  aftercareClientActionTokenId?: string | null
  openingId: string | null
  addOnIds: string[]
  locationType: ServiceLocationType
  source: BookingSource
  initialStatus: BookingStatus
  rebookOfBookingId: string | null
  fallbackTimeZone: string
  offering: FinalizeBookingFromHoldArgs['offering']
  requestId: string | null
  idempotencyKey: string | null
}): Promise<FinalizeBookingFromHoldResult> {
  // Idempotency replay: if a prior call with the same (clientId, idempotencyKey)
  // already created a booking, return it without re-running the finalize work.
  if (args.idempotencyKey) {
    const existing = await args.tx.booking.findFirst({
      where: {
        clientId: args.clientId,
        creationIdempotencyKey: args.idempotencyKey,
      },
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        professionalId: true,
      } satisfies Prisma.BookingSelect,
    })

    if (existing) {
      return {
        booking: existing,
        meta: buildMeta(false),
      }
    }
  }

  await assertProfessionalIsBookingReady({
    tx: args.tx,
    professionalId: args.offering.professionalId,
    bookingEntryPoint: args.bookingEntryPoint,
  })

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

  await assertMobileBookingWithinRadius({
    tx: args.tx,
    professionalId: args.offering.professionalId,
    locationType: validatedHold.value.locationType,
    locationLat:
      decimalToNumber(hold.locationLatSnapshot) ?? locationContext.lat,
    locationLng:
      decimalToNumber(hold.locationLngSnapshot) ?? locationContext.lng,
    clientAddressId: hold.clientAddressId,
    clientLat: decimalToNumber(hold.clientAddressLatSnapshot),
    clientLng: decimalToNumber(hold.clientAddressLngSnapshot),
  })

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

  // Captured from a claimed opening so the booking below applies the SAME tier incentive the
  // client was shown (PERCENT_OFF / AMOUNT_OFF). null when this is not an opening claim, or the
  // applicable plan carries no chargeable discount.
  let openingIncentive: {
    offerType: LastMinuteOfferType
    percentOff: number | null
    amountOff: Prisma.Decimal | null
    timeZone: string
  } | null = null

  if (args.openingId) {
    const activeOpening = await args.tx.lastMinuteOpening.findFirst({
      where: {
        id: args.openingId,
        status: OpeningStatus.ACTIVE,
        bookedAt: null,
        cancelledAt: null,
      },
      select: {
        id: true,
        startAt: true,
        professionalId: true,
        visibilityMode: true,
        timeZone: true,
        services: {
          select: {
            offeringId: true,
            serviceId: true,
          },
        },
        tierPlans: {
          where: { cancelledAt: null },
          select: {
            tier: true,
            scheduledFor: true,
            offerType: true,
            percentOff: true,
            amountOff: true,
          },
        },
        recipients: {
          where: { clientId: args.clientId },
          select: {
            notifiedTier: true,
            firstMatchedTier: true,
          },
        },
      },
    })

    if (!activeOpening) {
      throw bookingError('OPENING_NOT_AVAILABLE')
    }

    if (activeOpening.professionalId !== args.offering.professionalId) {
      throw bookingError('OPENING_NOT_AVAILABLE')
    }

    const openingSupportsRequestedOffering = activeOpening.services.some(
      (serviceRow) =>
        serviceRow.offeringId === args.offering.id &&
        serviceRow.serviceId === args.offering.serviceId,
    )

    if (!openingSupportsRequestedOffering) {
      throw bookingError('OPENING_NOT_AVAILABLE')
    }

    if (
      normalizeToMinute(new Date(activeOpening.startAt)).getTime() !==
      requestedStart.getTime()
    ) {
      throw bookingError('OPENING_NOT_AVAILABLE')
    }

    const bookedAt = new Date()

    const updatedOpening = await args.tx.lastMinuteOpening.updateMany({
      where: {
        id: args.openingId,
        status: OpeningStatus.ACTIVE,
        bookedAt: null,
        cancelledAt: null,
      },
      data: {
        status: OpeningStatus.BOOKED,
        bookedAt,
      },
    })

    if (updatedOpening.count !== 1) {
      throw bookingError('OPENING_NOT_AVAILABLE')
    }

    // Resolve which tier plan's incentive applies — the recipient's matched tier if this client
    // was notified, else the public tier — via the SHARED selectors the read paths use, so the
    // price charged matches the price advertised. Only PERCENT_OFF / AMOUNT_OFF are applied here;
    // FREE_SERVICE / FREE_ADD_ON are deferred (booking proceeds at full price, never $0).
    const recipientRow = activeOpening.recipients[0] ?? null
    const tierPlan = recipientRow
      ? pickRecipientTierPlan({
          notifiedTier: recipientRow.notifiedTier,
          firstMatchedTier: recipientRow.firstMatchedTier,
          tierPlans: activeOpening.tierPlans,
        })
      : pickPublicTierPlan(
          {
            visibilityMode: activeOpening.visibilityMode,
            tierPlans: activeOpening.tierPlans,
          },
          bookedAt,
        )

    if (
      tierPlan &&
      (tierPlan.offerType === LastMinuteOfferType.PERCENT_OFF ||
        tierPlan.offerType === LastMinuteOfferType.AMOUNT_OFF)
    ) {
      openingIncentive = {
        offerType: tierPlan.offerType,
        percentOff: tierPlan.percentOff,
        amountOff: tierPlan.amountOff,
        timeZone: activeOpening.timeZone,
      }
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

  // Honor a price-grace ramp on the base service: existing clients keep their
  // lower ramped price; new clients pay the catalog minimum (the stored price).
  // Add-on prices are not ramped.
  const chargedBasePrice = await resolveChargedUnitPrice({
    tx: args.tx,
    professionalId: args.offering.professionalId,
    clientId: args.clientId,
    listPrice: basePrice,
    minPrice: args.offering.serviceMinPrice ?? basePrice,
    ramp: pickOfferingModeRamp(args.offering.priceRamps, args.locationType),
  })

  const subtotal = chargedBasePrice.add(addOnsPriceTotal)

  // Apply the claimed opening's incentive to the subtotal. computeLastMinuteDiscount re-applies
  // the pro's eligibility gates (enabled / day-disabled / minCollectedSubtotal floor), so a
  // voided discount safely returns 0 and the booking proceeds at full price.
  let lastMinuteDiscount = zeroMoney()
  if (openingIncentive) {
    const discountResult = await computeLastMinuteDiscount({
      professionalId: args.offering.professionalId,
      serviceId: args.offering.serviceId,
      scheduledFor: requestedStart,
      basePrice: Number(subtotal.toString()),
      timeZone: openingIncentive.timeZone,
      offerType: openingIncentive.offerType,
      percentOff: openingIncentive.percentOff,
      amountOff: openingIncentive.amountOff,
    })
    lastMinuteDiscount = parseMoney(discountResult.discountAmount)
  }
  const lastMinuteTotal = subtotal.sub(lastMinuteDiscount)

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

  const requestedEnd = decision.value.requestedEnd

  const aftercarePreselectedSlot =
    args.source === BookingSource.AFTERCARE &&
    args.aftercareClientActionTokenId
      ? await resolveAftercarePreselectedSlot({
          tx: args.tx,
          clientActionTokenId: args.aftercareClientActionTokenId,
          clientId: args.clientId,
          professionalId: args.offering.professionalId,
          bookingId: args.rebookOfBookingId ?? '',
          now: args.now,
        })
      : null

  await enforceBookingOverlapPolicy({
    tx: args.tx,
    actor: {
      kind: 'CLIENT',
      userId: args.clientId,
      clientId: args.clientId,
    },
    source:
      args.source === BookingSource.AFTERCARE
        ? {
            kind: 'AFTERCARE_REBOOK',
            aftercareSummaryId: aftercarePreselectedSlot?.aftercareSummaryId ?? '',
            clientActionTokenId:
              aftercarePreselectedSlot?.clientActionTokenId ??
              args.aftercareClientActionTokenId ??
              '',
            proPreselectedSlot: aftercarePreselectedSlot,
          }
        : {
            kind:
              args.source === BookingSource.REQUESTED
                ? 'DIRECT_PROFILE'
                : 'BROAD_DISCOVERY',
          },
    requestedWindow: {
      professionalId: args.offering.professionalId,
      startsAt: requestedStart,
      endsAt: requestedEnd,
    },
    locationId: locationContext.locationId,
    locationType: validatedHold.value.locationType,
    offeringId: args.offering.id,
    clientId: args.clientId,
    action: 'BOOKING_FINALIZE',
    excludeHoldId: hold.id,
    now: args.now,
  })

  const salonLocationAddressSnapshotData =
    validatedHold.value.locationType === ServiceLocationType.SALON
      ? reuseEncryptedAddressSnapshotData({
          legacySnapshot: hold.locationAddressSnapshot,
          dedicatedEncryptedSnapshot:
            hold.encryptedLocationAddressSnapshotJson,
          keyVersion: hold.locationAddressSnapshotKeyVersion,
          encryptedAt: hold.addressSnapshotsEncryptedAt,
          latApprox: hold.locationLatApprox,
          lngApprox: hold.locationLngApprox,
          legacyLat: hold.locationLatSnapshot,
          legacyLng: hold.locationLngSnapshot,
          fallbackLat: locationContext.lat,
          fallbackLng: locationContext.lng,
        })
      : buildNullAddressSnapshotData({
          lat: hold.locationLatApprox ?? hold.locationLatSnapshot,
          lng: hold.locationLngApprox ?? hold.locationLngSnapshot,
        })

  const mobileClientAddressSnapshotData =
    validatedHold.value.locationType === ServiceLocationType.MOBILE
      ? reuseEncryptedAddressSnapshotData({
          legacySnapshot: hold.clientAddressSnapshot,
          dedicatedEncryptedSnapshot: hold.encryptedClientAddressSnapshotJson,
          keyVersion: hold.clientAddressSnapshotKeyVersion,
          encryptedAt: hold.addressSnapshotsEncryptedAt,
          latApprox: hold.clientAddressLatApprox,
          lngApprox: hold.clientAddressLngApprox,
          legacyLat: hold.clientAddressLatSnapshot,
          legacyLng: hold.clientAddressLngSnapshot,
        })
      : buildNullAddressSnapshotData()

  let created: {
    id: string
    status: BookingStatus
    scheduledFor: Date
    professionalId: string
  }

  const tenantAttribution = await resolveBookingTenantAttribution(args.tx, {
    professionalId: args.offering.professionalId,
    clientId: args.clientId,
  })

  try {
    created = await args.tx.booking.create({
      data: {
        clientId: args.clientId,
        professionalId: args.offering.professionalId,
        serviceId: args.offering.serviceId,
        offeringId: args.offering.id,
        ...tenantAttribution,
        scheduledFor: requestedStart,
        status: args.initialStatus,
        source: args.source,
        locationType: args.locationType,
        rebookOfBookingId: args.rebookOfBookingId,
        creationIdempotencyKey: args.idempotencyKey ?? null,
        subtotalSnapshot: subtotal,
        serviceSubtotalSnapshot: subtotal,
        productSubtotalSnapshot: zeroMoney(),
        tipAmount: zeroMoney(),
        taxAmount: zeroMoney(),
        discountAmount: lastMinuteDiscount,
        totalAmount: lastMinuteTotal,
        checkoutStatus: BookingCheckoutStatus.NOT_READY,
        selectedPaymentMethod: null,
        paymentAuthorizedAt: null,
        paymentCollectedAt: null,
        totalDurationMinutes,
        bufferMinutes: locationContext.bufferMinutes,
        locationId: locationContext.locationId,
        locationTimeZone: locationContext.timeZone,

        // Legacy expand-phase columns.
        locationAddressSnapshot: salonLocationAddressSnapshotData.legacySnapshot,
        locationAddressSnapshotKeyVersion: salonLocationAddressSnapshotData.keyVersion,
        locationLatSnapshot:
          decimalToNumber(hold.locationLatSnapshot) ?? locationContext.lat,
        locationLngSnapshot:
          decimalToNumber(hold.locationLngSnapshot) ?? locationContext.lng,

        // Dedicated encrypted snapshot columns.
        encryptedLocationAddressSnapshotJson:
          salonLocationAddressSnapshotData.encryptedSnapshot,
        locationLatApprox: salonLocationAddressSnapshotData.latApprox,
        locationLngApprox: salonLocationAddressSnapshotData.lngApprox,

        clientAddressId:
          validatedHold.value.locationType === ServiceLocationType.MOBILE
            ? validatedHold.value.holdClientAddressId
            : null,

        // Legacy
        clientAddressSnapshot: mobileClientAddressSnapshotData.legacySnapshot,
        clientAddressSnapshotKeyVersion: mobileClientAddressSnapshotData.keyVersion,
        clientAddressLatSnapshot:
          validatedHold.value.locationType === ServiceLocationType.MOBILE
            ? decimalToNumber(hold.clientAddressLatSnapshot)
            : null,
        clientAddressLngSnapshot:
          validatedHold.value.locationType === ServiceLocationType.MOBILE
            ? decimalToNumber(hold.clientAddressLngSnapshot)
            : null,

        // Dedicated
        encryptedClientAddressSnapshotJson:
          mobileClientAddressSnapshotData.encryptedSnapshot,
        clientAddressLatApprox: mobileClientAddressSnapshotData.latApprox,
        clientAddressLngApprox: mobileClientAddressSnapshotData.lngApprox,

        addressSnapshotsEncryptedAt:
          salonLocationAddressSnapshotData.encryptedAt ??
          mobileClientAddressSnapshotData.encryptedAt,
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
      // Idempotency race: another concurrent request with the same
      // (clientId, idempotencyKey) won the unique-index insert. Re-fetch
      // and return the existing booking instead of throwing TIME_NOT_AVAILABLE.
      if (args.idempotencyKey && p2002TargetIncludes(error, 'creationIdempotencyKey')) {
        const existing = await args.tx.booking.findFirst({
          where: {
            clientId: args.clientId,
            creationIdempotencyKey: args.idempotencyKey,
          },
          select: {
            id: true,
            status: true,
            scheduledFor: true,
            professionalId: true,
          } satisfies Prisma.BookingSelect,
        })

        if (existing) {
          return {
            booking: existing,
            meta: buildMeta(false),
          }
        }
      }

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
      priceSnapshot: chargedBasePrice,
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
  await args.tx.lastMinuteRecipient.updateMany({
    where: {
      clientId: args.clientId,
      openingId: args.openingId,
      bookedAt: null,
    },
    data: {
      bookedAt: new Date(),
      status: LastMinuteRecipientStatus.BOOKED,
    },
  })

  // The opening transitioned ACTIVE -> BOOKED above (guarded by updatedOpening.count === 1),
  // so this booking won the race. Suppress every OTHER notified recipient for this opening so
  // they stop chasing a slot that is now gone. Only pre-terminal statuses are touched — never
  // overwrite an already BOOKED / CANCELLED / SUPPRESSED row. Suppressed silently (no
  // "slot filled" notification exists today).
  await args.tx.lastMinuteRecipient.updateMany({
    where: {
      openingId: args.openingId,
      clientId: { not: args.clientId },
      status: {
        in: [
          LastMinuteRecipientStatus.PLANNED,
          LastMinuteRecipientStatus.ENQUEUED,
          LastMinuteRecipientStatus.OPENED,
          LastMinuteRecipientStatus.CLICKED,
        ],
      },
    },
    data: {
      status: LastMinuteRecipientStatus.SUPPRESSED,
      suppressedAt: new Date(),
    },
  })
}

  await args.tx.bookingHold.delete({
    where: { id: hold.id },
  })

  await syncBookingAppointmentReminders({
    tx: args.tx,
    bookingId: created.id,
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
  requestId?: string | null
  idempotencyKey?: string | null
  importMode?: boolean
}): Promise<CreateProBookingResult> {
  const importMode = args.importMode ?? false

    assertNonEmptyUserId(args.actorUserId)

  // Idempotency replay: if a prior call with the same (clientId, idempotencyKey)
  // already created a booking, return it without re-running creation work.
  if (args.idempotencyKey) {
    const replayed = await tryHydrateProBookingByIdempotency({
      tx: args.tx,
      clientId: args.clientId,
      idempotencyKey: args.idempotencyKey,
    })
    if (replayed) return replayed
  }

  await assertProfessionalIsBookingReady({
    tx: args.tx,
    professionalId: args.professionalId,
    bookingEntryPoint: 'PRO_CREATED',
  })

  const normalizedOverrideReason = normalizeReason(args.overrideReason)

  // Reassigned below for calendar imports (snapped to the slot grid).
  let requestedStart = normalizeToMinute(args.scheduledFor)

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
  // Imported bookings are snapshotted at 0 (excluded from revenue until the pro
  // edits them). Otherwise honor a price-grace ramp: existing clients of a
  // migrated offering keep their lower ramped price; new clients pay the catalog
  // minimum (the stored price).
  let chargedUnitPrice: Prisma.Decimal
  if (importMode) {
    chargedUnitPrice = zeroMoney()
  } else {
    const offeringRampForMode = pickOfferingModeRamp(
      offering.priceRamps,
      args.locationType,
    )
    chargedUnitPrice = await resolveChargedUnitPrice({
      tx: args.tx,
      professionalId: args.professionalId,
      clientId: args.clientId,
      listPrice: basePrice,
      minPrice: offering.service.minPrice ?? basePrice,
      ramp: offeringRampForMode,
    })
  }

  await assertMobileBookingWithinRadius({
    tx: args.tx,
    professionalId: args.professionalId,
    locationType: args.locationType,
    locationLat: locationContext.lat,
    locationLng: locationContext.lng,
    clientAddressId:
      args.locationType === ServiceLocationType.MOBILE
        ? clientAddress?.id ?? args.clientAddressId
        : null,
    clientLat:
      args.locationType === ServiceLocationType.MOBILE && clientAddress
        ? decimalToNumber(clientAddress.lat)
        : null,
    clientLng:
      args.locationType === ServiceLocationType.MOBILE && clientAddress
        ? decimalToNumber(clientAddress.lng)
        : null,
  })

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

  // Calendar imports: an external appointment's start rarely lands on the pro's
  // slot grid. Snap minor misalignment to the nearest valid slot so it can book;
  // times we can't snap (before hours / closed day) keep the original start and
  // fall back to a held block downstream (see commitCalendarImport).
  if (importMode) {
    const snapped = snapStartToWorkingWindowStep({
      startUtc: requestedStart,
      workingHours: locationContext.workingHours,
      timeZone: locationContext.timeZone,
      stepMinutes,
    })
    if (snapped) requestedStart = snapped
  }

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

  if (schedulingDecision.appliedOverrides.length > 0) {
    await assertCanUseBookingOverrides({
      actorUserId: args.actorUserId,
      professionalId: args.professionalId,
      appliedOverrides: schedulingDecision.appliedOverrides,
    })
  }

  await enforceBookingOverlapPolicy({
    tx: args.tx,
    actor: {
      kind: 'PRO',
      userId: args.actorUserId,
      professionalId: args.professionalId,
    },
    source: {
      kind: 'PRO_CREATED',
    },
    requestedWindow: {
      professionalId: args.professionalId,
      startsAt: requestedStart,
      endsAt: schedulingDecision.requestedEnd,
    },
    locationId: locationContext.locationId,
    locationType: args.locationType,
    offeringId: args.offeringId,
    clientId: args.clientId,
    action: 'BOOKING_CREATE',
    now: args.now,
  })

    const salonLocationAddressSnapshotData =
      args.locationType === ServiceLocationType.SALON
        ? buildEncryptedAddressSnapshotData({
            formattedAddress: salonLocationAddress,
            lat: locationContext.lat,
            lng: locationContext.lng,
          })
        : buildNullAddressSnapshotData({
            lat: locationContext.lat,
            lng: locationContext.lng,
          })

    const clientAddressSnapshotData =
      args.locationType === ServiceLocationType.MOBILE && clientAddress
        ? buildEncryptedAddressSnapshotData({
            formattedAddress: clientServiceAddress,
            lat: clientAddress.lat,
            lng: clientAddress.lng,
          })
        : buildNullAddressSnapshotData()

    const addressSnapshotsEncryptedAt =
      salonLocationAddressSnapshotData.encryptedAt ??
      clientAddressSnapshotData.encryptedAt

  let booking: {
    id: string
    scheduledFor: Date
    totalDurationMinutes: number
    bufferMinutes: number
    status: BookingStatus
  }

  const tenantAttribution = await resolveBookingTenantAttribution(args.tx, {
    professionalId: args.professionalId,
    clientId: args.clientId,
  })

  try {
    booking = await args.tx.booking.create({
      data: {
        professionalId: args.professionalId,
        clientId: args.clientId,
        serviceId: offering.serviceId,
        offeringId: offering.id,
        ...tenantAttribution,
        scheduledFor: requestedStart,
        status: getProCreatedBookingStatus(),
        source: importMode ? BookingSource.IMPORTED : BookingSource.DISCOVERY,
        creationIdempotencyKey: args.idempotencyKey ?? null,

        locationType: args.locationType,
        locationId: locationContext.locationId,
        locationTimeZone: locationContext.timeZone,

        // Legacy expand-phase columns.
        locationAddressSnapshot: salonLocationAddressSnapshotData.legacySnapshot,
        locationAddressSnapshotKeyVersion: salonLocationAddressSnapshotData.keyVersion,
        locationLatSnapshot: salonLocationAddressSnapshotData.latApprox,
        locationLngSnapshot: salonLocationAddressSnapshotData.lngApprox,

        // Dedicated encrypted snapshot columns.
        encryptedLocationAddressSnapshotJson:
          salonLocationAddressSnapshotData.encryptedSnapshot,
        locationLatApprox: salonLocationAddressSnapshotData.latApprox,
        locationLngApprox: salonLocationAddressSnapshotData.lngApprox,

        clientAddressId:
          args.locationType === ServiceLocationType.MOBILE && clientAddress
            ? clientAddress.id
            : null,
          // Legacy
          clientAddressSnapshot: clientAddressSnapshotData.legacySnapshot,
          clientAddressSnapshotKeyVersion: clientAddressSnapshotData.keyVersion,
          clientAddressLatSnapshot: clientAddressSnapshotData.latApprox,
          clientAddressLngSnapshot: clientAddressSnapshotData.lngApprox,

          // Dedicated
          encryptedClientAddressSnapshotJson:
            clientAddressSnapshotData.encryptedSnapshot,
          clientAddressLatApprox: clientAddressSnapshotData.latApprox,
          clientAddressLngApprox: clientAddressSnapshotData.lngApprox,

          addressSnapshotsEncryptedAt,

        internalNotes: args.internalNotes ?? null,
        clientVisibleOverrideNote:
          schedulingDecision.appliedOverrides.length > 0
            ? normalizedOverrideReason
            : null,
        bufferMinutes,
        totalDurationMinutes,
        subtotalSnapshot: chargedUnitPrice,
        serviceSubtotalSnapshot: chargedUnitPrice,
        productSubtotalSnapshot: zeroMoney(),
        tipAmount: zeroMoney(),
        taxAmount: zeroMoney(),
        discountAmount: zeroMoney(),
        totalAmount: chargedUnitPrice,
        checkoutStatus: BookingCheckoutStatus.NOT_READY,
        selectedPaymentMethod: null,
        paymentAuthorizedAt: null,
        paymentCollectedAt: null,
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
      // Idempotency race: another concurrent pro-create with the same
      // (clientId, idempotencyKey) won. Re-hydrate and return that booking.
      if (args.idempotencyKey && p2002TargetIncludes(error, 'creationIdempotencyKey')) {
        const replayed = await tryHydrateProBookingByIdempotency({
          tx: args.tx,
          clientId: args.clientId,
          idempotencyKey: args.idempotencyKey,
        })
        if (replayed) return replayed
      }

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
      priceSnapshot: chargedUnitPrice,
      durationMinutesSnapshot: computedDurationMinutes,
      sortOrder: 0,
    },
  })

// Imported bookings are silent: the migrated client has no account yet, so we
// don't send a confirmation or schedule appointment reminders.
if (!importMode) {
  await createUpdateClientNotification({
    tx: args.tx,
    clientId: args.clientId,
    bookingId: booking.id,
    eventKey: NotificationEventKey.BOOKING_CONFIRMED,
    title: 'Appointment booked',
    body: `Your appointment for ${offering.service.name || 'Appointment'} has been booked.`,
    dedupeKey: `BOOKING_CONFIRMED:${booking.id}`,
    href: `/client/bookings/${booking.id}?step=overview`,
    data: {
      bookingId: booking.id,
      notificationReason: 'BOOKING_CONFIRMED',
      bookingReason: 'PRO_BOOKED_APPOINTMENT',
    },
  })

  await syncBookingAppointmentReminders({
    tx: args.tx,
    bookingId: booking.id,
  })
}

if (schedulingDecision.appliedOverrides.length > 0) {
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
    subtotalSnapshot: chargedUnitPrice,
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
  const aftercareClientActionTokenId = normalizeReason(
  args.aftercareClientActionTokenId,
)
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

assertCanCreateRebookFromSourceBooking({
  source,
  clientId: args.clientId ?? null,
  aftercareId: args.aftercareId ?? null,
})

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

    const existingRebook = await args.tx.booking.findFirst({
    where: {
      rebookOfBookingId: source.id,
      clientId: source.clientId,
      professionalId: source.professionalId,
      scheduledFor: requestedStart,
    },
    select: {
      id: true,
      status: true,
      scheduledFor: true,
    } satisfies Prisma.BookingSelect,
  })

  if (existingRebook) {
    const existingAftercare = await args.tx.aftercareSummary.findUnique({
      where: { bookingId: source.id },
      select: {
        id: true,
        rebookMode: true,
        rebookedFor: true,
      } satisfies Prisma.AftercareSummarySelect,
    })

    if (!existingAftercare) {
      throw bookingError('AFTERCARE_NOT_COMPLETED', {
        message: 'Existing rebook found but source aftercare is missing.',
        userMessage: 'We found the next appointment, but aftercare is incomplete.',
      })
    }

    return {
      booking: {
        id: existingRebook.id,
        status: existingRebook.status,
        scheduledFor: existingRebook.scheduledFor,
      },
      aftercare: {
        id: existingAftercare.id,
        rebookMode: existingAftercare.rebookMode,
        rebookedFor: existingAftercare.rebookedFor,
      },
      meta: buildMeta(false),
    }
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

  await assertMobileBookingWithinRadius({
    tx: args.tx,
    professionalId: source.professionalId,
    locationType: source.locationType,
    locationLat:
      decimalToNumber(source.locationLatSnapshot) ?? locationContext.lat,
    locationLng:
      decimalToNumber(source.locationLngSnapshot) ?? locationContext.lng,
    clientAddressId: source.clientAddressId,
    clientLat: decimalToNumber(source.clientAddressLatSnapshot),
    clientLng: decimalToNumber(source.clientAddressLngSnapshot),
  })

  const schedulingDecision = await enforceProCreateScheduling({
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

  await enforceBookingOverlapPolicy({
    tx: args.tx,
    actor:
      args.clientId
        ? {
            kind: 'CLIENT',
            userId: args.clientId,
            clientId: args.clientId,
          }
        : {
            kind: 'PRO',
            userId: args.professionalId,
            professionalId: source.professionalId,
          },
    source:
      args.clientId && args.aftercareId
        ? {
            kind: 'AFTERCARE_REBOOK',
            aftercareSummaryId: args.aftercareId,
            clientActionTokenId: aftercareClientActionTokenId ?? '',
            proPreselectedSlot:
              source.aftercareSummary?.id === args.aftercareId &&
              source.aftercareSummary.rebookSlot
                ? {
                    aftercareSummaryId: args.aftercareId,
                    clientActionTokenId: aftercareClientActionTokenId ?? '',
                    professionalId:
                      source.aftercareSummary.rebookSlot.professionalId,
                    offeringId: source.aftercareSummary.rebookSlot.offeringId,
                    locationId: source.aftercareSummary.rebookSlot.locationId,
                    locationType:
                      source.aftercareSummary.rebookSlot.locationType,
                    startsAt: source.aftercareSummary.rebookSlot.startsAt,
                    endsAt: source.aftercareSummary.rebookSlot.endsAt,
                  }
                : null,
          }
        : {
            kind: 'PRO_CREATED',
          },
    requestedWindow: {
      professionalId: source.professionalId,
      startsAt: requestedStart,
      endsAt: schedulingDecision.requestedEnd,
    },
    locationId: locationContext.locationId,
    locationType: source.locationType,
    offeringId: primary.offeringId,
    clientId: source.clientId,
    action: 'BOOKING_CREATE',
    now: args.now,
  })

  const salonAddressSnapshotData =
    source.locationType === ServiceLocationType.SALON
      ? source.locationAddressSnapshot != null ||
        source.encryptedLocationAddressSnapshotJson != null
        ? reuseEncryptedAddressSnapshotData({
            legacySnapshot: source.locationAddressSnapshot,
            dedicatedEncryptedSnapshot:
              source.encryptedLocationAddressSnapshotJson,
            keyVersion: source.locationAddressSnapshotKeyVersion,
            encryptedAt: source.addressSnapshotsEncryptedAt,
            latApprox: source.locationLatApprox,
            lngApprox: source.locationLngApprox,
            legacyLat: source.locationLatSnapshot,
            legacyLng: source.locationLngSnapshot,
            fallbackLat: locationContext.lat,
            fallbackLng: locationContext.lng,
          })
        : buildEncryptedAddressSnapshotData({
            formattedAddress: locationContext.formattedAddress,
            lat: source.locationLatSnapshot ?? locationContext.lat,
            lng: source.locationLngSnapshot ?? locationContext.lng,
          })
      : buildNullAddressSnapshotData({
          lat: source.locationLatApprox ?? source.locationLatSnapshot,
          lng: source.locationLngApprox ?? source.locationLngSnapshot,
        })

  const mobileClientAddressSnapshotData =
    source.locationType === ServiceLocationType.MOBILE
      ? reuseEncryptedAddressSnapshotData({
          legacySnapshot: source.clientAddressSnapshot,
          dedicatedEncryptedSnapshot: source.encryptedClientAddressSnapshotJson,
          keyVersion: source.clientAddressSnapshotKeyVersion,
          encryptedAt: source.addressSnapshotsEncryptedAt,
          latApprox: source.clientAddressLatApprox,
          lngApprox: source.clientAddressLngApprox,
          legacyLat: source.clientAddressLatSnapshot,
          legacyLng: source.clientAddressLngSnapshot,
        })
      : buildNullAddressSnapshotData()

  let createdBooking: {
    id: string
    status: BookingStatus
    scheduledFor: Date
  }

  const tenantAttribution = await resolveBookingTenantAttribution(args.tx, {
    professionalId: source.professionalId,
    clientId: source.clientId,
  })

  try {
    createdBooking = await args.tx.booking.create({
      data: {
        clientId: source.clientId,
        professionalId: source.professionalId,

        serviceId: primary.serviceId,
        offeringId: primary.offeringId,

        ...tenantAttribution,

        scheduledFor: requestedStart,
        status: args.initialStatus,
        source: BookingSource.AFTERCARE,
        rebookOfBookingId: source.id,

        locationType: source.locationType,
        locationId: locationContext.locationId,
        locationTimeZone: locationContext.timeZone,

        // Legacy expand-phase columns.
        locationAddressSnapshot: salonAddressSnapshotData.legacySnapshot,
        locationAddressSnapshotKeyVersion: salonAddressSnapshotData.keyVersion,
        locationLatSnapshot:
          decimalToNumber(source.locationLatSnapshot) ?? locationContext.lat,
        locationLngSnapshot:
          decimalToNumber(source.locationLngSnapshot) ?? locationContext.lng,

        // Dedicated encrypted snapshot columns.
        encryptedLocationAddressSnapshotJson:
          salonAddressSnapshotData.encryptedSnapshot,
        locationLatApprox: salonAddressSnapshotData.latApprox,
        locationLngApprox: salonAddressSnapshotData.lngApprox,

        clientAddressId:
          source.locationType === ServiceLocationType.MOBILE
            ? source.clientAddressId
            : null,

        // Legacy
        clientAddressSnapshot: mobileClientAddressSnapshotData.legacySnapshot,
        clientAddressSnapshotKeyVersion: mobileClientAddressSnapshotData.keyVersion,
        clientAddressLatSnapshot:
          source.locationType === ServiceLocationType.MOBILE
            ? decimalToNumber(source.clientAddressLatSnapshot)
            : null,
        clientAddressLngSnapshot:
          source.locationType === ServiceLocationType.MOBILE
            ? decimalToNumber(source.clientAddressLngSnapshot)
            : null,

        // Dedicated
        encryptedClientAddressSnapshotJson:
          mobileClientAddressSnapshotData.encryptedSnapshot,
        clientAddressLatApprox: mobileClientAddressSnapshotData.latApprox,
        clientAddressLngApprox: mobileClientAddressSnapshotData.lngApprox,

        addressSnapshotsEncryptedAt:
          salonAddressSnapshotData.encryptedAt ??
          mobileClientAddressSnapshotData.encryptedAt,

        clientTimeZoneAtBooking: source.clientTimeZoneAtBooking ?? undefined,

        subtotalSnapshot,
        serviceSubtotalSnapshot: subtotalSnapshot,
        productSubtotalSnapshot: zeroMoney(),
        totalAmount: subtotalSnapshot,
        depositAmount: null,
        tipAmount: zeroMoney(),
        taxAmount: zeroMoney(),
        discountAmount: zeroMoney(),
        checkoutStatus: BookingCheckoutStatus.NOT_READY,
        selectedPaymentMethod: null,
        paymentAuthorizedAt: null,
        paymentCollectedAt: null,
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

  await createBookingCloseoutAuditLog({
    tx: args.tx,
    bookingId: source.id,
    professionalId: source.professionalId,
    action: BookingCloseoutAuditAction.REBOOK_CREATED,
    route: 'lib/booking/writeBoundary.ts:createRebookedBooking',
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    oldValue: {
      rebookMode: null,
      rebookedFor: null,
    },
    newValue: {
      rebookMode: aftercare.rebookMode,
      rebookedFor: normalizeDateCmp(aftercare.rebookedFor),
      createdBookingId: createdBooking.id,
      createdBookingStatus: createdBooking.status,
      createdBookingScheduledFor: normalizeDateCmp(createdBooking.scheduledFor),
    },
  })

  await syncBookingAppointmentReminders({
    tx: args.tx,
    bookingId: createdBooking.id,
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
  requestId?: string | null
  idempotencyKey?: string | null
}): Promise<CreateRebookedBookingFromCompletedBookingResult> {
  return performLockedCreateRebookedBooking({
    tx: args.tx,
    now: args.now,
    bookingId: args.bookingId,
    professionalId: args.professionalId,
    scheduledFor: args.scheduledFor,
    initialStatus: BookingStatus.ACCEPTED,
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
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
  requestId?: string | null
  idempotencyKey?: string | null
}): Promise<UpdateProBookingResult> {
    assertNonEmptyUserId(args.actorUserId)

  const normalizedOverrideReason = normalizeReason(args.overrideReason)

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
      serviceId: true,
      offeringId: true,
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

  await cancelBookingAppointmentReminders({
    tx: args.tx,
    bookingId: updated.id,
  })

if (args.notifyClient) {
  await createUpdateClientNotification({
    tx: args.tx,
    clientId: existing.clientId,
    bookingId: updated.id,
    eventKey: NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
    title: 'Appointment cancelled',
    body: 'Your appointment was cancelled.',
    dedupeKey: `BOOKING_CANCELLED:${updated.id}`,
    href: `/client/bookings/${updated.id}?step=overview`,
    data: {
      bookingId: updated.id,
      notificationReason: 'BOOKING_CANCELLED_BY_PRO',
    },
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

  const reminderStateChanged =
    occupancyChanged ||
    primaryServiceId !== existing.serviceId ||
    primaryOfferingId !== existing.offeringId

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

  if (schedulingDecision.appliedOverrides.length > 0) {
    await assertCanUseBookingOverrides({
      actorUserId: args.actorUserId,
      professionalId: existing.professionalId,
      appliedOverrides: schedulingDecision.appliedOverrides,
    })
  }

  if (occupancyChanged) {
    await enforceBookingOverlapPolicy({
      tx: args.tx,
      actor: {
        kind: 'PRO',
        userId: args.actorUserId,
        professionalId: existing.professionalId,
      },
      source: {
        kind: 'PRO_CREATED',
      },
      requestedWindow: {
        professionalId: existing.professionalId,
        startsAt: finalStart,
        endsAt: schedulingDecision.requestedEnd,
      },
      locationId: location.id,
      locationType: existing.locationType,
      offeringId: primaryOfferingId,
      clientId: existing.clientId,
      action: 'BOOKING_UPDATE',
      excludeBookingId: existing.id,
      now: args.now,
    })
  }

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

  const checkoutRollup = await buildBookingCheckoutRollupUpdate({
    tx: args.tx,
    bookingId: existing.id,
    nextServiceSubtotal: computedSubtotal,
  })

  const updated = await args.tx.booking.update({
    where: { id: existing.id },
    data: {
      ...(args.nextStatus === BookingStatus.ACCEPTED
        ? { status: BookingStatus.ACCEPTED }
        : {}),
      // Track the latest override's client-visible note: a fresh override
      // replaces (or clears) whatever an earlier override left behind.
      ...(schedulingDecision.appliedOverrides.length > 0
        ? { clientVisibleOverrideNote: normalizedOverrideReason }
        : {}),
      scheduledFor: finalStart,
      bufferMinutes: finalBuffer,
      totalDurationMinutes: finalDuration,
      subtotalSnapshot: checkoutRollup.subtotalSnapshot,
      serviceSubtotalSnapshot: checkoutRollup.serviceSubtotalSnapshot,
      productSubtotalSnapshot: checkoutRollup.productSubtotalSnapshot,
      tipAmount: checkoutRollup.tipAmount,
      taxAmount: checkoutRollup.taxAmount,
      discountAmount: checkoutRollup.discountAmount,
      totalAmount: checkoutRollup.totalAmount,
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

    if (schedulingDecision.appliedOverrides.length > 0) {
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
    requestId: args.requestId ?? null,
    idempotencyKey: args.idempotencyKey ?? null,
  })
}

  if (
    updated.status === BookingStatus.ACCEPTED &&
    (args.nextStatus === BookingStatus.ACCEPTED || reminderStateChanged)
  ) {
    await syncBookingAppointmentReminders({
      tx: args.tx,
      bookingId: updated.id,
    })
  }

if (args.notifyClient) {
  const isConfirm = args.nextStatus === BookingStatus.ACCEPTED
  const title = isConfirm ? 'Appointment confirmed' : 'Appointment updated'
  const bodyText = isConfirm
    ? 'Your appointment has been confirmed.'
    : 'Your appointment details were updated.'
  const eventKey = isConfirm
    ? NotificationEventKey.BOOKING_CONFIRMED
    : NotificationEventKey.BOOKING_RESCHEDULED
  const notifKey = isConfirm
    ? `BOOKING_CONFIRMED:${updated.id}`
    : `BOOKING_RESCHEDULED:${updated.id}`

  await createUpdateClientNotification({
    tx: args.tx,
    clientId: existing.clientId,
    bookingId: updated.id,
    eventKey,
    title,
    body: bodyText,
    dedupeKey: notifKey,
    href: `/client/bookings/${updated.id}?step=overview`,
    data: {
      bookingId: updated.id,
      notificationReason: isConfirm
        ? 'BOOKING_CONFIRMED'
        : 'BOOKING_RESCHEDULED',
      bookingReason: isConfirm ? 'REQUEST_APPROVED' : 'BOOKING_RESCHEDULED',
    },
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
  now: Date
  bookingId: string
  professionalId: string
  actorUserId: string
  notes: string | null
  rebookMode: AftercareRebookMode
  rebookedFor: Date | null
  rebookWindowStart: Date | null
  rebookWindowEnd: Date | null
  rebookSlot: {
    offeringId: string | null
    locationId: string
    locationType: ServiceLocationType
    startsAt: Date
    endsAt: Date
  } | null
  createRebookReminder: boolean
  rebookReminderDaysBefore: number
  createProductReminder: boolean
  productReminderDaysAfter: number
  recommendedProducts: RecommendedProductInput[]
  sendToClient: boolean
  version: number | null
  requestId?: string | null
  idempotencyKey?: string | null
}): Promise<UpsertBookingAftercareResult> {

  assertValidRecommendedProducts(args.recommendedProducts)

  assertValidFinalReviewRebookFields({
    rebookMode: args.rebookMode,
    rebookedFor: args.rebookedFor,
    rebookWindowStart: args.rebookWindowStart,
    rebookWindowEnd: args.rebookWindowEnd,
  })

  if (
    args.rebookMode === AftercareRebookMode.BOOKED_NEXT_APPOINTMENT &&
    !args.rebookSlot
  ) {
    throw bookingError('FORBIDDEN', {
      message:
        'BOOKED_NEXT_APPOINTMENT requires a trusted aftercare rebook slot.',
      userMessage:
        'Choose the exact next appointment slot before saving aftercare.',
    })
  }

  if (
    args.rebookMode === AftercareRebookMode.BOOKED_NEXT_APPOINTMENT &&
    !args.rebookSlot?.offeringId
  ) {
    throw bookingError('OFFERING_ID_REQUIRED', {
      message:
        'BOOKED_NEXT_APPOINTMENT aftercare rebook slots require an offeringId.',
      userMessage:
        'Choose the service for the next appointment before saving aftercare.',
    })
  }

  if (
    args.rebookMode !== AftercareRebookMode.BOOKED_NEXT_APPOINTMENT &&
    args.rebookSlot
  ) {
    throw bookingError('FORBIDDEN', {
      message:
        'Aftercare rebook slot is only allowed for BOOKED_NEXT_APPOINTMENT.',
      userMessage:
        'Use either an exact booked appointment slot or a recommended window, not both.',
    })
  }

  if (
    args.rebookSlot &&
    args.rebookSlot.startsAt.getTime() !== args.rebookedFor?.getTime()
  ) {
    throw bookingError('FORBIDDEN', {
      message:
        'Aftercare rebook slot startsAt must match rebookedFor.',
      userMessage:
        'The selected next appointment time does not match the saved rebook time.',
    })
  }

  if (
    args.rebookSlot &&
    args.rebookSlot.endsAt.getTime() <= args.rebookSlot.startsAt.getTime()
  ) {
    throw bookingError('FORBIDDEN', {
      message:
        'Aftercare rebook slot endsAt must be after startsAt.',
      userMessage:
        'The selected next appointment slot has an invalid end time.',
    })
  }

if (args.rebookSlot) {
  const rebookSlotOfferingId = args.rebookSlot.offeringId

  if (!rebookSlotOfferingId) {
    throw bookingError('OFFERING_ID_REQUIRED', {
      message:
        'BOOKED_NEXT_APPOINTMENT aftercare rebook slots require an offeringId.',
      userMessage:
        'Choose the service for the next appointment before saving aftercare.',
    })
  }

  await assertAftercareRebookSlotOwnership({
    tx: args.tx,
    professionalId: args.professionalId,
    rebookSlot: {
      offeringId: rebookSlotOfferingId,
      locationId: args.rebookSlot.locationId,
      locationType: args.rebookSlot.locationType,
    },
  })
}

  const internalProductIds = Array.from(
    new Set(
      args.recommendedProducts
        .map((product) => product.productId)
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0,
        ),
    ),
  )

  if (internalProductIds.length > 0) {
    const validProducts = await args.tx.product.findMany({
      where: {
        id: { in: internalProductIds },
        isActive: true,
      },
      select: { id: true },
      take: internalProductIds.length,
    })

    if (validProducts.length !== internalProductIds.length) {
      throw bookingError('FORBIDDEN', {
        message: 'One or more recommended products are invalid.',
        userMessage: 'One or more selected products are no longer available.',
      })
    }
  }

  const now = args.now
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

  const existingAftercare = booking.aftercareSummary
  const shouldQueueAftercareAccessDelivery =
    args.sendToClient && !existingAftercare?.sentToClientAt
    const incomingVersion =
    typeof args.version === 'number' && Number.isFinite(args.version)
      ? Math.trunc(args.version)
      : null

  if (existingAftercare) {
    if (incomingVersion == null) {
      throw bookingError('STALE_VERSION', {
        message: 'Aftercare version is required for updates.',
        userMessage: 'This aftercare draft is out of date. Refresh and try again.',
      })
    }

    if (incomingVersion !== existingAftercare.version) {
      throw bookingError('STALE_VERSION', {
        message: `Aftercare version mismatch. Expected ${existingAftercare.version}, received ${incomingVersion}.`,
        userMessage: 'This aftercare draft is out of date. Refresh and try again.',
      })
    }
  }

const existingAftercareComparable = existingAftercare
  ? {
      notes: normalizeReason(existingAftercare.notes),
      rebookMode: existingAftercare.rebookMode,
      rebookedFor: normalizeDateCmp(existingAftercare.rebookedFor),
      rebookWindowStart: normalizeDateCmp(existingAftercare.rebookWindowStart),
      rebookWindowEnd: normalizeDateCmp(existingAftercare.rebookWindowEnd),
      rebookSlot: normalizeAftercareRebookSlotForComparison(
        existingAftercare.rebookSlot,
      ),
      recommendedProducts: buildExistingRecommendedProductsForComparison(
        existingAftercare.recommendedProducts,
      ),
      sentToClient: Boolean(existingAftercare.sentToClientAt),
    }
  : null

const incomingAftercareComparable = {
  notes: normalizeReason(args.notes),
  rebookMode: args.rebookMode,
  rebookedFor: normalizeDateCmp(args.rebookedFor),
  rebookWindowStart: normalizeDateCmp(args.rebookWindowStart),
  rebookWindowEnd: normalizeDateCmp(args.rebookWindowEnd),
  rebookSlot: normalizeAftercareRebookSlotForComparison(args.rebookSlot),
  recommendedProducts: normalizeRecommendedProductsForComparison(
    args.recommendedProducts,
  ),
  sentToClient: args.sendToClient
    ? true
    : Boolean(existingAftercare?.sentToClientAt),
}

if (
  existingAftercare &&
  !args.createRebookReminder &&
  !args.createProductReminder &&
  areAuditValuesEqual(existingAftercareComparable, incomingAftercareComparable)
) {
  return {
    aftercare: {
      id: existingAftercare.id,
      publicAccess: buildAftercarePublicAccess(),
      rebookMode: existingAftercare.rebookMode,
      rebookedFor: existingAftercare.rebookedFor,
      rebookWindowStart: existingAftercare.rebookWindowStart,
      rebookWindowEnd: existingAftercare.rebookWindowEnd,
      draftSavedAt: existingAftercare.draftSavedAt,
      sentToClientAt: existingAftercare.sentToClientAt,
      lastEditedAt: existingAftercare.lastEditedAt,
      version: existingAftercare.version,
    },
    remindersTouched: 0,
    clientNotified: false,
    aftercareAccessDelivery: {
      attempted: false,
      queued: false,
      href: null,
    },
    bookingFinished: false,
    completionBlockers: [],
    booking:
      booking.status === BookingStatus.COMPLETED || booking.finishedAt
        ? {
            status: booking.status,
            sessionStep: booking.sessionStep ?? SessionStep.NONE,
            finishedAt: booking.finishedAt,
          }
        : null,
    timeZoneUsed,
    meta: buildMeta(false),
  }
}
  const nextVersion = (booking.aftercareSummary?.version ?? 0) + 1

  const aftercare = await args.tx.aftercareSummary.upsert({
    where: { bookingId: booking.id },
    create: {
      bookingId: booking.id,
      notes: args.notes,
      rebookMode: args.rebookMode,
      rebookedFor: args.rebookedFor,
      rebookWindowStart: args.rebookWindowStart,
      rebookWindowEnd: args.rebookWindowEnd,

      // Important:
      // Do not mark sent here. Sending is only true after the access delivery
      // has been created successfully below.
      draftSavedAt: now,
      sentToClientAt: null,

      lastEditedAt: now,
      version: 1,
    },
    update: {
      notes: args.notes,
      rebookMode: args.rebookMode,
      rebookedFor: args.rebookedFor,
      rebookWindowStart: args.rebookWindowStart,
      rebookWindowEnd: args.rebookWindowEnd,

      // Important:
      // Preserve existing sent state, but do not create a new sent state yet.
      draftSavedAt: args.sendToClient
        ? booking.aftercareSummary?.draftSavedAt ?? now
        : now,
      sentToClientAt: booking.aftercareSummary?.sentToClientAt ?? null,

      lastEditedAt: now,
      version: nextVersion,
    },
    select: {
      id: true,
      rebookMode: true,
      rebookedFor: true,
      rebookWindowStart: true,
      rebookWindowEnd: true,
      draftSavedAt: true,
      sentToClientAt: true,
      lastEditedAt: true,
      version: true,
    },
  })

const validRebookSlot =
  args.rebookMode === AftercareRebookMode.BOOKED_NEXT_APPOINTMENT &&
  args.rebookSlot
    ? args.rebookSlot
    : null

if (validRebookSlot) {
  const rebookSlotOfferingId = validRebookSlot.offeringId

  if (!rebookSlotOfferingId) {
    throw bookingError('OFFERING_ID_REQUIRED', {
      message:
        'BOOKED_NEXT_APPOINTMENT aftercare rebook slots require an offeringId.',
      userMessage:
        'Choose the service for the next appointment before saving aftercare.',
    })
  }

  await args.tx.aftercareRebookSlot.upsert({
    where: {
      aftercareSummaryId: aftercare.id,
    },
    create: {
      aftercareSummaryId: aftercare.id,
      professionalId: args.professionalId,
      offeringId: rebookSlotOfferingId,
      locationId: validRebookSlot.locationId,
      locationType: validRebookSlot.locationType,
      startsAt: validRebookSlot.startsAt,
      endsAt: validRebookSlot.endsAt,
    },
    update: {
      professionalId: args.professionalId,
      offeringId: rebookSlotOfferingId,
      locationId: validRebookSlot.locationId,
      locationType: validRebookSlot.locationType,
      startsAt: validRebookSlot.startsAt,
      endsAt: validRebookSlot.endsAt,
    },
  })
} else {
  await args.tx.aftercareRebookSlot.deleteMany({
    where: {
      aftercareSummaryId: aftercare.id,
    },
  })
}

const aftercareAccessDelivery =
  await maybeCreateAftercareAccessDeliveryInBoundary({
    tx: args.tx,
    booking,
    aftercareId: aftercare.id,
    aftercareVersion: aftercare.version,
    actorUserId: args.actorUserId,
    shouldAttempt: shouldQueueAftercareAccessDelivery,
  })

const aftercareSentAt =
  args.sendToClient && !aftercare.sentToClientAt ? now : aftercare.sentToClientAt

const finalizedAftercare =
  args.sendToClient && !aftercare.sentToClientAt
    ? await args.tx.aftercareSummary.update({
        where: { id: aftercare.id },
        data: {
          sentToClientAt: aftercareSentAt,
          draftSavedAt: null,
        },
        select: {
          id: true,
          rebookMode: true,
          rebookedFor: true,
          rebookWindowStart: true,
          rebookWindowEnd: true,
          draftSavedAt: true,
          sentToClientAt: true,
          lastEditedAt: true,
          version: true,
        },
      })
    : aftercare

  await args.tx.productRecommendation.deleteMany({
    where: { aftercareSummaryId: aftercare.id },
  })

  if (args.recommendedProducts.length > 0) {
    await args.tx.productRecommendation.createMany({
      data: args.recommendedProducts.map((product) => ({
        aftercareSummaryId: aftercare.id,
        productId: product.productId,
        externalName: product.externalName,
        externalUrl: product.externalUrl,
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

await createUpdateClientNotification({
  tx: args.tx,
  clientId: booking.clientId,
  bookingId: booking.id,
  aftercareId: finalizedAftercare.id,
  eventKey: NotificationEventKey.AFTERCARE_READY,
  title: notifTitle,
  body: bodyPreview,
  dedupeKey: notifKey,
  href: `/client/bookings/${booking.id}?step=aftercare`,
  data: {
    bookingId: booking.id,
    aftercareId: finalizedAftercare.id,
    notificationReason: 'AFTERCARE_SENT',
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

  const afterMediaCount = args.sendToClient
    ? await countProAfterMediaForBooking({
        tx: args.tx,
        bookingId: booking.id,
      })
    : 0

  if (args.sendToClient) {
    const shouldCompleteBooking = canCompleteBookingCloseout({
      bookingStatus: booking.status,
      aftercareSentAt: finalizedAftercare.sentToClientAt,
      checkoutStatus: booking.checkoutStatus,
      paymentCollectedAt: booking.paymentCollectedAt,
      afterMediaCount,
    })

    if (shouldCompleteBooking) {
      recordStepTransition({
        from: booking.sessionStep ?? SessionStep.NONE,
        to: SessionStep.DONE,
        actor: 'PRO',
        route: 'lib/booking/writeBoundary.ts:upsertBookingAftercare#complete',
        bookingId: booking.id,
        professionalId: args.professionalId,
      })
      recordStatusTransition({
        from: booking.status,
        to: BookingStatus.COMPLETED,
        actor: 'PRO',
        route: 'lib/booking/writeBoundary.ts:upsertBookingAftercare#complete',
        bookingId: booking.id,
        professionalId: args.professionalId,
      })

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
  }

const oldAftercareState = {
  notes: normalizeReason(booking.aftercareSummary?.notes),
  rebookMode: booking.aftercareSummary?.rebookMode ?? AftercareRebookMode.NONE,
  rebookedFor: normalizeDateCmp(booking.aftercareSummary?.rebookedFor),
  rebookWindowStart: normalizeDateCmp(
    booking.aftercareSummary?.rebookWindowStart,
  ),
  rebookWindowEnd: normalizeDateCmp(
    booking.aftercareSummary?.rebookWindowEnd,
  ),
  rebookSlot: normalizeAftercareRebookSlotForComparison(
    booking.aftercareSummary?.rebookSlot,
  ),
  draftSavedAt: normalizeDateCmp(booking.aftercareSummary?.draftSavedAt),
  sentToClientAt: normalizeDateCmp(booking.aftercareSummary?.sentToClientAt),
  version: booking.aftercareSummary?.version ?? 0,
  recommendedProducts: buildExistingRecommendedProductsForComparison(
    booking.aftercareSummary?.recommendedProducts,
  ),
}

const newAftercareState = {
  notes: normalizeReason(args.notes),
  rebookMode: finalizedAftercare.rebookMode,
  rebookedFor: normalizeDateCmp(finalizedAftercare.rebookedFor),
  rebookWindowStart: normalizeDateCmp(finalizedAftercare.rebookWindowStart),
  rebookWindowEnd: normalizeDateCmp(finalizedAftercare.rebookWindowEnd),
  rebookSlot: normalizeAftercareRebookSlotForComparison(args.rebookSlot),
  draftSavedAt: normalizeDateCmp(finalizedAftercare.draftSavedAt),
  sentToClientAt: normalizeDateCmp(finalizedAftercare.sentToClientAt),
  version: finalizedAftercare.version,
  recommendedProducts: normalizeRecommendedProductsForComparison(
    args.recommendedProducts,
  ),
}

if (!areAuditValuesEqual(oldAftercareState, newAftercareState)) {
  await createBookingCloseoutAuditLog({
    tx: args.tx,
    bookingId: booking.id,
    professionalId: args.professionalId,
    action: args.sendToClient
      ? BookingCloseoutAuditAction.AFTERCARE_FINALIZED
      : BookingCloseoutAuditAction.AFTERCARE_DRAFT_SAVED,
    route: 'lib/booking/writeBoundary.ts:upsertBookingAftercare',
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    oldValue: oldAftercareState,
    newValue: newAftercareState,
    metadata: {
      remindersTouched,
      clientNotified,
      bookingFinished,
      timeZoneUsed,
    },
  })
}

return {
  aftercare: {
    id: finalizedAftercare.id,
    publicAccess: buildAftercarePublicAccess(),
    rebookMode: finalizedAftercare.rebookMode,
    rebookedFor: finalizedAftercare.rebookedFor,
    rebookWindowStart: finalizedAftercare.rebookWindowStart,
    rebookWindowEnd: finalizedAftercare.rebookWindowEnd,
    draftSavedAt: finalizedAftercare.draftSavedAt,
    sentToClientAt: finalizedAftercare.sentToClientAt,
    lastEditedAt: finalizedAftercare.lastEditedAt,
    version: finalizedAftercare.version,
  },
  remindersTouched,
  clientNotified,
  aftercareAccessDelivery,
  bookingFinished,
  completionBlockers: buildCompletionBlockers({
    sendToClient: args.sendToClient,
    bookingFinished,
    checkoutStatus: booking.checkoutStatus,
    paymentCollectedAt: booking.paymentCollectedAt,
    afterMediaCount,
  }),
  booking: bookingNow,
  timeZoneUsed,
  meta: buildMeta(true),
}
}
async function performLockedUpdateBookingCheckout(args: {
  tx: Prisma.TransactionClient
  now: Date
  bookingId: string
  professionalId: string
  tipAmount?: Prisma.Decimal | string | number | null
  taxAmount?: Prisma.Decimal | string | number | null
  discountAmount?: Prisma.Decimal | string | number | null
  selectedPaymentMethod?: PaymentMethod | null
  checkoutStatus?: BookingCheckoutStatus | null
  markPaymentAuthorized?: boolean
  markPaymentCollected?: boolean
  requestId?: string | null
  idempotencyKey?: string | null
}): Promise<UpdateBookingCheckoutResult> {
  const booking: BookingCheckoutRecord | null = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: BOOKING_CHECKOUT_SELECT,
  })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.professionalId !== args.professionalId) {
    throw bookingError('FORBIDDEN')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED')
  }

  const nextTipAmount =
    args.tipAmount === undefined
      ? undefined
      : normalizePositiveMoneyDecimal(args.tipAmount) ?? zeroMoney()

  const nextTaxAmount =
    args.taxAmount === undefined
      ? undefined
      : normalizePositiveMoneyDecimal(args.taxAmount) ?? zeroMoney()

  const nextDiscountAmount =
    args.discountAmount === undefined
      ? undefined
      : normalizePositiveMoneyDecimal(args.discountAmount) ?? zeroMoney()

  const rollup = await buildBookingCheckoutRollupUpdate({
    tx: args.tx,
    bookingId: booking.id,
    nextTipAmount,
    nextTaxAmount,
    nextDiscountAmount,
  })

  const shouldSetAuthorizedAt = args.markPaymentAuthorized === true
  const shouldSetCollectedAt = args.markPaymentCollected === true

  const nextCheckoutStatus =
    shouldSetCollectedAt
      ? (args.checkoutStatus ?? BookingCheckoutStatus.PAID)
      : (args.checkoutStatus ?? booking.checkoutStatus)

const oldCheckoutState = buildCheckoutAuditSnapshot({
  checkoutStatus: booking.checkoutStatus,
  selectedPaymentMethod: booking.selectedPaymentMethod,
  serviceSubtotalSnapshot: booking.serviceSubtotalSnapshot,
  productSubtotalSnapshot: booking.productSubtotalSnapshot,
  subtotalSnapshot: booking.subtotalSnapshot,
  tipAmount: booking.tipAmount,
  taxAmount: booking.taxAmount,
  discountAmount: booking.discountAmount,
  totalAmount: booking.totalAmount,
  paymentAuthorizedAt: booking.paymentAuthorizedAt,
  paymentCollectedAt: booking.paymentCollectedAt,
})

const nextCheckoutState = buildCheckoutAuditSnapshot({
  checkoutStatus: nextCheckoutStatus,
  selectedPaymentMethod:
    args.selectedPaymentMethod !== undefined
      ? args.selectedPaymentMethod
      : booking.selectedPaymentMethod,
  serviceSubtotalSnapshot: rollup.serviceSubtotalSnapshot,
  productSubtotalSnapshot: rollup.productSubtotalSnapshot,
  subtotalSnapshot: rollup.subtotalSnapshot,
  tipAmount: rollup.tipAmount,
  taxAmount: rollup.taxAmount,
  discountAmount: rollup.discountAmount,
  totalAmount: rollup.totalAmount,
  paymentAuthorizedAt: shouldSetAuthorizedAt
    ? booking.paymentAuthorizedAt ?? args.now
    : booking.paymentAuthorizedAt,
  paymentCollectedAt: shouldSetCollectedAt
    ? booking.paymentCollectedAt ?? args.now
    : booking.paymentCollectedAt,
})

if (areAuditValuesEqual(oldCheckoutState, nextCheckoutState)) {
  return {
    booking: {
      id: booking.id,
      checkoutStatus: booking.checkoutStatus,
      selectedPaymentMethod: booking.selectedPaymentMethod,
      serviceSubtotalSnapshot: booking.serviceSubtotalSnapshot,
      productSubtotalSnapshot: booking.productSubtotalSnapshot,
      subtotalSnapshot: booking.subtotalSnapshot,
      tipAmount: booking.tipAmount,
      taxAmount: booking.taxAmount,
      discountAmount: booking.discountAmount,
      totalAmount: booking.totalAmount,
      paymentAuthorizedAt: booking.paymentAuthorizedAt,
      paymentCollectedAt: booking.paymentCollectedAt,
    },
    meta: buildMeta(false),
  }
}

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      serviceSubtotalSnapshot: rollup.serviceSubtotalSnapshot,
      productSubtotalSnapshot: rollup.productSubtotalSnapshot,
      subtotalSnapshot: rollup.subtotalSnapshot,
      tipAmount: rollup.tipAmount,
      taxAmount: rollup.taxAmount,
      discountAmount: rollup.discountAmount,
      totalAmount: rollup.totalAmount,
      ...(args.selectedPaymentMethod !== undefined
        ? { selectedPaymentMethod: args.selectedPaymentMethod }
        : {}),
      ...(args.checkoutStatus != null
        ? { checkoutStatus: args.checkoutStatus }
        : {}),
      ...(shouldSetAuthorizedAt
        ? { paymentAuthorizedAt: booking.paymentAuthorizedAt ?? args.now }
        : {}),
      ...(shouldSetCollectedAt
        ? {
            paymentCollectedAt: booking.paymentCollectedAt ?? args.now,
            checkoutStatus:
              args.checkoutStatus ?? BookingCheckoutStatus.PAID,
          }
        : {}),
    },
    select: {
      id: true,
      checkoutStatus: true,
      selectedPaymentMethod: true,
      serviceSubtotalSnapshot: true,
      productSubtotalSnapshot: true,
      subtotalSnapshot: true,
      tipAmount: true,
      taxAmount: true,
      discountAmount: true,
      totalAmount: true,
      paymentAuthorizedAt: true,
      paymentCollectedAt: true,
    } satisfies Prisma.BookingSelect,
  })

  await maybeCompleteBookingCloseout({
    tx: args.tx,
    now: args.now,
    booking,
    checkoutStatus: updated.checkoutStatus,
    paymentCollectedAt: updated.paymentCollectedAt,
    actor: 'PRO',
    route: 'lib/booking/writeBoundary.ts:updateBookingCheckout',
  })

  
await createCheckoutAuditLogs({
  tx: args.tx,
  bookingId: booking.id,
  professionalId: args.professionalId,
  route: 'lib/booking/writeBoundary.ts:updateBookingCheckout',
  requestId: args.requestId,
  idempotencyKey: args.idempotencyKey,
  oldState: oldCheckoutState,
  newState: buildCheckoutAuditSnapshot({
    checkoutStatus: updated.checkoutStatus,
    selectedPaymentMethod: updated.selectedPaymentMethod,
    serviceSubtotalSnapshot: updated.serviceSubtotalSnapshot,
    productSubtotalSnapshot: updated.productSubtotalSnapshot,
    subtotalSnapshot: updated.subtotalSnapshot,
    tipAmount: updated.tipAmount,
    taxAmount: updated.taxAmount,
    discountAmount: updated.discountAmount,
    totalAmount: updated.totalAmount,
    paymentAuthorizedAt: updated.paymentAuthorizedAt,
    paymentCollectedAt: updated.paymentCollectedAt,
  }),
})

  return {
    booking: {
      id: updated.id,
      checkoutStatus: updated.checkoutStatus,
      selectedPaymentMethod: updated.selectedPaymentMethod,
      serviceSubtotalSnapshot: updated.serviceSubtotalSnapshot,
      productSubtotalSnapshot: updated.productSubtotalSnapshot,
      subtotalSnapshot: updated.subtotalSnapshot,
      tipAmount: updated.tipAmount,
      taxAmount: updated.taxAmount,
      discountAmount: updated.discountAmount,
      totalAmount: updated.totalAmount,
      paymentAuthorizedAt: updated.paymentAuthorizedAt,
      paymentCollectedAt: updated.paymentCollectedAt,
    },
    meta: buildMeta(true),
  }
}

async function performLockedUpdateProCheckoutCloseout(args: {
  tx: Prisma.TransactionClient
  now: Date
  bookingId: string
  professionalId: string
  actorUserId: string
  checkoutStatus: BookingCheckoutStatus
  paymentCollectedAt: Date
  route: string
  requestId?: string | null
  idempotencyKey?: string | null
}): Promise<ProCheckoutCloseoutResult> {
  assertNonEmptyUserId(args.actorUserId)

  if (
    args.checkoutStatus !== BookingCheckoutStatus.PAID &&
    args.checkoutStatus !== BookingCheckoutStatus.WAIVED
  ) {
    throw bookingError('FORBIDDEN', {
      message: 'Pro checkout closeout only supports PAID or WAIVED.',
      userMessage: 'Checkout can only be marked paid or waived here.',
    })
  }

  const booking: ProCheckoutCloseoutRecord | null =
    await args.tx.booking.findUnique({
      where: { id: args.bookingId },
      select: PRO_CHECKOUT_CLOSEOUT_SELECT,
    })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.professionalId !== args.professionalId) {
    throw bookingError('FORBIDDEN')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED')
  }

  if (
    booking.status === BookingStatus.COMPLETED &&
    booking.sessionStep === SessionStep.DONE &&
    booking.finishedAt &&
    booking.checkoutStatus === args.checkoutStatus &&
    booking.paymentCollectedAt
  ) {
    return {
      booking: {
        id: booking.id,
        status: booking.status,
        sessionStep: booking.sessionStep ?? SessionStep.NONE,
        checkoutStatus: booking.checkoutStatus,
        paymentCollectedAt: booking.paymentCollectedAt,
      },
      meta: {
        ...buildMeta(false),
        completedBooking: false,
      },
    }
  }

  if (
    booking.checkoutStatus === args.checkoutStatus &&
    booking.paymentCollectedAt
  ) {
    return {
      booking: {
        id: booking.id,
        status: booking.status,
        sessionStep: booking.sessionStep ?? SessionStep.NONE,
        checkoutStatus: booking.checkoutStatus,
        paymentCollectedAt: booking.paymentCollectedAt,
      },
      meta: {
        ...buildMeta(false),
        completedBooking: false,
      },
    }
  }

  if (
    booking.checkoutStatus === BookingCheckoutStatus.PAID &&
    args.checkoutStatus === BookingCheckoutStatus.WAIVED
  ) {
    throw bookingError('FORBIDDEN', {
      message: 'Paid checkout cannot be waived.',
      userMessage: 'This checkout is already paid and cannot be waived.',
    })
  }

  if (
    booking.checkoutStatus === BookingCheckoutStatus.WAIVED &&
    args.checkoutStatus === BookingCheckoutStatus.PAID
  ) {
    throw bookingError('FORBIDDEN', {
      message: 'Waived checkout cannot be marked paid.',
      userMessage: 'This checkout is already waived and cannot be marked paid.',
    })
  }

  if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
    throw bookingError('BOOKING_CANNOT_EDIT_COMPLETED', {
      message: 'Completed bookings cannot have checkout changed.',
      userMessage: 'This booking is already completed.',
    })
  }

  const oldCheckoutState = buildCheckoutAuditSnapshot({
    checkoutStatus: booking.checkoutStatus,
    selectedPaymentMethod: booking.selectedPaymentMethod,
    serviceSubtotalSnapshot: booking.serviceSubtotalSnapshot,
    productSubtotalSnapshot: booking.productSubtotalSnapshot,
    subtotalSnapshot: booking.subtotalSnapshot,
    tipAmount: booking.tipAmount,
    taxAmount: booking.taxAmount,
    discountAmount: booking.discountAmount,
    totalAmount: booking.totalAmount,
    paymentAuthorizedAt: booking.paymentAuthorizedAt,
    paymentCollectedAt: booking.paymentCollectedAt,
  })

  const nextPaymentCollectedAt =
    booking.paymentCollectedAt ?? args.paymentCollectedAt

  const nextPaymentAuthorizedAt =
    booking.paymentAuthorizedAt ?? args.paymentCollectedAt

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      checkoutStatus: args.checkoutStatus,
      paymentAuthorizedAt: nextPaymentAuthorizedAt,
      paymentCollectedAt: nextPaymentCollectedAt,
    },
    select: PRO_CHECKOUT_CLOSEOUT_SELECT,
  })

  let finalBooking = {
    id: updated.id,
    status: updated.status,
    sessionStep: updated.sessionStep ?? SessionStep.NONE,
    checkoutStatus: updated.checkoutStatus,
    paymentCollectedAt: updated.paymentCollectedAt,
  }

  let completedBooking = false

  completedBooking = await maybeCompleteBookingCloseout({
    tx: args.tx,
    now: args.now,
    booking,
    checkoutStatus: updated.checkoutStatus,
    paymentCollectedAt: updated.paymentCollectedAt,
    actor: 'PRO',
    route: args.route,
  })

  if (completedBooking) {
    finalBooking = {
      id: updated.id,
      status: BookingStatus.COMPLETED,
      sessionStep: SessionStep.DONE,
      checkoutStatus: updated.checkoutStatus,
      paymentCollectedAt: updated.paymentCollectedAt,
    }
  }

  await createCheckoutAuditLogs({
    tx: args.tx,
    bookingId: booking.id,
    professionalId: args.professionalId,
    route: args.route,
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    oldState: oldCheckoutState,
    newState: buildCheckoutAuditSnapshot({
      checkoutStatus: updated.checkoutStatus,
      selectedPaymentMethod: updated.selectedPaymentMethod,
      serviceSubtotalSnapshot: updated.serviceSubtotalSnapshot,
      productSubtotalSnapshot: updated.productSubtotalSnapshot,
      subtotalSnapshot: updated.subtotalSnapshot,
      tipAmount: updated.tipAmount,
      taxAmount: updated.taxAmount,
      discountAmount: updated.discountAmount,
      totalAmount: updated.totalAmount,
      paymentAuthorizedAt: updated.paymentAuthorizedAt,
      paymentCollectedAt: updated.paymentCollectedAt,
    }),
  })

  return {
    booking: finalBooking,
    meta: {
      ...buildMeta(true),
      completedBooking,
    },
  }
}

function assertCanCreateRebookFromSourceBooking(args: {
  source: RebookSourceBookingRecord
  clientId?: string | null
  aftercareId?: string | null
}): void {
  if (args.clientId && args.source.clientId !== args.clientId) {
    throw bookingError('FORBIDDEN')
  }

  if (args.source.status !== BookingStatus.COMPLETED) {
    throw bookingError('AFTERCARE_NOT_COMPLETED', {
      message: 'Only COMPLETED bookings can be rebooked.',
      userMessage: 'Only COMPLETED bookings can be rebooked.',
    })
  }

  if (!args.source.finishedAt) {
    throw bookingError('AFTERCARE_NOT_COMPLETED', {
      message: 'Only finished bookings can be rebooked.',
      userMessage: 'This appointment is not ready to rebook yet.',
    })
  }

  if (!args.source.aftercareSummary?.id) {
    throw bookingError('AFTERCARE_NOT_COMPLETED', {
      message: 'Rebooking requires finalized aftercare.',
      userMessage: 'This appointment is not ready to rebook yet.',
    })
  }

  if (
    args.aftercareId &&
    args.source.aftercareSummary.id !== args.aftercareId
  ) {
    throw bookingError('FORBIDDEN', {
      message: 'Aftercare does not belong to the requested source booking.',
      userMessage: 'That aftercare link is invalid or expired.',
    })
  }

  if (!args.source.aftercareSummary.sentToClientAt) {
    throw bookingError('AFTERCARE_NOT_COMPLETED', {
      message: 'Rebooking requires finalized aftercare.',
      userMessage: 'This appointment is not ready to rebook yet.',
    })
  }

  if (!isCheckoutCloseoutComplete(args.source.checkoutStatus)) {
    throw bookingError('AFTERCARE_NOT_COMPLETED', {
      message: 'Rebooking requires completed checkout.',
      userMessage: 'This appointment is not ready to rebook yet.',
    })
  }

  if (!args.source.paymentCollectedAt) {
    throw bookingError('AFTERCARE_NOT_COMPLETED', {
      message: 'Rebooking requires collected payment.',
      userMessage: 'This appointment is not ready to rebook yet.',
    })
  }
}

async function performLockedUpdateClientBookingCheckout(args: {
  tx: Prisma.TransactionClient
  now: Date
  bookingId: string
  clientId: string
  tipAmount?: Prisma.Decimal | string | number | null
  selectedPaymentMethod?: PaymentMethod | null
  checkoutStatus?: BookingCheckoutStatus | null
  markPaymentAuthorized?: boolean
  markPaymentCollected?: boolean
  requestId?: string | null
  idempotencyKey?: string | null
}): Promise<UpdateBookingCheckoutResult> {
  const booking: ClientBookingCheckoutRecord | null =
    await args.tx.booking.findUnique({
      where: { id: args.bookingId },
      select: CLIENT_BOOKING_CHECKOUT_SELECT,
    })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  assertClientCanUpdateBookingCheckout(booking, args.clientId)

  const nextTipAmount =
    args.tipAmount === undefined
      ? undefined
      : normalizePositiveMoneyDecimal(args.tipAmount) ?? zeroMoney()

  const shouldSetAuthorizedAt = args.markPaymentAuthorized === true
  const shouldSetCollectedAt = args.markPaymentCollected === true

  if (shouldSetCollectedAt && args.selectedPaymentMethod === undefined && !booking.selectedPaymentMethod) {
    throw bookingError('FORBIDDEN', {
      message: 'Payment method is required before confirming payment.',
      userMessage: 'Choose a payment method before confirming payment.',
    })
  }

  const nextCheckoutStatus =
    shouldSetCollectedAt
      ? (args.checkoutStatus ?? BookingCheckoutStatus.PAID)
      : (args.checkoutStatus ?? booking.checkoutStatus)

  const rollup = await buildBookingCheckoutRollupUpdate({
    tx: args.tx,
    bookingId: booking.id,
    nextTipAmount,
  })

  const oldCheckoutState = buildCheckoutAuditSnapshot({
  checkoutStatus: booking.checkoutStatus,
  selectedPaymentMethod: booking.selectedPaymentMethod,
  serviceSubtotalSnapshot: booking.serviceSubtotalSnapshot,
  productSubtotalSnapshot: booking.productSubtotalSnapshot,
  subtotalSnapshot: booking.subtotalSnapshot,
  tipAmount: booking.tipAmount,
  taxAmount: booking.taxAmount,
  discountAmount: booking.discountAmount,
  totalAmount: booking.totalAmount,
  paymentAuthorizedAt: booking.paymentAuthorizedAt,
  paymentCollectedAt: booking.paymentCollectedAt,
})

const nextCheckoutState = buildCheckoutAuditSnapshot({
  checkoutStatus: nextCheckoutStatus,
  selectedPaymentMethod:
    args.selectedPaymentMethod !== undefined
      ? args.selectedPaymentMethod
      : booking.selectedPaymentMethod,
  serviceSubtotalSnapshot: rollup.serviceSubtotalSnapshot,
  productSubtotalSnapshot: rollup.productSubtotalSnapshot,
  subtotalSnapshot: rollup.subtotalSnapshot,
  tipAmount: rollup.tipAmount,
  taxAmount: rollup.taxAmount,
  discountAmount: rollup.discountAmount,
  totalAmount: rollup.totalAmount,
  paymentAuthorizedAt: shouldSetCollectedAt
    ? booking.paymentAuthorizedAt ?? args.now
    : shouldSetAuthorizedAt
      ? booking.paymentAuthorizedAt ?? args.now
      : booking.paymentAuthorizedAt,
  paymentCollectedAt: shouldSetCollectedAt
    ? booking.paymentCollectedAt ?? args.now
    : booking.paymentCollectedAt,
})

if (areAuditValuesEqual(oldCheckoutState, nextCheckoutState)) {
  return {
    booking: {
      id: booking.id,
      checkoutStatus: booking.checkoutStatus,
      selectedPaymentMethod: booking.selectedPaymentMethod,
      serviceSubtotalSnapshot: booking.serviceSubtotalSnapshot,
      productSubtotalSnapshot: booking.productSubtotalSnapshot,
      subtotalSnapshot: booking.subtotalSnapshot,
      tipAmount: booking.tipAmount,
      taxAmount: booking.taxAmount,
      discountAmount: booking.discountAmount,
      totalAmount: booking.totalAmount,
      paymentAuthorizedAt: booking.paymentAuthorizedAt,
      paymentCollectedAt: booking.paymentCollectedAt,
    },
    meta: buildMeta(false),
  }
}

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      serviceSubtotalSnapshot: rollup.serviceSubtotalSnapshot,
      productSubtotalSnapshot: rollup.productSubtotalSnapshot,
      subtotalSnapshot: rollup.subtotalSnapshot,
      tipAmount: rollup.tipAmount,
      taxAmount: rollup.taxAmount,
      discountAmount: rollup.discountAmount,
      totalAmount: rollup.totalAmount,
      ...(args.selectedPaymentMethod !== undefined
        ? { selectedPaymentMethod: args.selectedPaymentMethod }
        : {}),
      ...(args.checkoutStatus != null
        ? { checkoutStatus: args.checkoutStatus }
        : {}),
      ...(shouldSetAuthorizedAt
        ? { paymentAuthorizedAt: booking.paymentAuthorizedAt ?? args.now }
        : {}),
      ...(shouldSetCollectedAt
        ? {
            paymentAuthorizedAt: booking.paymentAuthorizedAt ?? args.now,
            paymentCollectedAt: booking.paymentCollectedAt ?? args.now,
            checkoutStatus: args.checkoutStatus ?? BookingCheckoutStatus.PAID,
          }
        : {}),
    },
    select: {
      id: true,
      checkoutStatus: true,
      selectedPaymentMethod: true,
      serviceSubtotalSnapshot: true,
      productSubtotalSnapshot: true,
      subtotalSnapshot: true,
      tipAmount: true,
      taxAmount: true,
      discountAmount: true,
      totalAmount: true,
      paymentAuthorizedAt: true,
      paymentCollectedAt: true,
    } satisfies Prisma.BookingSelect,
  })

  await maybeCompleteBookingCloseout({
    tx: args.tx,
    now: args.now,
    booking,
    checkoutStatus: updated.checkoutStatus,
    paymentCollectedAt: updated.paymentCollectedAt,
    actor: 'SYSTEM',
    route: 'lib/booking/writeBoundary.ts:updateClientBookingCheckout',
  })

  await createCheckoutAuditLogs({
  tx: args.tx,
  bookingId: booking.id,
  professionalId: booking.professionalId,
  route: 'lib/booking/writeBoundary.ts:updateClientBookingCheckout',
  requestId: args.requestId,
  idempotencyKey: args.idempotencyKey,
  oldState: oldCheckoutState,
  newState: buildCheckoutAuditSnapshot({
    checkoutStatus: updated.checkoutStatus,
    selectedPaymentMethod: updated.selectedPaymentMethod,
    serviceSubtotalSnapshot: updated.serviceSubtotalSnapshot,
    productSubtotalSnapshot: updated.productSubtotalSnapshot,
    subtotalSnapshot: updated.subtotalSnapshot,
    tipAmount: updated.tipAmount,
    taxAmount: updated.taxAmount,
    discountAmount: updated.discountAmount,
    totalAmount: updated.totalAmount,
    paymentAuthorizedAt: updated.paymentAuthorizedAt,
    paymentCollectedAt: updated.paymentCollectedAt,
  }),
})

  return {
    booking: {
      id: updated.id,
      checkoutStatus: updated.checkoutStatus,
      selectedPaymentMethod: updated.selectedPaymentMethod,
      serviceSubtotalSnapshot: updated.serviceSubtotalSnapshot,
      productSubtotalSnapshot: updated.productSubtotalSnapshot,
      subtotalSnapshot: updated.subtotalSnapshot,
      tipAmount: updated.tipAmount,
      taxAmount: updated.taxAmount,
      discountAmount: updated.discountAmount,
      totalAmount: updated.totalAmount,
      paymentAuthorizedAt: updated.paymentAuthorizedAt,
      paymentCollectedAt: updated.paymentCollectedAt,
    },
    meta: buildMeta(true),
  }
}

async function performLockedUpsertClientBookingCheckoutProducts(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  clientId: string
  items: ClientCheckoutProductSelectionInput[]
  requestId?: string | null
  idempotencyKey?: string | null
}): Promise<UpsertClientBookingCheckoutProductsResult> {
  const booking: ClientCheckoutProductsBookingRecord | null =
    await args.tx.booking.findUnique({
      where: { id: args.bookingId },
      select: CLIENT_CHECKOUT_PRODUCTS_BOOKING_SELECT,
    })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  assertClientCanEditBookingCheckoutProducts(booking, args.clientId)

  const recommendationRows = booking.aftercareSummary?.recommendedProducts ?? []
  const recommendationById = new Map(
    recommendationRows.map((row) => [row.id, row]),
  )

  for (const item of args.items) {
    const recommendation = recommendationById.get(item.recommendationId)

    if (!recommendation) {
      throw bookingError('FORBIDDEN', {
        message: 'Selected recommendation does not belong to this booking.',
        userMessage: 'One or more selected products are invalid for this booking.',
      })
    }

    if (!recommendation.productId) {
      throw bookingError('FORBIDDEN', {
        message: 'External recommendations cannot be added to booking checkout.',
        userMessage: 'Only in-app recommended products can be added to checkout.',
      })
    }

    if (recommendation.productId !== item.productId) {
      throw bookingError('FORBIDDEN', {
        message: 'Selected product does not match its recommendation.',
        userMessage: 'One or more selected products are invalid.',
      })
    }

    if (!Number.isFinite(item.quantity) || Math.trunc(item.quantity) <= 0) {
      throw bookingError('FORBIDDEN', {
        message: 'Quantity must be at least 1.',
        userMessage: 'Each selected product needs a valid quantity.',
      })
    }
  }

  const uniqueProductIds = Array.from(
    new Set(args.items.map((item) => item.productId)),
  )

  const products = uniqueProductIds.length
    ? await args.tx.product.findMany({
        where: {
          id: { in: uniqueProductIds },
          isActive: true,
        },
        select: {
          id: true,
          retailPrice: true,
        },
        take: uniqueProductIds.length,
      })
    : []

  if (products.length !== uniqueProductIds.length) {
    throw bookingError('FORBIDDEN', {
      message: 'One or more selected products are unavailable.',
      userMessage: 'One or more selected products are no longer available.',
    })
  }

  const productById = new Map(products.map((product) => [product.id, product]))

  const existingSelection = buildExistingCheckoutSelectionForComparison(
    booking.checkoutProductItems,
  )

  const incomingSelection = normalizeCheckoutSelectionForComparison(args.items)

  if (areAuditValuesEqual(existingSelection, incomingSelection)) {
    return {
      booking: {
        id: booking.id,
        checkoutStatus: booking.checkoutStatus,
        serviceSubtotalSnapshot: booking.serviceSubtotalSnapshot,
        productSubtotalSnapshot: booking.productSubtotalSnapshot,
        subtotalSnapshot: booking.subtotalSnapshot,
        tipAmount: booking.tipAmount,
        taxAmount: booking.taxAmount,
        discountAmount: booking.discountAmount,
        totalAmount: booking.totalAmount,
        paymentAuthorizedAt: booking.paymentAuthorizedAt,
        paymentCollectedAt: booking.paymentCollectedAt,
      },
      selectedProducts: booking.checkoutProductItems.map((item) => ({
        recommendationId: item.recommendationId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.unitPrice.mul(item.quantity),
      })),
      meta: buildMeta(false),
    }
  }

  const normalizedSelectedProducts = args.items.map((item) => {
    const product = productById.get(item.productId)

    if (!product) {
      throw bookingError('FORBIDDEN', {
        message: 'One or more selected products are unavailable.',
        userMessage: 'One or more selected products are no longer available.',
      })
    }

    const unitPrice = product.retailPrice
    if (!unitPrice) {
      throw bookingError('FORBIDDEN', {
        message: 'Selected product is missing retailPrice.',
        userMessage: 'One or more selected products cannot be purchased right now.',
      })
    }

    const quantity = Math.max(1, Math.trunc(item.quantity))
    const lineTotal = unitPrice.mul(quantity)

    return {
      recommendationId: item.recommendationId,
      productId: item.productId,
      quantity,
      unitPrice,
      lineTotal,
    }
  })

  // REQUIRES SCHEMA RELATION
  await args.tx.bookingCheckoutProductItem.deleteMany({
    where: { bookingId: booking.id },
  })

  if (normalizedSelectedProducts.length > 0) {
    await args.tx.bookingCheckoutProductItem.createMany({
      data: normalizedSelectedProducts.map((item) => ({
        bookingId: booking.id,
        recommendationId: item.recommendationId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    })
  }

  const nextProductSubtotal = normalizedSelectedProducts.reduce(
    (sum, item) => sum.add(item.lineTotal),
    zeroMoney(),
  )

  const rollup = await buildBookingCheckoutRollupUpdate({
    tx: args.tx,
    bookingId: booking.id,
    nextProductSubtotal,
  })

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      serviceSubtotalSnapshot: rollup.serviceSubtotalSnapshot,
      productSubtotalSnapshot: rollup.productSubtotalSnapshot,
      subtotalSnapshot: rollup.subtotalSnapshot,
      tipAmount: rollup.tipAmount,
      taxAmount: rollup.taxAmount,
      discountAmount: rollup.discountAmount,
      totalAmount: rollup.totalAmount,
      checkoutStatus:
        booking.checkoutStatus === BookingCheckoutStatus.NOT_READY
          ? BookingCheckoutStatus.READY
          : booking.checkoutStatus,
    },
    select: {
      id: true,
      checkoutStatus: true,
      serviceSubtotalSnapshot: true,
      productSubtotalSnapshot: true,
      subtotalSnapshot: true,
      tipAmount: true,
      taxAmount: true,
      discountAmount: true,
      totalAmount: true,
      paymentAuthorizedAt: true,
      paymentCollectedAt: true,
    } satisfies Prisma.BookingSelect,
  })

  await createBookingCloseoutAuditLog({
  tx: args.tx,
  bookingId: booking.id,
  professionalId: booking.professionalId,
  action: BookingCloseoutAuditAction.CHECKOUT_PRODUCTS_UPDATED,
  route: 'lib/booking/writeBoundary.ts:upsertClientBookingCheckoutProducts',
  requestId: args.requestId,
  idempotencyKey: args.idempotencyKey,
  oldValue: {
    selectedProducts: existingSelection,
    productSubtotalSnapshot: normalizeDecimalCmp(booking.productSubtotalSnapshot),
    totalAmount: normalizeDecimalCmp(booking.totalAmount),
    checkoutStatus: booking.checkoutStatus,
  },
  newValue: {
    selectedProducts: incomingSelection,
    productSubtotalSnapshot: normalizeDecimalCmp(updated.productSubtotalSnapshot),
    totalAmount: normalizeDecimalCmp(updated.totalAmount),
    checkoutStatus: updated.checkoutStatus,
  },
})

  return {
    booking: {
      id: updated.id,
      checkoutStatus: updated.checkoutStatus,
      serviceSubtotalSnapshot: updated.serviceSubtotalSnapshot,
      productSubtotalSnapshot: updated.productSubtotalSnapshot,
      subtotalSnapshot: updated.subtotalSnapshot,
      tipAmount: updated.tipAmount,
      taxAmount: updated.taxAmount,
      discountAmount: updated.discountAmount,
      totalAmount: updated.totalAmount,
      paymentAuthorizedAt: updated.paymentAuthorizedAt,
      paymentCollectedAt: updated.paymentCollectedAt,
    },
    selectedProducts: normalizedSelectedProducts,
    meta: buildMeta(true),
  }
}

async function performLockedAssertClientBookingReviewEligibility(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  clientId: string
}): Promise<AssertClientBookingReviewEligibilityResult> {
  const booking: ClientReviewEligibilityBookingRecord | null =
    await args.tx.booking.findUnique({
      where: { id: args.bookingId },
      select: CLIENT_REVIEW_ELIGIBILITY_BOOKING_SELECT,
    })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  assertClientCanCreateBookingReview(booking, args.clientId)

  return {
    booking: {
      id: booking.id,
      professionalId: booking.professionalId,
      status: booking.status,
      finishedAt: booking.finishedAt,
      checkoutStatus: booking.checkoutStatus,
      paymentCollectedAt: booking.paymentCollectedAt,
      aftercareSentAt: booking.aftercareSummary?.sentToClientAt ?? null,
    },
    meta: buildMeta(false),
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
  }, { timeout: 30_000, maxWait: 10_000 })
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
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
        explicitSelection: args.explicitSelection ?? false,
        actorUserId: args.actorUserId ?? null,
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
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
  )
}

export async function confirmBookingFinalReview(
  args: ConfirmBookingFinalReviewArgs,
): Promise<ConfirmBookingFinalReviewResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx }) =>
      performLockedConfirmBookingFinalReview({
        tx,
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        finalLineItems: args.finalLineItems,
        expectedSubtotal: args.expectedSubtotal ?? null,
        recommendedProducts: args.recommendedProducts ?? [],
        rebookMode: args.rebookMode ?? AftercareRebookMode.NONE,
        rebookedFor: args.rebookedFor ?? null,
        rebookWindowStart: args.rebookWindowStart ?? null,
        rebookWindowEnd: args.rebookWindowEnd ?? null,
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
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
    requestId: args.requestId ?? null,
    idempotencyKey: args.idempotencyKey ?? null,
  })
}

export async function approveConsultationAndMaterializeBooking(args: {
  bookingId: string
  clientId: string
  professionalId: string
  requestId?: string | null
  idempotencyKey?: string | null
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
        provenance: {
          method: 'REMOTE_SECURE_LINK',
          recordedByUserId: null,
          clientActionTokenId: null,
          contactMethod: null,
          destinationSnapshot: null,
          ipAddress: null,
          userAgent: null,
        },
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
  })
}

export async function approveConsultationByClientActionToken(
  args: ApproveConsultationByClientActionTokenArgs,
): Promise<ApproveConsultationMaterializationResult> {
  const consumed = await consumeConsultationActionToken({
    rawToken: args.rawToken,
  })

  return withLockedClientOwnedBookingTransaction({
    bookingId: consumed.bookingId,
    clientId: consumed.clientId,
    run: async ({ tx, now }) =>
      performLockedApproveConsultationMaterialization({
        tx,
        bookingId: consumed.bookingId,
        clientId: consumed.clientId,
        professionalId: consumed.professionalId,
        now,
        provenance: {
          method: 'REMOTE_SECURE_LINK',
          recordedByUserId: null,
          clientActionTokenId: consumed.id,
          contactMethod: consumed.deliveryMethod,
          destinationSnapshot: consumed.destinationSnapshot,
          ipAddress: normalizeReason(args.ipAddress),
          userAgent: normalizeReason(args.userAgent),
        },
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
  })
}

export async function rejectConsultationByClientActionToken(
  args: RejectConsultationByClientActionTokenArgs,
): Promise<RejectConsultationResult> {
  const consumed = await consumeConsultationActionToken({
    rawToken: args.rawToken,
  })

  return withLockedClientOwnedBookingTransaction({
    bookingId: consumed.bookingId,
    clientId: consumed.clientId,
    run: async ({ tx, now }) =>
      performLockedRejectConsultationDecision({
        tx,
        bookingId: consumed.bookingId,
        clientId: consumed.clientId,
        professionalId: consumed.professionalId,
        now,
        provenance: {
          method: 'REMOTE_SECURE_LINK',
          recordedByUserId: null,
          clientActionTokenId: consumed.id,
          contactMethod: consumed.deliveryMethod,
          destinationSnapshot: consumed.destinationSnapshot,
          ipAddress: normalizeReason(args.ipAddress),
          userAgent: normalizeReason(args.userAgent),
        },
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
  })
}

export async function recordInPersonConsultationDecision(
  args: RecordInPersonConsultationDecisionArgs,
): Promise<ApproveConsultationMaterializationResult | RejectConsultationResult> {
  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) => {
      const booking = await tx.booking.findUnique({
        where: { id: args.bookingId },
        select: {
          id: true,
          clientId: true,
          professionalId: true,
        } satisfies Prisma.BookingSelect,
      })

      if (!booking) {
        throw bookingError('BOOKING_NOT_FOUND')
      }

      if (booking.professionalId !== args.professionalId) {
        throw bookingError('FORBIDDEN')
      }

      if (!booking.clientId) {
        throw bookingError('FORBIDDEN', {
          message: 'Booking is missing client ownership.',
          userMessage: 'This consultation cannot be recorded.',
        })
      }

      const provenance: ConsultationDecisionProvenance = {
        method: 'IN_PERSON_PRO_DEVICE',
        recordedByUserId: args.recordedByUserId,
        clientActionTokenId: null,
        contactMethod: null,
        destinationSnapshot: null,
        ipAddress: null,
        userAgent: normalizeReason(args.userAgent),
      }

      if (args.decision === ConsultationDecision.APPROVED) {
        return performLockedApproveConsultationMaterialization({
          tx,
          bookingId: booking.id,
          clientId: booking.clientId,
          professionalId: booking.professionalId,
          now,
          provenance,
          requestId: args.requestId ?? null,
          idempotencyKey: args.idempotencyKey ?? null,
        })
      }

      return performLockedRejectConsultationDecision({
        tx,
        bookingId: booking.id,
        clientId: booking.clientId,
        professionalId: booking.professionalId,
        now,
        provenance,
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      })
    },
  )
}

export function canBookingAcceptClientReview(args: {
  bookingStatus: BookingStatus | null | undefined
  finishedAt: Date | null | undefined
  aftercareSentAt: Date | null | undefined
  checkoutStatus: BookingCheckoutStatus | null | undefined
  paymentCollectedAt: Date | null | undefined
}): boolean {
  return isReviewEligibleCloseout(args)
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
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
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
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
  )
}

export async function upsertBookingAftercare(
  args: UpsertBookingAftercareArgs,
): Promise<UpsertBookingAftercareResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)
  assertNonEmptyUserId(args.actorUserId)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) =>
      performLockedUpsertBookingAftercare({
        tx,
        now,
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        actorUserId: args.actorUserId,
        notes: args.notes,
        rebookMode: args.rebookMode,
        rebookedFor: args.rebookedFor,
        rebookWindowStart: args.rebookWindowStart,
        rebookWindowEnd: args.rebookWindowEnd,
        rebookSlot: args.rebookSlot,
        createRebookReminder: args.createRebookReminder,
        rebookReminderDaysBefore: args.rebookReminderDaysBefore,
        createProductReminder: args.createProductReminder,
        productReminderDaysAfter: args.productReminderDaysAfter,
        recommendedProducts: args.recommendedProducts,
        sendToClient: args.sendToClient,
        version: args.version,
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
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
        bookingEntryPoint: args.bookingEntryPoint,
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

  await prisma.$transaction(async (tx) => {
    const checkoutRollup = await buildBookingCheckoutRollupUpdate({
      tx,
      bookingId: booking.id,
      nextDiscountAmount: args.discountAmount,
    })

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        discountAmount: checkoutRollup.discountAmount,
        subtotalSnapshot: checkoutRollup.subtotalSnapshot,
        serviceSubtotalSnapshot: checkoutRollup.serviceSubtotalSnapshot,
        productSubtotalSnapshot: checkoutRollup.productSubtotalSnapshot,
        tipAmount: checkoutRollup.tipAmount,
        taxAmount: checkoutRollup.taxAmount,
        totalAmount: checkoutRollup.totalAmount,
      },
      select: { id: true } satisfies Prisma.BookingSelect,
    })
  })

  return {
    bookingId: booking.id,
    meta: buildMeta(true),
  }
}

export async function updateBookingCheckout(
  args: UpdateBookingCheckoutArgs,
): Promise<UpdateBookingCheckoutResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) =>
      performLockedUpdateBookingCheckout({
        tx,
        now,
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        tipAmount: args.tipAmount,
        taxAmount: args.taxAmount,
        discountAmount: args.discountAmount,
        selectedPaymentMethod: args.selectedPaymentMethod,
        checkoutStatus: args.checkoutStatus,
        markPaymentAuthorized: args.markPaymentAuthorized,
        markPaymentCollected: args.markPaymentCollected,
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
  )
}

export async function markProBookingCheckoutPaid(
  args: MarkProBookingCheckoutPaidArgs,
): Promise<ProCheckoutCloseoutResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)
  assertNonEmptyUserId(args.actorUserId)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) =>
      performLockedUpdateProCheckoutCloseout({
        tx,
        now,
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        actorUserId: args.actorUserId,
        checkoutStatus: BookingCheckoutStatus.PAID,
        paymentCollectedAt: now,
        route: 'lib/booking/writeBoundary.ts:markProBookingCheckoutPaid',
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
  )
}

export async function waiveProBookingCheckout(
  args: WaiveProBookingCheckoutArgs,
): Promise<ProCheckoutCloseoutResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)
  assertNonEmptyUserId(args.actorUserId)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) =>
      performLockedUpdateProCheckoutCloseout({
        tx,
        now,
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        actorUserId: args.actorUserId,
        checkoutStatus: BookingCheckoutStatus.WAIVED,
        paymentCollectedAt: now,
        route: 'lib/booking/writeBoundary.ts:waiveProBookingCheckout',
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
  )
}

export async function updateClientBookingCheckout(
  args: UpdateClientBookingCheckoutArgs,
): Promise<UpdateBookingCheckoutResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyClientId(args.clientId)

  return withLockedClientOwnedBookingTransaction({
    bookingId: args.bookingId,
    clientId: args.clientId,
    run: async ({ tx, now }) =>
      performLockedUpdateClientBookingCheckout({
        tx,
        now,
        bookingId: args.bookingId,
        clientId: args.clientId,
        tipAmount: args.tipAmount,
        selectedPaymentMethod: args.selectedPaymentMethod,
        checkoutStatus: args.checkoutStatus,
        markPaymentAuthorized: args.markPaymentAuthorized,
        markPaymentCollected: args.markPaymentCollected,
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
  })
}

export async function upsertClientBookingCheckoutProducts(
  args: UpsertClientBookingCheckoutProductsArgs,
): Promise<UpsertClientBookingCheckoutProductsResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyClientId(args.clientId)

  return withLockedClientOwnedBookingTransaction({
    bookingId: args.bookingId,
    clientId: args.clientId,
    run: async ({ tx }) =>
      performLockedUpsertClientBookingCheckoutProducts({
        tx,
        bookingId: args.bookingId,
        clientId: args.clientId,
        items: args.items,
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
  })
}

export async function assertClientBookingReviewEligibility(
  args: AssertClientBookingReviewEligibilityArgs,
): Promise<AssertClientBookingReviewEligibilityResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyClientId(args.clientId)

  return withLockedClientOwnedBookingTransaction({
    bookingId: args.bookingId,
    clientId: args.clientId,
    run: async ({ tx }) =>
      performLockedAssertClientBookingReviewEligibility({
        tx,
        bookingId: args.bookingId,
        clientId: args.clientId,
      }),
  })
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
        bookingEntryPoint: args.bookingEntryPoint,
        holdId: args.holdId,
        aftercareClientActionTokenId: args.aftercareClientActionTokenId ?? null,
        openingId: args.openingId,
        addOnIds: args.addOnIds,
        locationType: args.locationType,
        source: args.source,
        initialStatus: args.initialStatus,
        rebookOfBookingId: args.rebookOfBookingId,
        fallbackTimeZone: args.fallbackTimeZone ?? 'UTC',
        offering: args.offering,
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
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
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
        importMode: args.importMode ?? false,
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
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
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
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
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

    if (!args.aftercareClientActionTokenId.trim()) {
      throw bookingError('FORBIDDEN', {
        message: 'Aftercare client action token id is required for client rebook.',
        userMessage: 'That aftercare link is invalid or expired.',
      })
    }
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
      clientId: args.clientId,
      aftercareId: args.aftercareId,
      aftercareClientActionTokenId: args.aftercareClientActionTokenId,
      requestId: args.requestId ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
    })
  })
}

// ---------------------------------------------------------------------------
// Stripe checkout — single internal boundary
// ---------------------------------------------------------------------------

const STRIPE_DEFAULT_CURRENCY = 'USD'

function normalizeStripeCurrency(value: string | null | undefined): string {
  if (typeof value !== 'string') return STRIPE_DEFAULT_CURRENCY
  const trimmed = value.trim().toUpperCase()
  if (!trimmed) return STRIPE_DEFAULT_CURRENCY
  return trimmed.slice(0, 3)
}

function decimalToCents(value: Prisma.Decimal | null | undefined): number {
  if (!value) return 0
  const amount = value.toNumber()
  if (!Number.isFinite(amount)) return 0
  return Math.round(amount * 100)
}

function buildStripeLineItemDescription(args: {
  bookingId: string
  serviceName: string | null
}): string {
  const trimmed = args.serviceName?.trim() ?? ''
  return trimmed ? `TOVIS booking: ${trimmed}` : `TOVIS booking ${args.bookingId}`
}

function assertProSettingsAcceptStripeCard(
  settings: ClientStripeCheckoutBookingRecord['professional']['paymentSettings'],
): asserts settings is NonNullable<
  ClientStripeCheckoutBookingRecord['professional']['paymentSettings']
> & { stripeAccountId: string } {
  if (!settings) {
    throw bookingError('FORBIDDEN', {
      message: 'Provider has not configured payment settings.',
      userMessage: 'This provider is not ready to accept card payments.',
    })
  }

  if (!settings.stripeAccountId) {
    throw bookingError('FORBIDDEN', {
      message: 'Provider has not connected Stripe.',
      userMessage: 'This provider has not connected Stripe yet.',
    })
  }

  if (
    !settings.acceptStripeCard ||
    !settings.stripeChargesEnabled ||
    !settings.stripePayoutsEnabled
  ) {
    throw bookingError('FORBIDDEN', {
      message: 'Provider Stripe account is not ready to accept payments.',
      userMessage: 'This provider is not ready to accept card payments.',
    })
  }
}

async function performLockedPrepareClientStripeCheckoutSession(args: {
  tx: Prisma.TransactionClient
  now: Date
  bookingId: string
  clientId: string
  tipAmount?: Prisma.Decimal | string | number | null
  requestId?: string | null
  idempotencyKey?: string | null
}): Promise<PrepareClientStripeCheckoutSessionResult> {
  const booking: ClientStripeCheckoutBookingRecord | null =
    await args.tx.booking.findUnique({
      where: { id: args.bookingId },
      select: CLIENT_STRIPE_CHECKOUT_BOOKING_SELECT,
    })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.clientId !== args.clientId) {
    throw bookingError('FORBIDDEN')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED')
  }

  if (!booking.aftercareSummary?.id || !booking.aftercareSummary.sentToClientAt) {
    throw bookingError('FORBIDDEN', {
      message: 'Client checkout requires finalized aftercare.',
      userMessage: 'Checkout becomes available after aftercare is finalized.',
    })
  }

  if (
    booking.checkoutStatus === BookingCheckoutStatus.PAID ||
    booking.checkoutStatus === BookingCheckoutStatus.WAIVED ||
    booking.paymentCollectedAt
  ) {
    throw bookingError('FORBIDDEN', {
      message: 'Checkout is already closed.',
      userMessage: 'This checkout is already finished.',
    })
  }

  const paymentSettings = booking.professional.paymentSettings
  assertProSettingsAcceptStripeCard(paymentSettings)

  const nextTipAmount =
    args.tipAmount === undefined
      ? undefined
      : normalizePositiveMoneyDecimal(args.tipAmount) ?? zeroMoney()

  if (
    nextTipAmount &&
    nextTipAmount.greaterThan(zeroMoney()) &&
    paymentSettings.tipsEnabled === false
  ) {
    throw bookingError('FORBIDDEN', {
      message: 'Tips are not enabled for this provider.',
      userMessage: 'Tips are not enabled for this provider.',
    })
  }

  const rollup = await buildBookingCheckoutRollupUpdate({
    tx: args.tx,
    bookingId: booking.id,
    nextTipAmount,
  })

  const amountCents = decimalToCents(rollup.totalAmount)
  if (amountCents <= 0) {
    throw bookingError('FORBIDDEN', {
      message: 'Stripe checkout requires a positive total.',
      userMessage: 'Booking total must be greater than zero.',
    })
  }

  const oldState = buildCheckoutAuditSnapshot({
    checkoutStatus: booking.checkoutStatus,
    selectedPaymentMethod: booking.selectedPaymentMethod,
    serviceSubtotalSnapshot: booking.serviceSubtotalSnapshot,
    productSubtotalSnapshot: booking.productSubtotalSnapshot,
    subtotalSnapshot: booking.subtotalSnapshot,
    tipAmount: booking.tipAmount,
    taxAmount: booking.taxAmount,
    discountAmount: booking.discountAmount,
    totalAmount: booking.totalAmount,
    paymentAuthorizedAt: booking.paymentAuthorizedAt,
    paymentCollectedAt: booking.paymentCollectedAt,
  })

  const nextCheckoutStatus =
    booking.checkoutStatus === BookingCheckoutStatus.NOT_READY
      ? BookingCheckoutStatus.READY
      : booking.checkoutStatus

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      serviceSubtotalSnapshot: rollup.serviceSubtotalSnapshot,
      productSubtotalSnapshot: rollup.productSubtotalSnapshot,
      subtotalSnapshot: rollup.subtotalSnapshot,
      tipAmount: rollup.tipAmount,
      taxAmount: rollup.taxAmount,
      discountAmount: rollup.discountAmount,
      totalAmount: rollup.totalAmount,
      paymentProvider: PaymentProvider.STRIPE,
      selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
      checkoutStatus: nextCheckoutStatus,
      stripeConnectedAccountId: paymentSettings.stripeAccountId,
    },
    select: {
      id: true,
      professionalId: true,
      checkoutStatus: true,
      selectedPaymentMethod: true,
      paymentProvider: true,
      serviceSubtotalSnapshot: true,
      productSubtotalSnapshot: true,
      subtotalSnapshot: true,
      tipAmount: true,
      taxAmount: true,
      discountAmount: true,
      totalAmount: true,
      paymentAuthorizedAt: true,
      paymentCollectedAt: true,
    } satisfies Prisma.BookingSelect,
  })

  const newState = buildCheckoutAuditSnapshot({
    checkoutStatus: updated.checkoutStatus,
    selectedPaymentMethod: updated.selectedPaymentMethod,
    serviceSubtotalSnapshot: updated.serviceSubtotalSnapshot,
    productSubtotalSnapshot: updated.productSubtotalSnapshot,
    subtotalSnapshot: updated.subtotalSnapshot,
    tipAmount: updated.tipAmount,
    taxAmount: updated.taxAmount,
    discountAmount: updated.discountAmount,
    totalAmount: updated.totalAmount,
    paymentAuthorizedAt: updated.paymentAuthorizedAt,
    paymentCollectedAt: updated.paymentCollectedAt,
  })

  await createCheckoutAuditLogs({
    tx: args.tx,
    bookingId: booking.id,
    professionalId: booking.professionalId,
    route: 'lib/booking/writeBoundary.ts:prepareClientStripeCheckoutSession',
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    oldState,
    newState,
  })

  const mutated = !areAuditValuesEqual(oldState, newState)

  return {
    booking: {
      id: updated.id,
      professionalId: updated.professionalId,
      serviceSubtotalSnapshot: updated.serviceSubtotalSnapshot,
      productSubtotalSnapshot: updated.productSubtotalSnapshot,
      subtotalSnapshot: updated.subtotalSnapshot,
      tipAmount: updated.tipAmount,
      taxAmount: updated.taxAmount,
      discountAmount: updated.discountAmount,
      totalAmount: updated.totalAmount,
      checkoutStatus: updated.checkoutStatus,
      selectedPaymentMethod: updated.selectedPaymentMethod,
      paymentProvider: updated.paymentProvider,
    },
    stripe: {
      amountCents,
      currency: STRIPE_DEFAULT_CURRENCY,
      lineItemDescription: buildStripeLineItemDescription({
        bookingId: booking.id,
        serviceName: booking.service?.name ?? null,
      }),
      connectedAccountId: paymentSettings.stripeAccountId,
    },
    meta: buildMeta(mutated),
  }
}

async function performLockedRecordStripeCheckoutSessionAttached(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  clientId: string
  stripeCheckoutSessionId: string
  stripePaymentIntentId: string | null
  stripeConnectedAccountId: string
  stripeAmountSubtotal: number | null
  stripeAmountTotal: number | null
  stripeCurrency: string
  requestId?: string | null
  idempotencyKey?: string | null
}): Promise<RecordStripeCheckoutSessionAttachedResult> {
  const booking: ClientStripeCheckoutBookingRecord | null =
    await args.tx.booking.findUnique({
      where: { id: args.bookingId },
      select: CLIENT_STRIPE_CHECKOUT_BOOKING_SELECT,
    })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.clientId !== args.clientId) {
    throw bookingError('FORBIDDEN')
  }

  if (booking.checkoutStatus === BookingCheckoutStatus.PAID) {
    return {
      booking: {
        id: booking.id,
        checkoutStatus: booking.checkoutStatus,
        selectedPaymentMethod: booking.selectedPaymentMethod,
        paymentProvider: booking.paymentProvider,
        stripeCheckoutSessionId: booking.stripeCheckoutSessionId,
        stripePaymentIntentId: booking.stripePaymentIntentId,
        stripeCheckoutSessionStatus: booking.stripeCheckoutSessionStatus,
        stripePaymentStatus: booking.stripePaymentStatus,
        stripeAmountSubtotal: booking.stripeAmountSubtotal,
        stripeAmountTotal: booking.stripeAmountTotal,
        stripeCurrency: booking.stripeCurrency,
      },
      meta: buildMeta(false),
    }
  }

  const alreadyAttached =
    booking.stripeCheckoutSessionId === args.stripeCheckoutSessionId &&
    booking.stripePaymentIntentId === args.stripePaymentIntentId &&
    booking.stripeConnectedAccountId === args.stripeConnectedAccountId &&
    booking.stripeCheckoutSessionStatus === StripeCheckoutSessionStatus.OPEN &&
    booking.stripePaymentStatus === StripePaymentStatus.NOT_STARTED &&
    booking.stripeAmountSubtotal === args.stripeAmountSubtotal &&
    booking.stripeAmountTotal === args.stripeAmountTotal &&
    booking.stripeCurrency === args.stripeCurrency

  if (alreadyAttached) {
    return {
      booking: {
        id: booking.id,
        checkoutStatus: booking.checkoutStatus,
        selectedPaymentMethod: booking.selectedPaymentMethod,
        paymentProvider: booking.paymentProvider,
        stripeCheckoutSessionId: booking.stripeCheckoutSessionId,
        stripePaymentIntentId: booking.stripePaymentIntentId,
        stripeCheckoutSessionStatus: booking.stripeCheckoutSessionStatus,
        stripePaymentStatus: booking.stripePaymentStatus,
        stripeAmountSubtotal: booking.stripeAmountSubtotal,
        stripeAmountTotal: booking.stripeAmountTotal,
        stripeCurrency: booking.stripeCurrency,
      },
      meta: buildMeta(false),
    }
  }

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      paymentProvider: PaymentProvider.STRIPE,
      selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripeConnectedAccountId: args.stripeConnectedAccountId,
      stripeCheckoutSessionStatus: StripeCheckoutSessionStatus.OPEN,
      stripePaymentStatus: StripePaymentStatus.NOT_STARTED,
      stripeAmountSubtotal: args.stripeAmountSubtotal,
      stripeAmountTotal: args.stripeAmountTotal,
      stripeCurrency: args.stripeCurrency,
      stripeApplicationFeeAmount: null,
      stripeLastEventId: null,
    },
    select: {
      id: true,
      checkoutStatus: true,
      selectedPaymentMethod: true,
      paymentProvider: true,
      stripeCheckoutSessionId: true,
      stripePaymentIntentId: true,
      stripeCheckoutSessionStatus: true,
      stripePaymentStatus: true,
      stripeAmountSubtotal: true,
      stripeAmountTotal: true,
      stripeCurrency: true,
    } satisfies Prisma.BookingSelect,
  })

  await createBookingCloseoutAuditLog({
    tx: args.tx,
    bookingId: booking.id,
    professionalId: booking.professionalId,
    action: BookingCloseoutAuditAction.CHECKOUT_UPDATED,
    route: 'lib/booking/writeBoundary.ts:recordStripeCheckoutSessionAttached',
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    oldValue: {
      stripeCheckoutSessionId: booking.stripeCheckoutSessionId,
      stripePaymentIntentId: booking.stripePaymentIntentId,
      stripeCheckoutSessionStatus: booking.stripeCheckoutSessionStatus,
      stripePaymentStatus: booking.stripePaymentStatus,
    },
    newValue: {
      stripeCheckoutSessionId: updated.stripeCheckoutSessionId,
      stripePaymentIntentId: updated.stripePaymentIntentId,
      stripeCheckoutSessionStatus: updated.stripeCheckoutSessionStatus,
      stripePaymentStatus: updated.stripePaymentStatus,
    },
  })

  return {
    booking: {
      id: updated.id,
      checkoutStatus: updated.checkoutStatus,
      selectedPaymentMethod: updated.selectedPaymentMethod,
      paymentProvider: updated.paymentProvider,
      stripeCheckoutSessionId: updated.stripeCheckoutSessionId,
      stripePaymentIntentId: updated.stripePaymentIntentId,
      stripeCheckoutSessionStatus: updated.stripeCheckoutSessionStatus,
      stripePaymentStatus: updated.stripePaymentStatus,
      stripeAmountSubtotal: updated.stripeAmountSubtotal,
      stripeAmountTotal: updated.stripeAmountTotal,
      stripeCurrency: updated.stripeCurrency,
    },
    meta: buildMeta(true),
  }
}

export async function prepareClientStripeCheckoutSession(
  args: PrepareClientStripeCheckoutSessionArgs,
): Promise<PrepareClientStripeCheckoutSessionResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyClientId(args.clientId)

  return withLockedClientOwnedBookingTransaction({
    bookingId: args.bookingId,
    clientId: args.clientId,
    run: async ({ tx, now }) =>
      performLockedPrepareClientStripeCheckoutSession({
        tx,
        now,
        bookingId: args.bookingId,
        clientId: args.clientId,
        tipAmount: args.tipAmount,
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
  })
}

export async function recordStripeCheckoutSessionAttached(
  args: RecordStripeCheckoutSessionAttachedArgs,
): Promise<RecordStripeCheckoutSessionAttachedResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyClientId(args.clientId)

  if (!args.stripeCheckoutSessionId.trim()) {
    throw bookingError('FORBIDDEN', {
      message: 'Stripe checkout session id is required.',
    })
  }

  if (!args.stripeConnectedAccountId.trim()) {
    throw bookingError('FORBIDDEN', {
      message: 'Stripe connected account id is required.',
    })
  }

  return withLockedClientOwnedBookingTransaction({
    bookingId: args.bookingId,
    clientId: args.clientId,
    run: async ({ tx }) =>
      performLockedRecordStripeCheckoutSessionAttached({
        tx,
        bookingId: args.bookingId,
        clientId: args.clientId,
        stripeCheckoutSessionId: args.stripeCheckoutSessionId,
        stripePaymentIntentId: args.stripePaymentIntentId,
        stripeConnectedAccountId: args.stripeConnectedAccountId,
        stripeAmountSubtotal: args.stripeAmountSubtotal,
        stripeAmountTotal: args.stripeAmountTotal,
        stripeCurrency: normalizeStripeCurrency(args.stripeCurrency),
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
  })
}

// ---------------------------------------------------------------------------
// Stripe webhook entry points — single internal boundary
// ---------------------------------------------------------------------------

type StripeWebhookDb = Prisma.TransactionClient | typeof prisma

async function findBookingForStripeWebhook(args: {
  db?: StripeWebhookDb
  bookingIdHint?: string | null
  stripePaymentIntentId?: string | null
  stripeCheckoutSessionId?: string | null
}): Promise<{ id: string; professionalId: string } | null> {
  const db = args.db ?? prisma

  const trimmedHint =
    typeof args.bookingIdHint === 'string' ? args.bookingIdHint.trim() : ''

  if (trimmedHint) {
    const byHint = await db.booking.findUnique({
      where: { id: trimmedHint },
      select: { id: true, professionalId: true },
    })
    if (byHint) return byHint
  }

  const trimmedPaymentIntentId =
    typeof args.stripePaymentIntentId === 'string'
      ? args.stripePaymentIntentId.trim()
      : ''

  if (trimmedPaymentIntentId) {
    const byPaymentIntent = await db.booking.findFirst({
      where: { stripePaymentIntentId: trimmedPaymentIntentId },
      select: { id: true, professionalId: true },
    })
    if (byPaymentIntent) return byPaymentIntent
  }

  const trimmedSessionId =
    typeof args.stripeCheckoutSessionId === 'string'
      ? args.stripeCheckoutSessionId.trim()
      : ''

  if (trimmedSessionId) {
    const bySession = await db.booking.findFirst({
      where: { stripeCheckoutSessionId: trimmedSessionId },
      select: { id: true, professionalId: true },
    })
    if (bySession) return bySession
  }

  return null
}

async function performLockedApplyStripePaymentSucceeded(args: {
  tx: Prisma.TransactionClient
  now: Date
  bookingId: string
  stripePaymentIntentId: string
  stripeEventId: string
  amountReceivedCents: number | null
  currency: string | null
}): Promise<ApplyStripePaymentResult> {
  const booking: StripeWebhookBookingRecord | null =
    await args.tx.booking.findUnique({
      where: { id: args.bookingId },
      select: STRIPE_WEBHOOK_BOOKING_SELECT,
    })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  const alreadyApplied =
    booking.stripeLastEventId === args.stripeEventId &&
    booking.stripePaymentStatus === StripePaymentStatus.SUCCEEDED &&
    booking.checkoutStatus === BookingCheckoutStatus.PAID &&
    booking.paymentCollectedAt !== null

  if (alreadyApplied) {
    return {
      bookingId: booking.id,
      bookingCompleted: booking.status === BookingStatus.COMPLETED,
      meta: buildMeta(false),
    }
  }

  const oldState = buildCheckoutAuditSnapshot({
    checkoutStatus: booking.checkoutStatus,
    selectedPaymentMethod: booking.selectedPaymentMethod,
    serviceSubtotalSnapshot: booking.serviceSubtotalSnapshot,
    productSubtotalSnapshot: booking.productSubtotalSnapshot,
    subtotalSnapshot: booking.subtotalSnapshot,
    tipAmount: booking.tipAmount,
    taxAmount: booking.taxAmount,
    discountAmount: booking.discountAmount,
    totalAmount: booking.totalAmount,
    paymentAuthorizedAt: booking.paymentAuthorizedAt,
    paymentCollectedAt: booking.paymentCollectedAt,
  })

  const nextAuthorizedAt = booking.paymentAuthorizedAt ?? args.now
  const nextCollectedAt = booking.paymentCollectedAt ?? args.now
  const nextCurrency = normalizeStripeCurrency(
    args.currency ?? booking.stripeCurrency,
  )

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      paymentProvider: PaymentProvider.STRIPE,
      selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
      checkoutStatus: BookingCheckoutStatus.PAID,
      paymentAuthorizedAt: nextAuthorizedAt,
      paymentCollectedAt: nextCollectedAt,
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
      stripeAmountTotal:
        args.amountReceivedCents ?? booking.stripeAmountTotal ?? undefined,
      stripeCurrency: nextCurrency,
      stripePaidAt: booking.stripePaidAt ?? args.now,
      stripeLastEventId: args.stripeEventId,
    },
    select: {
      id: true,
      status: true,
      sessionStep: true,
      finishedAt: true,
      checkoutStatus: true,
      selectedPaymentMethod: true,
      serviceSubtotalSnapshot: true,
      productSubtotalSnapshot: true,
      subtotalSnapshot: true,
      tipAmount: true,
      taxAmount: true,
      discountAmount: true,
      totalAmount: true,
      paymentAuthorizedAt: true,
      paymentCollectedAt: true,
    } satisfies Prisma.BookingSelect,
  })

  let bookingCompleted = booking.status === BookingStatus.COMPLETED

  const completedNow = await maybeCompleteBookingCloseout({
    tx: args.tx,
    now: args.now,
    booking,
    checkoutStatus: updated.checkoutStatus,
    paymentCollectedAt: updated.paymentCollectedAt,
    actor: 'SYSTEM',
    route: 'lib/booking/writeBoundary.ts:applyStripePaymentSucceeded',
  })

  if (completedNow) {
    bookingCompleted = true
  }

  const newState = buildCheckoutAuditSnapshot({
    checkoutStatus: updated.checkoutStatus,
    selectedPaymentMethod: updated.selectedPaymentMethod,
    serviceSubtotalSnapshot: updated.serviceSubtotalSnapshot,
    productSubtotalSnapshot: updated.productSubtotalSnapshot,
    subtotalSnapshot: updated.subtotalSnapshot,
    tipAmount: updated.tipAmount,
    taxAmount: updated.taxAmount,
    discountAmount: updated.discountAmount,
    totalAmount: updated.totalAmount,
    paymentAuthorizedAt: updated.paymentAuthorizedAt,
    paymentCollectedAt: updated.paymentCollectedAt,
  })

  await createCheckoutAuditLogs({
    tx: args.tx,
    bookingId: booking.id,
    professionalId: booking.professionalId,
    route: 'lib/booking/writeBoundary.ts:applyStripePaymentSucceeded',
    requestId: args.stripeEventId,
    idempotencyKey: args.stripeEventId,
    oldState,
    newState,
  })

  return {
    bookingId: booking.id,
    bookingCompleted,
    meta: buildMeta(true),
  }
}

async function performLockedApplyStripePaymentFailed(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  stripePaymentIntentId: string
  stripeEventId: string
}): Promise<ApplyStripePaymentResult> {
  const booking: StripeWebhookBookingRecord | null =
    await args.tx.booking.findUnique({
      where: { id: args.bookingId },
      select: STRIPE_WEBHOOK_BOOKING_SELECT,
    })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  const alreadyApplied =
    booking.stripeLastEventId === args.stripeEventId &&
    booking.stripePaymentStatus === StripePaymentStatus.FAILED

  if (alreadyApplied) {
    return {
      bookingId: booking.id,
      bookingCompleted: booking.status === BookingStatus.COMPLETED,
      meta: buildMeta(false),
    }
  }

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      paymentProvider: PaymentProvider.STRIPE,
      selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripePaymentStatus: StripePaymentStatus.FAILED,
      stripeLastEventId: args.stripeEventId,
    },
    select: {
      id: true,
      status: true,
    } satisfies Prisma.BookingSelect,
  })

  return {
    bookingId: updated.id,
    bookingCompleted: updated.status === BookingStatus.COMPLETED,
    meta: buildMeta(true),
  }
}

async function performLockedApplyStripeCheckoutSessionStatus(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  stripeCheckoutSessionId: string
  stripePaymentIntentId: string | null
  stripeAmountSubtotal: number | null
  stripeAmountTotal: number | null
  stripeCurrency: string | null
  status: StripeCheckoutSessionStatus
}): Promise<ApplyStripePaymentResult> {
  const booking: StripeWebhookBookingRecord | null =
    await args.tx.booking.findUnique({
      where: { id: args.bookingId },
      select: STRIPE_WEBHOOK_BOOKING_SELECT,
    })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  const targetCurrency = normalizeStripeCurrency(
    args.stripeCurrency ?? booking.stripeCurrency,
  )

  const alreadyApplied =
    booking.stripeCheckoutSessionId === args.stripeCheckoutSessionId &&
    booking.stripeCheckoutSessionStatus === args.status &&
    (args.stripePaymentIntentId === null ||
      booking.stripePaymentIntentId === args.stripePaymentIntentId)

  if (alreadyApplied) {
    return {
      bookingId: booking.id,
      bookingCompleted: booking.status === BookingStatus.COMPLETED,
      meta: buildMeta(false),
    }
  }

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      paymentProvider: PaymentProvider.STRIPE,
      selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripeCheckoutSessionStatus: args.status,
      ...(args.stripePaymentIntentId
        ? { stripePaymentIntentId: args.stripePaymentIntentId }
        : {}),
      ...(args.stripeAmountSubtotal != null
        ? { stripeAmountSubtotal: args.stripeAmountSubtotal }
        : {}),
      ...(args.stripeAmountTotal != null
        ? { stripeAmountTotal: args.stripeAmountTotal }
        : {}),
      stripeCurrency: targetCurrency,
    },
    select: {
      id: true,
      status: true,
    } satisfies Prisma.BookingSelect,
  })

  return {
    bookingId: updated.id,
    bookingCompleted: updated.status === BookingStatus.COMPLETED,
    meta: buildMeta(true),
  }
}

export async function applyStripePaymentSucceededInTransaction(
  tx: Prisma.TransactionClient,
  args: ApplyStripePaymentSucceededArgs,
): Promise<ApplyStripePaymentResult | null> {
  const stripePaymentIntentId = args.stripePaymentIntentId.trim()
  const stripeEventId = args.stripeEventId.trim()

  if (!stripePaymentIntentId || !stripeEventId) {
    throw bookingError('FORBIDDEN', {
      message: 'Stripe payment intent id and event id are required.',
    })
  }

  const booking = await findBookingForStripeWebhook({
    db: tx,
    bookingIdHint: args.bookingIdHint ?? null,
    stripePaymentIntentId,
  })

  if (!booking) return null

  await lockProfessionalSchedule(tx, booking.professionalId)

  const lockedBooking = await findBookingForStripeWebhook({
    db: tx,
    bookingIdHint: args.bookingIdHint ?? null,
    stripePaymentIntentId,
  })

  if (!lockedBooking) return null

  return performLockedApplyStripePaymentSucceeded({
    tx,
    now: args.occurredAt ?? new Date(),
    bookingId: lockedBooking.id,
    stripePaymentIntentId,
    stripeEventId,
    amountReceivedCents: args.amountReceivedCents,
    currency: args.currency,
  })
}

export async function applyStripePaymentFailedInTransaction(
  tx: Prisma.TransactionClient,
  args: ApplyStripePaymentFailedArgs,
): Promise<ApplyStripePaymentResult | null> {
  const stripePaymentIntentId = args.stripePaymentIntentId.trim()
  const stripeEventId = args.stripeEventId.trim()

  if (!stripePaymentIntentId || !stripeEventId) {
    throw bookingError('FORBIDDEN', {
      message: 'Stripe payment intent id and event id are required.',
    })
  }

  const booking = await findBookingForStripeWebhook({
    db: tx,
    bookingIdHint: args.bookingIdHint ?? null,
    stripePaymentIntentId,
  })

  if (!booking) return null

  await lockProfessionalSchedule(tx, booking.professionalId)

  const lockedBooking = await findBookingForStripeWebhook({
    db: tx,
    bookingIdHint: args.bookingIdHint ?? null,
    stripePaymentIntentId,
  })

  if (!lockedBooking) return null

  return performLockedApplyStripePaymentFailed({
    tx,
    bookingId: lockedBooking.id,
    stripePaymentIntentId,
    stripeEventId,
  })
}

export async function applyStripeCheckoutSessionStatusInTransaction(
  tx: Prisma.TransactionClient,
  args: ApplyStripeCheckoutSessionStatusArgs,
): Promise<ApplyStripePaymentResult | null> {
  const stripeCheckoutSessionId = args.stripeCheckoutSessionId.trim()

  if (!stripeCheckoutSessionId) {
    throw bookingError('FORBIDDEN', {
      message: 'Stripe checkout session id is required.',
    })
  }

  const booking = await findBookingForStripeWebhook({
    db: tx,
    bookingIdHint: args.bookingIdHint ?? null,
    stripeCheckoutSessionId,
    stripePaymentIntentId: args.stripePaymentIntentId,
  })

  if (!booking) return null

  await lockProfessionalSchedule(tx, booking.professionalId)

  const lockedBooking = await findBookingForStripeWebhook({
    db: tx,
    bookingIdHint: args.bookingIdHint ?? null,
    stripeCheckoutSessionId,
    stripePaymentIntentId: args.stripePaymentIntentId,
  })

  if (!lockedBooking) return null

  return performLockedApplyStripeCheckoutSessionStatus({
    tx,
    bookingId: lockedBooking.id,
    stripeCheckoutSessionId,
    stripePaymentIntentId: args.stripePaymentIntentId,
    stripeAmountSubtotal: args.stripeAmountSubtotal,
    stripeAmountTotal: args.stripeAmountTotal,
    stripeCurrency: args.stripeCurrency,
    status: args.status,
  })
}


export async function applyStripePaymentSucceeded(
  args: ApplyStripePaymentSucceededArgs,
): Promise<ApplyStripePaymentResult | null> {
  const stripePaymentIntentId = args.stripePaymentIntentId.trim()
  const stripeEventId = args.stripeEventId.trim()

  if (!stripePaymentIntentId || !stripeEventId) {
    throw bookingError('FORBIDDEN', {
      message: 'Stripe payment intent id and event id are required.',
    })
  }

  const booking = await findBookingForStripeWebhook({
    bookingIdHint: args.bookingIdHint ?? null,
    stripePaymentIntentId,
  })

  if (!booking) return null

  return withLockedProfessionalTransaction(
    booking.professionalId,
    async ({ tx, now }) =>
      performLockedApplyStripePaymentSucceeded({
        tx,
        now: args.occurredAt ?? now,
        bookingId: booking.id,
        stripePaymentIntentId,
        stripeEventId,
        amountReceivedCents: args.amountReceivedCents,
        currency: args.currency,
      }),
  )
}

export async function applyStripePaymentFailed(
  args: ApplyStripePaymentFailedArgs,
): Promise<ApplyStripePaymentResult | null> {
  const stripePaymentIntentId = args.stripePaymentIntentId.trim()
  const stripeEventId = args.stripeEventId.trim()

  if (!stripePaymentIntentId || !stripeEventId) {
    throw bookingError('FORBIDDEN', {
      message: 'Stripe payment intent id and event id are required.',
    })
  }

  const booking = await findBookingForStripeWebhook({
    bookingIdHint: args.bookingIdHint ?? null,
    stripePaymentIntentId,
  })

  if (!booking) return null

  return withLockedProfessionalTransaction(
    booking.professionalId,
    async ({ tx }) =>
      performLockedApplyStripePaymentFailed({
        tx,
        bookingId: booking.id,
        stripePaymentIntentId,
        stripeEventId,
      }),
  )
}

export async function applyStripeCheckoutSessionStatus(
  args: ApplyStripeCheckoutSessionStatusArgs,
): Promise<ApplyStripePaymentResult | null> {
  const stripeCheckoutSessionId = args.stripeCheckoutSessionId.trim()

  if (!stripeCheckoutSessionId) {
    throw bookingError('FORBIDDEN', {
      message: 'Stripe checkout session id is required.',
    })
  }

  const booking = await findBookingForStripeWebhook({
    bookingIdHint: args.bookingIdHint ?? null,
    stripeCheckoutSessionId,
    stripePaymentIntentId: args.stripePaymentIntentId,
  })

  if (!booking) return null

  return withLockedProfessionalTransaction(
    booking.professionalId,
    async ({ tx }) =>
      performLockedApplyStripeCheckoutSessionStatus({
        tx,
        bookingId: booking.id,
        stripeCheckoutSessionId,
        stripePaymentIntentId: args.stripePaymentIntentId,
        stripeAmountSubtotal: args.stripeAmountSubtotal,
        stripeAmountTotal: args.stripeAmountTotal,
        stripeCurrency: args.stripeCurrency,
        status: args.status,
      }),
  )
}

// ─── Hold cleanup sweep ──────────────────────────────────────────────────────

/**
 * Deletes all expired BookingHold rows in a single sweep and bumps the
 * scheduleConfigVersion for every affected professional so cached availability
 * surfaces (`/api/availability/*`, openings, search) re-render the freed slots.
 *
 * Used by the `/api/internal/jobs/hold-cleanup` cron. Routing the deleteMany
 * through the write-boundary keeps the BookingHold mutation tripwire green
 * (see `tools/check-booking-write-boundary.mjs`) and ensures the cache bump
 * happens transactionally with the delete from the caller's perspective.
 *
 * The bump is best-effort: if Redis is unreachable, the underlying
 * `bumpScheduleConfigVersion` swallows the error and logs. The next sweep
 * (5 minutes later) catches up.
 */
export async function cleanupAllExpiredHolds(args: {
  now: Date
}): Promise<{
  deletedCount: number
  affectedProfessionalIds: string[]
}> {
  const distinctRows = await prisma.bookingHold.findMany({
    where: { expiresAt: { lte: args.now } },
    select: { professionalId: true },
    distinct: ['professionalId'],
  })

  const affectedProfessionalIds = distinctRows
    .map((row) => row.professionalId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  const deletedResult = await prisma.bookingHold.deleteMany({
    where: { expiresAt: { lte: args.now } },
  })

  if (deletedResult.count > 0 && affectedProfessionalIds.length > 0) {
    await Promise.all(
      affectedProfessionalIds.map((professionalId) =>
        bumpScheduleConfigVersion(professionalId),
      ),
    )
  }

  return {
    deletedCount: deletedResult.count,
    affectedProfessionalIds,
  }
}
