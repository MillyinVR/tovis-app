// app/client/bookings/[id]/_data/loadClientBookingPage.ts
import { notFound, redirect } from 'next/navigation'
import type { Prisma } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import { renderMediaUrls } from '@/lib/media/renderUrls'
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

  totalDurationMinutes: true,
  bufferMinutes: true,

  clientVisibleOverrideNote: true,

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

  const media = await renderBookingMedia(rawMedia)

  const existingReview =
    rawReview != null
      ? {
          ...rawReview,
          mediaAssets: await renderReviewMedia(rawReview.mediaAssets),
        }
      : null

  return {
    user,
    raw,
    aftercare,
    existingReview,
    media,
    paymentSettings,
    rebookedNextBooking,
    checkoutProductItems: raw.checkoutProductItems,
  }
}