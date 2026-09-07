// lib/booking/categoryDeposit.ts
//
// P7a-5 — "what deposit does THIS category of this pro's work ask for?"
//
// The pro can set a deposit per service category (Tori, 2026-09-07). This file
// owns exactly one sentence: how a category row and the account-wide settings
// combine into the `DepositSettings` every existing money path already takes.
//
// 🔴 THE AMOUNT ONLY. Whether a booking owes a deposit at all is still
// `depositEnabled` + `depositScope` + K10's prepay + K16's per-client rule, all
// resolved by the ONE gate in lib/booking/depositRequirement.ts — which this
// slice deliberately does not touch. A category row is not a fourth reason to
// charge; it is a different number for a charge that was already going to
// happen.
//
// That narrowness is a decision, not an omission. The alternative — letting a
// category amount switch deposits ON the way `prepayScope` does — would mean a
// pro who typed "$25" into the colour row while their account switch was off
// starts taking money they never turned on. So the write route REFUSES to store
// an amount in that state instead (`describeCategoryDepositBlocker`), which is
// the same shape K16 already uses for the per-client deposit switch. Neither a
// silent no-op (the K10-A "registered policy with no call site" bug) nor a
// surprise charge.
//
// Pure: no DB access, no Stripe I/O, like its siblings discoveryDepositPlan.ts
// and prepay.ts. The caller owns the query.

import { DepositType, type Prisma } from '@prisma/client'

import { decimalToCents } from '@/lib/money'

import type { DepositRequirement } from '@/lib/booking/depositRequirement'
import type { DepositSettings } from '@/lib/booking/discoveryDepositPlan'

/**
 * The exact columns the overlay reads. Spread into any caller's select so the
 * preview and the charge cannot be given different inputs.
 */
export const CATEGORY_DEPOSIT_POLICY_SELECT = {
  bookingGate: true,
  depositType: true,
  depositFlatAmount: true,
  depositPercent: true,
} satisfies Prisma.ProCategoryBookingPolicySelect

export type CategoryDepositPolicyRow = Prisma.ProCategoryBookingPolicyGetPayload<{
  select: typeof CATEGORY_DEPOSIT_POLICY_SELECT
}>

/**
 * Whether this category row actually states an amount.
 *
 * A row can exist purely to hold `bookingGate` — a pro who wants "book after
 * prep" on colour but is happy with their usual deposit — so the presence of a
 * row is NOT the presence of a deposit override. The type column is the switch,
 * modelled the way `ProClientPolicy.prepayScope` is: one column encoding one
 * fact, never a boolean beside a nullable value that can disagree with it.
 */
export function categoryStatesDepositAmount(
  policy: Pick<CategoryDepositPolicyRow, 'depositType'> | null | undefined,
): boolean {
  return policy?.depositType != null
}

/**
 * The deposit settings in force for a booking in this category.
 *
 * `depositEnabled` and `depositScope` are carried through UNCHANGED — see the
 * file header. Only the type and the amount are replaced, and only when the
 * category states them.
 */
export function resolveEffectiveDepositSettings(args: {
  account: DepositSettings
  category: CategoryDepositPolicyRow | null | undefined
}): DepositSettings {
  const { account, category } = args
  if (!categoryStatesDepositAmount(category) || !category) return account

  // Narrowed by `categoryStatesDepositAmount`, but re-read rather than asserted:
  // a non-null check that lives in another function is not a type guard here,
  // and the repo does not permit an escape to pretend otherwise.
  const type = category.depositType
  if (type == null) return account

  return {
    depositEnabled: account.depositEnabled,
    depositType: type,
    depositFlatAmountCents:
      type === DepositType.FLAT ? decimalToCents(category.depositFlatAmount) : null,
    depositPercent: type === DepositType.PERCENT ? (category.depositPercent ?? null) : null,
  }
}

/**
 * Why this pro cannot set a deposit amount on a category right now, or null
 * when they can.
 *
 * Read by the write route, which refuses rather than storing a number that
 * would resolve to no charge on every booking — the same discipline
 * `describeDepositRequirementBlocker` applies to the per-client switch. The
 * message points at the setting that fixes it, because a refusal that does not
 * say what to do next is just a wall.
 */
export function describeCategoryDepositBlocker(args: {
  accountDepositEnabled: boolean
  proStripeReady: boolean
}): string | null {
  if (!args.accountDepositEnabled) {
    return 'Turn deposits on in your payment settings before setting a different amount for a category.'
  }
  if (!args.proStripeReady) {
    return 'Finish your Stripe payouts setup before setting a category deposit — a deposit nobody can pay would only strand the booking.'
  }
  return null
}

/**
 * What a client should be told is about to be charged, before she taps.
 *
 * Three shapes because there are three honest answers, and collapsing them
 * loses money:
 *
 *   * `PREPAY` — a prepay-required service takes 100% of the price, not a
 *     deposit. Describing that as "$25 deposit" understates the tap by the
 *     whole bill.
 *   * `FLAT` — the one case with a real dollar figure the pro actually set.
 *   * `PERCENT` — a percentage of a subtotal that does not exist yet (no
 *     location mode, no add-ons), so it travels as a PERCENTAGE. Rendering a
 *     dollar guess here would be a number the pro never promised, which is the
 *     same rule that keeps "From $X" out of bare figures.
 *
 * Null when nothing is owed up front — including, importantly, when the pro has
 * deposits configured but `resolveDepositRequirement` says this particular
 * booking does not owe one (not Stripe-ready, or a returning client under the
 * default NEW_DISCOVERY_ONLY scope). The disclosure and the charge are the same
 * decision asked once.
 */
export type UpfrontChargeDisclosure =
  | { kind: 'PREPAY' }
  | { kind: 'FLAT'; amountCents: number }
  | { kind: 'PERCENT'; percent: number }

export function describeUpfrontChargeDisclosure(args: {
  /** Straight from `resolveDepositRequirement` — never re-derived here. */
  requirement: DepositRequirement
  /** The settings after `resolveEffectiveDepositSettings`. */
  settings: DepositSettings
}): UpfrontChargeDisclosure | null {
  const { requirement, settings } = args
  if (!requirement.required) return null

  // Prepay wins the SENTENCE even when an ordinary deposit also applies: the
  // money terms take a max (lib/booking/prepay.ts), and the larger of the two
  // is the 100% term whenever it is in force on the base service price.
  if (requirement.prepayScope != null) return { kind: 'PREPAY' }

  if (!requirement.scopeRequired || !settings.depositEnabled) return null

  if (settings.depositType === DepositType.FLAT) {
    const cents = settings.depositFlatAmountCents ?? 0
    return cents > 0 ? { kind: 'FLAT', amountCents: cents } : null
  }

  const percent = settings.depositPercent ?? 0
  return percent > 0 ? { kind: 'PERCENT', percent: Math.min(percent, 100) } : null
}
