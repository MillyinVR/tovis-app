// app/api/v1/client/priority-offer/route.ts
import { prisma } from '@/lib/prisma'
import { jsonOk, requireClient } from '@/app/api/_utils'
import { pickProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { professionalProfileHref } from '@/lib/profiles/profileHrefs'
import {
  LastMinuteOfferType,
  LastMinuteRecipientStatus,
  OpeningStatus,
  Prisma,
} from '@prisma/client'
import { pickRecipientTierPlan } from '@/lib/lastMinute/pickTierPlan'

export const dynamic = 'force-dynamic'

function incentiveLabel(plan: {
  offerType: LastMinuteOfferType
  percentOff: number | null
  amountOff: Prisma.Decimal | null
  freeAddOnService: { id: string; name: string } | null
}): string | null {
  if (plan.offerType === LastMinuteOfferType.PERCENT_OFF && plan.percentOff != null) {
    return `${plan.percentOff}% off`
  }
  if (plan.offerType === LastMinuteOfferType.AMOUNT_OFF && plan.amountOff) {
    return `$${plan.amountOff.toString()} off`
  }
  if (plan.offerType === LastMinuteOfferType.FREE_SERVICE) {
    return 'Free service'
  }
  if (plan.offerType === LastMinuteOfferType.FREE_ADD_ON) {
    return plan.freeAddOnService?.name || 'Free add-on'
  }
  return null
}

const offerSelect = {
  id: true,
  status: true,
  priorityExpiresAt: true,
  priorityOrder: true,
  notifiedTier: true,
  firstMatchedTier: true,
  opening: {
    select: {
      id: true,
      startAt: true,
      endAt: true,
      note: true,
      timeZone: true,
      locationType: true,
      professional: {
        select: {
          id: true,
          businessName: true,
          firstName: true,
          lastName: true,
          handle: true,
          nameDisplay: true,
          avatarUrl: true,
        },
      },
      services: {
        where: { offering: { is: { isActive: true } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          serviceId: true,
          offeringId: true,
          service: { select: { name: true } },
        },
      },
      tierPlans: {
        where: { cancelledAt: null },
        orderBy: [{ scheduledFor: 'asc' }, { tier: 'asc' }],
        select: {
          tier: true,
          offerType: true,
          percentOff: true,
          amountOff: true,
          freeAddOnServiceId: true,
          freeAddOnService: { select: { id: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.LastMinuteRecipientSelect

type OfferRow = Prisma.LastMinuteRecipientGetPayload<{ select: typeof offerSelect }>

function serviceSummary(services: OfferRow['opening']['services']): string {
  const names = Array.from(
    new Set(services.map((s) => s.service.name.trim()).filter((n) => n.length > 0)),
  )
  if (names.length === 0) return 'a service'
  if (names.length === 1) return names[0]!
  return `${names[0]} +${names.length - 1} more`
}

function buildClaimHref(opening: OfferRow['opening']): string {
  const offeringId = opening.services[0]?.offeringId
  if (!offeringId) return '/client'
  return `/offerings/${encodeURIComponent(offeringId)}?scheduledFor=${encodeURIComponent(
    opening.startAt.toISOString(),
  )}&source=DISCOVERY&openingId=${encodeURIComponent(opening.id)}&proTimeZone=${encodeURIComponent(
    opening.timeZone,
  )}`
}

export async function GET() {
  const auth = await requireClient()
  if (!auth.ok) return auth.res

  const now = new Date()

  const rows = await prisma.lastMinuteRecipient.findMany({
    where: {
      clientId: auth.clientId,
      priorityOrder: { not: null },
      status: {
        in: [
          LastMinuteRecipientStatus.PRIORITY_OFFERED,
          LastMinuteRecipientStatus.CLICKED,
        ],
      },
      bookedAt: null,
      cancelledAt: null,
      opening: {
        status: OpeningStatus.ACTIVE,
        bookedAt: null,
        cancelledAt: null,
        startAt: { gt: now },
      },
    },
    orderBy: [{ priorityExpiresAt: 'asc' }, { priorityOrder: 'asc' }],
    take: 50,
    select: offerSelect,
  })

  const offers = rows.map((row) => {
    const opening = row.opening
    const matchedTierPlan = pickRecipientTierPlan({
      notifiedTier: row.notifiedTier,
      firstMatchedTier: row.firstMatchedTier,
      tierPlans: opening.tierPlans,
    })

    const expiresAt = row.priorityExpiresAt ? row.priorityExpiresAt.toISOString() : null
    const expired = row.priorityExpiresAt ? row.priorityExpiresAt <= now : false
    // The first (primary) service row drives the claim — the same row
    // `buildClaimHref` reads the offering from. Exposing its ids as flat fields
    // (alongside the web-facing `claimHref`) lets a native client resolve the
    // offering on the pro's profile and open its booking flow without parsing the
    // route-shaped hrefs. The web UI ignores these; nothing else changes.
    const primaryService = opening.services[0] ?? null

    return {
      recipientId: row.id,
      status: row.status,
      expiresAt,
      expired,
      proName:
        pickProfessionalPublicDisplayName(opening.professional) ??
        opening.professional.handle ??
        'Your pro',
      proHref: professionalProfileHref(opening.professional.id),
      professionalId: opening.professional.id,
      avatarUrl: opening.professional.avatarUrl ?? null,
      serviceLabel: serviceSummary(opening.services),
      serviceId: primaryService?.serviceId ?? null,
      offeringId: primaryService?.offeringId ?? null,
      startAt: opening.startAt.toISOString(),
      endAt: opening.endAt ? opening.endAt.toISOString() : null,
      timeZone: opening.timeZone,
      locationType: opening.locationType,
      note: opening.note ?? null,
      incentiveLabel: matchedTierPlan ? incentiveLabel(matchedTierPlan) : null,
      claimHref: buildClaimHref(opening),
    }
  })

  return jsonOk({ offers }, 200)
}
