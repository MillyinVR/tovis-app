// app/client/(gated)/_components/clientHomeInvite.fixtures.ts
//
// Test fixture for a last-minute invite on client home. Typed as the real
// Prisma payload (never cast), so if the select gains a field this stops
// compiling instead of quietly modelling a shape the app no longer returns.

import {
  LastMinuteOfferType,
  LastMinuteRecipientStatus,
  LastMinuteTier,
  LastMinuteVisibilityMode,
  OpeningStatus,
  Prisma,
  ProfessionType,
  ProNameDisplay,
  ServiceLocationType,
} from '@prisma/client'

import type { ClientHomeLastMinuteInvite } from '../_data/getClientHomeData'

const CREATED_AT = new Date('2026-08-10T12:00:00.000Z')

/**
 * One invite. `startAt` and `timeZone` are the interesting inputs — the card
 * decides "today" / "tomorrow" from them, and that decision has to be made in
 * the opening's zone rather than the runtime's.
 */
export function lastMinuteInviteFixture(args: {
  startAt: Date
  timeZone: string
}): ClientHomeLastMinuteInvite {
  return {
    id: 'lmr_1',
    firstMatchedTier: LastMinuteTier.WAITLIST,
    notifiedTier: LastMinuteTier.WAITLIST,
    status: LastMinuteRecipientStatus.ENQUEUED,
    notifiedAt: CREATED_AT,
    openedAt: null,
    clickedAt: null,
    bookedAt: null,
    createdAt: CREATED_AT,

    opening: {
      id: 'opening_1',
      professionalId: 'pro_1',
      startAt: args.startAt,
      endAt: new Date(args.startAt.getTime() + 60 * 60 * 1000),
      note: null,
      status: OpeningStatus.ACTIVE,
      visibilityMode: LastMinuteVisibilityMode.TARGETED_ONLY,
      publicVisibleFrom: null,
      publicVisibleUntil: null,
      timeZone: args.timeZone,
      locationType: ServiceLocationType.SALON,
      locationId: 'loc_1',

      professional: {
        id: 'pro_1',
        businessName: 'Studio Vale',
        firstName: 'Ada',
        lastName: 'Vale',
        nameDisplay: ProNameDisplay.BUSINESS_NAME,
        handle: 'studiovale',
        avatarUrl: null,
        professionType: ProfessionType.HAIRSTYLIST,
        location: 'Brooklyn',
        timeZone: args.timeZone,
      },

      location: {
        id: 'loc_1',
        type: ServiceLocationType.SALON,
        timeZone: args.timeZone,
        city: 'Brooklyn',
        state: 'NY',
        formattedAddress: '1 Example Ave, Brooklyn, NY',
        lat: new Prisma.Decimal('40.6782'),
        lng: new Prisma.Decimal('-73.9442'),
      },

      services: [
        {
          id: 'los_1',
          openingId: 'opening_1',
          serviceId: 'svc_1',
          offeringId: 'off_1',
          sortOrder: 0,
          service: {
            id: 'svc_1',
            name: 'Cut & finish',
            minPrice: new Prisma.Decimal('120'),
            defaultDurationMinutes: 60,
          },
          offering: {
            id: 'off_1',
            title: null,
            salonPriceStartingAt: new Prisma.Decimal('180'),
            salonDurationMinutes: 60,
            mobilePriceStartingAt: null,
            mobileDurationMinutes: null,
            offersInSalon: true,
            offersMobile: false,
          },
        },
      ],

      tierPlans: [
        {
          id: 'plan_1',
          scheduledFor: CREATED_AT,
          tier: LastMinuteTier.WAITLIST,
          offerType: LastMinuteOfferType.PERCENT_OFF,
          percentOff: 20,
          amountOff: null,
          freeAddOnServiceId: null,
          freeAddOnService: null,
        },
      ],
    },
  }
}
