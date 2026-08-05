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
  ClientRelationshipLabel,
  DepositScope,
  LookPostStatus,
  ModerationStatus,
  ProClientInviteStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { resolveDiscoveryProvenance } from '@/lib/booking/discoveryProvenance'
import { deriveClientRelationshipLabel } from '@/lib/booking/relationshipLabel'
import {
  hasPriorRelationship,
  isNewDiscoveryClient,
  platformFeesEnabled,
} from '@/lib/booking/discoveryFee'
import {
  resolveDepositRequirement,
  type DepositRequirement,
} from '@/lib/booking/depositRequirement'
import type { DepositSettings } from '@/lib/booking/discoveryDepositPlan'
import { loadProClientPolicy } from '@/lib/proClientPolicy/load'
import { membershipEnforcementEnabled } from '@/lib/membership/enforcement'
import { resolveEffectiveEntitlements } from '@/lib/pro/entitlements'

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
  /**
   * NR/NNR/RR/RNR mark to SNAPSHOT onto the booking (K5). Derived here — from
   * the validated source axis and the same established-booking count the fee
   * uses — so the label and the fee can never disagree about whether a client
   * is "new". Stamped once by the write boundary, never re-derived at read time.
   */
  relationshipLabel: ClientRelationshipLabel
  /**
   * New-via-discovery client + deposit-enabled, Stripe-ready pro => the ONE-TIME
   * PLATFORM FEE applies. 🔴 No longer also the deposit gate: since K10-A the
   * deposit follows the pro's `depositScope` (see `depositRequired`), which can
   * be true for a returning client the platform never matched.
   */
  feeEligible: boolean
  /**
   * Whether this booking takes money up front, and why
   * (lib/booking/depositRequirement.ts). Under the default NEW_DISCOVERY_ONLY
   * with no prepay-required service, `required` equals `feeEligible`; under
   * ALL_NEW_CLIENTS / ALL_CLIENTS, or under K10's per-service prepay, it is
   * wider. `prepayScope` sizes the 100% term in the transaction.
   */
  depositRequirement: DepositRequirement
  depositSettings: DepositSettings
  /**
   * ENABLE_PLATFORM_FEES, resolved once here inside the trust boundary so the whole
   * finalize path agrees about whether this booking charges platform fees.
   */
  feesEnabled: boolean
  /**
   * Whether this pro's membership waives THEIR $5 fee. Never affects the client's
   * convenience fee — a pro's subscription cannot change what a client is billed.
   */
  proFeeWaived: boolean
  /**
   * The validated LookPost this booking was started from (remix attribution),
   * or null. Set ONLY when `lookPostId` resolved to a PUBLISHED + APPROVED look
   * owned by this pro — the same trust boundary that validates discovery
   * provenance. A `mediaId`-only booking carries null (not a LookPost).
   */
  sourceLookPostId: string | null
}>

