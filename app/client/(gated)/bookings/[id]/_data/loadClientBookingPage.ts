// app/client/bookings/[id]/_data/loadClientBookingPage.ts
import { notFound, redirect } from 'next/navigation'
import type { Prisma } from '@prisma/client'
import type { BoardVisibility } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { CLIENT_CONFIRMATION_SELECT } from '@/lib/booking/clientConfirmation'
import { deriveDepositCredit } from '@/lib/booking/depositCredit'
import { getClientCreditBalanceCents } from '@/lib/credit/clientCredit'
import { isPrepWritableStatus, resolvePrepForBooking } from '@/lib/booking/prep'
import {
  BOARD_SHARE_TILE_COUNT,
  sharedBoardIdsForBooking,
} from '@/lib/boards/bookingShare'
import { loadProfessionalPaymentSettings } from './loadProfessionalPaymentSettings'

type CurrentUserResult = Awaited<ReturnType<typeof getCurrentUser>>

type AuthedClientUser = NonNullable<CurrentUserResult> & {
  role: 'CLIENT'
  clientProfile: { id: string }
}

const bookingPageBookingSelect = {
  id: true,
  clientId: true,
  status: true,
  source: true,
  // Rebook-chain link (buildClientBookingDTO surfaces it as rebookOfBookingId) —
  // part of the canonical ClientBookingRow shape.
  rebookOfBookingId: true,
  sessionStep: true,
  scheduledFor: true,
  finishedAt: true,

  // Media-use consent (B3b) — drives the client's "Photos & sharing" toggle on
  // the aftercare detail. buildClientBookingDTO reads this into mediaUseConsent.
  mediaUseConsentAt: true,

  // The no-show/late-cancel fee terms the client agreed to at booking (M15) —
  // buildClientBookingDTO formats this into `cancellationPolicy` for the detail.
  cancellationPolicySnapshot: true,

  // K11's confirmation state (K13) — buildClientBookingDTO derives the badge,
  // and its presence is what puts the "Can you make it?" answer on this page.
  ...CLIENT_CONFIRMATION_SELECT,

  subtotalSnapshot: true,
  serviceSubtotalSnapshot: true,
  productSubtotalSnapshot: true,
  totalAmount: true,
  depositAmount: true,
  depositStatus: true,
  discoveryFeeAmount: true,
  tipAmount: true,
  taxAmount: true,
  discountAmount: true,
  checkoutStatus: true,
  selectedPaymentMethod: true,
  paymentAuthorizedAt: true,
  paymentCollectedAt: true,
  // Refund/dispute truth so the client cards can't show "paid" after the money
  // moved back or the charge was disputed (M11 display-truth).
  stripePaymentStatus: true,
  stripeAmountTotal: true,
  stripeAmountRefunded: true,
  depositDisputedAt: true,
  // Sizes the deposit CREDIT against this bill (K10-A): a partially-refunded
  // deposit credits only the net still held, so the client is quoted what they
  // actually owe rather than the whole total.
  depositRefundedCents: true,

  totalDurationMinutes: true,
  bufferMinutes: true,

  clientVisibleOverrideNote: true,

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

  // Needed to resolve the prep checklist: an offering's own rows replace the
  // pro's default list for bookings of that service.
  offeringId: true,

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

  checkoutProductItems: {
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      recommendationId: true,
      productId: true,
      quantity: true,
      unitPrice: true,
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
} satisfies Prisma.BookingSelect

const aftercareSummarySelect = {
  id: true,
  notes: true,
  // The pro's own labelled blocks. The LABEL is their text, never an enum —
  // "Wash" for a colourist, "Cuticle oil" for a nail tech.
  careSections: {
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    select: { id: true, label: true, body: true },
  },
  rebookMode: true,
  rebookedFor: true,
  rebookWindowStart: true,
  rebookWindowEnd: true,
  rebookDeclinedAt: true,
  featuredBeforeAssetId: true,
  featuredAfterAssetId: true,
  draftSavedAt: true,
  sentToClientAt: true,
  lastEditedAt: true,
  version: true,
  recommendedProducts: {
    take: 50,
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
} satisfies Prisma.AftercareSummarySelect

const reviewSelect = {
  id: true,
  rating: true,
  headline: true,
  body: true,
  bookingId: true,
  clientId: true,
  createdAt: true,
  mediaAssets: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      url: true,
      thumbUrl: true,
      storageBucket: true,
      storagePath: true,
      thumbBucket: true,
      thumbPath: true,
      mediaType: true,
      createdAt: true,
      isFeaturedInPortfolio: true,
      isEligibleForLooks: true,
    },
  },
} satisfies Prisma.ReviewSelect

