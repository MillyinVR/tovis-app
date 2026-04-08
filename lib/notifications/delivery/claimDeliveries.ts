import crypto from 'node:crypto'

import { prisma } from '@/lib/prisma'
import {
  NotificationDeliveryStatus,
  NotificationDeliveryEventType,
  Prisma,
} from '@prisma/client'

const DEFAULT_BATCH_SIZE = 25
const MAX_BATCH_SIZE = 100
const DEFAULT_LEASE_MS = 60_000
const LEASE_TOKEN_BYTES = 16

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

export type ClaimedNotificationDelivery = Prisma.NotificationDeliveryGetPayload<{
  select: typeof claimDeliveriesSelect
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

function buildClaimableWhere(now: Date): Prisma.NotificationDeliveryWhereInput {
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
      {
        claimedAt: null,
      },
      {
        leaseExpiresAt: null,
      },
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

/**
 * Claim due delivery rows for worker processing.
 *
 * Enterprise-safe behavior:
 * - DB remains the source of truth
 * - rows are leased with claimedAt + leaseExpiresAt + leaseToken
 * - rows are claimed one-by-one inside a single transaction using guarded updates
 * - competing workers cannot both successfully claim the same row
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
    const candidates = await tx.notificationDelivery.findMany({
      where: buildClaimableWhere(now),
      orderBy: [
        { nextAttemptAt: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: batchSize,
      select: {
        id: true,
      },
    })

    if (candidates.length === 0) {
      return {
        now,
        claimedAt,
        leaseExpiresAt,
        deliveries: [],
      }
    }

    const claimedIds: string[] = []

    for (const candidate of candidates) {
      const leaseToken = buildLeaseToken()

      const claimResult = await tx.notificationDelivery.updateMany({
        where: {
          id: candidate.id,
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
            {
              claimedAt: null,
            },
            {
              leaseExpiresAt: null,
            },
            {
              leaseExpiresAt: {
                lte: now,
              },
            },
          ],
          dispatch: {
            cancelledAt: null,
          },
        },
        data: {
          claimedAt,
          leaseExpiresAt,
          leaseToken,
        },
      })

      if (claimResult.count === 1) {
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
      orderBy: [
        { nextAttemptAt: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
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