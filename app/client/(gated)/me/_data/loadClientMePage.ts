// app/client/me/_data/loadClientMePage.ts
import 'server-only'

import { redirect } from 'next/navigation'
import {
  BookingStatus,
  LookPostStatus,
  MediaPhase,
  MediaType,
  Prisma,
} from '@prisma/client'

import {
  buildCreatorStanding,
  CREATOR_STANDING_SELECT,
  type CreatorStandingValue,
} from '@/lib/clients/creatorStanding'
import {
  resolveCreatorLevel,
  type CreatorLevelProgress,
} from '@/lib/clients/creatorLevel'
import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { getBoardSummaries } from '@/lib/boards'
import { lookNameFromCaption } from '@/lib/looks/publication/clientLookService'
import {
  buildMyFollowingListResponse,
  listFollowingPage,
} from '@/lib/follows'
import { countUnreadClientActivity } from '@/lib/notifications/activityFeed'
import {
  getClientCreatorStats,
  listClientLookRemixes,
  type ClientLookRemix,
} from '@/lib/creator/creatorProfileStats'
import {
  buildClientBookingDTO,
  type ClientBookingDTO,
} from '@/lib/dto/clientBooking'
import { computePendingConsultation } from '@/app/client/(gated)/bookings/[id]/_view/buildBookingViewModel'

type CurrentUserResult = Awaited<ReturnType<typeof getCurrentUser>>

type AuthedClientUser = NonNullable<CurrentUserResult> & {
  role: 'CLIENT'
  clientProfile: { id: string }
}

export const clientMeProfileSelect =
  Prisma.validator<Prisma.ClientProfileSelect>()({
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    avatarUrl: true,
    claimStatus: true,
    claimedAt: true,
    handle: true,
    isPublicProfile: true,
    // The owner's own tier / percentile / city — the same columns and the same
    // null-handling the public profile reads (lib/clients/creatorStanding.ts).
    ...CREATOR_STANDING_SELECT,
  })

export type ClientMeProfileRow = Prisma.ClientProfileGetPayload<{
  select: typeof clientMeProfileSelect
}>

export const clientMeBookingSelect =
  Prisma.validator<Prisma.BookingSelect>()({
    id: true,
    status: true,
    source: true,
    // Rebook-chain link — part of the canonical ClientBookingRow shape.
    rebookOfBookingId: true,
    // The look this booking was made from. Not on ClientBookingDTO, and read
    // here only to give a booking with no after-photo — every UPCOMING one — a
    // hero image. See loadBookingHeroImageUrls.
    //
    // Traversed as a RELATION rather than fetched by id in a second query.
    // A standalone bulk read of the look table is a discovery-shaped one, which
    // check:tenant-aware-discovery flags (correctly — it cannot tell that the
    // ids came from rows already scoped to this client); riding the relation is
    // both tenant-safe by construction and one round trip cheaper.
    // ⚠️ Do not name that call here in prose — the guard is a substring match,
    // so writing it in a comment IS the violation.
    sourceLookPostId: true,
    sourceLookPost: {
      select: {
        primaryMediaAsset: {
          select: {
            storageBucket: true,
            storagePath: true,
            thumbBucket: true,
            thumbPath: true,
            url: true,
            thumbUrl: true,
          },
        },
      },
    },
    sessionStep: true,
    scheduledFor: true,
    finishedAt: true,

    subtotalSnapshot: true,
    serviceSubtotalSnapshot: true,
    productSubtotalSnapshot: true,
    totalAmount: true,
    tipAmount: true,
    taxAmount: true,
    discountAmount: true,
    checkoutStatus: true,
    selectedPaymentMethod: true,
    paymentAuthorizedAt: true,
    paymentCollectedAt: true,

    totalDurationMinutes: true,
    bufferMinutes: true,

    // Rebook-proposal fields: without these the DTO's
    // hasPendingRebookConfirmation is silently false, and BookingDetailView
    // opened from ME (history / upcoming card) hides the confirm card the
    // same booking shows when opened from the Appointments list.
    aftercareSummary: {
      select: { rebookMode: true, rebookedFor: true, rebookDeclinedAt: true },
    },
    rebooks: { select: { id: true, status: true } },

    locationType: true,
    locationId: true,
    locationTimeZone: true,
    locationAddressSnapshot: true,
    locationLatSnapshot: true,
    locationLngSnapshot: true,
    // MOBILE happens at the CLIENT's address — `buildClientBookingDTO`
    // resolves the booked place from these, not from the pro's snapshot.
    clientAddressSnapshot: true,
    clientAddressLatSnapshot: true,
    clientAddressLngSnapshot: true,

    service: {
      select: {
        id: true,
        name: true,
      },
    },

    professional: {
      select: {
        id: true,
        businessName: true,
        firstName: true,
        lastName: true,
        handle: true,
        nameDisplay: true,
        location: true,
        timeZone: true,
      },
    },

    location: {
      select: {
        id: true,
        name: true,
        formattedAddress: true,
        city: true,
        state: true,
        timeZone: true,
      },
    },

    consultationNotes: true,
    consultationPrice: true,
    consultationConfirmedAt: true,

    consultationApproval: {
      select: {
        status: true,
        proposedServicesJson: true,
        proposedTotal: true,
        notes: true,
        approvedAt: true,
        rejectedAt: true,
      },
    },

    serviceItems: {
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 80,
      select: {
        id: true,
        itemType: true,
        parentItemId: true,
        sortOrder: true,
        durationMinutesSnapshot: true,
        priceSnapshot: true,
        serviceId: true,
        service: {
          select: {
            name: true,
          },
        },
      },
    },

    productSales: {
      orderBy: [{ createdAt: 'asc' }],
      take: 80,
      select: {
        id: true,
        productId: true,
        quantity: true,
        unitPrice: true,
        product: {
          select: {
            name: true,
          },
        },
      },
    },
  })

