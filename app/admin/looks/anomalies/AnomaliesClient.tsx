'use client'

// §5.6 anti-gaming review-queue island. Reads
// /api/v1/admin/looks/velocity-anomalies (GET, read-only) and lists looks whose
// recent engagement outruns their impressions or spikes above their own history,
// most suspicious first. No actions here — the admin jumps to the public look or
// the Looks moderation queue to act.

import { useEffect, useState, useTransition } from 'react'

import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  getViewerTimeZone,
} from '@/lib/time'

type AnomalyReason = 'RATE_ANOMALY' | 'HISTORICAL_SPIKE'

type AnomalyRow = {
  lookPostId: string
  professionalId: string
  proLabel: string
  proHandle: string | null
  caption: string | null
  status: string
  moderationStatus: string
  createdAt: string
  reasons: AnomalyReason[]
  severity: number
  windowSaves: number
  windowLikes: number
  windowImpressions: number
  windowEngagement: number
  rateRatio: number
  spikeMultiple: number
}

type AnomalyResponse = {
  ok: boolean
  generatedAt: string
  windowDays: number
  scannedCount: number
  anomalies: AnomalyRow[]
}

const WINDOW_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
]

const REASON_LABELS: Record<AnomalyReason, string> = {
  RATE_ANOMALY: 'Engagement > impressions',
  HISTORICAL_SPIKE: 'Spike vs history',
}

const SPIKE_CAP = 999

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

export default function AnomaliesClient() {
  const [windowDays, setWindowDays] = useState(7)
  const [rows, setRows] = useState<AnomalyRow[]>([])
  const [scannedCount, setScannedCount] = useState(0)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function load(nextWindow: number) {
    setError(null)
    setLoaded(false)
    try {
      const res = await fetch(
        `/api/v1/admin/looks/velocity-anomalies?windowDays=${nextWindow}`,
      )
      if (!res.ok) throw new Error(await readError(res))
      const data = (await res.json()) as AnomalyResponse
      setRows(data.anomalies)
      setScannedCount(data.scannedCount)
      setGeneratedAt(data.generatedAt)
      setLoaded(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Loading anomalies failed.')
      setLoaded(true)
    }
  }

  useEffect(() => {
    startTransition(() => load(7))
  }, [])

  const generatedLabel = formatDate(generatedAt)

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
          {pending ? 'Scanning…' : 'Refresh'}
        </button>
        <a
          href="/admin/looks"
          className="rounded-card border border-white/15 bg-bgPrimary px-3 py-2 text-[12px] font-black text-textPrimary transition hover:border-white/30"
        >
          Looks moderation
        </a>
        {loaded && !error ? (
          <span className="text-[11px] text-textSecondary">
            {rows.length} flagged · {scannedCount} scanned
            {generatedLabel ? ` · ${generatedLabel}` : ''}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3 text-[12px] text-toneDanger">{error}</div>
      ) : null}

      <div className="mt-5 grid gap-3">
        {rows.map((row) => (
          <AnomalyCard key={row.lookPostId} row={row} windowDays={windowDays} />
        ))}

        {loaded && rows.length === 0 && !error ? (
          <div className="rounded-card border border-white/10 bg-bgPrimary/40 p-4 text-[13px] text-textSecondary">
            No anomalies in this window. Either engagement is tracking impressions
            honestly, or there isn’t enough recent activity to flag.
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ReasonBadge({ reason }: { reason: AnomalyReason }) {
  return (
    <span className="rounded-card border border-toneDanger/50 px-2 py-0.5 text-[11px] font-black uppercase text-toneDanger">
      {REASON_LABELS[reason] ?? reason}
    </span>
  )
}

function AnomalyCard({
  row,
  windowDays,
}: {
  row: AnomalyRow
  windowDays: number
}) {
  const dateLabel = formatDate(row.createdAt)
  const spikeLabel =
    row.spikeMultiple >= SPIKE_CAP
      ? 'from dormant'
      : `${row.spikeMultiple.toFixed(1)}×`

  return (
    <div className="rounded-card border border-toneDanger/40 bg-bgPrimary/20 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[14px] font-black">{row.proLabel}</span>
          {row.proHandle ? (
            <span className="ml-2 text-[12px] text-textSecondary">
              @{row.proHandle}
            </span>
          ) : null}
          {dateLabel ? (
            <span className="ml-2 text-[12px] text-textSecondary">
              · posted {dateLabel}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {row.reasons.map((r) => (
            <ReasonBadge key={r} reason={r} />
          ))}
        </div>
      </div>

      {row.caption ? (
        <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-[13px] text-textSecondary">
          {row.caption}
        </div>
      ) : null}

      <div className="mt-2 text-[12px] text-textPrimary">
        {row.windowSaves} saves · {row.windowLikes} likes ·{' '}
        {row.windowImpressions} impressions in {windowDays}d
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-textSecondary">
        {row.reasons.includes('RATE_ANOMALY') ? (
          <span>
            Engagement/impression ratio{' '}
            <span className="font-black text-toneDanger">
              {row.rateRatio.toFixed(2)}×
            </span>{' '}
            (honest looks stay well under 1×)
          </span>
        ) : null}
        {row.reasons.includes('HISTORICAL_SPIKE') ? (
          <span>
            Spike{' '}
            <span className="font-black text-toneDanger">{spikeLabel}</span> vs
            the look’s prior daily rate
          </span>
        ) : null}
        <span>severity {row.severity.toFixed(2)}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={`/looks/${row.lookPostId}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-card border border-white/15 bg-bgPrimary px-3 py-1.5 text-[12px] font-black text-textPrimary transition hover:border-white/30"
        >
          View look
        </a>
        <a
          href="/admin/looks"
          className="rounded-card border border-white/15 bg-bgPrimary px-3 py-1.5 text-[12px] font-black text-textPrimary transition hover:border-white/30"
        >
          Review pro
        </a>
      </div>
    </div>
  )
}
