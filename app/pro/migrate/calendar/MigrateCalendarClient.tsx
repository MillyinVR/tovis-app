'use client'

// app/pro/migrate/calendar/MigrateCalendarClient.tsx
//
// Real calendar import: upload a competitor .ics export → POST /preview to
// classify each event (booking / blocked time / client history / skipped) →
// review + optionally exclude rows → POST /commit. Server types are type-only
// imports (erased at build), so node-ical never reaches the client bundle.

import { useMemo, useRef, useState } from 'react'

import type { MigrationCopy } from '@/lib/brand/defaultMigrationCopy'
import type {
  CalendarCommitResult,
  CalendarImportPreview,
  CalendarPreviewRow,
} from '@/lib/migration/calendarImportServer'

import { MigrationStepper } from '../_components/MigrationStepper'
import { StatusChip } from '../_components/StatusChip'
import { SummaryBar, type SummaryStat } from '../_components/SummaryBar'
import { ToggleSwitch } from '../_components/ToggleSwitch'

type Phase = 'upload' | 'review' | 'done'

type Props = { copy: MigrationCopy['calendar'] }

const CLASSIFICATION_LABEL: Record<CalendarPreviewRow['classification'], string> = {
  BOOKING: 'Appointment',
  BLOCK: 'Time blocked',
  HISTORY: 'Client history',
  SKIP: 'Skipped',
}

