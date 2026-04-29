// app/client/_data/getClientHomeData.ts
import {
  BookingCheckoutStatus,
  BookingStatus,
  ConsultationApprovalStatus,
  LastMinuteRecipientStatus,
  OpeningStatus,
  Prisma,
  SessionStep,
  WaitlistStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'

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
        handle: true,
        avatarUrl: true,
        professionType: true,
        location: true,
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
}>

export type ClientHomeFavoritePro = Prisma.ProfessionalFavoriteGetPayload<{
  select: typeof clientHomeFavoriteProSelect
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
    }
  | null

export type ClientHomeData = {
  upcoming: ClientHomeBooking | null
  action: ClientHomeAction
  invites: ClientHomeLastMinuteInvite[]
  waitlists: ClientHomeWaitlistEntry[]
  favoritePros: ClientHomeFavoritePro[]
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
    upcoming,
    pendingConsultation,
    aftercarePaymentDue,
    invites,
    waitlists,
    favoritePros,
  ] = await Promise.all([
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
  ])

  const action: ClientHomeAction = pendingConsultation
    ? {
        kind: 'PENDING_CONSULTATION',
        booking: pendingConsultation,
      }
    : aftercarePaymentDue
      ? {
          kind: 'AFTERCARE_PAYMENT_DUE',
          aftercare: aftercarePaymentDue,
          booking: aftercarePaymentDue.booking,
        }
      : null

  return {
    upcoming,
    action,
    invites,
    waitlists,
    favoritePros,
  }
}