type ClientMeBookingRow = Prisma.BookingGetPayload<{
  select: typeof clientMeBookingSelect
}>

/** What {@link renderMediaUrls} needs — the shape both hero sources select. */
type MediaRenderSource = NonNullable<
  NonNullable<ClientMeBookingRow['sourceLookPost']>['primaryMediaAsset']
>

type ClientMeHistoryItem =
  | {
      kind: 'completed'
      label: 'BOOKED'
      booking: ClientBookingDTO
      heroImageUrl: string | null
      look: ClientMeHistoryLook | null
    }
  | {
      kind: 'upcoming'
      label: 'UPCOMING'
      booking: ClientBookingDTO
      heroImageUrl: string | null
      look: ClientMeHistoryLook | null
    }

export type ClientMeLook = {
  id: string
  name: string
  imageUrl: string | null
  visibility: string
  serviceId: string | null
  /**
   * The visit this look was authored from, when there is one.
   *
   * The Share-your-look flow stamps `MediaAsset.bookingId` on the look's
   * primary asset, so this is the join that lets a history card carry its own
   * look's visibility switch — the mapping exists, it is just indirect (a
   * history card is a `Booking`, a look is a `LookPost`).
   */
  bookingId: string | null
}

/**
 * The authored look a history card owns, folded onto the card itself.
 *
 * Null for a visit nobody has posted a look from — those keep the "Share your
 * look" CTA instead of a switch, because there is no visibility to toggle yet.
 */
export type ClientMeHistoryLook = {
  id: string
  name: string
  visibility: string
}

export type ClientMePageData = {
  user: AuthedClientUser
  profile: ClientMeProfileRow
  boards: Awaited<ReturnType<typeof getBoardSummaries>>
  following: ReturnType<typeof buildMyFollowingListResponse>
  counts: {
    boards: number
    saved: number
    booked: number
    following: number
    followers: number
  }
  upcomingNotificationBooking: ClientBookingDTO | null
  /**
   * Hero image for the upcoming card. Resolved by the same
   * {@link loadBookingHeroImageUrls} the history cards use, so the two cannot
   * disagree about which photo represents a visit.
   */
  upcomingNotificationHeroImageUrl: string | null
  history: ClientMeHistoryItem[]
  myLooks: ClientMeLook[]
  /** Unread count for the engagement activity feed (powers the header badge). */
  activityUnreadCount: number
  /**
   * The owner's OWN standing — the same tier pill and "top 5% saver · Brooklyn"
   * line a visitor to `/u/{handle}` already saw. Tori's first screen-7 note was
   * that the owner's page showed neither.
   */
  standing: CreatorStandingValue
  /**
   * Real-data creator metrics + remixes. `isCreator` gates the whole creator
   * UI: false until the client has published at least one authored look.
   */
  creator: {
    isCreator: boolean
    savesOnYourLooks: number
    bookedFromYou: number
    remixes: ClientLookRemix[]
    /**
     * Level and progress, derived server-side from the two ladders in
     * `lib/clients/creatorLevel.ts`. Computed here, not on either client, so the
     * thresholds have exactly one home and iOS cannot drift from web.
     */
    level: CreatorLevelProgress
  }
}

