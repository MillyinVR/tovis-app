import 'server-only'

import {
  ConsultActorType,
  ConsultAuditAction,
  ConsultSessionStatus,
  Prisma,
  Role,
} from '@prisma/client'

import type {
  ConsultLookAvailabilityDTO,
  ConsultLookSessionDTO,
} from '@/lib/dto/consult'
import { buildLookPolicyInput, loadLookAccess } from '@/lib/looks/access'
import { canViewLookPost } from '@/lib/looks/guards'
import { prisma } from '@/lib/prisma'

import { isAiConsultEnabledForPro } from './access'
import { ConsultWriteError } from './errors'
import {
  CONSULT_LOOK_ANCHOR_SELECT,
  resolveConsultLookAnchor,
  type ConsultLookAnchorRefusalCode,
} from './lookAnchor'

/**
 * The look-anchored entry surface: "can I run a consult on this look?" and
 * "start one".
 *
 * Sits BESIDE the booking-anchored pair (POST /api/v1/client/consult and
 * GET .../consult/availability, #1016) rather than inside it. Those two are
 * read by shipped iOS builds and keep their exact shape and semantics; this is
 * a new path with new types.
 *
 * The no-leak rule carries over unchanged: while the pilot is dark for a pro,
 * her looks answer `available: false` with NO reason — the same signal as a
 * card that simply does not render. Only refusals that leak nothing (a look
 * with no service linkage, or one outside the pilot vertical) name themselves.
 */

const CONSULT_LOOK_SESSION_SELECT = {
  id: true,
  status: true,
  anchorLookPostId: true,
  professionalId: true,
  serviceCategoryId: true,
  createdAt: true,
} satisfies Prisma.ConsultSessionSelect

type ConsultLookSessionRow = Prisma.ConsultSessionGetPayload<{
  select: typeof CONSULT_LOOK_SESSION_SELECT
}>

export function toConsultLookSessionDTO(
  row: ConsultLookSessionRow,
): ConsultLookSessionDTO | null {
  if (!row.anchorLookPostId) return null
  return {
    id: row.id,
    status: row.status,
    lookPostId: row.anchorLookPostId,
    professionalId: row.professionalId,
    serviceCategoryId: row.serviceCategoryId,
    createdAt: row.createdAt.toISOString(),
  }
}

type ResolvedEntry =
  | {
      ok: true
      lookPostId: string
      professionalId: string
      serviceCategoryId: string
    }
  | { ok: false; hidden: true }
  | { ok: false; hidden: false; reason: ConsultLookAnchorRefusalCode }

/**
 * Everything the two entry points share: the client must be able to SEE the
 * look, the look must resolve to a pilot-vertical service, and the look's pro
 * must be in the founder pilot.
 */
async function resolveEntry(
  db: Prisma.TransactionClient | typeof prisma,
  args: { lookPostId: string; clientId: string },
): Promise<ResolvedEntry> {
  const access = await loadLookAccess(db, {
    lookPostId: args.lookPostId,
    viewerClientId: args.clientId,
  })
  if (!access || !canViewLookPost(buildLookPolicyInput(access, Role.CLIENT))) {
    return { ok: false, hidden: true }
  }

  const look = await db.lookPost.findUnique({
    where: { id: args.lookPostId },
    select: CONSULT_LOOK_ANCHOR_SELECT,
  })
  if (!look) return { ok: false, hidden: true }

  // The founder gate is checked BEFORE the linkage refusals, so a pro outside
  // the pilot never reveals anything about her looks' service linkage.
  if (!isAiConsultEnabledForPro(look.professionalId)) {
    return { ok: false, hidden: true }
  }

  const anchor = resolveConsultLookAnchor(look)
  if (!anchor.ok) return { ok: false, hidden: false, reason: anchor.reason }
  return {
    ok: true,
    lookPostId: anchor.lookPostId,
    professionalId: anchor.professionalId,
    serviceCategoryId: anchor.serviceCategoryId,
  }
}

export async function loadConsultLookAvailability(args: {
  lookPostId: string
  clientId: string
}): Promise<ConsultLookAvailabilityDTO> {
  const entry = await resolveEntry(prisma, args)
  if (!entry.ok) {
    return {
      available: false,
      reason: entry.hidden ? null : entry.reason,
      consult: null,
    }
  }

  const existing = await prisma.consultSession.findFirst({
    where: {
      clientId: args.clientId,
      professionalId: entry.professionalId,
      anchorLookPostId: entry.lookPostId,
    },
    select: CONSULT_LOOK_SESSION_SELECT,
  })

  return {
    available: true,
    reason: null,
    consult: existing ? toConsultLookSessionDTO(existing) : null,
  }
}

/**
 * Create-or-resume, mirroring the booking route's upsert semantics: tapping
 * "book this look" twice returns the same consult rather than a second one.
 * The unique index on (clientId, professionalId, anchorLookPostId) is what
 * makes that true under a race; the read below is the fast path, and P2002 is
 * the correct loser's answer.
 */
export async function startLookAnchoredConsult(args: {
  lookPostId: string
  clientId: string
  actorUserId: string
}): Promise<ConsultLookSessionDTO> {
  const entry = await resolveEntry(prisma, args)
  if (!entry.ok) {
    // The specific linkage reason is the AVAILABILITY endpoint's job — the UI
    // asks that before offering the button, and a 409 here is the race, not
    // the explanation.
    throw new ConsultWriteError(
      entry.hidden ? 'NOT_FOUND' : 'LOOK_NOT_CONSULTABLE',
      entry.hidden ? 'Not found.' : 'This look cannot start a consultation.',
    )
  }

  const where = {
    clientId: args.clientId,
    professionalId: entry.professionalId,
    anchorLookPostId: entry.lookPostId,
  }

  const existing = await prisma.consultSession.findFirst({
    where,
    select: CONSULT_LOOK_SESSION_SELECT,
  })
  const dto = existing ? toConsultLookSessionDTO(existing) : null
  if (dto) return dto

  try {
    const created = await prisma.consultSession.create({
      data: {
        ...where,
        serviceCategoryId: entry.serviceCategoryId,
        auditEvents: {
          create: {
            action: ConsultAuditAction.SESSION_CREATED,
            actorType: ConsultActorType.CLIENT,
            actorId: args.actorUserId,
            toStatus: ConsultSessionStatus.CONSENT_REQUIRED,
          },
        },
      },
      select: CONSULT_LOOK_SESSION_SELECT,
    })
    const createdDto = toConsultLookSessionDTO(created)
    if (!createdDto) {
      throw new ConsultWriteError('NOT_FOUND', 'Not found.')
    }
    return createdDto
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const raced = await prisma.consultSession.findFirst({
        where,
        select: CONSULT_LOOK_SESSION_SELECT,
      })
      const racedDto = raced ? toConsultLookSessionDTO(raced) : null
      if (racedDto) return racedDto
    }
    throw error
  }
}
