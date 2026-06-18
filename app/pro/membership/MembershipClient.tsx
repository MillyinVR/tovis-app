'use client'

import { useState, useTransition } from 'react'
import type { SubscriptionStatus } from '@prisma/client'
import type { Entitlement, PlanKey } from '@/lib/pro/entitlements'

type PlanCard = {
  key: PlanKey
  name: string
  priceCents: number
  interval: 'month' | null
  trialDays: number
  blurb: string
  purchasable: boolean
}

type Props = {
  currentPlanKey: PlanKey
  status: SubscriptionStatus | null
  entitlements: Entitlement[]
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  trialEndsAt: string | null
  hasBillingAccount: boolean
  plans: PlanCard[]
}

const ENTITLEMENT_LABELS: Record<Entitlement, string> = {
  custom_handle: 'Custom .tovis handle',
  tax_export: 'Quarterly tax export + transaction ledger',
  advanced_analytics: 'Advanced analytics & retention insights',
  priority_discovery: 'Priority placement in Discovery',
  reduced_platform_fee: 'Reduced platform fee share',
  white_label: 'White-label / multi-pro salon',
}

function priceLabel(plan: PlanCard): string {
  if (plan.priceCents <= 0) return 'Free'
  return `$${(plan.priceCents / 100).toFixed(0)}/${plan.interval ?? 'mo'}`
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function MembershipClient(props: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function startUpgrade(planKey: PlanKey) {
    setError(null)
    try {
      const res = await fetch('/api/pro/membership/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) {
        throw new Error(data?.message || data?.error || 'Could not start checkout.')
      }
      window.location.assign(data.url as string)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not start checkout.')
    }
  }

  async function openPortal() {
    setError(null)
    try {
      const res = await fetch('/api/pro/membership/portal', { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) {
        throw new Error(data?.message || data?.error || 'Could not open billing portal.')
      }
      window.location.assign(data.url as string)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not open billing portal.')
    }
  }

  const renewLabel = formatDate(props.currentPeriodEnd)
  const trialLabel = formatDate(props.trialEndsAt)

  return (
    <section className="mx-auto mt-16 w-full max-w-2xl px-4 pb-12 text-textPrimary">
      <h1 className="text-[18px] font-black">Membership</h1>
      <p className="mt-1 text-[13px] text-textSecondary">
        Free covers the essentials — bookings, getting paid, and any payment method.
        Upgrade to unlock business tools.
      </p>

      {props.status && props.currentPlanKey !== 'free' ? (
        <div className="mt-4 rounded-card border border-accentPrimary/30 bg-bgSecondary p-3 text-[12px] text-textSecondary">
          You&apos;re on <span className="font-black text-textPrimary">{props.currentPlanKey}</span>
          {props.cancelAtPeriodEnd ? ' (cancels at period end)' : ''}.
          {trialLabel ? ` Free trial through ${trialLabel}.` : ''}
          {renewLabel && !props.cancelAtPeriodEnd ? ` Renews ${renewLabel}.` : ''}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 text-[12px] text-toneDanger">{error}</div>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {props.plans.map((plan) => {
          const isCurrent = plan.key === props.currentPlanKey
          return (
            <div
              key={plan.key}
              className={[
                'rounded-card border p-4',
                isCurrent
                  ? 'border-accentPrimary/60 bg-bgSecondary'
                  : 'border-white/10 bg-bgPrimary/40',
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <div className="text-[14px] font-black">{plan.name}</div>
                <div className="text-[13px] font-black text-textPrimary">
                  {priceLabel(plan)}
                </div>
              </div>
              <p className="mt-1 text-[12px] text-textSecondary">{plan.blurb}</p>

              {plan.trialDays > 0 && !isCurrent ? (
                <div className="mt-2 text-[11px] font-black text-accentPrimary">
                  First {plan.trialDays} days free
                </div>
              ) : null}

              <div className="mt-3">
                {isCurrent ? (
                  <div className="rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-center text-[12px] font-black text-textSecondary">
                    Current plan
                  </div>
                ) : plan.purchasable ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => startTransition(() => startUpgrade(plan.key))}
                    className={[
                      'w-full rounded-card border px-3 py-2 text-[12px] font-black transition',
                      pending
                        ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                        : 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
                    ].join(' ')}
                  >
                    {pending ? 'Starting…' : `Upgrade to ${plan.name}`}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {props.hasBillingAccount ? (
        <button
          type="button"
          onClick={() => startTransition(openPortal)}
          disabled={pending}
          className="mt-5 rounded-card border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
        >
          Manage billing
        </button>
      ) : null}

      {props.entitlements.length > 0 ? (
        <div className="mt-6">
          <div className="text-[12px] font-black text-textSecondary">
            Included with your plan
          </div>
          <ul className="mt-2 grid gap-1">
            {props.entitlements.map((ent) => (
              <li key={ent} className="text-[12px] text-textPrimary">
                ✓ {ENTITLEMENT_LABELS[ent]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
