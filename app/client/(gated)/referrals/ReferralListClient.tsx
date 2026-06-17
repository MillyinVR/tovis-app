'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { safeJson } from '@/lib/http'

type Referral = {
  id: string
  status: string
  referredFirstName: string
  referredAvatarUrl: string | null
  proName: string | null
  rewardTier: string | null
  rewardValue: number | null
  rewardAppliedAt: string | null
  confirmedAt: string | null
  convertedAt: string | null
  expiresAt: string
  createdAt: string
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  CONVERTED: 'Reward earned',
  REWARDED: 'Rewarded',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-500/20 text-yellow-300',
  CONFIRMED: 'bg-blue-500/20 text-blue-300',
  CONVERTED: 'bg-green-500/20 text-green-300',
  REWARDED: 'bg-accentPrimary/20 text-accentPrimary',
  DECLINED: 'bg-white/10 text-textMuted',
  EXPIRED: 'bg-white/10 text-textMuted',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function rewardDescription(r: Referral): string | null {
  if (!r.rewardTier) return null
  if (r.rewardTier === 'RECOGNITION') return 'Thank-you recognition'
  if (r.rewardTier === 'DISCOUNT' && r.rewardValue)
    return `${r.rewardValue}% off next booking`
  if (r.rewardTier === 'CREDIT' && r.rewardValue)
    return `$${r.rewardValue} off next booking`
  return null
}

export default function ReferralListClient() {
  const params = useSearchParams()
  const confirmId = params.get('confirm')

  const [referrals, setReferrals] = useState<Referral[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/client/referrals')
      const data = await safeJson(res)
      if (res.ok && data && typeof data === 'object' && 'referrals' in data) {
        setReferrals((data as { referrals: Referral[] }).referrals)
      }
    } catch {
      setErr('Failed to load referrals.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAction(id: string, action: 'confirm' | 'decline') {
    setBusy(id)
    setErr(null)
    try {
      const res = await fetch(`/api/client/referrals/${id}/${action}`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await safeJson(res)
        throw new Error(
          (data && typeof data === 'object' && 'error' in data
            ? (data as { error: string }).error
            : null) ?? `Failed to ${action}.`,
        )
      }
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : `Failed to ${action}.`)
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-textMuted">
        Loading referrals…
      </div>
    )
  }

  const pendingFirst = [...referrals].sort((a, b) => {
    if (a.status === 'PENDING' && b.status !== 'PENDING') return -1
    if (a.status !== 'PENDING' && b.status === 'PENDING') return 1
    return 0
  })

  const highlighted = confirmId
    ? pendingFirst.find((r) => r.id === confirmId)
    : null

  const sorted = highlighted
    ? [highlighted, ...pendingFirst.filter((r) => r.id !== confirmId)]
    : pendingFirst

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-textPrimary">
        Your Referrals
      </h1>

      {err && (
        <div className="rounded-xl border border-toneDanger/30 bg-toneDanger/10 px-4 py-3 text-sm text-toneDanger">
          {err}
        </div>
      )}

      {sorted.length === 0 && (
        <p className="py-8 text-center text-textMuted">
          No referrals yet. Share your referral card to get started!
        </p>
      )}

      <div className="space-y-3">
        {sorted.map((r) => {
          const isPending = r.status === 'PENDING'
          const isHighlighted = r.id === confirmId && isPending
          const isBusy = busy === r.id
          const reward = rewardDescription(r)

          return (
            <div
              key={r.id}
              className={`rounded-2xl border p-4 ${
                isHighlighted
                  ? 'border-accentPrimary/50 bg-accentPrimary/5'
                  : 'border-white/10 bg-bgSecondary'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-textPrimary">
                      {r.referredFirstName}
                    </span>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_COLORS[r.status] ?? 'bg-white/10 text-textMuted'
                      }`}
                    >
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-textMuted">
                    Tapped {formatDate(r.createdAt)}
                    {r.proName ? ` · Booked with ${r.proName}` : ''}
                  </p>

                  {reward && (
                    <p className="mt-1 text-sm text-accentPrimary">
                      {reward}
                      {r.rewardAppliedAt ? ' (applied)' : ''}
                    </p>
                  )}
                </div>

                {isPending && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      disabled={isBusy}
                      onClick={() => handleAction(r.id, 'confirm')}
                      className="rounded-xl bg-[image:var(--cta)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {isBusy ? '…' : 'Confirm'}
                    </button>
                    <button
                      disabled={isBusy}
                      onClick={() => handleAction(r.id, 'decline')}
                      className="rounded-xl border border-white/20 px-4 py-2 text-sm font-medium text-textSecondary disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
