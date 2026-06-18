// lib/booking/discoveryDepositPlan.ts
//
// Pure money math for the new-client discovery deposit + one-time platform fee.
// Given a pro's deposit settings, the service price, and whether this booking is a
// fee-eligible new discovery client (see lib/booking/discoveryFee.ts), compute the
// deposit and fee to collect up front. No I/O; fully unit-testable.
//
// The deposit and fee are collected together in ONE Stripe PaymentIntent: the fee
// rides as the application_fee (Tovis keeps it) and the deposit settles to the pro.
// That combined charge must clear Stripe's minimum, so if deposit + fee is below the
// floor we collect nothing rather than create an un-processable sub-minimum charge.

import { DepositType } from '@prisma/client'

/** Stripe's minimum charge for USD, in cents. */
export const STRIPE_MIN_CHARGE_CENTS = 50

export type DepositSettings = Readonly<{
  depositEnabled: boolean
  depositType: DepositType
  /** Flat deposit in cents (when depositType === FLAT). */
  depositFlatAmountCents: number | null
  /** Percent of service price, 1–100 (when depositType === PERCENT). */
  depositPercent: number | null
}>

export type DiscoveryDepositPlan = Readonly<{
  /** Deposit to collect, in cents (settles to the pro, credits the final total). */
  depositCents: number
  /** One-time platform fee, in cents (kept by Tovis as the application fee). */
  discoveryFeeCents: number
  /** deposit + fee — the single up-front PaymentIntent amount. */
  totalUpfrontCents: number
}>

const EMPTY_PLAN: DiscoveryDepositPlan = {
  depositCents: 0,
  discoveryFeeCents: 0,
  totalUpfrontCents: 0,
}

/** The raw deposit a pro's settings call for on a service of this price (cents). */
export function computeDepositCents(args: {
  settings: DepositSettings
  servicePriceCents: number
}): number {
  const { settings, servicePriceCents } = args
  if (!settings.depositEnabled) return 0

  if (settings.depositType === DepositType.FLAT) {
    const flat = settings.depositFlatAmountCents ?? 0
    return Math.max(0, Math.round(flat))
  }

  // PERCENT
  const pct = settings.depositPercent ?? 0
  if (pct <= 0 || servicePriceCents <= 0) return 0
  return Math.max(0, Math.round((servicePriceCents * Math.min(pct, 100)) / 100))
}

/**
 * Full up-front plan for a booking. Returns an all-zero plan when the booking is
 * not a fee-eligible new discovery client, or when the combined deposit + fee can't
 * clear Stripe's minimum charge.
 */
export function computeDiscoveryDepositPlan(args: {
  settings: DepositSettings
  servicePriceCents: number
  isNewDiscoveryClient: boolean
  discoveryFeeCents: number
}): DiscoveryDepositPlan {
  if (!args.isNewDiscoveryClient) return EMPTY_PLAN

  const depositCents = computeDepositCents({
    settings: args.settings,
    servicePriceCents: args.servicePriceCents,
  })
  const discoveryFeeCents = Math.max(0, Math.round(args.discoveryFeeCents))
  const totalUpfrontCents = depositCents + discoveryFeeCents

  // One combined charge — if it can't clear the Stripe minimum, collect nothing.
  if (totalUpfrontCents < STRIPE_MIN_CHARGE_CENTS) return EMPTY_PLAN

  return { depositCents, discoveryFeeCents, totalUpfrontCents }
}

export type DepositRefundActorKind = 'client' | 'pro' | 'admin'

export type DepositRefundPlan = Readonly<{
  /** Deposit portion to return to the client (clawed back from the pro). */
  refundDepositCents: number
  /** Whether the one-time platform fee is also returned (triggers refund-reset). */
  refundFee: boolean
  /** Total to refund on the deposit PaymentIntent = deposit + (fee if refundFee). */
  refundAmountCents: number
}>

const NO_REFUND: DepositRefundPlan = {
  refundDepositCents: 0,
  refundFee: false,
  refundAmountCents: 0,
}

/**
 * How much of a paid discovery deposit + fee to return when a booking is cancelled.
 * Policy (locked 2026-06-17):
 *   - pro / admin cancel        -> refund deposit AND fee (not the client's fault).
 *   - client cancel, >=24h out  -> refund deposit, KEEP the fee (one-time match fee
 *                                  already earned). Booking is cancelled, but the
 *                                  kept fee keeps the pair "established" (no re-charge).
 *   - client cancel, <24h out   -> refund nothing (deposit forfeited, fee kept).
 * Only when the fee is refunded (pro/admin path) does the pair revert to "new".
 */
export function resolveDepositRefundPlan(args: {
  actorKind: DepositRefundActorKind
  depositCents: number
  feeCents: number
  /** Client cancelled at least the full-refund window before the appointment. */
  clientWithinFullRefundWindow: boolean
}): DepositRefundPlan {
  const depositCents = Math.max(0, Math.round(args.depositCents))
  const feeCents = Math.max(0, Math.round(args.feeCents))

  if (args.actorKind === 'pro' || args.actorKind === 'admin') {
    return {
      refundDepositCents: depositCents,
      refundFee: true,
      refundAmountCents: depositCents + feeCents,
    }
  }

  // client
  if (!args.clientWithinFullRefundWindow) return NO_REFUND

  return {
    refundDepositCents: depositCents,
    refundFee: false,
    refundAmountCents: depositCents,
  }
}
