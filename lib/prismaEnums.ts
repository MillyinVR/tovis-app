// lib/prismaEnums.ts
//
// GENERATED FILE — DO NOT EDIT BY HAND.
// Source of truth: prisma/schema.prisma
// Regenerate:     node tools/generate-client-safe-enums.mjs --write
// Guarded by:     pnpm check:client-safe-enums (runs in check:static-guards)
//
// The client-safe copy of the Prisma enums whose VALUES client-rendered code
// reads. Importing these from '@prisma/client' is a value import, which drags
// that package's browser build (every column of every model, by name) into the
// browser bundle — 121.5 KB across 53 routes before this file existed.
//
// Each export is shaped exactly like Prisma's own generated enum: an as-const
// object plus a same-named string-literal union — so the two are mutually
// assignable and call sites read identically.
//
// ⚠️ SERVER code keeps importing from '@prisma/client'. This file is for code
// that reaches the browser. Types are free either way: 'import type { X } from
// "@prisma/client"' is erased at compile time and costs the bundle nothing.

export const AftercareRebookMode = {
  NONE: 'NONE',
  BOOKED_NEXT_APPOINTMENT: 'BOOKED_NEXT_APPOINTMENT',
  RECOMMENDED_WINDOW: 'RECOMMENDED_WINDOW',
} as const

export type AftercareRebookMode =
  (typeof AftercareRebookMode)[keyof typeof AftercareRebookMode]

export const BoardType = {
  GENERAL: 'GENERAL',
  BRIDAL: 'BRIDAL',
  PROM: 'PROM',
  SKINCARE: 'SKINCARE',
  PERMANENT_MAKEUP: 'PERMANENT_MAKEUP',
  COLOR_TRANSFORMATION: 'COLOR_TRANSFORMATION',
  NAILS: 'NAILS',
} as const

export type BoardType = (typeof BoardType)[keyof typeof BoardType]

export const BookingCheckoutStatus = {
  NOT_READY: 'NOT_READY',
  READY: 'READY',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  WAIVED: 'WAIVED',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
} as const

export type BookingCheckoutStatus =
  (typeof BookingCheckoutStatus)[keyof typeof BookingCheckoutStatus]

export const BookingDepositStatus = {
  NONE: 'NONE',
  PENDING: 'PENDING',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
} as const

export type BookingDepositStatus =
  (typeof BookingDepositStatus)[keyof typeof BookingDepositStatus]

export const BookingDiscoveryProvenance = {
  UNKNOWN: 'UNKNOWN',
  LOOKS_FEED: 'LOOKS_FEED',
  DISCOVERY_SEARCH: 'DISCOVERY_SEARCH',
  DIRECT_PROFILE: 'DIRECT_PROFILE',
  NAME_SEARCH: 'NAME_SEARCH',
  NFC: 'NFC',
  AFTERCARE: 'AFTERCARE',
  PRO_CREATED: 'PRO_CREATED',
} as const

export type BookingDiscoveryProvenance =
  (typeof BookingDiscoveryProvenance)[keyof typeof BookingDiscoveryProvenance]

export const BookingRefundStatus = {
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
} as const

export type BookingRefundStatus =
  (typeof BookingRefundStatus)[keyof typeof BookingRefundStatus]

export const BookingServiceItemType = {
  BASE: 'BASE',
  ADD_ON: 'ADD_ON',
} as const

export type BookingServiceItemType =
  (typeof BookingServiceItemType)[keyof typeof BookingServiceItemType]

export const BookingSource = {
  REQUESTED: 'REQUESTED',
  DISCOVERY: 'DISCOVERY',
  AFTERCARE: 'AFTERCARE',
  IMPORTED: 'IMPORTED',
} as const

export type BookingSource = (typeof BookingSource)[keyof typeof BookingSource]

export const BookingStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
} as const

export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus]

export const ClientChartShareStatus = {
  REQUESTED: 'REQUESTED',
  GRANTED: 'GRANTED',
  DECLINED: 'DECLINED',
  REVOKED: 'REVOKED',
} as const

export type ClientChartShareStatus =
  (typeof ClientChartShareStatus)[keyof typeof ClientChartShareStatus]

export const ClientConsentKind = {
  GENERAL_CONSENT: 'GENERAL_CONSENT',
  SERVICE_WAIVER: 'SERVICE_WAIVER',
  PATCH_TEST: 'PATCH_TEST',
} as const

