import { prisma } from '@/lib/prisma'
import {
  NotificationDeliveryEventType,
  NotificationDeliveryStatus,
  Prisma,
} from '@prisma/client'

const completeDeliveryAttemptSelect = {
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
  dispatch: {
    select: {
      id: true,
      sourceKey: true,
      eventKey: true,
      recipientKind: true,
      priority: true,
      userId: true,
      professionalId: true,
      clientId: true,
      recipientInAppTargetId: true,
      recipientPhone: true,
      recipientEmail: true,
      recipientTimeZone: true,
      notificationId: true,
      clientNotificationId: true,
      title: true,
      body: true,
      href: true,
      payload: true,
      scheduledFor: true,
      cancelledAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.NotificationDeliverySelect

export type CompletedNotificationDelivery = Prisma.NotificationDeliveryGetPayload<{
  select: typeof completeDeliveryAttemptSelect
}>

type OwnedDeliveryRecord = {
  id: string
  status: NotificationDeliveryStatus
  attemptCount: number
  maxAttempts: number
  claimedAt: Date | null
  leaseExpiresAt: Date | null
  leaseToken: string | null
  cancelledAt: Date | null
  dispatch: {
    cancelledAt: Date | null
  }
}

type CompleteAttemptBase = {
  deliveryId: string
  leaseToken: string
  attemptedAt?: Date
  providerMessageId?: string | null
  providerStatus?: string | null
  responseMeta?: Prisma.InputJsonValue | null
}

export type CompleteDeliveryAttemptSuccessArgs = CompleteAttemptBase & {
  kind: 'SUCCESS'
  deliveredAt?: Date | null
  message?: string | null
}

export type CompleteDeliveryAttemptRetryableFailureArgs = CompleteAttemptBase & {
  kind: 'RETRYABLE_FAILURE'
  code: string
  message: string
  nextAttemptAt: Date
}

export type CompleteDeliveryAttemptFinalFailureArgs = CompleteAttemptBase & {
  kind: 'FINAL_FAILURE'
  code: string
  message: string
}

export type CompleteDeliveryAttemptArgs =
  | CompleteDeliveryAttemptSuccessArgs
  | CompleteDeliveryAttemptRetryableFailureArgs
  | CompleteDeliveryAttemptFinalFailureArgs

export type CompleteDeliveryAttemptResult = {
  delivery: CompletedNotificationDelivery
}

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim()

  if (!normalized) {
    throw new Error(`completeDeliveryAttempt: missing ${fieldName}`)
  }

  return normalized
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeDate(value: Date | undefined, fieldName: string): Date {
  const normalized = value ?? new Date()

  if (!(normalized instanceof Date) || Number.isNaN(normalized.getTime())) {
    throw new Error(`completeDeliveryAttempt: invalid ${fieldName}`)
  }

  return normalized
}

function normalizeExplicitDate(
  value: Date | null | undefined,
  fieldName: string,
): Date | null {
  if (value == null) return null

  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`completeDeliveryAttempt: invalid ${fieldName}`)
  }

  return value
}

function normalizeEventPayload(
  value: Prisma.InputJsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return value
}

function buildOwnedWhere(args: {
  deliveryId: string
  leaseToken: string
  now: Date
}): Prisma.NotificationDeliveryWhereInput {
  return {
    id: args.deliveryId,
    leaseToken: args.leaseToken,
    cancelledAt: null,
    claimedAt: {
      not: null,
    },
    leaseExpiresAt: {
      gt: args.now,
    },
    dispatch: {
      cancelledAt: null,
    },
  }
}

async function loadOwnedDelivery(args: {
  tx: Prisma.TransactionClient
  deliveryId: string
  leaseToken: string
  now: Date
}): Promise<OwnedDeliveryRecord> {
  const delivery = await args.tx.notificationDelivery.findFirst({
    where: buildOwnedWhere(args),
    select: {
      id: true,
      status: true,
      attemptCount: true,
      maxAttempts: true,
      claimedAt: true,
      leaseExpiresAt: true,
      leaseToken: true,
      cancelledAt: true,
      dispatch: {
        select: {
          cancelledAt: true,
        },
      },
    },
  })

  if (!delivery) {
    throw new Error('completeDeliveryAttempt: delivery not owned by active lease')
  }

  return delivery
}

function buildSuccessEvents(args: {
  previousStatus: NotificationDeliveryStatus
  finalStatus: NotificationDeliveryStatus
  attemptedAt: Date
  deliveredAt: Date | null
  providerStatus: string | null
  providerMessageId: string | null
  message: string | null
  responseMeta?: Prisma.InputJsonValue | null
}): Prisma.NotificationDeliveryEventCreateManyInput[] {
  const acceptedMessage =
    args.message ?? 'Provider accepted the delivery attempt.'

  const acceptedPayload = normalizeEventPayload(args.responseMeta)

  const events: Prisma.NotificationDeliveryEventCreateManyInput[] = [
    {
      deliveryId: '',
      attemptNumber: undefined,
      type: NotificationDeliveryEventType.PROVIDER_ACCEPTED,
      fromStatus: args.previousStatus,
      toStatus: NotificationDeliveryStatus.SENT,
      providerStatus: args.providerStatus,
      providerMessageId: args.providerMessageId,
      message: acceptedMessage,
      ...(acceptedPayload !== undefined ? { payload: acceptedPayload } : {}),
      createdAt: args.attemptedAt,
    },
  ]

  if (args.finalStatus === NotificationDeliveryStatus.DELIVERED && args.deliveredAt) {
    events.push({
      deliveryId: '',
      attemptNumber: undefined,
      type: NotificationDeliveryEventType.DELIVERED,
      fromStatus: NotificationDeliveryStatus.SENT,
      toStatus: NotificationDeliveryStatus.DELIVERED,
      providerStatus: args.providerStatus,
      providerMessageId: args.providerMessageId,
      message: 'Delivery marked delivered.',
      ...(acceptedPayload !== undefined ? { payload: acceptedPayload } : {}),
      createdAt: args.deliveredAt,
    })
  }

  return events
}

function buildRetryableFailureEvents(args: {
  previousStatus: NotificationDeliveryStatus
  attemptedAt: Date
  nextAttemptAt: Date
  code: string
  message: string
  providerStatus: string | null
  providerMessageId: string | null
  responseMeta?: Prisma.InputJsonValue | null
}): Prisma.NotificationDeliveryEventCreateManyInput[] {
  const failurePayload = normalizeEventPayload(args.responseMeta)

  const retryPayload = normalizeEventPayload({
    source: 'completeDeliveryAttempt',
    nextAttemptAt: args.nextAttemptAt.toISOString(),
    ...(args.responseMeta !== undefined ? { responseMeta: args.responseMeta } : {}),
  })

  return [
    {
      deliveryId: '',
      attemptNumber: undefined,
      type: NotificationDeliveryEventType.FAILED,
      fromStatus: args.previousStatus,
      toStatus: NotificationDeliveryStatus.FAILED_RETRYABLE,
      providerStatus: args.providerStatus,
      providerMessageId: args.providerMessageId,
      errorCode: args.code,
      errorMessage: args.message,
      message: 'Delivery attempt failed and will be retried.',
      ...(failurePayload !== undefined ? { payload: failurePayload } : {}),
      createdAt: args.attemptedAt,
    },
    {
      deliveryId: '',
      attemptNumber: undefined,
      type: NotificationDeliveryEventType.RETRY_SCHEDULED,
      fromStatus: NotificationDeliveryStatus.FAILED_RETRYABLE,
      toStatus: NotificationDeliveryStatus.FAILED_RETRYABLE,
      providerStatus: args.providerStatus,
      providerMessageId: args.providerMessageId,
      message: `Retry scheduled for ${args.nextAttemptAt.toISOString()}.`,
      ...(retryPayload !== undefined ? { payload: retryPayload } : {}),
      createdAt: args.attemptedAt,
    },
  ]
}

function buildFinalFailureEvents(args: {
  previousStatus: NotificationDeliveryStatus
  attemptedAt: Date
  code: string
  message: string
  providerStatus: string | null
  providerMessageId: string | null
  responseMeta?: Prisma.InputJsonValue | null
}): Prisma.NotificationDeliveryEventCreateManyInput[] {
  const payload = normalizeEventPayload(args.responseMeta)

  return [
    {
      deliveryId: '',
      attemptNumber: undefined,
      type: NotificationDeliveryEventType.FAILED,
      fromStatus: args.previousStatus,
      toStatus: NotificationDeliveryStatus.FAILED_FINAL,
      providerStatus: args.providerStatus,
      providerMessageId: args.providerMessageId,
      errorCode: args.code,
      errorMessage: args.message,
      message: 'Delivery attempt failed permanently.',
      ...(payload !== undefined ? { payload } : {}),
      createdAt: args.attemptedAt,
    },
  ]
}

function stampEvents(
  deliveryId: string,
  attemptNumber: number,
  events: Prisma.NotificationDeliveryEventCreateManyInput[],
): Prisma.NotificationDeliveryEventCreateManyInput[] {
  return events.map((event) => ({
    ...event,
    deliveryId,
    attemptNumber,
  }))
}

export async function completeDeliveryAttempt(
  args: CompleteDeliveryAttemptArgs,
): Promise<CompleteDeliveryAttemptResult> {
  const deliveryId = normalizeRequiredString(args.deliveryId, 'deliveryId')
  const leaseToken = normalizeRequiredString(args.leaseToken, 'leaseToken')
  const attemptedAt = normalizeDate(args.attemptedAt, 'attemptedAt')
  const providerMessageId = normalizeOptionalString(args.providerMessageId)
  const providerStatus = normalizeOptionalString(args.providerStatus)

  if (
    args.kind === 'RETRYABLE_FAILURE' &&
    (!(args.nextAttemptAt instanceof Date) || Number.isNaN(args.nextAttemptAt.getTime()))
  ) {
    throw new Error('completeDeliveryAttempt: invalid nextAttemptAt')
  }

  return prisma.$transaction(async (tx) => {
    const owned = await loadOwnedDelivery({
      tx,
      deliveryId,
      leaseToken,
      now: attemptedAt,
    })

    const nextAttemptCount = owned.attemptCount + 1

    if (args.kind === 'SUCCESS') {
      const deliveredAt = normalizeExplicitDate(args.deliveredAt, 'deliveredAt')
      const finalStatus =
        deliveredAt != null
          ? NotificationDeliveryStatus.DELIVERED
          : NotificationDeliveryStatus.SENT

      await tx.notificationDelivery.update({
        where: {
          id: owned.id,
        },
        data: {
          status: finalStatus,
          attemptCount: nextAttemptCount,
          lastAttemptAt: attemptedAt,
          providerMessageId,
          providerStatus,
          lastErrorCode: null,
          lastErrorMessage: null,
          sentAt: attemptedAt,
          deliveredAt,
          failedAt: null,
          claimedAt: null,
          leaseExpiresAt: null,
          leaseToken: null,
        },
      })

      const events = stampEvents(
        owned.id,
        nextAttemptCount,
        buildSuccessEvents({
          previousStatus: owned.status,
          finalStatus,
          attemptedAt,
          deliveredAt,
          providerStatus,
          providerMessageId,
          message: normalizeOptionalString(args.message),
          responseMeta: args.responseMeta,
        }),
      )

      await tx.notificationDeliveryEvent.createMany({
        data: events,
      })
    } else if (args.kind === 'RETRYABLE_FAILURE') {
      if (owned.attemptCount >= owned.maxAttempts - 1) {
        throw new Error(
          'completeDeliveryAttempt: retryable failure exceeds remaining maxAttempts',
        )
      }

      if (args.nextAttemptAt.getTime() <= attemptedAt.getTime()) {
        throw new Error(
          'completeDeliveryAttempt: nextAttemptAt must be after attemptedAt',
        )
      }

      await tx.notificationDelivery.update({
        where: {
          id: owned.id,
        },
        data: {
          status: NotificationDeliveryStatus.FAILED_RETRYABLE,
          attemptCount: nextAttemptCount,
          lastAttemptAt: attemptedAt,
          nextAttemptAt: args.nextAttemptAt,
          providerMessageId,
          providerStatus,
          lastErrorCode: normalizeRequiredString(args.code, 'code'),
          lastErrorMessage: normalizeRequiredString(args.message, 'message'),
          failedAt: null,
          claimedAt: null,
          leaseExpiresAt: null,
          leaseToken: null,
        },
      })

      const events = stampEvents(
        owned.id,
        nextAttemptCount,
        buildRetryableFailureEvents({
          previousStatus: owned.status,
          attemptedAt,
          nextAttemptAt: args.nextAttemptAt,
          code: normalizeRequiredString(args.code, 'code'),
          message: normalizeRequiredString(args.message, 'message'),
          providerStatus,
          providerMessageId,
          responseMeta: args.responseMeta,
        }),
      )

      await tx.notificationDeliveryEvent.createMany({
        data: events,
      })
    } else {
      await tx.notificationDelivery.update({
        where: {
          id: owned.id,
        },
        data: {
          status: NotificationDeliveryStatus.FAILED_FINAL,
          attemptCount: nextAttemptCount,
          lastAttemptAt: attemptedAt,
          providerMessageId,
          providerStatus,
          lastErrorCode: normalizeRequiredString(args.code, 'code'),
          lastErrorMessage: normalizeRequiredString(args.message, 'message'),
          failedAt: attemptedAt,
          claimedAt: null,
          leaseExpiresAt: null,
          leaseToken: null,
        },
      })

      const events = stampEvents(
        owned.id,
        nextAttemptCount,
        buildFinalFailureEvents({
          previousStatus: owned.status,
          attemptedAt,
          code: normalizeRequiredString(args.code, 'code'),
          message: normalizeRequiredString(args.message, 'message'),
          providerStatus,
          providerMessageId,
          responseMeta: args.responseMeta,
        }),
      )

      await tx.notificationDeliveryEvent.createMany({
        data: events,
      })
    }

    const delivery = await tx.notificationDelivery.findUnique({
      where: {
        id: owned.id,
      },
      select: completeDeliveryAttemptSelect,
    })

    if (!delivery) {
      throw new Error('completeDeliveryAttempt: delivery not found after update')
    }

    return {
      delivery,
    }
  })
}