import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import { loadProReferralActivity } from '@/lib/referral/proReferralActivity'
import ProReferralActivitySection from './ProReferralActivitySection'
import ReferralRewardsClient from './ReferralRewardsClient'

export const dynamic = 'force-dynamic'

export default async function ProReferralRewardsPage() {
  const user = await getCurrentUser().catch(() => null)

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/referral-rewards')
  }

  const professionalId = user.professionalProfile.id
  const timeZone = user.professionalProfile.timeZone ?? null

  const [settings, referralActivity] = await Promise.all([
    prisma.professionalPaymentSettings.findUnique({
      where: { professionalId },
      select: {
        referralRewardEnabled: true,
        referralRewardTier: true,
        referralDiscountPercent: true,
        referralCreditAmount: true,
      },
    }),
    loadProReferralActivity({ professionalId }),
  ])

  const initial = {
    referralRewardEnabled: settings?.referralRewardEnabled ?? false,
    referralRewardTier: settings?.referralRewardTier ?? 'RECOGNITION' as const,
    referralDiscountPercent: settings?.referralDiscountPercent ?? null,
    referralCreditAmount: settings?.referralCreditAmount
      ? Number(settings.referralCreditAmount)
      : null,
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-8 px-4 py-8">
      <ReferralRewardsClient initial={initial} />
      <ProReferralActivitySection
        activity={referralActivity}
        timeZone={timeZone}
      />
    </main>
  )
}
