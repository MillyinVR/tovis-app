import { Prisma, StripeAccountStatus } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { getStripe, mustGetEnv } from '@/lib/stripe/server'

export const dynamic = 'force-dynamic'

const paymentSettingsSelect = {
  professionalId: true,
  acceptStripeCard: true,
  stripeAccountId: true,
  stripeAccountStatus: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeDetailsSubmitted: true,
  stripeOnboardingStartedAt: true,
  stripeOnboardingCompletedAt: true,
  stripeAccountUpdatedAt: true,
  updatedAt: true,
} satisfies Prisma.ProfessionalPaymentSettingsSelect

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function buildDefaultUrl(path: string): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    process.env.VERCEL_URL

  if (!appUrl) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL, APP_URL, or VERCEL_URL is required to create Stripe onboarding links.',
    )
  }

  const normalizedAppUrl = appUrl.startsWith('http')
    ? appUrl
    : `https://${appUrl}`

  return `${normalizeBaseUrl(normalizedAppUrl)}${path}`
}

function getRefreshUrl(): string {
  return (
    process.env.STRIPE_CONNECT_REFRESH_URL ??
    buildDefaultUrl('/pro/profile/payments?stripe=refresh')
  )
}

function getReturnUrl(): string {
  return (
    process.env.STRIPE_CONNECT_RETURN_URL ??
    buildDefaultUrl('/pro/profile/payments?stripe=return')
  )
}

export async function POST() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const settings = await prisma.professionalPaymentSettings.findUnique({
      where: { professionalId },
      select: paymentSettingsSelect,
    })

    if (!settings?.stripeAccountId) {
      return jsonFail(
        400,
        'Create a Stripe connected account before starting onboarding.',
        {
          code: 'STRIPE_ACCOUNT_REQUIRED',
        },
      )
    }

    if (
      settings.stripeAccountStatus === StripeAccountStatus.ENABLED &&
      settings.stripeChargesEnabled &&
      settings.stripePayoutsEnabled
    ) {
      return jsonOk(
        {
          ok: true,
          paymentSettings: settings,
          onboarding: {
            alreadyComplete: true,
            url: null,
          },
        },
        200,
      )
    }

    const stripe = getStripe()

    const accountLink = await stripe.accountLinks.create({
      account: settings.stripeAccountId,
      refresh_url: getRefreshUrl(),
      return_url: getReturnUrl(),
      type: 'account_onboarding',
    })

    const updatedSettings = await prisma.professionalPaymentSettings.update({
      where: { professionalId },
      data: {
        stripeAccountStatus: StripeAccountStatus.ONBOARDING_STARTED,
        stripeOnboardingStartedAt:
          settings.stripeOnboardingStartedAt ?? new Date(),
        stripeAccountUpdatedAt: new Date(),
      },
      select: paymentSettingsSelect,
    })

    return jsonOk(
      {
        ok: true,
        paymentSettings: updatedSettings,
        onboarding: {
          alreadyComplete: false,
          url: accountLink.url,
          expiresAt: accountLink.expires_at
            ? new Date(accountLink.expires_at * 1000).toISOString()
            : null,
        },
      },
      200,
    )
  } catch (error: unknown) {
    console.error('POST /api/pro/payments/stripe/onboarding-link error', error)

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return jsonFail(400, 'Database rejected the Stripe onboarding update.', {
        code: error.code,
        detail: error.message,
      })
    }

    if (error instanceof Prisma.PrismaClientValidationError) {
      return jsonFail(400, 'Invalid Stripe onboarding update.', {
        detail: error.message,
      })
    }

    return jsonFail(500, 'Failed to create Stripe onboarding link.', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}