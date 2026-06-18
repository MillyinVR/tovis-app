// lib/booking/resolveDiscoveryFinalize.ts
//
// Server-side resolution of a finalize request's discovery context — the TRUST
// BOUNDARY for the one-time platform fee. Everything here is derived from DB state,
// never from the client-supplied `source`. Produces:
//   - provenance: the validated BookingDiscoveryProvenance to stamp on the booking.
//   - feeEligible: whether this is a brand-new client found via discovery, for a
//     deposit-enabled, Stripe-ready pro (so the deposit + fee apply).
//   - depositSettings + discoveryFeeCents: inputs the finalize transaction uses to
//     compute the actual amounts from the service subtotal (see discoveryDepositPlan).
//
// The deposit MATH is deferred to the transaction (it needs the final subtotal); this
// resolver only decides eligibility and provenance.

import {
  BookingDiscoveryProvenance,
  BookingSource,
  BookingStatus,
  LookPostStatus,
  ModerationStatus,
  ProClientInviteStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { resolveDiscoveryProvenance } from '@/lib/booking/discoveryProvenance'
import {
  isNewDiscoveryClient,
  resolveDiscoveryFeeCents,
} from '@/lib/booking/discoveryFee'
import type { DepositSettings } from '@/lib/booking/discoveryDepositPlan'

// Discovery-view attribution event written when a client opens a pro from the feed
// / Discovery tab. Mirrors the NFC AttributionEvent pattern (lib/tapIntentConsume).
export const DISCOVERY_VIEW_EVENT_TYPE = 'DISCOVERY_VIEW'

// Only honor a discovery-view attribution recorded within this window before the
// booking, so a months-old browse doesn't silently trigger a fee.
const DISCOVERY_VIEW_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

const ESTABLISHED_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED,
]

export type FinalizeDiscoveryDirective = Readonly<{
  provenance: BookingDiscoveryProvenance
  /** New-via-discovery client + deposit-enabled, Stripe-ready pro => deposit + fee apply. */
  feeEligible: boolean
  depositSettings: DepositSettings
  discoveryFeeCents: number
}>

export async function resolveDiscoveryFinalize(args: {
  clientId: string
  /** Authenticated client's user id (for NFC attribution); null for token flows. */
  clientUserId: string | null
  professionalId: string
  lookPostId: string | null
  mediaId: string | null
  source: BookingSource
  aftercare: boolean
  now?: Date
}): Promise<FinalizeDiscoveryDirective> {
  const now = args.now ?? new Date()
  const feeCents = resolveDiscoveryFeeCents()

  // Pro creation never routes through the client finalize endpoint.
  const baseDirective = (
    provenance: BookingDiscoveryProvenance,
    feeEligible: boolean,
    depositSettings: DepositSettings,
  ): FinalizeDiscoveryDirective => ({
    provenance,
    feeEligible,
    depositSettings,
    discoveryFeeCents: feeCents,
  })

  const disabledSettings: DepositSettings = {
    depositEnabled: false,
    depositType: 'FLAT',
    depositFlatAmountCents: null,
    depositPercent: null,
  }

  // Aftercare short-circuits: it's a rebook of an existing relationship, never a fee.
  if (args.aftercare || args.source === BookingSource.AFTERCARE) {
    return baseDirective(BookingDiscoveryProvenance.AFTERCARE, false, disabledSettings)
  }

  const discoveryViewLookbackFrom = new Date(
    now.getTime() - DISCOVERY_VIEW_LOOKBACK_MS,
  )

  const [
    validLookPost,
    arrivedViaProNfc,
    discoveryViewKind,
    establishedBookingCount,
    acceptedInviteCount,
    threadCount,
    paymentSettings,
  ] = await Promise.all([
    resolveValidLookPost({
      professionalId: args.professionalId,
      lookPostId: args.lookPostId,
      mediaId: args.mediaId,
    }),
    resolveArrivedViaProNfc({
      professionalId: args.professionalId,
      clientUserId: args.clientUserId,
    }),
    resolveDiscoveryViewKind({
      clientId: args.clientId,
      professionalId: args.professionalId,
      since: discoveryViewLookbackFrom,
    }),
    prisma.booking.count({
      where: {
        clientId: args.clientId,
        professionalId: args.professionalId,
        OR: [
          // Any non-cancelled booking = an existing relationship.
          { status: { in: ESTABLISHED_BOOKING_STATUSES } },
          // A cancelled booking still establishes the pair IF its discovery fee was
          // captured and NOT refunded (the client paid to establish — forfeited or
          // deposit-only-refunded). Refund-reset: once the fee is refunded
          // (discoveryFeeRefundedAt set), this no longer matches, so the pair
          // reverts to "new" and the fee re-charges on the next discovery booking.
          {
            status: BookingStatus.CANCELLED,
            discoveryFeeAmount: { gt: 0 },
            depositPaidAt: { not: null },
            discoveryFeeRefundedAt: null,
          },
        ],
      },
    }),
    prisma.proClientInvite.count({
      where: {
        clientId: args.clientId,
        professionalId: args.professionalId,
        status: ProClientInviteStatus.ACCEPTED,
      },
    }),
    prisma.messageThread.count({
      where: {
        clientId: args.clientId,
        professionalId: args.professionalId,
      },
    }),
    prisma.professionalPaymentSettings.findUnique({
      where: { professionalId: args.professionalId },
      select: {
        depositEnabled: true,
        depositType: true,
        depositFlatAmount: true,
        depositPercent: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      },
    }),
  ])

  const provenance = resolveDiscoveryProvenance({
    proCreated: false,
    aftercare: false,
    arrivedViaProNfc,
    validLookPost,
    discoveryViewKind,
  })

  const depositSettings: DepositSettings = paymentSettings
    ? {
        depositEnabled: paymentSettings.depositEnabled,
        depositType: paymentSettings.depositType,
        depositFlatAmountCents:
          paymentSettings.depositFlatAmount == null
            ? null
            : Math.round(Number(paymentSettings.depositFlatAmount) * 100),
        depositPercent: paymentSettings.depositPercent ?? null,
      }
    : disabledSettings

  const proStripeReady = Boolean(
    paymentSettings?.stripeChargesEnabled &&
      paymentSettings?.stripePayoutsEnabled,
  )

  const feeEligible = isNewDiscoveryClient({
    provenance,
    proDepositEnabled: depositSettings.depositEnabled,
    proStripeReady,
    establishedBookingCount,
    acceptedInviteCount,
    threadCount,
    arrivedViaProNfc,
  })

  return baseDirective(provenance, feeEligible, depositSettings)
}

