// lib/membership/syncSubscription.ts
//
// Sync a ProfessionalSubscription row from a Stripe Billing subscription object,
// driven by customer.subscription.* webhooks. Runs inside the webhook transaction
// (tx-scoped, like the Connect apply*InTransaction handlers).

import { Prisma, SubscriptionStatus } from '@prisma/client'

import { configuredPriceIds } from '@/lib/membership/plans'
import { resolveEntitlements } from '@/lib/pro/entitlements'

export type StripeSubscriptionLike = {
  id: string
  status: string
  customer: string | { id?: string } | null
  cancel_at_period_end?: boolean | null
  current_period_end?: number | null
  trial_end?: number | null
  metadata?: Record<string, string> | null
  items?: { data?: Array<{ price?: { id?: string | null } | null }> } | null
}

/** Map Stripe's subscription status to our coarser enum. */
export function mapStripeSubscriptionStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'active':
      return SubscriptionStatus.ACTIVE
    case 'trialing':
      return SubscriptionStatus.TRIALING
    case 'past_due':
    case 'unpaid':
      return SubscriptionStatus.PAST_DUE
    case 'canceled':
    case 'incomplete_expired':
      return SubscriptionStatus.CANCELED
    default:
      // incomplete | paused | anything unknown
      return SubscriptionStatus.INCOMPLETE
  }
}

function customerId(sub: StripeSubscriptionLike): string | null {
  if (typeof sub.customer === 'string') return sub.customer
  if (sub.customer && typeof sub.customer === 'object') return sub.customer.id ?? null
  return null
}

function unixToDate(seconds: number | null | undefined): Date | null {
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? new Date(seconds * 1000)
    : null
}

/** Resolve the plan key: prefer metadata, else infer from the subscription's price. */
function resolvePlanKey(sub: StripeSubscriptionLike): string | null {
  const metaPlan = sub.metadata?.planKey
  if (metaPlan === 'pro' || metaPlan === 'studio' || metaPlan === 'free') {
    return metaPlan
  }

  const priceId = sub.items?.data?.[0]?.price?.id
  if (priceId) {
    const matched = configuredPriceIds().find((p) => p.priceId === priceId)
    if (matched) return matched.planKey
  }
  return null
}

export type SubscriptionSyncResult = { handled: boolean; deleted?: boolean }

/**
 * Upsert the pro's subscription from a Stripe subscription. Matches by
 * stripeSubscriptionId, then stripeCustomerId, then metadata.professionalId. On a
 * deletion event the caller passes deleted=true so we mark CANCELED.
 */
export async function applyStripeSubscriptionInTransaction(
  tx: Prisma.TransactionClient,
  sub: StripeSubscriptionLike,
  opts?: { deleted?: boolean },
): Promise<SubscriptionSyncResult> {
  const cust = customerId(sub)
  const professionalId = sub.metadata?.professionalId ?? null

  const existing = await tx.professionalSubscription.findFirst({
    where: {
      OR: [
        { stripeSubscriptionId: sub.id },
        ...(cust ? [{ stripeCustomerId: cust }] : []),
        ...(professionalId ? [{ professionalId }] : []),
      ],
    },
    select: { id: true, professionalId: true, planKey: true },
  })

  if (!existing) return { handled: false }

  const status = opts?.deleted
    ? SubscriptionStatus.CANCELED
    : mapStripeSubscriptionStatus(sub.status)

  // Keep the last known paid plan key on lapse so re-activation restores the tier;
  // entitlements already collapse to free whenever status isn't ACTIVE/TRIALING.
  const planKey = resolvePlanKey(sub) ?? existing.planKey

  await tx.professionalSubscription.update({
    where: { id: existing.id },
    data: {
      planKey,
      status,
      stripeSubscriptionId: sub.id,
      ...(cust ? { stripeCustomerId: cust } : {}),
      currentPeriodEnd: unixToDate(sub.current_period_end),
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      trialEndsAt: unixToDate(sub.trial_end),
    },
  })

  // Backfill the legacy ProfessionalProfile.isPremium (custom-handle gate) from the
  // entitlement so every existing reader reflects membership without per-site changes.
  // The column is the transition surface; entitlements are the source of truth.
  const grantsCustomHandle = resolveEntitlements({ planKey, status }).includes(
    'custom_handle',
  )
  await tx.professionalProfile.update({
    where: { id: existing.professionalId },
    data: {
      isPremium: grantsCustomHandle,
      // When the handle goes live, drop the reservation timer; when membership lapses,
      // restart it so a now-unpaid handle gets the full grace window before release.
      handleReservedAt: grantsCustomHandle ? null : new Date(),
    },
  })

  return { handled: true, deleted: Boolean(opts?.deleted) }
}
