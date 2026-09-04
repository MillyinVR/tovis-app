import {
  ConsultActorType,
  ConsultAgreementKind,
  ConsultAuditAction,
  ConsultCaptureStatus,
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
  CONSULT_ANALYSIS_PROMPT_VERSION,
  CONSULT_ANALYSIS_SCHEMA_VERSION,
} from './analysisEngine'
import { normalizeStoredConsultAnalysisPayload } from './analysisRevision'
import {
  buildHairColorProBriefPayload,
  CONSULT_PRO_BRIEF_PROMPT_VERSION,
  CONSULT_PRO_BRIEF_SCHEMA_VERSION,
  toBriefJsonPayload,
} from './briefContract'
import { CONSULT_ANCHOR_SELECT, evaluateConsultAnchor } from './anchor'
import { CONSULT_MAX_CAPTURE_SHOTS } from './capture/registry'
import { ConsultWriteError } from './errors'
import {
  normalizeConsultIntakePayload,
  validateConsultIntakeAnswers,
} from './intake/registry'
import type { ConsultIntakePackDefinition } from './intake/types'
import {
  CONSULT_INSPIRATION_REFERENCE_NOTE,
  normalizeStoredInspirationPayload,
} from './inspirationPack'
import {
  CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION,
  CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
} from './inspirationVision'
import { seedLockedConsultAnchorInspiration } from './inspirationSeed'
import {
  CONSULT_SERVICE_ESTIMATE_DERIVATION_VERSION,
  CONSULT_SERVICE_ESTIMATE_SCHEMA_VERSION,
  buildConsultServiceEstimate,
  type ConsultServiceEstimateAnalysisInput,
} from './serviceEstimate'
import {
  CONSULT_SERVICE_PROFILE_CATEGORY_SELECT,
  resolveConsultServiceProfile,
} from './serviceProfile'

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
      client: { select: { userId: true } },
      ...CONSULT_ANCHOR_SELECT,
      serviceCategory: { select: CONSULT_SERVICE_PROFILE_CATEGORY_SELECT },
    },
  })
  if (!session || session.client.userId !== actor.id) {
    throw new ConsultWriteError('NOT_FOUND', 'Consult session not found.')
  }
  const anchor = evaluateConsultAnchor(session)
  if (!anchor.eligible) {
    throw new ConsultWriteError(
      anchor.hidden ? 'NOT_FOUND' : 'BOOKING_INELIGIBLE',
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

export async function transitionLockedConsultSession(
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
      await transitionLockedConsultSession(tx, {
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
      await transitionLockedConsultSession(tx, {
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
      await transitionLockedConsultSession(tx, {
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
    await transitionLockedConsultSession(tx, args)
    return tx.consultSession.findUniqueOrThrow({
      where: { id: args.consultSessionId },
    })
  })
}

/**
 * Low-level immutable revision boundary retained for later analysis/brief
 * writers. Client intake uses appendConsultIntakeRevision below for strict
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
  if (
    args.kind === ConsultRevisionKind.INSPIRATION ||
    args.kind === ConsultRevisionKind.ANALYSIS ||
    args.kind === ConsultRevisionKind.BRIEF
  ) {
    throw new ConsultWriteError(
      'INVALID_STATE',
      'Inspiration, analysis, and brief revisions must use their canonical generation boundaries.',
    )
  }
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

/**
 * Canonical locked writer for immutable guided-inspiration revisions. Callers
 * own the ConsultSession row lock; this boundary owns sequence, revision,
 * idempotency, and content-free audit writes as one transaction unit.
 */
export async function appendLockedConsultInspirationRevision(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    payload: Prisma.InputJsonValue
    schemaVersion: number
    idempotencyKey: string
    requestHash: string
    actor: ClientActor
  },
) {
  const existing = await tx.consultRevision.findFirst({
    where: {
      consultSessionId: args.consultSessionId,
      idempotencyKey: args.idempotencyKey,
    },
  })
  if (existing) {
    if (
      existing.kind !== ConsultRevisionKind.INSPIRATION ||
      existing.requestHash !== args.requestHash
    ) {
      throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'Idempotency conflict.')
    }
    return { revision: existing, replayed: true }
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
      kind: ConsultRevisionKind.INSPIRATION,
      payload: args.payload,
      schemaVersion: args.schemaVersion,
      idempotencyKey: args.idempotencyKey,
      requestHash: args.requestHash,
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
  return { revision, replayed: false }
}

/**
 * P4: the inspiration-analysis artefact. Same locked-append shape as the
 * inspiration revision above — sequence, row, audit event — because the
 * database requires all three for every consult revision kind
 * (`ConsultRevision_inspiration_analysis_requires_audit`, added with the kind).
 *
 * Written in ANALYZING, which is what
 * `consult_revision_requires_agreements` pins the kind to, and pinned in its
 * payload to the current INSPIRATION revision, which the payload guard
 * re-checks against the table. A stale pin cannot reach the row.
 */
export async function appendLockedConsultInspirationAnalysisRevision(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    payload: Prisma.InputJsonValue
    model: string
    idempotencyKey: string
    requestHash: string
    actor: ClientActor
  },
) {
  const sequenced = await tx.consultSession.update({
    where: { id: args.consultSessionId },
    data: { revisionSequence: { increment: 1 } },
    select: { revisionSequence: true },
  })
  const revision = await tx.consultRevision.create({
    data: {
      consultSessionId: args.consultSessionId,
      revision: sequenced.revisionSequence,
      kind: ConsultRevisionKind.INSPIRATION_ANALYSIS,
      payload: args.payload,
      schemaVersion: CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
      promptVersion: CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION,
      model: args.model,
      idempotencyKey: args.idempotencyKey,
      requestHash: args.requestHash,
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
}

/**
 * C4's atomic terminal boundary. The caller owns the already-locked
 * transaction and post-provider prerequisite re-check; this function keeps
 * sequence/revision/audit/purge-marker/completion writes indivisible and in
 * the only source file authorized to mutate sensitive consult lifecycle data.
 */
export async function finalizeLockedHairColorAnalysis(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    payload: Prisma.InputJsonValue
    model: string
    idempotencyKey: string
    requestHash: string
    captureIds: readonly string[]
    finalizedAt: Date
    actor: ConsultActor
  },
) {
  // Partial packs (Tori, 2026-08-27): between one and the full pack of
  // captures, all distinct. Every capture the analysis consumed must be
  // purge-marked below — the count equality keeps that exact.
  if (
    args.captureIds.length < 1 ||
    args.captureIds.length > CONSULT_MAX_CAPTURE_SHOTS ||
    new Set(args.captureIds).size !== args.captureIds.length
  ) {
    throw new ConsultWriteError(
      'ANALYSIS_PREREQUISITES_REQUIRED',
      'Analysis captures changed.',
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
      kind: ConsultRevisionKind.ANALYSIS,
      payload: args.payload,
      schemaVersion: CONSULT_ANALYSIS_SCHEMA_VERSION,
      promptVersion: CONSULT_ANALYSIS_PROMPT_VERSION,
      model: args.model,
      idempotencyKey: args.idempotencyKey,
      requestHash: args.requestHash,
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
  const marked = await tx.consultCapture.updateMany({
    where: {
      id: { in: [...args.captureIds] },
      consultSessionId: args.consultSessionId,
      status: ConsultCaptureStatus.ACCEPTED,
      purgedAt: null,
      purgeRequestedAt: null,
      rawExpiresAt: { gt: args.finalizedAt },
    },
    data: {
      purgeEligibleAt: args.finalizedAt,
      purgeRequestedAt: args.finalizedAt,
    },
  })
  if (marked.count !== args.captureIds.length) {
    throw new ConsultWriteError(
      'ANALYSIS_PREREQUISITES_REQUIRED',
      'Analysis captures changed.',
    )
  }
  await transitionLockedConsultSession(tx, {
    consultSessionId: args.consultSessionId,
    actor: args.actor,
    fromStatus: ConsultSessionStatus.ANALYZING,
    toStatus: ConsultSessionStatus.COMPLETED,
  })

  const intakeRevision = await tx.consultRevision.findFirst({
    where: {
      consultSessionId: args.consultSessionId,
      kind: ConsultRevisionKind.INTAKE,
    },
    select: { id: true, payload: true },
    orderBy: { revision: 'desc' },
  })
  const intake = intakeRevision
    ? normalizeConsultIntakePayload(intakeRevision.payload)
    : null
  if (!intakeRevision || !intake || !intake.complete) {
    throw new ConsultWriteError(
      'ANALYSIS_PREREQUISITES_REQUIRED',
      'Analysis intake changed.',
    )
  }

  const inspirationRevision = await tx.consultRevision.findFirst({
    where: {
      consultSessionId: args.consultSessionId,
      kind: ConsultRevisionKind.INSPIRATION,
    },
    select: { id: true, payload: true },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
  })
  const inspiration = inspirationRevision
    ? normalizeStoredInspirationPayload(inspirationRevision.payload)
    : null
  if (!inspirationRevision || !inspiration?.complete) {
    throw new ConsultWriteError(
      'ANALYSIS_PREREQUISITES_REQUIRED',
      'Guided inspiration is incomplete.',
    )
  }
  const inspirationSource = inspiration.inspirationId
    ? await tx.consultInspiration.findFirst({
        where: {
          id: inspiration.inspirationId,
          consultSessionId: args.consultSessionId,
          status: 'ATTACHED',
        },
        select: { sourceLookPostId: true },
      })
    : null
  if (inspiration.inspirationId && !inspirationSource) {
    throw new ConsultWriteError(
      'ANALYSIS_PREREQUISITES_REQUIRED',
      'Guided inspiration source changed.',
    )
  }

  // Normalized once: the brief and B3's service estimate must read the SAME
  // recommendation references, or the estimate could price a service the brief
  // never showed.
  const briefAnalysis = normalizeStoredConsultAnalysisPayload(
    revision.payload,
    revision.schemaVersion,
  )
  const briefPayload = buildHairColorProBriefPayload({
    intakeRevisionId: intakeRevision.id,
    intakePackId: intake.packId,
    intakeAnswers: intake.answers,
    analysisRevisionId: revision.id,
    analysisRevision: revision.revision,
    analysis: briefAnalysis,
    inspiration: {
      revisionId: inspirationRevision.id,
      source: inspiration.source,
      inspirationId: inspiration.inspirationId,
      lookPostId: inspirationSource?.sourceLookPostId ?? null,
      mediaEndpoint:
        inspiration.source === 'EXTERNAL_UPLOAD'
          ? `/api/v1/pro/consults/${encodeURIComponent(args.consultSessionId)}/inspiration/media`
          : null,
      referenceNote: CONSULT_INSPIRATION_REFERENCE_NOTE,
      exactClientDetails: inspiration.exactClientDetails,
      possibleProfessionalInterpretation:
        inspiration.possibleProfessionalInterpretation,
      catalogGuidance: inspiration.catalogGuidance,
    },
  })
  const briefSequence = await tx.consultSession.update({
    where: { id: args.consultSessionId },
    data: { revisionSequence: { increment: 1 } },
    select: { revisionSequence: true },
  })
  const briefRevision = await tx.consultRevision.create({
    data: {
      consultSessionId: args.consultSessionId,
      revision: briefSequence.revisionSequence,
      kind: ConsultRevisionKind.BRIEF,
      payload: toBriefJsonPayload(briefPayload),
      schemaVersion: CONSULT_PRO_BRIEF_SCHEMA_VERSION,
      promptVersion: CONSULT_PRO_BRIEF_PROMPT_VERSION,
    },
  })
  await tx.consultAuditEvent.create({
    data: {
      consultSessionId: args.consultSessionId,
      action: ConsultAuditAction.REVISION_CREATED,
      actorType: ConsultActorType.SYSTEM,
      actorId: null,
      revisionId: briefRevision.id,
    },
  })

  await writeLookServiceEstimate(tx, {
    consultSessionId: args.consultSessionId,
    analysisRevisionId: revision.id,
    analysis: briefAnalysis,
  })

  return revision
}

/**
 * Book the Look, B3: the line-item service estimate for a LOOK-anchored
 * consult (docs/product/BOOK-THE-LOOK-DIRECTION.md, decisions 6, 7 and 11).
 *
 * Written here, inside the same locked transaction that finalized the analysis
 * and the brief, so a completed look-anchored consult always has exactly one
 * estimate — priced lines or a typed refusal — and never a window in which the
 * pro's brief exists with no estimate beside it.
 *
 * A BOOKING-anchored consult gets none: its booking already carries real
 * BookingServiceItem prices, so there is nothing to translate, and the shipped
 * booking-attached flow (#1016 / iOS #375) keeps its exact behaviour.
 */
async function writeLookServiceEstimate(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    analysisRevisionId: string
    analysis: ConsultServiceEstimateAnalysisInput
  },
) {
  const session = await tx.consultSession.findUnique({
    where: { id: args.consultSessionId },
    select: {
      anchorLookPostId: true,
      professionalId: true,
      serviceCategoryId: true,
    },
  })
  if (!session?.anchorLookPostId) return

  const draft = await buildConsultServiceEstimate(tx, {
    professionalId: session.professionalId,
    serviceCategoryId: session.serviceCategoryId,
    anchorLookPostId: session.anchorLookPostId,
    analysis: args.analysis,
  })

  await tx.consultServiceEstimate.create({
    data: {
      consultSessionId: args.consultSessionId,
      professionalId: session.professionalId,
      sourceAnalysisRevisionId: args.analysisRevisionId,
      status: draft.status,
      refusalCode: draft.refusalCode,
      locationType: draft.locationType,
      stepMinutes: draft.stepMinutes,
      bufferMinutes: draft.bufferMinutes,
      schemaVersion: CONSULT_SERVICE_ESTIMATE_SCHEMA_VERSION,
      derivationVersion: CONSULT_SERVICE_ESTIMATE_DERIVATION_VERSION,
      lines: {
        create: draft.lines.map((line) => ({
          sortOrder: line.sortOrder,
          serviceId: line.serviceId,
          offeringId: line.offeringId,
          serviceName: line.serviceName,
          source: line.source,
          rationale: line.rationale,
          estimatedPrice: line.estimatedPrice,
          estimatedDurationMinutes: line.estimatedDurationMinutes,
        })),
      },
    },
    select: { id: true },
  })
}

function intakeRequestHash(args: {
  packId: string
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
        packId: args.packId,
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
 *
 * The pack is the one the session's service profile serves (colour, hair, or
 * general); the client echoes its versions and the answers are validated
 * against that pack's own questions.
 */
export async function appendConsultIntakeRevision(args: {
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
    const scope = await requireClientIntakeEligibility(
      tx,
      args.consultSessionId,
      args.actor,
    )
    const pack: ConsultIntakePackDefinition = resolveConsultServiceProfile(
      scope.serviceCategory,
    ).intakePack
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
    if (input.packVersion !== pack.version) {
      throw new ConsultWriteError(
        'PACK_VERSION_MISMATCH',
        'The intake pack version is stale.',
      )
    }
    if (input.schemaVersion !== pack.schemaVersion) {
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
    const validated = validateConsultIntakeAnswers(
      pack,
      input.answers,
      input.complete,
    )
    if (!validated.ok) {
      const code =
        validated.code === 'GOAL_DIRECTION_REQUIRED' ||
        validated.code === 'GOAL_DIRECTION_UNRESOLVED'
          ? validated.code
          : 'INVALID_ANSWERS'
      throw new ConsultWriteError(code, validated.message)
    }
    const requestHash = intakeRequestHash({
      packId: pack.id,
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
      await transitionLockedConsultSession(tx, {
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
          packId: pack.id,
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
      await transitionLockedConsultSession(tx, {
        consultSessionId: args.consultSessionId,
        actor: args.actor,
        fromStatus: status,
        toStatus: ConsultSessionStatus.MEDIA_READY,
      })
      status = ConsultSessionStatus.MEDIA_READY

      // Book the Look: the client tapped a picture to get here, so she is not
      // asked for one again. Seeded at exactly this transition because the
      // database refuses an inspiration row before MEDIA_READY with both legal
      // prerequisites active — see lib/consult/inspirationSeed.ts. A
      // booking-anchored consult has no look anchor and no-ops here.
      await seedLockedConsultAnchorInspiration(tx, {
        consultSessionId: args.consultSessionId,
        clientId: scope.clientId,
        professionalId: scope.professionalId,
        anchorLookPostId: scope.anchorLookPostId,
        actor: args.actor,
      })
    }

    return { revision, status, replayed: false }
  })
}
