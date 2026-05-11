// lib/notifications/webhooks/applyDeliveryWebhookUpdate.ts

import { prisma } from '@/lib/prisma'
import {
  NotificationDeliveryEventType,
  NotificationDeliveryStatus,
  NotificationProvider,
  Prisma,
} from '@prisma/client'

import {
  mapWebhookKindToDeliveryTransition,
  type ProviderDeliveryWebhookKind,
} from '@/lib/notifications/providerStatus'

const webhookUpdateSelect = {
  id: true,
  dispatchId: true,
  channel: true,
  provider: true,
  status: true,
  destination: true,
  templateKey: true,
  templateVersion: true,
  attemptCount: true,
  maxAttempts: true,
  nextAttemptAt: true,
  lastAttemptAt: true,
  claimedAt: true,
  leaseExpiresAt: true,
  leaseToken: true,
  providerMessageId: true,
  providerStatus: true,
  lastErrorCode: true,
  lastErrorMessage: true,
  sentAt: true,
  deliveredAt: true,
  failedAt: true,
  suppressedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NotificationDeliverySelect

export type WebhookUpdatedNotificationDelivery =
  Prisma.NotificationDeliveryGetPayload<{
    select: typeof webhookUpdateSelect
  }>

export type ApplyDeliveryWebhookUpdateArgs = {
  provider: NotificationProvider
  providerMessageId: string
  providerStatus: string
  kind: ProviderDeliveryWebhookKind
  occurredAt?: Date
  message?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  payload?: Prisma.InputJsonValue | null
}

export type ApplyDeliveryWebhookUpdateResult =
  | {
      matched: false
      delivery: null
    }
  | {
      matched: true
      delivery: WebhookUpdatedNotificationDelivery
      previousStatus: NotificationDeliveryStatus
      nextStatus: NotificationDeliveryStatus
      statusChanged: boolean
    }

type MatchedDeliveryRecord = {
  id: string
  status: NotificationDeliveryStatus
  attemptCount: number
  provider: NotificationProvider
  providerMessageId: string | null
  providerStatus: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  sentAt: Date | null
  deliveredAt: Date | null
  failedAt: Date | null
  suppressedAt: Date | null
  cancelledAt: Date | null
}

type WebhookTransition = {
  nextStatus: NotificationDeliveryStatus
  eventType: NotificationDeliveryEventType
  deliveredAt?: Date | null
  failedAt?: Date | null
  lastErrorCode?: string | null
  lastErrorMessage?: string | null
}

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim()

  if (!normalized) {
    throw new Error(`applyDeliveryWebhookUpdate: missing ${fieldName}`)
  }

  return normalized
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeDate(value: Date | undefined, fieldName: string): Date {
  const normalized = value ?? new Date()

  if (!(normalized instanceof Date) || Number.isNaN(normalized.getTime())) {
    throw new Error(`applyDeliveryWebhookUpdate: invalid ${fieldName}`)
  }

  return normalized
}

function normalizeEventPayload(
  value: Prisma.InputJsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return value
}

function buildDefaultMessage(args: {
  kind: ProviderDeliveryWebhookKind
  providerStatus: string
  eventType: NotificationDeliveryEventType
  statusChanged: boolean
}): string {
  if (args.kind === 'DELIVERED' && args.statusChanged) {
    return `Provider webhook marked delivery delivered (${args.providerStatus}).`
  }

  if (args.kind === 'FAILED_FINAL' && args.statusChanged) {
    return `Provider webhook marked delivery failed (${args.providerStatus}).`
  }

  if (args.eventType === NotificationDeliveryEventType.WEBHOOK_UPDATE) {
    return `Provider webhook recorded status update (${args.providerStatus}).`
  }

  return `Provider webhook recorded terminal status already applied (${args.providerStatus}).`
}

function isDeliveryBlockedFromWebhookMutation(
  status: NotificationDeliveryStatus,
): boolean {
  return (
    status === NotificationDeliveryStatus.CANCELLED ||
    status === NotificationDeliveryStatus.SUPPRESSED
  )
}

function isDeliveredBlockedFromFailure(
  status: NotificationDeliveryStatus,
): boolean {
  return status === NotificationDeliveryStatus.DELIVERED
}

function isFailedBlockedFromDelivery(
  status: NotificationDeliveryStatus,
): boolean {
  return status === NotificationDeliveryStatus.FAILED_FINAL
}

function buildNoStatusChangeTransition(
  current: MatchedDeliveryRecord,
): WebhookTransition {
  return {
    nextStatus: current.status,
    eventType: NotificationDeliveryEventType.WEBHOOK_UPDATE,
  }
}

function resolveTransition(args: {
  current: MatchedDeliveryRecord
  kind: ProviderDeliveryWebhookKind
  occurredAt: Date
  errorCode: string | null
  errorMessage: string | null
}): WebhookTransition {
  if (args.kind === 'STATUS_UPDATE') {
    return buildNoStatusChangeTransition(args.current)
  }

  if (isDeliveryBlockedFromWebhookMutation(args.current.status)) {
    return buildNoStatusChangeTransition(args.current)
  }

  if (
    args.kind === 'DELIVERED' &&
    isFailedBlockedFromDelivery(args.current.status)
  ) {
    return buildNoStatusChangeTransition(args.current)
  }

  if (
    args.kind === 'FAILED_FINAL' &&
    isDeliveredBlockedFromFailure(args.current.status)
  ) {
    return buildNoStatusChangeTransition(args.current)
  }

  const baseTransition = mapWebhookKindToDeliveryTransition(args.kind)

  if (args.kind === 'DELIVERED') {
    return {
      nextStatus: baseTransition.nextStatus,
      eventType: baseTransition.eventType,
      deliveredAt: args.current.deliveredAt ?? args.occurredAt,
      failedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    }
  }

  if (args.kind === 'FAILED_FINAL') {
    return {
      nextStatus: baseTransition.nextStatus,
      eventType: baseTransition.eventType,
      failedAt: args.current.failedAt ?? args.occurredAt,
      lastErrorCode: args.errorCode ?? args.current.lastErrorCode,
      lastErrorMessage: args.errorMessage ?? args.current.lastErrorMessage,
    }
  }

  return buildNoStatusChangeTransition(args.current)
}

function buildWebhookEventPayload(args: {
  kind: ProviderDeliveryWebhookKind
  occurredAt: Date
  payload?: Prisma.InputJsonValue | null
}): Prisma.InputJsonValue {
  return {
    source: 'applyDeliveryWebhookUpdate',
    kind: args.kind,
    occurredAt: args.occurredAt.toISOString(),
    ...(args.payload !== undefined ? { webhook: args.payload } : {}),
  } satisfies Prisma.InputJsonObject
}

export async function applyDeliveryWebhookUpdate(
  args: ApplyDeliveryWebhookUpdateArgs,
): Promise<ApplyDeliveryWebhookUpdateResult> {
  const provider = args.provider
  const providerMessageId = normalizeRequiredString(
    args.providerMessageId,
    'providerMessageId',
  )
  const providerStatus = normalizeRequiredString(
    args.providerStatus,
    'providerStatus',
  )
  const occurredAt = normalizeDate(args.occurredAt, 'occurredAt')
  const errorCode = normalizeOptionalString(args.errorCode)
  const errorMessage = normalizeOptionalString(args.errorMessage)

  return prisma.$transaction(async (tx) => {
    const current = await tx.notificationDelivery.findFirst({
      where: {
        provider,
        providerMessageId,
      },
      select: {
        id: true,
        status: true,
        attemptCount: true,
        provider: true,
        providerMessageId: true,
        providerStatus: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        sentAt: true,
        deliveredAt: true,
        failedAt: true,
        suppressedAt: true,
        cancelledAt: true,
      },
    })

    if (!current) {
      return {
        matched: false,
        delivery: null,
      }
    }

    const transition = resolveTransition({
      current,
      kind: args.kind,
      occurredAt,
      errorCode,
      errorMessage,
    })

    const statusChanged = current.status !== transition.nextStatus

    const message =
      normalizeOptionalString(args.message) ??
      buildDefaultMessage({
        kind: args.kind,
        providerStatus,
        eventType: transition.eventType,
        statusChanged,
      })

    await tx.notificationDelivery.update({
      where: {
        id: current.id,
      },
      data: {
        status: transition.nextStatus,
        providerStatus,
        ...(transition.deliveredAt !== undefined
          ? { deliveredAt: transition.deliveredAt }
          : {}),
        ...(transition.failedAt !== undefined
          ? { failedAt: transition.failedAt }
          : {}),
        ...(transition.lastErrorCode !== undefined
          ? { lastErrorCode: transition.lastErrorCode }
          : {}),
        ...(transition.lastErrorMessage !== undefined
          ? { lastErrorMessage: transition.lastErrorMessage }
          : {}),
      },
    })

    const payload = normalizeEventPayload(
      buildWebhookEventPayload({
        kind: args.kind,
        occurredAt,
        payload: args.payload,
      }),
    )

    await tx.notificationDeliveryEvent.create({
      data: {
        delivery: {
          connect: {
            id: current.id,
          },
        },
        attemptNumber: current.attemptCount > 0 ? current.attemptCount : null,
        type: transition.eventType,
        fromStatus: current.status,
        toStatus: transition.nextStatus,
        providerStatus,
        providerMessageId,
        errorCode,
        errorMessage,
        message,
        ...(payload !== undefined ? { payload } : {}),
        createdAt: occurredAt,
      },
    })

    const delivery = await tx.notificationDelivery.findUnique({
      where: {
        id: current.id,
      },
      select: webhookUpdateSelect,
    })

    if (!delivery) {
      throw new Error(
        'applyDeliveryWebhookUpdate: delivery not found after update',
      )
    }

    return {
      matched: true,
      delivery,
      previousStatus: current.status,
      nextStatus: transition.nextStatus,
      statusChanged,
    }
  })
}