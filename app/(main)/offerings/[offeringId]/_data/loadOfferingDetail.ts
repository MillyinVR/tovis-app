// app/(main)/offerings/[offeringId]/_data/loadOfferingDetail.ts
//
// Single source of truth for the last-minute opening claim screen. Loads +
// validates the opening, resolves the incentive the SAME way finalize charges it
// (recipient tier if notified, else public), and computes the priced/display
// data. Used by BOTH the server-rendered claim page (app/(main)/offerings/
// [offeringId]/page.tsx) and the native read endpoint (app/api/v1/offerings/
// [id]) so the displayed price never drifts from what is charged.
import 'server-only'

import {
  LastMinuteOfferType,
  OpeningStatus,
  ServiceLocationType,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { openingSelect, type OpeningWithDetails } from '@/lib/lastMinute/openingSelect'
import {
  pickPublicTierPlan,
  pickRecipientTierPlan,
} from '@/lib/lastMinute/pickTierPlan'
import {
  mapOpeningServiceDtos,
  mapPublicIncentiveDto,
  type OpeningServiceDto,
  type PublicIncentiveDto,
} from '@/lib/lastMinute/openingDto'
import { checkStoredSlotsAreOpen } from '@/lib/booking/storedSlotLiveness'
import { resolveOpeningModeDurationMinutes } from '@/lib/lastMinute/openingDuration'
import { moneyToString } from '@/lib/money'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import {
  formatProfessionLabel,
  formatPublicProfileDisplayName,
} from '@/lib/profiles/publicProfileFormatting'

type ServiceRow = OpeningWithDetails['services'][number]
type TierPlanRow = OpeningWithDetails['tierPlans'][number]

export type LoadOfferingDetailArgs = {
  offeringId: string
  openingId: string | null
  scheduledForRaw: string | null
  clientId: string | null
}

export type OfferingDetailUnavailable = {
  claimable: false
}

export type OfferingDetailLoaded = {
  claimable: true
  offeringId: string
  openingId: string
  professionalId: string
  serviceId: string
  scheduledForIso: string
  locationId: string
  isMobile: boolean

  serviceName: string
  proName: string
  profession: string
  when: string
  place: string | null
  durationMin: number | null

  baseStr: string | null
  discountedStr: string | null
  incentiveLabel: string | null

  /** JSON-safe (Decimal -> string) services + incentive blocks for native clients. */
  services: OpeningServiceDto[]
  publicIncentive: PublicIncentiveDto | null

  /** Default client mobile address (only resolved for an authed mobile claim). */
  defaultAddressId: string | null
}

export type OfferingDetailResult =
  | OfferingDetailUnavailable
  | OfferingDetailLoaded

function minuteMs(date: Date): number {
  const d = new Date(date)
  d.setSeconds(0, 0)
  return d.getTime()
}

function resolveTierPlan(
  opening: OpeningWithDetails,
  recipient: { notifiedTier: TierPlanRow['tier'] | null; firstMatchedTier: TierPlanRow['tier'] } | null,
): TierPlanRow | null {
  return recipient
    ? pickRecipientTierPlan({
        notifiedTier: recipient.notifiedTier,
        firstMatchedTier: recipient.firstMatchedTier,
        tierPlans: opening.tierPlans,
      })
    : pickPublicTierPlan(
        { visibilityMode: opening.visibilityMode, tierPlans: opening.tierPlans },
        new Date(),
      )
}

export async function loadOfferingDetail(
  args: LoadOfferingDetailArgs,
): Promise<OfferingDetailResult> {
  const { offeringId, openingId, scheduledForRaw, clientId } = args

  const opening = openingId
    ? await prisma.lastMinuteOpening.findUnique({
        where: { id: openingId },
        select: openingSelect,
      })
    : null

  const serviceRow: ServiceRow | null =
    opening?.services.find((row) => row.offeringId === offeringId) ?? null
  const scheduledFor = scheduledForRaw ? new Date(scheduledForRaw) : null

  const claimable = Boolean(
    opening &&
      serviceRow &&
      opening.status === OpeningStatus.ACTIVE &&
      !opening.bookedAt &&
      !opening.cancelledAt &&
      scheduledFor &&
      !Number.isNaN(scheduledFor.getTime()) &&
      minuteMs(scheduledFor) === minuteMs(opening.startAt),
  )

  if (!opening || !serviceRow || !claimable) {
    return { claimable: false }
  }

  // Tori's rule (F15), and the place it is answered rather than merely obeyed.
  //
  // Every feed HIDES an opening whose slot has since been booked, blocked or
  // dropped out of the pro's hours — the rule says a dead time must not be
  // visible, and a card reading "2:00 PM — no longer available" still shows the
  // time. But a client who was PUSHED a notification deserves better than a
  // vanished card, and this page is exactly where that notification lands (the
  // notification, the home invite and the feed's "Grab it" all link here). So
  // the honest answer lives here: the page already renders "This opening is no
  // longer available", which names no time and offers a way onward.
  //
  // This is a SINGLE-service question, unlike the feeds: the client is claiming
  // one offering, so it is that offering's duration that has to fit, not the
  // opening's longest.
  const stillOpen = await checkStoredSlotsAreOpen({
    candidates: [
      {
        key: opening.id,
        professionalId: opening.professionalId,
        professionalTimeZone: opening.professional.timeZone ?? null,
        locationId: opening.locationId,
        locationType: opening.locationType,
        startUtc: opening.startAt,
        durationMinutes: resolveOpeningModeDurationMinutes(
          {
            salonDurationMinutes: serviceRow.offering.salonDurationMinutes,
            mobileDurationMinutes: serviceRow.offering.mobileDurationMinutes,
            defaultDurationMinutes: serviceRow.service.defaultDurationMinutes,
          },
          opening.locationType,
        ),
        // The claim runs through the client hold path — see
        // `openingLivenessCandidate` for what that decides.
        commitGate: 'CLIENT_HOLD',
        releasedHoldId: null,
      },
    ],
    viewerClientId: clientId,
  })

  if (stillOpen.get(opening.id)?.open !== true) {
    return { claimable: false }
  }

  const recipient = clientId
    ? await prisma.lastMinuteRecipient.findUnique({
        where: { openingId_clientId: { openingId: opening.id, clientId } },
        select: { notifiedTier: true, firstMatchedTier: true },
      })
    : null

  const tierPlan = resolveTierPlan(opening, recipient)

  const offering = serviceRow.offering
  const isMobile = opening.locationType === ServiceLocationType.MOBILE

  const baseStr =
    (isMobile
      ? moneyToString(offering.mobilePriceStartingAt)
      : moneyToString(offering.salonPriceStartingAt)) ??
    moneyToString(serviceRow.service.minPrice)
  const baseNum = baseStr ? Number(baseStr) : null

  let incentiveLabel: string | null = null
  let discountedStr: string | null = null
  if (tierPlan && baseNum != null && Number.isFinite(baseNum)) {
    if (
      tierPlan.offerType === LastMinuteOfferType.PERCENT_OFF &&
      tierPlan.percentOff
    ) {
      incentiveLabel = `${tierPlan.percentOff}% off`
      discountedStr = moneyToString(
        Math.max(0, baseNum * (1 - tierPlan.percentOff / 100)),
      )
    } else if (
      tierPlan.offerType === LastMinuteOfferType.AMOUNT_OFF &&
      tierPlan.amountOff
    ) {
      const amount = Number(tierPlan.amountOff.toString())
      if (Number.isFinite(amount) && amount > 0) {
        incentiveLabel = `$${moneyToString(amount) ?? amount} off`
        discountedStr = moneyToString(Math.max(0, baseNum - amount))
      }
    } else if (
      tierPlan.offerType === LastMinuteOfferType.FREE_SERVICE ||
      tierPlan.offerType === LastMinuteOfferType.FREE_ADD_ON
    ) {
      // Not applied as a price discount in v1 — show a neutral marker, never a
      // number we won't charge.
      incentiveLabel = 'Special offer'
    }
  }

  const serviceName = offering.title?.trim() || serviceRow.service.name
  const proName = formatPublicProfileDisplayName({
    businessName: opening.professional.businessName,
    fallback: 'Your pro',
  })
  const profession = formatProfessionLabel(opening.professional.professionType)
  const when = formatAppointmentWhen(opening.startAt, opening.timeZone)
  const place = isMobile
    ? 'Mobile'
    : [opening.location?.city, opening.location?.state]
        .filter(Boolean)
        .join(', ') || null
  const durationMin =
    (isMobile
      ? offering.mobileDurationMinutes
      : offering.salonDurationMinutes) ??
    serviceRow.service.defaultDurationMinutes

  let defaultAddressId: string | null = null
  if (clientId && isMobile) {
    const addr = await prisma.clientAddress.findFirst({
      where: { clientId, isDefault: true },
      select: { id: true },
    })
    defaultAddressId = addr?.id ?? null
  }

  return {
    claimable: true,
    offeringId,
    openingId: opening.id,
    professionalId: opening.professionalId,
    serviceId: serviceRow.serviceId,
    scheduledForIso: opening.startAt.toISOString(),
    locationId: opening.locationId,
    isMobile,

    serviceName,
    proName,
    profession,
    when,
    place,
    durationMin,

    baseStr,
    discountedStr,
    incentiveLabel,

    services: mapOpeningServiceDtos(opening.services),
    publicIncentive: mapPublicIncentiveDto(
      tierPlan
        ? {
            tier: tierPlan.tier,
            offerType: tierPlan.offerType,
            percentOff: tierPlan.percentOff,
            amountOff: tierPlan.amountOff,
            freeAddOnService: tierPlan.freeAddOnService,
          }
        : null,
    ),

    defaultAddressId,
  }
}
