// lib/creator/creatorProfileStats.ts
//
// Real-data creator metrics for the client "Me" page creator sections. Every
// number here is derived live from Prisma (the single source of truth) — there
// is no denormalized "influence" snapshot. The gamified influence tier / level
// / percentile is intentionally NOT computed here: it needs product-defined
// thresholds and is deferred (the Me UI hides that block until it exists).
import { LookPostStatus, Prisma, PrismaClient } from '@prisma/client'

import { countClientFollowers } from '@/lib/follows'
import { lookNameFromCaption } from '@/lib/looks/publication/clientLookService'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { normalizeRequiredId } from '@/lib/guards'

type CreatorDb = PrismaClient | Prisma.TransactionClient

export type ClientCreatorStats = {
  /** Client→client followers (ClientFollow). */
  followers: number
  /** Sum of saveCount across this client's PUBLISHED authored looks. */
  savesOnYourLooks: number
  /** Bookings OTHERS made starting from one of this client's authored looks. */
  bookedFromYou: number
  /** PUBLISHED authored looks — gates whether the creator sections show at all. */
  authoredLooksCount: number
}

export type ClientLookRemix = {
  /** The booking id. */
  id: string
  /** Booker, PII-safe: `@handle` for a public client, else a generic label. */
  who: string
  /** The author's look that inspired the booking. */
  lookName: string
  /** The pro the remix was booked with. */
  proName: string
  bookedAt: string
}

/**
 * Looks authored by this client that someone ELSE booked from — the "remix"
 * graph. Filters to `clientAuthorId = clientId` (only THIS client's looks) and
 * excludes the author's own bookings.
 */
function remixWhere(clientId: string): Prisma.BookingWhereInput {
  return {
    sourceLookPost: { clientAuthorId: clientId },
    clientId: { not: clientId },
  }
}

export async function getClientCreatorStats(
  db: CreatorDb,
  clientIdInput: string,
): Promise<ClientCreatorStats> {
  const clientId = normalizeRequiredId('clientId', clientIdInput)

  const authoredLooksWhere: Prisma.LookPostWhereInput = {
    clientAuthorId: clientId,
    status: LookPostStatus.PUBLISHED,
  }

  const [followers, savesAgg, bookedFromYou, authoredLooksCount] =
    await Promise.all([
      countClientFollowers(db, clientId),
      db.lookPost.aggregate({
        where: authoredLooksWhere,
        _sum: { saveCount: true },
      }),
      db.booking.count({ where: remixWhere(clientId) }),
      db.lookPost.count({ where: authoredLooksWhere }),
    ])

  return {
    followers,
    savesOnYourLooks: Math.max(0, savesAgg._sum.saveCount ?? 0),
    bookedFromYou,
    authoredLooksCount,
  }
}

export async function listClientLookRemixes(
  db: CreatorDb,
  args: { clientId: string; take?: number },
): Promise<ClientLookRemix[]> {
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const take = Math.min(Math.max(Math.trunc(args.take ?? 5), 1), 20)

  const rows = await db.booking.findMany({
    where: remixWhere(clientId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: {
      id: true,
      createdAt: true,
      // The booker is another client — addressed by handle only when public,
      // never by legal name (matches the activity-feed PII model).
      client: { select: { handle: true, isPublicProfile: true } },
      professional: {
        select: {
          businessName: true,
          firstName: true,
          lastName: true,
          handle: true,
          nameDisplay: true,
        },
      },
      sourceLookPost: { select: { caption: true } },
    },
  })

  return rows.map((row) => {
    const handle =
      row.client.isPublicProfile && row.client.handle ? row.client.handle : null
    return {
      id: row.id,
      who: handle ? `@${handle}` : 'Someone',
      lookName: lookNameFromCaption(row.sourceLookPost?.caption ?? null),
      proName: formatProfessionalPublicDisplayName(row.professional),
      bookedAt: row.createdAt.toISOString(),
    }
  })
}