export type ClientConsentKind =
  (typeof ClientConsentKind)[keyof typeof ClientConsentKind]

export const ClientCreatorTier = {
  NONE: 'NONE',
  RISING: 'RISING',
  TASTEMAKER: 'TASTEMAKER',
} as const

export type ClientCreatorTier =
  (typeof ClientCreatorTier)[keyof typeof ClientCreatorTier]

export const ClientNoteKind = {
  GENERAL: 'GENERAL',
  CONSULTATION: 'CONSULTATION',
  COMMUNICATION_STYLE: 'COMMUNICATION_STYLE',
  DO_NOT_REBOOK: 'DO_NOT_REBOOK',
} as const

export type ClientNoteKind =
  (typeof ClientNoteKind)[keyof typeof ClientNoteKind]

export const ClientNoteVisibility = {
  PROFESSIONALS_ONLY: 'PROFESSIONALS_ONLY',
  ADMIN_ONLY: 'ADMIN_ONLY',
  PRIVATE_TO_AUTHOR: 'PRIVATE_TO_AUTHOR',
} as const

export type ClientNoteVisibility =
  (typeof ClientNoteVisibility)[keyof typeof ClientNoteVisibility]

export const ClientRelationshipLabel = {
  UNKNOWN: 'UNKNOWN',
  NR: 'NR',
  NNR: 'NNR',
  RR: 'RR',
  RNR: 'RNR',
} as const

export type ClientRelationshipLabel =
  (typeof ClientRelationshipLabel)[keyof typeof ClientRelationshipLabel]

export const ConsentProofMethod = {
  IN_PERSON: 'IN_PERSON',
  CLIENT_TOKEN: 'CLIENT_TOKEN',
  PAPER_ON_FILE: 'PAPER_ON_FILE',
} as const

export type ConsentProofMethod =
  (typeof ConsentProofMethod)[keyof typeof ConsentProofMethod]

export const DepositType = {
  FLAT: 'FLAT',
  PERCENT: 'PERCENT',
} as const

export type DepositType = (typeof DepositType)[keyof typeof DepositType]

export const LookPostStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
  REMOVED: 'REMOVED',
} as const

export type LookPostStatus =
  (typeof LookPostStatus)[keyof typeof LookPostStatus]

export const LookPostVisibility = {
  PUBLIC: 'PUBLIC',
  FOLLOWERS_ONLY: 'FOLLOWERS_ONLY',
  UNLISTED: 'UNLISTED',
} as const

export type LookPostVisibility =
  (typeof LookPostVisibility)[keyof typeof LookPostVisibility]

export const MediaType = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
} as const

export type MediaType = (typeof MediaType)[keyof typeof MediaType]

export const MediaVisibility = {
  PUBLIC: 'PUBLIC',
  PRO_CLIENT: 'PRO_CLIENT',
} as const

export type MediaVisibility =
  (typeof MediaVisibility)[keyof typeof MediaVisibility]

export const ModerationStatus = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REMOVED: 'REMOVED',
  AUTO_FLAGGED: 'AUTO_FLAGGED',
} as const

export type ModerationStatus =
  (typeof ModerationStatus)[keyof typeof ModerationStatus]

export const NoShowFeeReason = {
  NO_SHOW: 'NO_SHOW',
  LATE_CANCEL: 'LATE_CANCEL',
  LATE_RESCHEDULE: 'LATE_RESCHEDULE',
} as const

export type NoShowFeeReason =
  (typeof NoShowFeeReason)[keyof typeof NoShowFeeReason]

export const NoShowFeeStatus = {
  SKIPPED: 'SKIPPED',
  CHARGED: 'CHARGED',
  FAILED: 'FAILED',
  WAIVED: 'WAIVED',
  REFUNDED: 'REFUNDED',
} as const

export type NoShowFeeStatus =
  (typeof NoShowFeeStatus)[keyof typeof NoShowFeeStatus]

