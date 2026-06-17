'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { safeJson } from '@/lib/http'

type Tier = 'RECOGNITION' | 'DISCOUNT' | 'CREDIT'

type Settings = {
  referralRewardEnabled: boolean
  referralRewardTier: Tier
  referralDiscountPercent: number | null
  referralCreditAmount: number | null
}

const TIER_LABELS: Record<Tier, string> = {
  RECOGNITION: 'Recognition only',
  DISCOUNT: 'Percentage discount',
  CREDIT: 'Dollar credit',
}

const TIER_DESCRIPTIONS: Record<Tier, string> = {
  RECOGNITION: 'Referrer gets a thank-you notification — no cost to you.',
  DISCOUNT: 'Referrer gets X% off their next booking with you.',
  CREDIT: 'Referrer gets $X off their next booking with you.',
}

function messageFromUnknown(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.'
}

export default function ReferralRewardsClient(props: { initial: Settings }) {
  const router = useRouter()

  const [enabled, setEnabled] = useState(props.initial.referralRewardEnabled)
  const [tier, setTier] = useState<Tier>(props.initial.referralRewardTier)
  const [discountPercent, setDiscountPercent] = useState(
    props.initial.referralDiscountPercent ?? 10,
  )
  const [creditAmount, setCreditAmount] = useState(
    props.initial.referralCreditAmount ?? 10,
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save(patch: Partial<Settings>) {
    setBusy(true)
    setErr(null)
    setSaved(false)
    try {
      const res = await fetch('/api/pro/settings/referral-rewards', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await safeJson(res)
      if (!res.ok)
        throw new Error(
          (data && typeof data === 'object' && 'error' in data
            ? (data as { error: string }).error
            : null) ?? `Save failed (${res.status})`,
        )
      setSaved(true)
      router.refresh()
    } catch (e) {
      setErr(messageFromUnknown(e))
    } finally {
      setBusy(false)
    }
  }

  function handleToggle() {
    const next = !enabled
    setEnabled(next)
    save({ referralRewardEnabled: next })
  }

  function handleTierChange(next: Tier) {
    setTier(next)
    save({ referralRewardTier: next })
  }

  function handleDiscountBlur() {
    const clamped = Math.max(1, Math.min(100, Math.round(discountPercent)))
    setDiscountPercent(clamped)
    save({ referralDiscountPercent: clamped })
  }

  function handleCreditBlur() {
    const clamped = Math.max(1, Math.round(creditAmount * 100) / 100)
    setCreditAmount(clamped)
    save({ referralCreditAmount: clamped })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-textPrimary">
          Referral Rewards
        </h1>
        <p className="mt-1 text-sm text-textMuted">
          Reward clients who refer new bookings to you.
        </p>
      </div>

      {err && (
        <div className="rounded-xl border border-toneDanger/30 bg-toneDanger/10 px-4 py-3 text-sm text-toneDanger">
          {err}
        </div>
      )}

      {saved && !err && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          Settings saved.
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-bgSecondary p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-textPrimary">
              Enable referral rewards
            </p>
            <p className="text-sm text-textMuted">
              When enabled, clients who refer others earn a reward when the
              referred client books with you.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={busy}
            onClick={handleToggle}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
              enabled ? 'bg-accentPrimary' : 'bg-white/20'
            } disabled:opacity-50`}
          >
            <span
              className={`absolute top-0.5 block h-6 w-6 rounded-full bg-white shadow transition-transform ${
                enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {enabled && (
        <>
          <div className="rounded-2xl border border-white/10 bg-bgSecondary p-5">
            <p className="mb-3 font-medium text-textPrimary">Reward tier</p>
            <div className="space-y-2">
              {(Object.keys(TIER_LABELS) as Tier[]).map((t) => (
                <label
                  key={t}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                    tier === t
                      ? 'border-accentPrimary/50 bg-accentPrimary/5'
                      : 'border-white/10 bg-bgPrimary'
                  }`}
                >
                  <input
                    type="radio"
                    name="tier"
                    value={t}
                    checked={tier === t}
                    onChange={() => handleTierChange(t)}
                    disabled={busy}
                    className="mt-1 accent-accentPrimary"
                  />
                  <div>
                    <span className="font-medium text-textPrimary">
                      {TIER_LABELS[t]}
                    </span>
                    <p className="text-sm text-textMuted">
                      {TIER_DESCRIPTIONS[t]}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {tier === 'DISCOUNT' && (
            <div className="rounded-2xl border border-white/10 bg-bgSecondary p-5">
              <label className="block">
                <span className="font-medium text-textPrimary">
                  Discount percentage
                </span>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={discountPercent}
                    onChange={(e) =>
                      setDiscountPercent(Number(e.target.value) || 0)
                    }
                    onBlur={handleDiscountBlur}
                    disabled={busy}
                    className="w-24 rounded-xl border border-white/20 bg-bgPrimary px-3 py-2 text-textPrimary disabled:opacity-50"
                  />
                  <span className="text-textMuted">%</span>
                </div>
                <p className="mt-1 text-sm text-textMuted">
                  Applied to the referrer&apos;s next booking with you (1–100%).
                </p>
              </label>
            </div>
          )}

          {tier === 'CREDIT' && (
            <div className="rounded-2xl border border-white/10 bg-bgSecondary p-5">
              <label className="block">
                <span className="font-medium text-textPrimary">
                  Credit amount
                </span>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-textMuted">$</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={creditAmount}
                    onChange={(e) =>
                      setCreditAmount(Number(e.target.value) || 0)
                    }
                    onBlur={handleCreditBlur}
                    disabled={busy}
                    className="w-24 rounded-xl border border-white/20 bg-bgPrimary px-3 py-2 text-textPrimary disabled:opacity-50"
                  />
                </div>
                <p className="mt-1 text-sm text-textMuted">
                  Applied to the referrer&apos;s next booking with you.
                </p>
              </label>
            </div>
          )}
        </>
      )}
    </div>
  )
}
