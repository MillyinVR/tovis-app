import {
  ConsultActorType,
  ConsultAgreementKind,
  ConsultAuditAction,
  ConsultRevisionKind,
  ConsultSessionStatus,
  Prisma,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'

import { requirePublishedConsultAgreementVersions } from './agreementContract'
import { ConsultWriteError } from './errors'

type ClientActor = {
  readonly type: typeof ConsultActorType.CLIENT
  readonly id: string
}

type ConsultActor = {
  readonly type: ConsultActorType
  readonly id: string | null
}

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
 * the empty shell to INTAKE_READY. There is intentionally no route/UI yet.
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
 * Appends a sensitive immutable revision. This is foundation only: callers for
 * intake/analysis/brief do not exist yet. Both the boundary and a DB trigger
 * fail closed if consent or the 18+ attestation is missing/revoked.
 */
export async function appendConsultRevision(args: {
  consultSessionId: string
  kind: ConsultRevisionKind
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

    const activeKinds = await activeAgreementKinds(tx, args.consultSessionId)
    if (!hasBothRequiredAgreements(activeKinds)) {
      throw new ConsultWriteError(
        'AGREEMENTS_REQUIRED',
        'Active consent and 18+ attestation are required.',
      )
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
