import { prisma } from '@/lib/prisma'
import {
  NotificationDeliveryEventType,
  NotificationDeliveryStatus,
  NotificationProvider,
  Prisma,
} from '@prisma/client'

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
  kind: 'STATUS_UPDATE' | 'DELIVERED' | 'FAILED_FINAL'
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

function buildDefaultMessage(
  kind: ApplyDeliveryWebhookUpdateArgs['kind'],
  providerStatus: string,
): string {
  if (kind === 'DELIVERED') {
    return `Provider webhook marked delivery delivered (${providerStatus}).`
  }

  if (kind === 'FAILED_FINAL') {
    return `Provider webhook marked delivery failed (${providerStatus}).`
  }

  return `Provider webhook recorded status update (${providerStatus}).`
}

function isTerminalBlockedStatus(status: NotificationDeliveryStatus): boolean {
  return (
    status === NotificationDeliveryStatus.CANCELLED ||
    status === NotificationDeliveryStatus.SUPPRESSED
  )
}

function resolveTransition(args: {
  current: MatchedDeliveryRecord
  kind: ApplyDeliveryWebhookUpdateArgs['kind']
  occurredAt: Date
  errorCode: string | null
  errorMessage: string | null
}): WebhookTransition {
  if (args.kind === 'STATUS_UPDATE') {
    return {
      nextStatus: args.current.status,
    }
  }

  if (args.kind === 'DELIVERED') {
    if (
      args.current.status === NotificationDeliveryStatus.FAILED_FINAL ||
      isTerminalBlockedStatus(args.current.status)
    ) {
      return {
        nextStatus: args.current.status,
      }
    }

    return {
      nextStatus: NotificationDeliveryStatus.DELIVERED,
      deliveredAt: args.current.deliveredAt ?? args.occurredAt,
      failedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    }
  }

  if (
    args.current.status === NotificationDeliveryStatus.DELIVERED ||
    isTerminalBlockedStatus(args.current.status)
  ) {
    return {
      nextStatus: args.current.status,
    }
  }

  return {
    nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
    failedAt: args.current.failedAt ?? args.occurredAt,
    lastErrorCode: args.errorCode ?? args.current.lastErrorCode,
    lastErrorMessage: args.errorMessage ?? args.current.lastErrorMessage,
  }
}

function buildWebhookEventPayload(args: {
  kind: ApplyDeliveryWebhookUpdateArgs['kind']
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
  const message =
    normalizeOptionalString(args.message) ??
    buildDefaultMessage(args.kind, providerStatus)

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
        type: NotificationDeliveryEventType.WEBHOOK_UPDATE,
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
      statusChanged: current.status !== transition.nextStatus,
    }
  })
}