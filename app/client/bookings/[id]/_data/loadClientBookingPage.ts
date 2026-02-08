// app/client/bookings/[id]/_data/loadClientBookingPage.ts
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

type AuthedClientUser = Awaited<ReturnType<typeof getCurrentUser>> & {
  role: 'CLIENT'
  clientProfile: { id: string }
}
 
export async function loadClientBookingPage(bookingId: string) {
  const userBase = await getCurrentUser().catch(() => null)

  if (!userBase || userBase.role !== 'CLIENT' || !userBase.clientProfile?.id) {
    redirect(`/login?from=${encodeURIComponent(`/client/bookings/${bookingId}`)}`)
  }

  const user = userBase as AuthedClientUser


  const raw = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      clientId: true,
      status: true,
      source: true,
      sessionStep: true,
      scheduledFor: true,
      finishedAt: true,

      subtotalSnapshot: true,
      totalDurationMinutes: true,
      bufferMinutes: true,

      locationType: true,
      locationId: true,
      locationTimeZone: true,
      locationAddressSnapshot: true,

      service: { select: { id: true, name: true } },

      professional: {
        select: {
          id: true,
          businessName: true,
          location: true,
          timeZone: true,
          user: { select: { email: true } },
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
          service: { select: { name: true } },
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
    },
  })

  if (!raw) notFound()
  if (raw.clientId !== user.clientProfile.id) redirect('/client/bookings')

  const aftercare = await prisma.aftercareSummary.findFirst({
    where: { bookingId: raw.id },
    select: {
      id: true,
      notes: true,
      publicToken: true,
      rebookMode: true,
      rebookedFor: true,
      rebookWindowStart: true,
      rebookWindowEnd: true,
      recommendations: {
        take: 50,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          note: true,
          externalName: true,
          externalUrl: true,
          product: { select: { id: true, name: true, brand: true, retailPrice: true } },
        },
      },
    },
  })

  const existingReview = await prisma.review.findFirst({
    where: { bookingId: raw.id, clientId: user.clientProfile.id },
    include: {
      mediaAssets: {
        select: {
          id: true,
          url: true,
          thumbUrl: true,
          mediaType: true,
          createdAt: true,
          isFeaturedInPortfolio: true,
          isEligibleForLooks: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const media = await prisma.mediaAsset.findMany({
  where: { bookingId: raw.id },
  orderBy: { createdAt: 'asc' },
  take: 80,
  select: {
    id: true,
    url: true,
    thumbUrl: true,
    mediaType: true,
    phase: true,
    createdAt: true,
    visibility: true,
    uploadedByRole: true,
    reviewId: true,
  },
})


  return { user, raw, aftercare, existingReview, media }
}
