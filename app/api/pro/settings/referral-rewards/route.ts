import { ReferralRewardTier } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const VALID_TIERS = new Set<string>(
  Object.values(ReferralRewardTier),
)

export async function PATCH(req: Request) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonFail(400, 'Invalid JSON.')
  }

  const update: Record<string, unknown> = {}

  if ('referralRewardEnabled' in body) {
    if (typeof body.referralRewardEnabled !== 'boolean') {
      return jsonFail(400, 'referralRewardEnabled must be a boolean.')
    }
    update.referralRewardEnabled = body.referralRewardEnabled
  }

  if ('referralRewardTier' in body) {
    if (
      typeof body.referralRewardTier !== 'string' ||
      !VALID_TIERS.has(body.referralRewardTier)
    ) {
      return jsonFail(400, 'Invalid referralRewardTier.')
    }
    update.referralRewardTier =
      body.referralRewardTier as ReferralRewardTier
  }

  if ('referralDiscountPercent' in body) {
    const v = body.referralDiscountPercent
    if (v !== null) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 100) {
        return jsonFail(400, 'referralDiscountPercent must be 1–100.')
      }
    }
    update.referralDiscountPercent = v
  }

  if ('referralCreditAmount' in body) {
    const v = body.referralCreditAmount
    if (v !== null) {
      if (typeof v !== 'number' || v <= 0) {
        return jsonFail(400, 'referralCreditAmount must be positive.')
      }
    }
    update.referralCreditAmount = v
  }

  if (Object.keys(update).length === 0) {
    return jsonFail(400, 'No fields to update.')
  }

  try {
    const settings = await prisma.professionalPaymentSettings.upsert({
      where: { professionalId: auth.professionalId },
      update,
      create: {
        professionalId: auth.professionalId,
        ...update,
      },
      select: {
        referralRewardEnabled: true,
        referralRewardTier: true,
        referralDiscountPercent: true,
        referralCreditAmount: true,
      },
    })

    return jsonOk({ settings }, 200)
  } catch (err) {
    console.error('PATCH /api/pro/settings/referral-rewards', err)
    return jsonFail(500, 'Failed to save referral reward settings.')
  }
}

export async function GET() {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  try {
    const settings = await prisma.professionalPaymentSettings.findUnique({
      where: { professionalId: auth.professionalId },
      select: {
        referralRewardEnabled: true,
        referralRewardTier: true,
        referralDiscountPercent: true,
        referralCreditAmount: true,
      },
    })

    return jsonOk(
      {
        settings: settings ?? {
          referralRewardEnabled: false,
          referralRewardTier: 'RECOGNITION',
          referralDiscountPercent: null,
          referralCreditAmount: null,
        },
      },
      200,
    )
  } catch (err) {
    console.error('GET /api/pro/settings/referral-rewards', err)
    return jsonFail(500, 'Failed to load referral reward settings.')
  }
}
