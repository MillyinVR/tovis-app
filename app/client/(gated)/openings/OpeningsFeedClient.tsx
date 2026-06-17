// app/client/(gated)/openings/OpeningsFeedClient.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import { isRecord } from '@/lib/guards'
import { usePresenceSignalsBatch } from '@/lib/presence/usePresenceSignalsBatch'
import type {
  PresenceBatchItem,
  PresenceSignalCounts,
} from '@/lib/presence/presenceSignals'

type FeedCard = {
  key: string
  href: string
  openingId: string
  professionalId: string | null
  serviceId: string | null
  serviceName: string
  meta: string
  whenLabel: string
  priceLabel: string | null
  wasLabel: string | null
  incentiveLabel: string | null
  matchedWaitlist: boolean
  seed: string
}

const AVATAR_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ['--accent-primary', '--iris'],
  ['--peacock-blue', '--accent-primary'],
  ['--iris', '--peacock-blue'],
  ['--amber', '--fern'],
]

function gradientStyle(seed: string): { background: string } {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  const fallback: readonly [string, string] = ['--accent-primary', '--iris']
  const [from, to] = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length] ?? fallback
  return { background: `radial-gradient(130% 120% at 32% 20%, rgb(var(${from})), rgb(var(${to})))` }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function money(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`
}

function formatWhen(iso: string, timeZone: string | null): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }
}

function parseCard(notification: unknown): FeedCard | null {
  if (!isRecord(notification)) return null
  const opening = notification.opening
  if (!isRecord(opening)) return null

  const openingId = str(opening.id)
  const startAt = str(opening.startAt)
  if (!openingId || !startAt) return null

  const services = Array.isArray(opening.services) ? opening.services : []
  const primary = services.find(isRecord) ?? null
  if (!primary) return null
  const offeringId = str(primary.offeringId)
  if (!offeringId) return null

  const service = isRecord(primary.service) ? primary.service : null
  const offering = isRecord(primary.offering) ? primary.offering : null
  const serviceName =
    str(offering?.title) ?? str(service?.name) ?? 'Last-minute opening'

  const professional = isRecord(opening.professional) ? opening.professional : null
  const proName = str(professional?.businessName) ?? 'Your pro'
  const place = str(professional?.locationLabel)
  const meta = [proName, place].filter(Boolean).join(' · ')

  const professionalId = str(professional?.id)
  const serviceId = str(primary.serviceId) ?? str(service?.id)

  const timeZone = str(opening.timeZone)
  const whenLabel = formatWhen(startAt, timeZone)

  const isMobile = str(opening.locationType) === 'MOBILE'
  const baseNum =
    num(isMobile ? offering?.mobilePriceStartingAt : offering?.salonPriceStartingAt) ??
    num(service?.minPrice)

  const incentive = isRecord(opening.publicIncentive) ? opening.publicIncentive : null
  const incentiveLabel = str(incentive?.label)

  let priceLabel: string | null = baseNum != null ? money(baseNum) : null
  let wasLabel: string | null = null
  if (incentive && baseNum != null) {
    const offerType = str(incentive.offerType)
    if (offerType === 'PERCENT_OFF') {
      const pct = num(incentive.percentOff)
      if (pct && pct > 0) {
        priceLabel = money(Math.max(0, baseNum * (1 - pct / 100)))
        wasLabel = money(baseNum)
      }
    } else if (offerType === 'AMOUNT_OFF') {
      const amt = num(incentive.amountOff)
      if (amt && amt > 0 && amt < baseNum) {
        priceLabel = money(baseNum - amt)
        wasLabel = money(baseNum)
      }
    }
  }

  const tier = str(notification.tier) ?? str(opening.matchedTier)

  return {
    key: str(notification.id) ?? openingId,
    href: `/offerings/${encodeURIComponent(offeringId)}?scheduledFor=${encodeURIComponent(
      startAt,
    )}&source=DISCOVERY&openingId=${encodeURIComponent(openingId)}`,
    openingId,
    professionalId,
    serviceId,
    serviceName,
    meta,
    whenLabel,
    priceLabel,
    wasLabel,
    incentiveLabel,
    matchedWaitlist: tier === 'WAITLIST',
    seed: openingId,
  }
}

function FeedPresence({ counts }: { counts: PresenceSignalCounts | undefined }) {
  // Honest signals: never count just the viewer, never fake liveness.
  const showWatching = typeof counts?.watching === 'number' && counts.watching >= 2
  const showWaitlist = (counts?.waitlisted ?? 0) >= 1

  if (!showWatching && !showWaitlist) return null

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {showWatching ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-textPrimary/5 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-textMuted">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accentPrimary/70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accentPrimary" />
          </span>
          {counts!.watching} watching
        </span>
      ) : null}
      {showWaitlist ? (
        <span className="inline-flex items-center rounded-full bg-textPrimary/5 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-textMuted">
          {counts!.waitlisted} on waitlist
        </span>
      ) : null}
    </div>
  )
}

type Status =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; cards: FeedCard[] }

export default function OpeningsFeedClient() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  const presenceItems = useMemo<PresenceBatchItem[]>(() => {
    if (status.kind !== 'ready') return []
    const items: PresenceBatchItem[] = []
    for (const card of status.cards) {
      if (!card.professionalId) continue
      items.push({
        resourceType: 'opening',
        resourceId: card.openingId,
        professionalId: card.professionalId,
        serviceId: card.serviceId ?? undefined,
      })
    }
    return items
  }, [status])

  const presence = usePresenceSignalsBatch(presenceItems)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/client/openings', { cache: 'no-store' })
        const raw: unknown = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !isRecord(raw) || !Array.isArray(raw.notifications)) {
          setStatus({ kind: 'error' })
          return
        }
        const cards = raw.notifications
          .map(parseCard)
          .filter((card): card is FeedCard => card !== null)
        setStatus({ kind: 'ready', cards })
      } catch {
        if (!cancelled) setStatus({ kind: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="relative min-h-screen overflow-hidden bg-bgPrimary text-textPrimary">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-[linear-gradient(180deg,rgb(var(--accent-primary)/0.12),transparent)]"
      />
      <section className="relative mx-auto flex min-h-screen w-full max-w-none flex-col px-[22px] pb-28 pt-12 md:max-w-[520px] md:px-[32px] lg:max-w-[560px] lg:px-[40px]">
        <header>
          <div className="flex items-center gap-2">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="text-gold">
              <path d="M13 2L4.5 13.5H11l-1 8.5L18.5 10.5H12z" />
            </svg>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-textMuted">
              Last-minute openings
            </span>
          </div>
          <h1 className="mt-3 font-display text-[36px] font-bold leading-[0.96] tracking-[-0.04em] md:text-[40px] lg:text-[44px]">
            Open today.
          </h1>
          <p className="mt-3 max-w-[460px] text-[14.5px] leading-relaxed text-textSecondary">
            Slots that just freed up. Claim one before it&apos;s gone — these go to whoever grabs them first.
          </p>
        </header>

        <div className="mt-6 flex flex-col gap-[13px]">
          {status.kind === 'loading' ? (
            <div className="rounded-card border border-textPrimary/10 bg-bgSurface px-5 py-8 text-center font-mono text-[11px] uppercase tracking-[0.08em] text-textMuted">
              Loading openings…
            </div>
          ) : null}

          {status.kind === 'error' ? (
            <div className="rounded-card border border-ember/30 bg-bgSurface px-5 py-6 text-center text-[13px] text-textSecondary">
              Couldn&apos;t load openings right now. Please try again in a moment.
            </div>
          ) : null}

          {status.kind === 'ready' && status.cards.length === 0 ? (
            <div className="rounded-card border border-textPrimary/10 bg-bgSurface px-5 py-7">
              <p className="text-[13px] leading-relaxed text-textMuted">
                No last-minute openings right now. We&apos;ll ping you the moment a pro frees up a spot you&apos;re waiting on.
              </p>
              <Link
                href="/discover"
                className="mt-4 inline-flex rounded-full border border-textPrimary/15 px-4 py-2 text-[12px] font-bold text-textSecondary transition hover:border-accentPrimary/40 hover:text-accentPrimary"
              >
                Browse pros →
              </Link>
            </div>
          ) : null}

          {status.kind === 'ready'
            ? status.cards.map((card) => (
                <article
                  key={card.key}
                  className="rounded-[18px] border border-textPrimary/10 bg-bgSurface p-4"
                >
                  {card.matchedWaitlist ? (
                    <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-accentPrimary px-2.5 py-1 font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-onAccent">
                      ✦ Matches your waitlist
                    </div>
                  ) : null}

                  <div className="flex items-start gap-[13px]">
                    <div
                      className="h-[50px] w-[50px] shrink-0 rounded-[14px]"
                      style={gradientStyle(card.seed)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-[16px] font-semibold tracking-[-0.01em]">
                        {card.serviceName}
                      </div>
                      <div className="mt-0.5 truncate text-[12.5px] text-textMuted">{card.meta}</div>
                      {card.whenLabel ? (
                        <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-[7px] bg-gold/12 px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.04em] text-gold">
                          {card.whenLabel}
                        </span>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      {card.wasLabel ? (
                        <div className="font-mono text-[11px] text-textMuted line-through">
                          {card.wasLabel}
                        </div>
                      ) : null}
                      {card.priceLabel ? (
                        <div className="font-display text-[18px] font-bold tracking-[-0.02em] text-accentPrimary">
                          {card.priceLabel}
                        </div>
                      ) : null}
                      {card.incentiveLabel && card.wasLabel ? (
                        <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.06em] text-gold">
                          {card.incentiveLabel}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <FeedPresence counts={presence[card.openingId]} />

                  <Link
                    href={card.href}
                    className="mt-3.5 flex h-[42px] items-center justify-center rounded-[13px] bg-[image:var(--cta)] font-display text-[13.5px] font-bold text-onCta transition hover:opacity-95"
                  >
                    Grab it →
                  </Link>
                </article>
              ))
            : null}
        </div>
      </section>
    </main>
  )
}
