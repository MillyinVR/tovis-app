import crypto from 'node:crypto'

import { prisma } from '@/lib/prisma'
import {
  NotificationChannel,
  NotificationDeliveryEventType,
  NotificationDeliveryStatus,
  NotificationRecipientKind,
  Prisma,
} from '@prisma/client'

import { type NotificationPreferenceLike } from '../channelPolicy'
import { getNotificationEventDefinition } from '../eventKeys'
import { evaluateRuntimeDeliveryChannelPolicy } from './runtimeChannelPolicy'

const DEFAULT_BATCH_SIZE = 25
const MAX_BATCH_SIZE = 100
const DEFAULT_LEASE_MS = 60_000
const LEASE_TOKEN_BYTES = 16

const DELIVERY_ORDER_BY = [
  { nextAttemptAt: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.NotificationDeliveryOrderByWithRelationInput[]

const claimDeliveriesSelect = {
  id: true,
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

const runtimePolicyCandidateSelect = {
  id: true,
  channel: true,
  status: true,
  nextAttemptAt: true,
  claimedAt: true,
  leaseExpiresAt: true,
  leaseToken: true,
  createdAt: true,
  dispatch: {
    select: {
      id: true,
      eventKey: true,
      recipientKind: true,
      professionalId: true,
      clientId: true,
      recipientTimeZone: true,
      cancelledAt: true,
    },
  },
} satisfies Prisma.NotificationDeliverySelect

export type ClaimedNotificationDelivery = Prisma.NotificationDeliveryGetPayload<{
  select: typeof claimDeliveriesSelect
}>

type RuntimePolicyCandidateDelivery = Prisma.NotificationDeliveryGetPayload<{
  select: typeof runtimePolicyCandidateSelect
}>

export type ClaimDeliveriesArgs = {
  now?: Date
  batchSize?: number
  leaseMs?: number
}

export type ClaimDeliveriesResult = {
  now: Date
  claimedAt: Date
  leaseExpiresAt: Date
  deliveries: ClaimedNotificationDelivery[]
}

function normalizeNow(value: Date | undefined): Date {
  const now = value ?? new Date()

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('claimDeliveries: invalid now')
  }

  return now
}

function normalizeBatchSize(value: number | undefined): number {
  if (value == null) return DEFAULT_BATCH_SIZE

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('claimDeliveries: invalid batchSize')
  }

  return Math.min(value, MAX_BATCH_SIZE)
}

function normalizeLeaseMs(value: number | undefined): number {
  if (value == null) return DEFAULT_LEASE_MS

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('claimDeliveries: invalid leaseMs')
  }

  return value
}

function buildLeaseExpiresAt(now: Date, leaseMs: number): Date {
  return new Date(now.getTime() + leaseMs)
}

function buildLeaseToken(): string {
  return crypto.randomBytes(LEASE_TOKEN_BYTES).toString('hex')
}

function buildClaimableBaseWhere(
  now: Date,
): Omit<Prisma.NotificationDeliveryWhereInput, 'id'> {
  return {
    status: NotificationDeliveryStatus.PENDING,
    cancelledAt: null,
    suppressedAt: null,
    failedAt: null,
    sentAt: null,
    deliveredAt: null,
    nextAttemptAt: {
      lte: now,
    },
    OR: [
      { claimedAt: null },
      { leaseExpiresAt: null },
      {
        leaseExpiresAt: {
          lte: now,
        },
      },
    ],
    dispatch: {
      cancelledAt: null,
    },
  }
}

function buildClaimableWhere(now: Date): Prisma.NotificationDeliveryWhereInput {
  return buildClaimableBaseWhere(now)
}

function buildGuardedCandidateWhere(args: {
  deliveryId: string
  now: Date
}): Prisma.NotificationDeliveryWhereInput {
  return {
    id: args.deliveryId,
    ...buildClaimableBaseWhere(args.now),
  }
}