function chipVariant(
  classification: CalendarPreviewRow['classification'],
): 'accent' | 'gold' | 'muted' {
  if (classification === 'BOOKING' || classification === 'HISTORY') return 'accent'
  if (classification === 'BLOCK') return 'gold'
  return 'muted'
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function MigrateCalendarClient({ copy }: Props) {
  const [phase, setPhase] = useState<Phase>('upload')
  const [icsText, setIcsText] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [rows, setRows] = useState<CalendarPreviewRow[]>([])
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CalendarCommitResult | null>(null)
  const [keepSynced, setKeepSynced] = useState(true)
  // The feed URL the events came from (null for a file upload) — only a URL
  // source can be kept in sync.
  const [syncUrl, setSyncUrl] = useState<string | null>(null)
  const [synced, setSynced] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function runPreview(text: string): Promise<void> {
    if (!text.trim()) {
      setError('That calendar looks empty. Check the export and try again.')
      return
    }
    const res = await fetch('/api/pro/migrate/calendar/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ics: text }),
    })
    const data: (CalendarImportPreview & { ok?: boolean; error?: string }) | null =
      await res.json().catch(() => null)
    if (!res.ok || !data || !data.rows) {
      setError(data?.error ?? 'We could not read that calendar.')
      return
    }
    if (data.rows.length === 0) {
      setError('No appointments were found.')
      return
    }
    setIcsText(text)
    setRows(data.rows)
    setExcluded(new Set())
    setPhase('review')
  }

  async function handleFile(file: File): Promise<void> {
    setError(null)
    setBusy(true)
    setSyncUrl(null) // a file upload can't be kept in sync
    try {
      await runPreview(await file.text())
    } catch {
      setError('We could not read that calendar file.')
    } finally {
      setBusy(false)
    }
  }

  async function handleUrl(): Promise<void> {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/pro/migrate/calendar/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: feedUrl }),
      })
      const data: { ok?: boolean; ics?: string; error?: string } | null = await res
        .json()
        .catch(() => null)
      if (!res.ok || !data?.ics) {
        setError(data?.error ?? 'We could not fetch that calendar URL.')
        return
      }
      setSyncUrl(feedUrl)
      await runPreview(data.ics)
    } catch {
      setError('We could not fetch that calendar URL.')
    } finally {
      setBusy(false)
    }
  }

  function toggleExcluded(uid: string, include: boolean): void {
    setExcluded((cur) => {
      const next = new Set(cur)
      if (include) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  async function commit(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/pro/migrate/calendar/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ics: icsText, excludeUids: [...excluded] }),
      })
      const data: (CalendarCommitResult & { ok?: boolean; error?: string }) | null =
        await res.json().catch(() => null)
      if (!res.ok || !data || !data.created) {
        setError(data?.error ?? 'Something went wrong importing your calendar.')
        return
      }
      setResult(data)
      setPhase('done')

      // If the source was a feed URL and the pro opted in, keep it synced.
      if (syncUrl && keepSynced) {
        const subRes = await fetch('/api/pro/migrate/calendar/subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: syncUrl }),
        })
        setSynced(subRes.ok)
      }
    } catch {
      setError('Something went wrong importing your calendar.')
    } finally {
      setBusy(false)
    }
  }

  const activeRows = useMemo(
    () => rows.filter((r) => r.classification !== 'SKIP'),
    [rows],
  )

  const stats: SummaryStat[] = useMemo(() => {
    const live = rows.filter((r) => !excluded.has(r.uid))
    const count = (c: CalendarPreviewRow['classification']) =>
      live.filter((r) => r.classification === c).length
    return [
      { value: String(count('BOOKING')), label: 'appointments', tone: 'accent' },
      { value: String(count('BLOCK')), label: 'time blocked', tone: 'gold' },
      { value: String(count('HISTORY')), label: 'history', tone: 'muted' },
    ]
  }, [rows, excluded])

  return (
    <div className="min-h-screen text-textPrimary">
      <div className="mx-auto w-full max-w-5xl px-4 pt-8 pb-28">
        <MigrationStepper active="calendar" />

        <header className="mt-6">
          <h1 className="font-display text-[28px] font-medium tracking-[-0.02em]">
            {copy.title}
          </h1>
        </header>

        {error ? (
          <p className="mt-4 rounded-card border border-amber/40 bg-amber/10 px-4 py-3 text-[13px] text-amber">
            {error}
          </p>
        ) : null}

        {phase === 'upload' ? (
          <div className="mt-6 rounded-card border border-dashed border-white/15 bg-bgSurface p-8 text-center">
            <p className="text-[15px] text-textPrimary">
              Upload your calendar export (.ics)
            </p>
            <p className="mx-auto mt-2 max-w-md text-[13px] text-textMuted">
              Export your appointments from your current booking app as an .ics
              file, then upload it here. We&rsquo;ll match each appointment to your
              menu, hold blocked time, and build your client history.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".ics,text/calendar"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="mt-5 rounded-full bg-accentPrimary px-5 py-2 text-[14px] font-medium text-bgBase disabled:opacity-50"
            >
              {busy ? 'Reading…' : 'Choose .ics file'}
            </button>

            <div className="mx-auto mt-7 flex max-w-md items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-textMuted">
              <span className="h-px flex-1 bg-white/10" />
              or paste a feed link
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <p className="mx-auto mt-3 max-w-md text-[13px] text-textMuted">
              Most booking apps offer a read-only calendar &ldquo;subscribe&rdquo;
              link. Paste it here and we&rsquo;ll pull it in — no file needed.
            </p>
            <div className="mx-auto mt-3 flex max-w-md flex-col gap-2 sm:flex-row">
              <input
                type="url"
                inputMode="url"
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                placeholder="https://…/calendar.ics"
                className="flex-1 rounded-inner border border-white/10 bg-white/[0.03] px-3 py-2 text-[14px] text-textPrimary placeholder:text-textMuted focus:border-accentPrimary/40 focus:outline-none"
              />
              <button
                type="button"
                disabled={busy || !feedUrl.trim()}
                onClick={() => void handleUrl()}
                className="rounded-full border border-white/15 px-5 py-2 text-[14px] font-medium text-textPrimary disabled:opacity-50"
              >
                {busy ? 'Fetching…' : 'Fetch'}
              </button>
            </div>
            <label className="mx-auto mt-3 flex max-w-md items-center gap-2 text-[12px] text-textMuted">
              <input
                type="checkbox"
                checked={keepSynced}
                onChange={(e) => setKeepSynced(e.target.checked)}
                className="h-4 w-4 accent-accentPrimary"
              />
              Keep this calendar synced — pull new appointments automatically
              while you finish moving over.
            </label>
          </div>
        ) : null}

        {phase === 'review' ? (
          <>
            <p className="mt-5 text-[13px] text-textMuted">
              Review what will happen. Turn off any row you don&rsquo;t want to
              import.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {activeRows.map((row) => {
                const included = !excluded.has(row.uid)
                return (
                  <div
                    key={row.uid}
                    className={[
                      'rounded-card border bg-bgSurface p-4 transition',
                      included ? 'border-white/10' : 'border-white/10 opacity-60',
                    ].join(' ')}
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.2fr_1.4fr_auto_auto] md:items-center">
                      <div className="text-[13px] text-textPrimary">
                        {formatWhen(row.start)}
                      </div>
                      <div className="text-[13px]">
                        <p className="text-textPrimary">
                          {row.clientName ?? (row.summary || 'Untitled')}
                        </p>
                        <p className="text-textMuted">{row.reason}</p>
                      </div>
                      <div>
                        <StatusChip variant={chipVariant(row.classification)}>
                          {CLASSIFICATION_LABEL[row.classification]}
                        </StatusChip>
                      </div>
                      <div className="flex md:justify-end">
                        <ToggleSwitch
                          on={included}
                          onChange={(v) => toggleExcluded(row.uid, v)}
                          label={`Import ${row.summary || 'appointment'}`}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <SummaryBar
              stats={stats}
              cta={{
                label: busy ? 'Importing…' : copy.cta,
                disabled: busy,
                onClick: () => void commit(),
              }}
            />
          </>
        ) : null}

        {phase === 'done' && result ? (
          <div className="mt-6 rounded-card border border-accentPrimary/30 bg-accentPrimary/5 p-6">
            <p className="text-[16px] font-medium text-textPrimary">
              Your calendar is imported.
            </p>
            <div className="mt-4 flex flex-wrap gap-6 text-[13px]">
              <span>
                <span className="font-display text-[22px] text-accentPrimary">
                  {result.created.bookings}
                </span>{' '}
                <span className="text-textMuted">appointments</span>
              </span>
              <span>
                <span className="font-display text-[22px] text-amber">
                  {result.created.blocks}
                </span>{' '}
                <span className="text-textMuted">time blocked</span>
              </span>
              <span>
                <span className="font-display text-[22px] text-textPrimary">
                  {result.created.history}
                </span>{' '}
                <span className="text-textMuted">client history</span>
              </span>
              {result.failed > 0 ? (
                <span>
                  <span className="font-display text-[22px] text-textMuted">
                    {result.failed}
                  </span>{' '}
                  <span className="text-textMuted">couldn&rsquo;t import</span>
                </span>
              ) : null}
            </div>
            {synced ? (
              <p className="mt-4 text-[13px] text-accentPrimary">
                ✓ Calendar kept in sync — we&rsquo;ll pull new appointments
                automatically until you disconnect.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
