// lib/lastMinute/openingSelect.ts
//
// Prisma select for loading a LastMinuteOpening with everything needed to display it
// (services → offering/service, professional, location, tier plans).
//
// Its only consumer today is the single-opening claim page
// (app/(main)/offerings/[offeringId], via _data/loadOfferingDetail) and the native
// read that shares it, GET /api/v1/offerings/[id]. The header used to name a
// public openings list at app/api/openings as a second consumer; that route does
// not exist. The three other opening readers — pro/openings,
// client/saved-services/providers and createLastMinuteOpening — each declare
// their own local `openingSelect` rather than this one.

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
      // The fallback time zone the booking gate resolves against when the
      // location carries none — the read-time liveness check has to resolve the
      // same context the claim will.
      timeZone: true,
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

/**
 * The PRO-side select: same relations as `openingSelect`, plus the lifecycle
 * columns a pro manages an opening by (`launchAt`, `expiresAt`, `createdAt`,
 * `updatedAt`, per-tier `processedAt`/`cancelledAt`/`lastError`, recipient
 * count).
 *
 * It deliberately does NOT carry `openingSelect`'s two read filters —
 * `services.where.offering.isActive` and `tierPlans.where.cancelledAt: null`.
 * The pro is managing the row, so a deactivated offering link and a cancelled
 * tier plan are facts they need to SEE; the client-facing reader hides both.
 * That difference is the reason these are two selects and not one, and it was
 * verified against both call sites rather than assumed — do not "unify" them
 * without deciding what the pro's list should show.
 */
export const proOpeningSelect = {
  id: true,
  professionalId: true,
  locationType: true,
  locationId: true,
  timeZone: true,
  startAt: true,
  endAt: true,
  status: true,
  visibilityMode: true,
  launchAt: true,
  expiresAt: true,
  publicVisibleFrom: true,
  publicVisibleUntil: true,
  bookedAt: true,
  cancelledAt: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  location: {
    select: {
      id: true,
      type: true,
      name: true,
      city: true,
      state: true,
      formattedAddress: true,
      timeZone: true,
      lat: true,
      lng: true,
    },
  },
  services: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      openingId: true,
      serviceId: true,
      offeringId: true,
      sortOrder: true,
      createdAt: true,
      service: {
        select: {
          id: true,
          name: true,
          minPrice: true,
          defaultDurationMinutes: true,
          isAddOnEligible: true,
          addOnGroup: true,
        },
      },
      offering: {
        select: {
          id: true,
          title: true,
          offersInSalon: true,
          offersMobile: true,
          salonPriceStartingAt: true,
          salonDurationMinutes: true,
          mobilePriceStartingAt: true,
          mobileDurationMinutes: true,
        },
      },
    },
  },
  tierPlans: {
    orderBy: [{ scheduledFor: 'asc' }, { tier: 'asc' }],
    select: {
      id: true,
      openingId: true,
      tier: true,
      scheduledFor: true,
      processedAt: true,
      cancelledAt: true,
      lastError: true,
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
      createdAt: true,
      updatedAt: true,
    },
  },
  _count: {
    select: {
      recipients: true,
    },
  },
} satisfies Prisma.LastMinuteOpeningSelect

export type ProOpeningRow = Prisma.LastMinuteOpeningGetPayload<{
  select: typeof proOpeningSelect
}>