/**
 * Loads the looks this client has authored (Share-your-look). The primary asset
 * lives in media-public, so {@link renderMediaUrls} returns a direct public URL.
 * The look name is the first line of the caption (name + optional caption body).
 */
async function loadMyLooks(clientId: string): Promise<ClientMeLook[]> {
  // Scoped to THIS client's authored looks via the relation (not a cross-tenant
  // lookPost discovery read) — so it's tenant-safe by construction.
  const owner = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: {
      authoredLooks: {
        where: { status: LookPostStatus.PUBLISHED },
        orderBy: { publishedAt: 'desc' },
        take: 24,
        select: {
          id: true,
          caption: true,
          visibility: true,
          serviceId: true,
          primaryMediaAsset: {
            select: {
              storageBucket: true,
              storagePath: true,
              thumbBucket: true,
              thumbPath: true,
              url: true,
              thumbUrl: true,
              // The visit this look came out of — the join that lets the
              // history card own its look's visibility switch.
              bookingId: true,
            },
          },
        },
      },
    },
  })

  const rows = owner?.authoredLooks ?? []

  return Promise.all(
    rows.map(async (row) => {
      const { renderUrl, renderThumbUrl } = await renderMediaUrls(
        row.primaryMediaAsset,
      )
      const name = lookNameFromCaption(row.caption, 'Your look')
      return {
        id: row.id,
        name,
        imageUrl: renderThumbUrl ?? renderUrl,
        visibility: row.visibility,
        serviceId: row.serviceId,
        bookingId: row.primaryMediaAsset?.bookingId ?? null,
      }
    }),
  )
}

function isAuthedClientUser(
  user: CurrentUserResult | null,
): user is AuthedClientUser {
  return Boolean(
    user &&
      user.role === 'CLIENT' &&
      user.clientProfile &&
      typeof user.clientProfile.id === 'string' &&
      user.clientProfile.id.trim(),
  )
}

async function requireAuthedClientUser(): Promise<AuthedClientUser> {
  const user = await getCurrentUser().catch(() => null)

  if (!isAuthedClientUser(user)) {
    redirect('/login?from=/client/me')
  }

  return user
}

/**
 * Resolve one hero image per booking — for the history cards AND the upcoming
 * card, which is why it takes the source look as well as the booking id.
 *
 * Two sources, in order:
 *  1. the visit's own result ("after") photo, which only a finished visit has;
 *  2. failing that, the look the booking was made FROM.
 *
 * The fallback is what makes an UPCOMING booking picture-led at all: it has no
 * after-photo by definition, and the card used to render a permanently empty
 * grey box in the one slot the design fills with a photo.
 *
 * After-photos live in the private session bucket, so they're rendered via
 * {@link renderMediaUrls} (signed URLs) — never by reading `url`/`thumbUrl`
 * directly. This is the client viewing their OWN visits, so they're an
 * authorized participant.
 */
