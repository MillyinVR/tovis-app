import { NotificationEventKey, ReferralStatus } from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { createClientNotification } from '@/lib/notifications/clientNotifications'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'

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
        expiresAt: true,
        referrerClientId: true,
        referredClientId: true,
        referrerClient: { select: { firstName: true } },
      },
    })

    if (!referral) return jsonFail(404, 'Referral not found.')
    if (referral.referrerClientId !== auth.clientId) {
      return jsonFail(403, 'Not your referral.')
    }
    if (referral.status !== ReferralStatus.PENDING) {
      return jsonFail(409, 'Referral is no longer pending.')
    }
    if (referral.expiresAt <= new Date()) {
      await prisma.referral.update({
        where: { id },
        data: { status: ReferralStatus.EXPIRED },
      })
      return jsonFail(410, 'Referral has expired.')
    }

    await prisma.referral.update({
      where: { id },
      data: { status: ReferralStatus.CONFIRMED, confirmedAt: new Date() },
    })

    const referrerName =
      referral.referrerClient?.firstName?.trim() || 'A friend'

    await createClientNotification({
      clientId: referral.referredClientId,
      eventKey: NotificationEventKey.REFERRAL_CONFIRMED,
      title: `You were referred by ${referrerName}`,
      body: 'Welcome! Your referrer may earn a reward when you book.',
      href: '/looks',
      dedupeKey: `REFERRAL_CONFIRMED:${referral.id}`,
    }).catch(() => null)

    kickNotificationDrain()

    return jsonOk({ confirmed: true }, 200)
  } catch (err) {
    console.error('POST /api/v1/client/referrals/[id]/confirm', err)
    return jsonFail(500, 'Failed to confirm referral.')
  }
}
