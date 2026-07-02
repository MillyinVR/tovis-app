// app/api/v1/client/waitlist-offers/route.ts

import { Prisma, WaitlistOfferStatus } from '@prisma/client'

import { jsonOk, requireClient } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import {
  pickProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { professionalProfileHref } from '@/lib/profiles/profileHrefs'

export const dynamic = 'force-dynamic'

const offerSelect = {
  id: true,
  status: true,
  startsAt: true,
  endsAt: true,
  locationType: true,
  expiresAt: true,
  professional: {
    select: {
      id: true,
      // Name fields (firstName/lastName/etc.) come from the approved privacy
      // helper's select so the plaintext read stays inside lib/privacy.
      ...professionalPublicDisplayNameSelect,
      avatarUrl: true,
      timeZone: true,
    },
  },
  offering: {
    select: {
      service: { select: { name: true } },
    },
  },
  location: {
    select: { timeZone: true },
  },
} satisfies Prisma.WaitlistOfferSelect

type OfferRow = Prisma.WaitlistOfferGetPayload<{ select: typeof offerSelect }>

function timeZoneFor(row: OfferRow): string {
  const locationTz = row.location?.timeZone?.trim()
  if (locationTz) return locationTz
  const proTz = row.professional.timeZone?.trim()
  return proTz || 'UTC'
}

/**
 * The client's outstanding pro-proposed waitlist time offers (PENDING only),
 * shaped like the priority-offer list so the /client/offers surface can render
 * Confirm/Decline cards alongside last-minute openings.
 */
export async function GET() {
  const auth = await requireClient()
  if (!auth.ok) return auth.res

  const rows = await prisma.waitlistOffer.findMany({
    where: {
      clientId: auth.clientId,
      status: WaitlistOfferStatus.PENDING,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: offerSelect,
  })

  const offers = rows.map((row) => ({
    offerId: row.id,
    status: row.status,
    proName:
      pickProfessionalPublicDisplayName(row.professional) ??
      row.professional.handle ??
      'Your pro',
    proHref: professionalProfileHref(row.professional.id),
    avatarUrl: row.professional.avatarUrl ?? null,
    serviceLabel: row.offering.service?.name?.trim() || 'a service',
    startAt: row.startsAt.toISOString(),
    endAt: row.endsAt.toISOString(),
    timeZone: timeZoneFor(row),
    locationType: row.locationType,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  }))

  return jsonOk({ offers }, 200)
}