export const NotificationEventKey = {
  BOOKING_REQUEST_CREATED: 'BOOKING_REQUEST_CREATED',
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  AI_CONSULT_INVITATION: 'AI_CONSULT_INVITATION',
  AI_CONSULT_ANALYSIS_READY: 'AI_CONSULT_ANALYSIS_READY',
  AI_CONSULT_ANALYSIS_FAILED: 'AI_CONSULT_ANALYSIS_FAILED',
  BOOKING_STARTED: 'BOOKING_STARTED',
  BOOKING_RESCHEDULED: 'BOOKING_RESCHEDULED',
  BOOKING_CANCELLED_BY_CLIENT: 'BOOKING_CANCELLED_BY_CLIENT',
  BOOKING_CANCELLED_BY_PRO: 'BOOKING_CANCELLED_BY_PRO',
  BOOKING_CANCELLED_BY_ADMIN: 'BOOKING_CANCELLED_BY_ADMIN',
  CLIENT_CLAIM_INVITE: 'CLIENT_CLAIM_INVITE',
  CONSULTATION_PROPOSAL_SENT: 'CONSULTATION_PROPOSAL_SENT',
  CONSULTATION_APPROVED: 'CONSULTATION_APPROVED',
  CONSULTATION_REJECTED: 'CONSULTATION_REJECTED',
  REVIEW_RECEIVED: 'REVIEW_RECEIVED',
  REVIEW_REQUESTED: 'REVIEW_REQUESTED',
  APPOINTMENT_REMINDER: 'APPOINTMENT_REMINDER',
  AFTERCARE_READY: 'AFTERCARE_READY',
  LAST_MINUTE_OPENING_AVAILABLE: 'LAST_MINUTE_OPENING_AVAILABLE',
  WAITLIST_TIME_OFFERED: 'WAITLIST_TIME_OFFERED',
  WAITLIST_JOINED: 'WAITLIST_JOINED',
  WAITLIST_OFFER_EXPIRED: 'WAITLIST_OFFER_EXPIRED',
  WAITLIST_CLIENT_LEFT: 'WAITLIST_CLIENT_LEFT',
  VIRAL_REQUEST_APPROVED: 'VIRAL_REQUEST_APPROVED',
  PAYMENT_COLLECTED: 'PAYMENT_COLLECTED',
  PAYMENT_ACTION_REQUIRED: 'PAYMENT_ACTION_REQUIRED',
  PAYMENT_CONFIRMATION_REQUIRED: 'PAYMENT_CONFIRMATION_REQUIRED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  NO_SHOW_FEE_CHARGED: 'NO_SHOW_FEE_CHARGED',
  NO_SHOW_DEPOSIT_KEPT: 'NO_SHOW_DEPOSIT_KEPT',
  DEPOSIT_REMINDER: 'DEPOSIT_REMINDER',
  DEPOSIT_PAYMENT_LINK: 'DEPOSIT_PAYMENT_LINK',
  CONSENT_SIGNATURE_REQUEST: 'CONSENT_SIGNATURE_REQUEST',
  CHART_ACCESS_REQUESTED: 'CHART_ACCESS_REQUESTED',
  CHART_ACCESS_GRANTED: 'CHART_ACCESS_GRANTED',
  APPOINTMENT_CONFIRMATION_DECLINED: 'APPOINTMENT_CONFIRMATION_DECLINED',
  LOOK_FOLLOWER_NEW: 'LOOK_FOLLOWER_NEW',
  CLIENT_FOLLOW: 'CLIENT_FOLLOW',
  LOOK_COMMENTED: 'LOOK_COMMENTED',
  LOOK_COMMENT_REPLIED: 'LOOK_COMMENT_REPLIED',
  LOOK_LIKED: 'LOOK_LIKED',
  LOOK_SAVED: 'LOOK_SAVED',
  LOOK_NEW_FROM_FOLLOWED_PRO: 'LOOK_NEW_FROM_FOLLOWED_PRO',
  LOOK_MILESTONE_REACHED: 'LOOK_MILESTONE_REACHED',
  REFERRAL_TAP_RECEIVED: 'REFERRAL_TAP_RECEIVED',
  REFERRAL_CONFIRMED: 'REFERRAL_CONFIRMED',
  REFERRAL_CONVERTED: 'REFERRAL_CONVERTED',
  SAVED_LOOK_AVAILABILITY_OPENED: 'SAVED_LOOK_AVAILABILITY_OPENED',
  EVENT_DATE_COUNTDOWN: 'EVENT_DATE_COUNTDOWN',
  REBOOK_CADENCE_DUE: 'REBOOK_CADENCE_DUE',
  SAVED_LOOK_CONSULT_NUDGE: 'SAVED_LOOK_CONSULT_NUDGE',
  SAVED_LOOK_PRICE_ALTERNATIVE: 'SAVED_LOOK_PRICE_ALTERNATIVE',
  MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
  PRO_HANDLE_RESERVATION_EXPIRING: 'PRO_HANDLE_RESERVATION_EXPIRING',
  PRO_LICENSE_EXPIRING_SOON: 'PRO_LICENSE_EXPIRING_SOON',
  PRO_LICENSE_EXPIRED: 'PRO_LICENSE_EXPIRED',
  ADMIN_VERIFICATION_REVIEW_NEEDED: 'ADMIN_VERIFICATION_REVIEW_NEEDED',
  ADMIN_SUPPORT_TICKET_CREATED: 'ADMIN_SUPPORT_TICKET_CREATED',
  ADMIN_VIRAL_REQUEST_PENDING: 'ADMIN_VIRAL_REQUEST_PENDING',
} as const

