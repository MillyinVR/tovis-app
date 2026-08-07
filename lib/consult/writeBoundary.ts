import {
  ConsultActorType,
  ConsultAgreementKind,
  ConsultAuditAction,
  ConsultRevisionKind,
  ConsultSessionStatus,
  Prisma,
} from '@prisma/client'
import { createHash } from 'node:crypto'

import { prisma } from '@/lib/prisma'

import {
  requireCurrentConsultAgreementAcceptances,
  requirePublishedConsultAgreementVersions,
} from './agreementContract'
import {
  AI_CONSULT_ELIGIBILITY_BOOKING_SELECT,
  evaluateAiConsultBookingEligibility,
} from './eligibility'
import { ConsultWriteError } from './errors'
import {
  HAIR_COLOR_INTAKE_PACK_ID,
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
  validateHairColorIntakeAnswers,
} from './intakePack'

type ClientActor = {
  readonly type: typeof ConsultActorType.CLIENT
  readonly id: string
}

type ConsultActor = {
  readonly type: ConsultActorType
  readonly id: string | null
}

type NonIntakeRevisionKind = Exclude<
  ConsultRevisionKind,
  typeof ConsultRevisionKind.INTAKE
>

export { ConsultWriteError } from './errors'

const ACTIVE_CONTENT_STATES = new Set<ConsultSessionStatus>([
  ConsultSessionStatus.INTAKE_READY,
  ConsultSessionStatus.INTAKE_IN_PROGRESS,
  ConsultSessionStatus.MEDIA_READY,
  ConsultSessionStatus.ANALYSIS_PENDING,
  ConsultSessionStatus.ANALYZING,
])

const REVOCABLE_STATES = new Set<ConsultSessionStatus>([
  ...ACTIVE_CONTENT_STATES,
  ConsultSessionStatus.COMPLETED,
])

