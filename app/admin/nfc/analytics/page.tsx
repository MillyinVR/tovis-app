// app/admin/nfc/analytics/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import { getNfcAnalytics } from '@/lib/nfc/nfcAnalytics'
import { formatShortCode } from '@/lib/nfcShortCode'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login')
  if (user.role !== 'ADMIN') redirect('/forbidden')
  return user
}

function StatCard(props: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-surfaceGlass/10 bg-bgSecondary p-5 shadow-sm">
      <div className="text-xs font-medium text-textSecondary">{props.label}</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight text-textPrimary">
        {props.value.toLocaleString()}
      </div>
      {props.hint ? (
        <div className="mt-1 text-[11px] text-textSecondary">{props.hint}</div>
      ) : null}
    </div>
  )
}

export default async function AdminNfcAnalyticsPage() {
  await requireAdmin()

  const { summary, topCards } = await getNfcAnalytics({ topN: 25 })

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-8 flex flex-col gap-2">
        <div className="text-xs">
          <Link href="/admin/nfc" className="font-medium text-accentPrimary hover:underline">
            ← Back to NFC cards
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">NFC tap analytics</h1>
        <p className="text-sm text-textSecondary">
          The card funnel from physical tap to a booking-producing referral. Taps and signups come
          from tap attribution events; conversions are referrals that produced a booking.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Taps" value={summary.taps} hint="Real human taps (bots excluded)" />
        <StatCard label="Signups claimed" value={summary.signups} hint="Unclaimed cards claimed" />
        <StatCard
          label="Referrals created"
          value={summary.referralsCreated}
          hint="Attributed to a card"
        />
        <StatCard
          label="Conversions"
          value={summary.referralsConverted}
          hint="Referrals that produced a booking"
        />
      </section>

      <section className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Taps on claimed cards"
          value={summary.existingCardTaps}
          hint="Already-claimed cards"
        />
        <StatCard
          label="Referrals confirmed"
          value={summary.referralsConfirmed}
          hint="Linked by the referrer"
        />
        <StatCard label="Claim races lost" value={summary.raceLost} hint="Concurrent claim" />
        <StatCard
          label="Tenant mismatches"
          value={summary.tenantMismatch}
          hint="White-label home-tenant guard"
        />
      </section>

      <section className="mt-10 rounded-2xl border border-surfaceGlass/10 bg-bgSecondary p-5 shadow-sm">
        <h2 className="text-base font-semibold">Top cards by taps</h2>
        <p className="text-sm text-textSecondary">Most-tapped cards (up to 25).</p>

        <div className="mt-4 overflow-x-auto rounded-xl border border-surfaceGlass/10">
          <table className="w-full min-w-180 border-collapse text-sm">
            <thead className="bg-bgPrimary text-left">
              <tr>
                <th className="px-3 py-3 font-semibold text-textSecondary">Short code</th>
                <th className="px-3 py-3 font-semibold text-textSecondary">Type</th>
                <th className="px-3 py-3 font-semibold text-textSecondary">Active</th>
                <th className="px-3 py-3 font-semibold text-textSecondary">Taps</th>
                <th className="px-3 py-3 font-semibold text-textSecondary">Signups</th>
                <th className="px-3 py-3 font-semibold text-textSecondary">Referrals</th>
              </tr>
            </thead>
            <tbody>
              {topCards.map((card) => (
                <tr key={card.cardId} className="border-t border-surfaceGlass/10">
                  <td className="px-3 py-3">
                    <div className="font-mono text-xs text-textPrimary">
                      {formatShortCode(card.shortCode)}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-textSecondary">{card.cardId}</div>
                  </td>
                  <td className="px-3 py-3 text-textPrimary">{card.type}</td>
                  <td className="px-3 py-3 text-textPrimary">{card.isActive ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-3 text-textPrimary">{card.taps.toLocaleString()}</td>
                  <td className="px-3 py-3 text-textPrimary">{card.signups.toLocaleString()}</td>
                  <td className="px-3 py-3 text-textPrimary">
                    {card.referralCount.toLocaleString()}
                  </td>
                </tr>
              ))}

              {topCards.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-sm text-textSecondary" colSpan={6}>
                    No taps recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
