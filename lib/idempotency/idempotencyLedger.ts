import { IdempotencyStatus, Prisma, type Role } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { buildRequestHash } from '@/lib/idempotency/requestHash'
import type { IdempotencyRoute } from '@/lib/idempotency/routeMeta'

const LOCK_MINUTES = 2

export type IdempotencyActor = {
  actorUserId: string
  actorRole: Role
}

export type IdempotencyMissingKey = {
  kind: 'missing_key'
}

export type IdempotencyReplay<TBody> = {
  kind: 'replay'
  responseStatus: number
  responseBody: TBody
}

export type IdempotencyStarted = {
  kind: 'started'
  idempotencyRecordId: string
  requestHash: string
}

export type IdempotencyInProgress = {
  kind: 'in_progress'
}

export type IdempotencyConflict = {
  kind: 'conflict'
}

export type BeginIdempotencyResult<TBody> =
  | IdempotencyMissingKey
  | IdempotencyReplay<TBody>
  | IdempotencyStarted
  | IdempotencyInProgress
  | IdempotencyConflict

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

export async function beginIdempotency<TBody>(args: {
  actor: IdempotencyActor
  route: IdempotencyRoute
  key: string | null
  requestBody: unknown
}): Promise<BeginIdempotencyResult<TBody>> {
  const key = args.key?.trim()

  if (!key) {
    return { kind: 'missing_key' }
  }

  const requestHash = buildRequestHash(args.requestBody)
  const now = new Date()
  const lockedUntil = addMinutes(now, LOCK_MINUTES)

  const existing = await prisma.idempotencyKey.findUnique({
    where: {
      actorUserId_route_key: {
        actorUserId: args.actor.actorUserId,
        route: args.route,
        key,
      },
    },
    select: {
      id: true,
      requestHash: true,
      status: true,
      responseStatus: true,
      responseBodyJson: true,
      lockedUntil: true,
    },
  })

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return { kind: 'conflict' }
    }

    if (
      existing.status === IdempotencyStatus.COMPLETED &&
      existing.responseStatus !== null &&
      existing.responseBodyJson !== null
    ) {
      return {
        kind: 'replay',
        responseStatus: existing.responseStatus,
        responseBody: existing.responseBodyJson as TBody,
      }
    }

    if (
      existing.status === IdempotencyStatus.STARTED &&
      existing.lockedUntil > now
    ) {
      return { kind: 'in_progress' }
    }

    const claimed = await prisma.idempotencyKey.updateMany({
      where: {
        id: existing.id,
        requestHash,
        lockedUntil: { lte: now },
        status: { in: [IdempotencyStatus.STARTED, IdempotencyStatus.FAILED] },
      },
      data: {
        status: IdempotencyStatus.STARTED,
        lockedUntil,
      },
    })

    if (claimed.count !== 1) {
      return { kind: 'in_progress' }
    }

    return {
      kind: 'started',
      idempotencyRecordId: existing.id,
      requestHash,
    }
  }

  try {
    const created = await prisma.idempotencyKey.create({
      data: {
        actorUserId: args.actor.actorUserId,
        actorRole: args.actor.actorRole,
        route: args.route,
        key,
        requestHash,
        status: IdempotencyStatus.STARTED,
        lockedUntil,
      },
      select: {
        id: true,
      },
    })

    return {
      kind: 'started',
      idempotencyRecordId: created.id,
      requestHash,
    }
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      return beginIdempotency<TBody>(args)
    }

    throw error
  }
}

export async function completeIdempotency(args: {
  idempotencyRecordId: string
  responseStatus: number
  responseBody: Prisma.InputJsonValue
}): Promise<void> {
  await prisma.idempotencyKey.update({
    where: { id: args.idempotencyRecordId },
    data: {
      status: IdempotencyStatus.COMPLETED,
      responseStatus: args.responseStatus,
      responseBodyJson: args.responseBody,
      completedAt: new Date(),
    },
  })
}

export async function failIdempotency(args: {
  idempotencyRecordId: string
}): Promise<void> {
  await prisma.idempotencyKey.update({
    where: { id: args.idempotencyRecordId },
    data: {
      status: IdempotencyStatus.FAILED,
      lockedUntil: new Date(),
    },
  })
}
