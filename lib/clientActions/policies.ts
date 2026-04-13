import {
  ContactMethod,
  NotificationEventKey,
} from '@prisma/client'

import { getClientActionDefinition } from './actionRegistry'
import type {
  ClientActionOrchestrationFailure,
  ClientActionRecipientSnapshot,
  ClientActionResendMode,
  ClientActionResolvedDelivery,
  ClientActionType,
} from './types'

type Success<T> = { ok: true; value: T }
type Failure = ClientActionOrchestrationFailure

function fail(
  code: ClientActionOrchestrationFailure['code'],
  error: string,
): Failure {
  return {
    ok: false,
    code,
    error,
  }
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isUsableDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

function isContactMethodAvailable(args: {
  method: ContactMethod
  recipient: ClientActionRecipientSnapshot
}): boolean {
  const email = normalizeOptionalString(args.recipient.recipientEmail)
  const phone = normalizeOptionalString(args.recipient.recipientPhone)

  if (args.method === ContactMethod.EMAIL) {
    return email != null
  }

  if (args.method === ContactMethod.SMS) {
    return phone != null
  }

  return false
}

function getDestinationSnapshotForMethod(args: {
  method: ContactMethod
  recipient: ClientActionRecipientSnapshot
}): string | null {
  if (args.method === ContactMethod.EMAIL) {
    return normalizeOptionalString(args.recipient.recipientEmail)
  }

  if (args.method === ContactMethod.SMS) {
    return normalizeOptionalString(args.recipient.recipientPhone)
  }

  return null
}

function getDeliveryMethodCandidateOrder(args: {
  recipient: ClientActionRecipientSnapshot
  registryPreferredContactMethod: ContactMethod | null
}): ContactMethod[] {
  const candidateOrder: ContactMethod[] = []

  const pushUnique = (method: ContactMethod | null | undefined) => {
    if (method == null) return
    if (!candidateOrder.includes(method)) {
      candidateOrder.push(method)
    }
  }

  /**
   * Precedence:
   * 1. recipient-level preference
   * 2. action-registry default preference
   * 3. deterministic fallback: EMAIL, then SMS
   */
  pushUnique(args.recipient.preferredContactMethod)
  pushUnique(args.registryPreferredContactMethod)
  pushUnique(ContactMethod.EMAIL)
  pushUnique(ContactMethod.SMS)

  return candidateOrder
}

export function requiresClientActionToken(actionType: ClientActionType): boolean {
  return getClientActionDefinition(actionType).token.required
}

export function getClientActionTokenKind(
  actionType: ClientActionType,
) {
  return getClientActionDefinition(actionType).token.kind
}

export function getClientActionNotificationEventKey(
  actionType: ClientActionType,
): NotificationEventKey | null {
  return getClientActionDefinition(actionType).delivery.notificationEventKey
}

export function shouldRevokeOutstandingTokensOnResend(
  actionType: ClientActionType,
): boolean {
  return getClientActionDefinition(actionType).token.revokeOutstandingOnResend
}

export function shouldCreateFreshDeliveryOnResend(
  actionType: ClientActionType,
): boolean {
  return getClientActionDefinition(actionType).delivery.createFreshDeliveryOnResend
}

export function isIntentionalResend(
  resendMode: ClientActionResendMode,
): boolean {
  return resendMode === 'RESEND'
}

export function isRetrySend(
  resendMode: ClientActionResendMode,
): boolean {
  return resendMode === 'RETRY'
}

export function resolveClientActionDeliveryMethod(args: {
  actionType: ClientActionType
  recipient: ClientActionRecipientSnapshot
  preferredContactMethodOverride?: ContactMethod | null
}): Success<ContactMethod> | Failure {
  const definition = getClientActionDefinition(args.actionType)
  const allowedMethods = definition.delivery.allowedContactMethods

  const preferredOverride = args.preferredContactMethodOverride ?? null
  if (preferredOverride != null) {
    if (!allowedMethods.includes(preferredOverride)) {
      return fail(
        'CLIENT_ACTION_CONTACT_METHOD_NOT_ALLOWED',
        `clientActions/policies: ${args.actionType} does not allow contact method ${preferredOverride}.`,
      )
    }

    if (
      !isContactMethodAvailable({
        method: preferredOverride,
        recipient: args.recipient,
      })
    ) {
      return fail(
        'CLIENT_ACTION_NO_DELIVERY_DESTINATION',
        `clientActions/policies: ${args.actionType} cannot use ${preferredOverride} because the destination snapshot is missing.`,
      )
    }

    return {
      ok: true,
      value: preferredOverride,
    }
  }

  const candidateOrder = getDeliveryMethodCandidateOrder({
    recipient: args.recipient,
    registryPreferredContactMethod: definition.delivery.preferredContactMethod,
  })

  for (const method of candidateOrder) {
    if (!allowedMethods.includes(method)) {
      continue
    }

    if (
      isContactMethodAvailable({
        method,
        recipient: args.recipient,
      })
    ) {
      return {
        ok: true,
        value: method,
      }
    }
  }

  return fail(
    'CLIENT_ACTION_NO_DELIVERY_DESTINATION',
    `clientActions/policies: ${args.actionType} has no usable delivery destination for allowed contact methods [${allowedMethods.join(', ')}].`,
  )
}

export function resolveClientActionDestinationSnapshot(args: {
  method: ContactMethod
  recipient: ClientActionRecipientSnapshot
}): Success<string> | Failure {
  const destinationSnapshot = getDestinationSnapshotForMethod(args)

  if (!destinationSnapshot) {
    return fail(
      'CLIENT_ACTION_NO_DELIVERY_DESTINATION',
      `clientActions/policies: destination snapshot is missing for contact method ${args.method}.`,
    )
  }

  return {
    ok: true,
    value: destinationSnapshot,
  }
}

export function resolveClientActionDelivery(args: {
  actionType: ClientActionType
  recipient: ClientActionRecipientSnapshot
  preferredContactMethodOverride?: ContactMethod | null
}): Success<ClientActionResolvedDelivery> | Failure {
  const definition = getClientActionDefinition(args.actionType)

  const resolvedMethod = resolveClientActionDeliveryMethod({
    actionType: args.actionType,
    recipient: args.recipient,
    preferredContactMethodOverride: args.preferredContactMethodOverride,
  })

  if (!resolvedMethod.ok) {
    return resolvedMethod
  }

  const resolvedDestination = resolveClientActionDestinationSnapshot({
    method: resolvedMethod.value,
    recipient: args.recipient,
  })

  if (!resolvedDestination.ok) {
    return resolvedDestination
  }

  return {
    ok: true,
    value: {
      method: resolvedMethod.value,
      destinationSnapshot: resolvedDestination.value,
      notificationEventKey: definition.delivery.notificationEventKey,
      notificationRecipientKind: definition.delivery.notificationRecipientKind,
    },
  }
}

export function resolveClientActionExpiresAt(args: {
  actionType: ClientActionType
  expiresAtOverride?: Date | null
  now?: Date
}): Success<Date | null> | Failure {
  const definition = getClientActionDefinition(args.actionType)
  const now = isUsableDate(args.now) ? args.now : new Date()
  const override = args.expiresAtOverride ?? null

  if (!definition.token.required) {
    if (override != null) {
      return fail(
        'CLIENT_ACTION_TOKEN_POLICY_INVALID',
        `clientActions/policies: ${args.actionType} does not use ClientActionToken expiry overrides because token.required is false.`,
      )
    }

    return {
      ok: true,
      value: null,
    }
  }

  if (override != null) {
    if (!isUsableDate(override)) {
      return fail(
        'CLIENT_ACTION_TOKEN_POLICY_INVALID',
        `clientActions/policies: ${args.actionType} received an invalid expiresAtOverride.`,
      )
    }

    if (override.getTime() <= now.getTime()) {
      return fail(
        'CLIENT_ACTION_TOKEN_POLICY_INVALID',
        `clientActions/policies: ${args.actionType} expiresAtOverride must be in the future.`,
      )
    }

    return {
      ok: true,
      value: override,
    }
  }

  const expiresInMs = definition.token.expiresInMs
  if (expiresInMs == null || expiresInMs <= 0) {
    return fail(
      'CLIENT_ACTION_TOKEN_POLICY_INVALID',
      `clientActions/policies: ${args.actionType} requires a token but has no valid expiresInMs policy.`,
    )
  }

  return {
    ok: true,
    value: new Date(now.getTime() + expiresInMs),
  }
}

export function validateClientActionRecipient(
  actionType: ClientActionType,
  recipient: ClientActionRecipientSnapshot,
): Success<ClientActionRecipientSnapshot> | Failure {
  const clientId = normalizeOptionalString(recipient.clientId)
  if (!clientId) {
    return fail(
      'CLIENT_ACTION_MISSING_CLIENT_ID',
      `clientActions/policies: ${actionType} requires recipient.clientId.`,
    )
  }

  const professionalId = normalizeOptionalString(recipient.professionalId)
  if (!professionalId) {
    return fail(
      'CLIENT_ACTION_MISSING_PROFESSIONAL_ID',
      `clientActions/policies: ${actionType} requires recipient.professionalId.`,
    )
  }

  return {
    ok: true,
    value: {
      ...recipient,
      clientId,
      professionalId,
      invitedName: normalizeOptionalString(recipient.invitedName),
      recipientEmail: normalizeOptionalString(recipient.recipientEmail),
      recipientPhone: normalizeOptionalString(recipient.recipientPhone),
      timeZone: normalizeOptionalString(recipient.timeZone),
      preferredContactMethod: recipient.preferredContactMethod ?? null,
      userId: normalizeOptionalString(recipient.userId),
    },
  }
}