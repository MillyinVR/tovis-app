import { ReferralStatus } from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { prismaRead } from '@/lib/prisma'
import { professionalProfileHref } from '@/lib/profiles/profileHrefs'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireClient()
  if (!auth.ok) return auth.res

  try {
    const referrals = await prismaRead.referral.findMany({
      where: { referrerClientId: auth.clientId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        expiresAt: true,
        confirmedAt: true,
        convertedAt: true,
        rewardTier: true,
        rewardValue: true,
        rewardAppliedAt: true,
        createdAt: true,
        referredClient: {
          select: { firstName: true, avatarUrl: true },
        },
        professional: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    })

    const now = new Date()
    const entries = referrals.map((r) => ({
      id: r.id,
      status:
        r.status === ReferralStatus.PENDING && r.expiresAt <= now
          ? 'EXPIRED'
          : r.status,
      referredFirstName: r.referredClient?.firstName?.trim() || 'Someone',
      referredAvatarUrl: r.referredClient?.avatarUrl ?? null,
      proName: r.professional
        ? [r.professional.firstName, r.professional.lastName]
            .filter(Boolean)
            .join(' ')
        : null,
      proHref: r.professional
        ? professionalProfileHref(r.professional.id)
        : null,
      rewardTier: r.rewardTier,
      rewardValue: r.rewardValue ? Number(r.rewardValue) : null,
      rewardAppliedAt: r.rewardAppliedAt?.toISOString() ?? null,
      confirmedAt: r.confirmedAt?.toISOString() ?? null,
      convertedAt: r.convertedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }))

    return jsonOk({ referrals: entries }, 200)
  } catch (err) {
    console.error('GET /api/client/referrals', err)
    return jsonFail(500, 'Failed to load referrals.')
  }
}
