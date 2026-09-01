// lib/media/serviceTagOptions.ts
//
// The taggable service taxonomy a media editor offers, and the ONE query that
// produces it. `PATCH /api/v1/pro/media/[id]` validates every incoming
// `serviceIds` entry against `Service.isActive`, so an editor whose picker was
// built from a different query could offer an option the save then refuses.
//
// Three surfaces load it: the pro's library (`/pro/profile/public-profile`,
// portfolio tab), the media detail page (`/media/[id]`), and the native list
// (`GET /api/v1/pro/media`). They were three copies of the same findMany.

import { prisma } from '@/lib/prisma'
import { PUBLIC_PROFILE_LIMITS } from '@/lib/profiles/publicProfileSelects'

/** One taggable service, in the shape the editor's picker renders. */
export type ServiceTagOption = {
  id: string
  name: string
}

/**
 * Every active service, alphabetically. Capped at the same limit the public
 * profile uses so the two can't disagree about how deep the taxonomy goes.
 */
export async function loadServiceTagOptions(): Promise<ServiceTagOption[]> {
  return prisma.service.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    take: PUBLIC_PROFILE_LIMITS.serviceOptions,
    select: { id: true, name: true },
  })
}
