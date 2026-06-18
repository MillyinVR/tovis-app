// lib/membership/subscription.ts
//
// Server helpers for a pro's membership row + their Stripe Billing customer.
//
// IMPORTANT object hygiene: the Billing customer id stored here is DISTINCT from the
// Connect account id on ProfessionalPaymentSettings. A pro is both a connected account
// (receives client money) and a Billing customer (pays the platform). Never conflate them.

import { Prisma, SubscriptionStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getStripe } from '@/lib/stripe/server'

export type ProSubscriptionRow = {
  id: string
  professionalId: string
  planKey: string
  status: SubscriptionStatus
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  trialEndsAt: Date | null
}

const SUBSCRIPTION_SELECT = {
  id: true,
  professionalId: true,
  planKey: true,
  status: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  trialEndsAt: true,
} satisfies Prisma.ProfessionalSubscriptionSelect

/** Read a pro's subscription row (null when they're on the implicit free plan). */
export async function getProSubscription(
  professionalId: string,
): Promise<ProSubscriptionRow | null> {
  return prisma.professionalSubscription.findUnique({
    where: { professionalId },
    select: SUBSCRIPTION_SELECT,
  })
}

/** Ensure a (default-free) subscription row exists for the pro and return it. */
export async function ensureProSubscription(
  professionalId: string,
): Promise<ProSubscriptionRow> {
  return prisma.professionalSubscription.upsert({
    where: { professionalId },
    create: { professionalId },
    update: {},
    select: SUBSCRIPTION_SELECT,
  })
}

/**
 * Return the pro's Stripe Billing customer id, creating the customer on first use.
 * Idempotent enough for our needs: the row's stripeCustomerId is the source of truth,
 * so a created customer is immediately persisted before checkout.
 */
export async function ensureBillingCustomer(args: {
  professionalId: string
  email?: string | null
}): Promise<string> {
  const sub = await ensureProSubscription(args.professionalId)
  if (sub.stripeCustomerId) return sub.stripeCustomerId

  const stripe = getStripe()
  const customer = await stripe.customers.create({
    email: args.email?.trim() || undefined,
    metadata: { professionalId: args.professionalId, kind: 'TOVIS_MEMBERSHIP' },
  })

  await prisma.professionalSubscription.update({
    where: { professionalId: args.professionalId },
    data: { stripeCustomerId: customer.id },
  })

  return customer.id
}