export type NotificationEventKey =
  (typeof NotificationEventKey)[keyof typeof NotificationEventKey]

export const OfferingPrepayScope = {
  SERVICE_ONLY: 'SERVICE_ONLY',
  ENTIRE_BOOKING: 'ENTIRE_BOOKING',
} as const

export type OfferingPrepayScope =
  (typeof OfferingPrepayScope)[keyof typeof OfferingPrepayScope]

export const PatchTestResult = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  INCONCLUSIVE: 'INCONCLUSIVE',
} as const

export type PatchTestResult =
  (typeof PatchTestResult)[keyof typeof PatchTestResult]

export const PhotoReleaseStatus = {
  NOT_SET: 'NOT_SET',
  GRANTED: 'GRANTED',
  DECLINED: 'DECLINED',
} as const

export type PhotoReleaseStatus =
  (typeof PhotoReleaseStatus)[keyof typeof PhotoReleaseStatus]

export const ProNameDisplay = {
  BUSINESS_NAME: 'BUSINESS_NAME',
  REAL_NAME: 'REAL_NAME',
  HANDLE: 'HANDLE',
} as const

export type ProNameDisplay =
  (typeof ProNameDisplay)[keyof typeof ProNameDisplay]

export const ProfessionType = {
  COSMETOLOGIST: 'COSMETOLOGIST',
  BARBER: 'BARBER',
  ESTHETICIAN: 'ESTHETICIAN',
  MANICURIST: 'MANICURIST',
  HAIRSTYLIST: 'HAIRSTYLIST',
  ELECTROLOGIST: 'ELECTROLOGIST',
  MASSAGE_THERAPIST: 'MASSAGE_THERAPIST',
  MAKEUP_ARTIST: 'MAKEUP_ARTIST',
  LASH_TECHNICIAN: 'LASH_TECHNICIAN',
  HAIR_BRAIDER: 'HAIR_BRAIDER',
  PERMANENT_MAKEUP_ARTIST: 'PERMANENT_MAKEUP_ARTIST',
} as const

export type ProfessionType =
  (typeof ProfessionType)[keyof typeof ProfessionType]

export const Role = {
  CLIENT: 'CLIENT',
  PRO: 'PRO',
  ADMIN: 'ADMIN',
} as const

export type Role = (typeof Role)[keyof typeof Role]

export const SessionStep = {
  NONE: 'NONE',
  CONSULTATION: 'CONSULTATION',
  CONSULTATION_PENDING_CLIENT: 'CONSULTATION_PENDING_CLIENT',
  BEFORE_PHOTOS: 'BEFORE_PHOTOS',
  SERVICE_IN_PROGRESS: 'SERVICE_IN_PROGRESS',
  FINISH_REVIEW: 'FINISH_REVIEW',
  AFTER_PHOTOS: 'AFTER_PHOTOS',
  DONE: 'DONE',
} as const

export type SessionStep = (typeof SessionStep)[keyof typeof SessionStep]

export const StripePaymentStatus = {
  NOT_STARTED: 'NOT_STARTED',
  REQUIRES_PAYMENT_METHOD: 'REQUIRES_PAYMENT_METHOD',
  REQUIRES_CONFIRMATION: 'REQUIRES_CONFIRMATION',
  REQUIRES_ACTION: 'REQUIRES_ACTION',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
  REFUNDED: 'REFUNDED',
  DISPUTED: 'DISPUTED',
} as const

export type StripePaymentStatus =
  (typeof StripePaymentStatus)[keyof typeof StripePaymentStatus]

export const VerificationStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  NEEDS_INFO: 'NEEDS_INFO',
  PENDING_MANUAL_REVIEW: 'PENDING_MANUAL_REVIEW',
} as const

export type VerificationStatus =
  (typeof VerificationStatus)[keyof typeof VerificationStatus]
