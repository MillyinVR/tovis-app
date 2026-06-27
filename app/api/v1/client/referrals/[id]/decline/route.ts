import { ReferralStatus } from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_req: Request, ctx: RouteContext) {
  const auth = await requireClient()
  if (!auth.ok) return auth.res

  const { id } = await ctx.params

  try {
    const referral = await prisma.referral.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        referrerClientId: true,
      },
    })

    if (!referral) return jsonFail(404, 'Referral not found.')
    if (referral.referrerClientId !== auth.clientId) {
      return jsonFail(403, 'Not your referral.')
    }
    if (referral.status !== ReferralStatus.PENDING) {
      return jsonFail(409, 'Referral is no longer pending.')
    }

    await prisma.referral.update({
      where: { id },
      data: { status: ReferralStatus.DECLINED },
    })

    return jsonOk({ declined: true }, 200)
  } catch (err) {
    console.error('POST /api/v1/client/referrals/[id]/decline', err)
    return jsonFail(500, 'Failed to decline referral.')
  }
}