const bookingMediaSelect = {
  id: true,
  url: true,
  thumbUrl: true,
  storageBucket: true,
  storagePath: true,
  thumbBucket: true,
  thumbPath: true,
  mediaType: true,
  phase: true,
  createdAt: true,
  visibility: true,
  uploadedByRole: true,
  reviewId: true,
} satisfies Prisma.MediaAssetSelect

type RawBookingMedia = Prisma.MediaAssetGetPayload<{
  select: typeof bookingMediaSelect
}>

type RawReviewMedia = Prisma.ReviewGetPayload<{
  select: typeof reviewSelect
}>['mediaAssets'][number]

export type RenderableBookingMedia = Omit<
  RawBookingMedia,
  'storageBucket' | 'storagePath' | 'thumbBucket' | 'thumbPath' | 'url' | 'thumbUrl'
> & {
  url: string | null
  thumbUrl: string | null
}

export type RenderableReviewMedia = Omit<
  RawReviewMedia,
  'storageBucket' | 'storagePath' | 'thumbBucket' | 'thumbPath' | 'url' | 'thumbUrl'
> & {
  url: string | null
  thumbUrl: string | null
}

async function renderBookingMedia(
  rows: RawBookingMedia[],
): Promise<RenderableBookingMedia[]> {
  return Promise.all(
    rows.map(async (row) => {
      const { renderUrl, renderThumbUrl } = await renderMediaUrls(row)
      const {
        storageBucket: _storageBucket,
        storagePath: _storagePath,
        thumbBucket: _thumbBucket,
        thumbPath: _thumbPath,
        url: _url,
        thumbUrl: _thumbUrl,
        ...rest
      } = row
      void _storageBucket
      void _storagePath
      void _thumbBucket
      void _thumbPath
      void _url
      void _thumbUrl

      return {
        ...rest,
        url: renderUrl,
        thumbUrl: renderThumbUrl,
      }
    }),
  )
}