async function resolveValidLookPost(args: {
  professionalId: string
  lookPostId: string | null
  mediaId: string | null
}): Promise<boolean> {
  if (args.lookPostId) {
    const lookPost = await prisma.lookPost.findUnique({
      where: { id: args.lookPostId },
      select: { professionalId: true, status: true, moderationStatus: true },
    })
    if (
      lookPost &&
      lookPost.professionalId === args.professionalId &&
      lookPost.status === LookPostStatus.PUBLISHED &&
      lookPost.moderationStatus === ModerationStatus.APPROVED
    ) {
      return true
    }
  }

  if (args.mediaId) {
    const media = await prisma.mediaAsset.findUnique({
      where: { id: args.mediaId },
      select: { professionalId: true },
    })
    if (media && media.professionalId === args.professionalId) return true
  }

  return false
}

async function resolveArrivedViaProNfc(args: {
  professionalId: string
  clientUserId: string | null
}): Promise<boolean> {
  if (!args.clientUserId) return false

  const event = await prisma.attributionEvent.findFirst({
    where: {
      actorUserId: args.clientUserId,
      card: { professionalId: args.professionalId },
    },
    select: { id: true },
  })

  return Boolean(event)
}

async function resolveDiscoveryViewKind(args: {
  clientId: string
  professionalId: string
  since: Date
}): Promise<'LOOKS_FEED' | 'DISCOVERY_SEARCH' | null> {
  const event = await prisma.attributionEvent.findFirst({
    where: {
      eventType: DISCOVERY_VIEW_EVENT_TYPE,
      createdAt: { gte: args.since },
      // metaJson holds { clientId, professionalId, kind }. Filter on the JSON path.
      metaJson: {
        path: ['professionalId'],
        equals: args.professionalId,
      },
      creditedUserId: null,
    },
    orderBy: { createdAt: 'desc' },
    select: { metaJson: true },
  })

  if (!event || event.metaJson == null || typeof event.metaJson !== 'object') {
    return null
  }

  const meta = event.metaJson as Record<string, unknown>
  if (meta.clientId !== args.clientId) return null
  if (meta.kind === 'LOOKS_FEED') return 'LOOKS_FEED'
  if (meta.kind === 'DISCOVERY_SEARCH') return 'DISCOVERY_SEARCH'
  return null
}
