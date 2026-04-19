import { Prisma, PrismaClient } from '@prisma/client'

import { getViewerFollowState } from '@/lib/follows'

type LooksAccessDb = PrismaClient | Prisma.TransactionClient

export const lookAccessSelect =
  Prisma.validator<Prisma.LookPostSelect>()({
    id: true,
    professionalId: true,
    status: true,
    visibility: true,
    moderationStatus: true,
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

function normalizeRequiredId(name: string, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${name} is required.`)
  }
  return trimmed
}

function normalizeOptionalId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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
  const viewerClientId = normalizeOptionalId(args.viewerClientId)
  const viewerProfessionalId = normalizeOptionalId(args.viewerProfessionalId)

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