// lib/profiles/proProfileSeo.ts
//
// Crawler-facing profile data for generateMetadata + JSON-LD on the public
// pro profile surfaces (/professionals/[id] and /p/[handle]). Loads with a
// NULL viewer — what an anonymous crawler may see — and reuses the canonical
// public select + header mapper so display-name/visibility rules stay single
// -sourced. cache()-wrapped so generateMetadata and the page render share one
// execution per request.
import 'server-only'

import { cache } from 'react'

import { prisma } from '@/lib/prisma'
import { canViewerSeeProPublicSurface } from '@/lib/proTrustState'
import {
  mapPublicProfileHeaderToDto,
  type PublicProfileHeaderDto,
} from '@/lib/profiles/publicProfileMappers'
import { publicProfessionalProfileSelect } from '@/lib/profiles/publicProfileSelects'

export type ProProfileSeo = {
  header: PublicProfileHeaderDto
  reviewCount: number
  averageRating: number | null
  city: string | null
  state: string | null
}

async function loadByWhere(
  where: { id: string } | { handleNormalized: string },
): Promise<ProProfileSeo | null> {
  const profileRow = await prisma.professionalProfile.findUnique({
    where,
    select: publicProfessionalProfileSelect,
  })

  if (!profileRow) return null

  // Anonymous-crawler view: no viewer. Pending/rejected pros stay invisible.
  const canView = canViewerSeeProPublicSurface({
    viewerRole: null,
    viewerProfessionalId: null,
    professionalId: profileRow.id,
    verificationStatus: profileRow.verificationStatus,
  })
  if (!canView) return null

  const [reviewStats, primaryLocation] = await Promise.all([
    prisma.review.aggregate({
      where: { professionalId: profileRow.id },
      _count: { _all: true },
      _avg: { rating: true },
    }),
    prisma.professionalLocation.findFirst({
      where: {
        professionalId: profileRow.id,
        archivedAt: null,
        isBookable: true,
      },
      orderBy: { isPrimary: 'desc' },
      select: { city: true, state: true },
    }),
  ])

  return {
    header: mapPublicProfileHeaderToDto(profileRow),
    reviewCount: reviewStats._count._all,
    averageRating: reviewStats._avg.rating ?? null,
    city: primaryLocation?.city?.trim() || null,
    state: primaryLocation?.state?.trim() || null,
  }
}

export const loadProProfileSeoById = cache(
  async (professionalId: string): Promise<ProProfileSeo | null> => {
    if (!professionalId) return null
    return loadByWhere({ id: professionalId })
  },
)

export const loadProProfileSeoByHandle = cache(
  async (handleNormalized: string): Promise<ProProfileSeo | null> => {
    if (!handleNormalized) return null
    return loadByWhere({ handleNormalized })
  },
)
