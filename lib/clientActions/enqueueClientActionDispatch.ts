// lib/clientActions/enqueueClientActionDispatch.ts

import {
  NotificationChannel,
  NotificationEventKey,
  NotificationPriority,
  NotificationRecipientKind,
  Prisma,
} from '@prisma/client'

import type { NotificationPreferenceLike } from '@/lib/notifications/channelPolicy'
import {
  enqueueDispatch,
  type EnqueueDispatchResult,
} from '@/lib/notifications/dispatch/enqueueDispatch'

import type { ClientActionOrchestrationPlan } from './types'

export type EnqueueClientActionDispatchArgs = {
  plan: ClientActionOrchestrationPlan
  href: string
  title: string
  body?: string | null
  payload?: Prisma.InputJsonValue | null
  priority?: NotificationPriority | null
  scheduledFor?: Date | null

  /**
   * Useful during rollout while registry/event wiring catches up.
   * For example:
   * - CLIENT_CLAIM_INVITE may temporarily pass NotificationEventKey.CLIENT_CLAIM_INVITE
   *   explicitly until actionRegistry is updated to use it directly.
   */
  eventKeyOverride?: NotificationEventKey | null

  /**
   * Optional preference snapshot if the caller already has it.
   * This helper does not fetch preferences on its own.
   */
  preference?: NotificationPreferenceLike | null

  /**
   * Optional explicit verification timestamps.
   *
   * Important:
   * enqueueDispatch channel capability checks require verifiedAt values
   * for SMS/email channels. Claim invites often target unclaimed snapshot
   * destinations, so this helper supports controlled override behavior below.
   */
  emailVerifiedAt?: Date | null
  phoneVerifiedAt?: Date | null

  /**
   * For CLIENT_CLAIM_INVITE, we intentionally allow snapshot destinations
   * without account-level verification, because the invite itself is how the
   * user establishes account ownership.
   *
   * Defaults:
   * - true for CLIENT_CLAIM_INVITE
   * - false for other client actions
   */
  allowUnverifiedDestination?: boolean

  /**
   * Optional override for dispatch idempotency/source key.
   * Defaults to plan.idempotency.sendKey.
   */
  sourceKeyOverride?: string | null

  notificationId?: string | null
  clientNotificationId?: string | null

  tx?: Prisma.TransactionClient
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

function resolveEventKey(
  args: Pick<EnqueueClientActionDispatchArgs, 'eventKeyOverride' | 'plan'>,
): NotificationEventKey {
  const eventKey =
    args.eventKeyOverride ??
    args.plan.resolvedDelivery.notificationEventKey ??
    args.plan.definition.delivery.notificationEventKey

  if (!eventKey) {
    throw new Error(
      `clientActions/enqueueClientActionDispatch: missing notification event key for ${args.plan.definition.type}.`,
    )
  }

  return eventKey
}

function resolveRequestedChannels(
  plan: ClientActionOrchestrationPlan,
): readonly NotificationChannel[] {
  const method = plan.resolvedDelivery.method

  if (!method) {
    throw new Error(
      `clientActions/enqueueClientActionDispatch: missing resolved delivery method for ${plan.definition.type}.`,
    )
  }

  if (method === 'EMAIL') {
    return [NotificationChannel.EMAIL]
  }

  if (method === 'SMS') {
    return [NotificationChannel.SMS]
  }

  throw new Error(
    `clientActions/enqueueClientActionDispatch: unsupported contact method ${String(method)} for ${plan.definition.type}.`,
  )
}

function resolveAllowUnverifiedDestination(
  args: Pick<EnqueueClientActionDispatchArgs, 'allowUnverifiedDestination' | 'plan'>,
): boolean {
  if (typeof args.allowUnverifiedDestination === 'boolean') {
    return args.allowUnverifiedDestination
  }

  return args.plan.definition.type === 'CLIENT_CLAIM_INVITE'
}

function resolveSyntheticVerificationTimestamp(args: {
  explicitVerifiedAt: Date | null
  destination: string | null
  allowUnverifiedDestination: boolean
  fallbackAt: Date
}): Date | null {
  if (args.explicitVerifiedAt) {
    return args.explicitVerifiedAt
  }

  if (!args.allowUnverifiedDestination) {
    return null
  }

  if (!args.destination) {
    return null
  }

  /**
   * This is an enqueue-time eligibility timestamp, not a user-account claim
   * about ownership verification.
   *
   * We only synthesize it for snapshot-based invite delivery flows where the
   * business action itself is "send the invite to this destination".
   */
  return args.fallbackAt
}

function resolveInAppTargetId(plan: ClientActionOrchestrationPlan): string | null {
  /**
   * For unclaimed clients there is no signed-in app target yet.
   * For claimed users, clientId is the correct in-app target id shape used
   * elsewhere in the client dispatch layer.
   */
  return plan.recipient.userId ? plan.recipient.clientId : null
}

export async function enqueueClientActionDispatch(
  args: EnqueueClientActionDispatchArgs,
): Promise<EnqueueDispatchResult> {
  if (
    args.plan.resolvedDelivery.notificationRecipientKind !==
    NotificationRecipientKind.CLIENT
  ) {
    throw new Error(
      `clientActions/enqueueClientActionDispatch: unsupported recipient kind ${String(args.plan.resolvedDelivery.notificationRecipientKind)} for ${args.plan.definition.type}.`,
    )
  }

  const sourceKey =
    normalizeOptionalString(args.sourceKeyOverride) ?? args.plan.idempotency.sendKey

  if (!sourceKey) {
    throw new Error(
      `clientActions/enqueueClientActionDispatch: missing sourceKey for ${args.plan.definition.type}.`,
    )
  }

  const eventKey = resolveEventKey(args)
  const requestedChannels = resolveRequestedChannels(args.plan)
  const scheduledFor = normalizeOptionalDate(args.scheduledFor) ?? new Date()

  const recipientEmail = normalizeOptionalString(args.plan.recipient.recipientEmail)
  const recipientPhone = normalizeOptionalString(args.plan.recipient.recipientPhone)
  const allowUnverifiedDestination = resolveAllowUnverifiedDestination(args)

  const emailVerifiedAt = resolveSyntheticVerificationTimestamp({
    explicitVerifiedAt: normalizeOptionalDate(args.emailVerifiedAt),
    destination: recipientEmail,
    allowUnverifiedDestination,
    fallbackAt: scheduledFor,
  })

  const phoneVerifiedAt = resolveSyntheticVerificationTimestamp({
    explicitVerifiedAt: normalizeOptionalDate(args.phoneVerifiedAt),
    destination: recipientPhone,
    allowUnverifiedDestination,
    fallbackAt: scheduledFor,
  })

  return enqueueDispatch({
    key: eventKey,
    sourceKey,
    recipient: {
      kind: NotificationRecipientKind.CLIENT,
      clientId: args.plan.recipient.clientId,
      userId: args.plan.recipient.userId ?? null,
      inAppTargetId: resolveInAppTargetId(args.plan),
      phone: recipientPhone,
      phoneVerifiedAt,
      email: recipientEmail,
      emailVerifiedAt,
      timeZone: args.plan.recipient.timeZone ?? null,
      preference: args.preference ?? null,
    },
    title: args.title,
    body: args.body ?? '',
    href: args.href,
    payload: args.payload ?? args.plan.metadata ?? null,
    priority: args.priority ?? undefined,
    scheduledFor,
    notificationId: args.notificationId ?? null,
    clientNotificationId: args.clientNotificationId ?? null,
    requestedChannels,
    tx: args.tx ?? args.plan.tx,
  })
}