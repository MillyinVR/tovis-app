// app/client/bookings/[id]/_data/loadProfessionalPaymentSettings.ts
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { normalizeClientVisiblePaymentSettings } from '@/lib/payments/clientPaymentOptions'

const professionalPaymentSettingsSelect = {
  collectPaymentAt: true,

  acceptCash: true,
  acceptCardOnFile: true,
  acceptTapToPay: true,
  acceptVenmo: true,
  acceptZelle: true,
  acceptAppleCash: true,
  acceptPaypal: true,
  acceptApplePay: true,

  // Stripe / hosted card checkout
  acceptStripeCard: true,
  stripeAccountId: true,
  stripeAccountStatus: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeDetailsSubmitted: true,

  tipsEnabled: true,
  allowCustomTip: true,
  tipSuggestions: true,

  venmoHandle: true,
  zelleHandle: true,
  appleCashHandle: true,
  paypalHandle: true,
  paymentNote: true,
} satisfies Prisma.ProfessionalPaymentSettingsSelect

export type ClientVisibleProfessionalPaymentSettings =
  Prisma.ProfessionalPaymentSettingsGetPayload<{
    select: typeof professionalPaymentSettingsSelect
  }>

export async function loadProfessionalPaymentSettings(args: {
  professionalId: string
}): Promise<ClientVisibleProfessionalPaymentSettings | null> {
  const professionalId = args.professionalId.trim()
  if (!professionalId) return null

  const settings = await prisma.professionalPaymentSettings.findUnique({
    where: { professionalId },
    select: professionalPaymentSettingsSelect,
  })

  if (!settings) return null

  // Gate Stripe to "actually chargeable" and trim the off-platform handles + note
  // to null when blank — shared with the native client-checkout payment options
  // so the two never drift.
  return normalizeClientVisiblePaymentSettings(settings)
}