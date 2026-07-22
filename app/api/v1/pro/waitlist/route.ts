// app/api/v1/pro/waitlist/route.ts
//
// Pro-facing waitlist outreach feed: the clients waiting for this pro's
// services, grouped by service and ordered FIFO (join order). The pro works the
// list top-down to fill a spot from the waitlist — so the rank here is honest
// (it reflects who has been waiting longest), unlike a client-facing "in line"
// number, which the first-come last-minute engine doesn't honor.
import {
  ServiceLocationType,
  WaitlistOfferStatus,
  WaitlistStatus,
} from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { prismaRead } from '@/lib/prisma'
import { formatWaitlistPreferenceLabel } from '@/lib/waitlist/preferenceLabel'

export const dynamic = 'force-dynamic'

type WaitlistOutreachPendingOffer = {
  id: string
  startsAt: string
  locationType: ServiceLocationType
}

type WaitlistOutreachEntry = {
  rank: number
  waitlistEntryId: string
  clientName: string
  avatarUrl: string | null
  preferenceLabel: string
  joinedAt: string
  // A still-confirmable time already offered to this client, so the row reads
  // "Offered · <time>" instead of inviting another offer. Since F14 that offer
  // also holds the slot, and this is the pro's only surface saying so.
  pendingOffer: WaitlistOutreachPendingOffer | null
}

type WaitlistOutreachServiceGroup = {
  serviceId: string
  serviceName: string
  entries: WaitlistOutreachEntry[]
}

function clientDisplayName(
  firstName: string | null,
  lastName: string | null,
): string {
  const name = [firstName, lastName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ')

  return name.length > 0 ? name : 'Client'
}

export async function GET() {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  try {
    // NOTIFIED entries are listed alongside ACTIVE ones: sending an offer moves
    // the entry there, and filtering them out made the client silently vanish
    // from the pro's own waitlist the moment they were offered a time. Since F14
    // that offer reserves the slot, so a row the pro cannot see is a slot they
    // cannot account for.
    const rows = await prismaRead.waitlistEntry.findMany({
      where: {
        professionalId: auth.professionalId,
        status: { in: [WaitlistStatus.ACTIVE, WaitlistStatus.NOTIFIED] },
      },
      // FIFO: the client who joined first is rank #1 within their service.
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: {
        id: true,
        createdAt: true,
        preferenceType: true,
        specificDate: true,
        timeOfDay: true,
        windowStartMin: true,
        windowEndMin: true,
        service: { select: { id: true, name: true } },
        client: {
          select: { firstName: true, lastName: true, avatarUrl: true },
        },
      },
    })

    // Live offers for the listed entries. The expiry filter matches
    // assertConfirmableWaitlistOffer: an expired offer can no longer be
    // confirmed, so it must stop suppressing the offer action.
    const entryIds = rows.map((row) => row.id)
    const pendingOfferRows =
      entryIds.length > 0
        ? await prismaRead.waitlistOffer.findMany({
            where: {
              waitlistEntryId: { in: entryIds },
              status: WaitlistOfferStatus.PENDING,
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            select: {
              id: true,
              waitlistEntryId: true,
              startsAt: true,
              locationType: true,
            },
          })
        : []

    const pendingOfferByEntryId = new Map<string, WaitlistOutreachPendingOffer>(
      pendingOfferRows.map((offer) => [
        offer.waitlistEntryId,
        {
          id: offer.id,
          startsAt: offer.startsAt.toISOString(),
          locationType: offer.locationType,
        },
      ]),
    )

    const groups = new Map<string, WaitlistOutreachServiceGroup>()

    for (const row of rows) {
      const serviceId = row.service?.id
      if (!serviceId) continue

      let group = groups.get(serviceId)
      if (!group) {
        group = {
          serviceId,
          serviceName: row.service?.name ?? 'Service',
          entries: [],
        }
        groups.set(serviceId, group)
      }

      group.entries.push({
        // Rank within the service group; rows are already createdAt-ascending.
        rank: group.entries.length + 1,
        waitlistEntryId: row.id,
        clientName: clientDisplayName(
          row.client?.firstName ?? null,
          row.client?.lastName ?? null,
        ),
        avatarUrl: row.client?.avatarUrl ?? null,
        preferenceLabel: formatWaitlistPreferenceLabel({
          preferenceType: row.preferenceType,
          specificDate: row.specificDate,
          timeOfDay: row.timeOfDay,
          windowStartMin: row.windowStartMin,
          windowEndMin: row.windowEndMin,
        }),
        joinedAt: row.createdAt.toISOString(),
        pendingOffer: pendingOfferByEntryId.get(row.id) ?? null,
      })
    }

    const services = Array.from(groups.values())
    const total = rows.length

    return jsonOk({ services, total }, 200)
  } catch (err) {
    console.error('GET /api/v1/pro/waitlist', err)
    return jsonFail(500, 'Failed to load waitlist.')
  }
}
