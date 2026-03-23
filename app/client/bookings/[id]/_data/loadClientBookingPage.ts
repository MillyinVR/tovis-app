// app/client/bookings/[id]/_data/loadClientBookingPage.ts
import { notFound, redirect } from 'next/navigation'
import type { Prisma } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'

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
  sessionStep: true,
  scheduledFor: true,
  finishedAt: true,

  subtotalSnapshot: true,
  totalAmount: true,
  depositAmount: true,
  tipAmount: true,
  taxAmount: true,
  discountAmount: true,

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
      location: true,
      timeZone: true,
      user: {
        select: {
          email: true,
        },
      },
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
  publicToken: true,
  rebookMode: true,
  rebookedFor: true,
  rebookWindowStart: true,
  rebookWindowEnd: true,
  draftSavedAt: true,
  sentToClientAt: true,
  lastEditedAt: true,
  version: true,
  recommendedProducts: {
    take: 50,
    orderBy: { id: 'asc' },
    select: {
      id: true,
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
  mediaType: true,
  phase: true,
  createdAt: true,
  visibility: true,
  uploadedByRole: true,
  reviewId: true,
} satisfies Prisma.MediaAssetSelect

function isAuthedClientUser(user: CurrentUserResult | null): user is AuthedClientUser {
  return Boolean(
    user &&
      user.role === 'CLIENT' &&
      user.clientProfile &&
      typeof user.clientProfile.id === 'string' &&
      user.clientProfile.id.trim(),
  )
}

async function requireAuthedClientUser(bookingId: string): Promise<AuthedClientUser> {
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

  const aftercare = await prisma.aftercareSummary.findFirst({
    where: {
      bookingId: raw.id,
      sentToClientAt: {
        not: null,
      },
    },
    select: aftercareSummarySelect,
  })

  const existingReview = await prisma.review.findFirst({
    where: {
      bookingId: raw.id,
      clientId: user.clientProfile.id,
    },
    orderBy: { createdAt: 'desc' },
    select: reviewSelect,
  })

  const media = await prisma.mediaAsset.findMany({
    where: { bookingId: raw.id },
    orderBy: { createdAt: 'asc' },
    take: 80,
    select: bookingMediaSelect,
  })

  return {
    user,
    raw,
    aftercare,
    existingReview,
    media,
  }
}