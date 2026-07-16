'use client'

// §9 personalization-metrics dashboard island. Reads
// /api/v1/admin/looks/personalization-metrics (GET, read-only) and renders the
// funnel + health rollup as stat tiles. No actions here — pure observability.

import { useEffect, useState, useTransition } from 'react'

import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  getViewerTimeZone,
} from '@/lib/time'

type SaveToBook = {
  savedPairs: number
  bookedPairs: number
  conversionRate: number
  notBookedPairs: number
  notBookedRate: number
  savesScanned: number
  scanCapped: boolean
}

type BoardToBooking = {
  boardsCreated: number
  boardCreators: number
  bookedAfterBoard: number
  conversionRate: number
  medianDaysToFirstBooking: number | null
  scanCapped: boolean
}

type HideRate = { hides: number; feedImpressions: number; rate: number }

type Rebook = {
  bookedClients: number
  repeatClients: number
  rebookRate: number
}

type CategoryOptOut = {
  key: string
  label: string
  mutedClients: number
  rate: number
}

type MetricsResponse = {
  ok: boolean
  generatedAt: string
  windowDays: number
  saveToBook: SaveToBook
  boardToBooking: BoardToBooking
  hideRate: HideRate
  rebook: Rebook
  notificationOptOut: { totalClients: number; categories: CategoryOptOut[] }
}

const WINDOW_OPTIONS: { value: number; label: string }[] = [
  { value: 30, label: 'Last 30 days' },
  { value: 60, label: 'Last 60 days' },
  { value: 90, label: 'Last 90 days' },
]

function formatInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function formatDays(days: number | null): string {
  if (days === null) return '—'
  return `${days.toFixed(1)}d`
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

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null
  return data?.error || 'Request failed.'
}

