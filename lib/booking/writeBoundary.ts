// lib/booking/writeBoundary.ts
import {
  AftercareRebookMode,
  BookingCheckoutStatus,
  BookingCloseoutAuditAction,
  BookingDepositStatus,
  BookingDiscoveryProvenance,
  BookingOverrideAction,
  BookingOverrideRule,
  BookingSeriesExceptionReason,
  BookingSeriesStatus,
  BookingServiceItemType,
  BookingSource,
  BookingStatus,
  ClientActionTokenKind,
  ClientAddressKind,
  ClientRelationshipLabel,
  ConsultationApprovalProofMethod,
  ConsultationApprovalStatus,
  ConsultationDecision,
  ContactMethod,
  LastMinuteOfferType,
  LastMinuteRecipientStatus,
  MediaPhase,
  MediaType,
  MediaVisibility,
  NoShowFeeReason,
  NoShowFeeStatus,
  NotificationChannel,
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
  WaitlistOfferStatus,
  WaitlistStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  acceptedPaymentMethodsSelect,
  buildAcceptedPaymentMethods,
} from '@/lib/payments/acceptedMethods'
import { DEFAULT_CHARGE_CURRENCY } from '@/lib/payments/resolveChargeCurrency'
import { computeLastMinuteDiscount } from '@/lib/lastMinutePricing'
import { formatMoneyFromUnknown } from '@/lib/money'
import { parseMoney } from '@/lib/moneyDecimal'
import {
  pickPublicTierPlan,
  pickRecipientTierPlan,
} from '@/lib/lastMinute/pickTierPlan'
import {
  resolveBookingTenantAttribution,
  resolveProTenantId,
} from '@/lib/tenant/bookingAttribution'
import { tenantContextFor } from '@/lib/tenant'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { haversineMiles } from '@/lib/geo/distance'
import { upper } from '@/lib/booking/guards'
import {
  deriveClientRelationshipLabel,
  isReturningClient,
} from '@/lib/booking/relationshipLabel'
import {
  DEPOSIT_CREDIT_SELECT,
  deriveDepositCredit,
  deriveNetDepositHeldCents,
} from '@/lib/booking/depositCredit'
import type { FinalizeDiscoveryDirective } from '@/lib/booking/resolveDiscoveryFinalize'
import { clientCheckoutProductsEditBlockReason } from '@/lib/booking/checkoutProductsEditable'
import { lockProfessionalSchedule } from '@/lib/booking/scheduleLock'
import {
  pickOfferingModeRamp,
  resolveChargedUnitPrice,
} from '@/lib/booking/rampedUnitPrice'
import { snapStartToWorkingWindowStep } from '@/lib/booking/slotReadiness'
import {
  getReadableWorkingHoursMessage,
  makeWorkingHoursGuardMessage,
  parseWorkingHoursGuardMessage,
} from '@/lib/booking/workingHoursGuard'
import {
  computeDiscoveryDepositPlan,
  STRIPE_MIN_CHARGE_CENTS,
  type DepositSettings,
} from '@/lib/booking/discoveryDepositPlan'
import {
  computeDiscoveryDepositDueAt,
  computeProCreatedDepositDueAt,
  depositProCreatedReminderLeadHours,
} from '@/lib/booking/depositDeadline'
import { computeUpfrontDepositCents } from '@/lib/booking/prepay'
import { loadProClientPolicy } from '@/lib/proClientPolicy/load'
import {
  cancelDepositPaymentNudgeDispatch,
  createDepositPaymentDelivery,
} from '@/lib/clientActions/createDepositPaymentDelivery'
import {
  withLockedClientOwnedBookingTransaction,
  withLockedProfessionalScheduleByLookup,
  withLockedProfessionalTransaction,
} from '@/lib/booking/scheduleTransaction'
import {
  bookingError,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import {
  BOOKING_OVERLAP_CONSTRAINT_NAME,
  HOLD_MINUTES,
  HOLD_OVERLAP_CONSTRAINT_NAME,
  isInsideClientCancellationWindow,
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
  WAITLIST_OFFER_TTL_MINUTES,
} from '@/lib/booking/constants'
import { isExclusionConstraintError } from '@/lib/prismaErrors'
import {
  addMinutes,
  durationOrFallback,
  normalizeToMinute,
} from '@/lib/booking/conflicts'
import {
  logBookingConflict,
  type BookingConflictAction,
} from '@/lib/booking/conflictLogging'
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
  formatDatedAppointmentWhen,
  isValidIanaTimeZone,
  pickTimeZoneOrNull,
  sanitizeTimeZone,
} from '@/lib/time'
import { classifySeriesOccurrenceCancel } from '@/lib/booking/series/cancelScope'
import { recurringAppointmentsEnabled } from '@/lib/booking/series/flag'
import { hasEstablishedProClientRelationship } from '@/lib/clients/proClientRelationship'
import type {
  ProBookingSeriesCancelScope,
  ProBookingSeriesUntouchedReason,
} from '@/lib/dto/proBookingSeries'
import {
  computeSeriesOccurrenceInstants,
  countOccurrencesToMaterialize,
  MAX_SERIES_INTERVAL_WEEKS,
  MAX_SERIES_OCCURRENCE_COUNT,
  MIN_SERIES_INTERVAL_WEEKS,
  SERIES_MATERIALIZE_HORIZON,
} from '@/lib/booking/series/schedule'
import { loadSeriesPinnedPrices } from '@/lib/booking/series/pinnedPrice'
import { clampInt } from '@/lib/pick'
import { safeError, safeLogMeta } from '@/lib/security/logging'
import { buildMediaAssetCreateData } from '@/lib/media/recordMediaAsset'
import { createAftercareAccessDelivery } from '@/lib/clientActions/createAftercareAccessDelivery'
import type { ClientActionResendMode } from '@/lib/clientActions/types'
import type { CancellationPolicySnapshot } from '@/lib/noShowProtection/policyDisclosure'
import {
  normalizeAddress,
  resolveHeldSalonAddressText,
  validateHoldForClientMutation,
} from '@/lib/booking/policies/holdRules'
import { computeRebookCloneDurationMinutes } from '@/lib/booking/rebookWidth'
import {
  RESCHEDULE_TARGET_SELECT,
  resolveRescheduleCommitDurationMinutes,
} from '@/lib/booking/rescheduleWidth'
import { evaluateHoldCreationDecision } from '@/lib/booking/policies/holdPolicy'
import { evaluateRescheduleDecision } from '@/lib/booking/policies/reschedulePolicy'
import { evaluateFinalizeDecision } from '@/lib/booking/policies/finalizePolicy'
import {
  evaluateProSchedulingDecision,
  type ProSchedulingAppliedOverride,
} from '@/lib/booking/policies/proSchedulingPolicy'
import { bumpScheduleVersion } from '@/lib/booking/cacheVersion'
import {
  deleteActiveHoldsForClient,
  deleteExpiredHoldsForProfessional,
} from '@/lib/booking/holdCleanup'
import {
  type RequestedServiceItemInput,
  buildNormalizedBookingItemsFromRequestedOfferings,
  clonedItemDurationMinutes,
  computeBookingItemLikeTotals,
  normalizePositiveDurationMinutes,
  snapToStepMinutes,
} from '@/lib/booking/serviceItems'
import {
  consultationExtensionWindow,
  resolveConsultationMaterialization,
} from '@/lib/consultation/proposalSchedule'
import {
  resolveBookingAddOns,
  type ResolvedBookingAddOn,
} from '@/lib/booking/addOnResolution'
import { resolveDurationWithAddOns } from '@/lib/availability/data/addOnContext'
import { getProCreatedBookingStatus } from '@/lib/booking/statusRules'
import { moneyToFixed2String } from '@/lib/money'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { formatClientName } from '@/lib/profiles/publicProfileFormatting'
import {
  buildBookingConfirmedClientCopy,
  formatBookingDateLabel,
  formatBookingTimeLabel,
  formatBookingWhenClause,
} from '@/lib/booking/notificationCopy'
import {
  resolveApptTimeZoneFromValues,
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
import {
  cancelScheduledClientNotificationsForBooking,
  upsertClientNotification,
} from '@/lib/notifications/clientNotifications'
import { maybeCreateAiConsultInvitation } from '@/lib/notifications/aiConsultInvitation'
import { resolveConsultCommitScope } from '@/lib/consult/commitScope'
import {
  persistConsultBookingProposal,
  resolveConsultProposalForCommit,
  type ResolvedConsultProposal,
} from '@/lib/consult/proposalCommit'
import type { ConsultBookingProposalEnhancementSelection } from '@/lib/consult/bookingProposal'
import {
  computeDepositReminderRunAt,
  scheduleDepositReminderOnBooking,
} from '@/lib/notifications/depositReminders'
import {
  cancelBookingAppointmentReminders,
  syncBookingAppointmentReminders,
} from '@/lib/notifications/appointmentReminders'
import { createProNotification } from '@/lib/notifications/proNotifications'
import { clientNameForProNotification } from '@/lib/notifications/recipientNames'
import { inferPreferredContactMethod } from '@/lib/notifications/contactMethod'
import {
  isWaitlistOfferLapsed,
  lapsedWaitlistOfferWhere,
} from '@/lib/waitlist/offerLiveness'
import { WAITLIST_FULFILLABLE_MODES } from '@/lib/waitlist/hostability'
import { buildWaitlistOfferAreaLabel } from '@/lib/waitlist/offerArea'
import { buildWaitlistOfferNotificationBody } from '@/lib/waitlist/offerNotificationCopy'
import { loadWaitlistOfferDestination } from '@/lib/waitlist/offerDestination'
import {
  MOBILE_CAPABLE_LOCATION_TYPES,
  SALON_CAPABLE_LOCATION_TYPES,
} from '@/lib/offerings/locationCapability'
import { scheduleReviewRequestOnCompletion } from '@/lib/notifications/reviewRequests'
import {
  applyClientCreditForBooking,
  mintCreatorCreditOnCompletion,
  releaseClientCreditForBooking,
  reserveClientCreditForBooking,
} from '@/lib/credit/clientCredit'
import {
  buildAuxRefundDiscriminator,
  emitPaymentActionRequiredNotifications,
  emitPaymentCollectedNotifications,
  emitPaymentRefundedNotifications,
} from '@/lib/notifications/paymentNotifications'
import {
  consumeConsultationActionToken,
  generateClientActionToken,
  hashClientActionToken,
  resolveConsultationActionTokenTarget,
  revokeConsultationActionTokensForBooking,
} from '@/lib/consultation/clientActionTokens'
import { buildClientActionLinkForType } from '@/lib/clientActions/linkBuilders'
import {
  APPOINTMENT_CONFIRMATION_ANSWERABLE_STATUSES,
  markAppointmentConfirmationTokenUsed,
  resolveAppointmentConfirmationTokenForMutation,
} from '@/lib/booking/appointmentConfirmationTokens'
import {
  CLIENT_CONFIRMATION_SELECT,
  deriveClientConfirmationState,
  type ClientConfirmationState,
} from '@/lib/booking/clientConfirmation'
import {
  buildConsultationApprovalProofSnapshot,
  createConsultationApprovalProof,
} from '@/lib/consultation/consultationConfirmationProof'
import {
  isTerminalBookingStatus,
  LifecycleViolationError,
  recordStatusTransition,
  recordStepTransition,
  type LifecycleActor,
} from '@/lib/booking/lifecycleContract'
import {
  checkProReadinessForEntryPointWithDb,
  type ProBookingEntryPoint,
} from '@/lib/pro/readiness/proReadiness'
import {
  decideBookingOverlapPermission,
  liveHoldConflicts,
  type BookingOverlapActor,
  type BookingOverlapAllowedMode,
  type BookingOverlapBlockedCode,
  type BookingOverlapSource,
  type BookingWindow,
  type ProLiveHoldOverlapStance,
  type SchedulingConflict,
} from '@/lib/booking/overlapPolicy'
import type {
  HeldSlotDecision,
  HeldSlotRelationship,
} from '@/lib/booking/holdOverlapPrompt'
import { countEstablishedBookings } from '@/lib/booking/establishedBookingCount'
import { offeringDisplayName } from '@/lib/pro/offeringDisplayName'
import {
  findBookingAndHoldConflicts,
  hasCalendarBlockConflict,
} from '@/lib/booking/conflictQueries'
import { resolveAftercarePreselectedSlot } from '@/lib/booking/aftercarePreselectedSlot'
import { validateAftercareRebookSlotOwnership } from '@/lib/booking/aftercareRebookSlotOwnership'
import {
  isBookingReviewEligible,
  isCheckoutCloseoutComplete,
  isCloseoutPaymentAndAftercareComplete,
} from '@/lib/booking/closeoutState'
import {
  AFTERCARE_POST_COMPLETION_EDIT_WINDOW_DAYS,
  resolveAftercareEditWindow,
} from '@/lib/aftercare/aftercareEditWindow'
import { isActiveAftercareRebookedBooking } from '@/lib/aftercare/aftercareRebookSeed'
// Side-effect import: registers the Sentry sink for lifecycle drift events.
// Must come after recordStepTransition import so the contract module loads first.
import '@/lib/observability/bookingEvents'
import {
  captureBookingException,
  captureOverlapBackstopFired,
  captureStripeAmountMismatch,
} from '@/lib/observability/bookingEvents'
import {
  ADDRESS_KEY_VERSION,
  buildAddressPrivacyWriteData,
  isAddressPrivacyEnvelopeV1 as isReusableAddressPrivacyEnvelope,
} from '@/lib/security/addressEncryption'
import {
  jsonValueToInputJson,
  toNullableJsonCreateInputFromJsonValue,
} from '@/lib/typed/prismaJson'


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
  // Automated cancel with no human actor (e.g. the unpaid-deposit auto-release
  // sweep, M5). Stamps cancelledByRole=null — the SYSTEM provenance M1 uses so a
  // late-arriving payment routes through UNKNOWN_CANCEL_PROVENANCE paging rather
  // than silently assuming a refund policy.
  | {
      kind: 'system'
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
  /**
   * The booking's status BEFORE this cancel transitioned it, read inside the
   * locked transaction (§18.4). The late-cancel fee assessment keys on this —
   * only a confirmed (ACCEPTED) booking incurs one — so returning it from inside
   * the tx retires the caller's separate pre-cancel read (a read-then-write
   * TOCTOU). On an idempotent no-op (already CANCELLED) this is CANCELLED.
   */
  priorStatus: BookingStatus
  meta: MutationMeta
}

type ReleaseHoldArgs = {
  holdId: string
  clientId: string
}

type ReleaseHoldResult = {
  holdId: string
  /**
   * Whose schedule just changed. The route needs it to tell that pro's open
   * calendar the time is free again, and the hold row is gone by the time the
   * route could look it up — so it comes back with the result rather than being
   * re-read. (Same reason on `UpdateHoldAddOnsResult`.)
   */
  professionalId: string
  meta: MutationMeta
}

type CreateHoldArgs = {
  clientId: string
  bookingEntryPoint: ProBookingEntryPoint
  // OfferingAddOn link ids the client has already chosen. The reservation is
  // sized `base + add-ons` from these, so the hold covers exactly what finalize
  // will demand (B1-A). Empty when the surface picks add-ons AFTER the time
  // (the web drawer) — that flow widens the hold later via updateHoldAddOns.
  addOnIds: string[]
  // Set when this hold is being placed to MOVE an existing booking. The
  // reservation is then sized from that booking's committed
  // `totalDurationMinutes` rather than from the offering, because that is what
  // `rescheduleBookingFromHold` will take (B3). Mutually exclusive with
  // `addOnIds`: a reschedule keeps the booking's original add-ons, which are
  // already inside its committed width.
  rescheduleBookingId?: string | null
  // Book the Look, B4: the completed consult this hold is being placed FROM.
  // When set, the reservation is sized by that consult's booking proposal —
  // every estimate line's rounded duration — rather than by this offering's
  // own default, because the appointment being reserved is the whole look and
  // not just the one service the look is linked to (decision 11). Mutually
  // exclusive with `addOnIds` — see the refusal in performLockedCreateHold for
  // why B7 did not lift that.
  consultId?: string | null
  offering: {
    id: string
    professionalId: string
    serviceCategoryId?: string | null
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
    /** Minutes reserved, base + add-ons (excludes the buffer). */
    durationMinutes: number
  }
  meta: MutationMeta
}

type UpdateHoldAddOnsArgs = {
  holdId: string
  clientId: string
  addOnIds: string[]
}

type UpdateHoldAddOnsResult = {
  hold: {
    id: string
    scheduledFor: Date
    /** Unchanged by this call — re-sizing a hold must not restart its clock. */
    expiresAt: Date
    durationMinutes: number
    endsAt: Date
  }
  /** Whose schedule just changed — see `ReleaseHoldResult.professionalId`. */
  professionalId: string
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
  /**
   * True when THIS call moved the booking out of the client cancellation window
   * — i.e. it stamped `lateChangeAt`. The route reads it to run the late-change
   * fee post-commit, the same shape the cancel routes use for their refund
   * orchestration (the boundary stays DB-only; Stripe effects happen outside).
   *
   * Describes THIS move, not the row's standing history: a client who moves late
   * a second time gets `true` again, because they have cost the pro a second
   * short-notice slot. Whether that second move can actually be billed is
   * assessAndChargeNoShowFee's per-booking idempotency to decide, not this
   * flag's — mixing the two here would silently under-report the event.
   */
  lateChangeApplied: boolean
  /**
   * The instant the booking sat at BEFORE this move. The fee assessment needs
   * it: `isWithinCancelWindow` reads the booking's CURRENT `scheduledFor`, which
   * post-commit is the new, comfortably-distant time — so assessing against the
   * row would always find itself outside the window and never charge.
   */
  previousScheduledFor: Date
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
  consultId?: string | null
  /**
   * Book the Look, B7 — the estimate lines the client opted into on the review
   * step (decision 10). Absent or empty means the FLOOR alone, which is the
   * default everywhere she has not chosen: a recommendation she did not tick is
   * a price she did not agree to.
   *
   * Ids, never numbers. What each one costs and how long it takes is re-derived
   * here from the pro's own menu, so nothing the client can edit decides what
   * she is charged. An id that does not belong to this consult's estimate is
   * ignored — a stale link narrows the booking, it never widens it.
   */
  consultEnhancementLineIds?: string[] | null
  initialStatus: BookingStatus
  rebookOfBookingId: string | null
  fallbackTimeZone?: string
  requestId?: string | null
  idempotencyKey?: string | null
  // Server-validated discovery context. The shape is the resolver's own
  // `FinalizeDiscoveryDirective` rather than a hand-copy: this was a restated
  // duplicate that had to be edited in lockstep with the resolver, and K10-A's
  // new `depositRequired` gate is exactly the kind of field a copy silently
  // fails to grow (drifted-duplicate-is-a-bug-report).
  discovery?: FinalizeDiscoveryDirective | null
  // Cancellation-policy consent (M15). Set only when an interactive client agreed
  // to a chargeable no-show/late-cancel policy at the confirm step; recorded on
  // the booking so the fee is later charged from the agreed snapshot. Both null
  // when no policy applied or the path had no interactive client (aftercare token).
  cancellationPolicySnapshot?: CancellationPolicySnapshot | null
  cancellationPolicyAcceptedAt?: Date | null
  offering: {
    id: string
    professionalId: string
    serviceId: string
    serviceCategoryId?: string
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
  // OfferingAddOn link ids selected for this booking. The appointment duration
  // and price fold in each add-on; each persists as an ADD_ON line item under
  // the base. Defaults to none (calendar imports / waitlist reuse pass none).
  addOnIds?: string[]
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
  // suppressed (the migrated client has no account yet). Also refuses to
  // overlap an existing booking/hold despite the PRO actor — an unattended
  // import has no human authorizing a double-book (see
  // decideBookingOverlapPermission's CALENDAR_IMPORT branch); the caller holds
  // the time as a calendar block instead. Defaults to a normal pro booking.
  importMode?: boolean
  // K10-B: the pro asked for the deposit/prepay step on this booking. The
  // amount is ALWAYS computed server-side from the pro's deposit settings and
  // the offering's prepayScope — never client-supplied. Refused (never silently
  // dropped) when the pro isn't Stripe-ready, the computed amount is zero, or
  // the client has no deliverable contact for the pay link. Ignored on
  // importMode (imported history must not text clients payment links);
  // defaults to false, which keeps waitlist-offer confirms deposit-free.
  depositRequested?: boolean
  /**
   * The pro was shown the live-hold decision for this exact slot and chose to
   * proceed (B5 follow-up, Tori 2026-08-28). Authorizes the overlap AND records
   * it as an informed choice in the `booking_conflict` trail.
   *
   * ⚠️ Only ever set from a request that has already been REFUSED once with
   * `HOLD_OVERLAP_NEEDS_CONFIRMATION`. It is not a way to skip the question — a
   * caller that sets it blind simply gets today's silent behaviour back, which
   * is why the routes read it from the body and nothing sets it by default.
   *
   * Ignored when there is no live hold in the way: an ordinary booking-over-
   * booking overlap is unaffected either way.
   */
  confirmHoldOverlap?: boolean
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
  // K10-B: set when the pro requested the deposit step — what was stamped and
  // when the unpaid hold releases. Null on skip/import/waitlist and on
  // idempotency replays (the original response carried it).
  deposit: {
    amount: Prisma.Decimal
    dueAt: Date
  } | null
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
  // The method the pro collected payment with (cash, Venmo, etc). Recorded on
  // the booking so the receipt/aftercare reflects how the client actually paid.
  // Acceptance against the pro's payment settings is validated at the route edge.
  selectedPaymentMethod?: PaymentMethod | null
  requestId?: string | null
  idempotencyKey?: string | null
}

type ConfirmProBookingPaymentReceivedArgs = {
  bookingId: string
  professionalId: string
  actorUserId: string
  requestId?: string | null
  idempotencyKey?: string | null
}

type ConfirmProBookingPaymentReceivedResult = ProCheckoutCloseoutResult & {
  // Aftercare-sourced next appointments that were coupled to this payment and
  // auto-approved (PENDING → ACCEPTED) as part of the confirmation.
  approvedNextAppointmentBookingIds: string[]
}

type WaiveProBookingCheckoutArgs = {
  bookingId: string
  professionalId: string
  actorUserId: string
  requestId: string | null
  idempotencyKey: string
  reason?: string | null
}

type ReopenProBookingCheckoutArgs = {
  bookingId: string
  professionalId: string
  actorUserId: string
  requestId?: string | null
  idempotencyKey?: string | null
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
  /**
   * Whether to put the client's platform credit balance against this bill.
   *
   * Absent / false is a RELEASE, not a no-op: re-preparing with the toggle off
   * has to hand back a balance the previous attempt was holding, or a client who
   * changed their mind keeps their own credit locked until the sweep expires it.
   */
  applyCreatorCredit?: boolean
  requestId?: string | null
  idempotencyKey?: string | null
}

type PreparedClientCheckoutBooking = {
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

/**
 * A discriminated union, not an optional `stripe` block, so a caller physically
 * cannot read a charge amount on the branch where there is nothing to charge.
 * The zero-due branch is reachable whenever a paid deposit covers the whole
 * bill (K10-A closeout-at-zero). Before the deposit credit existed this state
 * did NOT refuse — it opened a Stripe session for the ENTIRE total on a booking
 * the client had already paid in full, which is the double charge at its worst.
 */
type PrepareClientStripeCheckoutSessionResult =
  | {
      outcome: 'STRIPE_SESSION'
      booking: PreparedClientCheckoutBooking
      stripe: {
        /**
         * What to actually charge: the bill MINUS the deposit already held.
         * Never the raw total — charging that collects the deposit twice.
         */
        amountCents: number
        currency: string
        lineItemDescription: string
        connectedAccountId: string
      }
      /** Deposit money this charge already accounts for (0 when there is none). */
      depositCreditCents: number
      /**
       * Platform credit this charge already accounts for (0 when the client did
       * not apply any). 🔴 The pro is transferred the CHARGE, so this is exactly
       * how much the platform owes them on top — see the settlement job.
       */
      creatorCreditCents: number
      meta: MutationMeta
    }
  | {
      /**
       * The deposit, the client's credit, or the two together covered the entire
       * bill: checkout was settled PAID inside this same locked transaction and
       * NO Stripe session may be opened. Charging $0 is not a thing Stripe will
       * do, and charging the total would bill the client a second time.
       */
      outcome: 'SETTLED_NOTHING_DUE'
      booking: PreparedClientCheckoutBooking
      depositCreditCents: number
      creatorCreditCents: number
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
  /**
   * Set only by the payment-succeeded applier: the captured money is (now)
   * recorded on a CANCELLED booking, so the cancel-time refund helpers never
   * saw it. The caller must run applyLateCaptureCancelRefund AFTER its
   * transaction commits (Stripe I/O cannot live in the webhook transaction).
   */
  capturedOnCancelledBooking?: boolean
  /**
   * M9 — set only by the payment-succeeded applier: a card charge landed AFTER
   * the pro had already closed the booking out by hand (mark-paid cash / waive),
   * so the client was double-collected (cash + card) or charged despite a waive.
   * The money is already captured at Stripe and cannot be un-charged in the
   * webhook transaction, so the applier records it and the caller must PAGE a
   * human post-commit (captureManualCloseoutStripeOverCollection); a human
   * refunds the card via the existing refund endpoint. Alert-only by design
   * (Tori, 2026-07-23): no automated refund. Set on the first application only —
   * once recorded the manual signal is consumed, so a redelivery no-ops.
   */
  capturedAfterManualCloseout?: boolean
}

type ApplyStripePaymentFailedArgs = {
  stripePaymentIntentId: string
  stripeEventId: string
  bookingIdHint?: string | null
}

/**
 * Resolved intent of a `charge.dispute.*` event:
 * - OPEN  — a dispute (or early-fraud warning with funds withdrawn) is active.
 * - WON   — the dispute closed in our favour; the captured payment stands.
 * - LOST  — the dispute closed against us; funds are gone.
 */
export type StripeDisputeOutcome = 'OPEN' | 'WON' | 'LOST'

type ApplyStripeDisputeArgs = {
  stripePaymentIntentId: string
  stripeEventId: string
  outcome: StripeDisputeOutcome
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
  /**
   * When set and different from the source booking's location type, the rebook
   * is created at this location mode instead of cloning the original — price,
   * duration, location, and address snapshots are re-resolved from the offering.
   * Only honored for single-service rebooks. Null/omitted clones the original.
   */
  requestedLocationType?: ServiceLocationType | null
  /**
   * Client-chosen saved service address for a MOBILE rebook. Must be a live
   * SERVICE_ADDRESS row owned by the token's client (ownership, coordinates,
   * and mobile radius are validated inside the locked transaction) — this is
   * what lets a SALON original rebook as mobile, where the source booking has
   * no client address to clone. Null/omitted keeps today's behavior of cloning
   * the source booking's address FK + snapshot. Ignored for SALON rebooks.
   */
  requestedClientAddressId?: string | null
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
  /** See {@link CreateClientRebookedBookingFromAftercareArgs.requestedLocationType}. */
  requestedLocationType?: ServiceLocationType | null
  /** See {@link CreateClientRebookedBookingFromAftercareArgs.requestedClientAddressId}. */
  requestedClientAddressId?: string | null
  /**
   * Who picked `scheduledFor`. CLIENT only when the client chose the minute
   * themselves (the public aftercare rebook link) — that start is held to the
   * pro's slot grid. A pro-chosen start (direct rebook, aftercare save, and the
   * client's confirm of a pro-proposed `rebookedFor`) stays off-grid-legal:
   * refusing it would dead-end a client on a time they cannot change.
   */
  startChosenBy: 'PRO' | 'CLIENT'
  /**
   * PRO_AFTERCARE_SAVE: the pro books the next appointment at aftercare save,
   * before the source session completes — relaxes the completed-source gate.
   */
  gate?: 'PRO_AFTERCARE_SAVE'
  /**
   * Explicit scheduling overrides from the PRO authoring the rebook (the
   * aftercare save), mirroring POST /api/v1/pro/bookings. Requires
   * `actorUserId` — each applied override is permission-checked and written to
   * BookingOverrideAuditLog. Ignored (and unnecessary) on the client-confirm
   * paths: a client can never exercise an override, but a client confirming a
   * pro-CHOSEN start is provenance-allowed past the pro's own self-rules
   * (working hours / notice / max-days) — refusing would dead-end them on a
   * time only the pro can change, exactly like the step grid above.
   */
  actorUserId?: string | null
  allowOutsideWorkingHours?: boolean
  allowShortNotice?: boolean
  allowFarFuture?: boolean
  overrideReason?: string | null
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
    /**
     * MOBILE slots: the client service address the pro picked for the next
     * appointment. Ownership (booking's client + SERVICE_ADDRESS kind) is
     * asserted in the boundary; confirm falls back to the source booking's
     * address when null, so older clients that never send it keep working.
     */
    clientAddressId: string | null
    startsAt: Date
    endsAt: Date
  } | null
  /**
   * Explicit scheduling overrides for the BOOKED_NEXT_APPOINTMENT slot,
   * mirroring POST /api/v1/pro/bookings: the pro may deliberately book their
   * client's next appointment outside their public working hours (an off day,
   * before opening), on short notice, or past their booking horizon. Applied
   * overrides are permission-checked against `actorUserId` and written to
   * BookingOverrideAuditLog. They cover both the create and the time-only
   * reschedule of the mirrored booking.
   */
  allowOutsideWorkingHours: boolean
  allowShortNotice: boolean
  allowFarFuture: boolean
  overrideReason: string | null
  createRebookReminder: boolean
  rebookReminderDaysBefore: number
  createProductReminder: boolean
  productReminderDaysAfter: number
  recommendedProducts: RecommendedProductInput[]
  sendToClient: boolean
  version: number | null
  // Pro-chosen featured before/after pair for the client aftercare summary.
  // Null clears; a non-null id must be an IMAGE on this booking with the
  // matching phase (validated inside the locked transaction).
  featuredBeforeAssetId?: string | null
  featuredAfterAssetId?: string | null
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
  // Normalized subject focal point (camera C6), [0,1] top-left. Null → center.
  focalX?: number | null
  focalY?: number | null
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

type ReopenProBookingCheckoutResult = {
  booking: {
    id: string
    status: BookingStatus
    sessionStep: SessionStep
    checkoutStatus: BookingCheckoutStatus
    paymentCollectedAt: Date | null
  }
  // `reopened` is true only when a PAID/WAIVED close-out was actually reversed;
  // false on the idempotent no-op (nothing was closed out to undo).
  meta: MutationMeta & {
    reopened: boolean
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
    serviceId: string
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
    featuredBeforeAssetId: string | null
    featuredAfterAssetId: string | null
    draftSavedAt: Date | null
    sentToClientAt: Date | null
    lastEditedAt: Date | null
    version: number
    /** The real next-appointment Booking a BOOKED slot created (null otherwise). */
    rebookedBookingId: string | null
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
  /**
   * The pro was shown the live-hold decision for this exact slot and chose to
   * proceed (B5 follow-up, Tori 2026-08-28). Authorizes the overlap AND records
   * it as an informed choice in the `booking_conflict` trail.
   *
   * ⚠️ Only ever set from a request that has already been REFUSED once with
   * `HOLD_OVERLAP_NEEDS_CONFIRMATION`. It is not a way to skip the question — a
   * caller that sets it blind simply gets today's silent behaviour back, which
   * is why the routes read it from the body and nothing sets it by default.
   *
   * Ignored when there is no live hold in the way: an ordinary booking-over-
   * booking overlap is unaffected either way.
   */
  confirmHoldOverlap?: boolean
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

type HoldConflictType =
  | 'BLOCKED'
  | 'BOOKING'
  | 'HOLD'
  | 'WORKING_HOURS'
  | 'STEP_BOUNDARY'
  | 'TIME_NOT_AVAILABLE'

const CANCEL_BOOKING_SELECT = {
  id: true,
  status: true,
  clientId: true,
  professionalId: true,
  startedAt: true,
  finishedAt: true,
  sessionStep: true,
  // §12 NC1 #8/#9: enrich cancellation copy with service + who + when.
  scheduledFor: true,
  locationTimeZone: true,
  service: { select: { name: true } },
  client: {
    select: {
      firstName: true, // pii-plaintext-read-ok: pro-facing client name in cancellation notif (same as inbox)
      lastName: true, // pii-plaintext-read-ok: pro-facing client name in cancellation notif (same as inbox)
    },
  },
  professional: {
    select: { timeZone: true, ...professionalPublicDisplayNameSelect },
  },
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

// The booking's session-lifecycle state, read back after a session write
// (start / finish / transition). Shared by every `performLocked*Session*`
// path so the projection can't drift between them.
const BOOKING_SESSION_STATE_SELECT = {
  id: true,
  status: true,
  startedAt: true,
  finishedAt: true,
  sessionStep: true,
} satisfies Prisma.BookingSelect

// The full checkout money snapshot read back after a checkout write, and the
// exact shape `maybeCompleteBookingCloseout` consumes. Shared by the pro and
// client checkout-update paths, which both feed it.
const BOOKING_CHECKOUT_MONEY_SELECT = {
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
} satisfies Prisma.BookingSelect

const HOLD_OWNERSHIP_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  waitlistOfferId: true,
  rescheduleBookingId: true,
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
  durationMinutesSnapshot: true,
} satisfies Prisma.BookingHoldSelect

type CreateHoldRecord = Prisma.BookingHoldGetPayload<{
  select: typeof CREATE_HOLD_SELECT
}>

const UPDATE_HOLD_ADDONS_SELECT = {
  id: true,
  offeringId: true,
  professionalId: true,
  scheduledFor: true,
  expiresAt: true,
  locationType: true,
  locationId: true,
  locationTimeZone: true,
  durationMinutesSnapshot: true,
  bufferMinutesSnapshot: true,
  endsAtSnapshot: true,
} satisfies Prisma.BookingHoldSelect

const UPDATE_HOLD_ADDONS_OFFERING_SELECT = {
  id: true,
  isActive: true,
  professionalId: true,
  offersInSalon: true,
  offersMobile: true,
  salonDurationMinutes: true,
  mobileDurationMinutes: true,
  salonPriceStartingAt: true,
  mobilePriceStartingAt: true,
  professional: {
    select: {
      timeZone: true,
    },
  },
} satisfies Prisma.ProfessionalServiceOfferingSelect

const APPROVE_CONSULTATION_BOOKING_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  locationType: true,
  // Calendar blocks are location-aware (global blocks conflict everywhere, a
  // location block only for that location) — the extension probe needs this.
  locationId: true,
  serviceId: true,
  offeringId: true,
  scheduledFor: true,
  subtotalSnapshot: true,
  totalDurationMinutes: true,
  bufferMinutes: true,
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
  // K10-B: the deposit pay link is snapshot-delivered (EMAIL/SMS) because a
  // pro-created client is often UNCLAIMED — same contact-resolution shape as
  // the aftercare delivery above.
  userId: true,
  email: true,
  phone: true,
  preferredContactMethod: true,
  user: {
    select: {
      email: true,
      phone: true,
    },
  },
} satisfies Prisma.ClientProfileSelect

// Pro-create resolves the client's mobile service address through the shared
// `loadClientServiceAddress` helper (same query the finalize/rebook paths use),
// so there's no dedicated address-select constant here.

const PRO_CREATE_OFFERING_SELECT = {
  id: true,
  serviceId: true,
  // K10-B: the per-service prepay requirement sizes the pro-requested deposit.
  prepayScope: true,
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
  paymentAuthorizedAt: true,
  paymentCollectedAt: true,
  aftercareSummary: {
    select: {
      id: true,
      sentToClientAt: true,
      rebookedBookingId: true,
      rebookedBooking: {
        select: {
          id: true,
          status: true,
          scheduledFor: true,
        },
      },
      rebookSlot: {
        select: {
          id: true,
          professionalId: true,
          offeringId: true,
          locationId: true,
          locationType: true,
          clientAddressId: true,
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
  serviceId: true,
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
      featuredBeforeAssetId: true,
      featuredAfterAssetId: true,
      draftSavedAt: true,
      sentToClientAt: true,
      lastEditedAt: true,
      version: true,
      rebookedBookingId: true,
      rebookedBooking: {
        select: {
          id: true,
          status: true,
          scheduledFor: true,
          locationType: true,
          clientAddressId: true,
        },
      },
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
  stripePaymentStatus: true,
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
  // M9: a SUCCEEDED final-bill Stripe payment means the card already collected —
  // a manual mark-paid / waive must be refused (CHECKOUT_ALREADY_PAID_BY_STRIPE),
  // never allowed to race a real capture into a double-collect.
  stripePaymentStatus: true,
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
  // The deposit columns the credit reads, so the final bill can be charged NET
  // of a deposit the client already paid (K10-A). `depositCreditedAt` rides
  // along so the zero-due settle never re-stamps an already-consumed credit.
  ...DEPOSIT_CREDIT_SELECT,
  depositCreditedAt: true,
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
  // The tenant whose brand the client sees on the Stripe checkout page and on
  // their card statement (buildStripeLineItemDescription).
  proTenant: {
    select: {
      id: true,
      slug: true,
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
  serviceId: true,
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

    // Single emit point for the payment receipt — every checkout/webhook path
    // that collects payment converges on this paymentCollectedAt transition.
    await emitPaymentCollectedNotifications({
      tx: args.tx,
      bookingId: args.bookingId,
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

/**
 * §23: aftercare-ready fans out over TWO emitters. EMAIL + SMS are owned solely
 * by the magic-link delivery (createAftercareAccessDelivery), which carries the
 * secure /client/rebook token link (no login required, reaches phone-only /
 * unclaimed clients). This inbox notification is the IN_APP/PUSH surface only —
 * its href is the login-gated in-app booking view, which is correct for an
 * already-authenticated tap but must NEVER ship over EMAIL/SMS, or the client
 * gets a duplicate "aftercare is ready" email/text whose link dead-ends at the
 * login screen. Restricting the inbox emit to these channels keeps the external
 * link the token link, and the single email/text the magic-link one.
 */
const AFTERCARE_INBOX_NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.PUSH,
]

function pickFirstNonEmpty(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const normalized = normalizeReason(value)
    if (normalized) return normalized
  }
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
  resendMode: ClientActionResendMode
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
      resendMode: args.resendMode,
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
    // WARNING, not error: the pro is told ("We could not send aftercare to the
    // client. Please try again."), so this is never silent. But that message is
    // the same whatever the cause, and the throw below is a mapped bookingError
    // the route turns into a clean response — so it never reaches onRequestError
    // either. A broken delivery pipeline would show up only as pros retrying.
    //
    // ⚠️ This event arrives in Sentry DEGRADED: beforeSend's private-media
    // string pattern matches the literal word "aftercare", so the message and
    // both the route and event tags below land as [REDACTED]. The ids, the
    // level and the stack trace survive, and the stack is what Sentry groups
    // on — so it is still triageable, just not by tag. Pre-existing, not
    // introduced here (eight /aftercare/ and /consultation/ routes already
    // capture this way); pinned by the CANARY test in
    // lib/observability/bookingEvents.captureException.test.ts.
    captureBookingException({
      error,
      route: 'upsertBookingAftercare',
      event: 'AFTERCARE_ACCESS_DELIVERY_ENQUEUE_FAILED',
      level: 'warning',
      bookingId: args.booking.id,
      professionalId: args.booking.professionalId,
      clientId: args.booking.clientId,
    })

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
  // formatInTimeZone sanitizes: a missing/invalid zone falls back to UTC.
  return formatDatedAppointmentWhen(date, timeZone)
}

/** Booking's display timezone via the standard truth precedence, never throwing. */
function resolveBookingDisplayTimeZone(booking: {
  locationTimeZone?: string | null
  professional?: { timeZone?: string | null } | null
}): string {
  const result = resolveApptTimeZoneFromValues({
    bookingLocationTimeZone: booking.locationTimeZone,
    professionalTimeZone: booking.professional?.timeZone,
    fallback: DEFAULT_TIME_ZONE,
  })
  return result.ok ? result.timeZone : DEFAULT_TIME_ZONE
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
    // Replay: the original response carried the deposit summary; the stamped
    // truth lives on the booking row.
    deposit: null,
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

  // Post-visit review request (review flywheel): scheduled in the same tx,
  // idempotent per booking via dedupeKey, re-validated at drain time.
  await scheduleReviewRequestOnCompletion({
    tx: args.tx,
    bookingId: args.booking.id,
    now: args.now,
  })

  // Platform-funded creator credit (Tori, 2026-08-17): 3% of the service
  // subtotal to the client whose look this booking was made from. Same tx, and
  // idempotent by a database unique constraint rather than by checking first —
  // this function is reached from four call sites and `upsertBookingAftercare`
  // completes a booking on its own path too.
  await mintCreatorCreditOnCompletion(args.tx, {
    bookingId: args.booking.id,
    now: args.now,
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

// Thin local alias — the review-eligibility predicate is the shared SSOT in
// `closeoutState.ts` (also consumed by the client aftercare read DTO's
// `reviewEligible`), so the write gate and the read surface can never drift.
const isReviewEligibleCloseout = isBookingReviewEligible

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
  // Derived from the lifecycle contract — see isTerminalBookingStatus. This
  // copy omitted NO_SHOW, so session steps could still be advanced on a booking
  // the pro had already marked as a no-show.
  return isTerminalBookingStatus(status) || Boolean(finishedAt)
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
      to === SessionStep.CONSULTATION ||
      // §22 MS1: pre-capture mid-session service change → re-open the
      // consultation for client re-approval (the re-sent proposal moves here).
      to === SessionStep.CONSULTATION_PENDING_CLIENT
    )
  }

  if (from === SessionStep.SERVICE_IN_PROGRESS) {
    return (
      to === SessionStep.FINISH_REVIEW ||
      // §22 MS1 (see BEFORE_PHOTOS above).
      to === SessionStep.CONSULTATION_PENDING_CLIENT
    )
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

/**
 * How long after a booking is closed out its own session photos may still land.
 *
 * 🔴 Why this exists: closing out a session (the pro's wrap-up) sets
 * `status = COMPLETED`, `sessionStep = DONE` and `finishedAt = now` in one
 * transaction — and the two gates below then refuse all further session media.
 * That is correct for editing a finished booking, and wrong for the photos of
 * the very session being finished: the pro shoots the AFTER set and closes out
 * seconds later, while those uploads are still in flight. Before this window,
 * every straggler was refused with BOOKING_CANNOT_EDIT_COMPLETED and the shoot
 * simply lost them.
 *
 * 48 hours covers a phone that left the salon with no signal and reconnected the
 * next day (iOS uploads these in the background, retrying with backoff), while
 * still being a bounded, auditable window rather than "any past booking, ever".
 *
 * ⚠️ Scope: this relaxes the MEDIA gates only. Money, schedule and status
 * transitions stay locked on a completed booking exactly as before.
 */
export const SESSION_MEDIA_POST_CLOSEOUT_GRACE_MS = 48 * 60 * 60 * 1000

/**
 * Whether a completed booking is still inside the window in which the session's
 * own photos may arrive.
 *
 * Deliberately keyed on `finishedAt`, not on `status`: a booking marked
 * COMPLETED with no `finishedAt` has no window to measure, so it gets none.
 */
function isWithinPostCloseoutMediaGrace(
  finishedAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!finishedAt) return false
  const elapsed = now.getTime() - finishedAt.getTime()
  return elapsed >= 0 && elapsed <= SESSION_MEDIA_POST_CLOSEOUT_GRACE_MS
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

/**
 * How far the pro would travel for a MOBILE appointment, as measured by the
 * radius gate that admitted it.
 *
 * Returned rather than recomputed by anyone who needs to DISPLAY the distance
 * (today: the pro-facing summary on a pending waitlist offer). A second caller
 * running its own haversine is how "14 mi away" ends up on a card the gate
 * refused at 15 — so there is one measurement, and it is this one.
 */
export type MobileTripDistance = { distanceMiles: number }

async function assertMobileBookingWithinRadius(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  locationType: ServiceLocationType
  locationLat: number | null | undefined
  locationLng: number | null | undefined
  clientAddressId: string | null | undefined
  clientLat: number | null | undefined
  clientLng: number | null | undefined
  /**
   * True when the booking already carries a preserved client-address *snapshot*
   * (formatted address + coordinates on the Booking row itself) even though the
   * live `clientAddressId` FK is gone — e.g. an aftercare rebook whose saved
   * `ClientAddress` was deleted (`onDelete: SetNull` nulls only the FK, not the
   * snapshot columns). A preserved destination satisfies the "mobile needs a
   * client address" requirement; the coordinate and radius checks below still
   * validate it. Defaults to false so the create/hold/pro-create paths keep
   * demanding a live saved address.
   */
  hasSnapshotAddress?: boolean
  // Returns the distance it measured (null when this is not a MOBILE booking
  // and nothing was measured). Every existing caller ignores it — the throw is
  // still the contract; the number is a by-product for anyone who has to show
  // the pro how far the trip is.
}): Promise<MobileTripDistance | null> {
  if (args.locationType !== ServiceLocationType.MOBILE) {
    return null
  }

  if (!args.clientAddressId && !args.hasSnapshotAddress) {
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

  const distanceMiles = haversineMiles(
    { lat: args.locationLat, lng: args.locationLng },
    { lat: args.clientLat, lng: args.clientLng },
  )

  if (distanceMiles > radiusMiles) {
    throw bookingError('CLIENT_SERVICE_ADDRESS_INVALID', {
      message: `Client service address is ${distanceMiles.toFixed(
        2,
      )} miles from the professional mobile base, which exceeds the ${radiusMiles}-mile service radius.`,
      userMessage: `This service address is outside this professional's ${radiusMiles}-mile mobile service area.`,
    })
  }

  return { distanceMiles }
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
    // A booking the caller doesn't own is indistinguishable from one that
    // doesn't exist — return the same 404 either way so the id space can't be
    // enumerated via a 403-vs-404 status difference.
    throw bookingError('BOOKING_NOT_FOUND')
  }

  // The lifecycle gate is shared with the client aftercare read DTO
  // (`checkoutProductsEditable`) so the read surface can never disagree with
  // what this write path enforces. Ownership stays here (a 404, above); this
  // maps each lifecycle reason to its specific error.
  const reason = clientCheckoutProductsEditBlockReason({
    status: booking.status,
    finishedAt: booking.finishedAt,
    checkoutStatus: booking.checkoutStatus,
    paymentAuthorizedAt: booking.paymentAuthorizedAt,
    paymentCollectedAt: booking.paymentCollectedAt,
    aftercareSentAt: booking.aftercareSummary?.sentToClientAt ?? null,
  })

  switch (reason) {
    case null:
      return
    case 'CANCELLED':
      throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED')
    case 'COMPLETED':
      throw bookingError('BOOKING_CANNOT_EDIT_COMPLETED', {
        message: 'Completed bookings cannot be changed.',
        userMessage: 'This booking is already completed.',
      })
    case 'AFTERCARE_NOT_SENT':
      throw bookingError('FORBIDDEN', {
        message: 'Product checkout requires finalized aftercare.',
        userMessage:
          'Products can only be selected after aftercare is finalized.',
      })
    case 'PAYMENT_AUTHORIZED':
      throw bookingError('FORBIDDEN', {
        message: 'Payment has already been authorized for this booking.',
        userMessage:
          'This checkout is already in payment and cannot be changed.',
      })
    case 'PAYMENT_COLLECTED':
      throw bookingError('FORBIDDEN', {
        message: 'Checkout is already paid and cannot be changed.',
        userMessage: 'This checkout is already paid and cannot be changed.',
      })
    case 'CHECKOUT_LOCKED':
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
    // Uniform 404 for a non-owned booking — see the no-enumeration rationale in
    // assertClientCanEditBookingCheckoutProducts.
    throw bookingError('BOOKING_NOT_FOUND')
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
    // Uniform 404 for a non-owned booking — see the no-enumeration rationale in
    // assertClientCanEditBookingCheckoutProducts.
    throw bookingError('BOOKING_NOT_FOUND')
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

// A single persisted booking line item. A booking carries one or more co-equal
// BASE services (e.g. cut + color) plus optional ADD_ONs that hang off a base.
type PersistBookingServiceItem = {
  serviceId: string
  offeringId: string | null
  itemType: BookingServiceItemType
  priceSnapshot: Prisma.Decimal
  durationMinutesSnapshot: number
  notes: string | null
  sortOrder: number
}

// Replace a booking's service items with `items`, preserving each item's
// declared itemType. Multiple BASE items are co-equal services; ADD_ON items
// are parented to the first BASE so the existing parent/child shape (and the
// derived primary service/offering) stays valid. Callers must have already
// validated the items (offering ownership, location mode, baseCount >= 1).
async function replaceBookingServiceItems(
  tx: Prisma.TransactionClient,
  bookingId: string,
  items: PersistBookingServiceItem[],
): Promise<void> {
  const baseItems = items.filter(
    (item) => item.itemType === BookingServiceItemType.BASE,
  )
  if (baseItems.length < 1) {
    throw bookingError('INVALID_SERVICE_ITEMS')
  }

  await tx.bookingServiceItem.deleteMany({ where: { bookingId } })

  const toRow = (item: PersistBookingServiceItem, parentItemId: string | null) => ({
    bookingId,
    serviceId: item.serviceId,
    offeringId: item.offeringId,
    itemType: item.itemType,
    parentItemId,
    priceSnapshot: item.priceSnapshot,
    durationMinutesSnapshot: item.durationMinutesSnapshot,
    notes: item.notes,
    sortOrder: item.sortOrder,
  })

  // Create the first base on its own so add-ons have a parent to point at.
  const firstBase = baseItems[0]
  if (!firstBase) {
    throw bookingError('INVALID_SERVICE_ITEMS')
  }
  const otherBases = baseItems.slice(1)
  const createdFirstBase = await tx.bookingServiceItem.create({
    data: toRow(firstBase, null),
    select: { id: true },
  })

  if (otherBases.length > 0) {
    await tx.bookingServiceItem.createMany({
      data: otherBases.map((item) => toRow(item, null)),
    })
  }

  const addOnItems = items.filter(
    (item) => item.itemType === BookingServiceItemType.ADD_ON,
  )
  if (addOnItems.length > 0) {
    await tx.bookingServiceItem.createMany({
      data: addOnItems.map((item) => toRow(item, createdFirstBase.id)),
    })
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
  if (baseCount < 1) {
    throw bookingError('INVALID_SERVICE_ITEMS', {
      message: 'Final review requires at least one BASE service item.',
      userMessage: 'You need at least one main service.',
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

  return jsonValueToInputJson(snapshot)
}

function toValidatedLegacyAddressSnapshotInput(
  snapshot: Prisma.JsonValue | null | undefined,
): Prisma.InputJsonValue | null {
  if (snapshot == null) return null
  if (isReusableAddressPrivacyEnvelope(snapshot)) return null

  return jsonValueToInputJson(snapshot)
}

function buildEncryptedAddressSnapshotData(
  input: AddressSnapshotEncryptionInput,
): AddressSnapshotWriteData {
  const formattedAddress = normalizeAddress(input.formattedAddress)

  if (!formattedAddress) {
    return buildNullAddressSnapshotData(input)
  }

  const legacySnapshot = jsonValueToInputJson({
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

/**
 * K16 — refuse a NEW self-serve appointment when this pro has closed self-serve
 * booking for this client (`ProClientPolicy.blockSelfServeBooking`).
 *
 * Runs on the client-initiated paths only. Deliberately NOT reached by:
 *
 *   * `performLockedCreateProBooking` — the pro booking this client by hand is
 *     the whole point of the switch, not something to refuse;
 *   * a reschedule (`rescheduleBookingId` set) — the appointment already exists;
 *   * a waitlist-offer confirmation — the pro sent that offer to this client
 *     specifically, which is an invitation, not self-serve booking.
 *
 * The thrown code carries neutral client-facing copy: the client learns that
 * online booking is closed and that the pro can book it for them, never that a
 * policy exists about them.
 */
async function assertClientMaySelfServeBook(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  clientId: string
}): Promise<void> {
  const policy = await loadProClientPolicy({
    db: args.tx,
    professionalId: args.professionalId,
    clientId: args.clientId,
  })

  if (!policy.blocksSelfServeBooking) return

  throw bookingError('SELF_SERVE_BOOKING_UNAVAILABLE')
}

/**
 * K16 — refuse a booking when this pro requires a card on file from this client
 * and the client has none saved.
 *
 * `loadProClientPolicy` has already applied the ENABLE_NO_SHOW_PROTECTION gate,
 * so with the card-on-file rail dark this resolves false and no booking is ever
 * refused for a card no client could have saved.
 *
 * "Has a card" means a `ClientPaymentMethod` row exists. Stripe remains the
 * source of truth for the card itself; this table caches the attachment, and it
 * is the same signal the client's own settings surface lists — so what the
 * client is told they have is what this check counts.
 */
async function assertClientCardOnFileSatisfied(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  clientId: string
}): Promise<void> {
  const policy = await loadProClientPolicy({
    db: args.tx,
    professionalId: args.professionalId,
    clientId: args.clientId,
  })

  if (!policy.requiresCardOnFile) return

  const savedCard = await args.tx.clientPaymentMethod.findFirst({
    where: { clientId: args.clientId },
    select: { id: true },
  })

  if (savedCard) return

  throw bookingError('CARD_ON_FILE_REQUIRED')
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
  requestedChannels?: readonly NotificationChannel[] | null
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
    requestedChannels: args.requestedChannels ?? null,
  })

  if (args.eventKey === NotificationEventKey.BOOKING_CONFIRMED) {
    await maybeCreateAiConsultInvitation({
      tx: args.tx,
      bookingId: args.bookingId,
      clientId: args.clientId,
      now: new Date(),
    })
  }
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
  /** See {@link EvaluateProSchedulingDecisionArgs.enforceStepGrid}. */
  enforceStepGrid: boolean
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
    enforceStepGrid: args.enforceStepGrid,
    // Booking/hold overlaps are decided by enforceBookingOverlapPolicy in the
    // update path (a pro may intentionally double-book their own calendar).
    deferBusyConflictsToOverlapPolicy: true,
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
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (actor.kind === 'pro' && booking.professionalId !== actor.professionalId) {
    throw bookingError('BOOKING_NOT_FOUND')
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

  // §12 NC1 #8: name the service + pro + when; keep the reason suffix.
  const serviceLabel = booking.service?.name?.trim() || 'appointment'
  const proName = formatProfessionalPublicDisplayName(booking.professional)
  const whenClause = formatBookingWhenClause(
    booking.scheduledFor,
    resolveBookingDisplayTimeZone(booking),
  )
  const reasonClause = reason ? ` Reason: ${reason}` : ''
  const body = `Your ${serviceLabel} with ${proName}${whenClause} was cancelled.${reasonClause}`

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

  // §12 NC1 #9: name the client + service + when; keep by-client / by-admin
  // heading variants.
  const clientName = formatClientName(args.booking.client)
  const serviceLabel = args.booking.service?.name?.trim() || 'the appointment'
  const whenClause = formatBookingWhenClause(
    args.booking.scheduledFor,
    resolveBookingDisplayTimeZone(args.booking),
  )
  const reasonClause = reason ? ` Reason: ${reason}` : ''

  if (args.actor.kind === 'client') {
    eventKey = NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT
    title = 'Booking cancelled by client'
    body = `${clientName} cancelled ${serviceLabel}${whenClause}.${reasonClause}`
  } else if (args.actor.kind === 'admin') {
    eventKey = NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN
    title = 'Booking cancelled by admin'
    body = `An admin cancelled ${serviceLabel}${whenClause}.${reasonClause}`
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
  // §12 NC1 #6: "{client}'s {service} moved to {newDate} at {newTime}."
  const rescheduleMeta = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: {
      service: { select: { name: true } },
      client: {
        select: {
          firstName: true, // pii-plaintext-read-ok: pro-facing client name in reschedule notif (same as inbox)
          lastName: true, // pii-plaintext-read-ok: pro-facing client name in reschedule notif (same as inbox)
        },
      },
    },
  })
  const rescheduleClientName = formatClientName(rescheduleMeta?.client ?? {})
  const rescheduleServiceLabel =
    rescheduleMeta?.service?.name?.trim() || 'appointment'
  const rescheduleTz =
    args.nextLocationTimeZone && isValidIanaTimeZone(args.nextLocationTimeZone)
      ? args.nextLocationTimeZone
      : DEFAULT_TIME_ZONE
  const nextWhen = args.nextScheduledFor
    ? new Date(args.nextScheduledFor)
    : null
  const rescheduleWhenClause =
    nextWhen && !Number.isNaN(nextWhen.getTime())
      ? ` to ${formatBookingDateLabel(nextWhen, rescheduleTz)} at ${formatBookingTimeLabel(nextWhen, rescheduleTz)}`
      : ''

  await createProNotification({
    tx: args.tx,
    professionalId: args.professionalId,
    eventKey: NotificationEventKey.BOOKING_RESCHEDULED,
    priority: NotificationPriority.HIGH,
    title: 'Booking rescheduled',
    body: `${rescheduleClientName}'s ${rescheduleServiceLabel} moved${rescheduleWhenClause}.`,
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
  code: BookingOverlapBlockedCode,
): BookingErrorCode {
  switch (code) {
    case 'PRO_HOLD_DECISION_REQUIRED':
      return 'HOLD_OVERLAP_NEEDS_CONFIRMATION'
    case 'CLIENT_OVERLAP_NOT_ALLOWED':
      return 'TIME_BOOKED'
    case 'IMPORT_OVERLAP_NOT_ALLOWED':
      return 'TIME_BOOKED'
    case 'SERIES_OVERLAP_NOT_ALLOWED':
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
  code: BookingOverlapBlockedCode
  conflictKinds: string[]
  sourceKind: string
  actorKind: string
  /**
   * The label the pro was SHOWN, on the live-hold decision only. Null
   * everywhere else — a refusal that never asked anybody anything has no label
   * to record.
   */
  heldSlotRelationship?: HeldSlotRelationship | null
}): void {
  logBookingConflict({
    action: args.action,
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    // The live-hold decision is refused BY a hold; every other blocked code
    // here is refused by an appointment. Saying 'BOOKING' for both would make
    // the new line unfindable in the trail it is supposed to leave.
    conflictType:
      args.code === 'PRO_HOLD_DECISION_REQUIRED' ? 'HOLD' : 'BOOKING',
    holdId: args.holdId ?? undefined,
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      offeringId: args.offeringId,
      clientId: args.clientId,
      overlapDecisionCode: args.code,
      conflictKinds: args.conflictKinds,
      sourceKind: args.sourceKind,
      actorKind: args.actorKind,
      ...(args.heldSlotRelationship
        ? { heldSlotRelationship: args.heldSlotRelationship }
        : {}),
    },
  })
}

/**
 * An overlap the gate ALLOWED — the half of the trail that was never written.
 *
 * `enforceBookingOverlapPolicy` returned early on every `decision.ok` and logged
 * nothing, so the `booking_conflict` trail recorded refusals only. Every
 * deliberate double-book a pro has ever made is therefore absent from it: from
 * the outside, "the pro booked over an appointment" and "no conflict existed"
 * look identical. That is the gap this closes.
 *
 * 🔴 The HELD CLIENT IS NOT NAMED HERE. `holdId` identifies the reservation and
 * is enough to trace one (the row knows its own client); writing the held
 * client's id into a log line would put the pairing the popup deliberately
 * withholds into a place a human reads. B5's anonymity is a property of the
 * decision, not only of the pixel.
 *
 * Silent when there is nothing to say: a booking with no conflicts is the
 * ordinary case and does not belong in a conflict trail.
 */
function logOverlapDecisionAuthorized(args: {
  action: 'BOOKING_CREATE' | 'BOOKING_FINALIZE' | 'BOOKING_UPDATE'
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  offeringId: string | null
  clientId: string
  mode: BookingOverlapAllowedMode
  conflicts: readonly SchedulingConflict[]
  sourceKind: string
  actorKind: string
  /** Set only when the pro was shown the live-hold decision and said yes. */
  heldSlotRelationship?: HeldSlotRelationship | null
}): void {
  if (args.conflicts.length === 0) return

  const holdIds = args.conflicts
    .filter((conflict) => conflict.kind === 'HOLD')
    .map((conflict) => conflict.id)

  const informedChoice = args.mode === 'PRO_CONFIRMED_HOLD_OVERLAP'

  logBookingConflict({
    action: args.action,
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: holdIds.length > 0 ? 'HOLD' : 'BOOKING',
    holdId: holdIds[0] ?? undefined,
    // The discriminator: this line is an overlap that WENT THROUGH. Every other
    // `booking_conflict` line is something that did not.
    note: 'overlap_authorized',
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      offeringId: args.offeringId,
      clientId: args.clientId,
      overlapDecisionMode: args.mode,
      conflictKinds: args.conflicts.map((conflict) => conflict.kind),
      overlappedHoldIds: holdIds,
      sourceKind: args.sourceKind,
      actorKind: args.actorKind,
      // Whether a human was SHOWN what they were overriding before they did it.
      // False on an ordinary pro double-book (nobody is mid-checkout, so there
      // was nothing to ask) and on the paths with no surface to ask from.
      informedChoice,
      ...(args.heldSlotRelationship
        ? { heldSlotRelationship: args.heldSlotRelationship }
        : {}),
    },
  })
}

/**
 * The durable database EXCLUDE constraint refused a write the app-level gate let
 * through. **This should be effectively unreachable.**
 *
 * Every booking write is serialised per professional by the advisory schedule
 * lock and pre-checked by `enforceBookingOverlapPolicy`, so a 23P01 on `Booking`
 * is not "a race we tolerate" — it is evidence that something upstream is wrong:
 * a gate that stopped finding conflicts, or a write that reached the table
 * without the lock.
 *
 * It has to be logged explicitly because **the two layers are otherwise
 * indistinguishable from outside.** Both refuse with `TIME_BOOKED`, so the
 * client sees the same thing either way and no existing signal separates them.
 * Without this line a gate that silently stopped working looks exactly like
 * normal operation: client bookings keep getting refused (by Postgres), the
 * `booking_conflict` audit trail goes quiet rather than wrong, and the only
 * visible symptom is pro double-books starting to fail — a path nobody watches.
 *
 * The hold-create path has always logged its own backstop
 * (`prismaCode: '23P01'`); this is the booking-side equivalent.
 *
 * Alert on it: a nonzero rate is a bug, not background noise.
 */
function logOverlapBackstopFired(args: {
  action: 'BOOKING_CREATE' | 'BOOKING_FINALIZE' | 'BOOKING_UPDATE'
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  /** The booking being CHANGED. Omit on create paths — there is no row yet. */
  bookingId?: string | null
  holdId?: string | null
  offeringId?: string | null
  clientId?: string | null
  /** Rebook only: the completed booking this create was derived from. */
  sourceBookingId?: string | null
}): void {
  logBookingConflict({
    action: args.action,
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: 'BOOKING',
    bookingId: args.bookingId ?? undefined,
    holdId: args.holdId ?? undefined,
    note: 'db_overlap_backstop_fired',
    meta: {
      route: 'lib/booking/writeBoundary.ts',
      // The discriminator: this refusal came from Postgres, NOT from
      // enforceBookingOverlapPolicy.
      layer: 'db_backstop',
      prismaCode: '23P01',
      constraint: BOOKING_OVERLAP_CONSTRAINT_NAME,
      offeringId: args.offeringId ?? null,
      clientId: args.clientId ?? null,
      sourceBookingId: args.sourceBookingId ?? null,
    },
  })

  // ...and page a human. The log line above is the audit trail; on its own it
  // would sit in Vercel logs looking like one more routine refusal.
  captureOverlapBackstopFired({
    action: args.action,
    professionalId: args.professionalId,
    bookingId: args.bookingId ?? args.sourceBookingId ?? null,
    holdId: args.holdId ?? null,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    constraint: BOOKING_OVERLAP_CONSTRAINT_NAME,
  })
}

/**
 * What the pro may be told about the checkout sitting on the minutes they asked
 * for — and, by construction, nothing else.
 *
 * 🔴 THE RESPONSE BOUNDARY. The hold row read here knows the client's id, and
 * that id is used (to count their history with this pro) and then dropped. What
 * leaves this function is `HeldSlotDecision`, a closed type of strings, an enum
 * and a count — no name, no email, no phone, no avatar, no client id. B5 made a
 * client's live checkout anonymous to the pro; the ONE exception Tori approved
 * (2026-08-28) is the new-or-returning label, and it is computed from the SAME
 * pair-history count the pro's NR/RR chips and the discovery fee already use
 * (`countEstablishedBookings` + `isReturningClient`), never a second definition.
 *
 * Returns null when the conflict list holds nothing describable — the caller
 * still refuses, it just cannot dress the refusal up as a question.
 */
async function describeHeldSlotForPro(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  conflicts: readonly SchedulingConflict[]
  now: Date
}): Promise<HeldSlotDecision | null> {
  const holds = liveHoldConflicts(args.conflicts, args.now)
  // Earliest-starting first, which is the order `findBookingAndHoldConflicts`
  // already sorts in — so the one described is the one the pro's slot runs into
  // first, and any others are counted rather than silently ignored.
  const [primary] = holds

  if (!primary || primary.kind !== 'HOLD') return null

  const row = await args.tx.bookingHold.findFirst({
    where: { id: primary.id, professionalId: args.professionalId },
    select: {
      id: true,
      clientId: true,
      offering: {
        select: {
          title: true,
          service: { select: { name: true } },
        },
      },
    },
  })

  if (!row) return null

  // A hold can have no client at all (`BookingHold.clientId` is nullable), and
  // "new" would be an invention rather than an answer. UNKNOWN says so.
  const relationship: HeldSlotRelationship = row.clientId
    ? isReturningClient(
        await countEstablishedBookings({
          db: args.tx,
          clientId: row.clientId,
          professionalId: args.professionalId,
        }),
      )
      ? 'RETURNING'
      : 'NEW'
    : 'UNKNOWN'

  return {
    holdId: row.id,
    relationship,
    serviceName: offeringDisplayName(row.offering),
    startsAt: primary.startsAt.toISOString(),
    endsAt: primary.endsAt.toISOString(),
    expiresAt: primary.expiresAt.toISOString(),
    additionalHeldSlots: Math.max(0, holds.length - 1),
  }
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
}): Promise<{ allowsOverlap: boolean }> {
  const conflicts = await findBookingAndHoldConflicts({
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
    now: args.now,
  })

  if (decision.ok) {
    // The pro said yes to a live checkout. Re-derive the label rather than
    // trusting the confirming request to echo back what it was shown — the log
    // has to record what was TRUE at the write, not what the caller claimed.
    const confirmedHeldSlot =
      decision.mode === 'PRO_CONFIRMED_HOLD_OVERLAP'
        ? await describeHeldSlotForPro({
            tx: args.tx,
            professionalId: args.requestedWindow.professionalId,
            conflicts: decision.conflicts,
            now: args.now,
          })
        : null

    logOverlapDecisionAuthorized({
      action: args.action,
      professionalId: args.requestedWindow.professionalId,
      locationId: args.locationId,
      locationType: args.locationType,
      requestedStart: args.requestedWindow.startsAt,
      requestedEnd: args.requestedWindow.endsAt,
      offeringId: args.offeringId,
      clientId: args.clientId,
      mode: decision.mode,
      conflicts: decision.conflicts,
      sourceKind: args.source.kind,
      actorKind: args.actor.kind,
      heldSlotRelationship: confirmedHeldSlot?.relationship ?? null,
    })

    // An authorized overlap (a PRO/ADMIN double-book) must be exempted from
    // the DB overlap EXCLUDE constraint, or the booking write hits a raw
    // 23P01. A no-conflict booking stays bound by the constraint
    // (allowsOverlap = false), preserving the durable no-double-book
    // guarantee against races and direct writes.
    return { allowsOverlap: decision.conflicts.length > 0 }
  }

  // Not a dead end — the pro has simply not been asked yet. Describe the hold
  // (and nothing more of the client behind it) so the caller can put the choice
  // in front of them; a second attempt carrying the confirmation takes the
  // `decision.ok` branch above and is logged as an informed choice.
  const heldSlot =
    decision.code === 'PRO_HOLD_DECISION_REQUIRED'
      ? await describeHeldSlotForPro({
          tx: args.tx,
          professionalId: args.requestedWindow.professionalId,
          conflicts: decision.conflicts,
          now: args.now,
        })
      : null

  logOverlapDecisionBlocked({
    action: args.action,
    professionalId: args.requestedWindow.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedWindow.startsAt,
    requestedEnd: args.requestedWindow.endsAt,
    offeringId: args.offeringId,
    clientId: args.clientId,
    holdId: heldSlot?.holdId ?? args.excludeHoldId ?? null,
    code: decision.code,
    conflictKinds: decision.conflicts.map((conflict) => conflict.kind),
    sourceKind: args.source.kind,
    actorKind: args.actor.kind,
    heldSlotRelationship: heldSlot?.relationship ?? null,
  })

  throw bookingError(
    mapBookingOverlapBlockedCodeToBookingError(decision.code),
    {
      message: decision.userMessage,
      userMessage: decision.userMessage,
      ...(heldSlot ? { heldSlot } : {}),
    },
  )
}
function logAndThrowStepMismatch(args: {
  action: BookingConflictAction
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
    action: args.action,
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
  action: BookingConflictAction
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
    action: args.action,
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
  action: BookingConflictAction
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
    action: args.action,
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
  action: BookingConflictAction
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
    action: args.action,
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
  action: BookingConflictAction
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
    action: args.action,
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

/**
 * The appointment length a pro-created booking actually reserves: the offering's
 * mode duration snapped to the pro's slot grid, plus every selected add-on, with
 * a caller-requested total honored only when it EXTENDS that — never below the
 * real service length.
 *
 * Shared by `performLockedCreateProBooking` and `createWaitlistOffer` so an
 * offer is validated against the exact window its confirm will book. Checking a
 * shorter window at offer time would clear working hours the real appointment
 * then overruns, which is the same offer/confirm asymmetry F5 closes.
 */
function resolveProBookingDurations(args: {
  baseDurationMinutes: number
  addOnsDurationMinutes: number
  requestedTotalDurationMinutes: number | null
  stepMinutes: number
}): {
  /** The base service alone, snapped to the grid — the BASE line item snapshot. */
  serviceDurationMinutes: number
  /** What the appointment reserves: base + add-ons, extended by a requested total. */
  totalDurationMinutes: number
} {
  const serviceDurationMinutes = clampInt(
    snapToStepMinutes(args.baseDurationMinutes, args.stepMinutes),
    args.stepMinutes,
    MAX_SLOT_DURATION_MINUTES,
  )

  const durationWithAddOns = clampInt(
    serviceDurationMinutes + args.addOnsDurationMinutes,
    serviceDurationMinutes,
    MAX_SLOT_DURATION_MINUTES,
  )

  const requested = args.requestedTotalDurationMinutes

  const totalDurationMinutes =
    requested != null &&
    requested >= durationWithAddOns &&
    requested <= MAX_SLOT_DURATION_MINUTES
      ? clampInt(
          snapToStepMinutes(requested, args.stepMinutes),
          durationWithAddOns,
          MAX_SLOT_DURATION_MINUTES,
        )
      : durationWithAddOns

  return { serviceDurationMinutes, totalDurationMinutes }
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
  /** See {@link EvaluateProSchedulingDecisionArgs.enforceStepGrid}. */
  enforceStepGrid: boolean
  /**
   * See {@link EvaluateProSchedulingDecisionArgs.deferBusyConflictsToOverlapPolicy}.
   * Required, not defaulted: `true` is only correct when the caller runs
   * `enforceBookingOverlapPolicy` immediately afterwards, and a caller that
   * doesn't would silently stop refusing double-books.
   */
  deferBusyConflictsToOverlapPolicy: boolean
  /**
   * What the caller was doing, for the `booking_conflict` trail. Not every
   * caller of this gate is creating a booking — a waitlist offer runs it to
   * decide whether a time is PROMISABLE — and an ops reader must be able to
   * tell those refusals apart from a real create that was turned away.
   */
  action: BookingConflictAction
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
    enforceStepGrid: args.enforceStepGrid,
    deferBusyConflictsToOverlapPolicy:
      args.deferBusyConflictsToOverlapPolicy,
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
        action: args.action,
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
        action: args.action,
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
        action: args.action,
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
        action: args.action,
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
        action: args.action,
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
        action: args.action,
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
        action: args.action,
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
        action: args.action,
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
        action: args.action,
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

function cancelActorRole(actor: CancelActor): Role | null {
  if (actor.kind === 'client') return Role.CLIENT
  if (actor.kind === 'pro') return Role.PRO
  if (actor.kind === 'admin') return Role.ADMIN
  // system → null: no human role. M1's late-capture path treats a null role as
  // UNKNOWN_CANCEL_PROVENANCE and pages rather than guessing a refund policy.
  return null
}

/** Maps a cancel actor to its lifecycle-contract actor (M8). */
function cancelActorToLifecycle(actor: CancelActor): LifecycleActor {
  switch (actor.kind) {
    case 'client':
      return 'CLIENT'
    case 'pro':
      return 'PRO'
    case 'admin':
      return 'ADMIN'
    case 'system':
      return 'SYSTEM'
  }
}

/**
 * Records a BookingStatus transition through the lifecycle contract (M8) — drift
 * telemetry (#724) plus strict-mode enforcement — and converts the strict-mode
 * `LifecycleViolationError` into a clean, client-facing `bookingError` so an
 * illegal transition (e.g. a client trying to cancel a started IN_PROGRESS
 * session, which the contract restricts to ADMIN) surfaces as a 4xx product
 * refusal rather than a raw 500. The drift event has already been emitted inside
 * `recordStatusTransition` before it threw, so observability is unaffected.
 *
 * Callers place this immediately before the status write so a refusal aborts the
 * write. Legal transitions are silent (the contract stays the single source of
 * truth — no policy is re-derived here).
 */
function recordStatusTransitionOrRefuse(args: {
  from: BookingStatus
  to: BookingStatus
  actor: LifecycleActor
  route: string
  bookingId?: string | null
  professionalId?: string | null
}): void {
  try {
    recordStatusTransition(args)
  } catch (err) {
    if (err instanceof LifecycleViolationError) {
      throw bookingError('BOOKING_STATUS_CHANGE_NOT_ALLOWED', {
        message: err.message,
      })
    }
    throw err
  }
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
      priorStatus: booking.status,
      meta: buildMeta(false),
    }
  }

  assertAllowedCancelStatus({
    booking,
    allowedStatuses: args.allowedStatuses,
  })

  // M8: run every cancel through the lifecycle contract. Legal cancels (human
  // from PENDING/ACCEPTED, ADMIN from IN_PROGRESS, SYSTEM auto-release) are
  // silent; an out-of-contract cancel (e.g. a client/pro cancelling a started
  // IN_PROGRESS session, or any NO_SHOW cancel) emits a #724 drift event and is
  // refused as a clean 4xx.
  recordStatusTransitionOrRefuse({
    from: booking.status,
    to: BookingStatus.CANCELLED,
    actor: cancelActorToLifecycle(args.actor),
    route: 'lib/booking/writeBoundary.ts:performLockedCancel',
    bookingId: booking.id,
    professionalId: booking.professionalId,
  })

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      status: BookingStatus.CANCELLED,
      sessionStep: SessionStep.NONE,
      startedAt: null,
      finishedAt: null,
      // Provenance for the late-capture refund path: a payment webhook landing
      // after this cancel re-runs the cancel refund policy, which is decided by
      // WHO cancelled and WHEN (see applyLateCaptureCancelRefund).
      cancelledAt: new Date(),
      cancelledByRole: cancelActorRole(args.actor),
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

  // K10-B-1: the scheduled pay-link nudge has NO drain-time revalidation, so a
  // cancel — every path lands here, including the deposit release sweep — must
  // stamp it cancelled. "Pay your deposit or the booking is released" after
  // the booking is gone is a lie. No-op for bookings without one.
  await cancelDepositPaymentNudgeDispatch({
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
    // The pre-transition status, read under the lock (§18.4) — the late-cancel
    // fee gate needs the status this cancel is moving AWAY from, not the new one.
    priorStatus: booking.status,
    meta: buildMeta(true),
  }
}

// ─── No-show / late-cancel fee (Phase 2 revenue protection) ──────────────────
//
// Marking a booking NO_SHOW is a pro-driven terminal transition (like cancel).
// The fee CHARGE cannot run inside this transaction (Stripe I/O), so the flow is
// two-phase, mirroring the checkout prepare→charge→record pattern:
//   1. markBookingNoShow — locked status transition to NO_SHOW.
//   2. assessAndChargeNoShowFee (lib/noShowProtection/charge.ts) — off-session
//      Stripe charge, then recordNoShowFeeCharge to persist the outcome.

export type MarkBookingNoShowResult = {
  booking: { id: string; status: BookingStatus }
  meta: MutationMeta
  /** True when the booking was already NO_SHOW (idempotent no-op). */
  alreadyNoShow: boolean
}

async function performLockedMarkNoShow(args: {
  tx: Prisma.TransactionClient
  now: Date
  bookingId: string
  professionalId: string
  actorUserId?: string | null
}): Promise<MarkBookingNoShowResult> {
  const booking = await loadBookingForCancel(args.tx, args.bookingId)

  if (booking.professionalId !== args.professionalId) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.status === BookingStatus.NO_SHOW) {
    return {
      booking: { id: booking.id, status: booking.status },
      meta: buildMeta(false),
      alreadyNoShow: true,
    }
  }

  if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
    throw bookingError('BOOKING_CANNOT_EDIT_COMPLETED')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED')
  }

  // A no-show is only meaningful for a confirmed-but-not-started appointment.
  if (booking.status !== BookingStatus.ACCEPTED) {
    throw bookingError('FORBIDDEN', {
      message: `Booking status ${booking.status} cannot be marked no-show.`,
      userMessage: 'Only confirmed appointments can be marked as a no-show.',
    })
  }

  recordStatusTransition({
    from: booking.status,
    to: BookingStatus.NO_SHOW,
    actor: 'PRO',
    route: 'lib/booking/writeBoundary.ts:markBookingNoShow',
    bookingId: booking.id,
    professionalId: args.professionalId,
  })

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      status: BookingStatus.NO_SHOW,
      sessionStep: SessionStep.NONE,
      startedAt: null,
      finishedAt: null,
      noShowMarkedAt: args.now,
    },
    select: { id: true, status: true } satisfies Prisma.BookingSelect,
  })

  await cancelBookingAppointmentReminders({
    tx: args.tx,
    bookingId: booking.id,
  })

  await bumpProfessionalScheduleVersion(booking.professionalId)

  return {
    booking: { id: updated.id, status: updated.status },
    meta: buildMeta(true),
    alreadyNoShow: false,
  }
}

/**
 * Pro (or admin-on-behalf) marks a confirmed booking as a no-show. Terminal
 * transition to BookingStatus.NO_SHOW under the professional's schedule lock.
 * Does NOT charge a fee — the caller runs assessAndChargeNoShowFee after this
 * commits (Stripe I/O can't live in the transaction).
 */
export async function markBookingNoShow(args: {
  bookingId: string
  professionalId: string
  actorUserId?: string | null
}): Promise<MarkBookingNoShowResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) =>
      performLockedMarkNoShow({
        tx,
        now,
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        actorUserId: args.actorUserId ?? null,
      }),
  )
}

/**
 * Persist the outcome of a no-show / late-cancel fee charge on the booking, and
 * notify the client when the card was actually charged. Ownership-scoped to the
 * professional. Idempotent: a booking already in NoShowFeeStatus.CHARGED is never
 * overwritten. This is the only Booking write for the fee — the charge itself is
 * performed by lib/noShowProtection/charge.ts, which calls this.
 */
export async function recordNoShowFeeCharge(args: {
  bookingId: string
  professionalId: string
  status: NoShowFeeStatus
  reason: NoShowFeeReason
  amount: Prisma.Decimal | null
  stripePaymentIntentId: string | null
  now?: Date
}): Promise<void> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)

  const now = args.now ?? new Date()

  await withLockedProfessionalTransaction(args.professionalId, async ({ tx }) => {
    const booking = await tx.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        noShowFeeStatus: true,
        // §12 NC1 #24: service + pro + date for the fee receipt.
        scheduledFor: true,
        locationTimeZone: true,
        service: { select: { name: true } },
        professional: {
          select: { timeZone: true, ...professionalPublicDisplayNameSelect },
        },
      },
    })

    if (!booking || booking.professionalId !== args.professionalId) {
      throw bookingError('BOOKING_NOT_FOUND')
    }

    // A prior success is authoritative; never clobber it.
    if (booking.noShowFeeStatus === NoShowFeeStatus.CHARGED) return

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        noShowFeeStatus: args.status,
        noShowFeeReason: args.reason,
        noShowFeeAmount: args.amount ?? undefined,
        noShowFeeStripePaymentIntentId: args.stripePaymentIntentId ?? undefined,
        noShowFeeChargedAt:
          args.status === NoShowFeeStatus.CHARGED ? now : undefined,
      },
      select: { id: true } satisfies Prisma.BookingSelect,
    })

    if (args.status === NoShowFeeStatus.CHARGED && args.amount) {
      const reasonLabel =
        args.reason === NoShowFeeReason.NO_SHOW
          ? 'a missed appointment'
          : 'cancelling late'
      const feeServiceLabel = booking.service?.name?.trim() || 'appointment'
      const feeProName = formatProfessionalPublicDisplayName(
        booking.professional,
      )
      const feeWhen = booking.scheduledFor
        ? ` on ${formatBookingDateLabel(
            booking.scheduledFor,
            resolveBookingDisplayTimeZone(booking),
          )}`
        : ''
      await createUpdateClientNotification({
        tx,
        clientId: booking.clientId,
        bookingId: booking.id,
        eventKey: NotificationEventKey.NO_SHOW_FEE_CHARGED,
        title: 'A fee was charged',
        body: `Your saved card was charged $${args.amount.toFixed(
          2,
        )} for ${reasonLabel} — your ${feeServiceLabel} with ${feeProName}${feeWhen}.`,
        dedupeKey: `NO_SHOW_FEE:${booking.id}`,
        href: `/client/bookings/${booking.id}?step=overview`,
        data: {
          reason: args.reason,
          amount: args.amount.toFixed(2),
        },
      })
    }
  })
}

/**
 * Tell the client their captured discovery deposit was kept because they were
 * marked a no-show (M15 POLICY follow-up). In this case no separate no-show fee is
 * charged — the kept deposit IS the penalty — so this is the client's only
 * disclosure of the no-show money outcome (the sibling of NO_SHOW_FEE_CHARGED).
 *
 * Ownership-scoped to the professional. Emits nothing unless the booking is
 * actually NO_SHOW with a PAID deposit (defensive — the caller only invokes this on
 * the suppression branch). Idempotent via the notification dedupeKey, so a repeat
 * assessment never double-notifies. Best-effort by contract: the caller wraps this
 * so a notification failure can never disturb the committed no-show.
 */
export async function recordNoShowDepositKept(args: {
  bookingId: string
  professionalId: string
}): Promise<void> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)

  await withLockedProfessionalTransaction(args.professionalId, async ({ tx }) => {
    const booking = await tx.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        status: true,
        depositStatus: true,
        depositAmount: true,
        scheduledFor: true,
        locationTimeZone: true,
        service: { select: { name: true } },
        professional: {
          select: { timeZone: true, ...professionalPublicDisplayNameSelect },
        },
      },
    })

    if (!booking || booking.professionalId !== args.professionalId) {
      throw bookingError('BOOKING_NOT_FOUND')
    }

    // Only a no-show that actually kept a captured deposit warrants the notice.
    if (
      booking.status !== BookingStatus.NO_SHOW ||
      booking.depositStatus !== BookingDepositStatus.PAID
    ) {
      return
    }

    const depositLabel = booking.depositAmount
      ? `$${booking.depositAmount.toFixed(2)} deposit`
      : 'deposit'
    const serviceLabel = booking.service?.name?.trim() || 'appointment'
    const proName = formatProfessionalPublicDisplayName(booking.professional)
    const when = booking.scheduledFor
      ? ` on ${formatBookingDateLabel(
          booking.scheduledFor,
          resolveBookingDisplayTimeZone(booking),
        )}`
      : ''

    await createUpdateClientNotification({
      tx,
      clientId: booking.clientId,
      bookingId: booking.id,
      eventKey: NotificationEventKey.NO_SHOW_DEPOSIT_KEPT,
      title: 'Your deposit was kept',
      body: `Your ${depositLabel} for your ${serviceLabel} with ${proName}${when} was kept because the appointment was marked as a no-show.`,
      dedupeKey: `NO_SHOW_DEPOSIT_KEPT:${booking.id}`,
      href: `/client/bookings/${booking.id}?step=overview`,
      data: {
        depositAmountCents: booking.depositAmount
          ? Math.round(Number(booking.depositAmount) * 100)
          : null,
      },
    })
  })
}

export type WaiveNoShowFeeResult = {
  status: NoShowFeeStatus
  meta: { mutated: boolean; noOp: boolean }
}

/**
 * Pro (or admin-on-behalf) forgives a no-show / late-cancel fee that was
 * assessed but never successfully collected. Only a fee currently in
 * NoShowFeeStatus.FAILED can be waived here: a CHARGED fee lives on its own
 * PaymentIntent and must be REFUNDED, not waived; a SKIPPED / absent fee has
 * nothing to forgive. Ownership-scoped to the professional and idempotent — a
 * fee already WAIVED is a no-op. No money moves; this only records the pro's
 * decision so the fee stops reading as outstanding.
 */
export async function waiveNoShowFee(args: {
  bookingId: string
  professionalId: string
}): Promise<WaiveNoShowFeeResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)

  return withLockedProfessionalTransaction(args.professionalId, async ({ tx }) => {
    const booking = await tx.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        id: true,
        professionalId: true,
        noShowFeeStatus: true,
      },
    })

    if (!booking || booking.professionalId !== args.professionalId) {
      throw bookingError('BOOKING_NOT_FOUND')
    }

    // Already forgiven — idempotent no-op.
    if (booking.noShowFeeStatus === NoShowFeeStatus.WAIVED) {
      return {
        status: NoShowFeeStatus.WAIVED,
        meta: { mutated: false, noOp: true },
      }
    }

    if (booking.noShowFeeStatus !== NoShowFeeStatus.FAILED) {
      throw bookingError('NO_SHOW_FEE_NOT_WAIVABLE')
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: { noShowFeeStatus: NoShowFeeStatus.WAIVED },
      select: { id: true } satisfies Prisma.BookingSelect,
    })

    return {
      status: NoShowFeeStatus.WAIVED,
      meta: { mutated: true, noOp: false },
    }
  })
}

/**
 * Reconcile a Stripe refund on the NO-SHOW / LATE-CANCEL FEE's own PaymentIntent
 * (M15 GAP B). The fee rides a charge distinct from the final bill and the
 * deposit, so a `charge.refunded` on the fee PI never matches
 * reconcileChargeRefundInTransaction (final-bill PI) or
 * reconcileDepositChargeRefundInTransaction (deposit PI) — and nothing else read
 * `noShowFeeStripePaymentIntentId`, so before this a refunded fee stayed CHARGED
 * forever. Mirrors the deposit reconcile: monotonic-max the cumulative refunded
 * cents (an out-of-order webhook can't roll it back), flip noShowFeeStatus to
 * REFUNDED only once the FULL fee charge is back (a sub-fee partial stays CHARGED
 * and only accumulates cents), and emit a refund receipt on any rise (an in-app
 * refund that already advanced the counter sees no rise and stays silent).
 *
 * Returns { handled: false } when no booking carries this fee PI (the caller then
 * falls through to the final-bill reconcile), so the three PI kinds stay disjoint.
 */
export async function reconcileNoShowFeeChargeRefundInTransaction(
  tx: Prisma.TransactionClient,
  args: {
    paymentIntentId: string
    amountRefundedCents: number
    chargeAmountCents: number
    now?: Date
  },
): Promise<{ handled: boolean }> {
  const booking = await tx.booking.findFirst({
    where: { noShowFeeStripePaymentIntentId: args.paymentIntentId },
    select: {
      id: true,
      noShowFeeStatus: true,
      noShowFeeRefundedCents: true,
    },
  })

  if (!booking) return { handled: false }

  // Stripe's `amount_refunded` is the authoritative CUMULATIVE refund on the fee
  // charge. Take a monotonic max so a stale (smaller) replay can't roll it back.
  const prevRefundedCents = booking.noShowFeeRefundedCents
  const nextRefundedCents = Math.max(prevRefundedCents, args.amountRefundedCents)

  // The fee charge is a single destination charge — the whole charge IS the fee
  // (unlike the deposit charge, which bundles the platform fee). So a full refund
  // is simply the cumulative refund reaching the charge amount. Only flip a still
  // -CHARGED fee: a WAIVED/SKIPPED/FAILED fee moved no money to refund, and an
  // already-REFUNDED fee stays REFUNDED (idempotent).
  const fullyRefunded =
    args.chargeAmountCents > 0 && nextRefundedCents >= args.chargeAmountCents
  const flipToRefunded =
    fullyRefunded && booking.noShowFeeStatus === NoShowFeeStatus.CHARGED

  await tx.booking.update({
    where: { id: booking.id },
    data: {
      noShowFeeRefundedCents: nextRefundedCents,
      ...(flipToRefunded ? { noShowFeeStatus: NoShowFeeStatus.REFUNDED } : {}),
    },
    select: { id: true } satisfies Prisma.BookingSelect,
  })

  // Notify on any rise in the cumulative refunded amount (each partial included).
  // The discriminator carries the new cumulative so a `charge.refunded` replay at
  // the same total dedupes.
  if (nextRefundedCents > prevRefundedCents) {
    await emitPaymentRefundedNotifications({
      tx,
      bookingId: booking.id,
      refundDiscriminator: buildAuxRefundDiscriminator({
        kind: 'no-show-fee',
        paymentIntentId: args.paymentIntentId,
        cumulativeRefundedCents: nextRefundedCents,
      }),
      amountRefundedCents: nextRefundedCents - prevRefundedCents,
    })
  }

  return { handled: true }
}

/**
 * Apply a dispute (chargeback) on the NO-SHOW / LATE-CANCEL FEE's own
 * PaymentIntent (M15 GAP B). Like the deposit dispute, the fee rides its own
 * charge, so a fee-PI dispute never matches applyStripeDisputeInTransaction
 * (final-bill PI) or applyStripeDepositDisputeInTransaction (deposit PI).
 * Resolves the booking by `noShowFeeStripePaymentIntentId` and records the freeze
 * on `noShowFeeDisputedAt`, which stops the money trail reading the fee as safely
 * collected and makes refundNoShowFee refuse to double-return it. Freeze
 * semantics + replay safety: see applyStripeAuxDisputeFreezeInTransaction (the
 * deposit dispute is its other caller — one rule, two PI fields).
 */
export async function applyStripeNoShowFeeDisputeInTransaction(
  tx: Prisma.TransactionClient,
  args: {
    feePaymentIntentId: string
    outcome: StripeDisputeOutcome
    now?: Date
  },
): Promise<{ bookingId: string } | null> {
  return applyStripeAuxDisputeFreezeInTransaction(tx, {
    kind: 'NO_SHOW_FEE',
    paymentIntentId: args.feePaymentIntentId,
    outcome: args.outcome,
    now: args.now,
  })
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
    throw bookingError('BOOKING_NOT_FOUND')
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
      select: BOOKING_SESSION_STATE_SELECT,
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
    select: BOOKING_SESSION_STATE_SELECT,
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

  // §12 NC3: no BOOKING_STARTED notification — the client is physically present
  // when the pro starts the session, so a "your appointment has started" push /
  // in-app row is redundant. The event key is retained (enum + channel policy)
  // but is no longer emitted.

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
    // Uniform 404 on a foreign booking — do not reveal it exists, and do not
    // leak "your own bookings" wording that would confirm ownership mismatch.
    throw bookingError('BOOKING_NOT_FOUND')
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
    select: BOOKING_SESSION_STATE_SELECT,
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
    throw bookingError('BOOKING_NOT_FOUND')
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

  await replaceBookingServiceItems(
    args.tx,
    booking.id,
    normalizedItems.map((item, index) => ({
      serviceId: item.serviceId,
      offeringId: item.offeringId,
      itemType: item.itemType,
      priceSnapshot: item.priceSnapshot,
      durationMinutesSnapshot: item.durationMinutesSnapshot,
      notes: item.notes,
      sortOrder: index,
    })),
  )

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
    // Unify with the missing-booking case (404) so a foreign booking is
    // indistinguishable from one that does not exist.
    return {
      ok: false,
      status: 404,
      error: 'Booking not found.',
      meta: buildMeta(false),
    }
  }

  if (isTerminalSessionBooking(booking.status, booking.finishedAt)) {
    return {
      ok: false,
      status: 409,
      // NO_SHOW is terminal too, so the old "completed/cancelled" copy named the
      // wrong reason for it.
      error: 'This booking is closed and can no longer be worked on.',
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
        select: BOOKING_SESSION_STATE_SELECT,
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
      select: BOOKING_SESSION_STATE_SELECT,
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
  /// The transaction's clock, used only to measure the post-closeout media
  /// grace window. Optional so the existing locked-transaction test harnesses
  /// (which hand the callback a `tx` alone) keep working; they run under fake
  /// timers, so the fallback is just as deterministic.
  now?: Date
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
  focalX?: number | null
  focalY?: number | null
  requestId?: string | null
  idempotencyKey?: string | null
}): Promise<UploadProBookingMediaResult> {
  const now = args.now ?? new Date()

  const booking: BookingMediaUploadRecord | null = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: BOOKING_MEDIA_UPLOAD_SELECT,
  })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.professionalId !== args.professionalId) {
    throw bookingError('BOOKING_NOT_FOUND')
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

  // A photo from the session being closed out may still be in flight when the
  // wrap-up lands. Both gates below have to know that, not just the first:
  // close-out sets `sessionStep = DONE` in the same write as `finishedAt`, and
  // DONE satisfies no phase, so relaxing only the status check would swap
  // BOOKING_CANNOT_EDIT_COMPLETED for STEP_MISMATCH and lose the photo anyway.
  const withinCloseoutGrace = isWithinPostCloseoutMediaGrace(booking.finishedAt, now)

  if (
    (booking.status === BookingStatus.COMPLETED || booking.finishedAt) &&
    !withinCloseoutGrace
  ) {
    throw bookingError('BOOKING_CANNOT_EDIT_COMPLETED', {
      message: 'This booking is completed. Media uploads are locked.',
      userMessage: 'This booking is completed. Media uploads are locked.',
    })
  }

  if (!withinCloseoutGrace && !canUploadBookingMediaPhase(booking.sessionStep, args.phase)) {
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
        primaryServiceId: booking.serviceId,
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

        focalX: args.focalX ?? null,
        focalY: args.focalY ?? null,

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
/**
 * The minutes a hold placed FOR A RESCHEDULE must reserve. Reads the booking
 * under the professional's schedule lock and runs the commit gate's own guard,
 * so what the hold promises is exactly what `rescheduleBookingFromHold` will
 * take.
 *
 * A booking that is missing and a booking owned by someone else return the SAME
 * `BOOKING_NOT_FOUND`, matching `lockClientOwnedBookingSchedule` — a client must
 * not learn that another client's booking exists from the shape of a refusal.
 */
async function resolveRescheduleHoldDurationMinutes(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  clientId: string
  offeringId: string
  professionalId: string
}): Promise<number> {
  const booking = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: RESCHEDULE_TARGET_SELECT,
  })

  if (!booking || booking.clientId !== args.clientId) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  // The commit re-checks this pair through `validateHoldForClientMutation`;
  // checking it here too means a mismatched hold is refused while the client can
  // still pick again, and — more importantly — that the width being reserved
  // belongs to THIS offering rather than some other booking of theirs.
  if (
    booking.professionalId !== args.professionalId ||
    booking.offeringId !== args.offeringId
  ) {
    throw bookingError('HOLD_MISMATCH', {
      message: 'Hold does not match the booking being rescheduled.',
      userMessage:
        'That time no longer matches this booking. Please pick a new slot.',
    })
  }

  return resolveRescheduleCommitDurationMinutes(booking).totalDurationMinutes
}

/**
 * Book the Look, B4 — the minutes a hold or a booking must reserve for a
 * consult's proposal, re-derived inside the caller's transaction.
 *
 * The width is the SUM of every estimate line's rounded duration, not the base
 * offering's default: the client is committing to the look, and a slot sized by
 * its one linked service is a lie about the pro's day (decision 11).
 *
 * Refuses rather than falling back. A REFUSED estimate, an analysis that routed
 * to safety prerequisites, or a mode the pro does not offer for one of the
 * lines all produce a typed refusal — there is no salon-priced consolation
 * number, and no base-offering-sized consolation slot.
 */
async function resolveConsultProposalForBookingCommit(args: {
  tx: Prisma.TransactionClient
  now: Date
  consultId: string
  clientId: string
  professionalId: string
  serviceCategoryId: string | null
  offeringId: string
  locationType: ServiceLocationType
  /**
   * Book the Look, B7. `'ALL'` from the HOLD, the client's own answer from the
   * FINALIZE. See `resolveConsultProposalForCommit` — the reservation is the
   * widest case on purpose, so the commit can only ever be narrower.
   */
  enhancementSelection: ConsultBookingProposalEnhancementSelection
}): Promise<ResolvedConsultProposal | null> {
  const resolved = await resolveConsultProposalForCommit(args.tx, {
    consultId: args.consultId,
    clientId: args.clientId,
    professionalId: args.professionalId,
    serviceCategoryId: args.serviceCategoryId,
    locationType: args.locationType,
    enhancementSelection: args.enhancementSelection,
    now: args.now,
  })

  if (!resolved.ok) {
    if (resolved.kind === 'HIDDEN') throw bookingError('CONSULT_NOT_FOUND')
    if (resolved.kind === 'INELIGIBLE') throw bookingError('CONSULT_UNAVAILABLE')
    // A BOOKING-anchored consult (the shipped #1016 mode) has nothing to
    // translate. `null` means "not a book-the-look commit" and the caller keeps
    // its ordinary sizing — it is not a refusal.
    if (resolved.kind === 'NOT_LOOK_ANCHORED') return null
    throw bookingError('CONSULT_PROPOSAL_UNAVAILABLE')
  }

  // The offering must be the proposal's FLOOR — the look's own linked service.
  // Re-pointing the booking at whatever was requested would silently book a
  // different service than the slot was sized for.
  if (resolved.proposal.floorOfferingId !== args.offeringId) {
    throw bookingError('CONSULT_PROPOSAL_OFFERING_MISMATCH')
  }

  return resolved.proposal
}

/**
 * The minutes a hold must RESERVE for a selection of add-ons: the same
 * `base + add-ons` arithmetic finalize commits to, resolved inside the caller's
 * transaction so the numbers cannot drift between the two.
 *
 * Throws `ADDONS_INVALID` on a selection finalize would also refuse, so an
 * unbookable combination is rejected while the client can still change it
 * rather than at the end of checkout.
 */
async function resolveHoldDurationWithAddOns(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  offeringId: string
  addOnIds: string[]
  locationType: ServiceLocationType
  baseDurationMinutes: number
}): Promise<number> {
  const resolved = await resolveDurationWithAddOns({
    professionalId: args.professionalId,
    offeringId: args.offeringId,
    addOnIds: args.addOnIds,
    locationType: args.locationType,
    baseDurationMinutes: args.baseDurationMinutes,
    client: args.tx,
  })

  if (!resolved.ok) {
    throw bookingError(resolved.code, {
      message: 'One or more add-ons are invalid for this offering.',
      userMessage: 'One or more add-ons are no longer available.',
    })
  }

  return resolved.durationMinutes
}

async function performLockedCreateHold(args: {
  tx: Prisma.TransactionClient
  now: Date
  clientId: string
  bookingEntryPoint: ProBookingEntryPoint
  addOnIds: string[]
  rescheduleBookingId: string | null
  consultId: string | null
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
    addOnIds,
    rescheduleBookingId,
    consultId,
    offering,
    requestedStart,
    requestedLocationId,
    locationType,
    clientAddressId,
  } = args

  // A reschedule keeps the booking's original add-ons — they are already inside
  // the committed width this hold will be sized to. Accepting both would mean
  // silently ignoring one of them, and the one ignored decides how much time is
  // reserved, so refuse instead of picking a winner.
  if (rescheduleBookingId && addOnIds.length > 0) {
    throw bookingError('ADDONS_INVALID', {
      message: 'Add-ons cannot be changed while rescheduling a booking.',
      userMessage:
        'Add-ons can’t be changed while moving this appointment. Pick a new time first.',
    })
  }

  // Book the Look, B4. Same reasoning as the reschedule refusal above, for the
  // same reason: two sources want to decide how much time is reserved, and
  // silently ignoring one of them is worse than refusing.
  //
  // 🔴 B7 did NOT lift this, and the reason is worth writing down because the
  // slice's name suggests otherwise. Decision 10's "add-ons as recommendations"
  // is answered by the ESTIMATE, not by the pro's `OfferingAddOn` catalog: an
  // enhancement is a beyond-floor estimate line the client can decline
  // (`ConsultBookingProposalEnhancementSelection`), phrased by the analysis's
  // own reason and priced from her menu by the same derivation as every other
  // line. An `OfferingAddOn` is something the PRO pinned to one offering — not
  // AI-recommended, and any add-on service the analysis DOES recommend and that
  // is on her menu is already a beyond-floor line. So the two remain mutually
  // exclusive, and a consult booking's extras ride `consultEnhancementLineIds`.
  if (consultId && addOnIds.length > 0) {
    throw bookingError('ADDONS_INVALID', {
      message: 'Add-ons cannot be combined with a consultation proposal.',
      userMessage:
        'Add-ons can’t be chosen for a consultation booking. Your pro will go through extras with you.',
    })
  }

  if (consultId && rescheduleBookingId) {
    throw bookingError('CONSULT_UNAVAILABLE', {
      message: 'A consultation proposal cannot reschedule an existing booking.',
      userMessage: 'Please move that appointment from the booking itself.',
    })
  }

  await assertProfessionalIsBookingReady({
    tx,
    professionalId: offering.professionalId,
    bookingEntryPoint,
  })

  // K16: this pro's policy for this client. Refuses BEFORE any slot is reserved,
  // so a blocked client never takes calendar time from the pro who blocked them.
  //
  // 🔴 A RESCHEDULE is exempt. `rescheduleBookingId` means the appointment
  // already exists and the pro already agreed to it; refusing here would strand
  // a confirmed booking and 400 the Reschedule button inside K12's own reminder
  // link. The switch stops NEW appointments (Tori, 2026-07-31) — and the exempt
  // path is the reason this check reads the argument rather than sitting one
  // level up in `createHold`, where both callers look identical.
  if (!rescheduleBookingId) {
    await assertClientMaySelfServeBook({
      tx,
      professionalId: offering.professionalId,
      clientId,
    })
  }

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

  // Reserve what the COMMIT will take, not what the offering currently says.
  //
  // Three different commits, so three different widths (B1-A + B3 + B4):
  //  - finalize takes `base + add-ons` → size from the selection;
  //  - reschedule takes the BOOKING's committed `totalDurationMinutes`, which
  //    drifts from the offering's base whenever the pro edits a duration;
  //  - a consult proposal takes the whole ESTIMATE — every line's rounded
  //    duration — because the client is booking the look, not the one service
  //    the look happens to be linked to.
  // All three are resolved through the very helper the commit site runs, inside
  // this transaction, so none can drift from what it promised.
  const durationMinutes = rescheduleBookingId
    ? await resolveRescheduleHoldDurationMinutes({
        tx,
        bookingId: rescheduleBookingId,
        clientId,
        offeringId: offering.id,
        professionalId: offering.professionalId,
      })
    : consultId
      ? (
          await resolveConsultProposalForBookingCommit({
            tx,
            now,
            consultId,
            clientId,
            professionalId: offering.professionalId,
            serviceCategoryId: offering.serviceCategoryId ?? null,
            offeringId: offering.id,
            locationType,
            // 🔴 B7: the widest thing this booking could become. The client
            // opts into enhancements on the REVIEW step, after this
            // reservation exists — so it must already cover every one of them,
            // and her opting in then fills space that is already held rather
            // than asking for more. Under-reserving here is the duration miss
            // decision 11 is about; over-reserving for a few minutes is not.
            enhancementSelection: 'ALL',
          })
        )?.totalDurationMinutes ??
        // A booking-anchored consult carries no proposal; the hold is sized the
        // ordinary way. `addOnIds` is empty here — the refusal above forbids
        // combining the two — so this is exactly the base width.
        (await resolveHoldDurationWithAddOns({
          tx,
          professionalId: offering.professionalId,
          offeringId: offering.id,
          addOnIds,
          locationType,
          baseDurationMinutes: validatedContextResult.durationMinutes,
        }))
      : await resolveHoldDurationWithAddOns({
          tx,
          professionalId: offering.professionalId,
          offeringId: offering.id,
          addOnIds,
          locationType,
          baseDurationMinutes: validatedContextResult.durationMinutes,
        })

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
    // A reschedule may legitimately overlap the slot it is vacating — the
    // commit already allows it, so the reservation must too (B3-B).
    excludeBookingId: rescheduleBookingId,
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
    // Marks this reservation as sized from a BOOKING rather than the offering,
    // so the add-on re-size path refuses it instead of recomputing it back down
    // to the offering's width (B3).
    rescheduleBookingId,
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
        durationMinutes: hold.durationMinutesSnapshot ?? durationMinutes,
      },
      meta: buildMeta(true),
    }
  } catch (error: unknown) {
    // P2002 = exact-start unique collision; 23P01 = overlapping-range GIST
    // EXCLUDE backstop (BookingHold_no_active_professional_overlap). Both mean
    // another hold/booking won the slot under the schedule lock; surface a clean
    // TIME_HELD conflict rather than a 500.
    const isExactStartCollision =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    const isOverlapCollision = isExclusionConstraintError(
      error,
      HOLD_OVERLAP_CONSTRAINT_NAME,
    )

    if (isExactStartCollision || isOverlapCollision) {
      const conflictKind = isExactStartCollision
        ? 'exact_start'
        : 'overlap_range'

            afterHoldInsertMs = Date.now()
      afterScheduleVersionMs = afterHoldInsertMs

      logHoldCreateTiming(
        buildHoldCreateTiming('p2002_conflict', {
          prismaCode: isExactStartCollision ? 'P2002' : '23P01',
          conflictKind,
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
          prismaCode: isExactStartCollision ? 'P2002' : '23P01',
          conflictKind,
        },
      })

      // A 23P01 here is the hold-side twin of logOverlapBackstopFired's
      // reasoning: expired holds were swept under this same lock before the
      // insert, so the GIST backstop refusing what the hold gate allowed is a
      // gate or lock regression — page it like the five booking-side catches
      // do. The P2002 exact-start collision stays log-only: different
      // constraint, same clean refusal, no gate implicated.
      if (isOverlapCollision) {
        captureOverlapBackstopFired({
          action: 'HOLD_CREATE',
          professionalId: offering.professionalId,
          requestedStart,
          requestedEnd,
          constraint: HOLD_OVERLAP_CONSTRAINT_NAME,
        })
      }

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

async function performLockedUpdateHoldAddOns(args: {
  tx: Prisma.TransactionClient
  now: Date
  hold: HoldOwnershipRecord
  addOnIds: string[]
}): Promise<UpdateHoldAddOnsResult> {
  const { tx, now, addOnIds } = args

  // A waitlist offer's reservation (F14) belongs to the PRO who chose that time,
  // not to the client — the same reasoning releaseHold refuses on.
  if (args.hold.waitlistOfferId) {
    throw bookingError('HOLD_FORBIDDEN', {
      message: 'Hold belongs to a waitlist offer.',
      userMessage: 'This reserved time cannot be changed here.',
    })
  }

  // A reschedule's reservation is sized from the BOOKING's committed width; this
  // path recomputes width from the OFFERING plus the posted selection, which
  // would narrow it straight back to the under-reservation B3 fixed. `addOnIds:
  // []` is a request the add-ons page already sends on every load, so this is
  // reachable by accident, not only by a crafted call — refuse rather than
  // silently shrink what the reschedule is going to commit.
  if (args.hold.rescheduleBookingId) {
    throw bookingError('HOLD_FORBIDDEN', {
      message: 'Hold reserves an existing booking’s duration.',
      userMessage:
        'Add-ons can’t be changed while moving this appointment. Pick a new time first.',
    })
  }

  const hold = await tx.bookingHold.findUnique({
    where: { id: args.hold.id },
    select: UPDATE_HOLD_ADDONS_SELECT,
  })

  if (!hold) {
    throw bookingError('HOLD_NOT_FOUND')
  }

  if (hold.expiresAt.getTime() <= now.getTime()) {
    throw bookingError('HOLD_EXPIRED')
  }

  const offering = await tx.professionalServiceOffering.findUnique({
    where: { id: hold.offeringId },
    select: UPDATE_HOLD_ADDONS_OFFERING_SELECT,
  })

  if (!offering || !offering.isActive) {
    throw bookingError('OFFERING_NOT_FOUND')
  }

  // Resolved exactly as finalize resolves it, from the HELD placement — same
  // location, same timezone, same buffers — so the window measured here is the
  // window finalize will measure.
  const validatedContextResult = await resolveValidatedBookingContext({
    tx,
    professionalId: hold.professionalId,
    requestedLocationId: hold.locationId,
    locationType: hold.locationType,
    holdLocationTimeZone: hold.locationTimeZone,
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
    mapSchedulingReadinessFailure(validatedContextResult.error)
  }

  const locationContext = validatedContextResult.context

  const durationMinutes = await resolveHoldDurationWithAddOns({
    tx,
    professionalId: hold.professionalId,
    offeringId: hold.offeringId,
    addOnIds,
    locationType: hold.locationType,
    baseDurationMinutes: validatedContextResult.durationMinutes,
  })

  const requestedStart = normalizeToMinute(new Date(hold.scheduledFor))

  const buildResult = (
    endsAt: Date,
    mutated: boolean,
  ): UpdateHoldAddOnsResult => ({
    hold: {
      id: hold.id,
      scheduledFor: hold.scheduledFor,
      expiresAt: hold.expiresAt,
      durationMinutes,
      endsAt,
    },
    professionalId: hold.professionalId,
    meta: buildMeta(mutated),
  })

  // Already the right size: nothing to widen, nothing to re-check. Returning
  // early keeps a repeated sync (a re-mounted page, a retried request) from
  // re-running the gate against a schedule that may have moved on.
  const storedEndsAt = hold.endsAtSnapshot

  if (
    hold.durationMinutesSnapshot === durationMinutes &&
    hold.bufferMinutesSnapshot === locationContext.bufferMinutes &&
    storedEndsAt != null &&
    Number.isFinite(storedEndsAt.getTime())
  ) {
    return buildResult(storedEndsAt, false)
  }

  // The EXCLUDE constraint covers expired rows too (it cannot read now()), so a
  // stale expired hold could refuse a widen that is genuinely free. Sweep first,
  // exactly as hold creation does under this same lock.
  await deleteExpiredHoldsForProfessional({
    tx,
    professionalId: hold.professionalId,
    now,
  })

  const decision = await evaluateFinalizeDecision({
    tx,
    now,
    professionalId: hold.professionalId,
    holdId: hold.id,
    requestedStart,
    durationMinutes,
    bufferMinutes: locationContext.bufferMinutes,
    locationId: locationContext.locationId,
    locationType: hold.locationType,
    workingHours: locationContext.workingHours,
    timeZone: locationContext.timeZone,
    stepMinutes: locationContext.stepMinutes,
    advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
    maxDaysAhead: locationContext.maxDaysAhead,
    fallbackTimeZone: 'UTC',
  })

  if (!decision.ok) {
    if (decision.logHint) {
      logFinalizePolicyFailure({
        professionalId: hold.professionalId,
        locationId: locationContext.locationId,
        locationType: hold.locationType,
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

  try {
    await tx.bookingHold.update({
      where: { id: hold.id },
      data: {
        durationMinutesSnapshot: durationMinutes,
        bufferMinutesSnapshot: locationContext.bufferMinutes,
        endsAtSnapshot: requestedEnd,
      },
      select: { id: true } satisfies Prisma.BookingHoldSelect,
    })
  } catch (error: unknown) {
    // The GIST backstop refusing what the commit gate just allowed is a gate or
    // lock regression, not an ordinary race — page it like the create path does.
    if (isExclusionConstraintError(error, HOLD_OVERLAP_CONSTRAINT_NAME)) {
      captureOverlapBackstopFired({
        action: 'HOLD_ADDONS_UPDATE',
        professionalId: hold.professionalId,
        requestedStart,
        requestedEnd,
        constraint: HOLD_OVERLAP_CONSTRAINT_NAME,
      })

      throw bookingError('TIME_HELD')
    }

    throw error
  }

  return buildResult(requestedEnd, true)
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
    throw bookingError('BOOKING_NOT_FOUND')
  }

  // The same guard the HOLD ran when it sized this reservation, so the width
  // reserved and the width committed cannot disagree (B3).
  const { totalDurationMinutes, offeringId: bookingOfferingId } =
    resolveRescheduleCommitDurationMinutes(booking)

  const bookingOffering = await args.tx.professionalServiceOffering.findUnique({
    where: { id: bookingOfferingId },
    select: RESCHEDULE_BOOKING_OFFERING_SELECT,
  })

  if (!bookingOffering) {
    throw bookingError('OFFERING_NOT_FOUND')
  }

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
    expectedOfferingId: bookingOfferingId,
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

  // K12: a time move resets the client-confirmation loop. The client's answer
  // was to the OLD instant — carrying "Client confirmed" (or "Declined") onto a
  // different time would report an answer nobody gave. Cleared to NOT_REQUESTED
  // (all three timestamps), so the re-synced reminder below re-asks for the new
  // time. No-op when only location details changed.
  const rescheduleMovedStart =
    newStart.getTime() !==
    normalizeToMinute(new Date(booking.scheduledFor)).getTime()

  // A CLIENT moving a booking that is ALREADY inside the cancellation window is
  // a late change, and carries the same standing a late cancel does: no auto
  // refund and a forfeited deposit on any later cancel of this booking (both
  // read the stamp in lib/booking/cancelRefund), plus the late-change fee the
  // route charges post-commit.
  //
  // Measured against where the booking sits NOW, before this update — the whole
  // exploit is that moving it rewrites the column the refund rules read.
  // Location-only edits are exempt: nothing about the pro's short-notice slot
  // changed, so `rescheduleMovedStart` gates it.
  //
  // Deliberately NOT conditioned on the booking already carrying a stamp. A
  // client who moves late twice has cost the pro two short-notice slots, so the
  // second move is every bit as much a late change as the first — suppressing it
  // here would quietly under-report. The stamp is refreshed to the latest late
  // move; the refund rules only test for presence, and whether a SECOND fee can
  // actually be charged is owned by assessAndChargeNoShowFee's own per-booking
  // idempotency, which is the right place for that question.
  const previousScheduledFor = booking.scheduledFor
  const lateChangeApplied =
    rescheduleMovedStart &&
    isInsideClientCancellationWindow({
      scheduledFor: previousScheduledFor,
      now: args.now,
    })

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      scheduledFor: newStart,
      ...(lateChangeApplied ? { lateChangeAt: args.now } : {}),
      ...(rescheduleMovedStart
        ? {
            clientConfirmationRequestedAt: null,
            clientConfirmedAt: null,
            clientConfirmationDeclinedAt: null,
          }
        : {}),
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
    lateChangeApplied,
    previousScheduledFor,
    meta: buildMeta(true),
  }
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
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.professionalId !== args.professionalId) {
    throw bookingError('BOOKING_NOT_FOUND')
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

  // Rebuilt from the OFFERING CATALOG, not from the durations the pro typed
  // into the proposal form. Shared with the propose route since F12 so both
  // sides of the consultation compute the same end time — see
  // lib/consultation/proposalSchedule.ts.
  const {
    proposedItems,
    normalizedItems,
    primaryServiceId,
    primaryOfferingId,
    computedDurationMinutes,
    computedSubtotal,
  } = await resolveConsultationMaterialization({
    tx: args.tx,
    professionalId: booking.professionalId,
    locationType: booking.locationType,
    proposedServicesJson: approval.proposedServicesJson,
  })

  const extension = consultationExtensionWindow({
    scheduledFor: booking.scheduledFor,
    previousDurationMinutes: booking.totalDurationMinutes,
    bufferMinutes: booking.bufferMinutes,
    materializedDurationMinutes: computedDurationMinutes,
  })

  const materializedEnd = extension.materializedEnd

  // A CALENDAR BLOCK is not a collision the pro can absorb by working through
  // it — it is time they explicitly declared unavailable, and blocks are fatal
  // on every other write path in the repo (never override-gated, unlike working
  // hours).
  //
  // Only the EXTENSION window is probed, never the original booking window —
  // see consultationExtensionWindow for why.
  //
  // This runs BEFORE the service-item rewrite: the refusal rolls back either
  // way, but there is no reason to spend the writes only to undo them.
  //
  // Since F12 the PROPOSE route runs this same probe, so a proposal that would
  // land here should already have been refused to the pro. This stays: the
  // block can appear in the gap between proposing and approving, and this is
  // the side holding the lock.
  if (extension.extendsAppointment) {
    const blocked = await hasCalendarBlockConflict({
      tx: args.tx,
      professionalId: booking.professionalId,
      locationId: booking.locationId,
      requestedStart: extension.extensionStart,
      requestedEnd: materializedEnd,
    })

    if (blocked) {
      throw bookingError('TIME_BLOCKED', {
        message: `Consultation extension runs into blocked time. bookingId=${booking.id}`,
        userMessage:
          'These services run into time your pro has blocked off. Ask them to update the proposal.',
        // The catalog default is PICK_NEW_SLOT, which is right in the booking
        // flow and meaningless here: the client is approving services on an
        // appointment already underway and has no slot to pick. The pro amends
        // the proposal (or clears the block); the client just retries.
        uiAction: 'NONE',
      })
    }
  }

  await replaceBookingServiceItems(
    args.tx,
    booking.id,
    normalizedItems.map((item, index) => ({
      serviceId: item.serviceId,
      offeringId: item.offeringId,
      itemType: item.itemType,
      priceSnapshot: item.priceSnapshot,
      durationMinutesSnapshot: item.durationMinutesSnapshot,
      notes:
        item.itemType === BookingServiceItemType.ADD_ON
          ? 'CONSULTATION_APPROVED'
          : null,
      sortOrder: index,
    })),
  )

  const checkoutRollup = await buildBookingCheckoutRollupUpdate({
    tx: args.tx,
    bookingId: booking.id,
    nextServiceSubtotal: computedSubtotal,
  })

  // The agreed services can extend the booking past its original window. The
  // pro authored the proposal knowing the appointment is underway, so a
  // collision with a later BOOKING OR HOLD is a pro-authorized overlap: mark
  // allowsOverlap so the duration update clears the DB EXCLUDE constraint
  // instead of failing the approval, and leave the pro to manage the collision
  // on their calendar. allowsOverlap is only ever raised here, never reset.
  const extensionConflicts = await findBookingAndHoldConflicts({
    tx: args.tx,
    professionalId: booking.professionalId,
    startsAt: booking.scheduledFor,
    endsAt: materializedEnd,
    excludeHoldId: null,
    excludeBookingId: booking.id,
    now: args.now,
  })

  // Working hours are deliberately NOT re-checked here. The actor on all three
  // decision routes is the CLIENT, mid-appointment, and OUTSIDE_WORKING_HOURS
  // is override-gated for the PRO everywhere else in the repo
  // (lib/booking/overridePrompts.ts) — there is nobody on this path who can
  // grant that override, so enforcing it would dead-end a live in-person
  // approval with no way forward. Running past your own closing time is the
  // pro's call and the pro authored the proposal. The check belongs at
  // proposal time, where the pro is authenticated and present; see F12 in
  // docs/design/scheduling-conflict-audit-fix-plan.md.

  const updatedBooking = await args.tx.booking
    .update({
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
        ...(extensionConflicts.all.length > 0 ? { allowsOverlap: true } : {}),
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
    .catch((error: unknown) => {
      // 23P01: the DB overlap EXCLUDE rejected the duration growth. All three
      // decision routes DO hold the per-professional advisory lock, so this is
      // the durable backstop firing on a case the runtime probe above missed
      // (e.g. a conflicting row this booking must not overlap), not an
      // unlocked write. Surface a clean conflict, not a 500.
      if (isExclusionConstraintError(error, BOOKING_OVERLAP_CONSTRAINT_NAME)) {
        logOverlapBackstopFired({
          action: 'BOOKING_UPDATE',
          professionalId: booking.professionalId,
          locationId: booking.locationId,
          locationType: booking.locationType,
          requestedStart: booking.scheduledFor,
          requestedEnd: materializedEnd,
          bookingId: booking.id,
          clientId: booking.clientId,
        })
        throw bookingError('TIME_BOOKED')
      }
      throw error
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
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.professionalId !== args.professionalId) {
    throw bookingError('BOOKING_NOT_FOUND')
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

/**
 * The ADD_ON `bookingServiceItem` rows a freshly-resolved add-on selection
 * persists. Shared by the client-finalize and pro-create paths, which both map
 * the same `ResolvedBookingAddOn[]` (from `resolveBookingAddOns`) onto line items
 * hanging off the base item: `offeringId` null, the OfferingAddOn link recorded in
 * `notes` as `ADDON:<id>`, `sortOrder` after the base.
 *
 * NOT used by the aftercare-rebook path — that clones the source booking's
 * already-materialized items (offeringId preserved, no ADDON note), a different
 * shape (see `performLockedCreateRebookedBooking`).
 */
function buildResolvedAddOnServiceItemRows(args: {
  bookingId: string
  parentItemId: string
  addOns: ResolvedBookingAddOn[]
}): Prisma.BookingServiceItemCreateManyInput[] {
  return args.addOns.map((addOn, index) => ({
    bookingId: args.bookingId,
    serviceId: addOn.serviceId,
    offeringId: null,
    itemType: BookingServiceItemType.ADD_ON,
    parentItemId: args.parentItemId,
    priceSnapshot: addOn.priceSnapshot,
    durationMinutesSnapshot: addOn.durationMinutesSnapshot,
    sortOrder: index + 1,
    notes: `ADDON:${addOn.offeringAddOnId}`,
  }))
}

/**
 * The consult (if any) to stamp on a booking being finalized.
 *
 * The permission itself lives in `lib/consult/commitScope.ts` — the hold now
 * asks the same question, to size its slot by the consult's proposal before any
 * booking exists, and a second spelling of a permission is how a new door ends
 * up with none of the controls the old one applies. This function is the
 * booking vocabulary around that one answer: which refusal code a client sees.
 */
async function resolveFinalizeConsultAttribution(args: {
  tx: Prisma.TransactionClient
  now: Date
  consultId: string | null
  clientId: string
  professionalId: string
  serviceCategoryId: string | null
}): Promise<string | null> {
  if (!args.consultId) return null

  const scope = await resolveConsultCommitScope(args.tx, {
    consultId: args.consultId,
    clientId: args.clientId,
    professionalId: args.professionalId,
    serviceCategoryId: args.serviceCategoryId,
    now: args.now,
  })

  if (!scope.ok) {
    // Ownership, tenant, vertical and founder-gate misses stay
    // indistinguishable; only an ineligible anchor names itself.
    throw bookingError(
      scope.hidden ? 'CONSULT_NOT_FOUND' : 'CONSULT_UNAVAILABLE',
    )
  }

  return scope.session.id
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
  /** B7 — see `FinalizeBookingFromHoldArgs.consultEnhancementLineIds`. */
  consultEnhancementLineIds: string[]
  locationType: ServiceLocationType
  source: BookingSource
  consultId: string | null
  initialStatus: BookingStatus
  rebookOfBookingId: string | null
  fallbackTimeZone: string
  offering: FinalizeBookingFromHoldArgs['offering']
  discovery: FinalizeBookingFromHoldArgs['discovery']
  cancellationPolicySnapshot: CancellationPolicySnapshot | null
  cancellationPolicyAcceptedAt: Date | null
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

  const sourceConsultSessionId = await resolveFinalizeConsultAttribution({
    tx: args.tx,
    now: args.now,
    consultId: args.consultId,
    clientId: args.clientId,
    professionalId: args.offering.professionalId,
    serviceCategoryId: args.offering.serviceCategoryId ?? null,
  })

  // K16: the card-on-file requirement is enforced HERE and not at hold creation,
  // on purpose. Refusing at the hold would cost the client their slot while they
  // go and save a card; refusing at finalize leaves the hold standing, so the
  // inline add-card step can complete and retry inside the same hold window.
  //
  // 🔴 It runs AFTER the idempotency replay above. A booking that already exists
  // must keep returning itself: re-refusing a completed finalize because the
  // client later deleted their card would turn a successful booking into an
  // error on retry.
  //
  // 🔴 AFTERCARE is exempt, and this is not a loophole — it is the same rule the
  // deposit already follows one floor down. `source: AFTERCARE` reaches this
  // function ONLY through the unauthenticated aftercare-token branch of
  // POST /api/v1/bookings/finalize (that branch refuses without a token), and a
  // token-flow client has no session, so `POST /api/v1/client/payment-methods/
  // setup-intent` — which calls requireClient() — 401s for them. Enforcing here
  // would refuse the rebook and hand them an add-card step that cannot work:
  // a requirement with no means of compliance
  // ([[offered-option-must-be-an-accepted-write]]). `resolveDiscoveryFinalize`
  // stamps no deposit on this same path for exactly this reason (K10-A-2); a pro
  // who wants this client gated has `blockSelfServeBooking`, which DOES cover
  // aftercare rebooks.
  if (args.source !== BookingSource.AFTERCARE) {
    await assertClientCardOnFileSatisfied({
      tx: args.tx,
      professionalId: args.offering.professionalId,
      clientId: args.clientId,
    })
  }

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

  const resolvedAddOns = await resolveBookingAddOns({
    client: args.tx,
    professionalId: args.offering.professionalId,
    offeringId: args.offering.id,
    addOnIds: args.addOnIds,
    locationType: args.locationType,
  })

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

  // Book the Look, B4. Resolved HERE rather than beside the attribution stamp
  // above so it reads the hold's own validated mode: `args.locationType` is
  // checked against the hold by `validateHoldForClientMutation`, and the
  // proposal's prices and durations are mode-specific, so the mode it is
  // derived for must be the one the slot was actually held in.
  //
  // Null for a booking-anchored consult (#1016), which has nothing to
  // translate — that path keeps its ordinary sizing untouched.
  const consultProposal = sourceConsultSessionId
    ? await resolveConsultProposalForBookingCommit({
        tx: args.tx,
        now: args.now,
        consultId: sourceConsultSessionId,
        clientId: args.clientId,
        professionalId: args.offering.professionalId,
        serviceCategoryId: args.offering.serviceCategoryId ?? null,
        offeringId: args.offering.id,
        locationType: validatedHold.value.locationType,
        // 🔴 B7: exactly what she ticked, and nothing else. The HOLD was sized
        // for 'ALL', so this set is always a subset of the reserved width —
        // that is the one direction this asymmetry may ever run.
        enhancementSelection: args.consultEnhancementLineIds,
      })
    : null

  // `OfferingAddOn` add-ons on top of a consult proposal stay refused; the hold
  // refuses the combination too, and this is the commit-site half of that same
  // rule. B7's enhancements are proposal LINES, not add-ons — see the hold's
  // refusal for why the two did not merge.
  if (consultProposal && resolvedAddOns.length > 0) {
    throw bookingError('ADDONS_INVALID', {
      message: 'Add-ons cannot be combined with a consultation proposal.',
      userMessage:
        'Add-ons can’t be chosen for a consultation booking. Your pro will go through extras with you.',
    })
  }

  // 🔴 A consult proposal sizes the slot by its own LINES — the floor plus the
  // enhancements the client opted into (B7) — not by the base offering. It is
  // deliberately NOT clamped:
  // `deriveConsultBookingProposal` refuses past MAX_SLOT_DURATION_MINUTES rather
  // than shortening, because a silently truncated appointment is exactly the
  // duration miss decision 11 protects against. The clamp below still governs
  // every other client finalize, where the client can shrink her own selection.
  const totalDurationMinutes =
    consultProposal?.totalDurationMinutes ??
    clampInt(
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

  const overlapDecision = await enforceBookingOverlapPolicy({
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

  // Server-validated discovery context: stamp provenance always; when this is a
  // fee-eligible new discovery client, compute the deposit + one-time platform fee
  // from the service subtotal. The deposit + fee are collected up front at checkout
  // (see prepareClientStripeCheckoutSession), so we record them here as PENDING.
  const discoveryProvenance =
    args.discovery?.provenance ?? BookingDiscoveryProvenance.UNKNOWN

  // The deposit and the platform fee are two independent gates (K10-A): the
  // deposit follows the pro's depositScope and — since K10 — the base
  // offering's per-service prepay requirement; the fee stays new-via-discovery
  // only. A booking can owe one without the other.
  //
  // The prepay term is sized against `lastMinuteTotal`, the amount the client
  // is actually billed, NOT the undiscounted subtotal the ordinary deposit uses:
  // 100% has to mean exactly the bill, or `coversTotal` is false on every
  // prepaid booking with a last-minute discount and closeout opens a session for
  // the difference.
  const discoveryPlan =
    args.discovery &&
    (args.discovery.depositRequirement.required || args.discovery.feeEligible)
      ? computeDiscoveryDepositPlan({
          depositCents: computeUpfrontDepositCents({
            scopeDepositRequired: args.discovery.depositRequirement.scopeRequired,
            settings: args.discovery.depositSettings,
            serviceSubtotalCents: Math.round(Number(subtotal) * 100),
            prepayScope: args.discovery.depositRequirement.prepayScope,
            baseServiceCents: Math.round(Number(chargedBasePrice) * 100),
            bookingTotalCents: Math.round(Number(lastMinuteTotal) * 100),
          }),
          feeEligible: args.discovery.feeEligible,
          feesEnabled: args.discovery.feesEnabled,
          proFeeWaived: args.discovery.proFeeWaived,
        })
      : null

  const hasUpfrontCharge =
    discoveryPlan != null && discoveryPlan.totalUpfrontCents > 0

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
        allowsOverlap: overlapDecision.allowsOverlap,
        source: args.source,
        sourceConsultSessionId,
        // Book the Look, B4 provenance: WHICH derivation of that consult
        // produced these lines and this slot width. Stamped at the write, where
        // the answer is known ([[nothing-stored-says-who-created-a-booking]]);
        // null for every booking that did not come from a proposal.
        sourceConsultServiceEstimateId: consultProposal?.estimateId ?? null,
        discoveryProvenance,
        // K5 snapshot: derived by the resolver alongside provenance (same
        // established-booking count as the fee), stamped once here, never at
        // read time. UNKNOWN only if a future caller skips the resolver.
        clientRelationshipLabel:
          args.discovery?.relationshipLabel ?? ClientRelationshipLabel.UNKNOWN,
        // Remix attribution: the validated look this booking was started from.
        sourceLookPostId: args.discovery?.sourceLookPostId ?? null,
        depositStatus: hasUpfrontCharge
          ? BookingDepositStatus.PENDING
          : BookingDepositStatus.NONE,
        depositAmount: hasUpfrontCharge
          ? new Prisma.Decimal(discoveryPlan.depositCents).div(100)
          : null,
        // K10-B: the release deadline is STAMPED at creation (same arithmetic
        // the sweep used to run at sweep time), so a later env-knob change
        // cannot move it under this booking.
        depositDueAt: hasUpfrontCharge
          ? computeDiscoveryDepositDueAt(new Date())
          : null,
        // Both fees are stamped together — the client's convenience fee (what the
        // customer is billed on top of the deposit) and the pro's $5 (taken out of
        // their payout). They are the measurement record as well as the charge
        // instruction: checkout, refunds and the relationship-establishment query
        // all read back from these columns rather than re-deriving policy.
        discoveryFeeAmount: hasUpfrontCharge
          ? discoveryPlan.clientFeeCents
          : null,
        proDiscoveryFeeAmount: hasUpfrontCharge
          ? discoveryPlan.proFeeCents
          : null,
        proDiscoveryFeeWaived: hasUpfrontCharge
          ? discoveryPlan.proFeeWaived
          : false,
        locationType: args.locationType,
        rebookOfBookingId: args.rebookOfBookingId,
        creationIdempotencyKey: args.idempotencyKey ?? null,
        // Cancellation-policy consent (M15): the agreed terms snapshot + when the
        // client agreed. Both null unless an interactive client accepted a
        // chargeable no-show/late-cancel policy at the confirm step.
        cancellationPolicySnapshot:
          args.cancellationPolicySnapshot ?? Prisma.JsonNull,
        cancellationPolicyAcceptedAt: args.cancellationPolicyAcceptedAt,
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

    // 23P01: the DB overlap EXCLUDE constraint rejected the insert — a real
    // conflict the app check missed (a race against a concurrent booking). Map
    // to a clean domain error instead of leaking a raw Prisma 500.
    if (isExclusionConstraintError(error, BOOKING_OVERLAP_CONSTRAINT_NAME)) {
      logOverlapBackstopFired({
        action: 'BOOKING_FINALIZE',
        professionalId: hold.professionalId,
        locationId: hold.locationId,
        locationType: hold.locationType,
        requestedStart: hold.scheduledFor,
        requestedEnd,
        holdId: hold.id,
        offeringId: hold.offeringId,
        clientId: args.clientId,
      })
      throw bookingError('TIME_NOT_AVAILABLE')
    }

    throw error
  }

  // Book the Look, B4: the record of what this client committed to, beside the
  // booking and inside the same transaction. Written BEFORE the service item so
  // that a booking carrying `sourceConsultServiceEstimateId` never exists in a
  // committed state without the proposal that explains it.
  //
  // 🔴 The base service item below stays the FLOOR offering at the floor's own
  // charged price. The beyond-floor lines size the slot and the "Starting at"
  // figure the client was shown, but they are not BookingServiceItem rows: they
  // are not add-ons she selected, and the pro sets the real total in the chair
  // (decision 8, B6). The proposal row is where those lines live meanwhile, so
  // nothing about the number she agreed to is lost.
  if (consultProposal) {
    await persistConsultBookingProposal(args.tx, {
      bookingId: created.id,
      proposal: consultProposal,
    })
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
      data: buildResolvedAddOnServiceItemRows({
        bookingId: created.id,
        parentItemId: baseItem.id,
        addOns: resolvedAddOns,
      }),
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

  // Auto-accepted client finalize is itself the confirmation moment. Pending
  // requests receive the invitation later through the shared
  // BOOKING_CONFIRMED notification wrapper when the professional accepts.
  if (created.status === BookingStatus.ACCEPTED) {
    await maybeCreateAiConsultInvitation({
      tx: args.tx,
      bookingId: created.id,
      clientId: args.clientId,
      now: args.now,
    })
  }

  // M5: nudge the client to finish an unpaid discovery deposit before the
  // auto-release sweep frees the slot. No-ops for non-deposit bookings.
  await scheduleDepositReminderOnBooking({
    tx: args.tx,
    bookingId: created.id,
    now: new Date(),
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
  /**
   * Whether this pro had NO established relationship with the client at the
   * moment they wrote this booking (lib/clients/proClientRelationship.ts).
   * Stamped onto the row; `proClientVisibilityWhere` excludes stamped rows, so
   * the appointment is real but it is not chart consent.
   *
   * 🔴 Deliberately REQUIRED, with no default. Every door into this function
   * has to state its answer out loud: an optional flag defaulting to false is
   * how the next pro-booking path silently re-opens the hole this closed.
   */
  proCreatedWithoutRelationship: boolean
  offeringId: string
  addOnIds?: string[]
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
  // K10-B: see CreateProBookingArgs.depositRequested.
  depositRequested?: boolean
  // K18 recurring appointments. Set ONLY by the series materializer. Their
  // presence is what makes the occurrence unattended for overlap purposes — see
  // the source derivation below — so they are deliberately not two independent
  // knobs a caller can half-set.
  seriesId?: string | null
  seriesOccurrenceIndex?: number | null
  // A client confirming a pro-authored time (waitlist offer) is still a CLIENT
  // for overlap purposes: a conflict must refuse, never silently double-book.
  overlapActor?: BookingOverlapActor
  /**
   * Whether THIS create can stop and ask the pro about a live client hold.
   * Required, no default — see `ProLiveHoldOverlapStance`. Ignored when
   * `overlapActor` names a CLIENT.
   */
  proLiveHoldOverlap: ProLiveHoldOverlapStance
}): Promise<CreateProBookingResult> {
  const importMode = args.importMode ?? false

  // K18: a series occurrence is materialized with nobody looking at this slot —
  // the pro chose a PATTERN, and K20's cron re-runs it unattended. That changes
  // the overlap verdict (see the source derivation below) and suppresses the
  // per-occurrence "you're booked" notification for the follow-on appointments.
  const seriesId = args.seriesId ?? null
  const seriesOccurrenceIndex = seriesId == null ? null : args.seriesOccurrenceIndex ?? 0
  const isSeriesFollowOnOccurrence = seriesId != null && (seriesOccurrenceIndex ?? 0) > 0

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
      ? loadClientServiceAddress({
          tx: args.tx,
          clientId: args.clientId,
          clientAddressId: args.clientAddressId,
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
  //
  // K20: a LATER occurrence of a standing appointment is booked at what
  // occurrence 0 was booked at, not at today's catalog — see
  // lib/booking/series/pinnedPrice.ts for the decision and its cost. Derived
  // from occurrence 0's own line items inside this transaction, so no caller can
  // inject a price. Null (no occurrence 0 to read) falls back to resolution.
  const seriesPinnedPrices =
    !importMode && isSeriesFollowOnOccurrence && seriesId != null
      ? await loadSeriesPinnedPrices({ tx: args.tx, seriesId })
      : null

  let chargedUnitPrice: Prisma.Decimal
  if (importMode) {
    chargedUnitPrice = zeroMoney()
  } else if (seriesPinnedPrices) {
    chargedUnitPrice = seriesPinnedPrices.baseUnitPrice
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

  // Selected add-ons (OfferingAddOn links) fold their price into the service
  // subtotal and their duration into the appointment length below; each persists
  // as an ADD_ON line item under the base. The availability slot the pro picked
  // already reserved this same folded duration. Imports/waitlist reuse pass none.
  const currentAddOns = await resolveBookingAddOns({
    client: args.tx,
    professionalId: args.professionalId,
    offeringId: offering.id,
    addOnIds: args.addOnIds ?? [],
    locationType: args.locationType,
  })
  // K20: the pin covers the add-on lines too — a series priced at $120 must not
  // become $140 because one add-on's catalog price moved. DURATION is never
  // pinned: it comes from today's resolution because the reserved window and the
  // persisted length have to agree with the calendar, not with a promise.
  const resolvedAddOns = seriesPinnedPrices
    ? currentAddOns.map((addOn) => {
        const pinned = seriesPinnedPrices.addOnPriceByLinkId.get(
          addOn.offeringAddOnId,
        )
        return pinned ? { ...addOn, priceSnapshot: pinned } : addOn
      })
    : currentAddOns
  const addOnsPriceTotal = resolvedAddOns.reduce(
    (acc, addOn) => acc.add(addOn.priceSnapshot),
    new Prisma.Decimal(0),
  )
  const addOnsDurationTotal = resolvedAddOns.reduce(
    (sum, addOn) => sum + addOn.durationMinutesSnapshot,
    0,
  )
  const serviceSubtotal = chargedUnitPrice.add(addOnsPriceTotal)

  // K10-B: the pro-requested deposit/prepay step. Resolved — and on any
  // impossibility REFUSED, never silently dropped — before a single row is
  // written: the pro asked for prepay, so creating a booking that cannot carry
  // or deliver one would be an offer the app won't honor. Amount comes from
  // the pro's own deposit settings + the offering's prepayScope through the
  // same money path as discovery (max of the two terms, prepay capped at the
  // bill), never from the request.
  const depositRequested = !importMode && (args.depositRequested ?? false)
  let requestedDeposit: { amount: Prisma.Decimal; dueAt: Date } | null = null
  if (depositRequested) {
    const depositRecipientEmail = pickFirstNonEmpty(
      client.email,
      client.user?.email ?? null,
    )
    const depositRecipientPhone = pickFirstNonEmpty(
      client.phone,
      client.user?.phone ?? null,
    )

    if (!depositRecipientEmail && !depositRecipientPhone) {
      throw bookingError('FORBIDDEN', {
        message:
          'Deposit requested but the client has no email or phone to receive the pay link.',
        userMessage:
          'This client needs an email or phone number before a deposit can be requested.',
      })
    }

    const paymentSettings =
      await args.tx.professionalPaymentSettings.findUnique({
        where: { professionalId: args.professionalId },
        select: {
          depositEnabled: true,
          depositType: true,
          depositFlatAmount: true,
          depositPercent: true,
          stripeAccountId: true,
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
        },
      })

    const proStripeReady = Boolean(
      paymentSettings?.stripeAccountId &&
        paymentSettings?.stripeChargesEnabled &&
        paymentSettings?.stripePayoutsEnabled,
    )

    if (!paymentSettings || !proStripeReady) {
      throw bookingError('FORBIDDEN', {
        message: 'Deposit requested but the pro cannot receive a deposit charge.',
        userMessage:
          'Deposits are available once your Stripe payouts are set up.',
      })
    }

    const depositSettings: DepositSettings = {
      depositEnabled: paymentSettings.depositEnabled,
      depositType: paymentSettings.depositType,
      depositFlatAmountCents:
        paymentSettings.depositFlatAmount == null
          ? null
          : Math.round(Number(paymentSettings.depositFlatAmount) * 100),
      depositPercent: paymentSettings.depositPercent ?? null,
    }

    const subtotalCents = Math.round(Number(serviceSubtotal) * 100)
    const depositCents = computeUpfrontDepositCents({
      // The pro's explicit request replaces the scope test (provenance rules
      // are for self-serve flows): the account-wide term applies whenever the
      // pro has one configured at all.
      scopeDepositRequired: depositSettings.depositEnabled,
      settings: depositSettings,
      serviceSubtotalCents: subtotalCents,
      prepayScope: offering.prepayScope,
      baseServiceCents: Math.round(Number(chargedUnitPrice) * 100),
      bookingTotalCents: subtotalCents,
    })

    // Below the Stripe minimum there is nothing chargeable — a pro with no
    // deposit configuration and no prepay-required service has no amount to
    // collect, and pretending otherwise strands the booking PENDING forever.
    if (depositCents < STRIPE_MIN_CHARGE_CENTS) {
      throw bookingError('FORBIDDEN', {
        message:
          'Deposit requested but the computed amount is below the chargeable minimum — no deposit settings or prepay requirement apply.',
        userMessage:
          'Set a deposit amount in your payment settings (or mark this service prepay-required) before requesting a deposit.',
      })
    }

    requestedDeposit = {
      amount: new Prisma.Decimal(depositCents).div(100),
      dueAt: computeProCreatedDepositDueAt({
        createdAt: args.now,
        scheduledFor: requestedStart,
      }),
    }
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

  // The appointment reserves the base service plus every selected add-on. A
  // requested total may only extend it further, never below the real length.
  const { serviceDurationMinutes: computedDurationMinutes, totalDurationMinutes } =
    resolveProBookingDurations({
      baseDurationMinutes,
      addOnsDurationMinutes: addOnsDurationTotal,
      requestedTotalDurationMinutes: args.requestedTotalDurationMinutes,
      stepMinutes,
    })

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
    // Pro-created appointments (incl. the ICS import) own the minute.
    enforceStepGrid: false,
    action: 'BOOKING_CREATE',
    // enforceBookingOverlapPolicy runs immediately below and owns the
    // booking/hold verdict (a pro may intentionally double-book).
    deferBusyConflictsToOverlapPolicy: true,
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

  const overlapDecision = await enforceBookingOverlapPolicy({
    tx: args.tx,
    actor: args.overlapActor ?? {
      kind: 'PRO',
      userId: args.actorUserId,
      professionalId: args.professionalId,
      // An import / a series occurrence never reaches the PRO branch at all
      // (their SOURCE refuses on any conflict, above), so this only ever speaks
      // for the interactive dashboard create — which is exactly where the pro
      // can be shown the decision. Threaded from the caller rather than
      // defaulted here: the type has no default, so a new caller is asked.
      liveHoldOverlap: args.proLiveHoldOverlap,
    },
    // An import is machine-driven with no human at the slot, so it must not
    // inherit the pro's authority to double-book (see
    // decideBookingOverlapPermission). importMode is already threaded here, so
    // the source is derived rather than plumbed through another parameter.
    //
    // K18 rides the same rule for the same reason: a recurring occurrence has no
    // human at THIS slot on THIS date either, so it is refused on a conflict and
    // the materializer records a skip. Derived from seriesId rather than passed
    // in, so a caller cannot ask for a series booking that keeps the pro's
    // authority to double-book.
    source: importMode
      ? { kind: 'CALENDAR_IMPORT' }
      : seriesId != null
        ? { kind: 'SERIES_MATERIALIZATION' }
        : { kind: 'PRO_CREATED' },
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
        // See the arg's doc: ACCEPTED here means "the pro put it in the book",
        // never "the client agreed to share their record".
        proCreatedWithoutRelationship: args.proCreatedWithoutRelationship,
        allowsOverlap: overlapDecision.allowsOverlap,
        source: importMode ? BookingSource.IMPORTED : BookingSource.DISCOVERY,
        // K5 snapshot: UNKNOWN for both branches — imported history and
        // pro-created rows (dashboard create, waitlist-offer + consultation
        // materialization ride this path) are never guessed. The DISCOVERY in
        // `source` above is only the column default, not a real signal.
        clientRelationshipLabel: deriveClientRelationshipLabel({
          source: importMode ? BookingSource.IMPORTED : BookingSource.DISCOVERY,
          establishedBookingCount: 0,
          proCreated: !importMode,
        }),
        creationIdempotencyKey: args.idempotencyKey ?? null,

        // K18: series membership. Null for every ordinary booking, so the
        // unique (seriesId, seriesOccurrenceIndex) pair constrains only
        // occurrences.
        seriesId,
        seriesOccurrenceIndex,

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
        subtotalSnapshot: serviceSubtotal,
        serviceSubtotalSnapshot: serviceSubtotal,
        productSubtotalSnapshot: zeroMoney(),
        tipAmount: zeroMoney(),
        taxAmount: zeroMoney(),
        discountAmount: zeroMoney(),
        totalAmount: serviceSubtotal,
        // K10-B: the pro-requested deposit rides the standard deposit rail
        // (PENDING → paid via Stripe → credited at closeout). depositDueAt is
        // the STAMPED release deadline the sweep keys on.
        depositStatus: requestedDeposit
          ? BookingDepositStatus.PENDING
          : BookingDepositStatus.NONE,
        depositAmount: requestedDeposit?.amount ?? null,
        depositDueAt: requestedDeposit?.dueAt ?? null,
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

    // 23P01: DB overlap EXCLUDE rejected the insert (race the app check missed).
    if (isExclusionConstraintError(error, BOOKING_OVERLAP_CONSTRAINT_NAME)) {
      logOverlapBackstopFired({
        action: 'BOOKING_CREATE',
        professionalId: args.professionalId,
        locationId: args.locationId,
        locationType: args.locationType,
        requestedStart: args.scheduledFor,
        requestedEnd: schedulingDecision.requestedEnd,
        offeringId: args.offeringId,
        clientId: args.clientId,
      })
      throw bookingError('TIME_BOOKED')
    }

    throw error
  }

    const baseServiceItem = await args.tx.bookingServiceItem.create({
    data: {
      bookingId: booking.id,
      serviceId: offering.serviceId,
      offeringId: offering.id,
      itemType: BookingServiceItemType.BASE,
      priceSnapshot: chargedUnitPrice,
      durationMinutesSnapshot: computedDurationMinutes,
      sortOrder: 0,
    },
    select: { id: true },
  })

  // Persist each selected add-on as an ADD_ON line item hanging off the base
  // (offeringId null; the source link is recorded in `notes` as ADDON:<id>),
  // mirroring the client finalize path so both booking origins share one shape.
  if (resolvedAddOns.length) {
    await args.tx.bookingServiceItem.createMany({
      data: buildResolvedAddOnServiceItemRows({
        bookingId: booking.id,
        parentItemId: baseServiceItem.id,
        addOns: resolvedAddOns,
      }),
    })
  }

// Imported bookings are silent: the migrated client has no account yet, so we
// don't send a confirmation or schedule appointment reminders.
if (!importMode) {
  // §12 NC1 #3+4: unified "you're booked with {pro} for {service} on {date} at
  // {time}" copy, shared with every other confirm path. Read unconditionally —
  // the deposit pay-link block below also names the professional from it.
  const confirmMeta = await args.tx.booking.findUnique({
    where: { id: booking.id },
    select: {
      scheduledFor: true,
      locationTimeZone: true,
      service: { select: { name: true } },
      professional: {
        select: { timeZone: true, ...professionalPublicDisplayNameSelect },
      },
    },
  })

  // K18: creating a standing appointment is ONE act of booking, so the client
  // gets one confirmation — the first occurrence's — not twelve identical
  // "you're booked" pushes inside a second. Every occurrence still schedules its
  // own appointment reminders below and appears in the client's own list, so
  // nothing is hidden; only the duplicate announcement is suppressed. K19 owns
  // the series-level copy that names the pattern ("every other Friday, 9am").
  if (!isSeriesFollowOnOccurrence) {
    const confirmedCopy = buildBookingConfirmedClientCopy({
      proName: formatProfessionalPublicDisplayName(confirmMeta?.professional),
      serviceName: confirmMeta?.service?.name ?? offering.service.name,
      scheduledFor: confirmMeta?.scheduledFor ?? null,
      timeZone: confirmMeta
        ? resolveBookingDisplayTimeZone(confirmMeta)
        : DEFAULT_TIME_ZONE,
    })
    await createUpdateClientNotification({
      tx: args.tx,
      clientId: args.clientId,
      bookingId: booking.id,
      eventKey: NotificationEventKey.BOOKING_CONFIRMED,
      title: confirmedCopy.title,
      body: confirmedCopy.body,
      dedupeKey: `BOOKING_CONFIRMED:${booking.id}`,
      href: `/client/bookings/${booking.id}?step=overview`,
      data: {
        bookingId: booking.id,
        notificationReason: 'BOOKING_CONFIRMED',
        bookingReason: 'PRO_BOOKED_APPOINTMENT',
      },
    })
  }

  await syncBookingAppointmentReminders({
    tx: args.tx,
    bookingId: booking.id,
  })

  // K10-B: deliver the secure pay link (EMAIL/SMS — the client is often
  // unclaimed and cannot use the login-gated deposit surface) and schedule the
  // pre-release nudge. Both write rows on this tx, so a refused create can
  // never have sent a pay link.
  if (requestedDeposit) {
    await scheduleDepositReminderOnBooking({
      tx: args.tx,
      bookingId: booking.id,
      now: args.now,
      reminderLeadHours: depositProCreatedReminderLeadHours(),
    })

    await createDepositPaymentDelivery({
      tx: args.tx,
      professionalId: args.professionalId,
      clientId: args.clientId,
      bookingId: booking.id,
      depositAmountLabel: formatMoneyFromUnknown(requestedDeposit.amount),
      depositDueAt: requestedDeposit.dueAt,
      locationTimeZone: locationContext.timeZone,
      // The link stays payable through the appointment: when the appointment
      // arrives before the deadline the sweep never fires, and the client can
      // still settle the deposit up to (and at) the chair.
      expiresAt: new Date(
        Math.max(
          requestedDeposit.dueAt.getTime(),
          booking.scheduledFor.getTime(),
        ),
      ),
      // K10-B-1: an UNCLAIMED client can't use the login-gated DEPOSIT_REMINDER
      // (no in-app inbox, email suppressed on the unverified destination, no
      // SMS channel), so their pre-release nudge is a second scheduled dispatch
      // of this same pay link, at the same instant the reminder computes.
      // Claimed clients keep the reminder alone — two nudges at one instant
      // would double-message the same ask.
      nudgeRunAt: client.userId
        ? null
        : computeDepositReminderRunAt({
            depositDueAt: requestedDeposit.dueAt,
            scheduledFor: booking.scheduledFor,
            now: args.now,
            reminderLeadHours: depositProCreatedReminderLeadHours(),
          }),
      recipientEmail: pickFirstNonEmpty(client.email, client.user?.email ?? null),
      recipientPhone: pickFirstNonEmpty(client.phone, client.user?.phone ?? null),
      preferredContactMethod: inferPreferredContactMethod({
        email: pickFirstNonEmpty(client.email, client.user?.email ?? null),
        phone: pickFirstNonEmpty(client.phone, client.user?.phone ?? null),
        existingPreference: client.preferredContactMethod,
      }),
      issuedByUserId: args.actorUserId,
      recipientUserId: client.userId ?? null,
      recipientTimeZone: locationContext.timeZone,
      professionalName:
        formatProfessionalPublicDisplayName(confirmMeta?.professional) || null,
    })
  }
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
    subtotalSnapshot: serviceSubtotal,
    stepMinutes,
    appointmentTimeZone: locationContext.timeZone,
    locationId: locationContext.locationId,
    locationType: args.locationType,
    clientAddressId:
      args.locationType === ServiceLocationType.MOBILE && clientAddress
        ? clientAddress.id
        : null,
    serviceName: offering.service.name || 'Appointment',
    deposit: requestedDeposit,
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
  gate: args.gate,
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

  // Booked-at-save model: the summary's slot already IS a live appointment. A
  // client confirm at that exact instant replays it below; any other time must
  // not mint a second booking — the client reschedules the real one instead.
  if (args.clientId && args.aftercareId) {
    const liveRebooked = source.aftercareSummary?.rebookedBooking
    if (
      liveRebooked &&
      liveRebooked.status !== BookingStatus.CANCELLED &&
      liveRebooked.status !== BookingStatus.NO_SHOW &&
      liveRebooked.scheduledFor.getTime() !== requestedStart.getTime()
    ) {
      throw bookingError('FORBIDDEN', {
        message: 'Next appointment already booked from this aftercare.',
        userMessage:
          'Your next appointment is already booked. Manage it from your appointments.',
      })
    }
  }

    const existingRebook = await args.tx.booking.findFirst({
    where: {
      rebookOfBookingId: source.id,
      clientId: source.clientId,
      professionalId: source.professionalId,
      scheduledFor: requestedStart,
      // A cancelled/no-show rebook never satisfies "already rebooked" — a
      // fresh booking at the same time must be creatable after a cancel.
      status: { notIn: [BookingStatus.CANCELLED, BookingStatus.NO_SHOW] },
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
    // The BASE item (index 0) never legally snapshots at 0 — only an ADD_ON
    // can be an instant/retail item, so only add-ons get the exact-zero
    // exception `clonedItemDurationMinutes` carries. A corrupt BASE snapshot
    // still falls back to 60, exactly as before.
    durationMinutesSnapshot:
      index === 0
        ? normalizePositiveDurationMinutes(item.durationMinutesSnapshot) ?? 60
        : clonedItemDurationMinutes(item.durationMinutesSnapshot),
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

  // The shared width function — the availability offer (day slots, open-slot
  // counts under `rebookOfBookingId`) runs the same math, so the offer can't
  // promise a width this commit won't take
  // ([[promise-site-runs-the-commit-site-gate]]).
  const totalDurationMinutes = computeRebookCloneDurationMinutes({
    serviceItems: items,
    totalDurationMinutes: source.totalDurationMinutes,
  })

  const bufferMinutes = clampInt(
    Number(source.bufferMinutes ?? 0),
    0,
    MAX_BUFFER_MINUTES,
  )

  // Optional client-chosen location override (e.g. rebooking a mobile visit as
  // in-salon from the public aftercare link). When it differs from the source
  // booking's mode, re-resolve price/duration/location from the live offering
  // instead of cloning the original. Restricted to single-service rebooks so
  // there are no add-ons to re-price.
  const effectiveLocationType =
    args.requestedLocationType ?? source.locationType
  const isLocationOverride = effectiveLocationType !== source.locationType

  if (isLocationOverride && items.length > 1) {
    throw bookingError('INVALID_SERVICE_ITEMS', {
      message: 'Cannot switch location type for a multi-item rebook.',
      userMessage: 'Switching in-person/mobile isn’t available for this booking.',
    })
  }

  const overrideOffering = isLocationOverride
    ? await args.tx.professionalServiceOffering.findUnique({
        where: { id: primary.offeringId },
        select: {
          offersInSalon: true,
          offersMobile: true,
          salonDurationMinutes: true,
          mobileDurationMinutes: true,
          salonPriceStartingAt: true,
          mobilePriceStartingAt: true,
        },
      })
    : null

  if (isLocationOverride && !overrideOffering) {
    throw bookingError('OFFERING_NOT_FOUND')
  }

  // The pro-picked address stored on the aftercare proposal slot. Only trusted
  // when this create is confirming that exact aftercare (same guard as the
  // preselected-slot overlap permission below) — the direct pro-rebook path
  // carries no aftercareId and keeps cloning the source booking's address.
  const proposalClientAddressId =
    args.aftercareId && source.aftercareSummary?.id === args.aftercareId
      ? (source.aftercareSummary.rebookSlot?.clientAddressId ?? null)
      : null

  // Address for a MOBILE rebook, by precedence: the client's explicit choice
  // (public aftercare link — e.g. a SALON original rebooked as mobile), then
  // the address the pro picked when proposing the slot, then (downstream) the
  // source booking's address clone. The clientId + SERVICE_ADDRESS scoped load
  // enforces ownership; coordinates and radius are validated in
  // assertMobileBookingWithinRadius below.
  const requestedClientAddressId =
    effectiveLocationType === ServiceLocationType.MOBILE
      ? (normalizeReason(args.requestedClientAddressId) ??
        proposalClientAddressId)
      : null

  const requestedClientAddress = requestedClientAddressId
    ? await loadClientServiceAddress({
        tx: args.tx,
        clientId: source.clientId,
        clientAddressId: requestedClientAddressId,
      })
    : null

  if (requestedClientAddressId && !requestedClientAddress) {
    throw bookingError('CLIENT_SERVICE_ADDRESS_INVALID', {
      message:
        'Requested client service address was not found or is not owned by this client.',
      userMessage: 'Please choose a valid saved service address.',
    })
  }

  const validatedContextResult = await resolveValidatedBookingContext({
    tx: args.tx,
    professionalId: source.professionalId,
    requestedLocationId: isLocationOverride ? null : source.locationId,
    locationType: effectiveLocationType,
    holdLocationTimeZone: null,
    professionalTimeZone: source.professional?.timeZone ?? null,
    fallbackTimeZone: source.professional?.timeZone ?? DEFAULT_TIME_ZONE,
    requireValidTimeZone: true,
    allowFallback: isLocationOverride,
    requireCoordinates: false,
    offering:
      isLocationOverride && overrideOffering
        ? {
            offersInSalon: overrideOffering.offersInSalon,
            offersMobile: overrideOffering.offersMobile,
            salonDurationMinutes: overrideOffering.salonDurationMinutes,
            mobileDurationMinutes: overrideOffering.mobileDurationMinutes,
            salonPriceStartingAt: overrideOffering.salonPriceStartingAt,
            mobilePriceStartingAt: overrideOffering.mobilePriceStartingAt,
          }
        : {
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

  // When switching modes, the chosen mode's offering price/duration become the
  // source of truth (mobile and in-salon legitimately differ). Otherwise keep
  // the cloned snapshots from the original booking.
  const effectiveTotalDurationMinutes = isLocationOverride
    ? clampInt(
        validatedContextResult.durationMinutes,
        15,
        MAX_SLOT_DURATION_MINUTES,
      )
    : totalDurationMinutes

  const effectiveSubtotalSnapshot = isLocationOverride
    ? new Prisma.Decimal(validatedContextResult.priceStartingAt)
    : subtotalSnapshot

  await assertMobileBookingWithinRadius({
    tx: args.tx,
    professionalId: source.professionalId,
    locationType: effectiveLocationType,
    // Switching modes re-resolves the location, so the source booking's
    // snapshot (the OTHER mode's coordinates) must not shadow it — mirrors the
    // locationLat/LngSnapshot writes on the created booking below.
    locationLat: isLocationOverride
      ? decimalToNumber(locationContext.lat)
      : decimalToNumber(source.locationLatSnapshot) ??
        decimalToNumber(locationContext.lat),
    locationLng: isLocationOverride
      ? decimalToNumber(locationContext.lng)
      : decimalToNumber(source.locationLngSnapshot) ??
        decimalToNumber(locationContext.lng),
    clientAddressId:
      effectiveLocationType === ServiceLocationType.MOBILE
        ? requestedClientAddress?.id ?? source.clientAddressId
        : null,
    // A completed mobile booking whose saved ClientAddress was later deleted
    // keeps its address snapshot on the Booking row (onDelete: SetNull nulls
    // only the FK). Treat that preserved snapshot as a valid destination so the
    // client can still confirm the pro's proposed next appointment instead of
    // dead-ending on CLIENT_SERVICE_ADDRESS_REQUIRED with no way to re-enter it.
    hasSnapshotAddress:
      effectiveLocationType === ServiceLocationType.MOBILE &&
      !requestedClientAddress &&
      (source.clientAddressSnapshot != null ||
        source.encryptedClientAddressSnapshotJson != null),
    clientLat:
      effectiveLocationType === ServiceLocationType.MOBILE
        ? requestedClientAddress
          ? decimalToNumber(requestedClientAddress.lat)
          : decimalToNumber(source.clientAddressLatSnapshot)
        : null,
    clientLng:
      effectiveLocationType === ServiceLocationType.MOBILE
        ? requestedClientAddress
          ? decimalToNumber(requestedClientAddress.lng)
          : decimalToNumber(source.clientAddressLngSnapshot)
        : null,
  })

  // A client confirming a pro-CHOSEN start (legacy stored proposal, or a
  // re-confirm after their own cancel) inherits the pro's authority over the
  // pro's self-rules — working hours, advance notice, max-days-ahead. The pro
  // consented to this exact minute at proposal time (and, in the booked-at-save
  // model, was override-gated + audited there); the client can neither answer
  // nor decline an override prompt, so refusing here would dead-end them.
  // Conflicts are NOT relaxed: the overlap policy below still runs as CLIENT.
  const clientConfirmingProChosenStart =
    args.clientId != null && args.startChosenBy === 'PRO'

  const schedulingDecision = await enforceProCreateScheduling({
    tx: args.tx,
    now: args.now,
    requestedStart,
    durationMinutes: effectiveTotalDurationMinutes,
    bufferMinutes,
    workingHours: locationContext.workingHours,
    timeZone: locationContext.timeZone,
    stepMinutes: locationContext.stepMinutes,
    advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
    maxDaysAhead: locationContext.maxDaysAhead,
    allowShortNotice:
      (args.allowShortNotice ?? false) || clientConfirmingProChosenStart,
    allowFarFuture:
      (args.allowFarFuture ?? false) || clientConfirmingProChosenStart,
    allowOutsideWorkingHours:
      (args.allowOutsideWorkingHours ?? false) ||
      clientConfirmingProChosenStart,
    enforceStepGrid: args.startChosenBy === 'CLIENT',
    action: 'BOOKING_CREATE',
    // enforceBookingOverlapPolicy runs immediately below and owns the
    // booking/hold verdict (an aftercare pre-selected slot may land on one).
    deferBusyConflictsToOverlapPolicy: true,
    professionalId: source.professionalId,
    locationId: locationContext.locationId,
    locationType: effectiveLocationType,
    offeringId: primary.offeringId,
    clientId: source.clientId,
  })

  // Permission-check only the PRO's explicit overrides. The provenance allow
  // above is not an override the client is exercising — overrideAuthorization
  // hard-refuses CLIENT actors, and the pro's consent was given (and audited)
  // when they chose the time.
  if (
    !clientConfirmingProChosenStart &&
    schedulingDecision.appliedOverrides.length > 0
  ) {
    await assertCanUseBookingOverrides({
      actorUserId: args.actorUserId ?? '',
      professionalId: source.professionalId,
      appliedOverrides: schedulingDecision.appliedOverrides,
    })
  }

  const overlapDecision = await enforceBookingOverlapPolicy({
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
            // The pro authoring aftercare, saving a next appointment. There is
            // no dialog on that screen that could carry the live-hold decision,
            // and failing the save with a question nobody can answer would
            // strand the aftercare plan. Today's behaviour, unchanged and
            // stated: a hold does not stop this write.
            liveHoldOverlap: 'NO_DECISION_SURFACE',
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
    locationType: effectiveLocationType,
    offeringId: primary.offeringId,
    clientId: source.clientId,
    action: 'BOOKING_CREATE',
    now: args.now,
  })

  const salonAddressSnapshotData =
    effectiveLocationType === ServiceLocationType.SALON
      ? isLocationOverride
        ? // Switched into in-salon: snapshot the freshly resolved salon
          // location rather than anything cloned from the source booking.
          buildEncryptedAddressSnapshotData({
            formattedAddress: locationContext.formattedAddress,
            lat: locationContext.lat,
            lng: locationContext.lng,
          })
        : source.locationAddressSnapshot != null ||
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
    effectiveLocationType === ServiceLocationType.MOBILE
      ? requestedClientAddress
        ? // Client picked a saved address for this rebook: snapshot the live
          // row rather than cloning the source booking's (possibly different
          // or absent) address snapshot.
          buildEncryptedAddressSnapshotData({
            formattedAddress: requestedClientAddress.formattedAddress,
            lat: requestedClientAddress.lat,
            lng: requestedClientAddress.lng,
          })
        : reuseEncryptedAddressSnapshotData({
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
        // 🔴 Re-asked, not inherited and not assumed. A rebook is otherwise a
        // laundering step: a pro can author aftercare on a booking they wrote
        // for a stranger (the PRO_AFTERCARE_SAVE gate allows it before the
        // source completes) and rebook from it, and an unmarked child would
        // hand over the chart the parent was marked to protect. Asking fresh is
        // also self-healing — the predicate does not count a MARKED booking as
        // history, so the parent cannot vouch for the child, while a pair that
        // has since become real (the client granted access) writes an unmarked
        // one and the chart opens.
        //
        // Only when the PRO picked the time, though. A rebook the CLIENT chose
        // off their aftercare link is the client asking for the next
        // appointment, which is the plainest relationship there is — marking it
        // would leave a pro unable to see the chart of someone who booked them
        // twice. The column means "the pro wrote this for a stranger"; keep it
        // meaning exactly that.
        proCreatedWithoutRelationship:
          args.startChosenBy === 'PRO' &&
          !(await hasEstablishedProClientRelationship({
            professionalId: source.professionalId,
            clientId: source.clientId,
            tx: args.tx,
          })),
        allowsOverlap: overlapDecision.allowsOverlap,
        source: BookingSource.AFTERCARE,
        // K5 snapshot: an aftercare rebook is RR by definition — a returning
        // client who rebooked THIS pro by name. Derived by the one helper so
        // the mapping can't drift from the finalize path's.
        clientRelationshipLabel: deriveClientRelationshipLabel({
          source: BookingSource.AFTERCARE,
          establishedBookingCount: 0,
          proCreated: false,
        }),
        rebookOfBookingId: source.id,

        locationType: effectiveLocationType,
        locationId: locationContext.locationId,
        locationTimeZone: locationContext.timeZone,

        // Legacy expand-phase columns.
        locationAddressSnapshot: salonAddressSnapshotData.legacySnapshot,
        locationAddressSnapshotKeyVersion: salonAddressSnapshotData.keyVersion,
        locationLatSnapshot: isLocationOverride
          ? locationContext.lat
          : decimalToNumber(source.locationLatSnapshot) ?? locationContext.lat,
        locationLngSnapshot: isLocationOverride
          ? locationContext.lng
          : decimalToNumber(source.locationLngSnapshot) ?? locationContext.lng,

        // Dedicated encrypted snapshot columns.
        encryptedLocationAddressSnapshotJson:
          salonAddressSnapshotData.encryptedSnapshot,
        locationLatApprox: salonAddressSnapshotData.latApprox,
        locationLngApprox: salonAddressSnapshotData.lngApprox,

        clientAddressId:
          effectiveLocationType === ServiceLocationType.MOBILE
            ? requestedClientAddress?.id ?? source.clientAddressId
            : null,

        // Legacy
        clientAddressSnapshot: mobileClientAddressSnapshotData.legacySnapshot,
        clientAddressSnapshotKeyVersion: mobileClientAddressSnapshotData.keyVersion,
        clientAddressLatSnapshot:
          effectiveLocationType === ServiceLocationType.MOBILE
            ? requestedClientAddress
              ? decimalToNumber(requestedClientAddress.lat)
              : decimalToNumber(source.clientAddressLatSnapshot)
            : null,
        clientAddressLngSnapshot:
          effectiveLocationType === ServiceLocationType.MOBILE
            ? requestedClientAddress
              ? decimalToNumber(requestedClientAddress.lng)
              : decimalToNumber(source.clientAddressLngSnapshot)
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

        subtotalSnapshot: effectiveSubtotalSnapshot,
        serviceSubtotalSnapshot: effectiveSubtotalSnapshot,
        productSubtotalSnapshot: zeroMoney(),
        totalAmount: effectiveSubtotalSnapshot,
        depositAmount: null,
        tipAmount: zeroMoney(),
        taxAmount: zeroMoney(),
        discountAmount: zeroMoney(),
        checkoutStatus: BookingCheckoutStatus.NOT_READY,
        selectedPaymentMethod: null,
        paymentAuthorizedAt: null,
        paymentCollectedAt: null,
        totalDurationMinutes: effectiveTotalDurationMinutes,
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

    // 23P01: DB overlap EXCLUDE rejected the insert (race the app check missed).
    if (isExclusionConstraintError(error, BOOKING_OVERLAP_CONSTRAINT_NAME)) {
      logOverlapBackstopFired({
        action: 'BOOKING_CREATE',
        professionalId: args.professionalId,
        locationId: locationContext.locationId,
        // The mode the rebook is actually being written with, which may differ
        // from the source booking's when the caller overrode it.
        locationType: effectiveLocationType,
        requestedStart,
        requestedEnd: schedulingDecision.requestedEnd,
        // A create: the new row does not exist. args.bookingId is the COMPLETED
        // booking this rebook came from, which belongs in meta, not in the
        // bookingId field a reader will take for the conflicting row.
        sourceBookingId: args.bookingId,
        clientId: args.clientId ?? null,
      })
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
      priceSnapshot: isLocationOverride
        ? effectiveSubtotalSnapshot
        : normalizedItems[0]?.priceSnapshot ?? new Prisma.Decimal(0),
      durationMinutesSnapshot: isLocationOverride
        ? effectiveTotalDurationMinutes
        : normalizedItems[0]?.durationMinutesSnapshot ?? totalDurationMinutes,
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
      rebookedBookingId: createdBooking.id,
    },
    update: {
      rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      rebookedFor: requestedStart,
      rebookWindowStart: null,
      rebookWindowEnd: null,
      rebookedBookingId: createdBooking.id,
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

  if (
    !clientConfirmingProChosenStart &&
    schedulingDecision.appliedOverrides.length > 0
  ) {
    await createBookingOverrideAuditLogs({
      tx: args.tx,
      bookingId: createdBooking.id,
      professionalId: source.professionalId,
      actorUserId: args.actorUserId ?? '',
      action: 'CREATE',
      route: 'lib/booking/writeBoundary.ts:performLockedCreateRebookedBooking',
      reason: normalizeReason(args.overrideReason ?? null),
      appliedOverrides: schedulingDecision.appliedOverrides,
      bookingScheduledForBefore: null,
      bookingScheduledForAfter: requestedStart,
      advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
      maxDaysAhead: locationContext.maxDaysAhead,
      workingHours: locationContext.workingHours,
      timeZone: locationContext.timeZone,
    })
  }

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
    // The pro rebooks off their own calendar.
    startChosenBy: 'PRO',
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
  /**
   * Whether THIS update can stop and ask the pro about a live client hold.
   * Only consulted when the occupied range actually moves. Required, no
   * default — see `ProLiveHoldOverlapStance`.
   */
  proLiveHoldOverlap: ProLiveHoldOverlapStance
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
      // §12 NC1 #8: enrich the pro-cancel client notification with service + pro.
      service: { select: { name: true } },
      professional: {
        select: { timeZone: true, ...professionalPublicDisplayNameSelect },
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
    // M8: this pro PATCH-cancel path (the live web pro-cancel surface, M6) now
    // runs through the lifecycle contract. PENDING/ACCEPTED → CANCELLED by a pro
    // is legal; a started (IN_PROGRESS) or NO_SHOW booking is refused as a clean
    // 4xx (the web UI never offers cancel there — this closes the API hole).
    recordStatusTransitionOrRefuse({
      from: existing.status,
      to: BookingStatus.CANCELLED,
      actor: 'PRO',
      route: 'lib/booking/writeBoundary.ts:performLockedUpdateProBooking#cancel',
      bookingId: existing.id,
      professionalId: existing.professionalId,
    })
    const updated = await args.tx.booking.update({
    where: { id: existing.id },
    data: {
      status: BookingStatus.CANCELLED,
      // Provenance for the late-capture refund path (this surface is pro-only).
      cancelledAt: new Date(),
      cancelledByRole: Role.PRO,
    },
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
  const cancelServiceLabel = existing.service?.name?.trim() || 'appointment'
  const cancelProName = formatProfessionalPublicDisplayName(existing.professional)
  const cancelWhenClause = formatBookingWhenClause(
    updated.scheduledFor,
    resolveBookingDisplayTimeZone(existing),
  )
  await createUpdateClientNotification({
    tx: args.tx,
    clientId: existing.clientId,
    bookingId: updated.id,
    eventKey: NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
    title: 'Appointment cancelled',
    body: `Your ${cancelServiceLabel} with ${cancelProName}${cancelWhenClause} was cancelled.`,
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
    // WARNING: the pro is refused with TIMEZONE_REQUIRED, so it is not silent —
    // but it is also not something they can fix. Reaching here means a stored
    // ProfessionalLocation (or the booking's own locationTimeZone) holds a value
    // the timezone resolver rejects, which blocks every reschedule on that
    // location until someone repairs the row. Data integrity, not user error.
    captureBookingException({
      error: new Error(
        `updateProBooking could not resolve an appointment timezone: ${schedulingContextResult.error}`,
      ),
      route: 'updateProBooking',
      event: 'APPOINTMENT_TIMEZONE_UNRESOLVABLE',
      level: 'warning',
      bookingId: existing.id,
      professionalId: existing.professionalId,
    })
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
    normalizedServiceItems?.map((item) => ({
      serviceId: item.serviceId,
      offeringId: item.offeringId,
      durationMinutesSnapshot: item.durationMinutesSnapshot,
      priceSnapshot: item.priceSnapshot,
      itemType: item.itemType,
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

  // The reminder payload renders the booking's WHOLE service line-up
  // (formatBookingServicesLabel over its serviceItems), not just the primary —
  // so swapping one add-on for another of the same length changes what the
  // reminder says while leaving the start, the duration and the primary service
  // untouched. Compare the line-up itself rather than trusting
  // `hasServiceItems`: the editor re-submits the unchanged list on every save,
  // and resyncing on a no-op would cancel and re-create identical rows for
  // nothing (B2's "succeeded is not changed").
  const existingServiceLineup = normalizedServiceItems
    ? await args.tx.bookingServiceItem.findMany({
        where: { bookingId: existing.id },
        orderBy: { sortOrder: 'asc' },
        select: { serviceId: true, itemType: true },
      })
    : null

  const serviceLineupChanged =
    normalizedServiceItems != null &&
    existingServiceLineup != null &&
    (existingServiceLineup.length !== normalizedServiceItems.length ||
      existingServiceLineup.some(
        (item, index) =>
          item.serviceId !== normalizedServiceItems[index]?.serviceId ||
          item.itemType !== normalizedServiceItems[index]?.itemType,
      ))

  const reminderStateChanged =
    occupancyChanged ||
    serviceLineupChanged ||
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
    // Pro-driven reschedule / drag / resize — the pro owns the minute.
    enforceStepGrid: false,
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

  // Only re-evaluated (and thus reset) when the occupied range actually changes;
  // otherwise the booking keeps its current allowsOverlap value.
  let rescheduleAllowsOverlap: boolean | undefined
  if (occupancyChanged) {
    const overlapDecision = await enforceBookingOverlapPolicy({
      tx: args.tx,
      actor: {
        kind: 'PRO',
        userId: args.actorUserId,
        professionalId: existing.professionalId,
        liveHoldOverlap: args.proLiveHoldOverlap,
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
    rescheduleAllowsOverlap = overlapDecision.allowsOverlap
  }

  if (normalizedServiceItems) {
    await replaceBookingServiceItems(
      args.tx,
      existing.id,
      normalizedServiceItems.map((item, index) => ({
        serviceId: item.serviceId,
        offeringId: item.offeringId,
        itemType: item.itemType,
        priceSnapshot: item.priceSnapshot,
        durationMinutesSnapshot: item.durationMinutesSnapshot,
        notes:
          item.itemType === BookingServiceItemType.ADD_ON
            ? 'MANUAL_ADDON'
            : null,
        sortOrder: index,
      })),
    )
  }

  const checkoutRollup = await buildBookingCheckoutRollupUpdate({
    tx: args.tx,
    bookingId: existing.id,
    nextServiceSubtotal: computedSubtotal,
  })

  const updatedBookingSelect = {
    id: true,
    scheduledFor: true,
    bufferMinutes: true,
    totalDurationMinutes: true,
    status: true,
    subtotalSnapshot: true,
  } satisfies Prisma.BookingSelect

  // M8: a pro accepting a booking (PENDING → ACCEPTED) runs through the lifecycle
  // contract. Legal for a PENDING request; an accept targeting a started/terminal
  // booking is refused as a clean 4xx (the UI only offers accept on PENDING
  // requests). No-op when the booking is already ACCEPTED (from === to).
  if (args.nextStatus === BookingStatus.ACCEPTED) {
    recordStatusTransitionOrRefuse({
      from: existing.status,
      to: BookingStatus.ACCEPTED,
      actor: 'PRO',
      route: 'lib/booking/writeBoundary.ts:performLockedUpdateProBooking#accept',
      bookingId: existing.id,
      professionalId: existing.professionalId,
    })
  }

  let updated: Prisma.BookingGetPayload<{ select: typeof updatedBookingSelect }>

  try {
    updated = await args.tx.booking.update({
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
        // Re-stamp overlap exemption when the occupied range changed: a pro who
        // reschedules onto an occupied slot is an authorized overlap; one who
        // reschedules into a free slot returns the booking to constraint coverage.
        ...(rescheduleAllowsOverlap !== undefined
          ? { allowsOverlap: rescheduleAllowsOverlap }
          : {}),
        scheduledFor: finalStart,
        // K12: a pro moving the time resets the client-confirmation loop — the
        // client's answer was to the OLD instant (same rule as the client
        // reschedule path). Duration/price-only edits leave it alone.
        ...(finalStart.getTime() !== existingScheduledFor.getTime()
          ? {
              clientConfirmationRequestedAt: null,
              clientConfirmedAt: null,
              clientConfirmationDeclinedAt: null,
            }
          : {}),
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
      select: updatedBookingSelect,
    })
  } catch (error) {
    // 23P01: DB overlap EXCLUDE rejected the move (race the app check missed).
    if (isExclusionConstraintError(error, BOOKING_OVERLAP_CONSTRAINT_NAME)) {
      logOverlapBackstopFired({
        action: 'BOOKING_UPDATE',
        professionalId: existing.professionalId,
        locationId: existing.locationId,
        locationType: existing.locationType,
        requestedStart: finalStart,
        requestedEnd: schedulingDecision.requestedEnd,
        bookingId: existing.id,
        clientId: existing.clientId,
      })
      throw bookingError('TIME_BOOKED')
    }

    throw error
  }

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
  const notifServiceLabel = existing.service?.name?.trim() || 'appointment'
  const notifProName = formatProfessionalPublicDisplayName(existing.professional)
  const notifTz = appointmentTimeZone || resolveBookingDisplayTimeZone(existing)
  const notifWhen = new Date(updated.scheduledFor)

  // §12 NC1 #3+4 (confirmed, unified helper) / #7 (rescheduled → "is now …").
  const eventKey = isConfirm
    ? NotificationEventKey.BOOKING_CONFIRMED
    : NotificationEventKey.BOOKING_RESCHEDULED
  const confirmedCopy = buildBookingConfirmedClientCopy({
    proName: notifProName,
    serviceName: existing.service?.name,
    scheduledFor: notifWhen,
    timeZone: notifTz,
  })
  const title = isConfirm ? confirmedCopy.title : 'Appointment rescheduled'
  const bodyText = isConfirm
    ? confirmedCopy.body
    : `Your ${notifServiceLabel} with ${notifProName} is now ${formatBookingDateLabel(notifWhen, notifTz)} at ${formatBookingTimeLabel(notifWhen, notifTz)}.`
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

/**
 * Validate a pro-chosen aftercare "featured" photo. A non-null id must be an
 * IMAGE attached to THIS booking with the matching phase (BEFORE/AFTER) — so a
 * pro can never feature another booking's photo, a video, or a wrong-phase
 * shot. Null/empty clears the selection. Returns the trimmed id or null.
 */
async function resolveAftercareFeaturedAssetId(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  assetId: string | null | undefined
  phase: typeof MediaPhase.BEFORE | typeof MediaPhase.AFTER
}): Promise<string | null> {
  const id = typeof args.assetId === 'string' ? args.assetId.trim() : ''
  if (!id) return null

  // Existence-only check (no url/thumbUrl read → no render-boundary concern):
  // the id must be an IMAGE on THIS booking with the matching phase.
  const matches = await args.tx.mediaAsset.count({
    where: {
      id,
      bookingId: args.bookingId,
      phase: args.phase,
      mediaType: MediaType.IMAGE,
    },
  })

  if (matches === 0) {
    throw bookingError('FORBIDDEN', {
      message: `Featured ${args.phase} asset ${id} is not a ${args.phase} image on this booking.`,
      userMessage:
        'The selected featured photo is no longer available for this booking.',
    })
  }

  return id
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
    /**
     * MOBILE slots: the client service address the pro picked for the next
     * appointment. Ownership (booking's client + SERVICE_ADDRESS kind) is
     * asserted in the boundary; confirm falls back to the source booking's
     * address when null, so older clients that never send it keep working.
     */
    clientAddressId: string | null
    startsAt: Date
    endsAt: Date
  } | null
  /** See {@link UpsertBookingAftercareArgs} — the same explicit overrides. */
  allowOutsideWorkingHours: boolean
  allowShortNotice: boolean
  allowFarFuture: boolean
  overrideReason: string | null
  createRebookReminder: boolean
  rebookReminderDaysBefore: number
  createProductReminder: boolean
  productReminderDaysAfter: number
  recommendedProducts: RecommendedProductInput[]
  sendToClient: boolean
  version: number | null
  featuredBeforeAssetId?: string | null
  featuredAfterAssetId?: string | null
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
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED', {
      message: 'This booking is cancelled.',
      userMessage: 'This booking is cancelled.',
    })
  }

  // A COMPLETED booking's aftercare stays editable for a bounded correction
  // window, then locks for good — see lib/aftercare/aftercareEditWindow.ts for
  // why the old lock-on-completion behavior was the wrong shape. We still key
  // on status (not finishedAt) to decide whether a window applies at all: a
  // live session can carry a finishedAt while still being IN_PROGRESS, and that
  // send is exactly what triggers closeout — completion is the *result* of this
  // write, never a precondition here.
  //
  // Re-completion is a natural no-op below: `canCompleteBookingCloseout` refuses
  // an already-COMPLETED booking, so an in-window save updates the aftercare
  // without touching status, sessionStep or finishedAt.
  const editWindow = resolveAftercareEditWindow({
    status: booking.status,
    finishedAt: booking.finishedAt,
    scheduledFor: booking.scheduledFor,
    now,
  })

  if (!editWindow.editable) {
    throw bookingError('BOOKING_CANNOT_EDIT_COMPLETED', {
      message: `Aftercare edit window closed for completed booking ${booking.id}.`,
      userMessage: `This booking finished more than ${AFTERCARE_POST_COMPLETION_EDIT_WINDOW_DAYS} days ago. Its aftercare can no longer be edited.`,
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

  // A pro-picked mobile address must be one of THIS booking's client's saved
  // service addresses — the pro chooses among the client's addresses, never
  // supplies an arbitrary one. (Salon slots never carry an address; the route
  // strips it, and the upsert below writes null defensively.)
  if (
    args.rebookSlot?.clientAddressId &&
    args.rebookSlot.locationType === ServiceLocationType.MOBILE
  ) {
    const slotClientAddress = await args.tx.clientAddress.findFirst({
      where: {
        id: args.rebookSlot.clientAddressId,
        clientId: booking.clientId,
        kind: ClientAddressKind.SERVICE_ADDRESS,
      },
      select: { id: true },
    })

    if (!slotClientAddress) {
      throw bookingError('CLIENT_SERVICE_ADDRESS_INVALID', {
        message:
          'Aftercare rebook slot clientAddressId is not a service address owned by this booking’s client.',
        userMessage: 'Please choose one of the client’s saved service addresses.',
      })
    }
  }

  const timeZoneUsed = resolveAftercareTimeZone({
    bookingLocationTimeZone: booking.locationTimeZone,
    professionalTimeZone: booking.professional?.timeZone,
  })

  // Validate the pro-chosen featured pair against this booking's media. Each id
  // must be an IMAGE on this booking with the matching phase; null clears.
  const featuredBeforeAssetId = await resolveAftercareFeaturedAssetId({
    tx: args.tx,
    bookingId: booking.id,
    assetId: args.featuredBeforeAssetId,
    phase: MediaPhase.BEFORE,
  })
  const featuredAfterAssetId = await resolveAftercareFeaturedAssetId({
    tx: args.tx,
    bookingId: booking.id,
    assetId: args.featuredAfterAssetId,
    phase: MediaPhase.AFTER,
  })

  const existingAftercare = booking.aftercareSummary
  // (Re)send to the client on EVERY explicit send — not just the first one.
  // "Send update to client" must re-deliver the aftercare magic link (text +
  // email); previously this was gated to the first send, so updates silently
  // delivered nothing.
  const shouldQueueAftercareAccessDelivery = args.sendToClient
  // A resend (already sent once) uses RESEND mode + the new version so the
  // delivery isn't deduped against the original send.
  const aftercareDeliveryResendMode: ClientActionResendMode =
    existingAftercare?.sentToClientAt ? 'RESEND' : 'INITIAL_SEND'
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
      featuredBeforeAssetId: existingAftercare.featuredBeforeAssetId ?? null,
      featuredAfterAssetId: existingAftercare.featuredAfterAssetId ?? null,
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
  featuredBeforeAssetId,
  featuredAfterAssetId,
  sentToClient: args.sendToClient
    ? true
    : Boolean(existingAftercare?.sentToClientAt),
}

if (
  existingAftercare &&
  !args.sendToClient &&
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
      featuredBeforeAssetId: existingAftercare.featuredBeforeAssetId ?? null,
      featuredAfterAssetId: existingAftercare.featuredAfterAssetId ?? null,
      draftSavedAt: existingAftercare.draftSavedAt,
      sentToClientAt: existingAftercare.sentToClientAt,
      lastEditedAt: existingAftercare.lastEditedAt,
      version: existingAftercare.version,
      rebookedBookingId: existingAftercare.rebookedBookingId ?? null,
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
      // `finishedAt` is the "session already finished" signal worth surfacing
      // on this no-op return — it covers both a live session that has been
      // finished and an in-window edit of an already-COMPLETED booking.
      booking.finishedAt
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
      rebookDeclinedAt: null,
      featuredBeforeAssetId,
      featuredAfterAssetId,

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
      // A freshly saved proposal supersedes any prior client decline.
      rebookDeclinedAt: null,
      featuredBeforeAssetId,
      featuredAfterAssetId,

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
      featuredBeforeAssetId: true,
      featuredAfterAssetId: true,
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

  const rebookSlotClientAddressId =
    validRebookSlot.locationType === ServiceLocationType.MOBILE
      ? validRebookSlot.clientAddressId
      : null

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
      clientAddressId: rebookSlotClientAddressId,
      startsAt: validRebookSlot.startsAt,
      endsAt: validRebookSlot.endsAt,
    },
    update: {
      professionalId: args.professionalId,
      offeringId: rebookSlotOfferingId,
      locationId: validRebookSlot.locationId,
      locationType: validRebookSlot.locationType,
      clientAddressId: rebookSlotClientAddressId,
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

// BOOKED_NEXT_APPOINTMENT books immediately: mirror the saved slot into a real
// Booking on the pro's calendar so no other client can take the time (Tori,
// 2026-07-20 — the slot is a pro-confirmed appointment, not a proposal, and
// the client has nothing to confirm). Create when missing, reschedule when
// only the time changed, recreate when the placement (location type / mobile
// address) changed, cancel when the pro withdraws the booked plan.
//
// "Which appointment counts" is shared with the authoring surfaces' seed
// (lib/aftercare/aftercareRebookSeed.ts): if the two ever disagreed, the editor
// would show one appointment and this sync would act on another.
const priorRebookedBooking = isActiveAftercareRebookedBooking(
  booking.aftercareSummary?.rebookedBooking,
)
  ? booking.aftercareSummary?.rebookedBooking ?? null
  : null

let syncedRebookedBookingId: string | null = priorRebookedBooking?.id ?? null

if (validRebookSlot) {
  const slotClientAddressId =
    validRebookSlot.locationType === ServiceLocationType.MOBILE
      ? validRebookSlot.clientAddressId
      : null
  const startUnchanged =
    priorRebookedBooking !== null &&
    priorRebookedBooking.scheduledFor.getTime() ===
      validRebookSlot.startsAt.getTime()
  const placementUnchanged =
    priorRebookedBooking !== null &&
    priorRebookedBooking.locationType === validRebookSlot.locationType &&
    (priorRebookedBooking.clientAddressId ?? null) === slotClientAddressId

  if (priorRebookedBooking && startUnchanged && placementUnchanged) {
    // The booking already mirrors the slot — nothing to do.
  } else if (priorRebookedBooking && placementUnchanged) {
    // Time-only change: a normal reschedule (client gets BOOKING_RESCHEDULED).
    await performLockedUpdateProBooking({
      // The pro is saving an aftercare plan, not standing at a slot: there is
      // no dialog here that could carry the live-hold decision, and failing the
      // save with a question nobody can answer would strand the plan. Today's
      // behaviour, unchanged and stated.
      proLiveHoldOverlap: 'NO_DECISION_SURFACE',
      tx: args.tx,
      now,
      professionalId: args.professionalId,
      bookingId: priorRebookedBooking.id,
      nextStatus: null,
      notifyClient: true,
      allowOutsideWorkingHours: args.allowOutsideWorkingHours,
      allowShortNotice: args.allowShortNotice,
      allowFarFuture: args.allowFarFuture,
      nextStart: validRebookSlot.startsAt,
      nextBuffer: null,
      nextDuration: null,
      parsedRequestedItems: null,
      hasBuffer: false,
      hasDuration: false,
      hasServiceItems: false,
      actorUserId: args.actorUserId,
      overrideReason: args.overrideReason,
      requestId: args.requestId ?? null,
    })
  } else {
    // No active booking yet, or the placement changed (which a reschedule
    // can't express): release the old booking quietly and create afresh. The
    // create notification below covers the client-facing story.
    if (
      priorRebookedBooking &&
      (priorRebookedBooking.status === BookingStatus.PENDING ||
        priorRebookedBooking.status === BookingStatus.ACCEPTED)
    ) {
      await performLockedCancel({
        tx: args.tx,
        bookingId: priorRebookedBooking.id,
        actor: { kind: 'pro', professionalId: args.professionalId },
        notifyClient: false,
        reason: 'Next appointment updated from the aftercare plan.',
        allowedStatuses: [BookingStatus.PENDING, BookingStatus.ACCEPTED],
      })
    }

    const createdRebook = await performLockedCreateRebookedBooking({
      tx: args.tx,
      now,
      bookingId: booking.id,
      professionalId: args.professionalId,
      scheduledFor: validRebookSlot.startsAt,
      initialStatus: BookingStatus.ACCEPTED,
      // The pro picked this slot while authoring aftercare.
      startChosenBy: 'PRO',
      aftercareId: aftercare.id,
      requestedLocationType: validRebookSlot.locationType,
      requestedClientAddressId: slotClientAddressId,
      gate: 'PRO_AFTERCARE_SAVE',
      actorUserId: args.actorUserId,
      allowOutsideWorkingHours: args.allowOutsideWorkingHours,
      allowShortNotice: args.allowShortNotice,
      allowFarFuture: args.allowFarFuture,
      overrideReason: args.overrideReason,
      requestId: args.requestId ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
    })
    syncedRebookedBookingId = createdRebook.booking.id

    await createUpdateClientNotification({
      tx: args.tx,
      clientId: booking.clientId,
      bookingId: createdRebook.booking.id,
      eventKey: NotificationEventKey.BOOKING_CONFIRMED,
      title: 'Your next appointment is booked',
      body: `${booking.service.name}${formatBookingWhenClause(
        validRebookSlot.startsAt,
        timeZoneUsed,
      )} — booked for you by your pro. Reschedule anytime.`,
      dedupeKey: `AFTERCARE_REBOOKED:${createdRebook.booking.id}`,
      href: `/client/bookings/${createdRebook.booking.id}`,
      data: {
        bookingId: createdRebook.booking.id,
        aftercareId: aftercare.id,
        notificationReason: 'AFTERCARE_REBOOKED',
      },
    })
  }
} else if (
  priorRebookedBooking &&
  (priorRebookedBooking.status === BookingStatus.PENDING ||
    priorRebookedBooking.status === BookingStatus.ACCEPTED) &&
  priorRebookedBooking.scheduledFor.getTime() > now.getTime()
) {
  // The pro withdrew the booked plan (mode change / slot removed): release the
  // held time and tell the client their appointment was cancelled.
  await performLockedCancel({
    tx: args.tx,
    bookingId: priorRebookedBooking.id,
    actor: { kind: 'pro', professionalId: args.professionalId },
    notifyClient: true,
    reason: 'Next appointment removed from the aftercare plan.',
    allowedStatuses: [BookingStatus.PENDING, BookingStatus.ACCEPTED],
  })
  syncedRebookedBookingId = null
}

if (
  (booking.aftercareSummary?.rebookedBookingId ?? null) !==
  syncedRebookedBookingId
) {
  await args.tx.aftercareSummary.update({
    where: { id: aftercare.id },
    data: { rebookedBookingId: syncedRebookedBookingId },
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
    resendMode: aftercareDeliveryResendMode,
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
          featuredBeforeAssetId: true,
          featuredAfterAssetId: true,
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
    // §12 NC1 #16: align the heading with the SMS, and STOP dumping the raw
    // aftercare notes into the notification body (privacy win) — the notes stay
    // behind the tap.
    const aftercareServiceLabel = booking.service?.name?.trim() || 'appointment'
    const notifTitle = 'Your aftercare is ready'
    const notifBody = `Your pro added aftercare notes and rebooking for your ${aftercareServiceLabel}. Tap to view.`

await createUpdateClientNotification({
  tx: args.tx,
  clientId: booking.clientId,
  bookingId: booking.id,
  aftercareId: finalizedAftercare.id,
  eventKey: NotificationEventKey.AFTERCARE_READY,
  title: notifTitle,
  body: notifBody,
  dedupeKey: notifKey,
  href: `/client/bookings/${booking.id}?step=aftercare`,
  data: {
    bookingId: booking.id,
    aftercareId: finalizedAftercare.id,
    notificationReason: 'AFTERCARE_SENT',
  },
  requestedChannels: AFTERCARE_INBOX_NOTIFICATION_CHANNELS,
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

      // ⚠️ This is the SECOND place a booking becomes COMPLETED — it writes the
      // transition inline rather than going through `maybeCompleteBookingCloseout`
      // — so the credit mint has to be repeated here or a booking completed by
      // sending aftercare would silently never pay its creator. Same helper,
      // same tx, same database-enforced once-per-booking guarantee.
      await mintCreatorCreditOnCompletion(args.tx, {
        bookingId: booking.id,
        now,
      })

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
    featuredBeforeAssetId: finalizedAftercare.featuredBeforeAssetId ?? null,
    featuredAfterAssetId: finalizedAftercare.featuredAfterAssetId ?? null,
    draftSavedAt: finalizedAftercare.draftSavedAt,
    sentToClientAt: finalizedAftercare.sentToClientAt,
    lastEditedAt: finalizedAftercare.lastEditedAt,
    version: finalizedAftercare.version,
    rebookedBookingId: syncedRebookedBookingId,
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
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED')
  }

  // M9's double-collect refusal, mirrored here (§21.4 R2). No route passes
  // markPaymentCollected into this path today, but the public wrapper forwards
  // it — a future caller must not be able to stamp a manual collection over a
  // live Stripe capture. Same distinct code as the pro close-out predicate;
  // throws before any write.
  if (
    args.markPaymentCollected === true &&
    booking.stripePaymentStatus === StripePaymentStatus.SUCCEEDED
  ) {
    throw bookingError('CHECKOUT_ALREADY_PAID_BY_STRIPE')
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
    select: BOOKING_CHECKOUT_MONEY_SELECT,
  })


  // Same rule as the client's own off-Stripe confirm below: money recorded as
  // settled outside Stripe means the client's credit reservation on this booking
  // is not going to be spent, so hand it straight back rather than leaving their
  // balance locked until the sweep expires it. Only touches a PENDING row.
  if (shouldSetAuthorizedAt || shouldSetCollectedAt) {
    await releaseClientCreditForBooking(args.tx, {
      bookingId: booking.id,
      now: args.now,
    })
  }

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
  selectedPaymentMethod?: PaymentMethod | null
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
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED')
  }

  // M9 — Stripe already collected the final bill by card. A manual close-out
  // that reaches here would either double-collect (cash + card) or comp a client
  // the card already charged, so it is refused with a distinct code the pro UI
  // can act on. This runs BEFORE the idempotent no-op / PAID↔WAIVED checks so a
  // card payment always wins over a racing manual action. It never fires for a
  // genuine manual replay: only a real Stripe capture sets stripePaymentStatus
  // to SUCCEEDED (a manually-marked PAID leaves it NOT_STARTED). The mirror case
  // — a card charge landing AFTER a manual close-out — cannot be refused (the
  // money is already captured) and is detected + paged by the payment applier.
  if (booking.stripePaymentStatus === StripePaymentStatus.SUCCEEDED) {
    throw bookingError('CHECKOUT_ALREADY_PAID_BY_STRIPE')
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

  // When the pro records how the client paid, the method must be one the pro
  // actually accepts, and never a Stripe card (those are only "paid" once Stripe
  // confirms the charge — they cannot be marked paid by hand).
  if (args.selectedPaymentMethod) {
    if (args.selectedPaymentMethod === PaymentMethod.STRIPE_CARD) {
      throw bookingError('FORBIDDEN', {
        message: 'Stripe card payments cannot be marked paid manually.',
        userMessage: 'Card payments must be confirmed through Stripe checkout.',
      })
    }

    const paymentSettings =
      await args.tx.professionalPaymentSettings.findUnique({
        where: { professionalId: args.professionalId },
        select: acceptedPaymentMethodsSelect,
      })

    if (!buildAcceptedPaymentMethods(paymentSettings).has(args.selectedPaymentMethod)) {
      throw bookingError('FORBIDDEN', {
        message: 'Selected payment method is not enabled for this professional.',
        userMessage: 'That payment method is not enabled in your payment settings.',
      })
    }
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
      // Record how the client paid when the pro supplies it; never overwrite an
      // existing method with null (e.g. WAIVED, or a pro confirmation with no
      // method change).
      ...(args.selectedPaymentMethod
        ? { selectedPaymentMethod: args.selectedPaymentMethod }
        : {}),
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

/**
 * Undo a mistaken MANUAL close-out (mark-paid / waive) on a still-in-progress
 * booking — the M9 follow-up. `performLockedUpdateProCheckoutCloseout` refuses
 * PAID↔WAIVED swaps and no-ops a re-mark, so before this there was no product
 * path to reverse a fat-fingered manual collect: reversal meant a refund or an
 * admin/DB edit.
 *
 * This is deliberately the SMALL, SAFE slice (Tori's scope call):
 *  - it reverses ONLY the checkout record — checkoutStatus PAID/WAIVED → READY,
 *    clearing `paymentCollectedAt` / `paymentAuthorizedAt`. It never touches
 *    `status` / `sessionStep` (so it stays outside the lifecycle contract) and
 *    never re-runs completion (READY + null collected can't complete);
 *  - it refuses a live Stripe capture (`stripePaymentStatus=SUCCEEDED`) — real
 *    money reverses via a refund, not a record-only reopen;
 *  - it refuses a COMPLETED booking — that terminal state fired side effects and
 *    is a later card's job to unwind.
 *
 * `selectedPaymentMethod` is left intact (harmless once uncollected; the pro
 * overwrites it on the next mark-paid). A coupled aftercare rebook that a prior
 * confirm-payment approved is NOT un-approved: it is a real future appointment
 * the client wants, and un-accepting it would be more disruptive than the stray
 * approval — documented boundary of this slice.
 */
async function performLockedReopenProBookingCheckout(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  professionalId: string
  actorUserId: string
  route: string
  requestId?: string | null
  idempotencyKey?: string | null
}): Promise<ReopenProBookingCheckoutResult> {
  assertNonEmptyUserId(args.actorUserId)

  const booking: ProCheckoutCloseoutRecord | null =
    await args.tx.booking.findUnique({
      where: { id: args.bookingId },
      select: PRO_CHECKOUT_CLOSEOUT_SELECT,
    })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.professionalId !== args.professionalId) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (booking.status === BookingStatus.CANCELLED) {
    throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED')
  }

  // Money safety FIRST (mirrors M9's ordering). A SUCCEEDED final-bill Stripe
  // payment is a real captured card charge; a record-only reopen would strand
  // that live charge detached from the booking's payment state. Refuse so the
  // money routes to a refund instead — regardless of status, so a card-paid
  // booking always gets the refund message. Runs before the first write.
  if (booking.stripePaymentStatus === StripePaymentStatus.SUCCEEDED) {
    throw bookingError('CHECKOUT_REOPEN_STRIPE_REQUIRES_REFUND')
  }

  // Completed-booking reopen is the deferred slice. COMPLETED is terminal in the
  // lifecycle contract and completion already fired its side effects (review
  // scheduling + eligibility, any coupled-rebook approval); reversing that needs
  // a new contract edge + explicit unwinding. `finishedAt` is only ever set at
  // completion, so this mirrors the closeout's own completed guard.
  if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
    throw bookingError('CHECKOUT_REOPEN_COMPLETED_UNSUPPORTED')
  }

  // Nothing to undo unless a manual close-out actually landed. Anything else
  // (never closed out, AWAITING_CONFIRMATION, PARTIALLY_PAID) is an idempotent
  // no-op so a stale client / double-tap doesn't error.
  if (
    booking.checkoutStatus !== BookingCheckoutStatus.PAID &&
    booking.checkoutStatus !== BookingCheckoutStatus.WAIVED
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
        reopened: false,
      },
    }
  }

  const reversedFromCheckoutStatus = booking.checkoutStatus

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

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      checkoutStatus: BookingCheckoutStatus.READY,
      paymentCollectedAt: null,
      paymentAuthorizedAt: null,
    },
    select: PRO_CHECKOUT_CLOSEOUT_SELECT,
  })

  // Distinct CHECKOUT_REOPENED action (not CHECKOUT_UPDATED) so the money-
  // reversal trail is queryable on its own — one-code-two-meanings discipline.
  // The metadata records which closed state was reversed.
  await createBookingCloseoutAuditLog({
    tx: args.tx,
    bookingId: booking.id,
    professionalId: args.professionalId,
    actorUserId: args.actorUserId,
    action: BookingCloseoutAuditAction.CHECKOUT_REOPENED,
    route: args.route,
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    oldValue: oldCheckoutState,
    newValue: buildCheckoutAuditSnapshot({
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
    metadata: {
      reversedFromCheckoutStatus,
    },
  })

  return {
    booking: {
      id: updated.id,
      status: updated.status,
      sessionStep: updated.sessionStep ?? SessionStep.NONE,
      checkoutStatus: updated.checkoutStatus,
      paymentCollectedAt: updated.paymentCollectedAt,
    },
    meta: {
      ...buildMeta(true),
      reopened: true,
    },
  }
}

/**
 * Approves any aftercare-sourced next appointments that were coupled to a
 * source booking's off-platform payment. When the client checked out with an
 * unverifiable method (AWAITING_CONFIRMATION) they could still book the next
 * appointment immediately, but an AFTERCARE-sourced rebook stays PENDING until
 * the pro confirms receipt — this is the single approval surface. Confirming
 * payment auto-approves every such PENDING rebook (PENDING → ACCEPTED),
 * syncs reminders, and tells the client their next appointment is confirmed.
 *
 * Runs inside the pro's locked transaction, so the PENDING read + ACCEPTED
 * write are serialized against any concurrent pro-side accept. Returns the ids
 * of the bookings that were approved.
 */
async function approveCoupledAftercareNextAppointments(args: {
  tx: Prisma.TransactionClient
  now: Date
  sourceBookingId: string
  professionalId: string
  route: string
}): Promise<string[]> {
  const coupled = await args.tx.booking.findMany({
    where: {
      rebookOfBookingId: args.sourceBookingId,
      source: BookingSource.AFTERCARE,
      status: BookingStatus.PENDING,
      professionalId: args.professionalId,
    },
    select: {
      id: true,
      status: true,
      clientId: true,
      professionalId: true,
    } satisfies Prisma.BookingSelect,
  })

  const approvedIds: string[] = []

  for (const booking of coupled) {
    recordStatusTransition({
      from: BookingStatus.PENDING,
      to: BookingStatus.ACCEPTED,
      actor: 'PRO',
      route: `${args.route}#approve-coupled-rebook`,
      bookingId: booking.id,
      professionalId: booking.professionalId,
    })

    await args.tx.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.ACCEPTED },
      select: { id: true } satisfies Prisma.BookingSelect,
    })

    await syncBookingAppointmentReminders({
      tx: args.tx,
      bookingId: booking.id,
    })

    // BOOKING_CONFIRMED to the client — mirrors the pro-accept path
    // (dedupeKey keeps a replayed confirmation from double-notifying).
    await createUpdateClientNotification({
      tx: args.tx,
      clientId: booking.clientId,
      bookingId: booking.id,
      eventKey: NotificationEventKey.BOOKING_CONFIRMED,
      title: 'Appointment confirmed',
      body: 'Your next appointment is confirmed now that your pro received payment.',
      dedupeKey: `BOOKING_CONFIRMED:${booking.id}`,
      href: `/client/bookings/${booking.id}?step=overview`,
      data: {
        bookingId: booking.id,
        notificationReason: 'BOOKING_CONFIRMED',
        bookingReason: 'PAYMENT_CONFIRMED_REBOOK_APPROVED',
      },
    })

    approvedIds.push(booking.id)
  }

  return approvedIds
}

function assertCanCreateRebookFromSourceBooking(args: {
  source: RebookSourceBookingRecord
  clientId?: string | null
  aftercareId?: string | null
  gate?: 'PRO_AFTERCARE_SAVE'
}): void {
  if (args.clientId && args.source.clientId !== args.clientId) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  if (args.gate === 'PRO_AFTERCARE_SAVE') {
    // The pro books the next appointment while authoring aftercare, before the
    // source session completes or checkout closes — so the COMPLETED /
    // finishedAt / sentToClientAt / checkout gates below don't apply. Only a
    // terminal non-occupancy source is unbookable, and the summary (upserted
    // in this same transaction) must belong to the source booking.
    if (
      args.source.status === BookingStatus.CANCELLED ||
      args.source.status === BookingStatus.NO_SHOW
    ) {
      throw bookingError('AFTERCARE_NOT_COMPLETED', {
        message:
          'A cancelled or no-show booking cannot seed a next appointment.',
        userMessage: 'This appointment can no longer be rebooked.',
      })
    }

    if (!args.source.aftercareSummary?.id) {
      throw bookingError('AFTERCARE_NOT_COMPLETED', {
        message: 'Rebooking requires an aftercare summary.',
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

    return
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

  // Rebooking normally requires a fully-closed checkout (PAID/WAIVED + collected
  // payment). The one exception is an off-platform payment awaiting the pro's
  // confirmation of receipt: the client has attested payment
  // (paymentAuthorizedAt stamped) and may rebook immediately while the current
  // appointment's payment stays pending — an aftercare-sourced rebook then gets
  // coupled to that confirmation downstream (PF2).
  const checkoutClosed =
    isCheckoutCloseoutComplete(args.source.checkoutStatus) &&
    Boolean(args.source.paymentCollectedAt)

  const paymentAwaitingConfirmation =
    args.source.checkoutStatus === BookingCheckoutStatus.AWAITING_CONFIRMATION &&
    Boolean(args.source.paymentAuthorizedAt)

  if (!checkoutClosed && !paymentAwaitingConfirmation) {
    throw bookingError('AFTERCARE_NOT_COMPLETED', {
      message: 'Rebooking requires completed or pending-confirmation checkout.',
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
    select: BOOKING_CHECKOUT_MONEY_SELECT,
  })

  // 🔴 Committing to an OFF-STRIPE payment hands the client's credit back.
  //
  // Credit may only be spent through the CARD checkout, because the pro is made
  // whole by a platform→pro Stripe transfer and that rail needs a connected
  // account — this route rejects STRIPE_CARD on its confirm path entirely. But a
  // client CAN quote credit into a card checkout, abandon it, and settle in cash
  // instead; without this their own balance would stay locked against a booking
  // they have already paid for until the sweep expires it 72 hours later.
  //
  // Gated on AUTHORIZED, not collected: an off-platform confirm lands in
  // AWAITING_CONFIRMATION with `paymentCollectedAt` still null while the pro
  // verifies receipt, so waiting for collection would leave the balance held for
  // exactly the case this exists to fix. Authorizing is the moment the client
  // committed to paying another way.
  //
  // Only ever touches a PENDING row: a spend that already settled is a payment
  // that happened.
  if (args.markPaymentAuthorized || args.markPaymentCollected) {
    await releaseClientCreditForBooking(args.tx, {
      bookingId: booking.id,
      now: args.now,
    })
  }

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
      serviceId: booking.serviceId,
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

  if (args.actor.kind !== 'admin') {
    // 'system' cancels do not flow through here — they have a dedicated entry
    // point (releaseUnpaidDepositBookingBySystem) that re-checks depositStatus
    // under a row lock. Guard so a future caller can't smuggle one in.
    throw new Error('cancelBooking: unsupported actor kind')
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
 * Reason surfaced to the client when the unpaid-deposit auto-release sweep (M5)
 * cancels a booking whose discovery deposit was never paid. Rides the standard
 * cancel notification's "Reason:" suffix.
 */
export const DEPOSIT_UNPAID_RELEASE_REASON =
  'The deposit was not completed in time, so the hold was released. You can rebook anytime.'

export type ReleaseUnpaidDepositOutcome =
  | { released: true; bookingId: string; previousStatus: BookingStatus }
  | {
      released: false
      reason: 'NOT_FOUND' | 'DEPOSIT_NOT_PENDING' | 'STATUS_NOT_RELEASABLE'
    }

/**
 * System auto-release of a booking whose discovery deposit was never paid (M5).
 * Cancels the booking (freeing the pro's slot), stamps SYSTEM provenance
 * (cancelledByRole=null), and notifies the client via the standard cancel
 * receipt with a deposit-specific reason.
 *
 * The deposit-paid webhook (applyStripeDepositSucceededInTransaction) takes NO
 * schedule lock, so the advisory lock alone cannot serialize this against a
 * payment landing mid-sweep. We `SELECT … FOR UPDATE` the booking row and
 * re-check `depositStatus`/`status` UNDER that row lock: a concurrent
 * deposit-PAID update waits on it, so we either observe PAID and skip, or we
 * cancel first and M1's late-capture path refunds the deposit that then lands on
 * the now-CANCELLED booking. Either way the client never loses a paid deposit.
 */
export async function releaseUnpaidDepositBookingBySystem(args: {
  bookingId: string
}): Promise<ReleaseUnpaidDepositOutcome> {
  assertNonEmptyBookingId(args.bookingId)

  // professionalId is needed to take the schedule lock; it never changes.
  const ref = await prisma.booking.findUnique({
    where: { id: args.bookingId },
    select: { professionalId: true },
  })
  if (!ref) return { released: false, reason: 'NOT_FOUND' }

  return withLockedProfessionalTransaction(ref.professionalId, async ({ tx }) => {
    const rows = await tx.$queryRaw<
      Array<{ depositStatus: BookingDepositStatus; status: BookingStatus }>
    >`
      SELECT "depositStatus", "status"
      FROM "Booking"
      WHERE "id" = ${args.bookingId}
      FOR UPDATE
    `
    const locked = rows[0]
    if (!locked) return { released: false, reason: 'NOT_FOUND' }

    if (locked.depositStatus !== BookingDepositStatus.PENDING) {
      // Paid (or refunded/none) — nothing to release. The FOR UPDATE lock means
      // this reflects any deposit-PAID commit that raced us.
      return { released: false, reason: 'DEPOSIT_NOT_PENDING' }
    }

    if (
      locked.status !== BookingStatus.PENDING &&
      locked.status !== BookingStatus.ACCEPTED
    ) {
      return { released: false, reason: 'STATUS_NOT_RELEASABLE' }
    }

    await performLockedCancel({
      tx,
      bookingId: args.bookingId,
      actor: { kind: 'system' },
      notifyClient: true,
      reason: DEPOSIT_UNPAID_RELEASE_REASON,
      allowedStatuses: [BookingStatus.PENDING, BookingStatus.ACCEPTED],
    })

    // Drop the pending deposit-reminder so it never fires for a released hold
    // (the reminder validator also self-heals, but cancel it eagerly).
    await cancelScheduledClientNotificationsForBooking({
      tx,
      bookingId: args.bookingId,
      eventKeys: [NotificationEventKey.DEPOSIT_REMINDER],
    })

    return {
      released: true,
      bookingId: args.bookingId,
      previousStatus: locked.status,
    }
  })
}

/**
 * Reason surfaced to the client when the pending-proximity expiry sweep (B4)
 * cancels a request the professional never answered. Rides the standard cancel
 * notification's "Reason:" suffix.
 */
export const PENDING_PROXIMITY_EXPIRY_REASON =
  'Your pro didn’t confirm this in time, so the request was released and anything you paid is being refunded. You can book again anytime.'

export type ExpirePendingProximityOutcome =
  | { expired: true; bookingId: string }
  | {
      expired: false
      reason: 'NOT_FOUND' | 'STATUS_NOT_PENDING' | 'ALREADY_STARTED'
    }

/**
 * Book the Look, slice B4 — SYSTEM expiry of a PENDING request whose
 * appointment is close and which the professional never answered
 * (docs/product/BOOK-THE-LOOK-DIRECTION.md, "the new safety piece").
 *
 * Cancels the booking (freeing the slot), stamps SYSTEM provenance
 * (`cancelledByRole = null`) and notifies the client with an expiry-specific
 * reason. The DEPOSIT REFUND is deliberately NOT here: Stripe I/O cannot live
 * inside this transaction, so the sweep runs
 * `applyDiscoveryDepositCancelRefund({ actorKind: 'system' })` after it commits,
 * the same two-phase shape every other cancel path uses.
 *
 * The status is re-checked under a `SELECT … FOR UPDATE` row lock, not merely
 * in the candidate query: the accept path takes the professional's schedule
 * lock, but the sweep must not race a pro who is accepting this very request.
 * Under the row lock we either observe ACCEPTED and skip, or we cancel first
 * and the pro's accept fails on a CANCELLED booking. Either way the client is
 * never told "expired" about an appointment that is going ahead.
 */
export async function expirePendingBookingBySystem(args: {
  bookingId: string
}): Promise<ExpirePendingProximityOutcome> {
  assertNonEmptyBookingId(args.bookingId)

  // professionalId is needed to take the schedule lock; it never changes.
  const ref = await prisma.booking.findUnique({
    where: { id: args.bookingId },
    select: { professionalId: true },
  })
  if (!ref) return { expired: false, reason: 'NOT_FOUND' }

  return withLockedProfessionalTransaction(ref.professionalId, async ({ tx }) => {
    const rows = await tx.$queryRaw<
      Array<{ status: BookingStatus; startedAt: Date | null }>
    >`
      SELECT "status", "startedAt"
      FROM "Booking"
      WHERE "id" = ${args.bookingId}
      FOR UPDATE
    `
    const locked = rows[0]
    if (!locked) return { expired: false, reason: 'NOT_FOUND' }

    // Only an UNANSWERED request expires. An accepted, cancelled, completed or
    // no-showed booking is somebody's decision, and this sweep does not have
    // standing to reverse one.
    if (locked.status !== BookingStatus.PENDING) {
      return { expired: false, reason: 'STATUS_NOT_PENDING' }
    }

    // Belt and braces: a PENDING booking should never carry `startedAt`, and a
    // session already underway must never be cancelled out from under the pro.
    if (locked.startedAt) {
      return { expired: false, reason: 'ALREADY_STARTED' }
    }

    await performLockedCancel({
      tx,
      bookingId: args.bookingId,
      actor: { kind: 'system' },
      notifyClient: true,
      reason: PENDING_PROXIMITY_EXPIRY_REASON,
      allowedStatuses: [BookingStatus.PENDING],
    })

    // Drop the pending deposit-reminder so it never fires for a released
    // request (mirrors the unpaid-deposit release sweep).
    await cancelScheduledClientNotificationsForBooking({
      tx,
      bookingId: args.bookingId,
      eventKeys: [NotificationEventKey.DEPOSIT_REMINDER],
    })

    return { expired: true, bookingId: args.bookingId }
  })
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

/**
 * The single-use client-action-token dance shared by the token-authenticated
 * consultation approve and reject entry points. Resolve the token target WITHOUT
 * burning it, take the client-owned booking lock, then CONSUME the token inside
 * that transaction so a refusal below (a stale proposal, TIME_BLOCKED on an
 * extension, the DB overlap backstop) rolls the consumption back with the failed
 * write — leaving the magic link live so the client can re-open it once the pro
 * clears whatever blocked it. Consuming before the write would strand them on a
 * dead link (see [[single-use-token-consumed-before-tx]]).
 *
 * Only the terminal decision differs (approve → materialize, reject → record the
 * decision), so it is passed as `perform`; the REMOTE_SECURE_LINK provenance
 * assembled from the consumed token is identical across both and lives here.
 */
async function runConsultationActionTokenDecision<T>(args: {
  rawToken: string
  ipAddress?: string | null
  userAgent?: string | null
  requestId?: string | null
  idempotencyKey?: string | null
  perform: (ctx: {
    tx: Prisma.TransactionClient
    now: Date
    consumed: Awaited<ReturnType<typeof consumeConsultationActionToken>>
    provenance: ConsultationDecisionProvenance
    requestId: string | null
    idempotencyKey: string | null
  }) => Promise<T>
}): Promise<T> {
  const target = await resolveConsultationActionTokenTarget({
    rawToken: args.rawToken,
  })

  return withLockedClientOwnedBookingTransaction({
    bookingId: target.bookingId,
    clientId: target.clientId,
    run: async ({ tx, now }) => {
      const consumed = await consumeConsultationActionToken({
        rawToken: args.rawToken,
        tx,
      })

      const provenance: ConsultationDecisionProvenance = {
        method: 'REMOTE_SECURE_LINK',
        recordedByUserId: null,
        clientActionTokenId: consumed.id,
        contactMethod: consumed.deliveryMethod,
        destinationSnapshot: consumed.destinationSnapshot,
        ipAddress: normalizeReason(args.ipAddress),
        userAgent: normalizeReason(args.userAgent),
      }

      return args.perform({
        tx,
        now,
        consumed,
        provenance,
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      })
    },
  })
}

export async function approveConsultationByClientActionToken(
  args: ApproveConsultationByClientActionTokenArgs,
): Promise<ApproveConsultationMaterializationResult> {
  return runConsultationActionTokenDecision({
    rawToken: args.rawToken,
    ipAddress: args.ipAddress,
    userAgent: args.userAgent,
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    perform: ({ tx, now, consumed, provenance, requestId, idempotencyKey }) =>
      performLockedApproveConsultationMaterialization({
        tx,
        bookingId: consumed.bookingId,
        clientId: consumed.clientId,
        professionalId: consumed.professionalId,
        now,
        provenance,
        requestId,
        idempotencyKey,
      }),
  })
}

export async function rejectConsultationByClientActionToken(
  args: RejectConsultationByClientActionTokenArgs,
): Promise<RejectConsultationResult> {
  return runConsultationActionTokenDecision({
    rawToken: args.rawToken,
    ipAddress: args.ipAddress,
    userAgent: args.userAgent,
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    perform: ({ tx, now, consumed, provenance, requestId, idempotencyKey }) =>
      performLockedRejectConsultationDecision({
        tx,
        bookingId: consumed.bookingId,
        clientId: consumed.clientId,
        professionalId: consumed.professionalId,
        now,
        provenance,
        requestId,
        idempotencyKey,
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
        throw bookingError('BOOKING_NOT_FOUND')
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
    async ({ tx, now }) =>
      performLockedUploadProBookingMedia({
        tx,
        now,
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
        focalX: args.focalX ?? null,
        focalY: args.focalY ?? null,
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
        allowOutsideWorkingHours: args.allowOutsideWorkingHours,
        allowShortNotice: args.allowShortNotice,
        allowFarFuture: args.allowFarFuture,
        overrideReason: args.overrideReason,
        createRebookReminder: args.createRebookReminder,
        rebookReminderDaysBefore: args.rebookReminderDaysBefore,
        createProductReminder: args.createProductReminder,
        productReminderDaysAfter: args.productReminderDaysAfter,
        recommendedProducts: args.recommendedProducts,
        sendToClient: args.sendToClient,
        version: args.version,
        featuredBeforeAssetId: args.featuredBeforeAssetId ?? null,
        featuredAfterAssetId: args.featuredAfterAssetId ?? null,
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
        addOnIds: args.addOnIds,
        rescheduleBookingId: args.rescheduleBookingId ?? null,
        consultId: args.consultId ?? null,
        offering: args.offering,
        requestedStart: args.requestedStart,
        requestedLocationId: args.requestedLocationId,
        locationType: args.locationType,
        clientAddressId: args.clientAddressId,
      }),
  )
}

/**
 * Re-size an existing hold to a new add-on selection (B1-A).
 *
 * The web flow picks add-ons AFTER the time, so the hold is created base-sized
 * and this widens it the moment the selection is known. It re-runs the COMMIT
 * gate — `evaluateFinalizeDecision`, the very function finalize calls, with this
 * hold excluded from its own conflict check — rather than a parallel copy of it,
 * so what this call accepts is exactly what finalize will accept
 * (promise-site runs the commit-site gate). A refusal leaves the hold at its
 * previous size: the transaction rolls back, and the client keeps the slot they
 * had at the width they had it.
 *
 * `expiresAt` is deliberately NOT extended. Re-sizing is not re-holding, and a
 * client toggling add-ons must not be able to keep a slot indefinitely.
 *
 * ⚠️ This is the first path that MUTATES a live hold's reserved range. The
 * `BookingHold_no_active_professional_overlap` EXCLUDE constraint's migration
 * comment reasons from "a hold's scheduled range is immutable after insert";
 * that is no longer true. The constraint itself still holds the line (Postgres
 * re-checks EXCLUDE on UPDATE), but because it covers expired rows too, expired
 * holds are swept first — exactly as hold creation does — so a stale row cannot
 * spuriously refuse a widen.
 */
export async function updateHoldAddOns(
  args: UpdateHoldAddOnsArgs,
): Promise<UpdateHoldAddOnsResult> {
  assertNonEmptyHoldId(args.holdId)
  assertNonEmptyClientId(args.clientId)

  const result = await withLockedClientOwnedHoldTransaction({
    holdId: args.holdId,
    clientId: args.clientId,
    run: async ({ tx, now, hold }) =>
      performLockedUpdateHoldAddOns({
        tx,
        now,
        hold,
        addOnIds: args.addOnIds,
      }),
  })

  // Bumped AFTER the transaction commits: the version is a cache-invalidation
  // signal, and Redis is not transactional, so bumping mid-transaction lets a
  // concurrent reader miss on the new version, read the not-yet-committed row
  // and re-cache the OLD occupancy under the NEW version (B2-A).
  //
  // Gated on `mutated`: a re-sync that changes nothing (a reloaded add-ons page,
  // a retried request) must not evict this pro's availability cache, or a client
  // could dump it at will by re-sending the selection it already has. Succeeding
  // is not the same as changing something ([[cache-is-a-third-query]], B2).
  if (result.meta.mutated) {
    await bumpProfessionalScheduleVersion(result.professionalId)
  }

  return result
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
        selectedPaymentMethod: args.selectedPaymentMethod ?? null,
        route: 'lib/booking/writeBoundary.ts:markProBookingCheckoutPaid',
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
  )
}

/**
 * Pro confirms receipt of an off-platform payment (cash / Venmo / Zelle / Apple
 * Cash / PayPal) that was left AWAITING_CONFIRMATION at client checkout. In one
 * locked transaction this both (a) closes out the booking's payment — PAID +
 * paymentCollectedAt, running the aftercare/closeout completion + audit +
 * PAYMENT_COLLECTED receipt via the shared closeout path — and (b) approves any
 * aftercare-sourced next appointment coupled to it (PENDING → ACCEPTED).
 *
 * Distinct from `markProBookingCheckoutPaid`: that path records a manual collect
 * from any pre-collection state; this one is specifically the confirmation of a
 * pending off-platform payment and refuses anything not in AWAITING_CONFIRMATION.
 */
export async function confirmProBookingPaymentReceived(
  args: ConfirmProBookingPaymentReceivedArgs,
): Promise<ConfirmProBookingPaymentReceivedResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)
  assertNonEmptyUserId(args.actorUserId)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) => {
      // Only a booking whose checkout is awaiting confirmation of an off-platform
      // payment can be confirmed here; the ordinary manual-collect path is
      // mark-paid. A replayed confirm (already PAID) falls through to this guard.
      const current = await tx.booking.findUnique({
        where: { id: args.bookingId },
        select: {
          id: true,
          professionalId: true,
          checkoutStatus: true,
        } satisfies Prisma.BookingSelect,
      })

      if (!current || current.professionalId !== args.professionalId) {
        throw bookingError('BOOKING_NOT_FOUND')
      }

      if (
        current.checkoutStatus !== BookingCheckoutStatus.AWAITING_CONFIRMATION
      ) {
        throw bookingError('FORBIDDEN', {
          message:
            'confirmProBookingPaymentReceived requires checkoutStatus AWAITING_CONFIRMATION.',
          userMessage: 'This booking is not awaiting payment confirmation.',
        })
      }

      const route =
        'lib/booking/writeBoundary.ts:confirmProBookingPaymentReceived'

      const closeout = await performLockedUpdateProCheckoutCloseout({
        tx,
        now,
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        actorUserId: args.actorUserId,
        checkoutStatus: BookingCheckoutStatus.PAID,
        paymentCollectedAt: now,
        route,
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      })

      const approvedNextAppointmentBookingIds =
        await approveCoupledAftercareNextAppointments({
          tx,
          now,
          sourceBookingId: args.bookingId,
          professionalId: args.professionalId,
          route,
        })

      return {
        ...closeout,
        approvedNextAppointmentBookingIds,
      }
    },
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

/**
 * Pro undoes a mistaken manual mark-paid / waive (M9 follow-up). Reverses the
 * checkout record back to READY under the same pro schedule lock the close-out
 * took, refuses a live Stripe capture / a completed booking, and writes a
 * CHECKOUT_REOPENED audit row. See `performLockedReopenProBookingCheckout`.
 */
export async function reopenProBookingCheckout(
  args: ReopenProBookingCheckoutArgs,
): Promise<ReopenProBookingCheckoutResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)
  assertNonEmptyUserId(args.actorUserId)

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx }) =>
      performLockedReopenProBookingCheckout({
        tx,
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        actorUserId: args.actorUserId,
        route: 'lib/booking/writeBoundary.ts:reopenProBookingCheckout',
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
      // A waitlist offer's reservation (F14) is not the client's to release: the
      // PRO chose and promised that time, and DECLINE is how it goes back. The
      // hold id is never surfaced on an offer surface, so this is a belt on an
      // unreachable path rather than a UX branch.
      if (hold.waitlistOfferId) {
        throw bookingError('HOLD_FORBIDDEN', {
          message: 'Hold belongs to a waitlist offer.',
          userMessage: 'Decline the offer to give this time back.',
        })
      }

      await tx.bookingHold.delete({
        where: { id: hold.id },
      })

      await bumpProfessionalScheduleVersion(hold.professionalId)

      return {
        holdId: hold.id,
        professionalId: hold.professionalId,
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
        consultEnhancementLineIds: args.consultEnhancementLineIds ?? [],
        locationType: args.locationType,
        source: args.source,
        consultId: args.consultId ?? null,
        initialStatus: args.initialStatus,
        rebookOfBookingId: args.rebookOfBookingId,
        fallbackTimeZone: args.fallbackTimeZone ?? 'UTC',
        offering: args.offering,
        discovery: args.discovery ?? null,
        cancellationPolicySnapshot: args.cancellationPolicySnapshot ?? null,
        cancellationPolicyAcceptedAt: args.cancellationPolicyAcceptedAt ?? null,
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
        // THE interactive pro create — the dashboard form and the iOS sheet. A
        // live client hold stops it and asks, unless this attempt is the pro's
        // answer to that question (see CreateProBookingArgs.confirmHoldOverlap).
        //
        // The calendar IMPORT rides this same function. Its conflicts are
        // already refused one layer up by the CALENDAR_IMPORT source, before the
        // PRO branch is reached — but it is spelled out here too, because
        // "unattended, nobody to ask" is the truth about an import whether or
        // not another rule happens to be catching it first.
        proLiveHoldOverlap: args.importMode
          ? 'NO_DECISION_SURFACE'
          : args.confirmHoldOverlap
            ? 'PRO_CONFIRMED'
            : 'ASK_THE_PRO',
        tx,
        now,
        professionalId: args.professionalId,
        clientId: args.clientId,
        // 🔴 Asked at the WRITE, not only at the route, because this call IS
        // the chart grant: the booking is auto-ACCEPTED and an upcoming
        // ACCEPTED booking is the widest clause in `proClientVisibilityWhere`.
        // Every door has to be covered, and the calendar import is a door that
        // never touches the route — it resolves its client by EMAIL through
        // upsertProClient, which matches an EXISTING profile, so it can land on
        // a stranger's record as easily as a hand-typed booking could.
        //
        // Not a refusal: a second pro genuinely serving someone who already has
        // an account is the normal case (client identity is global by design),
        // and refusing would drop a migrating pro's imported history. The
        // booking is made and MARKED, and the mark is what the chart gate reads.
        //
        // Inside the lock, on `tx`, deliberately. Read before it, the answer
        // could be stale by the time the row lands — a chart share revoked in
        // between would still be written as "established". It is also one fewer
        // await before the schedule lock, which keeps this path's timing where
        // every concurrency test found it.
        //
        // Idempotent replays are unaffected: a booking that already exists
        // satisfies the PRIOR_BOOKING clause, and the replay short-circuit
        // returns the stored row without re-stamping it either way.
        proCreatedWithoutRelationship: !(await hasEstablishedProClientRelationship(
          {
            professionalId: args.professionalId,
            clientId: args.clientId,
            tx,
          },
        )),
        offeringId: args.offeringId,
        addOnIds: args.addOnIds ?? [],
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
        depositRequested: args.depositRequested ?? false,
      }),
  )
}

/**
 * K18 — create a recurring appointment (a `BookingSeries`) and MATERIALIZE its
 * first window of occurrences as real `Booking` rows.
 *
 * 🔴 Why real rows, and not an RRULE the calendar expands at read time: a
 * virtual occurrence is invisible to `Booking_no_active_professional_overlap`,
 * to holds, to deposits, to reminders and to closeout. It would not block a
 * double-booking — which is the entire point of a standing appointment — and it
 * would never be reminded, charged or closed out. Every occurrence here is an
 * ordinary booking that happens to carry a `seriesId`.
 *
 * ## Transaction shape (this is the load-bearing part)
 *
 * The series row and occurrence 0 are created in ONE locked transaction: the
 * slot the pro actually picked must either book or refuse, and a series with no
 * appointments is not a thing anybody wants. Every LATER occurrence gets its
 * OWN locked transaction.
 *
 * That is not a style choice. A refused occurrence throws — from the app-level
 * conflict gate, or from the DB overlap constraint — and in Postgres a statement
 * error poisons the whole transaction: every subsequent statement fails with
 * "current transaction is aborted". Catching a conflict on occurrence 5 and
 * carrying on to 6…12 is only possible if 5 had a transaction of its own to roll
 * back. The plan's requirement that "a collision must not abort the
 * roll-forward" IS this design.
 *
 * ## Conflict policy (decided here, per the build plan)
 *
 * SKIP + RECORD. A colliding occurrence is not created, and a
 * `BookingSeriesException` row records the index, the instant it wanted and the
 * refusal code. It is durable (so K20's roll-forward is idempotent and never
 * retries a slot it already lost), queryable (so K19 can show the pro "we
 * couldn't book 12 Feb"), and it is the honest alternative to the two bad
 * options: silently double-booking, or abandoning the rest of the series.
 * Actively notifying the pro belongs to K19/K20, which own a surface — K18 is
 * dark and returns the skips to its caller.
 *
 * ## D7 — deposits (settled by Tori)
 *
 * `depositRequested` is the gate; `depositPerOccurrence` chooses
 * first-occurrence-only or every-occurrence. A SKIPPED occurrence never became a
 * booking, so it never carries a deposit and there is nothing to refund. Under
 * first-occurrence-only the deposit-bearing occurrence is index 0, which cannot
 * be skipped — it refuses the whole series instead — so a series can never end
 * up collecting nothing when the pro asked for a deposit.
 */
export type CreateBookingSeriesArgs = {
  professionalId: string
  actorUserId: string
  clientId: string
  offeringId: string
  addOnIds?: string[]
  locationId: string
  locationType: ServiceLocationType
  clientAddressId: string | null
  /** Occurrence 0 — the slot the pro picked. */
  firstOccurrenceAt: Date
  /** Cadence in CALENDAR weeks. */
  intervalWeeks: number
  /** Total planned occurrences, or null for open-ended. */
  occurrenceCount: number | null
  depositRequested?: boolean
  depositPerOccurrence?: boolean
  internalNotes: string | null
  overrideReason: string | null
  requestedBufferMinutes: number | null
  requestedTotalDurationMinutes: number | null
  allowOutsideWorkingHours: boolean
  allowShortNotice: boolean
  allowFarFuture: boolean
  requestId?: string | null
  idempotencyKey?: string | null
}

export type BookingSeriesMaterializedOccurrence = {
  index: number
  bookingId: string
  scheduledFor: Date
}

export type BookingSeriesSkippedOccurrence = {
  index: number
  intendedStart: Date | null
  reason: BookingSeriesExceptionReason
  detail: string | null
}

export type CreateBookingSeriesResult = {
  seriesId: string
  timeZone: string
  /** Where K20's roll-forward should resume. */
  nextOccurrenceIndex: number
  occurrences: BookingSeriesMaterializedOccurrence[]
  skipped: BookingSeriesSkippedOccurrence[]
  /**
   * K20: set when creation stopped SHORT of the pro's requested run for a reason
   * that is not a refusal — today, dates past the pro's own booking horizon. The
   * remaining occurrences are not lost and are not skips; the roll-forward cron
   * books them as they come into range.
   */
  deferred: SeriesMaterializationDeferral | null
}

/**
 * Classify a booking-boundary refusal into the reason recorded on the
 * exception row. "Slot unavailable" is the family that means somebody else has
 * the time; everything else keeps its own code in `detail` rather than being
 * flattened into a lie about availability.
 */
function classifySeriesRefusal(
  code: BookingErrorCode,
): BookingSeriesExceptionReason {
  switch (code) {
    case 'TIME_BOOKED':
    case 'TIME_HELD':
    case 'TIME_BLOCKED':
    case 'TIME_NOT_AVAILABLE':
      return BookingSeriesExceptionReason.SLOT_UNAVAILABLE
    default:
      return BookingSeriesExceptionReason.REFUSED
  }
}

export async function createBookingSeries(
  args: CreateBookingSeriesArgs,
): Promise<CreateBookingSeriesResult> {
  // 🔴 The kill switch is checked at the WRITE, not only at the route. A dark
  // feature that any other caller can reach is not dark
  // ([[refuse-the-claim-not-just-the-control]]).
  if (!recurringAppointmentsEnabled()) {
    throw bookingError('FORBIDDEN', {
      message: 'Recurring appointments are not enabled.',
      userMessage: 'Recurring appointments are not available yet.',
    })
  }

  assertNonEmptyProfessionalId(args.professionalId)
  assertNonEmptyUserId(args.actorUserId)
  assertNonEmptyClientId(args.clientId)
  assertNonEmptyOfferingId(args.offeringId)
  assertNonEmptyLocationId(args.locationId)
  assertValidRequestedStart(args.firstOccurrenceAt)

  // The same authorization gate the single-booking path applies in
  // lib/booking/resolveProBookingClient.ts, and for the same reason: every
  // occurrence this materializes is an auto-ACCEPTED, future-dated booking, and
  // a future ACCEPTED booking opens the client's chart. This route took
  // `clientId` straight from the request body and never asked whose client it
  // was. Checked at the WRITE, not only at the route — same rule as the kill
  // switch above.
  if (
    !(await hasEstablishedProClientRelationship({
      professionalId: args.professionalId,
      clientId: args.clientId,
    }))
  ) {
    throw bookingError('CLIENT_NOT_FOUND')
  }

  if (
    !Number.isInteger(args.intervalWeeks) ||
    args.intervalWeeks < MIN_SERIES_INTERVAL_WEEKS ||
    args.intervalWeeks > MAX_SERIES_INTERVAL_WEEKS
  ) {
    throw bookingError('INVALID_SERIES_RECURRENCE', {
      message: `intervalWeeks must be an integer between ${MIN_SERIES_INTERVAL_WEEKS} and ${MAX_SERIES_INTERVAL_WEEKS}.`,
    })
  }

  if (
    args.occurrenceCount != null &&
    (!Number.isInteger(args.occurrenceCount) ||
      args.occurrenceCount < 1 ||
      args.occurrenceCount > MAX_SERIES_OCCURRENCE_COUNT)
  ) {
    throw bookingError('INVALID_SERIES_RECURRENCE', {
      message: `occurrenceCount must be an integer between 1 and ${MAX_SERIES_OCCURRENCE_COUNT}, or omitted for an open-ended series.`,
    })
  }

  // The zone whose CALENDAR weeks the pattern steps through is the LOCATION's,
  // read here (scoped to the pro, so a foreign location id cannot be used to
  // borrow a timezone) rather than taken from the request. Occurrence
  // scheduling is not a display concern.
  const location = await prisma.professionalLocation.findFirst({
    where: { id: args.locationId, professionalId: args.professionalId },
    select: { id: true, timeZone: true },
  })

  if (!location) {
    throw bookingError('LOCATION_NOT_FOUND')
  }

  const timeZone = pickTimeZoneOrNull(location.timeZone)
  if (!timeZone) {
    throw bookingError('TIMEZONE_REQUIRED')
  }

  const addOnIds = args.addOnIds ?? []

  // `depositPerOccurrence` is meaningless without `depositRequested`, and a
  // stored row reading "charge every occurrence" beside "collect nothing" is a
  // row that lies to whoever reads it next (K19's edit form, K20's cron). It is
  // normalized here, at the one place that decides.
  const depositRequested = args.depositRequested ?? false
  const depositPerOccurrence = depositRequested && (args.depositPerOccurrence ?? false)

  // Occurrence 0 + the series row, atomically. A refusal here (the slot is
  // taken, the pro isn't booking-ready, the deposit can't be delivered) leaves
  // NO series behind — the pro asked for a standing appointment starting at a
  // time that doesn't work, and half of that is not an answer.
  const created = await withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) => {
      const series = await tx.bookingSeries.create({
        data: {
          professionalId: args.professionalId,
          clientId: args.clientId,
          offeringId: args.offeringId,
          locationId: location.id,
          locationType: args.locationType,
          clientAddressId: args.clientAddressId,
          addOnIds,
          timeZone,
          anchorAt: args.firstOccurrenceAt,
          intervalWeeks: args.intervalWeeks,
          occurrenceCount: args.occurrenceCount,
          depositRequested,
          depositPerOccurrence,
          requestedBufferMinutes: args.requestedBufferMinutes,
          requestedTotalDurationMinutes: args.requestedTotalDurationMinutes,
          allowOutsideWorkingHours: args.allowOutsideWorkingHours,
          allowShortNotice: args.allowShortNotice,
          allowFarFuture: args.allowFarFuture,
          overrideReason: args.overrideReason,
          internalNotes: args.internalNotes,
          createdByUserId: args.actorUserId,
          nextOccurrenceIndex: 1,
        },
        select: { id: true },
      })

      const first = await performLockedCreateProBooking({
        // Unreachable by construction: `seriesId` below makes the source
        // SERIES_MATERIALIZATION, which refuses on ANY conflict before the PRO
        // branch. Stated rather than left to a default, because a default is
        // how the wrong answer gets inherited silently.
        proLiveHoldOverlap: 'NO_DECISION_SURFACE',
        tx,
        now,
        professionalId: args.professionalId,
        clientId: args.clientId,
        // createBookingSeries REFUSES an unestablished pair outright above
        // (the series route is id-keyed, so there is no walk-in case to
        // preserve), which is why reaching here means the pair is real.
        proCreatedWithoutRelationship: false,
        offeringId: args.offeringId,
        addOnIds,
        locationId: location.id,
        locationType: args.locationType,
        scheduledFor: args.firstOccurrenceAt,
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
        // 🔴 NOT args.idempotencyKey. That key belongs to the SERIES request;
        // reusing it on occurrence 0 would make the (clientId, key) uniqueness
        // replay this booking for any later series the same key ever reaches.
        idempotencyKey: null,
        depositRequested,
        seriesId: series.id,
        seriesOccurrenceIndex: 0,
      })

      return { seriesId: series.id, first }
    },
  )

  const occurrences: BookingSeriesMaterializedOccurrence[] = [
    {
      index: 0,
      bookingId: created.first.booking.id,
      scheduledFor: created.first.booking.scheduledFor,
    },
  ]
  const skipped: BookingSeriesSkippedOccurrence[] = []

  const remaining = countOccurrencesToMaterialize({
    nextOccurrenceIndex: 1,
    occurrenceCount: args.occurrenceCount,
    horizon: SERIES_MATERIALIZE_HORIZON - 1,
  })

  // The SAME loop K20's cron runs (see materializeSeriesOccurrenceRange). One
  // implementation, so a rolled-forward occurrence and a created one cannot
  // disagree about conflicts, DST, deposits or price.
  const pass = await materializeSeriesOccurrenceRange({
    plan: {
      seriesId: created.seriesId,
      professionalId: args.professionalId,
      actorUserId: args.actorUserId,
      clientId: args.clientId,
      offeringId: args.offeringId,
      addOnIds,
      locationId: location.id,
      locationType: args.locationType,
      clientAddressId: args.clientAddressId,
      internalNotes: args.internalNotes,
      overrideReason: args.overrideReason,
      requestedBufferMinutes: args.requestedBufferMinutes,
      requestedTotalDurationMinutes: args.requestedTotalDurationMinutes,
      allowOutsideWorkingHours: args.allowOutsideWorkingHours,
      allowShortNotice: args.allowShortNotice,
      allowFarFuture: args.allowFarFuture,
      depositPerOccurrence,
      anchorAt: args.firstOccurrenceAt,
      timeZone,
      intervalWeeks: args.intervalWeeks,
      requestId: args.requestId ?? null,
    },
    fromIndex: 1,
    count: remaining,
    notLaterThan: null,
  })

  occurrences.push(...pass.occurrences)
  skipped.push(...pass.skipped)

  const nextOccurrenceIndex = pass.nextOccurrenceIndex

  await endBookingSeriesIfExhausted({
    seriesId: created.seriesId,
    occurrenceCount: args.occurrenceCount,
    nextOccurrenceIndex,
  })

  // No schedule-version bump here: performLockedCreateProBooking already bumps
  // on every occurrence it creates, and a series that materialized nothing
  // cannot exist (occurrence 0 either books or refuses the whole call).

  return {
    seriesId: created.seriesId,
    timeZone,
    nextOccurrenceIndex,
    occurrences,
    skipped,
    deferred: pass.deferred,
  }
}

/**
 * Everything one occurrence needs, resolved once. Read from the SERIES row (not
 * from a request) whenever the cron is the caller, which is what stops an
 * unattended pass from granting an override the pro never asked for.
 */
export type SeriesMaterializationPlan = {
  seriesId: string
  professionalId: string
  actorUserId: string
  clientId: string
  offeringId: string
  addOnIds: string[]
  locationId: string
  locationType: ServiceLocationType
  clientAddressId: string | null
  internalNotes: string | null
  overrideReason: string | null
  requestedBufferMinutes: number | null
  requestedTotalDurationMinutes: number | null
  allowOutsideWorkingHours: boolean
  allowShortNotice: boolean
  allowFarFuture: boolean
  depositPerOccurrence: boolean
  anchorAt: Date
  timeZone: string
  intervalWeeks: number
  requestId: string | null
}

/**
 * Why a pass STOPPED without exhausting its range — a "not yet", never a "no".
 *
 * 🔴 The distinction K20 exists to draw. A `BookingSeriesException` is
 * PERMANENT: it is unique per (series, index), so the roll-forward will never
 * retry that index again. That is right for a slot somebody else has taken and
 * catastrophic for a refusal that only means "not from here yet" — a date past
 * the pro's booking horizon, or a pro whose account is momentarily not
 * booking-ready. Recording those would punch permanent holes in every long
 * series the first time either was true. They defer instead: no row is written,
 * `nextOccurrenceIndex` does not advance past them, and the next pass tries
 * again.
 */
export type SeriesMaterializationDeferral = {
  index: number
  intendedStart: Date | null
  /** `BEYOND_WINDOW` = outside this pass's lead window, not a refusal at all. */
  code: BookingErrorCode | 'BEYOND_WINDOW'
}

export type SeriesMaterializationPassResult = {
  occurrences: BookingSeriesMaterializedOccurrence[]
  skipped: BookingSeriesSkippedOccurrence[]
  /** Where the NEXT pass resumes. Never past a deferred index. */
  nextOccurrenceIndex: number
  deferred: SeriesMaterializationDeferral | null
}

/**
 * Refusals that describe a condition which will plausibly change, and which are
 * not about this slot being taken. See `SeriesMaterializationDeferral`.
 *
 * `MAX_DAYS_AHEAD_EXCEEDED` is the load-bearing member: a series longer than the
 * pro's booking window reaches it by construction, and before K20 every one of
 * those occurrences became a permanent `REFUSED` exception the roll-forward
 * could never undo.
 */
const DEFERRABLE_SERIES_REFUSALS: ReadonlySet<BookingErrorCode> = new Set([
  'MAX_DAYS_AHEAD_EXCEEDED',
  'PRO_NOT_READY',
])

/**
 * Materialize occurrence indices [fromIndex, fromIndex + count) for a series
 * that already exists.
 *
 * ONE locked transaction PER OCCURRENCE — the K18 rule, and the reason a
 * collision on index 5 still leaves 6…11 standing: in Postgres a statement
 * error poisons its whole transaction, so 5 must have had one of its own to
 * roll back.
 *
 * `notLaterThan` bounds the pass in TIME rather than in count. Creation passes
 * null (it materializes K18's count-based horizon in one go); the roll-forward
 * cron passes `now + lead`, which is what makes it a rolling window rather than
 * an attempt to book a standing appointment out to infinity on its first tick.
 */
async function materializeSeriesOccurrenceRange(args: {
  plan: SeriesMaterializationPlan
  fromIndex: number
  count: number
  notLaterThan: Date | null
}): Promise<SeriesMaterializationPassResult> {
  const { plan } = args
  const occurrences: BookingSeriesMaterializedOccurrence[] = []
  const skipped: BookingSeriesSkippedOccurrence[] = []
  let nextOccurrenceIndex = args.fromIndex
  let deferred: SeriesMaterializationDeferral | null = null

  const instants = computeSeriesOccurrenceInstants({
    recurrence: {
      anchorAt: plan.anchorAt,
      timeZone: plan.timeZone,
      intervalWeeks: plan.intervalWeeks,
    },
    fromIndex: args.fromIndex,
    count: args.count,
  })

  for (const instant of instants) {
    if (instant.kind === 'NONEXISTENT') {
      // The recurring wall time does not exist on that local date. Recorded,
      // never shifted — see lib/booking/series/schedule.ts. Genuinely
      // permanent: that clock time will not exist on that date next week either.
      await recordBookingSeriesException({
        seriesId: plan.seriesId,
        index: instant.index,
        intendedStart: null,
        reason: BookingSeriesExceptionReason.NONEXISTENT_LOCAL_TIME,
        detail: instant.localWallTime,
        nextOccurrenceIndex: instant.index + 1,
      })
      skipped.push({
        index: instant.index,
        intendedStart: null,
        reason: BookingSeriesExceptionReason.NONEXISTENT_LOCAL_TIME,
        detail: instant.localWallTime,
      })
      nextOccurrenceIndex = instant.index + 1
      continue
    }

    // Past the pass's lead window. Occurrence instants increase with the index,
    // so everything after this one is too — stop rather than continue.
    if (args.notLaterThan != null && instant.at.getTime() > args.notLaterThan.getTime()) {
      deferred = {
        index: instant.index,
        intendedStart: instant.at,
        code: 'BEYOND_WINDOW',
      }
      break
    }

    try {
      // Its own transaction — see the header. A refusal below rolls back only
      // this occurrence.
      const result = await withLockedProfessionalTransaction(
        plan.professionalId,
        async ({ tx, now }) => {
          const booking = await performLockedCreateProBooking({
            // Same as the first occurrence: SERIES_MATERIALIZATION refuses on
            // any conflict, and this loop runs on a cron with nobody watching.
            proLiveHoldOverlap: 'NO_DECISION_SURFACE',
            tx,
            now,
            professionalId: plan.professionalId,
            clientId: plan.clientId,
            // An occurrence of a series whose creation already cleared the
            // gate. The pair cannot have become a stranger since.
            proCreatedWithoutRelationship: false,
            offeringId: plan.offeringId,
            addOnIds: plan.addOnIds,
            locationId: plan.locationId,
            locationType: plan.locationType,
            scheduledFor: instant.at,
            clientAddressId: plan.clientAddressId,
            internalNotes: plan.internalNotes,
            requestedBufferMinutes: plan.requestedBufferMinutes,
            requestedTotalDurationMinutes: plan.requestedTotalDurationMinutes,
            allowOutsideWorkingHours: plan.allowOutsideWorkingHours,
            allowShortNotice: plan.allowShortNotice,
            allowFarFuture: plan.allowFarFuture,
            actorUserId: plan.actorUserId,
            overrideReason: plan.overrideReason,
            requestId: plan.requestId,
            idempotencyKey: null,
            // D7: every occurrence pays only when the pro chose
            // per-occurrence. Otherwise the deposit is occurrence 0's alone.
            depositRequested: plan.depositPerOccurrence,
            seriesId: plan.seriesId,
            seriesOccurrenceIndex: instant.index,
          })

          await tx.bookingSeries.update({
            where: { id: plan.seriesId },
            data: { nextOccurrenceIndex: instant.index + 1 },
          })

          return booking
        },
      )

      occurrences.push({
        index: instant.index,
        bookingId: result.booking.id,
        scheduledFor: result.booking.scheduledFor,
      })
      nextOccurrenceIndex = instant.index + 1
    } catch (error: unknown) {
      // 🔴 Only a KNOWN booking refusal becomes a skip. An unexpected error (a
      // dropped connection, a bug) must not be recorded as "that slot was
      // taken" — that would turn an outage into twelve silent, permanent skips
      // the roll-forward will never retry.
      if (!isBookingError(error)) throw error

      // …and a refusal that only means "not yet" must not become one either.
      if (DEFERRABLE_SERIES_REFUSALS.has(error.code)) {
        deferred = {
          index: instant.index,
          intendedStart: instant.at,
          code: error.code,
        }
        break
      }

      const reason = classifySeriesRefusal(error.code)

      await recordBookingSeriesException({
        seriesId: plan.seriesId,
        index: instant.index,
        intendedStart: instant.at,
        reason,
        detail: error.code,
        nextOccurrenceIndex: instant.index + 1,
      })

      skipped.push({
        index: instant.index,
        intendedStart: instant.at,
        reason,
        detail: error.code,
      })
      nextOccurrenceIndex = instant.index + 1
    }
  }

  return { occurrences, skipped, nextOccurrenceIndex, deferred }
}

/**
 * Stamp a series ENDED once it has attempted every occurrence it planned.
 *
 * An exhausted series has nothing left to roll forward, and the cron sweeps on
 * `status` — so saying so is what keeps it out of every future pass rather than
 * being re-examined forever. An open-ended series (`occurrenceCount == null`)
 * never ends here; the pro ends it.
 */
async function endBookingSeriesIfExhausted(args: {
  seriesId: string
  occurrenceCount: number | null
  nextOccurrenceIndex: number
}): Promise<boolean> {
  if (
    args.occurrenceCount == null ||
    args.nextOccurrenceIndex < args.occurrenceCount
  ) {
    return false
  }

  await prisma.bookingSeries.update({
    where: { id: args.seriesId },
    data: { status: BookingSeriesStatus.ENDED },
  })
  return true
}

export type AdvanceBookingSeriesResult = {
  seriesId: string
  /** ACTIVE unless this pass exhausted the plan. */
  seriesStatus: BookingSeriesStatus
  nextOccurrenceIndex: number
  occurrences: BookingSeriesMaterializedOccurrence[]
  skipped: BookingSeriesSkippedOccurrence[]
  deferred: SeriesMaterializationDeferral | null
}

/**
 * K20 (Phase 8) — roll ONE series forward.
 *
 * The operator K18-B's open-ended option had been waiting for: a series that
 * materializes 12 occurrences at creation and then dead-stops is not a standing
 * appointment, it is a batch. This advances the window, unattended.
 *
 * Everything it books comes from the SERIES ROW — the pattern, the location, the
 * add-ons, and in particular the pro's override grants, which K18 stored for
 * exactly this reason. The cron decides nothing; it re-applies what the pro
 * already authorized, at the price they already agreed (see
 * lib/booking/series/pinnedPrice.ts).
 *
 * Idempotent by construction, not by care: `Booking @@unique([seriesId,
 * seriesOccurrenceIndex])` and `BookingSeriesException @@unique([seriesId,
 * occurrenceIndex])` mean a repeated pass over the same indices cannot produce a
 * second row of either kind.
 *
 * 🔴 Gated on `recurringAppointmentsEnabled()`, unlike K19's read and cancel.
 * The asymmetry is deliberate and is the right way round: the kill switch exists
 * to stop the feature CREATING things, and an unattended writer is the first
 * thing it must stop. Nothing is stranded by that — every already-materialized
 * appointment stands, and the (ungated) series cancel still ends a series while
 * the switch is off.
 *
 * Returns null when the series does not exist or is not ACTIVE.
 */
export async function advanceBookingSeries(args: {
  seriesId: string
  /** Materialize nothing scheduled later than this. */
  notLaterThan: Date
  /** Cap on indices ATTEMPTED in this pass. */
  maxOccurrences: number
}): Promise<AdvanceBookingSeriesResult | null> {
  if (!recurringAppointmentsEnabled()) {
    throw bookingError('FORBIDDEN', {
      message: 'Recurring appointments are not enabled.',
      userMessage: 'Recurring appointments are not available yet.',
    })
  }

  const series = await prisma.bookingSeries.findUnique({
    where: { id: args.seriesId },
    select: {
      id: true,
      status: true,
      professionalId: true,
      clientId: true,
      offeringId: true,
      locationId: true,
      locationType: true,
      clientAddressId: true,
      addOnIds: true,
      timeZone: true,
      anchorAt: true,
      intervalWeeks: true,
      occurrenceCount: true,
      nextOccurrenceIndex: true,
      depositRequested: true,
      depositPerOccurrence: true,
      requestedBufferMinutes: true,
      requestedTotalDurationMinutes: true,
      allowOutsideWorkingHours: true,
      allowShortNotice: true,
      allowFarFuture: true,
      overrideReason: true,
      internalNotes: true,
      createdByUserId: true,
    },
  })

  if (!series || series.status !== BookingSeriesStatus.ACTIVE) return null

  const count = countOccurrencesToMaterialize({
    nextOccurrenceIndex: series.nextOccurrenceIndex,
    occurrenceCount: series.occurrenceCount,
    horizon: args.maxOccurrences,
  })

  if (count <= 0) {
    // Nothing left to attempt: the plan is exhausted but the row still says
    // ACTIVE (a pass that ended mid-range, or a series written before this
    // stamp existed). Settle it rather than re-reading it every tick.
    const ended = await endBookingSeriesIfExhausted({
      seriesId: series.id,
      occurrenceCount: series.occurrenceCount,
      nextOccurrenceIndex: series.nextOccurrenceIndex,
    })
    return {
      seriesId: series.id,
      seriesStatus: ended ? BookingSeriesStatus.ENDED : series.status,
      nextOccurrenceIndex: series.nextOccurrenceIndex,
      occurrences: [],
      skipped: [],
      deferred: null,
    }
  }

  const pass = await materializeSeriesOccurrenceRange({
    plan: {
      seriesId: series.id,
      professionalId: series.professionalId,
      // The pro who created the series stays the actor. A cron is not a person,
      // and stamping these bookings with a system identity would break every
      // audit trail that asks "who booked this".
      actorUserId: series.createdByUserId,
      clientId: series.clientId,
      offeringId: series.offeringId,
      addOnIds: series.addOnIds,
      locationId: series.locationId,
      locationType: series.locationType,
      clientAddressId: series.clientAddressId,
      internalNotes: series.internalNotes,
      overrideReason: series.overrideReason,
      requestedBufferMinutes: series.requestedBufferMinutes,
      requestedTotalDurationMinutes: series.requestedTotalDurationMinutes,
      allowOutsideWorkingHours: series.allowOutsideWorkingHours,
      allowShortNotice: series.allowShortNotice,
      allowFarFuture: series.allowFarFuture,
      depositPerOccurrence: series.depositPerOccurrence,
      anchorAt: series.anchorAt,
      timeZone: series.timeZone,
      intervalWeeks: series.intervalWeeks,
      requestId: null,
    },
    fromIndex: series.nextOccurrenceIndex,
    count,
    notLaterThan: args.notLaterThan,
  })

  const ended = await endBookingSeriesIfExhausted({
    seriesId: series.id,
    occurrenceCount: series.occurrenceCount,
    nextOccurrenceIndex: pass.nextOccurrenceIndex,
  })

  return {
    seriesId: series.id,
    seriesStatus: ended ? BookingSeriesStatus.ENDED : BookingSeriesStatus.ACTIVE,
    nextOccurrenceIndex: pass.nextOccurrenceIndex,
    occurrences: pass.occurrences,
    skipped: pass.skipped,
    deferred: pass.deferred,
  }
}

export type CancelBookingSeriesOccurrencesArgs = {
  professionalId: string
  actorUserId: string
  seriesId: string
  scope: ProBookingSeriesCancelScope
  /**
   * The occurrence the pro acted from. Required for THIS_AND_FUTURE, ignored
   * for ALL — which is why it is not folded into `scope` as a single number.
   */
  fromOccurrenceIndex: number | null
  reason: string | null
}

export type CancelBookingSeriesOccurrencesResult = {
  seriesId: string
  scope: ProBookingSeriesCancelScope
  seriesStatus: BookingSeriesStatus
  cancelled: Array<{
    index: number
    bookingId: string
    scheduledFor: Date
    depositHeldCents: number
  }>
  untouched: Array<{
    index: number
    bookingId: string
    scheduledFor: Date
    status: BookingStatus
    reason: ProBookingSeriesUntouchedReason
  }>
}

/**
 * K19 (Phase 8) — stop a standing appointment, at a chosen scope.
 *
 * 🔴 NOT flag-gated, deliberately, and this is the one place in Phase 8 where
 * that is correct. `recurringAppointmentsEnabled()` guards CREATION: while it is
 * off, no new series can exist. Guarding the stop as well would mean that
 * turning the switch off after a series had been created leaves live
 * appointments on the pro's calendar with no way to end them — a kill switch
 * that traps its user is worse than the feature it was meant to disable. The
 * surface is data-gated instead: with no series there is nothing to address, so
 * every request 404s anyway.
 *
 * ONE locked transaction for the whole scope, unlike `createBookingSeries`'s
 * one-per-occurrence. The reasons invert: a create must let occurrence 5's
 * collision leave 6…11 standing, so 5 needs its own transaction to roll back; a
 * cancel has nothing to skip past — candidates are classified under the SAME
 * advisory lock that then cancels them, so nothing can change status underneath
 * and a partially-stopped series is never a state anyone has to reason about.
 *
 * Both scopes END the series. "This and future" is not a smaller "all" — it is
 * the same decision (stop the pattern) taken from a later point, and leaving
 * `status = ACTIVE` behind either one would hand K20's roll-forward a series it
 * would dutifully carry on materializing.
 */
export async function cancelBookingSeriesOccurrences(
  args: CancelBookingSeriesOccurrencesArgs,
): Promise<CancelBookingSeriesOccurrencesResult> {
  assertNonEmptyProfessionalId(args.professionalId)
  assertNonEmptyUserId(args.actorUserId)

  if (!args.seriesId || !args.seriesId.trim()) {
    throw bookingError('BOOKING_NOT_FOUND', {
      message: 'seriesId is required.',
      userMessage: 'That recurring appointment could not be found.',
    })
  }

  if (
    args.scope === 'THIS_AND_FUTURE' &&
    (args.fromOccurrenceIndex == null ||
      !Number.isInteger(args.fromOccurrenceIndex) ||
      args.fromOccurrenceIndex < 0)
  ) {
    throw bookingError('INVALID_SERIES_RECURRENCE', {
      message:
        'fromOccurrenceIndex must be a non-negative whole number for a THIS_AND_FUTURE cancel.',
      userMessage: 'Pick which appointment to cancel from.',
    })
  }

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) => {
      const series = await tx.bookingSeries.findFirst({
        where: { id: args.seriesId, professionalId: args.professionalId },
        select: { id: true, status: true },
      })

      // A missing series and someone else's series answer the SAME 404 — a
      // foreign id must not be usable to probe for existence.
      if (!series) {
        throw bookingError('BOOKING_NOT_FOUND', {
          message: 'Booking series not found for this professional.',
          userMessage: 'That recurring appointment could not be found.',
        })
      }

      const bookings = await tx.booking.findMany({
        where: { seriesId: series.id },
        select: {
          id: true,
          seriesOccurrenceIndex: true,
          scheduledFor: true,
          status: true,
          startedAt: true,
          ...DEPOSIT_CREDIT_SELECT,
        },
        orderBy: { seriesOccurrenceIndex: 'asc' },
      })

      const cancelled: CancelBookingSeriesOccurrencesResult['cancelled'] = []
      const untouched: CancelBookingSeriesOccurrencesResult['untouched'] = []

      for (const booking of bookings) {
        // -1 for a row with no index keeps it out of every scope. Defaulting to
        // 0 would put it inside every THIS_AND_FUTURE cancel instead.
        const index = booking.seriesOccurrenceIndex ?? -1

        const verdict = classifySeriesOccurrenceCancel(
          {
            occurrenceIndex: index,
            status: booking.status,
            startedAt: booking.startedAt,
            scheduledFor: booking.scheduledFor,
          },
          {
            scope: args.scope,
            fromOccurrenceIndex: args.fromOccurrenceIndex,
            now,
          },
        )

        if (!verdict.cancellable) {
          untouched.push({
            index,
            bookingId: booking.id,
            scheduledFor: booking.scheduledFor,
            status: booking.status,
            reason: verdict.reason,
          })
          continue
        }

        // The ordinary per-booking cancel, verbatim — same lifecycle contract,
        // same notification, same allowed from-states. A series does not get its
        // own cancel semantics; it gets the same one, N times.
        await performLockedCancel({
          tx,
          bookingId: booking.id,
          actor: { kind: 'pro', professionalId: args.professionalId },
          // Every cancelled occurrence notifies. Noisy on a long series, and
          // that noise is the honest trade: each notification names its own
          // date, and a client whose appointments vanished silently turns up at
          // the salon. K20's cron is where staggering belongs (cf. K18-A).
          notifyClient: true,
          reason: args.reason,
          allowedStatuses: [BookingStatus.PENDING, BookingStatus.ACCEPTED],
        })

        cancelled.push({
          index,
          bookingId: booking.id,
          scheduledFor: booking.scheduledFor,
          depositHeldCents: deriveNetDepositHeldCents(booking),
        })
      }

      // Stamping CANCELLED is what stops K20's roll-forward, so any call that
      // actually cancelled something ends the series, and so does any call
      // against a still-ACTIVE one (the pro asked it to stop, even if there
      // happened to be nothing left to take).
      //
      // A series that had already run its course is left ENDED. Overwriting
      // that with CANCELLED would rewrite "ran to its planned total" as "the
      // pro stopped it" on the strength of a call that changed nothing —
      // unreachable from the UI (the buttons hide once nothing is cancellable)
      // but reachable from the route, and the record should not depend on which.
      const shouldEndSeries =
        cancelled.length > 0 || series.status === BookingSeriesStatus.ACTIVE

      const seriesStatus = shouldEndSeries
        ? (
            await tx.bookingSeries.update({
              where: { id: series.id },
              data: { status: BookingSeriesStatus.CANCELLED },
              select: { status: true },
            })
          ).status
        : series.status

      return {
        seriesId: series.id,
        scope: args.scope,
        seriesStatus,
        cancelled,
        untouched,
      }
    },
  )
}

/**
 * Record one skipped occurrence and advance the series' bookkeeping cursor.
 *
 * Runs OUTSIDE the failed occurrence's transaction (that one is rolled back and
 * unusable). Idempotent on (seriesId, occurrenceIndex): a re-run that loses the
 * race simply finds the row already there, which is what makes K20's
 * roll-forward safe to repeat.
 */
async function recordBookingSeriesException(args: {
  seriesId: string
  index: number
  intendedStart: Date | null
  reason: BookingSeriesExceptionReason
  detail: string | null
  nextOccurrenceIndex: number
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.bookingSeriesException.upsert({
      where: {
        seriesId_occurrenceIndex: {
          seriesId: args.seriesId,
          occurrenceIndex: args.index,
        },
      },
      create: {
        seriesId: args.seriesId,
        occurrenceIndex: args.index,
        intendedStart: args.intendedStart,
        reason: args.reason,
        detail: args.detail,
      },
      update: {},
      select: { id: true },
    })

    await tx.bookingSeries.update({
      where: { id: args.seriesId },
      data: { nextOccurrenceIndex: args.nextOccurrenceIndex },
    })
  })
}

/**
 * Calendar-migration resync reconciliation: cancel an imported booking whose
 * source event was deleted upstream — but ONLY if it's still pristine (untouched
 * since import: ACCEPTED, never started, source IMPORTED). A booking the pro has
 * engaged with is left alone. Silent (the imported booking never notified the
 * client and carries no payment). Returns the number cancelled.
 */
export async function cancelImportedBookingIfPristine(args: {
  professionalId: string
  idempotencyKey: string
}): Promise<number> {
  const result = await prisma.booking.updateMany({
    where: {
      professionalId: args.professionalId,
      creationIdempotencyKey: args.idempotencyKey,
      source: BookingSource.IMPORTED,
      status: BookingStatus.ACCEPTED,
      startedAt: null,
    },
    // cancelledByRole stays null: this is a SYSTEM cancel with no acting role
    // (and an imported booking carries no payment for the late-capture path).
    data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
  })
  if (result.count > 0) {
    // M8: record the bulk ACCEPTED → CANCELLED (SYSTEM) transition through the
    // contract for #724 observability. The WHERE pins the from-state to ACCEPTED,
    // so this is a contract tripwire — legal today (silent); if the candidate
    // filter ever drifted to a non-ACCEPTED status, strict mode would throw and
    // surface the regression rather than silently cancelling out-of-contract.
    recordStatusTransition({
      from: BookingStatus.ACCEPTED,
      to: BookingStatus.CANCELLED,
      actor: 'SYSTEM',
      route: 'lib/booking/writeBoundary.ts:cancelImportedBookingIfPristine',
      professionalId: args.professionalId,
    })
    await bumpProfessionalScheduleVersion(args.professionalId)
  }
  return result.count
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
        // THE interactive pro reschedule — the calendar drag/resize/edit and
        // the iOS reschedule sheet. Same question, same answer channel as the
        // create above.
        proLiveHoldOverlap: args.confirmHoldOverlap
          ? 'PRO_CONFIRMED'
          : 'ASK_THE_PRO',
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

/**
 * ⚠️ NO production caller since B11 retired `POST /api/v1/pro/bookings/[id]/rebook`
 * (2026-07-28). Deliberately KEPT, not dead weight:
 *
 * `tests/integration/rebook-token-step-grid.test.ts` (F4's step-grid rule) and
 * `writeBoundary.overlapPolicy.test.ts` both drive real booking-write behaviour
 * through this entry point, and it is a thin wrapper over
 * `performLockedCreateRebookedBookingFromCompletedBooking`, which the aftercare
 * rebook path does use. Retiring it means re-pointing those two suites first —
 * a separate decision, not a side effect of deleting the route.
 *
 * Do not re-flag it as an orphan without reading those suites.
 */
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

  // Re-run the ownership checks on a freshly-read aftercare ref. Shared by the
  // pre-lock resolve and the post-lock re-read so the two can't drift; the token
  // presence is enforced pre-lock only (it can't change under the lock).
  const assertAftercareRefOwned = (
    ref: AftercareRebookLockRecord | null,
  ): NonNullable<AftercareRebookLockRecord['booking']> => {
    if (!ref || !ref.booking) {
      throw bookingError('BOOKING_NOT_FOUND')
    }
    if (ref.bookingId !== args.bookingId || ref.booking.id !== args.bookingId) {
      throw bookingError('BOOKING_NOT_FOUND')
    }
    if (ref.booking.clientId !== args.clientId) {
      throw bookingError('BOOKING_NOT_FOUND')
    }
    return ref.booking
  }

  const readAftercareRef = (tx: Prisma.TransactionClient) =>
    tx.aftercareSummary.findUnique({
      where: { id: args.aftercareId },
      select: AFTERCARE_REBOOK_LOCK_SELECT,
    })

  return withLockedProfessionalScheduleByLookup({
    resolveProfessionalId: async (tx) => {
      const aftercareRef = await readAftercareRef(tx)

      if (!args.aftercareClientActionTokenId.trim()) {
        throw bookingError('FORBIDDEN', {
          message: 'Aftercare client action token id is required for client rebook.',
          userMessage: 'That aftercare link is invalid or expired.',
        })
      }

      return assertAftercareRefOwned(aftercareRef).professionalId
    },
    run: async ({ tx, now }) => {
      const booking = assertAftercareRefOwned(await readAftercareRef(tx))

      // K16: the aftercare rebook link creates a NEW appointment the client
      // chose, so the self-serve switch reaches it too. This is the second of
      // the two client-initiated creation paths — missing it would leave the
      // switch true on the booking page and false in the aftercare email, which
      // is a hole in a control that reads as closed.
      await assertClientMaySelfServeBook({
        tx,
        professionalId: booking.professionalId,
        clientId: args.clientId,
      })

      return performLockedCreateRebookedBooking({
        tx,
        now,
        bookingId: booking.id,
        professionalId: booking.professionalId,
        scheduledFor: args.scheduledFor,
        initialStatus: BookingStatus.PENDING,
        // The client picked this minute on the public aftercare link, so it is
        // held to the pro's slot grid — the same rule the client's own hold /
        // finalize flow enforces via checkSlotReadiness. Every slot the
        // RebookCard offers comes from /availability/day, which generates its
        // candidates from that same working-window step grid, so this refuses
        // only a start no client UI could have produced.
        startChosenBy: 'CLIENT',
        clientId: args.clientId,
        aftercareId: args.aftercareId,
        aftercareClientActionTokenId: args.aftercareClientActionTokenId,
        requestedLocationType: args.requestedLocationType ?? null,
        requestedClientAddressId: args.requestedClientAddressId ?? null,
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      })
    },
  })
}

const AFTERCARE_NEXT_APPOINTMENT_SELECT = {
  id: true,
  rebookMode: true,
  rebookedFor: true,
  booking: {
    select: {
      id: true,
      clientId: true,
      professionalId: true,
    },
  },
} satisfies Prisma.AftercareSummarySelect

type AftercareNextAppointmentRecord = Prisma.AftercareSummaryGetPayload<{
  select: typeof AFTERCARE_NEXT_APPOINTMENT_SELECT
}>

type ConfirmClientAftercareNextAppointmentArgs = {
  bookingId: string
  clientId: string
  requestId?: string | null
  idempotencyKey?: string | null
}

/**
 * Session-authenticated confirm of a pro-proposed next appointment
 * (AftercareRebookMode.BOOKED_NEXT_APPOINTMENT). Creates the rebooked booking at
 * the pro's proposed `rebookedFor`, ACCEPTED immediately (the pro already chose
 * the time). Token-free counterpart of createClientRebookedBookingFromAftercare;
 * idempotent on (rebookOfBookingId, clientId, professionalId, scheduledFor).
 */
export async function confirmClientAftercareNextAppointment(
  args: ConfirmClientAftercareNextAppointmentArgs,
): Promise<CreateClientRebookedBookingFromAftercareResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyClientId(args.clientId)

  const loadAftercare = (
    tx: Prisma.TransactionClient,
  ): Promise<AftercareNextAppointmentRecord | null> =>
    tx.aftercareSummary.findUnique({
      where: { bookingId: args.bookingId },
      select: AFTERCARE_NEXT_APPOINTMENT_SELECT,
    })

  const assertConfirmable = (
    record: AftercareNextAppointmentRecord | null,
  ): { aftercareId: string; professionalId: string; scheduledFor: Date } => {
    if (!record || !record.booking) {
      throw bookingError('BOOKING_NOT_FOUND')
    }
    if (record.booking.id !== args.bookingId) {
      throw bookingError('BOOKING_NOT_FOUND')
    }
    if (record.booking.clientId !== args.clientId) {
      throw bookingError('BOOKING_NOT_FOUND')
    }
    if (
      record.rebookMode !== AftercareRebookMode.BOOKED_NEXT_APPOINTMENT ||
      !record.rebookedFor
    ) {
      throw bookingError('AFTERCARE_NOT_COMPLETED', {
        message: 'No proposed next appointment to confirm.',
        userMessage: 'There is no proposed next appointment to confirm.',
      })
    }
    return {
      aftercareId: record.id,
      professionalId: record.booking.professionalId,
      scheduledFor: record.rebookedFor,
    }
  }

  return withLockedProfessionalScheduleByLookup({
    resolveProfessionalId: async (tx) =>
      assertConfirmable(await loadAftercare(tx)).professionalId,
    run: async ({ tx, now }) => {
      const locked = assertConfirmable(await loadAftercare(tx))

      return performLockedCreateRebookedBooking({
        tx,
        now,
        bookingId: args.bookingId,
        professionalId: locked.professionalId,
        scheduledFor: locked.scheduledFor,
        initialStatus: BookingStatus.ACCEPTED,
        // The client is confirming the pro's proposed `rebookedFor`, not choosing
        // a time — holding it to the grid would dead-end them on a minute only
        // the pro can change.
        startChosenBy: 'PRO',
        clientId: args.clientId,
        aftercareId: locked.aftercareId,
        aftercareClientActionTokenId: null,
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      })
    },
  })
}

type DeclineClientAftercareNextAppointmentArgs = {
  bookingId: string
  clientId: string
}

/**
 * Session-authenticated decline of a pro-proposed next appointment. Records the
 * decline (rebookDeclinedAt) while preserving the proposal so the pro can see it
 * was declined and offer another time. The client UI then shows a declined state
 * with a "schedule a different time" path. Cleared when the pro saves a new
 * proposal (see performLockedUpsertBookingAftercare).
 */
export async function declineClientAftercareNextAppointment(
  args: DeclineClientAftercareNextAppointmentArgs,
): Promise<{ ok: true }> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyClientId(args.clientId)

  return prisma.$transaction(async (tx) => {
    const record: AftercareNextAppointmentRecord | null =
      await tx.aftercareSummary.findUnique({
        where: { bookingId: args.bookingId },
        select: AFTERCARE_NEXT_APPOINTMENT_SELECT,
      })

    if (!record || !record.booking || record.booking.id !== args.bookingId) {
      throw bookingError('BOOKING_NOT_FOUND')
    }
    if (record.booking.clientId !== args.clientId) {
      throw bookingError('BOOKING_NOT_FOUND')
    }
    if (record.rebookMode !== AftercareRebookMode.BOOKED_NEXT_APPOINTMENT) {
      throw bookingError('AFTERCARE_NOT_COMPLETED', {
        message: 'No proposed next appointment to decline.',
        userMessage: 'There is no proposed next appointment to decline.',
      })
    }

    await tx.aftercareSummary.update({
      where: { id: record.id },
      data: { rebookDeclinedAt: new Date() },
    })

    return { ok: true as const }
  })
}

// ─── Waitlist offers (pro proposes a time → client confirms) ────────────────────

type CreateWaitlistOfferArgs = {
  professionalId: string
  actorUserId: string
  waitlistEntryId: string
  scheduledFor: Date
  endsAt: Date
  locationId: string
  locationType: ServiceLocationType
  durationMinutes: number
}

type CreateWaitlistOfferResult = {
  offer: {
    id: string
    status: WaitlistOfferStatus
    startsAt: Date
    endsAt: Date
    locationType: ServiceLocationType
    expiresAt: Date
  }
}

/**
 * When a waitlist offer stops being confirmable, which is both the offer's
 * `expiresAt` and its reservation's (F14). Not a caller parameter: the value has
 * to agree with the confirm's own advance-notice rule, and a caller that could
 * pass a longer one would re-open the offer/confirm asymmetry F5 closed.
 *
 * `startsAt − advanceNoticeMinutes` is the exact instant `checkAdvanceNotice`
 * starts refusing the confirm, so an offer that outlived it would be a live card
 * the client cannot accept.
 */
function resolveWaitlistOfferExpiry(args: {
  now: Date
  startsAt: Date
  advanceNoticeMinutes: number
}): Date {
  const ttlExpiry = addMinutes(args.now, WAITLIST_OFFER_TTL_MINUTES)
  const confirmableUntil = addMinutes(
    args.startsAt,
    -Math.max(0, Math.trunc(args.advanceNoticeMinutes)),
  )

  const expiresAt =
    confirmableUntil.getTime() < ttlExpiry.getTime()
      ? confirmableUntil
      : ttlExpiry

  // Unreachable behind the scheduling gate above, which has already required
  // `startsAt >= now + advanceNoticeMinutes` (and, separately, a start at least
  // a minute out). Asserted rather than clamped: silently shipping an offer that
  // is already expired would notify the client about a card that cannot be
  // confirmed, which is the exact failure this card exists to remove.
  if (expiresAt.getTime() <= args.now.getTime()) {
    throw bookingError('ADVANCE_NOTICE_REQUIRED', {
      message: 'Offer would expire before the client could confirm it.',
      userMessage: 'That time is too soon to offer. Pick a later time.',
    })
  }

  return expiresAt
}

/**
 * Everything the pro-facing copy for a withdrawn/expired offer needs, read in
 * the same query that finds the offer. `expiresAt` is here because "was this
 * offer still LIVE when it was withdrawn?" is the only question that decides
 * whether the pro hears about it at all.
 */
const RELEASED_WAITLIST_OFFER_SELECT = {
  id: true,
  startsAt: true,
  expiresAt: true,
  location: { select: { timeZone: true } },
  professional: { select: { timeZone: true } },
} satisfies Prisma.WaitlistOfferSelect

type ReleasedWaitlistOffer = Prisma.WaitlistOfferGetPayload<{
  select: typeof RELEASED_WAITLIST_OFFER_SELECT
}>

/**
 * The offered slot as a human sentence fragment ("Tue, Mar 4 at 2:00 PM"), in
 * the zone the appointment would have happened in — the location's, falling back
 * to the pro's and then the app default, via the standard truth precedence.
 */
function formatOfferedSlotWhen(offer: {
  startsAt: Date
  location: { timeZone: string | null } | null
  professional: { timeZone: string | null } | null
}): string {
  const resolved = resolveApptTimeZoneFromValues({
    locationTimeZone: offer.location?.timeZone,
    professionalTimeZone: offer.professional?.timeZone,
    fallback: DEFAULT_TIME_ZONE,
  })
  const tz = resolved.ok ? resolved.timeZone : DEFAULT_TIME_ZONE

  return `${formatBookingDateLabel(offer.startsAt, tz)} at ${formatBookingTimeLabel(offer.startsAt, tz)}`
}

/**
 * Cancel every still-PENDING offer for a waitlist entry and drop the slot each
 * one was reserving (F14).
 *
 * The two halves belong together: an offer that is no longer PENDING must not
 * keep a slot off the pro's calendar, and the `BookingHold` is the only thing
 * holding it. Cascade would eventually do this if the offer row were deleted,
 * but offers are cancelled, not deleted, so the release is explicit.
 *
 * Caller must already hold the professional's schedule lock.
 */
async function releasePendingWaitlistOffersForEntry(args: {
  tx: Prisma.TransactionClient
  waitlistEntryId: string
  now: Date
}): Promise<{ cancelled: number; released: ReleasedWaitlistOffer[] }> {
  const pending = await args.tx.waitlistOffer.findMany({
    where: {
      waitlistEntryId: args.waitlistEntryId,
      status: WaitlistOfferStatus.PENDING,
    },
    select: RELEASED_WAITLIST_OFFER_SELECT,
  })

  if (pending.length === 0) return { cancelled: 0, released: [] }

  const offerIds = pending.map((offer) => offer.id)

  await args.tx.bookingHold.deleteMany({
    where: { waitlistOfferId: { in: offerIds } },
  })

  const cancelled = await args.tx.waitlistOffer.updateMany({
    where: { id: { in: offerIds } },
    data: { status: WaitlistOfferStatus.CANCELLED, respondedAt: args.now },
  })

  return { cancelled: cancelled.count, released: pending }
}

/**
 * Place the `BookingHold` that reserves a waitlist offer's window (F14).
 *
 * `waitlistOfferId` is what separates this row from a client's own hold: it
 * exempts the reservation from `deleteActiveHoldsForClient` (a client starting
 * an unrelated booking must not silently drop the slot their pro promised them)
 * and from `releaseHold` (declining is how a client gives it back).
 *
 * A collision here means another write won the slot between the gate and this
 * insert while holding the same schedule lock — effectively unreachable, but it
 * maps to a clean `TIME_HELD` rather than a raw 500 for the same reason
 * `performLockedCreateHold` does.
 */
async function createWaitlistOfferHold(args: {
  tx: Prisma.TransactionClient
  offerId: string
  professionalId: string
  clientId: string
  offeringId: string
  locationId: string
  /**
   * The offer's own mode. The hold has to carry it because the overlap /
   * placement machinery reads a hold's `locationType`, and a MOBILE offer
   * reserving a SALON-shaped hold would be reserving the wrong thing.
   *
   * The hold deliberately carries NO client address, unlike a client-side
   * MOBILE hold: this one is pure occupancy on the pro's own calendar, it is
   * deleted before `confirmClientWaitlistOffer` books over it, and nothing reads
   * an address from it. Storing one would be a second copy of the destination
   * for no reader.
   */
  locationType: ServiceLocationType
  locationTimeZone: string
  startsAt: Date
  endsAtSnapshot: Date
  durationMinutes: number
  bufferMinutes: number
  expiresAt: Date
}): Promise<void> {
  try {
    await args.tx.bookingHold.create({
      data: {
        waitlistOfferId: args.offerId,
        professionalId: args.professionalId,
        clientId: args.clientId,
        offeringId: args.offeringId,
        locationId: args.locationId,
        locationType: args.locationType,
        locationTimeZone: args.locationTimeZone,
        scheduledFor: args.startsAt,
        endsAtSnapshot: args.endsAtSnapshot,
        durationMinutesSnapshot: args.durationMinutes,
        bufferMinutesSnapshot: args.bufferMinutes,
        expiresAt: args.expiresAt,
      },
      select: { id: true },
    })
  } catch (error: unknown) {
    const isExactStartCollision =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    const isOverlapCollision = isExclusionConstraintError(
      error,
      HOLD_OVERLAP_CONSTRAINT_NAME,
    )

    if (!isExactStartCollision && !isOverlapCollision) throw error

    logBookingConflict({
      action: 'WAITLIST_OFFER_CREATE',
      professionalId: args.professionalId,
      locationId: args.locationId,
      locationType: args.locationType,
      requestedStart: args.startsAt,
      requestedEnd: args.endsAtSnapshot,
      conflictType: 'HOLD',
      meta: {
        route: 'lib/booking/writeBoundary.ts',
        offeringId: args.offeringId,
        clientId: args.clientId,
        waitlistOfferId: args.offerId,
        layer: 'db_backstop',
        prismaCode: isExactStartCollision ? 'P2002' : '23P01',
        conflictKind: isExactStartCollision ? 'exact_start' : 'overlap_range',
        constraint: HOLD_OVERLAP_CONSTRAINT_NAME,
        note: 'waitlist_offer_hold_backstop_fired',
      },
    })

    // Same F13 rule as the booking-side catches: rival offers were superseded
    // and expired holds swept under the professional's lock before this
    // insert, so a 23P01 means the gate or the lock regressed — page it.
    if (isOverlapCollision) {
      captureOverlapBackstopFired({
        action: 'WAITLIST_OFFER_CREATE',
        professionalId: args.professionalId,
        requestedStart: args.startsAt,
        requestedEnd: args.endsAtSnapshot,
        constraint: HOLD_OVERLAP_CONSTRAINT_NAME,
      })
    }

    throw bookingError('TIME_HELD')
  }
}

/**
 * Pro proposes a concrete appointment time to a waitlisted client (the calendar
 * "Offer a time" action). Creates a PENDING WaitlistOffer, moves the entry to
 * NOTIFIED, and notifies the client to Confirm/Decline. NO booking is created
 * yet — the client's confirm (confirmClientWaitlistOffer) materializes it.
 *
 * In-salon OR mobile — `WAITLIST_FULFILLABLE_MODES` is the list, and this
 * function is one of the three things that list is only allowed to widen
 * alongside. The offer runs the SAME scheduling gate the client's
 * confirm will run (`enforceProCreateScheduling` over the context
 * `performLockedCreateProBooking` re-resolves), with identical flags — because
 * the offer is a promise, and a promise the client cannot accept is a refusal
 * aimed at the one person who cannot act on it. The pro can pick another time;
 * the client, holding the offer, cannot. What can still change between offer
 * and confirm — the pro edits their hours — surfaces at confirm as a clean 4xx
 * with the offer left PENDING.
 *
 * F14 (Tori, 2026-07-21): a pro-CHOSEN time reserves the spot, so the offer also
 * places a `BookingHold` over the window for as long as the offer is live. A
 * hold rather than a Booking precisely because the client still has something to
 * confirm — the aftercare `BOOKED_NEXT_APPOINTMENT` case books outright only
 * because there the client has nothing to accept.
 *
 * A partial unique index enforces one PENDING offer per entry, so any prior
 * still-pending offer for the entry is superseded (CANCELLED) first — and its
 * reservation released BEFORE the gate runs, or a re-offer would collide with
 * the pro's own outstanding promise.
 *
 * ── MOBILE (2026-08-27) ───────────────────────────────────────────────────────
 * A mobile offer promises a TRIP, so three things happen here that do not happen
 * for a salon one:
 *
 *  1. The destination is resolved SERVER-SIDE from the client's own saved
 *     addresses. The pro does not choose it and cannot see it: they are offering
 *     a time to someone whose chart is closed to them (a waitlist relationship
 *     is CONTACT_ONLY), so letting the caller name an address would be asking
 *     the pro for a fact they are not entitled to know.
 *  2. The radius gate runs NOW, at offer time, exactly as it will at confirm —
 *     the promise-site runs the commit-site gate. An out-of-range client is
 *     refused to the PRO, who can act on it, rather than to the client holding
 *     an offer they cannot accept.
 *  3. What the pro is shown before the client accepts — how far, roughly where —
 *     is snapshotted onto the offer row from (2)'s own measurement. The exact
 *     address stays where it was: in the client's record, opening to the pro
 *     only once the accept creates a booking.
 */
export async function createWaitlistOffer(
  args: CreateWaitlistOfferArgs,
): Promise<CreateWaitlistOfferResult> {
  assertNonEmptyProfessionalId(args.professionalId)
  assertNonEmptyUserId(args.actorUserId)
  assertNonEmptyLocationId(args.locationId)
  if (!args.waitlistEntryId.trim()) {
    throw bookingError('WAITLIST_ENTRY_NOT_FOUND')
  }
  assertValidRequestedStart(args.scheduledFor)

  // ONE list, shared with the routes that gate on it (lib/waitlist/hostability).
  // Nothing below assumes a mode any more — every branch reads `locationType` —
  // so widening that list is now a matter of the confirm being able to carry the
  // mode, which for MOBILE it can (the offer stores a client address).
  const locationType = args.locationType
  if (!WAITLIST_FULFILLABLE_MODES.includes(locationType)) {
    throw bookingError('MODE_NOT_SUPPORTED', {
      message: `Waitlist offers do not support ${locationType} appointments.`,
      userMessage: 'You can’t offer a time in that mode right now.',
    })
  }
  const isMobileOffer = locationType === ServiceLocationType.MOBILE

  const startsAt = normalizeToMinute(new Date(args.scheduledFor))
  const requestedEndsAt = new Date(args.endsAt)
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(requestedEndsAt.getTime()) ||
    requestedEndsAt.getTime() <= startsAt.getTime()
  ) {
    throw bookingError('INVALID_SCHEDULED_FOR')
  }
  // Request shape only. The window actually stored (and validated) is derived
  // from the offering below, so the offer never promises a shorter appointment
  // than the confirm will book.
  const requestedDurationMinutes = clampInt(
    args.durationMinutes,
    Math.max(
      15,
      Math.round((requestedEndsAt.getTime() - startsAt.getTime()) / 60_000),
    ),
    15,
    MAX_SLOT_DURATION_MINUTES,
  )

  return withLockedProfessionalTransaction(
    args.professionalId,
    async ({ tx, now }) => {
      if (startsAt.getTime() < now.getTime() + 60_000) {
        throw bookingError('INVALID_SCHEDULED_FOR', {
          message: 'Offer time must be at least 1 minute in the future.',
          userMessage: 'Pick a time in the future.',
        })
      }

      // ACTIVE (never offered) or NOTIFIED (already has a pending offer we're
      // replacing). BOOKED/CANCELLED entries are not offerable — a re-offer to
      // a NOTIFIED entry supersedes its prior PENDING offer below.
      const entry = await tx.waitlistEntry.findFirst({
        where: {
          id: args.waitlistEntryId,
          professionalId: args.professionalId,
          status: { in: [WaitlistStatus.ACTIVE, WaitlistStatus.NOTIFIED] },
        },
        select: { id: true, clientId: true, serviceId: true },
      })
      if (!entry) {
        throw bookingError('WAITLIST_ENTRY_NOT_FOUND')
      }

      // The pro's active offering for the requested service (unique per pro+service).
      const offering = await tx.professionalServiceOffering.findFirst({
        where: {
          professionalId: args.professionalId,
          serviceId: entry.serviceId,
          isActive: true,
        },
        select: {
          id: true,
          offersInSalon: true,
          offersMobile: true,
          salonDurationMinutes: true,
          mobileDurationMinutes: true,
          salonPriceStartingAt: true,
          mobilePriceStartingAt: true,
          service: { select: { name: true } },
          professional: {
            select: {
              // §12 NC1 #25: pro name for the "{pro} has {when} open …" copy.
              ...professionalPublicDisplayNameSelect,
              // Timezone fallback, matching performLockedCreateProBooking.
              timeZone: true,
            },
          },
        },
      })
      if (!offering) {
        throw bookingError('OFFERING_NOT_FOUND')
      }
      if (isMobileOffer ? !offering.offersMobile : !offering.offersInSalon) {
        throw bookingError('MODE_NOT_SUPPORTED', {
          message: `Offering does not support ${locationType} appointments.`,
          userMessage: isMobileOffer
            ? 'This service isn’t offered mobile.'
            : 'This service isn’t offered in-salon.',
        })
      }

      // Kept ahead of the shared resolve purely for the message: a location of
      // the WRONG type for the mode is a mistake the pro can correct, and
      // pickBookableLocation would flatten it into LOCATION_NOT_FOUND.
      const requestedLocation = await tx.professionalLocation.findFirst({
        where: { id: args.locationId, professionalId: args.professionalId },
        select: { id: true, type: true },
      })
      if (!requestedLocation) {
        throw bookingError('LOCATION_NOT_FOUND')
      }
      // The SAME per-mode location-type rule the booking paths use
      // (lib/offerings/locationCapability), so an offer cannot be anchored to a
      // location a booking would then reject.
      const allowedLocationTypes = isMobileOffer
        ? MOBILE_CAPABLE_LOCATION_TYPES
        : SALON_CAPABLE_LOCATION_TYPES
      if (!allowedLocationTypes.includes(requestedLocation.type)) {
        throw bookingError('BAD_LOCATION', {
          message: `Waitlist offers in ${locationType} require a matching location type.`,
          userMessage: isMobileOffer
            ? 'Offer from your mobile base.'
            : 'Offer from an in-salon location.',
        })
      }

      // ── The offer must promise only what the confirm can book (F5) ─────────
      // Everything below mirrors confirmClientWaitlistOffer →
      // performLockedCreateProBooking: same readiness gate, same resolved
      // context, same appointment length, same scheduling policy with the same
      // flags. Anything the pro must fix is refused HERE, to the pro.
      await assertProfessionalIsBookingReady({
        tx,
        professionalId: args.professionalId,
        bookingEntryPoint: 'PRO_CREATED',
      })

      const validatedContextResult = await resolveValidatedBookingContext({
        tx,
        professionalId: args.professionalId,
        requestedLocationId: requestedLocation.id,
        locationType,
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
      const bufferMinutes = clampInt(
        Number(locationContext.bufferMinutes ?? 0),
        0,
        MAX_BUFFER_MINUTES,
      )
      // Waitlist offers carry no add-ons, so the length is the offering's own
      // (a requested total may only extend it) — exactly what confirm derives.
      const { totalDurationMinutes: durationMinutes } =
        resolveProBookingDurations({
          baseDurationMinutes: validatedContextResult.durationMinutes,
          addOnsDurationMinutes: 0,
          requestedTotalDurationMinutes: requestedDurationMinutes,
          stepMinutes: locationContext.stepMinutes,
        })
      const endsAt = addMinutes(startsAt, durationMinutes)

      // ── Where a MOBILE offer travels, and how far ─────────────────────────
      // Resolved from the CLIENT's own saved addresses, never from the caller:
      // the pro is offering a time to someone whose chart they cannot open, so
      // they are in no position to name an address, and asking them to would be
      // the leak this whole flow exists to avoid.
      const offerClientAddress = isMobileOffer
        ? await loadWaitlistOfferDestination({
            clientId: entry.clientId,
            client: tx,
          })
        : null

      if (isMobileOffer && !offerClientAddress) {
        // Refused to the PRO, at offer time — the one moment someone who can act
        // on it is looking. `performLockedCreateProBooking` would throw the same
        // code at confirm, but by then the only person holding the offer is the
        // client, who cannot fix it from there.
        throw bookingError('CLIENT_SERVICE_ADDRESS_REQUIRED', {
          message:
            'Client has no saved service address, so a mobile offer has no destination.',
          userMessage:
            'This client hasn’t saved a service address yet, so there’s nowhere to travel to. Offer an in-salon time, or ask them to add one.',
        })
      }

      // The promise-site running the commit-site gate: the identical check
      // `performLockedCreateProBooking` will run when the client confirms. An
      // out-of-range client is refused here, to the pro.
      //
      // 🔴 The distance shown to the pro is this call's RETURN VALUE, not a
      // second measurement. There is one haversine on this path and it is the
      // one that decided the offer was allowed at all, so the miles on the card
      // cannot disagree with the miles the gate ruled on.
      const tripDistance = await assertMobileBookingWithinRadius({
        tx,
        professionalId: args.professionalId,
        locationType,
        locationLat: locationContext.lat,
        locationLng: locationContext.lng,
        clientAddressId: offerClientAddress?.id ?? null,
        clientLat: decimalToNumber(offerClientAddress?.lat),
        clientLng: decimalToNumber(offerClientAddress?.lng),
      })

      // Coarse by construction: city/state or a postal prefix, built from a row
      // that was never given the street line (see
      // WAITLIST_OFFER_DESTINATION_SELECT). null is a legitimate answer and
      // renders as distance alone.
      const clientAreaLabel = offerClientAddress
        ? buildWaitlistOfferAreaLabel(offerClientAddress)
        : null

      // Supersede BEFORE the gate, not after. A still-pending offer for this
      // entry now holds its own slot, and the gate treats a hold as fatal — so
      // re-offering the same (or an overlapping) time would otherwise refuse
      // against the pro's own outstanding promise. Everything here is inside the
      // one locked transaction, so a refusal below rolls the supersede back.
      await releasePendingWaitlistOffersForEntry({
        tx,
        waitlistEntryId: entry.id,
        now,
      })

      // The hold EXCLUDE constraint has no expiry predicate, so an expired row
      // still occupies the index until the 5-minute sweep cron clears it. The
      // gate ignores expired holds, so without this the insert below could 23P01
      // on a hold the gate had already declared gone. Same reason
      // performLockedCreateHold opens with it.
      await deleteExpiredHoldsForProfessional({
        tx,
        professionalId: args.professionalId,
        now,
      })

      const schedulingDecision = await enforceProCreateScheduling({
        tx,
        now,
        requestedStart: startsAt,
        durationMinutes,
        bufferMinutes,
        workingHours: locationContext.workingHours,
        timeZone: locationContext.timeZone,
        stepMinutes: locationContext.stepMinutes,
        advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
        maxDaysAhead: locationContext.maxDaysAhead,
        // All false, because the confirm has all three false. An override the
        // client's confirm cannot replay would just move the dead end.
        allowShortNotice: false,
        allowFarFuture: false,
        allowOutsideWorkingHours: false,
        // The PRO picked this minute, so the slot grid does not bind them —
        // matching the confirm, which reaches the same gate with the flag off.
        enforceStepGrid: false,
        // No overlap policy runs here: an offer creates no booking, and the
        // confirm refuses a taken slot as a CLIENT. A conflict is fatal now.
        deferBusyConflictsToOverlapPolicy: false,
        action: 'WAITLIST_OFFER_CREATE',
        professionalId: args.professionalId,
        locationId: locationContext.locationId,
        locationType,
        offeringId: offering.id,
        clientId: entry.clientId,
      })

      const expiresAt = resolveWaitlistOfferExpiry({
        now,
        startsAt,
        advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
      })

      const offer = await tx.waitlistOffer.create({
        data: {
          waitlistEntryId: entry.id,
          professionalId: args.professionalId,
          clientId: entry.clientId,
          offeringId: offering.id,
          locationId: locationContext.locationId,
          locationType,
          // Null on every SALON offer. On a MOBILE one this is what makes the
          // client's confirm possible at all: it is handed straight to
          // `performLockedCreateProBooking`, which used to be given a hardcoded
          // null and therefore always threw CLIENT_SERVICE_ADDRESS_REQUIRED.
          clientAddressId: offerClientAddress?.id ?? null,
          // The pro-facing trip summary, snapshotted from the gate's own
          // measurement above. Stored rather than derived on read so the
          // pro-facing query never has to touch ClientAddress at all.
          clientDistanceMiles:
            tripDistance == null
              ? null
              : new Prisma.Decimal(tripDistance.distanceMiles.toFixed(2)),
          clientAreaLabel,
          startsAt,
          endsAt,
          durationMinutes,
          status: WaitlistOfferStatus.PENDING,
          expiresAt,
        },
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true,
          locationType: true,
          expiresAt: true,
        },
      })

      // F14: reserve the slot the pro just chose. The window is the one the gate
      // validated — duration PLUS buffer — so the reservation covers exactly
      // what the confirm will book.
      await createWaitlistOfferHold({
        tx,
        offerId: offer.id,
        professionalId: args.professionalId,
        clientId: entry.clientId,
        offeringId: offering.id,
        locationId: locationContext.locationId,
        locationType,
        locationTimeZone: locationContext.timeZone,
        startsAt,
        endsAtSnapshot: schedulingDecision.requestedEnd,
        durationMinutes,
        bufferMinutes,
        expiresAt,
      })

      await tx.waitlistEntry.update({
        where: { id: entry.id },
        data: { status: WaitlistStatus.NOTIFIED },
      })

      // §12 NC1 #25: name the pro + concrete offered slot, add urgency — and,
      // for a MOBILE offer, say that the pro comes to THEM. This is the first
      // thing the client sees, and the in-salon wording invited them to confirm
      // a home visit while reading a sentence about going somewhere.
      const serviceName = offering.service?.name?.trim() || 'your service'
      const offerProName = formatProfessionalPublicDisplayName(
        offering.professional,
      )
      const offerTz = isValidIanaTimeZone(locationContext.timeZone)
        ? locationContext.timeZone
        : DEFAULT_TIME_ZONE
      const offerWhen = `${formatBookingDateLabel(offer.startsAt, offerTz)} at ${formatBookingTimeLabel(offer.startsAt, offerTz)}`
      await upsertClientNotification({
        tx,
        clientId: entry.clientId,
        eventKey: NotificationEventKey.WAITLIST_TIME_OFFERED,
        title: 'A spot opened up!',
        body: buildWaitlistOfferNotificationBody({
          locationType,
          proName: offerProName,
          when: offerWhen,
          serviceName,
          // The client's own word for the place. They may have several saved
          // addresses and this offer resolved to their DEFAULT, so naming it is
          // what lets them notice it picked the wrong one before confirming.
          addressLabel: offerClientAddress?.label ?? null,
        }),
        dedupeKey: `WAITLIST_TIME_OFFERED:${offer.id}`,
        href: '/client/offers',
        data: {
          waitlistOfferId: offer.id,
          waitlistEntryId: entry.id,
          notificationReason: 'WAITLIST_TIME_OFFERED',
        },
      })

      // The reservation removed a slot from every availability surface (and a
      // superseded one may have freed a different slot), so the cached schedule
      // must not keep serving the old picture.
      await bumpProfessionalScheduleVersion(args.professionalId)

      return { offer: { ...offer, expiresAt } }
    },
  )
}

const WAITLIST_OFFER_CONFIRM_SELECT = {
  id: true,
  status: true,
  clientId: true,
  professionalId: true,
  waitlistEntryId: true,
  offeringId: true,
  locationId: true,
  locationType: true,
  // The MOBILE destination resolved when the offer was made. Only the id: the
  // confirm hands it to `performLockedCreateProBooking`, which re-loads the row
  // under the lock (scoped to this client + SERVICE_ADDRESS), re-checks the
  // radius, and snapshots it onto the booking. Re-checking rather than trusting
  // matters — the client may have edited or moved the address since the offer,
  // and `onDelete: SetNull` may have taken it away entirely.
  clientAddressId: true,
  startsAt: true,
  durationMinutes: true,
  expiresAt: true,
  bookingId: true,
  professional: { select: { userId: true } },
} satisfies Prisma.WaitlistOfferSelect

type WaitlistOfferConfirmRecord = Prisma.WaitlistOfferGetPayload<{
  select: typeof WAITLIST_OFFER_CONFIRM_SELECT
}>

function assertConfirmableWaitlistOffer(
  record: WaitlistOfferConfirmRecord | null,
  clientId: string,
  now: Date,
): WaitlistOfferConfirmRecord {
  // Uniform not-found for missing or foreign offers (no-leak: never distinguish
  // "not yours" from "gone").
  if (!record || record.clientId !== clientId) {
    throw bookingError('WAITLIST_OFFER_NOT_FOUND')
  }
  if (record.status !== WaitlistOfferStatus.PENDING) {
    throw bookingError('WAITLIST_OFFER_NOT_PENDING')
  }
  // Same predicate the readers filter on and the sweep claims rows with, so a
  // card can never be shown as live by one and refused as expired by another.
  if (isWaitlistOfferLapsed(record, now)) {
    throw bookingError('WAITLIST_OFFER_NOT_PENDING', {
      message: 'Waitlist offer has expired.',
      userMessage: 'This offer has expired.',
    })
  }
  return record
}

type ConfirmClientWaitlistOfferArgs = {
  offerId: string
  clientId: string
  requestId?: string | null
  idempotencyKey?: string | null
}

/**
 * Session-authenticated confirm of a pro-proposed waitlist time. Materializes a
 * normal ACCEPTED booking at the offered slot by reusing performLockedCreateProBooking
 * (so working-hours / overlap / pricing rules all apply and the pro-created
 * status is ACCEPTED), then marks the offer ACCEPTED + links the booking and
 * flips the waitlist entry to BOOKED. If the slot was taken since the offer, the
 * create throws TIME_BOOKED (surfaced as 409). Idempotency is enforced at the
 * route layer (withRouteIdempotency) and belt-and-suspenders via the booking's
 * creationIdempotencyKey; a second confirm of an already-accepted offer is
 * rejected with WAITLIST_OFFER_NOT_PENDING.
 */
export async function confirmClientWaitlistOffer(
  args: ConfirmClientWaitlistOfferArgs,
): Promise<CreateProBookingResult> {
  assertNonEmptyClientId(args.clientId)
  if (!args.offerId.trim()) {
    throw bookingError('WAITLIST_OFFER_NOT_FOUND')
  }

  // Pre-lock read to resolve which professional's schedule to lock + fail fast.
  const pre = assertConfirmableWaitlistOffer(
    await prisma.waitlistOffer.findUnique({
      where: { id: args.offerId },
      select: WAITLIST_OFFER_CONFIRM_SELECT,
    }),
    args.clientId,
    new Date(),
  )

  return withLockedProfessionalTransaction(
    pre.professionalId,
    async ({ tx, now }) => {
      const locked = assertConfirmableWaitlistOffer(
        await tx.waitlistOffer.findUnique({
          where: { id: args.offerId },
          select: WAITLIST_OFFER_CONFIRM_SELECT,
        }),
        args.clientId,
        now,
      )

      const actorUserId = locked.professional?.userId
      if (!actorUserId) {
        throw bookingError('PRO_NOT_READY')
      }

      // Hand the reservation back before booking over it (F14). The create below
      // runs the overlap policy as a CLIENT, so this offer's own hold would
      // otherwise refuse the very booking it exists to protect. `deleteMany`
      // rather than `delete`: an idempotent replay reaches here with the hold
      // already consumed.
      await tx.bookingHold.deleteMany({
        where: { waitlistOfferId: locked.id },
      })

      const result = await performLockedCreateProBooking({
        // The CLIENT is confirming an offer, and `overlapActor` below says so —
        // this never reaches the PRO branch. Stated because the field is
        // required, not because it can be reached.
        proLiveHoldOverlap: 'NO_DECISION_SURFACE',
        tx,
        now,
        professionalId: locked.professionalId,
        clientId: args.clientId,
        // The CLIENT confirmed an offer against a WaitlistEntry they wrote
        // themselves — the WAITLIST_ENTRY clause, and the plainest consent
        // there is: they asked for this appointment.
        proCreatedWithoutRelationship: false,
        offeringId: locked.offeringId,
        locationId: locked.locationId,
        locationType: locked.locationType,
        scheduledFor: locked.startsAt,
        // The destination the offer promised. Null for a SALON offer, and null
        // for a MOBILE one whose saved address has since been deleted — which
        // `assertMobileBookingWithinRadius` then refuses with
        // CLIENT_SERVICE_ADDRESS_REQUIRED rather than booking a trip to nowhere.
        //
        // This being hardcoded `null` is what made MOBILE waitlist offers
        // unfulfillable, and why `WAITLIST_FULFILLABLE_MODES` refused to carry
        // the mode at all.
        clientAddressId: locked.clientAddressId,
        internalNotes: null,
        requestedBufferMinutes: null,
        requestedTotalDurationMinutes: locked.durationMinutes,
        allowOutsideWorkingHours: false,
        allowShortNotice: false,
        allowFarFuture: false,
        actorUserId,
        overrideReason: null,
        requestId: args.requestId ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
        // The confirm is the CLIENT accepting a time the pro offered earlier.
        // If the slot was taken between offer and confirm, refuse with a clean
        // TIME_BOOKED instead of inheriting the pro path's authorized overlap.
        overlapActor: {
          kind: 'CLIENT',
          userId: args.clientId,
          clientId: args.clientId,
        },
      })

      await tx.waitlistOffer.update({
        where: { id: locked.id },
        data: {
          status: WaitlistOfferStatus.ACCEPTED,
          bookingId: result.booking.id,
          respondedAt: now,
        },
      })
      await tx.waitlistEntry.update({
        where: { id: locked.waitlistEntryId },
        data: { status: WaitlistStatus.BOOKED },
      })

      // Tell the pro their offered time was confirmed (a real booking now exists).
      await createProNotification({
        tx,
        professionalId: locked.professionalId,
        eventKey: NotificationEventKey.BOOKING_CONFIRMED,
        title: 'Offer confirmed',
        body: `${result.serviceName} — your client confirmed the time you offered.`,
        href: `/pro/bookings/${result.booking.id}`,
        dedupeKey: `WAITLIST_OFFER_ACCEPTED:${locked.id}`,
        data: {
          bookingId: result.booking.id,
          waitlistOfferId: locked.id,
        },
      })

      return result
    },
  )
}

type DeclineClientWaitlistOfferArgs = {
  offerId: string
  clientId: string
}

const WAITLIST_OFFER_DECLINE_SELECT = {
  id: true,
  status: true,
  clientId: true,
  professionalId: true,
  waitlistEntryId: true,
} satisfies Prisma.WaitlistOfferSelect

/**
 * Session-authenticated decline of a pro-proposed waitlist time. Marks the offer
 * DECLINED, releases the slot it was reserving, and returns the entry to ACTIVE
 * (from NOTIFIED) so the pro can offer another time. No booking is created.
 * (A pro-facing "client passed" nudge is intentionally omitted in v1 — the pro
 * sees the entry return to their active waitlist and the offer flip to DECLINED.)
 *
 * Runs under the professional's schedule lock — declining removes occupancy, and
 * every booking/hold state transition serializes the same way (see releaseHold).
 */
export async function declineClientWaitlistOffer(
  args: DeclineClientWaitlistOfferArgs,
): Promise<{ ok: true }> {
  assertNonEmptyClientId(args.clientId)
  if (!args.offerId.trim()) {
    throw bookingError('WAITLIST_OFFER_NOT_FOUND')
  }

  // Pre-lock read to resolve whose schedule to lock, matching the confirm. The
  // ownership and status checks are re-run under the lock below; this one only
  // fails fast.
  const pre = await prisma.waitlistOffer.findUnique({
    where: { id: args.offerId },
    select: WAITLIST_OFFER_DECLINE_SELECT,
  })
  if (!pre || pre.clientId !== args.clientId) {
    throw bookingError('WAITLIST_OFFER_NOT_FOUND')
  }

  return withLockedProfessionalTransaction(pre.professionalId, async ({ tx }) => {
    const offer = await tx.waitlistOffer.findUnique({
      where: { id: args.offerId },
      select: WAITLIST_OFFER_DECLINE_SELECT,
    })
    if (!offer || offer.clientId !== args.clientId) {
      throw bookingError('WAITLIST_OFFER_NOT_FOUND')
    }
    if (offer.status !== WaitlistOfferStatus.PENDING) {
      throw bookingError('WAITLIST_OFFER_NOT_PENDING')
    }

    await tx.waitlistOffer.update({
      where: { id: offer.id },
      data: { status: WaitlistOfferStatus.DECLINED, respondedAt: new Date() },
    })

    // F14: the offer is over, so the slot it reserved goes back on the market.
    await tx.bookingHold.deleteMany({
      where: { waitlistOfferId: offer.id },
    })

    // Return the entry to ACTIVE so the pro can re-offer. Only flip a NOTIFIED
    // entry (the state a sent offer left it in) — never disturb one already
    // BOOKED or CANCELLED.
    await tx.waitlistEntry.updateMany({
      where: {
        id: offer.waitlistEntryId,
        status: WaitlistStatus.NOTIFIED,
      },
      data: { status: WaitlistStatus.ACTIVE },
    })

    await bumpProfessionalScheduleVersion(offer.professionalId)

    return { ok: true as const }
  })
}

type CancelClientWaitlistEntryArgs = {
  entryId: string
  clientId: string
}

type CancelClientWaitlistEntryResult = {
  /** False when the entry was already CANCELLED — a replay, not a no-op error. */
  cancelled: boolean
  /** PENDING offers withdrawn, each of which handed a reserved slot back. */
  releasedOffers: number
  /**
   * True when the pro was told. Strictly narrower than `releasedOffers > 0`: an
   * already-lapsed PENDING offer is still withdrawn (and still frees its slot on
   * paper) but was never a live promise, so it earns no notification.
   */
  notifiedProfessional: boolean
}

/**
 * Client leaves a pro's waitlist (B4).
 *
 * The status flip is the small half. The load-bearing half is that leaving must
 * also withdraw whatever the pro promised in the meantime: a PENDING
 * `WaitlistOffer` reserves a real slot with a `BookingHold` (F14), and a
 * reservation cannot outlive the entry it was made for. This is the ONLY site
 * that cancels an entry, so it is the only site that can know it.
 *
 * Before this existed the route flipped the status and stopped, which broke
 * three ways at once — all of them latent only because no shipped UI called the
 * endpoint ([[fixing-a-dead-path-activates-latent-bugs]]):
 *   1. the slot stayed dark for up to `WAITLIST_OFFER_TTL_MINUTES`;
 *   2. nobody could see why — both pro readers filter entries to
 *      ACTIVE/NOTIFIED, so a CANCELLED entry's reservation is invisible to the
 *      one person whose calendar it occupies ([[reserving-a-slot-needs-a-surface]]);
 *   3. the departed client could still confirm the offer, and the confirm
 *      flipped their own CANCELLED entry to BOOKED.
 *
 * Runs under the professional's schedule lock and reuses
 * `releasePendingWaitlistOffersForEntry` — the same cancel-and-release pair the
 * re-offer path uses to supersede — so "this offer is over" means the same two
 * writes wherever it happens.
 */
export async function cancelClientWaitlistEntry(
  args: CancelClientWaitlistEntryArgs,
): Promise<CancelClientWaitlistEntryResult> {
  assertNonEmptyClientId(args.clientId)
  if (!args.entryId.trim()) {
    throw bookingError('WAITLIST_ENTRY_NOT_FOUND')
  }

  // Pre-lock read to resolve whose schedule to lock. Ownership and status are
  // re-checked under the lock below; this one only picks the lock and fails
  // fast, matching the confirm/decline pair.
  const pre = await prisma.waitlistEntry.findUnique({
    where: { id: args.entryId },
    select: { id: true, clientId: true, professionalId: true },
  })
  if (!pre || pre.clientId !== args.clientId) {
    throw bookingError('WAITLIST_ENTRY_NOT_FOUND')
  }

  const result = await withLockedProfessionalTransaction(
    pre.professionalId,
    async ({ tx, now }) => {
      const entry = await tx.waitlistEntry.findUnique({
        where: { id: args.entryId },
        select: { id: true, clientId: true, status: true },
      })
      if (!entry || entry.clientId !== args.clientId) {
        throw bookingError('WAITLIST_ENTRY_NOT_FOUND')
      }

      // Distinct from NOT_FOUND: the entry exists and became an appointment, so
      // leaving is refused rather than silently swallowed — there is a booking
      // to cancel instead. Reachable as a race (the client confirms an offer in
      // another tab between the pre-read and this lock), which is exactly why
      // the check is re-run here ([[one-code-two-meanings-add-a-code]]).
      if (entry.status === WaitlistStatus.BOOKED) {
        throw bookingError('WAITLIST_ENTRY_ALREADY_BOOKED')
      }

      // Already gone. Idempotent rather than an error: leaving twice is a
      // double-tap, and there is nothing left to release.
      if (entry.status === WaitlistStatus.CANCELLED) {
        return {
          cancelled: false,
          releasedOffers: 0,
          notifiedProfessional: false,
        }
      }

      const { cancelled, released } =
        await releasePendingWaitlistOffersForEntry({
          tx,
          waitlistEntryId: entry.id,
          now,
        })

      await tx.waitlistEntry.update({
        where: { id: entry.id },
        data: { status: WaitlistStatus.CANCELLED },
        select: { id: true },
      })

      // Tell the pro ONLY when the promise they made was still live. Tori's
      // decision, and the reason is that silence is the correct output for the
      // common case: a client leaving a list they were never offered a time on
      // costs the pro nothing and asks nothing of them, so a notification would
      // be pure noise. A live offer is the opposite — a slot the pro deliberately
      // took off their calendar just came back, and they are the only person who
      // can re-offer it.
      //
      // `released` and not `cancelled > 0`: a PENDING offer that had already
      // lapsed is withdrawn here too, but it stopped being a promise when its
      // countdown ran out — the expiry sweep owns that story, and telling it
      // twice would double-notify the pro about one slot.
      const live = released.filter((offer) => !isWaitlistOfferLapsed(offer, now))
      let notifiedProfessional = false

      if (live.length > 0) {
        // At most one offer can be PENDING per entry (partial unique index), so
        // this is a list of one in practice; taking the earliest keeps the copy
        // deterministic if that ever stops being true.
        const soonest = live.reduce((earliest, offer) =>
          offer.startsAt.getTime() < earliest.startsAt.getTime() ? offer : earliest,
        )

        const client = await tx.clientProfile.findUnique({
          where: { id: args.clientId },
          select: { firstName: true, lastName: true },
        })

        await createProNotification({
          tx,
          professionalId: pre.professionalId,
          eventKey: NotificationEventKey.WAITLIST_CLIENT_LEFT,
          title: `${clientNameForProNotification(client)} left your waitlist`,
          body: `Your ${formatOfferedSlotWhen(soonest)} slot is free to re-offer.`,
          href: '/pro/waitlist',
          dedupeKey: `WAITLIST_CLIENT_LEFT:${entry.id}`,
          data: {
            waitlistEntryId: entry.id,
            waitlistOfferId: soonest.id,
            notificationReason: 'WAITLIST_CLIENT_LEFT',
          },
        })

        notifiedProfessional = true
      }

      return { cancelled: true, releasedOffers: cancelled, notifiedProfessional }
    },
  )

  // After commit, and only when a reservation actually went back on the market.
  // An entry with no live offer frees no time, so bumping there would evict the
  // cache on caller-controlled input: "succeeded" is not "changed" (B2,
  // [[cache-is-a-third-query]]).
  if (result.releasedOffers > 0) {
    await bumpProfessionalScheduleVersion(pre.professionalId)
  }

  return result
}

export type ExpireLapsedWaitlistOffersResult = {
  /** Lapsed PENDING offers the query found (before the re-check under lock). */
  considered: number
  /** Offers actually flipped to EXPIRED. */
  expired: number
  /** Entries returned NOTIFIED → ACTIVE. Never more than `expired`. */
  revivedEntries: number
  /** Offers skipped because they stopped being lapsed-and-PENDING under lock. */
  skipped: number
  /** Offers whose own transaction threw. Logged, not fatal to the sweep. */
  failed: number
}

/** Belt on the per-run batch, so one wedged row can never mean an unbounded job. */
const WAITLIST_OFFER_EXPIRY_BATCH = 200

/**
 * Sweep: transition lapsed waitlist offers to EXPIRED and put their clients back
 * on the pro's list.
 *
 * Nothing wrote `WaitlistOfferStatus.EXPIRED`. An offer's `expiresAt` was only
 * ever enforced defensively — the confirm refused a lapsed one, and both readers
 * filtered it out — so the row itself stayed PENDING forever and, worse, its
 * `WaitlistEntry` stayed NOTIFIED forever. DECLINE was the only path back to
 * ACTIVE, which means a client who simply never answered was silently dropped
 * out of the waitlist they were still waiting on: invisible to them, and
 * invisible to the pro, who saw a "already offered" entry they could not re-offer
 * to and no longer had a reason not to.
 *
 * Shape follows the account-deletion sweep: an unlocked query picks candidates,
 * then each one runs in its OWN locked transaction. Per-item, deliberately —
 * a caught error still poisons the surrounding transaction
 * ([[continue-after-a-refusal-needs-its-own-transaction]]), so a single bad row
 * must not take the batch with it. The lock is required for the same reason
 * decline takes it: expiring removes occupancy.
 *
 * Every candidate is RE-CHECKED under its lock. The gap between the unlocked
 * query and the lock is exactly where a client confirms or declines, so the
 * `updateMany` that claims the row carries the full predicate and a zero count
 * means "someone else got there first" — counted as skipped, not failed.
 *
 * `now` is the run's clock, not each transaction's: the claim has to ask the
 * same question the candidate query asked, or a row that lapsed mid-run would be
 * claimed on a predicate the query never applied. An offer that lapses during a
 * run is simply next hour's work.
 *
 * Resumable by construction. One transaction per offer means a run cut short —
 * by the function's `maxDuration`, a deploy, a lock it waited out — keeps every
 * item it already committed, and the next tick re-queries for whatever is left.
 * That is what makes the batch cap safe rather than a silent truncation.
 */
export async function expireLapsedWaitlistOffers(args: {
  now: Date
  limit?: number
}): Promise<ExpireLapsedWaitlistOffersResult> {
  const now = args.now
  const take = clampInt(args.limit, WAITLIST_OFFER_EXPIRY_BATCH, 1, 1000)

  const candidates = await prisma.waitlistOffer.findMany({
    where: lapsedWaitlistOfferWhere(now),
    // Oldest expiry first: if a backlog ever exceeds one batch, the longest-
    // stranded client is the one who gets back on the list first.
    orderBy: { expiresAt: 'asc' },
    take,
    select: {
      // id/startsAt/expiresAt + the two timezone sources for the copy.
      ...RELEASED_WAITLIST_OFFER_SELECT,
      professionalId: true,
      clientId: true,
      waitlistEntryId: true,
    },
  })

  const result: ExpireLapsedWaitlistOffersResult = {
    considered: candidates.length,
    expired: 0,
    revivedEntries: 0,
    skipped: 0,
    failed: 0,
  }

  for (const candidate of candidates) {
    try {
      const outcome = await withLockedProfessionalTransaction(
        candidate.professionalId,
        async ({ tx }) => {
          // The claim. `updateMany` with the whole liveness predicate is what
          // makes this safe against the confirm/decline that may have landed
          // since the query above: count 0 means the row is no longer ours.
          const claimed = await tx.waitlistOffer.updateMany({
            where: { id: candidate.id, ...lapsedWaitlistOfferWhere(now) },
            data: {
              status: WaitlistOfferStatus.EXPIRED,
              respondedAt: now,
            },
          })

          if (claimed.count === 0) return { claimed: false, revived: false }

          // F14: the reservation dies with the offer. The 5-minute hold sweep
          // has almost certainly taken this already (the hold shares the offer's
          // `expiresAt`), but "almost certainly" is not a contract — an offer
          // that is over must not leave a slot dark, whoever gets there first.
          await tx.bookingHold.deleteMany({
            where: { waitlistOfferId: candidate.id },
          })

          // Back on the list. Guarded to NOTIFIED exactly as decline is: an
          // entry the client already re-booked, or left, must not be dragged
          // back to ACTIVE by an offer that lapsed afterwards.
          const revived = await tx.waitlistEntry.updateMany({
            where: {
              id: candidate.waitlistEntryId,
              status: WaitlistStatus.NOTIFIED,
            },
            data: { status: WaitlistStatus.ACTIVE },
          })

          const client = await tx.clientProfile.findUnique({
            where: { id: candidate.clientId },
            select: { firstName: true, lastName: true },
          })

          // Quiet by design: in-app only (see the event definition). The pro is
          // not being asked to do anything urgently — this exists so the entry's
          // reappearance on their waitlist has a reason attached to it.
          await createProNotification({
            tx,
            professionalId: candidate.professionalId,
            eventKey: NotificationEventKey.WAITLIST_OFFER_EXPIRED,
            title: `${clientNameForProNotification(client)} didn’t respond`,
            body: `Your ${formatOfferedSlotWhen(candidate)} offer expired — they’re back on your list.`,
            href: '/pro/waitlist',
            dedupeKey: `WAITLIST_OFFER_EXPIRED:${candidate.id}`,
            data: {
              waitlistOfferId: candidate.id,
              waitlistEntryId: candidate.waitlistEntryId,
              notificationReason: 'WAITLIST_OFFER_EXPIRED',
            },
          })

          return { claimed: true, revived: revived.count > 0 }
        },
      )

      if (!outcome.claimed) {
        result.skipped += 1
        continue
      }

      result.expired += 1
      if (outcome.revived) result.revivedEntries += 1

      // After the commit, and only for a row this run actually expired: the
      // freed window has to leave every cached availability surface.
      await bumpProfessionalScheduleVersion(candidate.professionalId)
    } catch (error: unknown) {
      result.failed += 1
      console.error('expireLapsedWaitlistOffers: offer failed', {
        waitlistOfferId: candidate.id,
        error: safeError(error),
      })
      // A cron sweep with nobody on the other end: `result.failed` is returned
      // in a 200 body that nothing reads. An offer that keeps failing to expire
      // holds its reserved window shut against every other client indefinitely,
      // and the next run re-attempts the same row, so a persistent fault repeats
      // silently rather than resolving.
      //
      // Volume is bounded, not unbounded: WAITLIST_OFFER_EXPIRY_BATCH caps this
      // at 200 events per run and the cron is hourly (vercel.json "35 * * * *"),
      // so the worst case is one Sentry issue collecting 200/hour — the same
      // shape as the credit-settlement captures (MAX_TOP_UPS_PER_RUN = 100) the
      // Tier 1 triage already accepted.
      captureBookingException({
        error,
        route: 'expireLapsedWaitlistOffers',
        event: 'WAITLIST_OFFER_EXPIRY_FAILED',
        professionalId: candidate.professionalId,
      })
    }
  }

  return result
}

type SetClientBookingMediaUseConsentArgs = {
  bookingId: string
  clientId: string
  granted: boolean
}

/**
 * Client grants/revokes media-use consent for this session (B3b): authorizes the
 * pro to feature this booking's photos/video publicly (portfolio/Looks). Sets
 * (or clears) `Booking.mediaUseConsentAt`, which the public-share guard honors
 * (lib/media/publicShareGuard.ts). Consent UNLOCKS the pro's publish action; it
 * does NOT make anything public on its own. Foreign/missing bookings 404.
 */
export async function setClientBookingMediaUseConsent(
  args: SetClientBookingMediaUseConsentArgs,
): Promise<{ ok: true; mediaUseConsent: boolean }> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyClientId(args.clientId)

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: args.bookingId },
      select: { id: true, clientId: true },
    })

    if (!booking || booking.clientId !== args.clientId) {
      throw bookingError('BOOKING_NOT_FOUND')
    }

    await tx.booking.update({
      where: { id: args.bookingId },
      data: { mediaUseConsentAt: args.granted ? new Date() : null },
    })

    return { ok: true as const, mediaUseConsent: args.granted }
  })
}

type SendExistingAftercareDraftArgs = {
  bookingId: string
  professionalId: string
  actorUserId: string
}

/**
 * Send an already-saved aftercare draft to the client straight from the pro's
 * aftercare list (the "Send" action). Flips the draft to sent, queues the
 * magic-link delivery, and raises the AFTERCARE_READY client notification by
 * reusing the exact helpers the full upsert path uses — so there is a single
 * send SSOT and no duplicated delivery/notification logic. Idempotent: a no-op
 * when the summary was already sent. Foreign/missing bookings 404 uniformly.
 */
export async function sendExistingAftercareDraft(
  args: SendExistingAftercareDraftArgs,
): Promise<{ ok: true }> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)
  assertNonEmptyUserId(args.actorUserId)

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: args.bookingId },
      select: AFTERCARE_UPSERT_BOOKING_SELECT,
    })

    if (!booking || booking.professionalId !== args.professionalId) {
      throw bookingError('BOOKING_NOT_FOUND')
    }

    const aftercare = booking.aftercareSummary
    if (!aftercare) {
      throw bookingError('AFTERCARE_NOT_COMPLETED', {
        message: 'No aftercare draft exists to send.',
        userMessage: 'Start an aftercare summary before sending it.',
      })
    }

    // Already sent → idempotent success (the list simply hadn't refreshed yet).
    if (aftercare.sentToClientAt) {
      return { ok: true as const }
    }

    await maybeCreateAftercareAccessDeliveryInBoundary({
      tx,
      booking,
      aftercareId: aftercare.id,
      aftercareVersion: aftercare.version,
      actorUserId: args.actorUserId,
      shouldAttempt: true,
      resendMode: 'INITIAL_SEND',
    })

    await tx.aftercareSummary.update({
      where: { id: aftercare.id },
      data: { sentToClientAt: new Date(), draftSavedAt: null },
    })

    // §12 NC1 #16: aligned heading + no raw notes in the body (privacy win).
    const aftercareServiceLabel = booking.service?.name?.trim() || 'appointment'
    await createUpdateClientNotification({
      tx,
      clientId: booking.clientId,
      bookingId: booking.id,
      aftercareId: aftercare.id,
      eventKey: NotificationEventKey.AFTERCARE_READY,
      title: 'Your aftercare is ready',
      body: `Your pro added aftercare notes and rebooking for your ${aftercareServiceLabel}. Tap to view.`,
      dedupeKey: makeAftercareClientNotifDedupeKey(booking.id),
      href: `/client/bookings/${booking.id}?step=aftercare`,
      data: {
        bookingId: booking.id,
        aftercareId: aftercare.id,
        notificationReason: 'AFTERCARE_SENT',
      },
      requestedChannels: AFTERCARE_INBOX_NOTIFICATION_CHANNELS,
    })

    return { ok: true as const }
  })
}

type NudgeAftercareRebookArgs = {
  bookingId: string
  professionalId: string
  actorUserId: string
}

/**
 * Re-ping a client about an aftercare the pro already sent (the "Nudge" action
 * on sent cards). Re-delivers the aftercare magic link — RESEND revokes the
 * outstanding token and issues a fresh one — and refreshes the AFTERCARE_READY
 * notification. Only valid once the summary has been sent; spam protection is
 * enforced by the caller's rate limit.
 */
export async function nudgeAftercareRebook(
  args: NudgeAftercareRebookArgs,
): Promise<{ ok: true }> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyProfessionalId(args.professionalId)
  assertNonEmptyUserId(args.actorUserId)

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: args.bookingId },
      select: AFTERCARE_UPSERT_BOOKING_SELECT,
    })

    if (!booking || booking.professionalId !== args.professionalId) {
      throw bookingError('BOOKING_NOT_FOUND')
    }

    const aftercare = booking.aftercareSummary
    if (!aftercare || !aftercare.sentToClientAt) {
      throw bookingError('AFTERCARE_NOT_COMPLETED', {
        message: 'Aftercare must be sent before it can be nudged.',
        userMessage: 'Send the aftercare before nudging the client.',
      })
    }

    await maybeCreateAftercareAccessDeliveryInBoundary({
      tx,
      booking,
      aftercareId: aftercare.id,
      aftercareVersion: aftercare.version,
      actorUserId: args.actorUserId,
      shouldAttempt: true,
      resendMode: 'RESEND',
    })

    // §12 NC1 #16: aligned heading + no raw notes in the body (privacy win).
    const aftercareServiceLabel = booking.service?.name?.trim() || 'appointment'
    await createUpdateClientNotification({
      tx,
      clientId: booking.clientId,
      bookingId: booking.id,
      aftercareId: aftercare.id,
      eventKey: NotificationEventKey.AFTERCARE_READY,
      title: 'Your aftercare is ready',
      body: `Your pro added aftercare notes and rebooking for your ${aftercareServiceLabel}. Tap to view.`,
      dedupeKey: makeAftercareClientNotifDedupeKey(booking.id),
      href: `/client/bookings/${booking.id}?step=aftercare`,
      data: {
        bookingId: booking.id,
        aftercareId: aftercare.id,
        notificationReason: 'AFTERCARE_NUDGE',
      },
      requestedChannels: AFTERCARE_INBOX_NOTIFICATION_CHANNELS,
    })

    return { ok: true as const }
  })
}

// ---------------------------------------------------------------------------
// Stripe checkout — single internal boundary
// ---------------------------------------------------------------------------

const STRIPE_DEFAULT_CURRENCY = DEFAULT_CHARGE_CURRENCY

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

/**
 * The Stripe line-item description — it reaches the client's checkout page AND
 * their card statement, so it is the most externally visible string the booking
 * boundary produces. It must carry the brand of the tenant the booking belongs
 * to, never the platform's.
 *
 * Resolution goes through `getBrandForTenantContext`, which is an exact registry
 * lookup: an unregistered white-label slug falls back to the platform brand
 * explicitly. Do NOT swap this for `getBrandConfig()` — that walks a host ->
 * NEXT_PUBLIC_BRAND chain, which would show one tenant's client whatever brand
 * the deployment happens to be configured with.
 */
function buildStripeLineItemDescription(args: {
  bookingId: string
  serviceName: string | null
  proTenant: { id: string; slug: string }
}): string {
  const brandName = getBrandForTenantContext(
    tenantContextFor({ tenantId: args.proTenant.id, slug: args.proTenant.slug }),
  ).displayName

  const trimmed = args.serviceName?.trim() ?? ''
  return trimmed
    ? `${brandName} booking: ${trimmed}`
    : `${brandName} booking ${args.bookingId}`
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
  applyCreatorCredit: boolean
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
    throw bookingError('BOOKING_NOT_FOUND')
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

  // K10-A: the deposit the client already paid comes OFF this bill. Derived
  // against the ROLLUP's total, not the stored one — products and tip may have
  // just changed it, and a credit sized from a stale total would either
  // over-charge or settle a bill that is no longer covered.
  const depositCredit = deriveDepositCredit({
    depositStatus: booking.depositStatus,
    depositAmount: booking.depositAmount,
    depositRefundedCents: booking.depositRefundedCents,
    depositDisputedAt: booking.depositDisputedAt,
    totalAmount: rollup.totalAmount,
  })

  // Platform-funded creator credit, applied ONLY when the client asked for it
  // on this booking — it is a manual per-booking toggle, never auto-applied
  // (Tori, 2026-08-17).
  //
  // Sized against what the DEPOSIT left due, not against the total: crediting
  // past a bill a deposit already covered would reserve balance for money nobody
  // owes and then owe the pro a top-up for it. `reserveClientCreditForBooking`
  // returns 0 for an empty balance, which is an ordinary answer.
  //
  // Turning the toggle OFF is a release, not a no-op — otherwise a client who
  // changed their mind would still have the balance held against this booking.
  let creatorCreditCents = 0
  if (args.applyCreatorCredit) {
    creatorCreditCents = await reserveClientCreditForBooking(args.tx, {
      clientId: booking.clientId,
      bookingId: booking.id,
      maxApplicableCents: depositCredit.amountDueCents,
      now: args.now,
    })
  } else {
    await releaseClientCreditForBooking(args.tx, {
      bookingId: booking.id,
      now: args.now,
    })
  }

  const amountCents = Math.max(
    0,
    depositCredit.amountDueCents - creatorCreditCents,
  )

  // Closeout at zero. `coversTotal` is false for a zero/absent total, so a bill
  // with nothing on it still falls through to the refusal below rather than
  // closing itself out. Credit can close the same gap the deposit does — a $5
  // balance on a $4 bill leaves nothing to charge, and Stripe has no $0 charge.
  const nothingLeftToCharge =
    depositCredit.coversTotal ||
    (depositCredit.totalCents > 0 && amountCents <= 0)

  if (nothingLeftToCharge) {
    return settleClientCheckoutWithNothingDue({
      tx: args.tx,
      now: args.now,
      booking,
      rollup,
      depositCredit,
      creatorCreditCents,
      requestId: args.requestId ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
    })
  }

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
    outcome: 'STRIPE_SESSION',
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
        proTenant: booking.proTenant,
      }),
      connectedAccountId: paymentSettings.stripeAccountId,
    },
    depositCreditCents: depositCredit.creditCents,
    creatorCreditCents,
    meta: buildMeta(mutated),
  }
}

/**
 * Closeout at zero (K10-A): the client's paid deposit — and, since the creator
 * credit shipped, any balance they chose to put against the rest — covers the
 * entire final bill, so there is nothing left to charge. Settles the checkout
 * PAID in the SAME locked transaction that discovered it, stamping
 * `depositCreditedAt` — the column whose schema comment ("when the deposit was
 * applied against the final total") described a write that did not exist until
 * K10-A.
 *
 * 🔴 No Stripe session is created and no PaymentIntent is touched. The deposit
 * charge already settled to the pro on its own PaymentIntent; the money has
 * moved, and this is the bookkeeping that records it against the bill. Because
 * the final-bill PI captures nothing on this path, `stripeAmountTotal` stays
 * null and the refund rail's over-refund guard (captured − reserved) has
 * nothing to give back here — a refund correctly has to go through the DEPOSIT
 * PI's own guard instead.
 *
 * `paymentProvider`/`selectedPaymentMethod` are deliberately NOT stamped
 * STRIPE_CARD: the client did not present a card for this bill. Leaving them
 * alone keeps M2's abandoned-checkout residual rule intact.
 *
 * 🔴 When CREDIT closed the gap, the client's balance is committed here (there
 * is no later webhook on this path to do it) and the platform now owes this
 * pro the credited amount — settled by the top-up drain, which finds the row by
 * its null `platformTopUpAt`. Without that commit the client would pay nothing
 * and keep the balance too.
 */
async function settleClientCheckoutWithNothingDue(args: {
  tx: Prisma.TransactionClient
  now: Date
  booking: ClientStripeCheckoutBookingRecord
  rollup: Awaited<ReturnType<typeof buildBookingCheckoutRollupUpdate>>
  depositCredit: ReturnType<typeof deriveDepositCredit>
  /** Balance the client put against this bill (0 when the deposit alone did it). */
  creatorCreditCents: number
  requestId: string | null
  idempotencyKey: string | null
}): Promise<PrepareClientStripeCheckoutSessionResult> {
  const { booking, rollup } = args

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

  // The bill is closing right here, so the reservation has to become a real
  // spend now: this path opens no Stripe session, so no webhook will ever come
  // back to commit it, and a PENDING row left behind would be handed back by the
  // settlement sweep as if the client had never spent it.
  if (args.creatorCreditCents > 0) {
    await applyClientCreditForBooking(args.tx, {
      bookingId: booking.id,
      now: args.now,
    })
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
      checkoutStatus: BookingCheckoutStatus.PAID,
      paymentAuthorizedAt: booking.paymentAuthorizedAt ?? args.now,
      paymentCollectedAt: args.now,
      // Only stamp the DEPOSIT's own column when a deposit actually did the
      // covering. A bill closed by credit alone never had a deposit applied to
      // it, and dating one would be a false entry in the money trail.
      ...(args.depositCredit.creditCents > 0
        ? { depositCreditedAt: booking.depositCreditedAt ?? args.now }
        : {}),
    },
    select: {
      id: true,
      professionalId: true,
      serviceSubtotalSnapshot: true,
      productSubtotalSnapshot: true,
      subtotalSnapshot: true,
      tipAmount: true,
      taxAmount: true,
      discountAmount: true,
      totalAmount: true,
      checkoutStatus: true,
      selectedPaymentMethod: true,
      paymentProvider: true,
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
    route:
      'lib/booking/writeBoundary.ts:settleClientCheckoutWithNothingDue',
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    oldState,
    newState,
  })

  return {
    outcome: 'SETTLED_NOTHING_DUE',
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
    depositCreditCents: args.depositCredit.creditCents,
    creatorCreditCents: args.creatorCreditCents,
    meta: buildMeta(!areAuditValuesEqual(oldState, newState)),
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
    throw bookingError('BOOKING_NOT_FOUND')
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
        applyCreatorCredit: args.applyCreatorCredit === true,
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
// Discovery deposit collection (up-front charge that carries the platform fee)
// ---------------------------------------------------------------------------

export const DISCOVERY_DEPOSIT_CHECKOUT_KIND = 'DISCOVERY_DEPOSIT'

/**
 * `metadata.kind` stamped on a no-show / late-cancel fee PaymentIntent
 * (lib/noShowProtection/charge.ts). Like the discovery-deposit kind, the Stripe
 * webhook MUST branch on this so a fee PI's `payment_intent.succeeded/failed` —
 * which carries this booking's `metadata.bookingId` — is NOT misrouted into the
 * FINAL-BILL applier (`findBookingForStripeWebhook` resolves the hint first, so
 * without this guard a $25 fee would record as the booking's payment). Single
 * source of truth for the string shared by the producer + the webhook guard.
 */
export const NO_SHOW_FEE_CHARGE_KIND = 'NO_SHOW_FEE'

type PrepareClientDepositCheckoutResult = {
  booking: { id: string; professionalId: string }
  stripe: {
    depositCents: number
    /** The CLIENT convenience fee — billed on top of the deposit. */
    feeCents: number
    /** The PRO's fee — NOT billed to the client; it rides the application fee. */
    proFeeCents: number
    /** deposit + client fee — what the customer is charged. */
    totalCents: number
    /**
     * client fee + pro fee — the Stripe `application_fee_amount`. Stripe transfers
     * the full `totalCents` to the pro and pulls this back, so the pro nets
     * `depositCents - proFeeCents`. Capped at `totalCents` by Stripe; the pro fee is
     * already clamped to the deposit upstream so it cannot exceed it.
     */
    applicationFeeCents: number
    currency: string
    connectedAccountId: string
    lineItemDescription: string
  }
  meta: MutationMeta
}

/**
 * Prepare a Stripe Checkout for a brand-new client's discovery deposit + one-time
 * platform fee. Unlike the post-service client checkout, this fires at booking time
 * and is the only charge that carries the platform fee (as the application fee).
 * Validates the booking is the client's, has a PENDING discovery deposit, and that
 * the pro can actually receive a destination charge.
 */
export async function prepareClientDepositCheckout(args: {
  bookingId: string
  clientId: string
  requestId?: string | null
  idempotencyKey?: string | null
}): Promise<PrepareClientDepositCheckoutResult> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyClientId(args.clientId)

  return withLockedClientOwnedBookingTransaction({
    bookingId: args.bookingId,
    clientId: args.clientId,
    run: async ({ tx }) => {
      const booking = await tx.booking.findUnique({
        where: { id: args.bookingId },
        select: {
          id: true,
          clientId: true,
          professionalId: true,
          status: true,
          depositStatus: true,
          depositAmount: true,
          discoveryFeeAmount: true,
          proDiscoveryFeeAmount: true,
          depositPaidAt: true,
          service: { select: { name: true } },
          // Brand shown on the client's checkout page and card statement.
          proTenant: { select: { id: true, slug: true } },
          professional: {
            select: {
              paymentSettings: {
                select: {
                  stripeAccountId: true,
                  stripeChargesEnabled: true,
                  stripePayoutsEnabled: true,
                },
              },
            },
          },
        },
      })

      if (!booking) throw bookingError('BOOKING_NOT_FOUND')
      if (booking.clientId !== args.clientId) throw bookingError('BOOKING_NOT_FOUND')
      if (booking.status === BookingStatus.CANCELLED) {
        throw bookingError('BOOKING_CANNOT_EDIT_CANCELLED')
      }

      if (
        booking.depositStatus !== BookingDepositStatus.PENDING ||
        booking.depositPaidAt
      ) {
        throw bookingError('FORBIDDEN', {
          message: 'No pending deposit to collect for this booking.',
          userMessage: 'There is no deposit due for this booking.',
        })
      }

      const settings = booking.professional.paymentSettings
      const connectedAccountId = settings?.stripeAccountId ?? null
      if (
        !connectedAccountId ||
        !settings?.stripeChargesEnabled ||
        !settings?.stripePayoutsEnabled
      ) {
        throw bookingError('FORBIDDEN', {
          message: 'Pro is not ready to receive a deposit charge.',
          userMessage: 'This pro cannot collect a deposit yet.',
        })
      }

      const depositCents = decimalToCents(booking.depositAmount)
      const feeCents = Math.max(0, booking.discoveryFeeAmount ?? 0)
      // The pro's fee is NOT part of what the customer pays — it only widens the
      // application fee, which is how it comes out of the pro's payout. Clamped to
      // the deposit here as well as at stamp time: Stripe rejects an application fee
      // larger than the charge, and a legacy row could carry an unclamped value.
      const proFeeCents = Math.min(
        Math.max(0, booking.proDiscoveryFeeAmount ?? 0),
        depositCents,
      )
      const totalCents = depositCents + feeCents

      if (totalCents <= 0) {
        throw bookingError('FORBIDDEN', {
          message: 'Deposit charge requires a positive amount.',
          userMessage: 'There is no deposit due for this booking.',
        })
      }

      return {
        booking: { id: booking.id, professionalId: booking.professionalId },
        stripe: {
          depositCents,
          feeCents,
          proFeeCents,
          totalCents,
          applicationFeeCents: feeCents + proFeeCents,
          currency: STRIPE_DEFAULT_CURRENCY,
          connectedAccountId,
          lineItemDescription: buildStripeLineItemDescription({
            bookingId: booking.id,
            serviceName: booking.service?.name ?? null,
            proTenant: booking.proTenant,
          }),
        },
        meta: buildMeta(false),
      }
    },
  })
}

/**
 * Persist the deposit PaymentIntent id once the Checkout Session is created, so the
 * webhook can match the deposit payment back to this booking. The deposit stays
 * PENDING until the webhook confirms payment.
 */
export async function recordDepositCheckoutAttached(args: {
  bookingId: string
  clientId: string
  stripePaymentIntentId: string | null
}): Promise<void> {
  assertNonEmptyBookingId(args.bookingId)
  assertNonEmptyClientId(args.clientId)

  if (!args.stripePaymentIntentId) return

  await prisma.booking.updateMany({
    where: {
      id: args.bookingId,
      clientId: args.clientId,
      depositStatus: BookingDepositStatus.PENDING,
    },
    data: { depositStripePaymentIntentId: args.stripePaymentIntentId },
  })
}

export type ApplyDepositResult = {
  handled: boolean
  alreadyPaid: boolean
  bookingId: string | null
  /**
   * The deposit money is (now) recorded on a CANCELLED booking — the cancel-time
   * refund helpers skipped it because the deposit had not landed locally yet.
   * The caller must run applyLateCaptureCancelRefund AFTER its transaction
   * commits (Stripe I/O cannot live in the webhook transaction).
   */
  capturedOnCancelledBooking: boolean
}

/**
 * Mark a discovery deposit paid from a Stripe webhook. Idempotent: a second
 * delivery for an already-paid deposit is a no-op. Matched by the deposit PI id.
 */
export async function applyStripeDepositSucceededInTransaction(
  tx: Prisma.TransactionClient,
  args: {
    now?: Date
    stripePaymentIntentId: string
    chargeId: string | null
    bookingIdHint?: string | null
  },
): Promise<ApplyDepositResult> {
  const now = args.now ?? new Date()

  const booking = await tx.booking.findFirst({
    where: { depositStripePaymentIntentId: args.stripePaymentIntentId },
    select: { id: true, depositStatus: true, status: true },
  })

  const resolved =
    booking ??
    (args.bookingIdHint
      ? await tx.booking.findUnique({
          where: { id: args.bookingIdHint },
          select: { id: true, depositStatus: true, status: true },
        })
      : null)

  if (!resolved) {
    return {
      handled: false,
      alreadyPaid: false,
      bookingId: null,
      capturedOnCancelledBooking: false,
    }
  }

  if (resolved.depositStatus === BookingDepositStatus.PAID) {
    // Replay path: the money already landed. Still flag a CANCELLED booking so
    // a redelivery can re-trigger the refund attempt if the first one failed
    // (the refund itself is idempotent — PAID→REFUNDED claims exactly once).
    return {
      handled: true,
      alreadyPaid: true,
      bookingId: resolved.id,
      capturedOnCancelledBooking: resolved.status === BookingStatus.CANCELLED,
    }
  }

  const updated = await tx.booking.update({
    where: { id: resolved.id },
    data: {
      depositStatus: BookingDepositStatus.PAID,
      depositPaidAt: now,
      depositStripePaymentIntentId: args.stripePaymentIntentId,
      depositStripeChargeId: args.chargeId,
    },
    // Status must come from the UPDATE's row, not the read above: this applier
    // takes no schedule lock, so a concurrent cancel can commit between the
    // read and this write. The update waits on that cancel's row lock, so the
    // returned status is current — and a cancel that has NOT committed yet will
    // itself wait on ours, then find the deposit PAID and refund on its side.
    select: { status: true } satisfies Prisma.BookingSelect,
  })

  // The deposit is now paid — drop the pending M5 auto-release nudge so it never
  // fires for a paid booking. (The reminder validator also self-heals; this just
  // clears the inbox row eagerly.)
  await cancelScheduledClientNotificationsForBooking({
    tx,
    bookingId: resolved.id,
    eventKeys: [NotificationEventKey.DEPOSIT_REMINDER],
  })

  // K10-B-1: the unclaimed client's scheduled pay-link nudge does NOT self-heal
  // — the dispatch drain never revalidates deposit state — so the paid commit
  // point must cancel it, or the client is texted to pay a deposit they just
  // paid. Every paid path lands here (live webhook, redelivery, M14 recovery).
  await cancelDepositPaymentNudgeDispatch({
    tx,
    bookingId: resolved.id,
    now,
  })

  return {
    handled: true,
    alreadyPaid: false,
    bookingId: resolved.id,
    capturedOnCancelledBooking: updated.status === BookingStatus.CANCELLED,
  }
}

/**
 * Reconcile a `charge.refunded` webhook against a DEPOSIT PaymentIntent (matched by
 * depositStripePaymentIntentId), for refunds issued out-of-band (e.g. the Stripe
 * dashboard). Marks the deposit REFUNDED, and on a FULL refund also stamps
 * discoveryFeeRefundedAt (refund-reset). Never clears an already-set fee-refund
 * timestamp. Returns handled:false when the PI is not a deposit PI (so the caller
 * falls through to the normal final-bill reconcile).
 */
export async function reconcileDepositChargeRefundInTransaction(
  tx: Prisma.TransactionClient,
  args: {
    paymentIntentId: string
    amountRefundedCents: number
    chargeAmountCents: number
    now?: Date
  },
): Promise<{ handled: boolean }> {
  const booking = await tx.booking.findFirst({
    where: { depositStripePaymentIntentId: args.paymentIntentId },
    select: {
      id: true,
      discoveryFeeRefundedAt: true,
      depositStatus: true,
      discoveryFeeAmount: true,
      depositRefundedCents: true,
    },
  })

  if (!booking) return { handled: false }

  // `amountRefundedCents` is Stripe's authoritative cumulative refund on the
  // deposit charge. Take a monotonic max so an out-of-order webhook reporting a
  // stale (smaller) total can't roll the counter back.
  const prevRefundedCents = booking.depositRefundedCents
  const nextRefundedCents = Math.max(prevRefundedCents, args.amountRefundedCents)

  // The deposit charge = deposit portion + the platform fee (application fee).
  // depositStatus tracks the DEPOSIT portion returned to the client, so flip to
  // REFUNDED only once that portion is fully back; a sub-deposit partial (e.g. a
  // dashboard refund) stays PAID + records cents so it can't block a later refund
  // (N5). The fee timestamp still keys on the FULL charge being refunded.
  const feeCents = booking.discoveryFeeAmount ?? 0
  const depositPortionCents = Math.max(0, args.chargeAmountCents - feeCents)
  const depositPortionFullyRefunded =
    depositPortionCents > 0 && nextRefundedCents >= depositPortionCents
  const fullChargeRefunded =
    args.chargeAmountCents > 0 && nextRefundedCents >= args.chargeAmountCents

  await tx.booking.update({
    where: { id: booking.id },
    data: {
      depositRefundedCents: nextRefundedCents,
      ...(depositPortionFullyRefunded
        ? { depositStatus: BookingDepositStatus.REFUNDED }
        : {}),
      // Only a full refund returns the fee; never clear an existing timestamp.
      ...(fullChargeRefunded && !booking.discoveryFeeRefundedAt
        ? { discoveryFeeRefundedAt: args.now ?? new Date() }
        : {}),
    },
  })

  // Emit a refund receipt whenever the cumulative refunded amount rises (each
  // partial included). The discriminator carries the new cumulative so a
  // `charge.refunded` replay at the same total dedupes; the amount is the delta
  // (this refund). App-initiated refunds already advanced the counter, so this
  // sees no rise and stays silent — they notify via their own path.
  if (nextRefundedCents > prevRefundedCents) {
    await emitPaymentRefundedNotifications({
      tx,
      bookingId: booking.id,
      refundDiscriminator: buildAuxRefundDiscriminator({
        kind: 'deposit',
        paymentIntentId: args.paymentIntentId,
        cumulativeRefundedCents: nextRefundedCents,
      }),
      amountRefundedCents: nextRefundedCents - prevRefundedCents,
    })
  }

  return { handled: true }
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

  // Out-of-order protection: a dispute is a more-recent, higher-severity state
  // than a (re-delivered) `payment_intent.succeeded`. Stripe does not guarantee
  // webhook ordering and our requeue/orphan-recovery paths can replay a stale
  // success — never let that silently flip a DISPUTED booking back to SUCCEEDED.
  // A genuinely won dispute is restored explicitly via
  // applyStripeDisputeInTransaction, not here.
  if (booking.stripePaymentStatus === StripePaymentStatus.DISPUTED) {
    return {
      bookingId: booking.id,
      bookingCompleted: booking.status === BookingStatus.COMPLETED,
      meta: buildMeta(false),
    }
  }

  // Idempotency is keyed on the booking's terminal payment STATE, not on which
  // event id last touched it. payment_intent.succeeded for a booking's single PI
  // is one logical fact however many ways it arrives — a live webhook redelivery,
  // the requeue cron, or the orphan-recovery sweep (which previously applied under
  // a synthetic `orphan_recovery:*` id). Matching on event-id equality let a
  // second path with a different id RE-apply (redundant closeout + duplicate
  // audit log + a misleading mutated=true). Once SUCCEEDED + PAID + collected, the
  // success is recorded; any later arrival no-ops. (A won dispute restores
  // SUCCEEDED via applyStripeDisputeInTransaction, which is the only way back here,
  // and that path is what re-enables refunds.)
  const alreadyApplied =
    booking.stripePaymentStatus === StripePaymentStatus.SUCCEEDED &&
    booking.checkoutStatus === BookingCheckoutStatus.PAID &&
    booking.paymentCollectedAt !== null

  if (alreadyApplied) {
    // Replay path: still flag a CANCELLED booking so a redelivery can
    // re-trigger the late-capture refund if the first attempt failed (the
    // refund path itself is idempotent per reserved row).
    return {
      bookingId: booking.id,
      bookingCompleted: booking.status === BookingStatus.COMPLETED,
      meta: buildMeta(false),
      capturedOnCancelledBooking: booking.status === BookingStatus.CANCELLED,
    }
  }

  // M9 — did the pro already close this booking out by hand before the card
  // charge landed? A manual mark-paid (PAID) or waive (WAIVED) stamps
  // paymentCollectedAt while stripePaymentStatus is still NOT_STARTED; the normal
  // card flow has paymentCollectedAt == null at this point. So a non-null
  // paymentCollectedAt on a not-yet-SUCCEEDED booking means this card capture is
  // an OVER-COLLECTION on top of a manual close-out (double collection, or a
  // charge despite a waive). The money is already captured at Stripe — we still
  // record it below (it IS the money that moved), but the caller must page a
  // human to refund the card. Read from the pre-update row: the applier holds the
  // pro schedule lock the manual close-out also takes, so this reflects the
  // committed manual write. (The DISPUTED / already-SUCCEEDED replays returned
  // above, so this only fires on the first application onto a manual close-out.)
  const capturedAfterManualCloseout =
    booking.paymentCollectedAt !== null &&
    booking.stripePaymentStatus !== StripePaymentStatus.SUCCEEDED

  // Reconcile captured vs expected: the captured amount IS the money that moved,
  // so we still record it below — but a mismatch against the booking's expected
  // total means a short-pay / over-pay / wrong-currency capture that must be
  // surfaced for human reconciliation instead of being accepted as truth
  // silently. Only meaningful once a total is set.
  const expectedTotalCents = decimalToCents(booking.totalAmount)
  if (
    args.amountReceivedCents != null &&
    expectedTotalCents > 0 &&
    args.amountReceivedCents !== expectedTotalCents
  ) {
    captureStripeAmountMismatch({
      bookingId: booking.id,
      expectedCents: expectedTotalCents,
      receivedCents: args.amountReceivedCents,
      currency: args.currency ?? booking.stripeCurrency,
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

  // 🔴 The charge that just settled was sized with the client's credit already
  // taken off it, so the reservation is now genuinely spent — commit it in the
  // same transaction that records the payment. This is also the moment the
  // platform's debt to the pro becomes real: the destination charge transferred
  // only what the client paid, and the settlement job pays the rest.
  //
  // Idempotent by its own `where` (only PENDING/RELEASED rows move), so a
  // replayed webhook cannot double-spend a balance.
  await applyClientCreditForBooking(args.tx, {
    bookingId: booking.id,
    now: args.now,
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
    // From the UPDATE's returned row (not the earlier read): this applier runs
    // under the schedule lock the cancel paths also take, and the update's row
    // reflects any cancel that committed first — so a payment applying onto a
    // CANCELLED booking is always flagged for the post-commit refund.
    capturedOnCancelledBooking: updated.status === BookingStatus.CANCELLED,
    // M9 — flagged from the pre-update read (the manual close-out that raced this
    // capture committed first under the shared lock). The caller pages a human to
    // refund the card; the write above already recorded the money.
    capturedAfterManualCloseout,
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

  // Never downgrade a payment that already landed. `payment_intent.payment_failed`
  // only describes a failed *attempt*, which logically precedes capture — but
  // Stripe does not guarantee webhook ordering, so a stale failed-attempt event
  // can arrive AFTER the success/refund/dispute event. Applying it would flip a
  // paid booking to FAILED, which also makes `isCapturedStripePayment` false and
  // blocks refunds. Treat it as a no-op once a captured state is recorded.
  const CAPTURED_TERMINAL_STATUSES: ReadonlyArray<StripePaymentStatus> = [
    StripePaymentStatus.SUCCEEDED,
    StripePaymentStatus.REFUNDED,
    StripePaymentStatus.DISPUTED,
  ]

  const alreadyApplied =
    booking.stripeLastEventId === args.stripeEventId &&
    booking.stripePaymentStatus === StripePaymentStatus.FAILED

  const wouldDowngradeCaptured =
    booking.stripePaymentStatus != null &&
    CAPTURED_TERMINAL_STATUSES.includes(booking.stripePaymentStatus)

  if (alreadyApplied || wouldDowngradeCaptured) {
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

  // Only reached on a fresh failure transition (the alreadyApplied guard above
  // short-circuits replays), so this emits once per distinct failed attempt.
  await emitPaymentActionRequiredNotifications({
    tx: args.tx,
    bookingId: updated.id,
    stripePaymentIntentId: args.stripePaymentIntentId,
  })

  return {
    bookingId: updated.id,
    bookingCompleted: updated.status === BookingStatus.COMPLETED,
    meta: buildMeta(true),
  }
}

async function performLockedApplyStripeDispute(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  stripePaymentIntentId: string
  stripeEventId: string
  outcome: StripeDisputeOutcome
}): Promise<ApplyStripePaymentResult> {
  const booking: StripeWebhookBookingRecord | null =
    await args.tx.booking.findUnique({
      where: { id: args.bookingId },
      select: STRIPE_WEBHOOK_BOOKING_SELECT,
    })

  if (!booking) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  const targetStatus =
    args.outcome === 'WON'
      ? StripePaymentStatus.SUCCEEDED
      : StripePaymentStatus.DISPUTED

  const noop: ApplyStripePaymentResult = {
    bookingId: booking.id,
    bookingCompleted: booking.status === BookingStatus.COMPLETED,
    meta: buildMeta(false),
  }

  // A won dispute only RESTORES a booking we previously marked DISPUTED. If the
  // booking moved on (e.g. a refund landed), never clobber that state.
  if (
    args.outcome === 'WON' &&
    booking.stripePaymentStatus !== StripePaymentStatus.DISPUTED
  ) {
    return noop
  }

  // Idempotent: an exact event replay, or a non-restoring event whose target
  // state is already recorded (created → funds_withdrawn → closed-lost all map
  // to DISPUTED), is a no-op.
  const isReplay = booking.stripeLastEventId === args.stripeEventId
  const alreadyAtTarget = booking.stripePaymentStatus === targetStatus
  if (isReplay || (alreadyAtTarget && args.outcome !== 'WON')) {
    return noop
  }

  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data: {
      stripePaymentStatus: targetStatus,
      stripePaymentIntentId: args.stripePaymentIntentId,
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

/**
 * The find → lock → re-find-under-lock skeleton every final-bill Stripe webhook
 * applier that runs inside a caller-provided transaction (`applyStripe*InTransaction`)
 * repeats verbatim. The booking is resolved once to learn which professional to
 * lock, then re-resolved AFTER the advisory lock so the applier operates on a row
 * no concurrent writer can move underneath it — the same double-read guard
 * `withLockedProfessionalScheduleByLookup` gives the transaction-OPENING callers
 * (this variant locks inside a tx the caller already holds). Returns `null` — the
 * webhook's "no matching booking, ack and move on" outcome — when either
 * resolution misses.
 *
 * The per-event validation, the lookup keys (payment-intent id vs checkout-session
 * id) and the terminal `performLocked*` call stay in each applier: those diverge
 * by design (see the deposit appliers, which resolve by a different PI entirely).
 */
async function withStripeWebhookLockedBooking<
  B extends { id: string; professionalId: string },
  T,
>(args: {
  tx: Prisma.TransactionClient
  lookup: (db: Prisma.TransactionClient) => Promise<B | null>
  run: (lockedBooking: B) => Promise<T>
}): Promise<T | null> {
  const booking = await args.lookup(args.tx)
  if (!booking) return null

  await lockProfessionalSchedule(args.tx, booking.professionalId)

  const lockedBooking = await args.lookup(args.tx)
  if (!lockedBooking) return null

  return args.run(lockedBooking)
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

  return withStripeWebhookLockedBooking({
    tx,
    lookup: (db) =>
      findBookingForStripeWebhook({
        db,
        bookingIdHint: args.bookingIdHint ?? null,
        stripePaymentIntentId,
      }),
    run: (lockedBooking) =>
      performLockedApplyStripePaymentSucceeded({
        tx,
        now: args.occurredAt ?? new Date(),
        bookingId: lockedBooking.id,
        stripePaymentIntentId,
        stripeEventId,
        amountReceivedCents: args.amountReceivedCents,
        currency: args.currency,
      }),
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

  return withStripeWebhookLockedBooking({
    tx,
    lookup: (db) =>
      findBookingForStripeWebhook({
        db,
        bookingIdHint: args.bookingIdHint ?? null,
        stripePaymentIntentId,
      }),
    run: (lockedBooking) =>
      performLockedApplyStripePaymentFailed({
        tx,
        bookingId: lockedBooking.id,
        stripePaymentIntentId,
        stripeEventId,
      }),
  })
}

export async function applyStripeDisputeInTransaction(
  tx: Prisma.TransactionClient,
  args: ApplyStripeDisputeArgs,
): Promise<ApplyStripePaymentResult | null> {
  const stripePaymentIntentId = args.stripePaymentIntentId.trim()
  const stripeEventId = args.stripeEventId.trim()

  if (!stripePaymentIntentId || !stripeEventId) {
    throw bookingError('FORBIDDEN', {
      message: 'Stripe payment intent id and event id are required.',
    })
  }

  return withStripeWebhookLockedBooking({
    tx,
    lookup: (db) =>
      findBookingForStripeWebhook({
        db,
        bookingIdHint: args.bookingIdHint ?? null,
        stripePaymentIntentId,
      }),
    run: (lockedBooking) =>
      performLockedApplyStripeDispute({
        tx,
        bookingId: lockedBooking.id,
        stripePaymentIntentId,
        stripeEventId,
        outcome: args.outcome,
      }),
  })
}

/**
 * Which auxiliary (non-final-bill) charge a dispute landed on. Each rides its own
 * PaymentIntent and carries its own freeze column; the freeze RULE is identical,
 * so it lives once in applyStripeAuxDisputeFreezeInTransaction below.
 */
type AuxDisputeChargeKind = 'DEPOSIT' | 'NO_SHOW_FEE'

const AUX_DISPUTE_ID_REQUIRED_MESSAGE: Record<AuxDisputeChargeKind, string> = {
  DEPOSIT: 'Stripe deposit payment intent id is required.',
  NO_SHOW_FEE: 'Stripe no-show fee payment intent id is required.',
}

/**
 * Record a dispute (chargeback) freeze on an AUXILIARY charge — the discovery
 * deposit or the no-show / late-cancel fee. Both ride their own PaymentIntent
 * (separate from the final bill, so neither matches
 * applyStripeDisputeInTransaction), and both answer the same question with the
 * same rule, only on a different PI field + freeze column:
 *   OPEN / LOST -> set the freeze (Stripe pulled or is pulling the funds and
 *     reversed the transfer off the pro) so the refund paths refuse to
 *     double-return the money. Keeps the EARLIEST dispute time; LOST leaves the
 *     freeze in place forever (the funds are gone via the chargeback).
 *   WON -> clear it (the money was restored) so refunds may resume.
 *
 * Field-level idempotency — freeze only if unset, clear only if set — plus the
 * webhook route's event-id dedupe make replays safe without a per-charge
 * last-event column. Returns the matched bookingId (even on a no-op re-delivery)
 * or null when no booking carries that PI, so the three PI kinds stay disjoint.
 */
async function applyStripeAuxDisputeFreezeInTransaction(
  tx: Prisma.TransactionClient,
  args: {
    kind: AuxDisputeChargeKind
    paymentIntentId: string
    outcome: StripeDisputeOutcome
    now?: Date
  },
): Promise<{ bookingId: string } | null> {
  const paymentIntentId = args.paymentIntentId.trim()

  if (!paymentIntentId) {
    throw bookingError('FORBIDDEN', {
      message: AUX_DISPUTE_ID_REQUIRED_MESSAGE[args.kind],
    })
  }

  const where: Prisma.BookingWhereInput =
    args.kind === 'DEPOSIT'
      ? { depositStripePaymentIntentId: paymentIntentId }
      : { noShowFeeStripePaymentIntentId: paymentIntentId }

  return withStripeWebhookLockedBooking({
    tx,
    lookup: (db) =>
      db.booking.findFirst({
        where,
        select: {
          id: true,
          professionalId: true,
          depositDisputedAt: true,
          noShowFeeDisputedAt: true,
        },
      }),
    run: async (locked) => {
      const frozenAt =
        args.kind === 'DEPOSIT' ? locked.depositDisputedAt : locked.noShowFeeDisputedAt
      const shouldWrite = args.outcome === 'WON' ? frozenAt !== null : frozenAt === null

      if (shouldWrite) {
        const nextFreezeAt = args.outcome === 'WON' ? null : args.now ?? new Date()
        const data: Prisma.BookingUpdateInput =
          args.kind === 'DEPOSIT'
            ? { depositDisputedAt: nextFreezeAt }
            : { noShowFeeDisputedAt: nextFreezeAt }

        await tx.booking.update({
          where: { id: locked.id },
          data,
          select: { id: true } satisfies Prisma.BookingSelect,
        })
      }

      return { bookingId: locked.id }
    },
  })
}

/**
 * Apply a dispute (chargeback) on the DISCOVERY DEPOSIT PaymentIntent. The
 * deposit rides its own charge/PI, separate from the final bill, so a deposit
 * dispute never matches applyStripeDisputeInTransaction (which resolves by the
 * final-bill `stripePaymentIntentId`). Resolves the booking by
 * `depositStripePaymentIntentId` and records the freeze on `depositDisputedAt`,
 * which is what makes refundDiscoveryDeposit + the M3 retry sweep refuse to
 * double-return deposit funds Stripe already pulled. Freeze semantics + replay
 * safety: see applyStripeAuxDisputeFreezeInTransaction.
 */
export async function applyStripeDepositDisputeInTransaction(
  tx: Prisma.TransactionClient,
  args: {
    depositPaymentIntentId: string
    outcome: StripeDisputeOutcome
    now?: Date
  },
): Promise<{ bookingId: string } | null> {
  return applyStripeAuxDisputeFreezeInTransaction(tx, {
    kind: 'DEPOSIT',
    paymentIntentId: args.depositPaymentIntentId,
    outcome: args.outcome,
    now: args.now,
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

  return withStripeWebhookLockedBooking({
    tx,
    lookup: (db) =>
      findBookingForStripeWebhook({
        db,
        bookingIdHint: args.bookingIdHint ?? null,
        stripeCheckoutSessionId,
        stripePaymentIntentId: args.stripePaymentIntentId,
      }),
    run: (lockedBooking) =>
      performLockedApplyStripeCheckoutSessionStatus({
        tx,
        bookingId: lockedBooking.id,
        stripeCheckoutSessionId,
        stripePaymentIntentId: args.stripePaymentIntentId,
        stripeAmountSubtotal: args.stripeAmountSubtotal,
        stripeAmountTotal: args.stripeAmountTotal,
        stripeCurrency: args.stripeCurrency,
        status: args.status,
      }),
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
 * scheduleVersion for every affected professional so cached availability
 * surfaces (`/api/v1/availability/*`, openings, search) re-render the freed slots.
 *
 * Used by the `/api/internal/jobs/hold-cleanup` cron. Routing the deleteMany
 * through the write-boundary keeps the BookingHold mutation tripwire green
 * (see `tools/check-booking-write-boundary.mjs`) and ensures the cache bump
 * happens transactionally with the delete from the caller's perspective.
 *
 * This used to bump `scheduleConfigVersion`, which only half-invalidated (B2,
 * 2026-07-24). The day/bootstrap/alternates keys carry both counters so they
 * did move, but the busy-intervals cache underneath them is keyed on
 * `scheduleVersion` ALONE — so a busy entry written moments before a hold
 * expired kept serving that hold as live for the rest of its own 60s TTL, and
 * the recomputed day response was built on top of it. `releaseHold`, the manual
 * sibling of this sweep, already bumped `scheduleVersion`: one event, two
 * spellings, and only one of them reached the layer that mattered. Bumping the
 * occupancy counter covers both layers and stops needlessly evicting the 300s
 * placement cache every five minutes.
 *
 * The bump is best-effort: if Redis is unreachable, the underlying
 * `bumpScheduleVersion` swallows the error and logs. The next sweep
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
        bumpScheduleVersion(professionalId),
      ),
    )
  }

  return {
    deletedCount: deletedResult.count,
    affectedProfessionalIds,
  }
}

// ---------------------------------------------------------------------------
// K12 — the client-confirmation loop's WRITERS (the K11 timestamps' only
// mutation paths besides the reschedule resets above).
// ---------------------------------------------------------------------------

const ARM_CONFIRMATION_BOOKING_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  status: true,
  scheduledFor: true,
  clientConfirmationRequestedAt: true,
} satisfies Prisma.BookingSelect

export type ArmAppointmentConfirmationAskResult = {
  /** Relative public action link (/client/appointment/<token>). */
  href: string
  tokenId: string
  /** True when THIS call stamped clientConfirmationRequestedAt (the first ask). */
  requestedAtStamped: boolean
}

/**
 * The ASK half of the loop, called by the client-reminders cron inside its own
 * transaction at the moment an APPOINTMENT_REMINDER is processed — stamping
 * clientConfirmationRequestedAt anywhere earlier would mark a booking
 * "Awaiting client" before the client could possibly know (the K12 rule: the
 * stamp lives where the ask goes out).
 *
 * Mints a fresh APPOINTMENT_CONFIRMATION token per ask (a booking with a 24h
 * and a 2h reminder sends two); older tokens are deliberately NOT revoked —
 * they all expire at the appointment start, and the link in the earlier SMS
 * must keep working. requestedAt is stamped only when null, so the state
 * records the FIRST ask and a later reminder cannot push "awaiting since"
 * forward.
 *
 * Returns null (and writes nothing) when the booking is no longer askable —
 * the caller then sends the reminder exactly as it did before K12.
 */
export async function armAppointmentConfirmationAsk(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  now: Date
}): Promise<ArmAppointmentConfirmationAskResult | null> {
  const booking = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: ARM_CONFIRMATION_BOOKING_SELECT,
  })

  if (!booking) return null
  if (!APPOINTMENT_CONFIRMATION_ANSWERABLE_STATUSES.has(booking.status)) {
    return null
  }
  if (booking.scheduledFor.getTime() <= args.now.getTime()) return null

  let requestedAtStamped = false
  if (!booking.clientConfirmationRequestedAt) {
    const stamped = await args.tx.booking.updateMany({
      where: { id: booking.id, clientConfirmationRequestedAt: null },
      data: { clientConfirmationRequestedAt: args.now },
    })
    requestedAtStamped = stamped.count === 1
  }

  const rawToken = generateClientActionToken()
  const tokenHash = hashClientActionToken(rawToken)

  const created = await args.tx.clientActionToken.create({
    data: {
      kind: ClientActionTokenKind.APPOINTMENT_CONFIRMATION,
      tokenHash,
      singleUse: false,
      bookingId: booking.id,
      clientId: booking.clientId,
      professionalId: booking.professionalId,
      deliveryMethod: null,
      issuedByUserId: null,
      // Confirming/cancelling from a reminder link is meaningless once the
      // appointment has begun; the token dies with the slot it asks about.
      expiresAt: booking.scheduledFor,
      metadata: {
        source: 'appointmentReminder',
        actionType: 'APPOINTMENT_CONFIRMATION',
        bookingId: booking.id,
        clientId: booking.clientId,
        professionalId: booking.professionalId,
      },
    },
    select: { id: true },
  })

  const link = buildClientActionLinkForType({
    actionType: 'APPOINTMENT_CONFIRMATION',
    rawToken,
  })

  return {
    href: link.href,
    tokenId: created.id,
    requestedAtStamped,
  }
}

export type AppointmentConfirmationAnswer = 'CONFIRM' | 'DECLINE'

export type RecordAppointmentConfirmationAnswerResult = {
  booking: {
    id: string
    status: BookingStatus
    scheduledFor: Date
  }
  state: ClientConfirmationState
  meta: MutationMeta
}

const ANSWER_CONFIRMATION_BOOKING_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  status: true,
  scheduledFor: true,
  locationTimeZone: true,
  ...CLIENT_CONFIRMATION_SELECT,
  service: { select: { name: true } },
  professional: { select: { timeZone: true } },
  client: {
    select: {
      firstName: true, // pii-plaintext-read-ok: pro-facing client name in the decline notif (same as the cancel inbox row)
      lastName: true, // pii-plaintext-read-ok: pro-facing client name in the decline notif (same as the cancel inbox row)
    },
  },
} satisfies Prisma.BookingSelect

async function performLockedRecordAppointmentConfirmationAnswer(args: {
  tx: Prisma.TransactionClient
  now: Date
  bookingId: string
  clientId: string
  /**
   * The APPOINTMENT_CONFIRMATION token the answer arrived on, or null when a
   * signed-in client answered in the app (K13) — there is no token to account
   * for on that path. Everything else about the two answers is identical, and
   * deliberately so: they share this one core so an in-app confirm and a
   * link confirm can never stamp different things or skip the pro's decline
   * notification.
   */
  tokenId: string | null
  answer: AppointmentConfirmationAnswer
}): Promise<RecordAppointmentConfirmationAnswerResult> {
  const booking = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: ANSWER_CONFIRMATION_BOOKING_SELECT,
  })

  if (!booking || booking.clientId !== args.clientId) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  // The answer is to "will you come to this appointment" — a cancelled,
  // started or finished booking no longer asks it. D5 holds in the other
  // direction too: refusing here never touches the slot.
  if (!APPOINTMENT_CONFIRMATION_ANSWERABLE_STATUSES.has(booking.status)) {
    throw bookingError('APPOINTMENT_CONFIRMATION_UNAVAILABLE')
  }

  if (booking.scheduledFor.getTime() <= args.now.getTime()) {
    throw bookingError('APPOINTMENT_CONFIRMATION_UNAVAILABLE', {
      message: 'Appointment has already started.',
      userMessage: 'This appointment has already started.',
    })
  }

  const priorState = deriveClientConfirmationState(booking)

  // Always re-stamp the answered timestamp: the derivation's "latest answer
  // wins" rule (K11) is built for exactly this write, and an idempotent
  // re-confirm moving clientConfirmedAt forward keeps the tie-break honest.
  const updated = await args.tx.booking.update({
    where: { id: booking.id },
    data:
      args.answer === 'CONFIRM'
        ? { clientConfirmedAt: args.now }
        : { clientConfirmationDeclinedAt: args.now },
    select: {
      id: true,
      status: true,
      scheduledFor: true,
      ...CLIENT_CONFIRMATION_SELECT,
    } satisfies Prisma.BookingSelect,
  })

  const state = deriveClientConfirmationState(updated)

  // D5: declining NEVER cancels — the slot stays occupied and the pro decides.
  // This notification is how they learn. Dedupe-keyed per booking, so a
  // repeated tap refreshes one inbox row instead of stacking copies.
  if (args.answer === 'DECLINE') {
    const clientName = formatClientName(booking.client)
    const serviceLabel = booking.service?.name?.trim() || 'the appointment'
    const whenClause = formatBookingWhenClause(
      booking.scheduledFor,
      resolveBookingDisplayTimeZone(booking),
    )

    await createProNotification({
      tx: args.tx,
      professionalId: booking.professionalId,
      eventKey: NotificationEventKey.APPOINTMENT_CONFIRMATION_DECLINED,
      priority: NotificationPriority.HIGH,
      title: 'Client can’t make it',
      body: `${clientName} said they can’t make ${serviceLabel}${whenClause}. The time stays booked until you cancel or reschedule it.`,
      href: `/pro/bookings/${booking.id}`,
      actorUserId: null,
      bookingId: booking.id,
      dedupeKey: `PRO_NOTIF:${NotificationEventKey.APPOINTMENT_CONFIRMATION_DECLINED}:${booking.id}`,
      data: {
        bookingId: booking.id,
        declinedAt: args.now.toISOString(),
      },
    })
  }

  // Not single-use — usage is recorded, never burned, and only after the
  // answer wrote successfully inside this same transaction
  // ([[single-use-token-consumed-before-tx]] in spirit: nothing irreversible
  // happens before the write it accounts for). An in-app answer carries no
  // token, so there is nothing to record.
  if (args.tokenId != null) {
    await markAppointmentConfirmationTokenUsed({
      tokenId: args.tokenId,
      tx: args.tx,
      now: args.now,
    })
  }

  return {
    booking: {
      id: updated.id,
      status: updated.status,
      scheduledFor: updated.scheduledFor,
    },
    state,
    meta: buildMeta(state !== priorState),
  }
}

/**
 * The one-tap confirm / "can't make it" decline behind the public
 * /client/appointment/<token> page. Both are Booking writes → write boundary,
 * under the client-owned booking lock the cancel path uses.
 */
export async function recordAppointmentConfirmationFromClientToken(args: {
  rawToken: string
  answer: AppointmentConfirmationAnswer
}): Promise<RecordAppointmentConfirmationAnswerResult> {
  const resolved = await resolveAppointmentConfirmationTokenForMutation({
    rawToken: args.rawToken,
  })

  return withLockedClientOwnedBookingTransaction({
    bookingId: resolved.booking.id,
    clientId: resolved.booking.clientId,
    run: async ({ tx, now }) =>
      performLockedRecordAppointmentConfirmationAnswer({
        tx,
        now,
        bookingId: resolved.booking.id,
        clientId: resolved.booking.clientId,
        tokenId: resolved.token.id,
        answer: args.answer,
      }),
  })
}

/**
 * The same answer, from a client who is already signed in (K13's in-app
 * action) — no token, because there is nothing to authenticate: the caller
 * proved who they are with a session, and the lock helper below refuses a
 * booking that is not theirs.
 *
 * 🔴 It shares `performLockedRecordAppointmentConfirmationAnswer` with the
 * link path on purpose. Answering in the app and answering from the reminder
 * are the same fact about the same appointment, so they must stamp the same
 * column, run the same answerable-status and already-started refusals, and
 * fire the same D5 decline notification to the pro. A second implementation is
 * how "the client confirmed" would come to mean two different things depending
 * on which surface they used.
 */
export async function recordAppointmentConfirmationFromAuthedClient(args: {
  bookingId: string
  clientId: string
  answer: AppointmentConfirmationAnswer
}): Promise<RecordAppointmentConfirmationAnswerResult> {
  return withLockedClientOwnedBookingTransaction({
    bookingId: args.bookingId,
    clientId: args.clientId,
    run: async ({ tx, now }) =>
      performLockedRecordAppointmentConfirmationAnswer({
        tx,
        now,
        bookingId: args.bookingId,
        clientId: args.clientId,
        tokenId: null,
        answer: args.answer,
      }),
  })
}

/**
 * Re-point every booking (and any live hold) from one client identity to another.
 *
 * The claim merge's only booking write — a pro-created UNCLAIMED profile is being
 * absorbed into the signed-in client's own identity, so its bookings must follow
 * the person. This lives here rather than in `lib/clients/mergeUnclaimedClientProfile.ts`
 * because every Booking / BookingHold write goes through this boundary
 * (`check:booking-boundary`), so a reader looking for "what can move a booking"
 * finds it in one file.
 *
 * Deliberately narrow: it changes ownership ONLY. No lifecycle field moves — the
 * booking's status, schedule, money and audit trail are all untouched, because a
 * merge is a change of *who the client is*, not of what happened.
 *
 * `creationIdempotencyKey` is cleared on the moved rows: it is unique per
 * `[clientId, creationIdempotencyKey]`, so a (vanishingly unlikely) collision with
 * the target's own key would abort the merge. The key is a create-time replay guard
 * that has already done its job — these bookings exist — so dropping it costs
 * nothing and can never drop a booking.
 *
 * Caller must hold a transaction; the merge asserts the source is unclaimed first.
 */
export async function reassignClientBookings(args: {
  tx: Prisma.TransactionClient
  fromClientId: string
  toClientId: string
}): Promise<{ bookings: number; holds: number }> {
  const bookings = await args.tx.booking.updateMany({
    where: { clientId: args.fromClientId },
    data: { clientId: args.toClientId, creationIdempotencyKey: null },
  })

  const holds = await args.tx.bookingHold.updateMany({
    where: { clientId: args.fromClientId },
    data: { clientId: args.toClientId },
  })

  return { bookings: bookings.count, holds: holds.count }
}
