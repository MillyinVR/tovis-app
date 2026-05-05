import { Prisma, StripeAccountStatus } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { getStripe } from '@/lib/stripe/server'

export const dynamic = 'force-dynamic'

const paymentSettingsSelect = {
  professionalId: true,
  collectPaymentAt: true,

  acceptCash: true,
  acceptCardOnFile: true,
  acceptTapToPay: true,
  acceptVenmo: true,
  acceptZelle: true,
  acceptAppleCash: true,
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

  tipsEnabled: true,
  allowCustomTip: true,
  tipSuggestions: true,

  venmoHandle: true,
  zelleHandle: true,
  appleCashHandle: true,
  paymentNote: true,

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProfessionalPaymentSettingsSelect

function jsonArrayFromStrings(values: string[]): Prisma.InputJsonValue {
  return values
}

function stripeAccountStatusFromAccount(args: {
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  disabledReason: string | null
  currentlyDueCount: number
}): StripeAccountStatus {
  if (args.chargesEnabled && args.payoutsEnabled) {
    return StripeAccountStatus.ENABLED
  }

  if (args.disabledReason || args.currentlyDueCount > 0) {
    return StripeAccountStatus.RESTRICTED
  }

  if (args.detailsSubmitted) {
    return StripeAccountStatus.DISABLED
  }

  return StripeAccountStatus.ONBOARDING_STARTED
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const settings = await prisma.professionalPaymentSettings.findUnique({
      where: { professionalId },
      select: paymentSettingsSelect,
    })

    if (!settings?.stripeAccountId) {
      return jsonOk(
        {
          ok: true,
          paymentSettings: settings,
          stripeAccount: {
            connected: false,
            id: null,
            chargesEnabled: false,
            payoutsEnabled: false,
            detailsSubmitted: false,
            status: StripeAccountStatus.NOT_STARTED,
            requirements: {
              currentlyDue: [],
              eventuallyDue: [],
              disabledReason: null,
            },
          },
        },
        200,
      )
    }

    const stripe = getStripe()
    const account = await stripe.accounts.retrieve(settings.stripeAccountId)

    const chargesEnabled = Boolean(account.charges_enabled)
    const payoutsEnabled = Boolean(account.payouts_enabled)
    const detailsSubmitted = Boolean(account.details_submitted)

    const currentlyDue = account.requirements?.currently_due ?? []
    const eventuallyDue = account.requirements?.eventually_due ?? []
    const disabledReason = account.requirements?.disabled_reason ?? null

    const stripeAccountStatus = stripeAccountStatusFromAccount({
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
      disabledReason,
      currentlyDueCount: currentlyDue.length,
    })

    const onboardingCompletedAt =
      stripeAccountStatus === StripeAccountStatus.ENABLED
        ? settings.stripeOnboardingCompletedAt ?? new Date()
        : settings.stripeOnboardingCompletedAt

    const updatedSettings = await prisma.professionalPaymentSettings.update({
      where: { professionalId },
      data: {
        stripeAccountStatus,
        stripeChargesEnabled: chargesEnabled,
        stripePayoutsEnabled: payoutsEnabled,
        stripeDetailsSubmitted: detailsSubmitted,
        stripeRequirementsCurrentlyDue: jsonArrayFromStrings(currentlyDue),
        stripeRequirementsEventuallyDue: jsonArrayFromStrings(eventuallyDue),
        stripeOnboardingCompletedAt: onboardingCompletedAt,
        stripeAccountUpdatedAt: new Date(),

        // Never allow card payments unless Stripe says the account is actually usable.
        acceptStripeCard: chargesEnabled && payoutsEnabled,
      },
      select: paymentSettingsSelect,
    })

    return jsonOk(
      {
        ok: true,
        paymentSettings: updatedSettings,
        stripeAccount: {
          connected: true,
          id: account.id,
          chargesEnabled,
          payoutsEnabled,
          detailsSubmitted,
          status: stripeAccountStatus,
          requirements: {
            currentlyDue,
            eventuallyDue,
            disabledReason,
          },
        },
      },
      200,
    )
  } catch (error: unknown) {
    console.error('GET /api/pro/payments/stripe/status error', error)

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return jsonFail(400, 'Database rejected the Stripe status update.', {
        code: error.code,
        detail: error.message,
      })
    }

    if (error instanceof Prisma.PrismaClientValidationError) {
      return jsonFail(400, 'Invalid Stripe status update.', {
        detail: error.message,
      })
    }

    return jsonFail(500, 'Failed to load Stripe account status.', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}