async function renderReviewMedia(
  rows: RawReviewMedia[],
): Promise<RenderableReviewMedia[]> {
  return Promise.all(
    rows.map(async (row) => {
      const { renderUrl, renderThumbUrl } = await renderMediaUrls(row)
      const {
        storageBucket: _storageBucket,
        storagePath: _storagePath,
        thumbBucket: _thumbBucket,
        thumbPath: _thumbPath,
        url: _url,
        thumbUrl: _thumbUrl,
        ...rest
      } = row
      void _storageBucket
      void _storagePath
      void _thumbBucket
      void _thumbPath
      void _url
      void _thumbUrl

      return {
        ...rest,
        url: renderUrl,
        thumbUrl: renderThumbUrl,
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

async function requireAuthedClientUser(
  bookingId: string,
): Promise<AuthedClientUser> {
  const user = await getCurrentUser().catch(() => null)

  if (!isAuthedClientUser(user)) {
    redirect(
      `/login?from=${encodeURIComponent(`/client/bookings/${bookingId}`)}`,
    )
  }

  return user
}


const clientBoardSelect = {
  id: true,
  name: true,
  visibility: true,
  _count: { select: { items: true } },
  items: {
    orderBy: { createdAt: 'desc' },
    take: BOARD_SHARE_TILE_COUNT,
    select: {
      lookPost: {
        select: { primaryMediaAsset: { select: { thumbUrl: true, url: true } } },
      },
    },
  },
} satisfies Prisma.BoardSelect

type AppointmentPrepBundle = {
  prep: Awaited<ReturnType<typeof resolvePrepForBooking>>
  checkedItemIds: string[]
  sharedBoardIds: string[]
  boards: {
    id: string
    name: string
    visibility: BoardVisibility
    itemCount: number
    tileImageUrls: string[]
  }[]
}

/** What the page gets for a booking that can no longer be prepared for. */
const EMPTY_PREP_BUNDLE: AppointmentPrepBundle = {
  prep: { items: [], source: 'NONE', note: null },
  checkedItemIds: [],
  sharedBoardIds: [],
  boards: [],
}

async function loadAppointmentPrep(
  bookingId: string,
  professionalId: string,
  offeringId: string | null,
  clientProfileId: string,
): Promise<AppointmentPrepBundle> {
  const [prep, checks, sharedBoardIds, boards] = await Promise.all([
    resolvePrepForBooking(prisma, { professionalId, offeringId }),
    prisma.bookingPrepCheck.findMany({
      where: { bookingId },
      select: { prepItemId: true },
    }),
    sharedBoardIdsForBooking(prisma, bookingId),
    prisma.board.findMany({
      where: { clientId: clientProfileId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: clientBoardSelect,
    }),
  ])

  return {
    prep,
    checkedItemIds: checks.map((row) => row.prepItemId),
    sharedBoardIds,
    boards: boards.map((board) => ({
      id: board.id,
      name: board.name,
      visibility: board.visibility,
      itemCount: board._count.items,
      tileImageUrls: board.items
        .map(
          (item) =>
            item.lookPost?.primaryMediaAsset?.thumbUrl ??
            item.lookPost?.primaryMediaAsset?.url ??
            null,
        )
        .filter((url): url is string => typeof url === 'string' && url.length > 0),
    })),
  }
}

export async function loadClientBookingPage(bookingId: string) {
  const user = await requireAuthedClientUser(bookingId)

  const raw = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: bookingPageBookingSelect,
  })

  if (!raw) notFound()

  if (raw.clientId !== user.clientProfile.id) {
    redirect('/client/bookings')
  }

  const [aftercare, rawReview, rawMedia, paymentSettings, rebookedNextBooking] =
    await Promise.all([
      prisma.aftercareSummary.findFirst({
        where: {
          bookingId: raw.id,
          sentToClientAt: {
            not: null,
          },
        },
        select: aftercareSummarySelect,
      }),

      prisma.review.findFirst({
        where: {
          bookingId: raw.id,
          clientId: user.clientProfile.id,
        },
        orderBy: { createdAt: 'desc' },
        select: reviewSelect,
      }),

      prisma.mediaAsset.findMany({
        where: { bookingId: raw.id },
        orderBy: { createdAt: 'asc' },
        take: 80,
        select: bookingMediaSelect,
      }),

      loadProfessionalPaymentSettings({
        professionalId: raw.professional.id,
      }),

      // A confirmed/proposed-next-appointment rebook created from this booking's
      // aftercare (source = AFTERCARE, rebookOfBookingId = this booking). Lets the
      // aftercare summary show a "confirmed" state instead of re-offering Confirm.
      prisma.booking.findFirst({
        where: {
          rebookOfBookingId: raw.id,
          clientId: user.clientProfile.id,
        },
        orderBy: { scheduledFor: 'desc' },
        select: { id: true, status: true, scheduledFor: true },
      }),
    ])

  // Appointment prep — the pro's checklist, their note, the client's ticks, and
  // the boards already handed over.
  //
  // Skipped entirely once the appointment can no longer be prepared for. This
  // is ~6 queries (one with a nested media read), and the page renders none of
  // it for a COMPLETED or CANCELLED booking — which is most of what a client
  // opens. `isPrepWritableStatus` is the SAME predicate the page gates its
  // render on and the write path re-checks, so the three cannot drift.
  const prepApplies = isPrepWritableStatus(raw.status)

  const prepBundle = prepApplies
    ? await loadAppointmentPrep(raw.id, raw.professional.id, raw.offeringId ?? null, user.clientProfile.id)
    : EMPTY_PREP_BUNDLE

  const media = await renderBookingMedia(rawMedia)

  const existingReview =
    rawReview != null
      ? {
          ...rawReview,
          mediaAssets: await renderReviewMedia(rawReview.mediaAssets),
        }
      : null

  // The deposit already paid, as a credit against this bill. Derived HERE, from
  // the same helper the write boundary charges from, so the amount the client is
  // quoted (and the amount pre-filled into a Venmo/Zelle hand-off) cannot drift
  // from the amount the server actually collects.
  const depositCredit = deriveDepositCredit(raw)

  // The client's spendable platform credit, discounting any reservation THIS
  // booking's own checkout is already holding — otherwise re-opening a checkout
  // that has credit applied would offer the client a balance their own pending
  // reservation had already taken off it (see getClientCreditBalanceCents).
  const creatorCreditBalanceCents = await getClientCreditBalanceCents(
    prisma,
    raw.clientId,
    { excludeBookingId: raw.id },
  )

  return {
    user,
    creatorCreditBalanceCents,
    raw,
    aftercare,
    existingReview,
    media,
    paymentSettings,
    rebookedNextBooking,
    depositCredit,
    checkoutProductItems: raw.checkoutProductItems,
    prep: {
      items: prepBundle.prep.items,
      source: prepBundle.prep.source,
      note: prepBundle.prep.note,
      checkedItemIds: prepBundle.checkedItemIds,
    },
    boards: {
      sharedBoardIds: prepBundle.sharedBoardIds,
      mine: prepBundle.boards,
    },
  }
}