export default function MetricsClient() {
  const [windowDays, setWindowDays] = useState(30)
  const [data, setData] = useState<MetricsResponse | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function load(nextWindow: number) {
    setError(null)
    setLoaded(false)
    try {
      const res = await fetch(
        `/api/v1/admin/looks/personalization-metrics?windowDays=${nextWindow}`,
      )
      if (!res.ok) throw new Error(await readError(res))
      const body = (await res.json()) as MetricsResponse
      setData(body)
      setLoaded(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Loading metrics failed.')
      setLoaded(true)
    }
  }

  useEffect(() => {
    startTransition(() => load(30))
  }, [])

  const generatedLabel = data ? formatDate(data.generatedAt) : null

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={windowDays}
          onChange={(e) => {
            const next = Number(e.target.value)
            setWindowDays(next)
            startTransition(() => load(next))
          }}
          className="rounded-card border border-white/15 bg-bgPrimary px-3 py-2 text-[12px] text-textPrimary focus:border-accentPrimary/60 focus:outline-none"
        >
          {WINDOW_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => load(windowDays))}
          className="rounded-card border border-accentPrimary/60 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Loading…' : 'Refresh'}
        </button>
        <a
          href="/admin/looks/anomalies"
          className="rounded-card border border-white/15 bg-bgPrimary px-3 py-2 text-[12px] font-black text-textPrimary transition hover:border-white/30"
        >
          Engagement anomalies
        </a>
        {loaded && !error && generatedLabel ? (
          <span className="text-[11px] text-textSecondary">
            as of {generatedLabel}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3 text-[12px] text-toneDanger">{error}</div>
      ) : null}

      {data ? (
        <div className="mt-5 grid gap-5">
          <Section
            title="Save → book funnel"
            subtitle="Distinct (client, look) pairs saved in the window, and how many that same client then booked (a look-attributed, non-cancelled booking). The gap is the saved-not-booked population the re-engagement nudges target."
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Saved looks" value={formatInt(data.saveToBook.savedPairs)} />
              <Tile label="Booked" value={formatInt(data.saveToBook.bookedPairs)} />
              <Tile
                label="Conversion"
                value={formatPercent(data.saveToBook.conversionRate)}
                tone="accent"
              />
              <Tile
                label="Saved · not booked"
                value={formatInt(data.saveToBook.notBookedPairs)}
                hint={formatPercent(data.saveToBook.notBookedRate)}
              />
            </div>
            {data.saveToBook.scanCapped ? <CapNote /> : null}
          </Section>

          <Section
            title="Board → booking"
            subtitle="Clients who created a board in the window, and how many then placed a booking on or after their first board."
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile
                label="Board creators"
                value={formatInt(data.boardToBooking.boardCreators)}
                hint={`${formatInt(data.boardToBooking.boardsCreated)} boards`}
              />
              <Tile
                label="Booked after board"
                value={formatInt(data.boardToBooking.bookedAfterBoard)}
              />
              <Tile
                label="Conversion"
                value={formatPercent(data.boardToBooking.conversionRate)}
                tone="accent"
              />
              <Tile
                label="Median time to book"
                value={formatDays(data.boardToBooking.medianDaysToFirstBooking)}
              />
            </div>
            {data.boardToBooking.scanCapped ? <CapNote /> : null}
          </Section>

          <div className="grid gap-5 sm:grid-cols-2">
            <Section
              title="Hide rate"
              subtitle="“Not for me” hides over recorded FEED impressions in the window (impressions are best-effort sampled)."
            >
              <div className="grid grid-cols-3 gap-3">
                <Tile label="Hides" value={formatInt(data.hideRate.hides)} />
                <Tile
                  label="Impressions"
                  value={formatInt(data.hideRate.feedImpressions)}
                />
                <Tile
                  label="Rate"
                  value={formatPercent(data.hideRate.rate)}
                  tone={data.hideRate.rate >= 0.05 ? 'danger' : 'default'}
                />
              </div>
            </Section>

            <Section
              title="Rebook rate"
              subtitle="Of clients with a completed booking, the share who completed ≥2 (lifetime retention)."
            >
              <div className="grid grid-cols-3 gap-3">
                <Tile
                  label="Booked clients"
                  value={formatInt(data.rebook.bookedClients)}
                />
                <Tile
                  label="Repeat"
                  value={formatInt(data.rebook.repeatClients)}
                />
                <Tile
                  label="Rebook rate"
                  value={formatPercent(data.rebook.rebookRate)}
                  tone="accent"
                />
              </div>
            </Section>
          </div>

          <Section
            title="Notification opt-out per trigger"
            subtitle={`Share of all client profiles (${formatInt(
              data.notificationOptOut.totalClients,
            )}) who muted every channel for each category. Missing preferences count as opted-in.`}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-[12px]">
                <thead className="text-textSecondary">
                  <tr className="border-b border-white/10">
                    <th className="py-2 pr-3 font-black">Category</th>
                    <th className="py-2 pr-3 text-right font-black">Muted</th>
                    <th className="py-2 text-right font-black">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.notificationOptOut.categories.map((c) => (
                    <tr key={c.key} className="border-b border-white/5">
                      <td className="py-2 pr-3 text-textPrimary">{c.label}</td>
                      <td className="py-2 pr-3 text-right text-textSecondary">
                        {formatInt(c.mutedClients)}
                      </td>
                      <td className="py-2 text-right font-black text-textPrimary">
                        {formatPercent(c.rate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      ) : null}

      {loaded && !data && !error ? (
        <div className="mt-5 rounded-card border border-white/10 bg-bgPrimary/40 p-4 text-[13px] text-textSecondary">
          No metrics yet.
        </div>
      ) : null}
    </div>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-card border border-white/10 bg-bgPrimary/20 p-4">
      <div className="mb-3">
        <h2 className="text-[15px] font-black text-textPrimary">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-[12px] text-textSecondary">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function Tile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'accent' | 'danger'
}) {
  const valueTone =
    tone === 'accent'
      ? 'text-accentPrimary'
      : tone === 'danger'
        ? 'text-toneDanger'
        : 'text-textPrimary'
  return (
    <div className="rounded-card border border-white/10 bg-bgPrimary/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-textSecondary">
        {label}
      </div>
      <div className={`mt-1 text-[20px] font-black ${valueTone}`}>{value}</div>
      {hint ? (
        <div className="mt-0.5 text-[11px] text-textSecondary">{hint}</div>
      ) : null}
    </div>
  )
}

function CapNote() {
  return (
    <div className="mt-2 text-[11px] text-toneWarn">
      Scan cap reached — this window has more activity than the rollup sampled;
      ratios are approximate.
    </div>
  )
}
