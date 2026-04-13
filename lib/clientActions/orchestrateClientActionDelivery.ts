// lib/clientActions/orchestrateClientActionDelivery.ts

import { getClientActionDefinition } from './actionRegistry'
import { buildClientActionIdempotencyKeys } from './idempotency'
import {
  resolveClientActionExpiresAt,
  resolveClientActionDelivery,
  validateClientActionRecipient,
} from './policies'
import type {
  ClientActionOrchestrationFailure,
  ClientActionOrchestrationInput,
  ClientActionOrchestrationPlan,
  ClientActionOrchestrationResult,
} from './types'

function fail(
  code: ClientActionOrchestrationFailure['code'],
  error: string,
): ClientActionOrchestrationFailure {
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

function normalizeOptionalDate(value: Date | null | undefined): Date | null {
  return isUsableDate(value) ? value : null
}

function validateDefinitionConsistency(
  plan: Pick<ClientActionOrchestrationPlan, 'definition' | 'resolvedDelivery'>,
): ClientActionOrchestrationFailure | null {
  const { definition, resolvedDelivery } = plan

  if (definition.token.required && definition.token.kind == null) {
    return fail(
      'CLIENT_ACTION_TOKEN_POLICY_INVALID',
      `clientActions/orchestrateClientActionDelivery: ${definition.type} requires a token kind but none is configured.`,
    )
  }

  if (!definition.token.required && definition.token.kind != null) {
    return fail(
      'CLIENT_ACTION_TOKEN_POLICY_INVALID',
      `clientActions/orchestrateClientActionDelivery: ${definition.type} has a token kind configured even though token.required is false.`,
    )
  }

  if (definition.link.requiresToken && !definition.token.required) {
    /**
     * Claim links are the important exception:
     * they require a token in the URL, but not a ClientActionToken row.
     * That token comes from ProClientInvite.token.
     */
    if (definition.type !== 'CLIENT_CLAIM_INVITE') {
      return fail(
        'CLIENT_ACTION_LINK_POLICY_INVALID',
        `clientActions/orchestrateClientActionDelivery: ${definition.type} requires a tokenized link but does not require token issuance.`,
      )
    }
  }

  if (
    resolvedDelivery.notificationEventKey == null &&
    definition.type !== 'CLIENT_CLAIM_INVITE'
  ) {
    return fail(
      'CLIENT_ACTION_EVENT_POLICY_INVALID',
      `clientActions/orchestrateClientActionDelivery: ${definition.type} is missing a notification event key.`,
    )
  }

  return null
}

export function orchestrateClientActionDelivery(
  input: ClientActionOrchestrationInput,
): ClientActionOrchestrationResult {
  const definition = getClientActionDefinition(input.actionType)

  const validatedRecipient = validateClientActionRecipient(
    input.actionType,
    input.recipient,
  )

  if (!validatedRecipient.ok) {
    return validatedRecipient
  }

  const resolvedDelivery = resolveClientActionDelivery({
    actionType: input.actionType,
    recipient: validatedRecipient.value,
    preferredContactMethodOverride: null,
  })

  if (!resolvedDelivery.ok) {
    return resolvedDelivery
  }

  const resolvedExpiresAt = resolveClientActionExpiresAt({
    actionType: input.actionType,
    expiresAtOverride: input.expiresAtOverride ?? null,
  })

  if (!resolvedExpiresAt.ok) {
    return resolvedExpiresAt
  }

  const idempotency = buildClientActionIdempotencyKeys({
    actionType: input.actionType,
    refs: input.refs,
    recipient: {
      clientId: validatedRecipient.value.clientId,
      professionalId: validatedRecipient.value.professionalId,
      recipientEmail: validatedRecipient.value.recipientEmail,
      recipientPhone: validatedRecipient.value.recipientPhone,
    },
    resendMode: input.resendMode,
  })

  const plan: ClientActionOrchestrationPlan = {
    definition,
    refs: input.refs,
    recipient: validatedRecipient.value,
    resendMode: input.resendMode,
    idempotency,
    resolvedDelivery: resolvedDelivery.value,
    link: {
      target: definition.link.target,
      pathPrefix: definition.link.pathPrefix,
      requiresToken: definition.link.requiresToken,
    },
    issuedByUserId: normalizeOptionalString(input.issuedByUserId),
    expiresAtOverride: resolvedExpiresAt.value,
    metadata: input.metadata ?? null,
    tx: input.tx,
  }

  const consistencyFailure = validateDefinitionConsistency(plan)
  if (consistencyFailure) {
    return consistencyFailure
  }

  return {
    ok: true,
    plan,
  }
}