async function loadBookingHeroImageUrls(
  bookings: Array<{
    id: string
    sourceLookMedia: MediaRenderSource | null
  }>,
): Promise<Map<string, string>> {
  const heroByBooking = new Map<string, string>()
  if (bookings.length === 0) return heroByBooking

  const afterRows = await prisma.mediaAsset.findMany({
    where: {
      bookingId: { in: bookings.map((booking) => booking.id) },
      phase: MediaPhase.AFTER,
      mediaType: MediaType.IMAGE,
    },
    orderBy: [{ bookingId: 'asc' }, { createdAt: 'desc' }],
    select: {
      bookingId: true,
      storageBucket: true,
      storagePath: true,
      thumbBucket: true,
      thumbPath: true,
      url: true,
      thumbUrl: true,
    },
  })

  // `orderBy createdAt desc` makes the first row per booking the most recent.
  const latestByBooking = new Map<string, (typeof afterRows)[number]>()
  for (const row of afterRows) {
    if (!row.bookingId || latestByBooking.has(row.bookingId)) continue
    latestByBooking.set(row.bookingId, row)
  }

  await Promise.all(
    bookings.map(async (booking) => {
      const asset = latestByBooking.get(booking.id) ?? booking.sourceLookMedia
      if (!asset) return

      const { renderUrl, renderThumbUrl } = await renderMediaUrls(asset)
      const hero = renderThumbUrl ?? renderUrl
      if (hero) heroByBooking.set(booking.id, hero)
    }),
  )

  return heroByBooking
}

function toTimestamp(value: string): number {
  return new Date(value).getTime()
}

function isFutureBooking(booking: ClientBookingDTO, now: Date): boolean {
  return toTimestamp(booking.scheduledFor) >= now.getTime()
}

function isCompletedBooking(booking: ClientBookingDTO): boolean {
  return booking.status === BookingStatus.COMPLETED
}

function isAcceptedBooking(booking: ClientBookingDTO): boolean {
  return (
    booking.status === BookingStatus.ACCEPTED ||
    booking.status === BookingStatus.IN_PROGRESS
  )
}

function compareByScheduledAsc(
  left: ClientBookingDTO,
  right: ClientBookingDTO,
): number {
  return toTimestamp(left.scheduledFor) - toTimestamp(right.scheduledFor)
}

function compareHistoryItems(
  left: ClientMeHistoryItem,
  right: ClientMeHistoryItem,
): number {
  if (left.kind !== right.kind) {
    return left.kind === 'upcoming' ? -1 : 1
  }

  if (left.kind === 'upcoming') {
    return compareByScheduledAsc(left.booking, right.booking)
  }

  return toTimestamp(right.booking.scheduledFor) - toTimestamp(left.booking.scheduledFor)
}

