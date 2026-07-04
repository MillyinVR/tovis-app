// app/pro/referral-rewards/ProReferralActivitySection.tsx
//
// Read-only "who referred whom / conversion state" viewer, rendered server-side
// beneath the reward settings on /pro/referral-rewards. Presentational only —
// it renders the DTO assembled by lib/referral/proReferralActivity.ts.
import { ReferralRewardTier, ReferralStatus } from '@prisma/client'

import type {
  ProReferralActivity,
  ProReferralActivityRow,
} from '@/lib/referral/proReferralActivity'
import { formatInTimeZone } from '@/lib/time'

type ProReferralActivitySectionProps = {
  activity: ProReferralActivity
  timeZone: string | null
}

function formatDate(value: Date, timeZone: string | null): string {
  return formatInTimeZone(value, timeZone ?? '', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function statusLabel(status: ReferralStatus): string {
  switch (status) {
    case ReferralStatus.REWARDED:
      return 'Rewarded'
    case ReferralStatus.CONVERTED:
      return 'Converted'
    default:
      return status.charAt(0) + status.slice(1).toLowerCase()
  }
}

function statusToneClass(status: ReferralStatus): string {
  switch (status) {
    case ReferralStatus.REWARDED:
      return 'border-toneSuccess/30 bg-toneSuccess/10 text-toneSuccess'
    case ReferralStatus.CONVERTED:
      return 'border-toneInfo/30 bg-toneInfo/10 text-toneInfo'
    default:
      return 'border-toneWarn/30 bg-toneWarn/10 text-toneWarn'
  }
}

function rewardLabel(row: ProReferralActivityRow): string {
  if (row.rewardTier === ReferralRewardTier.DISCOUNT && row.rewardValue != null) {
    return `${row.rewardValue}% off`
  }
  if (row.rewardTier === ReferralRewardTier.CREDIT && row.rewardValue != null) {
    return `$${row.rewardValue} credit`
  }
  if (row.rewardTier === ReferralRewardTier.RECOGNITION) {
    return 'Recognition'
  }
  return '—'
}

export default function ProReferralActivitySection({
  activity,
  timeZone,
}: ProReferralActivitySectionProps) {
  const { summary, rows } = activity

  return (
    <section className="space-y-4" aria-labelledby="referral-activity-title">
      <div>
        <h2
          id="referral-activity-title"
          className="text-lg font-semibold text-textPrimary"
        >
          Referral activity
        </h2>
        <p className="mt-1 text-sm text-textMuted">
          Referrals that turned into a booking with you. Use this to see who
          referred whom and settle any credit questions.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-bgSecondary p-5 text-sm text-textMuted">
          No referrals have converted into a booking with you yet. When a client
          you were referred to books, they&apos;ll show up here.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-white/10 bg-bgSecondary p-4">
              <p className="text-2xl font-semibold text-textPrimary">
                {summary.total}
              </p>
              <p className="text-xs text-textMuted">Referred bookings</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-bgSecondary p-4">
              <p className="text-2xl font-semibold text-textPrimary">
                {summary.rewarded}
              </p>
              <p className="text-xs text-textMuted">Rewards applied</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-bgSecondary p-4">
              <p className="text-2xl font-semibold text-textPrimary">
                ${summary.creditDollarsApplied}
              </p>
              <p className="text-xs text-textMuted">Credit given</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-bgSecondary">
            <ul className="divide-y divide-white/10">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-textPrimary">
                      <span className="font-medium">{row.referrerName}</span>
                      <span className="text-textMuted"> referred </span>
                      <span className="font-medium">{row.referredName}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-textMuted">
                      {row.convertedAt
                        ? `Booked ${formatDate(row.convertedAt, timeZone)}`
                        : `Created ${formatDate(row.createdAt, timeZone)}`}
                      {row.cardShortCode ? ` · Card ${row.cardShortCode}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-textMuted">
                      {rewardLabel(row)}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusToneClass(
                        row.status,
                      )}`}
                    >
                      {statusLabel(row.status)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  )
}