async function lockSession(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "ConsultSession"
    WHERE "id" = ${consultSessionId}
    FOR UPDATE
  `)

  if (locked.length === 0) {
    throw new ConsultWriteError('NOT_FOUND', 'Consult session not found.')
  }
}

async function requireClientOwner(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
  actor: ClientActor,
) {
  const session = await tx.consultSession.findUnique({
    where: { id: consultSessionId },
    select: {
      status: true,
      client: { select: { userId: true } },
    },
  })

  if (!session) {
    throw new ConsultWriteError('NOT_FOUND', 'Consult session not found.')
  }
  if (session.client.userId !== actor.id) {
    throw new ConsultWriteError('NOT_OWNER', 'Consult session not found.')
  }

  return session
}

async function requireClientIntakeEligibility(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
  actor: ClientActor,
) {
  const session = await tx.consultSession.findUnique({
    where: { id: consultSessionId },
    select: {
      clientId: true,
      professionalId: true,
      serviceCategoryId: true,
      client: { select: { userId: true } },
      booking: {
        select: {
          clientId: true,
          ...AI_CONSULT_ELIGIBILITY_BOOKING_SELECT,
        },
      },
    },
  })
  if (
    !session ||
    session.client.userId !== actor.id ||
    session.booking.clientId !== session.clientId ||
    session.booking.professionalId !== session.professionalId ||
    session.booking.service.categoryId !== session.serviceCategoryId
  ) {
    throw new ConsultWriteError('NOT_FOUND', 'Consult session not found.')
  }
  const eligibility = evaluateAiConsultBookingEligibility(session.booking)
  if (!eligibility.eligible) {
    throw new ConsultWriteError(
      eligibility.hidden ? 'NOT_FOUND' : 'BOOKING_INELIGIBLE',
      'Consult is unavailable for this booking.',
    )
  }
  return session
}

async function activeAgreementKinds(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
): Promise<Set<ConsultAgreementKind>> {
  const active = await tx.consultAgreementAcceptance.findMany({
    where: { consultSessionId, revokedAt: null },
    select: { kind: true },
  })
  return new Set(active.map((acceptance) => acceptance.kind))
}

function hasBothRequiredAgreements(
  kinds: ReadonlySet<ConsultAgreementKind>,
): boolean {
  return (
    kinds.has(ConsultAgreementKind.SENSITIVE_DATA_CONSENT) &&
    kinds.has(ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION)
  )
}

async function appendLifecycleAudit(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    actor: ConsultActor
    fromStatus: ConsultSessionStatus
    toStatus: ConsultSessionStatus
  },
) {
  await tx.consultAuditEvent.create({
    data: {
      consultSessionId: args.consultSessionId,
      action: ConsultAuditAction.LIFECYCLE_TRANSITIONED,
      actorType: args.actor.type,
      actorId: args.actor.id,
      fromStatus: args.fromStatus,
      toStatus: args.toStatus,
    },
  })
}

async function transitionLockedSession(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    actor: ConsultActor
    fromStatus: ConsultSessionStatus
    toStatus: ConsultSessionStatus
  },
) {
  const updated = await tx.consultSession.updateMany({
    where: { id: args.consultSessionId, status: args.fromStatus },
    data: { status: args.toStatus },
  })
  if (updated.count !== 1) {
    throw new ConsultWriteError(
      'INVALID_STATE',
      `Consult session is no longer in ${args.fromStatus}.`,
    )
  }

  await appendLifecycleAudit(tx, args)
}

/**
 * Records one exact legal version. The 18+ attestation and sensitive-data
 * consent are separate rows and BOTH must be active before this function moves
 * the empty shell to INTAKE_READY. Agreement routes own this contract; C2's
 * intake route may proceed only after both rows are current.
 */
export async function acceptConsultAgreement(args: {
  consultSessionId: string
  agreementVersionId: string
  expectedKind: ConsultAgreementKind
  actor: ClientActor
  acceptedAt?: Date
}) {
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, args.consultSessionId)
    const session = await requireClientOwner(
      tx,
      args.consultSessionId,
      args.actor,
    )

    if (session.status === ConsultSessionStatus.CANCELLED) {
      throw new ConsultWriteError(
        'INVALID_STATE',
        'A cancelled consult cannot accept agreements.',
      )
    }

    const requiredVersions = await requirePublishedConsultAgreementVersions(tx)
    const requiredVersion = requiredVersions.get(args.expectedKind)
    if (!requiredVersion || requiredVersion.id !== args.agreementVersionId) {
      throw new ConsultWriteError(
        'AGREEMENT_VERSION_MISMATCH',
        'Agreement version does not match the current required version.',
      )
    }

    const activeAcceptance =
      await tx.consultAgreementAcceptance.findFirst({
        where: {
          consultSessionId: args.consultSessionId,
          kind: args.expectedKind,
          revokedAt: null,
        },
      })
    if (activeAcceptance) {
      if (activeAcceptance.agreementVersionId !== args.agreementVersionId) {
        throw new ConsultWriteError(
          'INVALID_STATE',
          'A different agreement version is already active.',
        )
      }
      return {
        acceptance: activeAcceptance,
        status: session.status,
        replayed: true,
      }
    }

    let currentStatus = session.status
    if (currentStatus === ConsultSessionStatus.CONSENT_REVOKED) {
      await transitionLockedSession(tx, {
        consultSessionId: args.consultSessionId,
        actor: args.actor,
        fromStatus: currentStatus,
        toStatus: ConsultSessionStatus.CONSENT_REQUIRED,
      })
      currentStatus = ConsultSessionStatus.CONSENT_REQUIRED
    }

    if (currentStatus !== ConsultSessionStatus.CONSENT_REQUIRED) {
      throw new ConsultWriteError(
        'INVALID_STATE',
        'Agreements may only be accepted while consent is required.',
      )
    }

    const acceptance = await tx.consultAgreementAcceptance.create({
      data: {
        consultSessionId: args.consultSessionId,
        agreementVersionId: args.agreementVersionId,
        kind: args.expectedKind,
        acceptedByType: args.actor.type,
        acceptedById: args.actor.id,
        ...(args.acceptedAt ? { acceptedAt: args.acceptedAt } : {}),
      },
    })

    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: args.consultSessionId,
        action: ConsultAuditAction.AGREEMENT_ACCEPTED,
        actorType: args.actor.type,
        actorId: args.actor.id,
        agreementAcceptanceId: acceptance.id,
      },
    })

    const activeKinds = await activeAgreementKinds(tx, args.consultSessionId)
    let status: ConsultSessionStatus = currentStatus
    if (hasBothRequiredAgreements(activeKinds)) {
      status = ConsultSessionStatus.INTAKE_READY
      await transitionLockedSession(tx, {
        consultSessionId: args.consultSessionId,
        actor: args.actor,
        fromStatus: currentStatus,
        toStatus: status,
      })
    }

    return { acceptance, status, replayed: false }
  })
}

/** One-way revocation: evidence stays, new sensitive writes stop immediately. */
export async function revokeConsultAgreement(args: {
  consultSessionId: string
  acceptanceId: string
  reason: string
  actor: ClientActor
  revokedAt?: Date
}) {
  const reason = args.reason.trim()
  if (!reason || reason.length > 500) {
    throw new ConsultWriteError(
      'INVALID_REQUEST',
      'A revocation reason between 1 and 500 characters is required.',
    )
  }

  return prisma.$transaction(async (tx) => {
    await lockSession(tx, args.consultSessionId)
    const session = await requireClientOwner(
      tx,
      args.consultSessionId,
      args.actor,
    )
    const acceptance = await tx.consultAgreementAcceptance.findFirst({
      where: {
        id: args.acceptanceId,
        consultSessionId: args.consultSessionId,
      },
    })
    if (!acceptance) {
      throw new ConsultWriteError('NOT_FOUND', 'Agreement acceptance not found.')
    }
    if (acceptance.revokedAt) {
      throw new ConsultWriteError(
        'ALREADY_REVOKED',
        'Agreement acceptance was already revoked.',
      )
    }

    const revokedAt = args.revokedAt ?? new Date()
    const revoked = await tx.consultAgreementAcceptance.update({
      where: { id: acceptance.id },
      data: {
        revokedAt,
        revokedByType: args.actor.type,
        revokedById: args.actor.id,
        revocationReason: reason,
      },
    })

    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: args.consultSessionId,
        action: ConsultAuditAction.AGREEMENT_REVOKED,
        actorType: args.actor.type,
        actorId: args.actor.id,
        agreementAcceptanceId: acceptance.id,
      },
    })

    let status = session.status
    if (REVOCABLE_STATES.has(session.status)) {
      status = ConsultSessionStatus.CONSENT_REVOKED
      await transitionLockedSession(tx, {
        consultSessionId: args.consultSessionId,
        actor: args.actor,
        fromStatus: session.status,
        toStatus: status,
      })
    }

    return { acceptance: revoked, status }
  })
}

/**
 * Canonical lifecycle mutation boundary. PostgreSQL independently enforces the
 * transition graph and legal prerequisites; this wrapper makes the matching
 * audit event atomic with the state change.
 */
export async function transitionConsultSession(args: {
  consultSessionId: string
  fromStatus: ConsultSessionStatus
  toStatus: ConsultSessionStatus
  actor: ConsultActor
}) {
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, args.consultSessionId)
    await transitionLockedSession(tx, args)
    return tx.consultSession.findUniqueOrThrow({
      where: { id: args.consultSessionId },
    })
  })
}

/**
 * Low-level immutable revision boundary retained for later analysis/brief
 * writers. Client intake uses appendHairColorIntakeRevision below for strict
 * payload validation, idempotency, ownership, and lifecycle effects. Both
 * boundaries and the database fail closed on stale/missing prerequisites.
 */
export async function appendConsultRevision(args: {
  consultSessionId: string
  kind: NonIntakeRevisionKind
  payload: Prisma.InputJsonValue
  schemaVersion: number
  model?: string
  promptVersion?: string
  actor: ConsultActor
}) {
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, args.consultSessionId)
    const session = await tx.consultSession.findUnique({
      where: { id: args.consultSessionId },
      select: { status: true },
    })
    if (!session) {
      throw new ConsultWriteError('NOT_FOUND', 'Consult session not found.')
    }
    if (!ACTIVE_CONTENT_STATES.has(session.status)) {
      throw new ConsultWriteError(
        'INVALID_STATE',
        'Consult lifecycle does not permit a sensitive revision.',
      )
    }

    await requireCurrentConsultAgreementAcceptances(tx, args.consultSessionId)

    const sequenced = await tx.consultSession.update({
      where: { id: args.consultSessionId },
      data: { revisionSequence: { increment: 1 } },
      select: { revisionSequence: true },
    })
    const revision = await tx.consultRevision.create({
      data: {
        consultSessionId: args.consultSessionId,
        revision: sequenced.revisionSequence,
        kind: args.kind,
        payload: args.payload,
        schemaVersion: args.schemaVersion,
        ...(args.model ? { model: args.model } : {}),
        ...(args.promptVersion ? { promptVersion: args.promptVersion } : {}),
      },
    })

    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: args.consultSessionId,
        action: ConsultAuditAction.REVISION_CREATED,
        actorType: args.actor.type,
        actorId: args.actor.id,
        revisionId: revision.id,
      },
    })

    return revision
  })
}

function intakeRequestHash(args: {
  packVersion: number
  schemaVersion: number
  complete: boolean
  answers: Readonly<Record<string, string>>
}): string {
  const orderedAnswers = Object.entries(args.answers).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  return createHash('sha256')
    .update(
      JSON.stringify({
        packId: HAIR_COLOR_INTAKE_PACK_ID,
        packVersion: args.packVersion,
        schemaVersion: args.schemaVersion,
        complete: args.complete,
        answers: orderedAnswers,
      }),
    )
    .digest('hex')
}

/**
 * Canonical C2 intake write. Validation, legal-version checks, idempotency,
 * immutable revision/audit creation, and lifecycle changes share one locked
 * transaction so a retry cannot duplicate any effect.
 */
export async function appendHairColorIntakeRevision(args: {
  consultSessionId: string
  actor: ClientActor
  loadInput: () => Promise<{
    packVersion: number
    schemaVersion: number
    complete: boolean
    answers: unknown
    idempotencyKey: string
  }>
}) {
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, args.consultSessionId)
    await requireClientIntakeEligibility(
      tx,
      args.consultSessionId,
      args.actor,
    )
    const session = await tx.consultSession.findUniqueOrThrow({
      where: { id: args.consultSessionId },
      select: { status: true },
    })
    await requireCurrentConsultAgreementAcceptances(tx, args.consultSessionId)

    if (
      session.status !== ConsultSessionStatus.INTAKE_READY &&
      session.status !== ConsultSessionStatus.INTAKE_IN_PROGRESS &&
      session.status !== ConsultSessionStatus.MEDIA_READY
    ) {
      throw new ConsultWriteError(
        'INVALID_STATE',
        'Consult lifecycle does not permit intake revisions.',
      )
    }

    // The caller must not parse/read answer data until this locked transaction
    // has proven ownership, eligibility, lifecycle, and both current legal
    // prerequisites. Revocation uses the same row lock, so the two operations
    // have one deterministic order.
    const input = await args.loadInput()
    if (input.packVersion !== HAIR_COLOR_INTAKE_PACK_VERSION) {
      throw new ConsultWriteError(
        'PACK_VERSION_MISMATCH',
        'The intake pack version is stale.',
      )
    }
    if (input.schemaVersion !== HAIR_COLOR_INTAKE_SCHEMA_VERSION) {
      throw new ConsultWriteError(
        'SCHEMA_VERSION_MISMATCH',
        'The intake schema version is stale.',
      )
    }
    const idempotencyKey = input.idempotencyKey.trim()
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw new ConsultWriteError(
        'INVALID_REQUEST',
        'A valid idempotency key is required.',
      )
    }
    const validated = validateHairColorIntakeAnswers(
      input.answers,
      input.complete,
    )
    if (!validated.ok) {
      throw new ConsultWriteError('INVALID_ANSWERS', validated.message)
    }
    const requestHash = intakeRequestHash({
      packVersion: input.packVersion,
      schemaVersion: input.schemaVersion,
      complete: input.complete,
      answers: validated.answers,
    })

    const existing = await tx.consultRevision.findFirst({
      where: { consultSessionId: args.consultSessionId, idempotencyKey },
    })
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConsultWriteError(
          'IDEMPOTENCY_CONFLICT',
          'The idempotency key was already used for another request.',
        )
      }
      return { revision: existing, status: session.status, replayed: true }
    }

    if (session.status === ConsultSessionStatus.MEDIA_READY && !input.complete) {
      throw new ConsultWriteError(
        'INVALID_STATE',
        'A completed intake correction must remain complete.',
      )
    }

    let status = session.status
    if (status === ConsultSessionStatus.INTAKE_READY) {
      await transitionLockedSession(tx, {
        consultSessionId: args.consultSessionId,
        actor: args.actor,
        fromStatus: status,
        toStatus: ConsultSessionStatus.INTAKE_IN_PROGRESS,
      })
      status = ConsultSessionStatus.INTAKE_IN_PROGRESS
    }

    const sequenced = await tx.consultSession.update({
      where: { id: args.consultSessionId },
      data: { revisionSequence: { increment: 1 } },
      select: { revisionSequence: true },
    })
    const revision = await tx.consultRevision.create({
      data: {
        consultSessionId: args.consultSessionId,
        revision: sequenced.revisionSequence,
        kind: ConsultRevisionKind.INTAKE,
        payload: {
          packId: HAIR_COLOR_INTAKE_PACK_ID,
          packVersion: input.packVersion,
          schemaVersion: input.schemaVersion,
          complete: input.complete,
          answers: validated.answers,
        },
        schemaVersion: input.schemaVersion,
        idempotencyKey,
        requestHash,
      },
    })
    await tx.consultAuditEvent.create({
      data: {
        consultSessionId: args.consultSessionId,
        action: ConsultAuditAction.REVISION_CREATED,
        actorType: args.actor.type,
        actorId: args.actor.id,
        revisionId: revision.id,
      },
    })

    if (input.complete && status === ConsultSessionStatus.INTAKE_IN_PROGRESS) {
      await transitionLockedSession(tx, {
        consultSessionId: args.consultSessionId,
        actor: args.actor,
        fromStatus: status,
        toStatus: ConsultSessionStatus.MEDIA_READY,
      })
      status = ConsultSessionStatus.MEDIA_READY
    }

    return { revision, status, replayed: false }
  })
}
