// app/api/v1/pro/waitlist/route.ts
//
// Pro-facing waitlist outreach feed: the clients waiting for this pro's
// services, grouped by service and ordered FIFO (join order). The pro works the
// list top-down to fill a spot from the waitlist — so the rank here is honest
// (it reflects who has been waiting longest), unlike a client-facing "in line"
// number, which the first-come last-minute engine doesn't honor.
import { WaitlistStatus } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { prismaRead } from '@/lib/prisma'
import { formatWaitlistPreferenceLabel } from '@/lib/waitlist/preferenceLabel'
import { liveWaitlistOfferWhere } from '@/lib/waitlist/offerLiveness'
import {
  buildProWaitlistPendingOfferSummary,
  PRO_WAITLIST_PENDING_OFFER_SELECT,
  type ProWaitlistPendingOfferSummary,
} from '@/lib/waitlist/proOfferSummary'
import { getVisibleClientIdSetForPro } from '@/lib/clientVisibility'
import {
  CLIENT_LINK_SELECT,
  clientLinkTarget,
  resolveClientProfileHref,
} from '@/lib/profiles/profileHrefs'

export const dynamic = 'force-dynamic'

/**
 * THE pro-facing shape of a live offer — owned by lib/waitlist/proOfferSummary,
 * not re-declared here.
 *
 * 🔴 For a MOBILE offer this carries a distance and a general area and NOTHING
 * else about where the client lives. That is enforced by the select it is read
 * through, so this RESPONSE does not contain the address — it is not a matter of
 * the client app choosing not to render one. The exact address opens to the pro
 * only after the client accepts, through the booking they then share.
 */
type WaitlistOutreachPendingOffer = ProWaitlistPendingOfferSummary

type WaitlistOutreachEntry = {
  rank: number
  waitlistEntryId: string
  clientName: string
  avatarUrl: string | null
  preferenceLabel: string
  joinedAt: string
  /**
   * Where this client's name/avatar leads, resolved server-side by THE one rule
   * (resolveClientProfileHref): the chart when this pro may open it, else the
   * client's public /u/[handle] page, else null.
   *
   * 🔴 Waitlist is the surface where this matters most. Joining a waitlist
   * auto-creates a message thread and nothing else, which is the CONTACT_ONLY
   * tier — so a waitlist client is almost never chart-visible, and every name on
   * this list was dead text regardless of whether they had a public profile.
   *
   * null → render plain text, never a link.
   */
  clientProfileHref: string | null
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
          select: {
            ...CLIENT_LINK_SELECT,
            firstName: true, // pii-plaintext-read-ok: pro reads own waitlist client's name for the outreach row
            lastName: true, // pii-plaintext-read-ok: pro reads own waitlist client's name for the outreach row
            avatarUrl: true,
          },
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
              ...liveWaitlistOfferWhere(new Date()),
            },
            select: PRO_WAITLIST_PENDING_OFFER_SELECT,
          })
        : []

    const pendingOfferByEntryId = new Map<string, WaitlistOutreachPendingOffer>(
      pendingOfferRows.map((offer) => [
        offer.waitlistEntryId,
        buildProWaitlistPendingOfferSummary(offer),
      ]),
    )

    // One batched read of the clients this pro may open a chart for, so each row
    // resolves against the same rule the bookings list and calendar use.
    const clientLinkViewer = {
      proVisibleClientIds: await getVisibleClientIdSetForPro(
        auth.professionalId,
      ),
    }

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
        clientProfileHref: resolveClientProfileHref(
          clientLinkTarget(row.client),
          clientLinkViewer,
        ),
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
