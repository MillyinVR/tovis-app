// Client-safe payment method *types* for a pro's public profile.
//
// This intentionally never exposes handles (Venmo @, Zelle / Apple Cash phone,
// PayPal) — those stay gated to the committed-booking checkout. It only reports
// which kinds of payment a pro accepts. Stripe card only counts when the
// connected account can actually charge (mirrors the checkout gate).
import type { Prisma } from '@prisma/client'

export const publicPaymentMethodsSelect = {
  acceptCash: true,
  acceptCardOnFile: true,
  acceptTapToPay: true,
  acceptVenmo: true,
  acceptZelle: true,
  acceptAppleCash: true,
  acceptPaypal: true,
  acceptApplePay: true,

  // Stripe card is gated on a usable connected account — never the raw flag.
  // charges+payouts enabled already implies a live connected account, so we
  // avoid reading the opaque stripeAccountId here.
  acceptStripeCard: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
} satisfies Prisma.ProfessionalPaymentSettingsSelect

export type PublicPaymentMethodsRow =
  Prisma.ProfessionalPaymentSettingsGetPayload<{
    select: typeof publicPaymentMethodsSelect
  }>

export type PublicAcceptedMethod = { key: string; label: string }

function canAcceptStripeCard(row: PublicPaymentMethodsRow): boolean {
  return Boolean(
    row.acceptStripeCard &&
      row.stripeChargesEnabled &&
      row.stripePayoutsEnabled,
  )
}

/**
 * Public, handle-free list of the payment types a pro accepts. Returns an empty
 * list when the pro has no saved payment settings (the caller renders nothing).
 */
export function listPublicAcceptedMethods(
  row: PublicPaymentMethodsRow | null,
): PublicAcceptedMethod[] {
  if (!row) return []

  const methods: PublicAcceptedMethod[] = []

  if (row.acceptCash) methods.push({ key: 'cash', label: 'Cash' })
  if (canAcceptStripeCard(row)) {
    methods.push({ key: 'stripe_card', label: 'Credit/debit card' })
  }
  if (row.acceptCardOnFile) {
    methods.push({ key: 'card_on_file', label: 'Card on file' })
  }
  if (row.acceptTapToPay) methods.push({ key: 'tap_to_pay', label: 'Tap to pay' })
  if (row.acceptVenmo) methods.push({ key: 'venmo', label: 'Venmo' })
  if (row.acceptZelle) methods.push({ key: 'zelle', label: 'Zelle' })
  if (row.acceptAppleCash) {
    methods.push({ key: 'apple_cash', label: 'Apple Cash' })
  }
  if (row.acceptPaypal) methods.push({ key: 'paypal', label: 'PayPal' })
  if (row.acceptApplePay) methods.push({ key: 'apple_pay', label: 'Apple Pay' })

  return methods
}