function buildClaimEvent(args: {
  deliveryId: string
  claimedAt: Date
  leaseExpiresAt: Date
  leaseToken: string
}): Prisma.NotificationDeliveryEventCreateInput {
  return {
    type: NotificationDeliveryEventType.CLAIMED,
    fromStatus: NotificationDeliveryStatus.PENDING,
    toStatus: NotificationDeliveryStatus.PENDING,
    message: 'Delivery claimed for worker processing.',
    payload: {
      source: 'claimDeliveries',
      claimedAt: args.claimedAt.toISOString(),
      leaseExpiresAt: args.leaseExpiresAt.toISOString(),
      leaseToken: args.leaseToken,
    },
    delivery: {
      connect: {
        id: args.deliveryId,
      },
    },
  }
}

function buildQuietHoursDeferredEvent(args: {
  deliveryId: string
  deferredAt: Date
  nextAttemptAt: Date
  channel: NotificationChannel
  recipientLocalMinutes: number
  quietHoursStartMinutes: number
  quietHoursEndMinutes: number
}): Prisma.NotificationDeliveryEventCreateInput {
  return {
    type: NotificationDeliveryEventType.RETRY_SCHEDULED,
    fromStatus: NotificationDeliveryStatus.PENDING,
    toStatus: NotificationDeliveryStatus.PENDING,
    message: 'Delivery deferred due to quiet hours.',
    payload: {
      source: 'claimDeliveries',
      channel: args.channel,
      deferredAt: args.deferredAt.toISOString(),
      nextAttemptAt: args.nextAttemptAt.toISOString(),
      reason: 'QUIET_HOURS',
      recipientLocalMinutes: args.recipientLocalMinutes,
      quietHoursStartMinutes: args.quietHoursStartMinutes,
      quietHoursEndMinutes: args.quietHoursEndMinutes,
    },
    delivery: {
      connect: {
        id: args.deliveryId,
      },
    },
  }
}

async function loadPreferenceForCandidate(args: {
  tx: Prisma.TransactionClient
  candidate: RuntimePolicyCandidateDelivery
}): Promise<NotificationPreferenceLike | null> {
  if (
    args.candidate.dispatch.recipientKind === NotificationRecipientKind.CLIENT
  ) {
    const clientId = args.candidate.dispatch.clientId
    if (!clientId) return null

    return args.tx.clientNotificationPreference.findUnique({
      where: {
        clientId_eventKey: {
          clientId,
          eventKey: args.candidate.dispatch.eventKey,
        },
      },
    })
  }

  const professionalId = args.candidate.dispatch.professionalId
  if (!professionalId) return null

  return args.tx.professionalNotificationPreference.findUnique({
    where: {
      professionalId_eventKey: {
        professionalId,
        eventKey: args.candidate.dispatch.eventKey,
      },
    },
  })
}

function channelUsesRuntimeQuietHours(channel: NotificationChannel): boolean {
  return (
    channel === NotificationChannel.SMS ||
    channel === NotificationChannel.EMAIL
  )
}

function shouldRequestRuntimeQuietHoursBypass(
  candidate: RuntimePolicyCandidateDelivery,
): boolean {
  return getNotificationEventDefinition(candidate.dispatch.eventKey)
    .allowQuietHoursBypass
}