export async function resolveDiscoveryFinalize(args: {
  clientId: string
  /** Authenticated client's user id (for NFC attribution); null for token flows. */
  clientUserId: string | null
  professionalId: string
  /**
   * The BASE offering this booking is for. K10 reads its `prepayScope` here,
   * inside the trust boundary, rather than trusting a value the route passed
   * down — the requirement decides how much money is charged.
   */
  offeringId: string
  lookPostId: string | null
  mediaId: string | null
  source: BookingSource
  aftercare: boolean
  now?: Date
}): Promise<FinalizeDiscoveryDirective> {
  const now = args.now ?? new Date()
  const feesEnabled = platformFeesEnabled()

  // Pro creation never routes through the client finalize endpoint.
  const baseDirective = (
    provenance: BookingDiscoveryProvenance,
    relationshipLabel: ClientRelationshipLabel,
    feeEligible: boolean,
    depositSettings: DepositSettings,
    sourceLookPostId: string | null = null,
    depositRequirement: DepositRequirement = {
      required: feeEligible,
      scopeRequired: feeEligible,
      prepayScope: null,
    },
    proFeeWaived = false,
  ): FinalizeDiscoveryDirective => ({
    provenance,
    relationshipLabel,
    feeEligible,
    depositRequirement,
    depositSettings,
    feesEnabled,
    proFeeWaived,
    sourceLookPostId,
  })

  const disabledSettings: DepositSettings = {
    depositEnabled: false,
    depositType: 'FLAT',
    depositFlatAmountCents: null,
    depositPercent: null,
  }

  // Aftercare short-circuits: it's a rebook of an existing relationship, never a fee.
  // The label is RR by definition (returning + rebooked this pro by name), so no
  // history count is needed before the early return.
  //
  // 🔴 And never a DEPOSIT either, even under depositScope ALL_CLIENTS (K10-A).
  // The aftercare rebook is a TOKEN flow: the deposit checkout route
  // (POST /api/v1/client/bookings/[id]/deposit/stripe-session) requires an
  // authenticated client, so a deposit stamped here would leave the booking
  // PENDING with no surface that can pay it — a hold nobody can clear
  // (reserving-a-slot-needs-a-surface). Widening this needs a deposit step in
  // the token flow first; logged as a follow-up, not silently half-shipped.
  //
  // 🔴 K10 does NOT change that. A prepay-required service rebooked through
  // aftercare still collects nothing up front, for the same reason: the token
  // flow has no authenticated client, so the prepay would be a bill with no
  // surface that can pay it, and the 24h release sweep would then cancel a
  // rebook the client asked for. Tracked as K10-A-2.
  if (args.aftercare || args.source === BookingSource.AFTERCARE) {
    return baseDirective(
      BookingDiscoveryProvenance.AFTERCARE,
      deriveClientRelationshipLabel({
        source: BookingSource.AFTERCARE,
        establishedBookingCount: 0,
        proCreated: false,
      }),
      false,
      disabledSettings,
    )
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
    subscription,
    offeringPrepay,
    clientPolicy,
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
        depositScope: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      },
    }),
    prisma.professionalSubscription.findUnique({
      where: { professionalId: args.professionalId },
      select: {
        planKey: true,
        status: true,
        compPlanKey: true,
        compUntil: true,
      },
    }),
    // K10: the per-service prepay requirement. Scoped to the pro as well as the
    // id — an offeringId that belongs to somebody else must not be able to
    // impose (or lift) a charge on this pro's booking.
    prisma.professionalServiceOffering.findFirst({
      where: { id: args.offeringId, professionalId: args.professionalId },
      select: { prepayScope: true },
    }),
    // K16: this pro's policy for THIS client. Joined into the same Promise.all
    // rather than added as a serial hop — the same reasoning K8 recorded for the
    // per-service swatch query, on a path whose known weakness is a fetch
    // waterfall. Indexed by the (professionalId, clientId) unique key.
    loadProClientPolicy({
      professionalId: args.professionalId,
      clientId: args.clientId,
    }),
  ])

  const provenance = resolveDiscoveryProvenance({
    proCreated: false,
    aftercare: false,
    arrivedViaProNfc,
    validLookPost: validLookPost.validProvenance,
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

  const relationshipSignals = {
    establishedBookingCount,
    acceptedInviteCount,
    threadCount,
    arrivedViaProNfc,
  }

  // The PLATFORM FEE gate — deliberately unchanged by depositScope.
  const feeEligible = isNewDiscoveryClient({
    provenance,
    proDepositEnabled: depositSettings.depositEnabled,
    proStripeReady,
    ...relationshipSignals,
  })

  // The DEPOSIT gate — the pro's own scope setting, read here for the first
  // time since it shipped (K10-A), plus K10's per-service prepay requirement.
  // Under the default NEW_DISCOVERY_ONLY with no prepay-required service this
  // resolves identically to `feeEligible`.
  const depositRequirement = resolveDepositRequirement({
    scope: paymentSettings?.depositScope ?? DepositScope.NEW_DISCOVERY_ONLY,
    proDepositEnabled: depositSettings.depositEnabled,
    proStripeReady,
    provenance,
    hasPriorRelationship: hasPriorRelationship(relationshipSignals),
    offeringPrepayScope: offeringPrepay?.prepayScope ?? null,
    clientPolicyRequiresDeposit: clientPolicy.requiresDeposit,
    clientPolicyPrepayScope: clientPolicy.prepayScope,
  })

  // Membership perk (Tori, 2026-08-04): a subscribed pro pays NO $5 pro fee —
  // members keep every dollar the platform brings them. 🔴 Waives the PRO's fee ONLY.
  // The client's convenience fee is untouched: a pro's subscription must never
  // change what their client is billed. The resolved verdict is stamped onto the
  // booking at finalize, so checkout (application fee), refunds and the
  // relationship-establishment queries all follow from the stored amounts.
  //
  // Needs BOTH switches: the fees must be live (there is nothing to waive
  // otherwise) and membership enforcement must be on.
  const proFeeWaived =
    feesEnabled &&
    membershipEnforcementEnabled() &&
    resolveEffectiveEntitlements(
      {
        planKey: subscription?.planKey ?? 'free',
        status: subscription?.status ?? null,
        compPlanKey: subscription?.compPlanKey ?? null,
        compUntil: subscription?.compUntil ?? null,
      },
      now,
    ).includes('pro_discovery_fee_waiver')

  return baseDirective(
    provenance,
    deriveClientRelationshipLabel({
      source: args.source,
      establishedBookingCount,
      proCreated: false,
    }),
    feeEligible,
    depositSettings,
    validLookPost.sourceLookPostId,
    depositRequirement,
    proFeeWaived,
  )
}

type ValidLookPostResult = {
  /** True when a valid LookPost OR a valid pro-owned media backs this booking. */
  validProvenance: boolean
  /** The validated LookPost id (remix attribution) — null for media-only. */
  sourceLookPostId: string | null
}

async function resolveValidLookPost(args: {
  professionalId: string
  lookPostId: string | null
  mediaId: string | null
}): Promise<ValidLookPostResult> {
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
      return { validProvenance: true, sourceLookPostId: args.lookPostId }
    }
  }

  if (args.mediaId) {
    const media = await prisma.mediaAsset.findUnique({
      where: { id: args.mediaId },
      select: { professionalId: true },
    })
    if (media && media.professionalId === args.professionalId) {
      return { validProvenance: true, sourceLookPostId: null }
    }
  }

  return { validProvenance: false, sourceLookPostId: null }
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
