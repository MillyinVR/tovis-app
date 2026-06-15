import { Prisma, PrismaClient } from '@prisma/client'

import { getViewerFollowState } from '@/lib/follows'
import { asTrimmedString, normalizeRequiredId } from '@/lib/guards'

type LooksAccessDb = PrismaClient | Prisma.TransactionClient

export const lookAccessSelect =
  Prisma.validator<Prisma.LookPostSelect>()({
    id: true,
    professionalId: true,
    status: true,
    visibility: true,
    moderationStatus: true,
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