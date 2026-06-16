// lib/lastMinute/openingSelect.ts
//
// Shared Prisma select for loading a LastMinuteOpening with everything needed to display it
// (services → offering/service, professional, location, tier plans). Used by the public
// openings list (app/api/openings) and the single-opening claim page
// (app/(main)/offerings/[offeringId]). One select so the two never drift.

import { Prisma } from '@prisma/client'

export const openingSelect = {
  id: true,
  professionalId: true,
  startAt: true,
  endAt: true,
  note: true,
  status: true,
  visibilityMode: true,
  publicVisibleFrom: true,
  publicVisibleUntil: true,
  bookedAt: true,
  cancelledAt: true,
  timeZone: true,
  locationType: true,
  locationId: true,

  location: {
    select: {
      id: true,
      city: true,
      state: true,
      formattedAddress: true,
      lat: true,
      lng: true,
      timeZone: true,
      type: true,
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

  professional: {
    select: {
      id: true,
      businessName: true,
      handle: true,
      avatarUrl: true,
      professionType: true,
      location: true,
      lastMinuteSettings: {
        select: {
          disableMon: true,
          disableTue: true,
          disableWed: true,
          disableThu: true,
          disableFri: true,
          disableSat: true,
          disableSun: true,
        },
      },
    },
  },
} satisfies Prisma.LastMinuteOpeningSelect

export type OpeningWithDetails = Prisma.LastMinuteOpeningGetPayload<{
  select: typeof openingSelect
}>
