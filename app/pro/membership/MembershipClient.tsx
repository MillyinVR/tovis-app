'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import type { SubscriptionStatus } from '@prisma/client'
import type { Entitlement, PlanKey } from '@/lib/pro/entitlements'
import { useBrand } from '@/lib/brand/BrandProvider'
import { formatRoundedDollars } from '@/lib/money'
import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  getViewerTimeZone,
} from '@/lib/time'
import { advertisedEntitlements } from './entitlementCopy'

type PlanPrice = {
  interval: 'month' | 'year'
  amountCents: number
  perMonthCents: number
  purchasable: boolean
}

type PlanCard = {
  key: PlanKey
  name: string
  blurb: string
  trialDays: number
  cameraImagesPerMonth: number
  prices: PlanPrice[]
}

type Props = {
  currentPlanKey: PlanKey
  status: SubscriptionStatus | null
  /** Active admin-granted comp, when one is in effect. */
  compPlanKey: PlanKey | null
  compUntil: string | null
  entitlements: Entitlement[]
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  trialEndsAt: string | null
  hasBillingAccount: boolean
  plans: PlanCard[]
  /** Configured one-time discovery platform fee, in cents (lib/booking/discoveryFee). */
  discoveryFeeCents: number
}

function dollars(cents: number): string {
  return formatRoundedDollars(cents / 100) ?? `$${Math.round(cents / 100)}`
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : formatInTimeZone(d, getViewerTimeZone() ?? DEFAULT_TIME_ZONE, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
}

export default function MembershipClient(props: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { brand } = useBrand()

  async function startUpgrade(planKey: PlanKey, interval: 'month' | 'year') {
    setError(null)
    try {
      const res = await fetch('/api/v1/pro/membership/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey, interval }),
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
      const res = await fetch('/api/v1/pro/membership/portal', { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) {
        throw new Error(data?.message || data?.error || 'Could not open billing portal.')
      }
      window.location.assign(data.url as string)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not open billing portal.')
    }
  }

  // Only entitlements we are willing to stand behind get named — see entitlementCopy.
  const advertised = advertisedEntitlements(props.entitlements)
  const renewLabel = formatDate(props.currentPeriodEnd)
  const trialLabel = formatDate(props.trialEndsAt)
  const compLabel = formatDate(props.compUntil)

  return (
    <section className="mx-auto mt-16 w-full max-w-2xl px-4 pb-12 text-textPrimary">
      <h1 className="text-[18px] font-black">Membership</h1>
      <p className="mt-1 text-[13px] text-textSecondary">
        Free covers the essentials — bookings, getting paid, and any payment method.
        Upgrade to unlock business tools.
      </p>

      {/*
        The commission pitch (docs/design/membership-value-brief.md §0.4 / §3.1).
        Every claim here is checkable in code, and must stay that way:
          • "0% of your services / deposits" — the ONLY application_fee the platform
            ever charges is the discovery fee below (grep `application_fee_amount`);
            the deposit settles to the pro's Connect account in full.
          • the fee amount is the LIVE configured value, not a hardcoded $5 — it is
            env-overridable up to $10 (lib/booking/discoveryFee.ts).
          • "brand-new client … from Discovery or the Looks feed" mirrors exactly
            isNewDiscoveryClient() + isDiscoveryProvenance() — no other booking path
            is ever charged.
        The 20–30% figure is deliberately unattributed and hedged ("many"): it is a
        market observation from the brief's competitor scan, not a claim we can
        verify per-competitor at render time.
      */}
      <div className="mt-4 rounded-card border border-accentPrimary/25 bg-bgSecondary p-4">
        <div className="text-[13px] font-black text-textPrimary">
          You keep 100% of what you charge
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-textSecondary">
          Many booking marketplaces take 20–30% of a new client&apos;s first
          appointment out of the pro&apos;s payout.{' '}
          <span className="font-black text-textPrimary">{brand.displayName}</span>{' '}
          takes 0% of your services and 0% of your deposits, on every plan. The one
          platform fee is a flat{' '}
          <span className="font-black text-textPrimary">
            {dollars(props.discoveryFeeCents)}
          </span>{' '}
          paid by the <em>client</em>, once, the first time a brand-new client books
          you from Discovery or the Looks feed.
        </p>
      </div>

      {props.compPlanKey && compLabel ? (
        <div className="mt-4 rounded-card border border-accentPrimary/30 bg-bgSecondary p-3 text-[12px] text-textSecondary">
          You have a complimentary{' '}
          <span className="font-black text-textPrimary">{props.compPlanKey}</span>{' '}
          membership through {compLabel} — on the house.
        </div>
      ) : null}

      {props.status && props.currentPlanKey !== 'free' && !props.compPlanKey ? (
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

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {props.plans.map((plan) => {
          const isCurrent = plan.key === props.currentPlanKey
          const monthly = plan.prices.find((p) => p.interval === 'month')
          const annual = plan.prices.find((p) => p.interval === 'year')
          const isFree = plan.prices.length === 0
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
                  {isFree
                    ? 'Free'
                    : monthly
                      ? `${dollars(monthly.amountCents)}/mo`
                      : ''}
                </div>
              </div>
              <p className="mt-1 text-[12px] text-textSecondary">{plan.blurb}</p>

              <div className="mt-1 text-[11px] text-textSecondary">
                {plan.cameraImagesPerMonth} AI photographer images / month
              </div>

              {annual ? (
                <div className="mt-1 text-[11px] text-textSecondary">
                  or {dollars(annual.perMonthCents)}/mo billed annually (
                  {dollars(annual.amountCents)}/yr)
                </div>
              ) : null}

              {plan.trialDays > 0 && !isCurrent ? (
                <div className="mt-2 text-[11px] font-black text-accentPrimary">
                  First {plan.trialDays} days free
                </div>
              ) : null}

              <div className="mt-3 grid gap-2">
                {isCurrent ? (
                  <div className="rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-center text-[12px] font-black text-textSecondary">
                    Current plan
                  </div>
                ) : (
                  <>
                    {monthly?.purchasable ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          startTransition(() => startUpgrade(plan.key, 'month'))
                        }
                        className={[
                          'w-full rounded-card border px-3 py-2 text-[12px] font-black transition',
                          pending
                            ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                            : 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
                        ].join(' ')}
                      >
                        {pending ? 'Starting…' : `Go monthly · ${dollars(monthly.amountCents)}/mo`}
                      </button>
                    ) : null}
                    {annual?.purchasable ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          startTransition(() => startUpgrade(plan.key, 'year'))
                        }
                        className={[
                          'w-full rounded-card border px-3 py-2 text-[12px] font-black transition',
                          pending
                            ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                            : 'border-white/15 bg-bgPrimary text-textPrimary hover:border-white/30',
                        ].join(' ')}
                      >
                        Save with annual · {dollars(annual.amountCents)}/yr
                      </button>
                    ) : null}
                  </>
                )}
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

      {advertised.length > 0 ? (
        <div className="mt-6">
          <div className="text-[12px] font-black text-textSecondary">
            Included with your plan
          </div>
          <ul className="mt-2 grid gap-1">
            {advertised.map(({ key: ent, label }) => (
              <li
                key={ent}
                className="flex items-center gap-2 text-[12px] text-textPrimary"
              >
                ✓ {label}
                {ent === 'custom_handle' ? (
                  <Link
                    href="/pro/profile/public-profile"
                    className="font-black text-accentPrimary hover:underline"
                  >
                    Claim it ›
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
