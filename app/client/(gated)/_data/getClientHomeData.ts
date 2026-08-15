// app/client/_data/getClientHomeData.ts
import {
  BookingCheckoutStatus,
  BookingStatus,
  ConsultationApprovalStatus,
  LastMinuteRecipientStatus,
  ModerationStatus,
  OpeningStatus,
  Prisma,
  SessionStep,
  ViralServiceRequestStatus,
  WaitlistStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  loadBookingBeforeAfterThumbsFor,
  type BookingBeforeAfterThumbs,
} from '@/lib/media/bookingBeforeAfter'
import { filterStillOpenRows } from '@/lib/booking/storedSlotLiveness'
import { loadProRating } from '@/lib/booking/trustSignals'
import { openingLivenessCandidate } from '@/lib/lastMinute/openingLiveness'

export const clientHomeBookingSelect = Prisma.validator<Prisma.BookingSelect>()({
  id: true,
  status: true,
  source: true,
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

  locationType: true,
  locationId: true,
  locationTimeZone: true,
  locationAddressSnapshot: true,

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
      firstName: true, // pii-plaintext-read-ok: pro public display name (formatProfessionalPublicDisplayName)
      lastName: true, // pii-plaintext-read-ok: pro public display name (formatProfessionalPublicDisplayName)
      nameDisplay: true,
      handle: true,
      avatarUrl: true,
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
})

export const clientHomeAftercareSelect =
  Prisma.validator<Prisma.AftercareSummarySelect>()({
    id: true,
    notes: true,
    rebookMode: true,
    rebookedFor: true,
    rebookWindowStart: true,
    rebookWindowEnd: true,
    draftSavedAt: true,
    sentToClientAt: true,
    lastEditedAt: true,
    version: true,

    recommendedProducts: {
      take: 4,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        productId: true,
        note: true,
        externalName: true,
        externalUrl: true,
        product: {
          select: {
            id: true,
            name: true,
            brand: true,
            retailPrice: true,
          },
        },
      },
    },

    booking: {
      select: clientHomeBookingSelect,
    },
  })

