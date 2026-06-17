'use client'

// app/pro/migrate/review/MigrateReviewClient.tsx

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { MigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import { MigrationStepper } from '../_components/MigrationStepper'
import type {
  MigrateReviewViewModel,
  ReviewCardTone,
  ReviewSummaryCard,
} from '../_types'
import { formatMoney } from '../_utils/raiseRamp'

type Props = {
  copy: MigrationCopy['review']
  vm: MigrateReviewViewModel
}

const TONE_TEXT: Record<ReviewCardTone, string> = {
  gold: 'text-amber',
  accent: 'text-accentPrimary',
  violet: 'text-acid',
}

const CARD_ICON: Record<string, string> = {
  services: '📋',
  clients: '👥',
  calendar: '📅',
  review: '✓',
}

export function MigrateReviewClient({ copy, vm }: Props) {
  const router = useRouter()
  const [goingLive, setGoingLive] = useState(false)

  // Imports already committed live on each step (silently), so going live is the
  // pro's confirmation — finish the wizard and head to the dashboard.
  function goLive(): void {
    setGoingLive(true)
    router.push('/pro/dashboard')
  }

  return (
    <div className="min-h-screen text-textPrimary">
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8">
        <MigrationStepper active="review" />

        <h1 className="mt-6 font-display text-[28px] font-medium tracking-[-0.02em]">
          {copy.title}
        </h1>

        {/* Summary cards */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {vm.cards.map((card) => (
            <SummaryCard key={card.key} card={card} copy={copy} />
          ))}
        </div>

        {/* Raise plan recap */}
        <div className="mt-4 overflow-hidden rounded-card border border-accentPrimary/40 bg-accentPrimary/[0.06]">
          <div className="flex items-center justify-between border-b border-accentPrimary/20 px-5 py-3">
            <span className="font-display text-[16px] font-medium">
              {copy.raiseRecapTitle} 🎉
            </span>
            <Link
              href="/pro/migrate/services"
              className="text-[12px] text-accentPrimary hover:opacity-80"
            >
              {copy.editPlan} →
            </Link>
          </div>
          <div className="flex flex-col divide-y divide-accentPrimary/15">
            {vm.raiseRecap.map((r) => (
              <div
                key={r.serviceName}
                className="flex items-center justify-between px-5 py-3"
              >
                <span className="text-[14px] text-textPrimary">{r.serviceName}</span>
                <span className="flex items-center gap-3 text-[13px]">
                  <span className="text-textMuted">
                    {formatMoney(r.from)} → {formatMoney(r.to)}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-textMuted">
                    {r.cadenceLabel}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Preflight checklist */}
        <h2 className="mt-8 font-display text-[18px] font-medium">
          {copy.preflightTitle}
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {vm.checklist.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 rounded-card border border-white/10 bg-bgSurface px-4 py-3"
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full bg-fern/15 text-[12px] text-fern"
                aria-hidden="true"
              >
                ✓
              </span>
              <span className="text-[13px] text-textSecondary">{item.label}</span>
            </div>
          ))}
        </div>

        {/* Go-live */}
        <div className="mt-8 flex flex-col items-center gap-4 rounded-card border border-white/10 bg-bgSecondary px-6 py-10 text-center">
          <h3 className="font-display text-[20px] font-medium">{copy.goLiveTitle}</h3>
          <button
            type="button"
            disabled={goingLive}
            onClick={goLive}
            className="inline-flex h-14 items-center justify-center rounded-full px-8 text-[16px] font-medium transition hover:opacity-90 disabled:opacity-70"
            style={{ background: 'var(--cta)', color: 'rgb(var(--on-cta))' }}
          >
            {goingLive ? 'Going live…' : copy.goLive} {goingLive ? '' : '→'}
          </button>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {copy.trust.map((t) => (
              <span
                key={t}
                className="rounded-full bg-white/5 px-3 py-1 text-[11px] text-textMuted"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({
  card,
  copy,
}: {
  card: ReviewSummaryCard
  copy: MigrationCopy['review']
}) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-white/10 bg-bgSurface p-4">
      <div className="flex items-center justify-between">
        <span className={['text-[20px]', TONE_TEXT[card.tone]].join(' ')} aria-hidden="true">
          {CARD_ICON[card.key] ?? '✓'}
        </span>
        <span className="inline-flex items-center rounded-full bg-fern/12 px-2.5 py-1 text-[11px] text-fern ring-1 ring-fern/30">
          {copy.complete}
        </span>
      </div>
      <div>
        <p className="text-[15px] font-medium text-textPrimary">{card.title}</p>
        <p className="text-[12px] text-textMuted">{card.subtitle}</p>
      </div>
      <div className="flex gap-4">
        {card.stats.map((s) => (
          <div key={s.label}>
            <p className="text-[18px] font-medium text-textPrimary">{s.value}</p>
            <p className="text-[11px] text-textMuted">{s.label}</p>
          </div>
        ))}
      </div>
      <Link
        href={card.editHref}
        className="text-[12px] text-accentPrimary hover:opacity-80"
      >
        {card.editLabel} →
      </Link>
    </div>
  )
}
