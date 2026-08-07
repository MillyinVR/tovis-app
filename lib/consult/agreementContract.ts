import {
  ConsultAgreementKind,
  type ConsultAgreementVersion,
  Prisma,
} from '@prisma/client'

import { AI_CONSULT_PILOT_CATEGORY_SLUGS } from '@/lib/consult/eligibility'
import type {
  ConsultAgreementAcceptanceDTO,
  ConsultAgreementRequirementDTO,
  ConsultAgreementRevocationDTO,
  ConsultAgreementStateDTO,
  ConsultAgreementVersionDTO,
} from '@/lib/dto/consult'
import { prisma } from '@/lib/prisma'

import { isAiConsultEnabledForPro } from './access'
import { ConsultWriteError } from './errors'

export const CONSULT_REQUIRED_AGREEMENT_KINDS = Object.freeze([
  ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
  ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
])

type RequiredAgreementVersions = ReadonlyMap<
  ConsultAgreementKind,
  ConsultAgreementVersion
>

/**
 * Resolves the highest numbered version published as of `now` for each legal
 * prerequisite. No wording is seeded here: callers fail closed unless both
 * independently published rows already exist.
 */
export async function requirePublishedConsultAgreementVersions(
  tx: Prisma.TransactionClient,
  now = new Date(),
): Promise<RequiredAgreementVersions> {
  const versions = await tx.consultAgreementVersion.findMany({
    where: {
      kind: { in: [...CONSULT_REQUIRED_AGREEMENT_KINDS] },
      publishedAt: { lte: now },
    },
    orderBy: [{ kind: 'asc' }, { version: 'desc' }],
  })

  const required = new Map<ConsultAgreementKind, ConsultAgreementVersion>()
  for (const version of versions) {
    if (!required.has(version.kind)) required.set(version.kind, version)
  }

  if (required.size !== CONSULT_REQUIRED_AGREEMENT_KINDS.length) {
    throw new ConsultWriteError(
      'AGREEMENTS_UNAVAILABLE',
      'Required consult agreement versions are unavailable.',
    )
  }

  return required
}

type OwnedPilotConsult = {
  id: string
}

/**
 * Uniform owner/pilot gate for every agreement route. The booking remains the
 * authority: ownership, professional anchor, and exact hair-color category
 * must still agree with the immutable consult shell.
 */
export async function findOwnedPilotConsult(args: {
  consultSessionId: string
  clientId: string
}): Promise<OwnedPilotConsult | null> {
  const session = await prisma.consultSession.findUnique({
    where: { id: args.consultSessionId },
    select: {
      id: true,
      clientId: true,
      professionalId: true,
      serviceCategoryId: true,
      booking: {
        select: {
          clientId: true,
          professionalId: true,
          service: {
            select: {
              categoryId: true,
              category: { select: { slug: true } },
            },
          },
        },
      },
    },
  })

  if (
    !session ||
    session.clientId !== args.clientId ||
    session.booking.clientId !== args.clientId ||
    session.booking.professionalId !== session.professionalId ||
    session.booking.service.categoryId !== session.serviceCategoryId ||
    !session.booking.service.category.slug ||
    !AI_CONSULT_PILOT_CATEGORY_SLUGS.includes(
      session.booking.service.category.slug,
    ) ||
    !isAiConsultEnabledForPro(session.professionalId)
  ) {
    return null
  }

  return { id: session.id }
}

function toVersionDTO(
  version: ConsultAgreementVersion,
): ConsultAgreementVersionDTO {
  return {
    id: version.id,
    kind: version.kind,
    version: version.version,
    title: version.title,
    body: version.body,
    publishedAt: version.publishedAt.toISOString(),
  }
}

const ACCEPTANCE_WITH_VERSION_SELECT = {
  id: true,
  agreementVersionId: true,
  acceptedAt: true,
  revokedAt: true,
  revocationReason: true,
  agreementVersion: { select: { version: true } },
} satisfies Prisma.ConsultAgreementAcceptanceSelect

type AcceptanceWithVersion =
  Prisma.ConsultAgreementAcceptanceGetPayload<{
    select: typeof ACCEPTANCE_WITH_VERSION_SELECT
  }>

function toAcceptanceDTO(
  acceptance: AcceptanceWithVersion,
): ConsultAgreementAcceptanceDTO {
  return {
    id: acceptance.id,
    agreementVersionId: acceptance.agreementVersionId,
    version: acceptance.agreementVersion.version,
    acceptedAt: acceptance.acceptedAt.toISOString(),
  }
}

function toRevocationDTO(
  acceptance: AcceptanceWithVersion,
): ConsultAgreementRevocationDTO | null {
  if (!acceptance.revokedAt || !acceptance.revocationReason) return null
  return {
    acceptanceId: acceptance.id,
    agreementVersionId: acceptance.agreementVersionId,
    version: acceptance.agreementVersion.version,
    acceptedAt: acceptance.acceptedAt.toISOString(),
    revokedAt: acceptance.revokedAt.toISOString(),
    reason: acceptance.revocationReason,
  }
}

/** Loads the exact client-facing gate state without intake or media content. */
export async function loadConsultAgreementState(
  consultSessionId: string,
): Promise<ConsultAgreementStateDTO> {
  return prisma.$transaction(
    async (tx) => {
      const session = await tx.consultSession.findUnique({
        where: { id: consultSessionId },
        select: { id: true, status: true },
      })
      if (!session) {
        throw new ConsultWriteError('NOT_FOUND', 'Consult session not found.')
      }

      const required = await requirePublishedConsultAgreementVersions(tx)
      const evidence = new Map<
        ConsultAgreementKind,
        {
          current: AcceptanceWithVersion | null
          latestRevoked: AcceptanceWithVersion | null
        }
      >()
      for (const kind of CONSULT_REQUIRED_AGREEMENT_KINDS) {
        const [current, latestRevoked] = await Promise.all([
          tx.consultAgreementAcceptance.findFirst({
            where: { consultSessionId, kind, revokedAt: null },
            select: ACCEPTANCE_WITH_VERSION_SELECT,
          }),
          tx.consultAgreementAcceptance.findFirst({
            where: { consultSessionId, kind, revokedAt: { not: null } },
            select: ACCEPTANCE_WITH_VERSION_SELECT,
            orderBy: [{ revokedAt: 'desc' }, { id: 'desc' }],
          }),
        ])
        evidence.set(kind, { current, latestRevoked })
      }

      const requirements: ConsultAgreementRequirementDTO[] =
        CONSULT_REQUIRED_AGREEMENT_KINDS.map((kind) => {
          const requiredVersion = required.get(kind)
          if (!requiredVersion) {
            throw new ConsultWriteError(
              'AGREEMENTS_UNAVAILABLE',
              'Required consult agreement versions are unavailable.',
            )
          }

          const kindEvidence = evidence.get(kind)

          return {
            kind,
            requiredVersion: toVersionDTO(requiredVersion),
            currentAcceptance: kindEvidence?.current
              ? toAcceptanceDTO(kindEvidence.current)
              : null,
            latestRevocation: kindEvidence?.latestRevoked
              ? toRevocationDTO(kindEvidence.latestRevoked)
              : null,
          }
        })

      return {
        consultId: session.id,
        status: session.status,
        requirements,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
}
