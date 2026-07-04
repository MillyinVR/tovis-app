import { Prisma, PrismaClient, type Role } from '@prisma/client'

import { getViewerFollowState } from '@/lib/follows'
import { asTrimmedString, normalizeRequiredId } from '@/lib/guards'
import type { LookViewPolicyInput } from '@/lib/looks/guards'

type LooksAccessDb = PrismaClient | Prisma.TransactionClient

export const lookAccessSelect =
  Prisma.validator<Prisma.LookPostSelect>()({
    id: true,
    professionalId: true,
    // For client-shared looks the author is the client, not the visited pro —
    // comment notifications + author badges route on this.
    clientAuthorId: true,
    status: true,
    visibility: true,
    moderationStatus: true,
    // Pre-mutation counts — the "before" side of milestone-threshold detection
    // (the like/save routes diff these against the recomputed count post-commit).
    likeCount: true,
    saveCount: true,
    professional: {
      select: {
        id: true,
        verificationStatus: true,
      },
    },
  })

export type LookAccessRow = Prisma.LookPostGetPayload<{
  select: typeof lookAccessSelect
}>

export type LoadedLookAccess = {
  look: LookAccessRow
  isOwner: boolean
  viewerFollowsProfessional: boolean
}

export async function loadLookAccess(
  db: LooksAccessDb,
  args: {
    lookPostId: string
    viewerClientId?: string | null
    viewerProfessionalId?: string | null
  },
): Promise<LoadedLookAccess | null> {
  const lookPostId = normalizeRequiredId('lookPostId', args.lookPostId)
  const viewerClientId = asTrimmedString(args.viewerClientId)
  const viewerProfessionalId = asTrimmedString(args.viewerProfessionalId)

  const look = await db.lookPost.findUnique({
    where: { id: lookPostId },
    select: lookAccessSelect,
  })

  if (!look) return null

  const isOwner = viewerProfessionalId === look.professionalId

  const viewerFollowsProfessional = isOwner
    ? false
    : await getViewerFollowState(db, {
        viewerClientId,
        professionalId: look.professionalId,
      })

  return {
    look,
    isOwner,
    viewerFollowsProfessional,
  }
}

/**
 * Shape a loaded look + viewer role into the input every look policy guard
 * (canView/canComment/canSave) expects. Keeps the field-mapping in one place so
 * the comment routes don't each re-spell it.
 */
export function buildLookPolicyInput(
  access: LoadedLookAccess,
  viewerRole: Role | null,
): LookViewPolicyInput {
  return {
    isOwner: access.isOwner,
    viewerRole,
    status: access.look.status,
    visibility: access.look.visibility,
    moderationStatus: access.look.moderationStatus,
    proVerificationStatus: access.look.professional.verificationStatus,
    viewerFollowsProfessional: access.viewerFollowsProfessional,
  }
}