export async function loadClientMePage(): Promise<ClientMePageData> {
  const user = await requireAuthedClientUser()
  const clientId = user.clientProfile.id
  const now = new Date()

  const [
    profile,
    unreadBookingRows,
    bookingRows,
    boards,
    followingPage,
    boardCount,
    followingCount,
    bookedCount,
    uniqueSavedRows,
    activityUnreadCount,
    creatorStats,
    remixes,
  ] = await Promise.all([
    prisma.clientProfile.findUnique({
      where: { id: clientId },
      select: clientMeProfileSelect,
    }),

    prisma.clientNotification.findMany({
      where: {
        clientId,
        bookingId: {
          not: null,
        },
        readAt: null,
      },
      select: {
        bookingId: true,
      },
      take: 1000,
    }),

    prisma.booking.findMany({
      where: {
        clientId,
        status: {
          in: [BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED],
        },
      },
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
      take: 300,
      select: clientMeBookingSelect,
    }),

    getBoardSummaries(prisma, {
      clientId,
      viewerClientId: clientId,
      take: 24,
      skip: 0,
    }),

    listFollowingPage(prisma, {
      clientId,
      viewerClientId: clientId,
      take: 24,
      skip: 0,
    }),

    prisma.board.count({
      where: {
        clientId,
      },
    }),

    prisma.proFollow.count({
      where: {
        clientId,
      },
    }),

    prisma.booking.count({
      where: {
        clientId,
        status: {
          in: [BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED],
        },
      },
    }),

    prisma.boardItem.findMany({
      where: {
        board: {
          clientId,
        },
      },
      distinct: ['lookPostId'],
      select: {
        lookPostId: true,
      },
    }),

    countUnreadClientActivity(prisma, clientId),

    getClientCreatorStats(prisma, clientId),
    listClientLookRemixes(prisma, { clientId, take: 5 }),
  ])

  if (!profile) {
    redirect('/login?from=/client/me')
  }

  const unreadBookingIds = new Set(
    unreadBookingRows
      .map((row) => row.bookingId)
      .filter(
        (bookingId): bookingId is string =>
          typeof bookingId === 'string' && bookingId.trim().length > 0,
      ),
  )

  const bookings = await Promise.all(
    bookingRows.map((booking) =>
      buildClientBookingDTO({
        booking,
        unreadAftercare: unreadBookingIds.has(booking.id),
        hasPendingConsultationApproval: computePendingConsultation({
          status: booking.status,
          sessionStep: booking.sessionStep,
          finishedAt: booking.finishedAt,
          consultationApproval: booking.consultationApproval,
        }),
      }),
    ),
  )

  const upcomingBookings = bookings
    .filter(
      (booking) => isAcceptedBooking(booking) && isFutureBooking(booking, now),
    )
    .sort(compareByScheduledAsc)

  const completedBookings = bookings
    .filter((booking) => isCompletedBooking(booking))
    .sort(
      (left, right) =>
        toTimestamp(right.scheduledFor) - toTimestamp(left.scheduledFor),
    )

  const upcomingNotificationBooking = upcomingBookings[0] ?? null

  // The source look's media rides the raw rows, not the DTO, so pair it back up.
  const sourceLookMediaByBookingId = new Map(
    bookingRows.map((row) => [
      row.id,
      row.sourceLookPost?.primaryMediaAsset ?? null,
    ]),
  )
  const heroCandidates = [...upcomingBookings, ...completedBookings].map(
    (booking) => ({
      id: booking.id,
      sourceLookMedia: sourceLookMediaByBookingId.get(booking.id) ?? null,
    }),
  )

  const [bookingHeroImageUrls, myLooks] = await Promise.all([
    loadBookingHeroImageUrls(heroCandidates),
    loadMyLooks(clientId),
  ])

  // The authored look each visit produced, keyed by the booking its primary
  // asset was stamped with. A client can author more than one look from the
  // same visit; `loadMyLooks` orders by `publishedAt desc`, so the FIRST match
  // wins and the card carries the most recent look rather than an arbitrary one.
  const lookByBookingId = new Map<string, ClientMeHistoryLook>()
  for (const look of myLooks) {
    if (!look.bookingId || lookByBookingId.has(look.bookingId)) continue
    lookByBookingId.set(look.bookingId, {
      id: look.id,
      name: look.name,
      visibility: look.visibility,
    })
  }

  const historyUpcoming: ClientMeHistoryItem[] = upcomingBookings.map((booking) => ({
    kind: 'upcoming',
    label: 'UPCOMING',
    booking,
    // Was hard-coded null, so every upcoming visit rendered a textual fallback
    // tile that repeated the title the card already prints underneath it.
    heroImageUrl: bookingHeroImageUrls.get(booking.id) ?? null,
    look: lookByBookingId.get(booking.id) ?? null,
  }))

  const historyCompleted: ClientMeHistoryItem[] = completedBookings.map((booking) => ({
    kind: 'completed',
    label: 'BOOKED',
    booking,
    heroImageUrl: bookingHeroImageUrls.get(booking.id) ?? null,
    look: lookByBookingId.get(booking.id) ?? null,
  }))

  const following = buildMyFollowingListResponse({
    clientId,
    items: followingPage.items,
    pagination: followingPage.pagination,
  })

  return {
    user,
    profile,
    boards,
    following,
    counts: {
      boards: boardCount,
      saved: uniqueSavedRows.length,
      booked: bookedCount,
      following: followingCount,
      followers: creatorStats.followers,
    },
    upcomingNotificationBooking,
    upcomingNotificationHeroImageUrl: upcomingNotificationBooking
      ? (bookingHeroImageUrls.get(upcomingNotificationBooking.id) ?? null)
      : null,
    history: [...historyUpcoming, ...historyCompleted].sort(compareHistoryItems),
    myLooks,
    activityUnreadCount,
    standing: buildCreatorStanding(profile),
    creator: {
      isCreator: creatorStats.authoredLooksCount > 0,
      savesOnYourLooks: creatorStats.savesOnYourLooks,
      bookedFromYou: creatorStats.bookedFromYou,
      remixes,
      level: resolveCreatorLevel({
        savesOnYourLooks: creatorStats.savesOnYourLooks,
        bookedFromYou: creatorStats.bookedFromYou,
      }),
    },
  }
}