'use client'

// app/pro/migrate/MigrateEntryClient.tsx

import Link from 'next/link'
import { useState } from 'react'

import type { MigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import { MigrationStepper } from './_components/MigrationStepper'
import { SOURCE_APPS } from './_constants'
import { exportGuideFor } from './_exportInstructions'
import type { SourceApp } from './_types'

// Per-stage counts the pro already has, so the "what you'll bring over" cards
// reflect real progress instead of a static "Not started" chip. Same booking-
// gated numbers the Review page shows (loadMigrationReviewSummary) so the two
// pages never disagree.
export type EntryProgress = {
  services: number
  clients: number
  calendar: number
}

type Props = {
  copy: MigrationCopy['entry']
  progress: EntryProgress
}

export function MigrateEntryClient({ copy, progress }: Props) {
  const [sourceApp, setSourceApp] = useState<SourceApp | null>(null)

  const cards: Array<{ key: keyof EntryProgress; icon: string; title: string; desc: string }> = [
    { key: 'services', icon: '📋', title: 'Service menu', desc: copy.cards.servicesDesc },
    { key: 'clients', icon: '👥', title: 'Clients', desc: copy.cards.clientsDesc },
    { key: 'calendar', icon: '📅', title: 'Calendar', desc: copy.cards.calendarDesc },
  ]

  const guide = sourceApp ? exportGuideFor(sourceApp) : null

  return (
    <div className="min-h-screen text-textPrimary">
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8">
        <MigrationStepper />

        <h1 className="mt-6 max-w-3xl font-display text-[30px] font-medium leading-[1.15] tracking-[-0.02em]">
          {copy.hero}
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] text-textSecondary">
          {copy.heroSub}
        </p>

        {/* Source-app picker */}
        <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.12em] text-textMuted">
          {copy.pickLabel}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SOURCE_APPS.map((app) => {
            const selected = sourceApp === app
            return (
              <button
                key={app}
                type="button"
                onClick={() => setSourceApp(app)}
                aria-pressed={selected}
                className={[
                  'relative flex h-16 items-center justify-center rounded-card border bg-bgSurface px-3 text-[14px] transition',
                  selected
                    ? 'border-accentPrimary/60 text-textPrimary shadow-[0_0_28px_rgb(var(--accent-primary)/0.25)]'
                    : 'border-white/10 text-textSecondary hover:border-white/20',
                ].join(' ')}
              >
                {app}
                {selected ? (
                  <span
                    className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-accentPrimary text-[11px] text-onAccent"
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        {/* Per-source export guide — revealed once the pro picks where they're
            coming from, so the picker actually helps them get their files out. */}
        {sourceApp && guide ? (
          <div className="mt-4 rounded-card border border-white/10 bg-bgSurface p-5">
            <h3 className="font-display text-[16px] font-medium">
              {copy.exportGuide.title} {sourceApp}
            </h3>
            <ul className="mt-3 flex flex-col gap-3">
              {[
                { label: copy.exportGuide.menuLabel, step: guide.menu },
                { label: copy.exportGuide.clientsLabel, step: guide.clients },
                { label: copy.exportGuide.calendarLabel, step: guide.calendar },
              ].map((row) => (
                <li key={row.label} className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-textMuted">
                    {row.label}
                  </span>
                  <span className="text-[13px] text-textSecondary">{row.step}</span>
                </li>
              ))}
            </ul>
            {guide.calendarFeed ? (
              <p className="mt-3 inline-flex w-fit items-center rounded-full bg-accentPrimary/10 px-3 py-1 text-[12px] text-textPrimary ring-1 ring-accentPrimary/30">
                {copy.exportGuide.feedNote}
              </p>
            ) : null}
            <p className="mt-3 text-[12px] text-textMuted">{copy.exportGuide.fallback}</p>
          </div>
        ) : null}

        {/* What you'll bring over */}
        <h2 className="mt-10 font-display text-[18px] font-medium">
          {copy.bringTitle}
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {cards.map((c) => {
            const count = progress[c.key]
            const done = count > 0
            return (
              <div
                key={c.key}
                className="flex flex-col gap-2 rounded-card border border-white/10 bg-bgSurface p-4"
              >
                <span className="text-[22px]" aria-hidden="true">
                  {c.icon}
                </span>
                <span className="text-[15px] font-medium text-textPrimary">
                  {c.title}
                </span>
                <span className="text-[13px] text-textSecondary">{c.desc}</span>
                <span
                  className={[
                    'mt-1 inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] ring-1',
                    done
                      ? 'bg-accentPrimary/10 text-textPrimary ring-accentPrimary/30'
                      : 'bg-white/5 text-textMuted ring-white/10',
                  ].join(' ')}
                >
                  {done ? `${count} ${copy.imported}` : copy.notStarted}
                </span>
              </div>
            )
          })}
        </div>

        {/* CTA */}
        <div className="mt-10 flex flex-col items-center gap-4 rounded-card border border-white/10 bg-bgSecondary px-6 py-8 text-center">
          <h3 className="font-display text-[20px] font-medium">{copy.readyTitle}</h3>
          <p className="max-w-md text-[14px] text-textSecondary">{copy.readySub}</p>
          <Link
            href="/pro/migrate/services"
            className="inline-flex h-12 items-center justify-center rounded-full px-7 text-[15px] font-medium hover:opacity-90"
            style={{ background: 'var(--cta)', color: 'rgb(var(--on-cta))' }}
          >
            {copy.cta} →
          </Link>
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