export const clientHomeLastMinuteInviteSelect =
  Prisma.validator<Prisma.LastMinuteRecipientSelect>()({
    id: true,
    firstMatchedTier: true,
    notifiedTier: true,
    status: true,
    notifiedAt: true,
    openedAt: true,
    clickedAt: true,
    bookedAt: true,
    createdAt: true,

    opening: {
      select: {
        id: true,
        professionalId: true,
        startAt: true,
        endAt: true,
        note: true,
        status: true,
        visibilityMode: true,
        publicVisibleFrom: true,
        publicVisibleUntil: true,
        timeZone: true,
        locationType: true,
        locationId: true,

        professional: {
          select: {
            id: true,
            businessName: true,
            firstName: true, // pii-plaintext-read-ok: pro public display name (formatProfessionalPublicDisplayName)
            lastName: true, // pii-plaintext-read-ok: pro public display name (formatProfessionalPublicDisplayName)
            nameDisplay: true,
            handle: true,
            avatarUrl: true,
            professionType: true,
            location: true,
            timeZone: true,
          },
        },

        location: {
          select: {
            id: true,
            type: true,
            timeZone: true,
            city: true,
            state: true,
            formattedAddress: true,
            lat: true,
            lng: true,
          },
        },

        services: {
          where: {
            offering: {
              is: {
                isActive: true,
              },
            },
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          take: 6,
          select: {
            id: true,
            openingId: true,
            serviceId: true,
            offeringId: true,
            sortOrder: true,
            service: {
              select: {
                id: true,
                name: true,
                minPrice: true,
                defaultDurationMinutes: true,
              },
            },
            offering: {
              select: {
                id: true,
                title: true,
                salonPriceStartingAt: true,
                mobilePriceStartingAt: true,
                salonDurationMinutes: true,
                mobileDurationMinutes: true,
                offersInSalon: true,
                offersMobile: true,
              },
            },
          },
        },

        tierPlans: {
          where: {
            cancelledAt: null,
          },
          orderBy: [{ scheduledFor: 'asc' }, { tier: 'asc' }],
          select: {
            id: true,
            tier: true,
            scheduledFor: true,
            offerType: true,
            percentOff: true,
            amountOff: true,
            freeAddOnServiceId: true,
            freeAddOnService: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    },
  })

export const clientHomeWaitlistSelect =
  Prisma.validator<Prisma.WaitlistEntrySelect>()({
    id: true,
    createdAt: true,
    notes: true,
    mediaId: true,
    status: true,
    preferenceType: true,
    specificDate: true,
    timeOfDay: true,
    windowStartMin: true,
    windowEndMin: true,

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
        firstName: true, // pii-plaintext-read-ok: pro public display name (formatProfessionalPublicDisplayName)
        lastName: true, // pii-plaintext-read-ok: pro public display name (formatProfessionalPublicDisplayName)
        nameDisplay: true,
        handle: true,
        avatarUrl: true,
        location: true,
        timeZone: true,
      },
    },
  })

export const clientHomeFavoriteProSelect =
  Prisma.validator<Prisma.ProfessionalFavoriteSelect>()({
    professional: {
      select: {
        id: true,
        businessName: true,
        firstName: true, // pii-plaintext-read-ok: pro public display name (formatProfessionalPublicDisplayName)
        lastName: true, // pii-plaintext-read-ok: pro public display name (formatProfessionalPublicDisplayName)
        nameDisplay: true,
        handle: true,
        avatarUrl: true,
        professionType: true,
        location: true,
      },
    },
  })

export const clientHomeFavoriteServiceSelect =
  Prisma.validator<Prisma.ServiceFavoriteSelect>()({
    id: true,
    service: {
      select: {
        id: true,
        name: true,
        minPrice: true,
        defaultDurationMinutes: true,
        defaultImageUrl: true,
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    },
  })

export const clientHomeViralLiveSelect =
  Prisma.validator<Prisma.ViralServiceRequestSelect>()({
    id: true,
    name: true,
    sourceUrl: true,
    approvedAt: true,
    // The reviewer's pick, and only that — `resolveViralCoverImage` publishes
    // nothing else. The submitter's own `mediaUrlsJson` is deliberately NOT
    // selected here: this query returns every client's approved look, so it has
    // no business loading someone's unvetted attachment onto a client surface.
    coverImageUrl: true,
    _count: {
      select: {
        approvalFanOuts: true,
      },
    },
  })

export const clientHomeViralPendingSelect =
  Prisma.validator<Prisma.ViralServiceRequestSelect>()({
    id: true,
    name: true,
    sourceUrl: true,
    status: true,
    createdAt: true,
    coverImageUrl: true,
    _count: {
      select: {
        approvalFanOuts: true,
      },
    },
  })

export type ClientHomeBooking = Prisma.BookingGetPayload<{
  select: typeof clientHomeBookingSelect
}>

export type ClientHomeAftercare = Prisma.AftercareSummaryGetPayload<{
  select: typeof clientHomeAftercareSelect
}>

export type ClientHomeLastMinuteInvite = Prisma.LastMinuteRecipientGetPayload<{
  select: typeof clientHomeLastMinuteInviteSelect
}>

export type ClientHomeWaitlistEntry = Prisma.WaitlistEntryGetPayload<{
  select: typeof clientHomeWaitlistSelect
}> & {
  /**
   * The client's real FIFO place in this pro's queue FOR THIS SERVICE — the same
   * rank the pro sees (`app/api/v1/pro/waitlist/route.ts`: *"FIFO: the client
   * who joined first is rank #1 within their service"*).
   *
   * 🔴 Both clients used to print `#{index + 1} in line`, which is the row's
   * position in the viewer's OWN list. A client on one waitlist therefore always
   * read "#1 in line" — "you're next", from a screen that had never counted
   * anyone else — and the pro looking at the same entry could be seeing #7.
   *
   * Null when the rank cannot be established (see WAITLIST_PEER_CAP): no number
   * is honest, a wrong one is not.
   */
  queuePosition: number | null
}

export type ClientHomeFavoritePro = Prisma.ProfessionalFavoriteGetPayload<{
  select: typeof clientHomeFavoriteProSelect
}>

export type ClientHomeFavoriteService = Prisma.ServiceFavoriteGetPayload<{
  select: typeof clientHomeFavoriteServiceSelect
}>

export type ClientHomeViralLive = Prisma.ViralServiceRequestGetPayload<{
  select: typeof clientHomeViralLiveSelect
}>

export type ClientHomeViralPending = Prisma.ViralServiceRequestGetPayload<{
  select: typeof clientHomeViralPendingSelect
}>

export type ClientHomeAction =
  | {
      kind: 'PENDING_CONSULTATION'
      booking: ClientHomeBooking
    }
  | {
      kind: 'AFTERCARE_PAYMENT_DUE'
      aftercare: ClientHomeAftercare
      booking: ClientHomeBooking
      beforeAfter: BookingBeforeAfterThumbs
    }
  | null

export type ClientHomeData = {
  /**
   * What the greeting calls this client — their own first name, their email if
   * they have not given one, and "there" if neither.
   *
   * Resolved HERE rather than at each surface so both clients greet the same
   * person the same way. iOS had no name on the wire at all and derived one from
   * the email's local part (`demo-maya@` → "Demo"), falling back to "Welcome
   * back" whenever the session user was not loaded yet — which, on a cold
   * launch, is every time.
   */
  displayName: string
  upcoming: ClientHomeBooking | null
  upcomingCount: number
  /**
   * The visible-review aggregate for the pro on the next-booking card. Loaded
   * only when there IS a next booking, and null when that pro has no visible
   * reviews — the card then shows no star rather than an empty one.
   */
  upcomingProRating: { average: number; count: number } | null
  action: ClientHomeAction
  invites: ClientHomeLastMinuteInvite[]
  waitlists: ClientHomeWaitlistEntry[]
  favoritePros: ClientHomeFavoritePro[]
  favoriteServices: ClientHomeFavoriteService[]
  viralLive: ClientHomeViralLive[]
  viralPending: ClientHomeViralPending[]
}

type GetClientHomeDataArgs = {
  clientId: string
  userId: string
}

export async function getClientHomeData({
  clientId,
  userId,
}: GetClientHomeDataArgs): Promise<ClientHomeData> {
  const now = new Date()

  const [
    viewer,
    upcoming,
    upcomingCount,
    pendingConsultation,
    aftercarePaymentDue,
    invites,
    waitlists,
    favoritePros,
    favoriteServices,
    viralLive,
    viralPending,
  ] = await Promise.all([
    prisma.clientProfile.findUnique({
      where: { id: clientId },
      select: {
        firstName: true, // pii-plaintext-read-ok: the viewer's own first name, for their own greeting
        user: { select: { email: true } },
      },
    }),

    prisma.booking.findFirst({
      where: {
        clientId,
        status: { in: [BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS] },
        scheduledFor: {
          gte: now,
        },
      },
      orderBy: {
        scheduledFor: 'asc',
      },
      select: clientHomeBookingSelect,
    }),

    prisma.booking.count({
      where: {
        clientId,
        status: { in: [BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS] },
        scheduledFor: {
          gte: now,
        },
      },
    }),

    prisma.booking.findFirst({
      where: {
        clientId,
        finishedAt: null,
        status: {
          notIn: [BookingStatus.CANCELLED, BookingStatus.COMPLETED],
        },
        OR: [
          {
            sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
          },
          {
            consultationApproval: {
              is: {
                status: ConsultationApprovalStatus.PENDING,
              },
            },
          },
        ],
      },
      orderBy: {
        scheduledFor: 'asc',
      },
      select: clientHomeBookingSelect,
    }),

    prisma.aftercareSummary.findFirst({
      where: {
        sentToClientAt: {
          not: null,
        },
        booking: {
          clientId,
          paymentCollectedAt: null,
          checkoutStatus: {
            notIn: [BookingCheckoutStatus.PAID, BookingCheckoutStatus.WAIVED],
          },
        },
      },
      orderBy: {
        sentToClientAt: 'desc',
      },
      select: clientHomeAftercareSelect,
    }),

    prisma.lastMinuteRecipient.findMany({
      where: {
        clientId,
        cancelledAt: null,
        bookedAt: null,
        notifiedAt: {
          not: null,
        },
        status: {
          in: [
            LastMinuteRecipientStatus.ENQUEUED,
            LastMinuteRecipientStatus.OPENED,
            LastMinuteRecipientStatus.CLICKED,
          ],
        },
        opening: {
          status: OpeningStatus.ACTIVE,
          bookedAt: null,
          cancelledAt: null,
          startAt: {
            gte: now,
          },
          services: {
            some: {
              offering: {
                is: {
                  isActive: true,
                },
              },
            },
          },
        },
      },
      orderBy: [{ notifiedAt: 'desc' }, { createdAt: 'desc' }],
      take: 12,
      select: clientHomeLastMinuteInviteSelect,
    }),

    prisma.waitlistEntry.findMany({
      where: {
        clientId,
        status: WaitlistStatus.ACTIVE,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 12,
      select: clientHomeWaitlistSelect,
    }),

    prisma.professionalFavorite.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 24,
      select: clientHomeFavoriteProSelect,
    }),

    prisma.serviceFavorite.findMany({
      where: {
        userId,
        service: {
          isActive: true,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 12,
      select: clientHomeFavoriteServiceSelect,
    }),

    prisma.viralServiceRequest.findMany({
      where: {
        status: ViralServiceRequestStatus.APPROVED,
        moderationStatus: ModerationStatus.APPROVED,
        removedAt: null,
      },
      orderBy: {
        approvedAt: 'desc',
      },
      take: 8,
      select: clientHomeViralLiveSelect,
    }),

    prisma.viralServiceRequest.findMany({
      where: {
        clientId,
        status: {
          in: [
            ViralServiceRequestStatus.REQUESTED,
            ViralServiceRequestStatus.IN_REVIEW,
          ],
        },
        removedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 5,
      select: clientHomeViralPendingSelect,
    }),
  ])

  // Both depend on the fan-out above, so they cannot join it — but they do not
  // depend on EACH OTHER, and this is a page-load path: serialising them would
  // put two round-trips end to end for no reason. The rating is loaded only when
  // there is a card to put it on, so a client with no upcoming booking pays
  // nothing for it.
  const [rankedWaitlists, upcomingProRating] = await Promise.all([
    withQueuePositions(waitlists),
    upcoming ? loadProRating(upcoming.professional.id) : Promise.resolve(null),
  ])

  // Tori's rule (F15): a stored time the pro's schedule can no longer serve is
  // not shown at all. These are the same opening rows /api/v1/client/openings
  // serves, on the home screen — and this loader backs BOTH the web home and
  // GET /api/v1/client/home, which iOS reads, so one filter covers both.
  const liveInvites = await filterStillOpenRows({
    rows: invites,
    toCandidate: (invite) => openingLivenessCandidate(invite.opening),
    viewerClientId: clientId,
    // Unreachable — the query requires an active service — but stated rather
    // than defaulted.
    onUncheckable: 'drop',
    nowUtc: now,
  })

  let action: ClientHomeAction = null
  if (pendingConsultation) {
    action = {
      kind: 'PENDING_CONSULTATION',
      booking: pendingConsultation,
    }
  } else if (aftercarePaymentDue) {
    action = {
      kind: 'AFTERCARE_PAYMENT_DUE',
      aftercare: aftercarePaymentDue,
      booking: aftercarePaymentDue.booking,
      // Before/after photos for the visit, shown on the action card that links
      // to the aftercare summary.
      beforeAfter: await loadBookingBeforeAfterThumbsFor(
        aftercarePaymentDue.booking.id,
      ),
    }
  }

  return {
    displayName:
      (viewer?.firstName ?? '').trim() || // pii-plaintext-read-ok: the viewer's own first name, for their own greeting
      (viewer?.user?.email ?? '').trim() || // pii-plaintext-read-ok: the viewer's own email, the greeting's fallback
      'there',
    upcoming,
    upcomingCount,
    upcomingProRating,
    action,
    invites: liveInvites,
    waitlists: rankedWaitlists,
    favoritePros,
    favoriteServices,
    viralLive,
    viralPending,
  }
}

/**
 * How many peer entries one read will consider. The pro's own waitlist route
 * takes 500, so this matches the largest queue that surface can rank; past it,
 * the two screens could not agree anyway.
 */
const WAITLIST_PEER_CAP = 500

/**
 * Attaches each entry's FIFO rank within its (professional, service) queue.
 *
 * ONE extra query, not one per row: the strip takes up to 12 entries, and a
 * count each would put a dozen round-trips on every home render — the mistake
 * `resolvePrepForBookings` exists to avoid. Peers for every pair come back in a
 * single read and the ranks are counted in memory.
 *
 * Counts ACTIVE **and** NOTIFIED, because the pro's list does: sending an offer
 * moves an entry to NOTIFIED without giving up its place, so skipping those
 * would quietly promote everyone behind it.
 */
async function withQueuePositions(
  entries: Prisma.WaitlistEntryGetPayload<{
    select: typeof clientHomeWaitlistSelect
  }>[],
): Promise<ClientHomeWaitlistEntry[]> {
  if (entries.length === 0) return []

  const pairs = new Map<string, { professionalId: string; serviceId: string }>()
  for (const entry of entries) {
    const serviceId = entry.service?.id
    if (!serviceId) continue
    pairs.set(`${entry.professional.id}:${serviceId}`, {
      professionalId: entry.professional.id,
      serviceId,
    })
  }

  if (pairs.size === 0) {
    return entries.map((entry) => ({ ...entry, queuePosition: null }))
  }

  const peers = await prisma.waitlistEntry.findMany({
    where: {
      status: { in: [WaitlistStatus.ACTIVE, WaitlistStatus.NOTIFIED] },
      OR: Array.from(pairs.values()),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: WAITLIST_PEER_CAP,
    select: {
      id: true,
      professionalId: true,
      serviceId: true,
      createdAt: true,
    },
  })

  // A truncated read cannot rank anything: the rows it dropped are the ones
  // that would have come LAST, but we cannot prove none of them belong ahead of
  // an entry in another pair. Say nothing rather than say a number that is off.
  if (peers.length >= WAITLIST_PEER_CAP) {
    return entries.map((entry) => ({ ...entry, queuePosition: null }))
  }

  const queues = new Map<string, { id: string; createdAt: Date }[]>()
  for (const peer of peers) {
    const key = `${peer.professionalId}:${peer.serviceId}`
    const queue = queues.get(key)
    if (queue) queue.push(peer)
    else queues.set(key, [peer])
  }

  return entries.map((entry) => {
    const serviceId = entry.service?.id
    if (!serviceId) return { ...entry, queuePosition: null }

    // Already createdAt-then-id ascending from the query, so the index IS the
    // rank — the same derivation the pro's route makes from the same ordering.
    const queue = queues.get(`${entry.professional.id}:${serviceId}`) ?? []
    const index = queue.findIndex((peer) => peer.id === entry.id)
    return { ...entry, queuePosition: index >= 0 ? index + 1 : null }
  })
}