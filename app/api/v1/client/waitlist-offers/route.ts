// app/api/v1/client/waitlist-offers/route.ts

import { Prisma, WaitlistOfferStatus } from '@prisma/client'

import { jsonOk, requireClient } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import {
  pickProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { professionalProfileHref } from '@/lib/profiles/profileHrefs'
import { filterStillOpenRows } from '@/lib/booking/storedSlotLiveness'
import { waitlistOfferLivenessCandidate } from '@/lib/waitlist/offerLiveness'

export const dynamic = 'force-dynamic'

const offerSelect = {
  id: true,
  status: true,
  startsAt: true,
  endsAt: true,
  locationType: true,
  locationId: true,
  durationMinutes: true,
  expiresAt: true,
  professionalId: true,
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
  // The reservation this offer placed (F14). It is the offer's OWN hold, and the
  // confirm deletes it before booking — so the liveness check below has to
  // discount it, or every offer would hide itself.
  hold: {
    select: { id: true },
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
 * The client's outstanding pro-proposed waitlist time offers (PENDING and not
 * yet expired), shaped like the priority-offer list so the /client/offers
 * surface can render Confirm/Decline cards alongside last-minute openings.
 *
 * The `expiresAt` filter mirrors `assertConfirmableWaitlistOffer` exactly: an
 * expired offer is refused at confirm, so leaving it on the feed would show a
 * live-looking card whose only outcome is a refusal. Offers written before F14
 * carry a null `expiresAt` and never expire.
 */
export async function GET() {
  const auth = await requireClient()
  if (!auth.ok) return auth.res

  const now = new Date()

  const rows = await prisma.waitlistOffer.findMany({
    where: {
      clientId: auth.clientId,
      status: WaitlistOfferStatus.PENDING,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: offerSelect,
  })

  // Tori's rule (F15). F14's hold closed the "someone else took it" half; what
  // it cannot close is the pro changing their own mind afterwards — blocking
  // that time, or shortening the day around it. Either leaves a Confirm button
  // whose only outcome is a refusal, so the read runs the confirm's own gate.
  const stillOpen = await filterStillOpenRows({
    rows,
    toCandidate: waitlistOfferLivenessCandidate,
    viewerClientId: auth.clientId,
    // Unreachable — every offer stores its own duration — but stated rather
    // than defaulted.
    onUncheckable: 'drop',
    nowUtc: now,
  })

  const offers = stillOpen.map((row) => ({
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
