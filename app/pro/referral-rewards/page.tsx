import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import ReferralRewardsClient from './ReferralRewardsClient'

export const dynamic = 'force-dynamic'

export default async function ProReferralRewardsPage() {
  const user = await getCurrentUser().catch(() => null)

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/referral-rewards')
  }

  const professionalId = user.professionalProfile.id

  const settings = await prisma.professionalPaymentSettings.findUnique({
    where: { professionalId },
    select: {
      referralRewardEnabled: true,
      referralRewardTier: true,
      referralDiscountPercent: true,
      referralCreditAmount: true,
    },
  })

  const initial = {
    referralRewardEnabled: settings?.referralRewardEnabled ?? false,
    referralRewardTier: settings?.referralRewardTier ?? 'RECOGNITION' as const,
    referralDiscountPercent: settings?.referralDiscountPercent ?? null,
    referralCreditAmount: settings?.referralCreditAmount
      ? Number(settings.referralCreditAmount)
      : null,
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <ReferralRewardsClient initial={initial} />
    </main>
  )
}