async function maybeDeferCandidateForQuietHours(args: {
  tx: Prisma.TransactionClient
  candidate: RuntimePolicyCandidateDelivery
  now: Date
}): Promise<boolean> {
  if (!channelUsesRuntimeQuietHours(args.candidate.channel)) {
    return false
  }

  const preference = await loadPreferenceForCandidate({
    tx: args.tx,
    candidate: args.candidate,
  })

  const runtimePolicy = evaluateRuntimeDeliveryChannelPolicy({
    key: args.candidate.dispatch.eventKey,
    channel: args.candidate.channel,
    now: args.now,
    recipientTimeZone: args.candidate.dispatch.recipientTimeZone,
    preference,
    /**
     * Runtime bypass is event-definition-authoritative.
     * If the event allows bypass, the worker should send during quiet hours.
     * If the event does not allow bypass, the policy helper will still defer.
     */
    bypassQuietHours: shouldRequestRuntimeQuietHoursBypass(args.candidate),
  })

  if (runtimePolicy.action !== 'DEFER') {
    return false
  }

  const deferResult = await args.tx.notificationDelivery.updateMany({
    where: buildGuardedCandidateWhere({
      deliveryId: args.candidate.id,
      now: args.now,
    }),
    data: {
      nextAttemptAt: runtimePolicy.nextAttemptAt,
      claimedAt: null,
      leaseExpiresAt: null,
      leaseToken: null,
    },
  })

  if (deferResult.count !== 1) {
    return true
  }

  await args.tx.notificationDeliveryEvent.create({
    data: buildQuietHoursDeferredEvent({
      deliveryId: args.candidate.id,
      deferredAt: args.now,
      nextAttemptAt: runtimePolicy.nextAttemptAt,
      channel: args.candidate.channel,
      recipientLocalMinutes: runtimePolicy.recipientLocalMinutes,
      quietHoursStartMinutes: runtimePolicy.quietHoursStartMinutes,
      quietHoursEndMinutes: runtimePolicy.quietHoursEndMinutes,
    }),
  })

  return true
}

/**
 * Claim due delivery rows for worker processing.
 *
 * Enterprise-safe behavior:
 * - DB remains the source of truth
 * - rows are leased with claimedAt + leaseExpiresAt + leaseToken
 * - rows are claimed one-by-one inside a single transaction using guarded updates
 * - competing workers cannot both successfully claim the same row
 * - SMS/EMAIL deliveries can be deferred at runtime for quiet hours
 * - deferred rows do not starve later sendable rows in the same due queue
 *
 * Important:
 * - this function owns its own transaction boundary
 * - do not pass a TransactionClient into this function
 */
export async function claimDeliveries(
  args: ClaimDeliveriesArgs = {},
): Promise<ClaimDeliveriesResult> {
  const now = normalizeNow(args.now)
  const batchSize = normalizeBatchSize(args.batchSize)
  const leaseMs = normalizeLeaseMs(args.leaseMs)
  const claimedAt = now
  const leaseExpiresAt = buildLeaseExpiresAt(now, leaseMs)

  return prisma.$transaction(async (tx) => {
    const claimedIds: string[] = []

    while (claimedIds.length < batchSize) {
      /**
       * Always scan a full batch window instead of only the remaining claim count.
       * This prevents quiet-hours deferrals at the front of the queue from starving
       * later sendable rows once only a few claim slots remain.
       */
      const candidates = await tx.notificationDelivery.findMany({
        where: buildClaimableWhere(now),
        orderBy: DELIVERY_ORDER_BY,
        take: batchSize,
        select: runtimePolicyCandidateSelect,
      })

      if (candidates.length === 0) {
        break
      }

      for (const candidate of candidates) {
        if (claimedIds.length >= batchSize) {
          break
        }

        const wasDeferred = await maybeDeferCandidateForQuietHours({
          tx,
          candidate,
          now,
        })

        if (wasDeferred) {
          continue
        }

        const leaseToken = buildLeaseToken()

        const claimResult = await tx.notificationDelivery.updateMany({
          where: buildGuardedCandidateWhere({
            deliveryId: candidate.id,
            now,
          }),
          data: {
            claimedAt,
            leaseExpiresAt,
            leaseToken,
          },
        })

        if (claimResult.count !== 1) {
          continue
        }

        claimedIds.push(candidate.id)

        await tx.notificationDeliveryEvent.create({
          data: buildClaimEvent({
            deliveryId: candidate.id,
            claimedAt,
            leaseExpiresAt,
            leaseToken,
          }),
        })
      }
    }

    if (claimedIds.length === 0) {
      return {
        now,
        claimedAt,
        leaseExpiresAt,
        deliveries: [],
      }
    }

    const deliveries = await tx.notificationDelivery.findMany({
      where: {
        id: {
          in: claimedIds,
        },
      },
      orderBy: DELIVERY_ORDER_BY,
      select: claimDeliveriesSelect,
    })

    return {
      now,
      claimedAt,
      leaseExpiresAt,
      deliveries,
    }
  })
}