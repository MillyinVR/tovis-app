import { Prisma, StripeAccountStatus } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { getStripe } from '@/lib/stripe/server'

export const dynamic = 'force-dynamic'

const paymentSettingsSelect = {
  professionalId: true,
  acceptStripeCard: true,
  stripeAccountId: true,
  stripeAccountStatus: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeDetailsSubmitted: true,
  stripeRequirementsCurrentlyDue: true,
  stripeRequirementsEventuallyDue: true,
  stripeOnboardingStartedAt: true,
  stripeOnboardingCompletedAt: true,
  stripeAccountUpdatedAt: true,
  updatedAt: true,
} satisfies Prisma.ProfessionalPaymentSettingsSelect

function stripeAccountStatusFromAccount(args: {
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  currentlyDueCount: number
}): StripeAccountStatus {
  if (args.chargesEnabled && args.payoutsEnabled) {
    return StripeAccountStatus.ENABLED
  }

  if (args.detailsSubmitted && args.currentlyDueCount > 0) {
    return StripeAccountStatus.RESTRICTED
  }

  if (args.detailsSubmitted) {
    return StripeAccountStatus.DISABLED
  }

  return StripeAccountStatus.ONBOARDING_STARTED
}

function jsonArrayFromStrings(values: string[]): Prisma.InputJsonValue {
  return values
}

function getUserEmail(user: { email?: string | null }): string | undefined {
  const email = typeof user.email === 'string' ? user.email.trim() : ''
  return email ? email : undefined
}

export async function POST() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const existingSettings =
      await prisma.professionalPaymentSettings.findUnique({
        where: { professionalId },
        select: {
          ...paymentSettingsSelect,
          collectPaymentAt: true,
          acceptCash: true,
          acceptCardOnFile: true,
          acceptTapToPay: true,
          acceptVenmo: true,
          acceptZelle: true,
          acceptAppleCash: true,
          tipsEnabled: true,
          allowCustomTip: true,
          tipSuggestions: true,
          venmoHandle: true,
          zelleHandle: true,
          appleCashHandle: true,
          paymentNote: true,
        } satisfies Prisma.ProfessionalPaymentSettingsSelect,
      })

    if (existingSettings?.stripeAccountId) {
      return jsonOk(
        {
          ok: true,
          paymentSettings: existingSettings,
          stripeAccount: {
            id: existingSettings.stripeAccountId,
            existing: true,
          },
        },
        200,
      )
    }

    const stripe = getStripe()

    const account = await stripe.accounts.create({
      type: 'express',
      email: getUserEmail(auth.user),
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        professionalId,
        userId: auth.user.id,
      },
    })

    const chargesEnabled = Boolean(account.charges_enabled)
    const payoutsEnabled = Boolean(account.payouts_enabled)
    const detailsSubmitted = Boolean(account.details_submitted)
    const currentlyDue = account.requirements?.currently_due ?? []
    const eventuallyDue = account.requirements?.eventually_due ?? []

    const stripeAccountStatus = stripeAccountStatusFromAccount({
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
      currentlyDueCount: currentlyDue.length,
    })

    const updatedSettings = await prisma.professionalPaymentSettings.upsert({
      where: { professionalId },
      create: {
        professionalId,
        stripeAccountId: account.id,
        stripeAccountStatus,
        stripeChargesEnabled: chargesEnabled,
        stripePayoutsEnabled: payoutsEnabled,
        stripeDetailsSubmitted: detailsSubmitted,
        stripeRequirementsCurrentlyDue: jsonArrayFromStrings(currentlyDue),
        stripeRequirementsEventuallyDue: jsonArrayFromStrings(eventuallyDue),
        stripeOnboardingStartedAt: new Date(),
        stripeAccountUpdatedAt: new Date(),
      },
      update: {
        stripeAccountId: account.id,
        stripeAccountStatus,
        stripeChargesEnabled: chargesEnabled,
        stripePayoutsEnabled: payoutsEnabled,
        stripeDetailsSubmitted: detailsSubmitted,
        stripeRequirementsCurrentlyDue: jsonArrayFromStrings(currentlyDue),
        stripeRequirementsEventuallyDue: jsonArrayFromStrings(eventuallyDue),
        stripeOnboardingStartedAt:
          existingSettings?.stripeOnboardingStartedAt ?? new Date(),
        stripeAccountUpdatedAt: new Date(),
        acceptStripeCard: chargesEnabled && payoutsEnabled,
      },
      select: paymentSettingsSelect,
    })

    return jsonOk(
      {
        ok: true,
        paymentSettings: updatedSettings,
        stripeAccount: {
          id: account.id,
          existing: false,
        },
      },
      201,
    )
  } catch (error: unknown) {
    console.error('POST /api/pro/payments/stripe/connect-account error', error)

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return jsonFail(400, 'Database rejected the Stripe account update.', {
        code: error.code,
        detail: error.message,
      })
    }

    if (error instanceof Prisma.PrismaClientValidationError) {
      return jsonFail(400, 'Invalid Stripe payment settings update.', {
        detail: error.message,
      })
    }

    return jsonFail(500, 'Failed to create Stripe connected account.', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}