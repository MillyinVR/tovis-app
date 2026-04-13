// lib/clientActions/types.ts

import {
  ClientActionTokenKind,
  ContactMethod,
  NotificationEventKey,
  NotificationRecipientKind,
  Prisma,
} from '@prisma/client'

/**
 * Phase 1 note:
 * This file is intentionally "types only".
 * It defines the stable vocabulary for client-action orchestration before we
 * wire real route flows into it.
 */

export const CLIENT_ACTION_TYPES = [
  'CLIENT_CLAIM_INVITE',
  'AFTERCARE_ACCESS',
  'CONSULTATION_ACTION',
] as const

export type ClientActionType = (typeof CLIENT_ACTION_TYPES)[number]

export const CLIENT_ACTION_RESEND_MODES = [
  'INITIAL_SEND',
  'RESEND',
  'RETRY',
] as const

export type ClientActionResendMode =
  (typeof CLIENT_ACTION_RESEND_MODES)[number]

export const CLIENT_ACTION_LINK_TARGETS = [
  'CLAIM',
  'AFTERCARE',
  'CONSULTATION',
] as const

export type ClientActionLinkTarget =
  (typeof CLIENT_ACTION_LINK_TARGETS)[number]

export type ClientActionEntityRefs = {
  bookingId?: string | null
  clientId?: string | null
  professionalId?: string | null
  aftercareId?: string | null
  consultationApprovalId?: string | null
  inviteId?: string | null
}

export type ClientActionRecipientSnapshot = {
  /**
   * Internal identities, when known.
   */
  clientId: string
  professionalId: string
  userId?: string | null

  /**
   * Delivery / auth bootstrap data.
   * For unclaimed clients, these snapshots matter more than userId.
   */
  invitedName?: string | null
  recipientEmail?: string | null
  recipientPhone?: string | null
  preferredContactMethod?: ContactMethod | null

  /**
   * Optional context we may want to preserve for dispatch or analytics later.
   */
  timeZone?: string | null
}

export type ClientActionTokenPolicy = {
  /**
   * Whether this action should issue a ClientActionToken at all.
   * Claim invites currently use ProClientInvite.token, so this can be false/null.
   */
  required: boolean
  kind: ClientActionTokenKind | null

  /**
   * Security / lifecycle rules.
   */
  singleUse: boolean
  expiresInMs: number | null
  revokeOutstandingOnResend: boolean
}

export type ClientActionDeliveryPolicy = {
  /**
   * External delivery channel policy.
   * This is intentionally ContactMethod-based because the action-token and
   * claim-link flows snapshot email/phone destinations that way.
   */
  allowedContactMethods: readonly ContactMethod[]
  preferredContactMethod: ContactMethod | null

  /**
   * Notification integration.
   * Optional because claim invites do not yet appear to have a dedicated
   * NotificationEventKey in the existing catalog.
   */
  notificationEventKey: NotificationEventKey | null
  notificationRecipientKind: NotificationRecipientKind

  /**
   * Whether the action should create a new delivery attempt / dispatch when
   * resent, instead of only updating an existing deduped inbox row.
   */
  createFreshDeliveryOnResend: boolean
}

export type ClientActionLinkPolicy = {
  target: ClientActionLinkTarget

  /**
   * Route-level path target.
   * Example outputs later:
   * - /claim/:token
   * - /client/rebook/:token
   * - /client/consultation/:token
   */
  pathPrefix: string

  /**
   * Whether the generated href must contain a token.
   * Claim links use invite tokens; aftercare/consultation use action tokens.
   */
  requiresToken: boolean
}

export type ClientActionDefinition = {
  type: ClientActionType
  token: ClientActionTokenPolicy
  delivery: ClientActionDeliveryPolicy
  link: ClientActionLinkPolicy
}

export type ClientActionIdempotencyInput = {
  actionType: ClientActionType
  refs: ClientActionEntityRefs
  recipient: Pick<
    ClientActionRecipientSnapshot,
    'clientId' | 'professionalId' | 'recipientEmail' | 'recipientPhone'
  >
  resendMode: ClientActionResendMode
}

export type ClientActionIdempotencyKeys = {
  /**
   * Stable logical identity for "this action for this entity + recipient".
   * Good for dedupe / update semantics.
   */
  baseKey: string

  /**
   * A send-cycle identity.
   * Good for distinguishing initial send vs intentional resend.
   */
  sendKey: string
}

export type ClientActionResolvedLink = {
  target: ClientActionLinkTarget
  href: string
  tokenIncluded: boolean
}

export type ClientActionResolvedDelivery = {
  method: ContactMethod | null
  destinationSnapshot: string | null
  notificationEventKey: NotificationEventKey | null
  notificationRecipientKind: NotificationRecipientKind
}

export type ClientActionOrchestrationInput = {
  actionType: ClientActionType
  refs: ClientActionEntityRefs
  recipient: ClientActionRecipientSnapshot

  /**
   * Defaults to INITIAL_SEND in implementations, but kept explicit in the
   * contract so resend behavior is impossible to "accidentally forget".
   */
  resendMode: ClientActionResendMode

  /**
   * Optional overrides for the issuing flow.
   */
  issuedByUserId?: string | null
  expiresAtOverride?: Date | null
  metadata?: Prisma.InputJsonValue | null

  tx?: Prisma.TransactionClient
}

export type ClientActionOrchestrationPlan = {
  definition: ClientActionDefinition
  refs: ClientActionEntityRefs
  recipient: ClientActionRecipientSnapshot
  resendMode: ClientActionResendMode

  idempotency: ClientActionIdempotencyKeys
  resolvedDelivery: ClientActionResolvedDelivery

  /**
   * Link is resolved after token/link generation inputs are known.
   * In Phase 1, the orchestrator can still return the structural target even
   * before every feature flow is fully wired.
   */
  link: {
    target: ClientActionLinkTarget
    pathPrefix: string
    requiresToken: boolean
  }

  issuedByUserId: string | null
  expiresAtOverride: Date | null
  metadata: Prisma.InputJsonValue | null

  tx?: Prisma.TransactionClient
}

export type ClientActionIssuedToken = {
  id: string
  rawToken: string
  expiresAt: Date
}

export type ClientActionBuildLinkArgs = {
  target: ClientActionLinkTarget
  rawToken: string
}

export type ClientActionBuildLinkResult = ClientActionResolvedLink

export type ClientActionIssueResult = {
  plan: ClientActionOrchestrationPlan
  token: ClientActionIssuedToken | null
  link: ClientActionResolvedLink
}

export type ClientActionOrchestrationErrorCode =
  | 'CLIENT_ACTION_INVALID_TYPE'
  | 'CLIENT_ACTION_MISSING_CLIENT_ID'
  | 'CLIENT_ACTION_MISSING_PROFESSIONAL_ID'
  | 'CLIENT_ACTION_NO_DELIVERY_DESTINATION'
  | 'CLIENT_ACTION_CONTACT_METHOD_NOT_ALLOWED'
  | 'CLIENT_ACTION_TOKEN_POLICY_INVALID'
  | 'CLIENT_ACTION_EVENT_POLICY_INVALID'
  | 'CLIENT_ACTION_LINK_POLICY_INVALID'

export type ClientActionOrchestrationFailure = {
  ok: false
  code: ClientActionOrchestrationErrorCode
  error: string
}

export type ClientActionOrchestrationSuccess = {
  ok: true
  plan: ClientActionOrchestrationPlan
}

export type ClientActionOrchestrationResult =
  | ClientActionOrchestrationSuccess
  | ClientActionOrchestrationFailure