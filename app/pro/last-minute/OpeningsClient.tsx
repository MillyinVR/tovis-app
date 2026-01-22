// app/pro/last-minute/OpeningsClient.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getZonedParts, isValidIanaTimeZone, sanitizeTimeZone, zonedTimeToUtc } from '@/lib/timeZone'

type OfferingLite = {
  id: string
  serviceId: string
  name: string
  basePrice: string
}

type Props = {
  offerings: OfferingLite[]
}

type OpeningRow = {
  id: string
  status: string
  startAt: string
  endAt: string | null
  discountPct: number | null
  note: string | null
  offeringId: string | null
  serviceId: string | null
  service?: { name: string } | null
  offering?: { title: string | null } | null
  _count?: { notifications?: number }
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function getBrowserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz && isValidIanaTimeZone(tz)) return tz
  } catch {
    // ignore
  }
  return 'UTC'
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function parseDatetimeLocal(value: string) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { year, month, day, hour, minute }
}

function toDatetimeLocalFromIso(isoUtc: string, timeZone: string) {
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return ''
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const p = getZonedParts(d, tz)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

function datetimeLocalToIso(value: string, timeZone: string) {
  const parts = parseDatetimeLocal(value)
  if (!parts) return null
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const utc = zonedTimeToUtc({ ...parts, second: 0, timeZone: tz })
  return Number.isNaN(utc.getTime()) ? null : utc.toISOString()
}

function prettyWhenInTimeZone(isoUtc: string, timeZone: string) {
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return 'Invalid date'
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

export default function OpeningsClient({ offerings }: Props) {
  const router = useRouter()

  // Standard: datetime-local is a wall-clock input in browser TZ.
  const timeZone = useMemo(() => getBrowserTimeZone(), [])

  const [items, setItems] = useState<OpeningRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // form state
  const defaultOfferingId = offerings[0]?.id ?? ''
  const [offeringId, setOfferingId] = useState(defaultOfferingId)

  const [startAtLocal, setStartAtLocal] = useState(() => {
    // seed: next top-of-hour in browser TZ, but store as datetime-local string
    const now = new Date()
    now.setSeconds(0, 0)
    now.setMinutes(0)
    now.setHours(now.getHours() + 1)
    return toDatetimeLocalFromIso(now.toISOString(), timeZone)
  })

  const [endAtLocal, setEndAtLocal] = useState(() => {
    const now = new Date()
    now.setSeconds(0, 0)
    now.setMinutes(0)
    now.setHours(now.getHours() + 2)
    return toDatetimeLocalFromIso(now.toISOString(), timeZone)
  })

  const [useEndAt, setUseEndAt] = useState(true)
  const [discountPct, setDiscountPct] = useState<string>('') // optional
  const [note, setNote] = useState('')

  const offeringLabelById = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of offerings) m.set(o.id, `${o.name} · $${o.basePrice}`)
    return m
  }, [offerings])

  async function loadOpenings() {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch('/api/pro/openings?hours=48&take=100', { cache: 'no-store' })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to load openings.')
      const list = Array.isArray(data?.openings) ? (data.openings as OpeningRow[]) : []
      list.sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt))
      setItems(list)
    } catch (e: any) {
      setErr(e?.message || 'Failed to load openings.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadOpenings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createOpening() {
    if (busy) return
    setBusy(true)
    setErr(null)

    try {
      if (!offeringId) throw new Error('Pick an offering first.')

      const startIso = datetimeLocalToIso(startAtLocal, timeZone)
      if (!startIso) throw new Error('Start time is invalid.')

      let endIso: string | null = null
      if (useEndAt) {
        endIso = datetimeLocalToIso(endAtLocal, timeZone)
        if (!endIso) throw new Error('End time is invalid.')
        if (+new Date(endIso) <= +new Date(startIso)) throw new Error('End must be after start.')
      }

      let dPct: number | null = null
      if (discountPct.trim()) {
        const n = Number(discountPct)
        if (!Number.isFinite(n)) throw new Error('Discount must be a number.')
        dPct = clampInt(n, 0, 80)
      }

      const res = await fetch('/api/pro/openings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offeringId,
          startAt: startIso,
          endAt: endIso,
          discountPct: dPct,
          note: note.trim() || null,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to create opening.')

      setNote('')
      setDiscountPct('')
      await loadOpenings()
      router.refresh()
    } catch (e: any) {
      setErr(e?.message || 'Failed to create opening.')
    } finally {
      setBusy(false)
    }
  }

  async function notifyOpening(openingId: string) {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/openings/${encodeURIComponent(openingId)}/notify`, { method: 'POST' })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Notify failed.')
      await loadOpenings()
      router.refresh()
    } catch (e: any) {
      setErr(e?.message || 'Notify failed.')
    } finally {
      setBusy(false)
    }
  }

  async function cancelOpening(openingId: string) {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/pro/openings?id=${encodeURIComponent(openingId)}`, { method: 'DELETE' })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Remove failed.')
      setItems((prev) => prev.filter((x) => x.id !== openingId))
      router.refresh()
    } catch (e: any) {
      setErr(e?.message || 'Remove failed.')
    } finally {
      setBusy(false)
    }
  }

  // Branding tokens (matches the rest of your pro UI)
  const card = 'tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4'
  const label = 'text-[12px] font-black text-textPrimary'
  const hint = 'text-[12px] font-semibold text-textSecondary'
  const field =
    'w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary/70 focus:outline-none focus:ring-2 focus:ring-accentPrimary/40 disabled:opacity-60'
  const btnPrimary =
    'rounded-full border border-accentPrimary/60 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-60'
  const btnGhost =
    'rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass disabled:opacity-60'
  const btnDanger =
    'rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-toneDanger hover:bg-surfaceGlass disabled:opacity-60'

  return (
    <div className="grid gap-3">
      {/* Create */}
      <section className={card}>
        <div className="text-[14px] font-black text-textPrimary">Create a last-minute opening</div>
        <div className={`${hint} mt-1`}>
          Add a slot in the next 48 hours. Notify queues eligible clients. Humans love feeling chosen.
        </div>

        <div className="mt-4 grid gap-4">
          <label className="grid gap-2">
            <span className={label}>Offering</span>
            <select
              value={offeringId}
              disabled={busy || offerings.length === 0}
              onChange={(e) => setOfferingId(e.target.value)}
              className={field}
            >
              {offerings.length === 0 ? <option value="">No active offerings</option> : null}
              {offerings.map((o) => (
                <option key={o.id} value={o.id}>
                  {offeringLabelById.get(o.id) || o.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className={label}>Start</span>
              <input
                type="datetime-local"
                value={startAtLocal}
                disabled={busy}
                onChange={(e) => setStartAtLocal(e.target.value)}
                className={field}
              />
            </label>

            <label className="grid gap-2">
              <span className={label}>End {useEndAt ? '' : '(optional)'}</span>
              <input
                type="datetime-local"
                value={endAtLocal}
                disabled={busy || !useEndAt}
                onChange={(e) => setEndAtLocal(e.target.value)}
                className={[field, !useEndAt ? 'opacity-60' : ''].join(' ')}
              />
            </label>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useEndAt}
              disabled={busy}
              onChange={() => setUseEndAt((v) => !v)}
              className="accent-accentPrimary"
            />
            <span className="text-[12px] font-semibold text-textPrimary">Include an end time</span>
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2 md:col-span-1">
              <span className={label}>Discount % (optional)</span>
              <input
                value={discountPct}
                disabled={busy}
                inputMode="numeric"
                placeholder="e.g. 10"
                onChange={(e) => setDiscountPct(e.target.value)}
                className={field}
              />
            </label>

            <label className="grid gap-2 md:col-span-2">
              <span className={label}>Note (optional)</span>
              <input
                value={note}
                disabled={busy}
                placeholder="e.g. Perfect for trims"
                onChange={(e) => setNote(e.target.value)}
                className={field}
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-textSecondary">
              Times shown in <span className="font-black">{sanitizeTimeZone(timeZone, 'UTC')}</span>
            </div>

            <button type="button" disabled={busy || offerings.length === 0} onClick={createOpening} className={btnPrimary}>
              {busy ? 'Working…' : 'Create opening'}
            </button>
          </div>

          {err ? <div className="text-[12px] font-black text-toneDanger">{err}</div> : null}
        </div>
      </section>

      {/* List */}
      <section className={card}>
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[14px] font-black text-textPrimary">Your openings</div>
          <button type="button" disabled={loading || busy} onClick={loadOpenings} className={btnGhost}>
            Refresh
          </button>
        </div>

        <div className={`${hint} mt-1`}>Next 48 hours. Use “Notify clients” to queue eligible recipients.</div>

        <div className="mt-4 grid gap-3">
          {loading ? (
            <div className={hint}>Loading…</div>
          ) : items.length === 0 ? (
            <div className={hint}>No openings yet.</div>
          ) : (
            items.map((o) => {
              const when = prettyWhenInTimeZone(o.startAt, timeZone)
              const svc =
                o.service?.name ||
                (o.offeringId ? offeringLabelById.get(o.offeringId)?.split(' · ')[0] : null) ||
                o.offering?.title ||
                'Service'

              const disc = o.discountPct != null ? `${o.discountPct}% off` : null
              const status = String(o.status || 'UNKNOWN').toUpperCase()
              const notifCount = o._count?.notifications ?? 0

              return (
                <div key={o.id} className="rounded-card border border-white/10 bg-bgPrimary p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-black text-textPrimary truncate">{svc}</div>
                      <div className="text-[12px] font-semibold text-textSecondary">
                        {when} · {sanitizeTimeZone(timeZone, 'UTC')}
                      </div>
                    </div>

                    <div className="text-[12px] font-semibold text-textSecondary">
                      {status}
                      {notifCount ? ` · ${notifCount} notified` : ''}
                    </div>
                  </div>

                  {disc || o.note ? (
                    <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                      {disc ? <span>{disc}</span> : null}
                      {disc && o.note ? <span> · </span> : null}
                      {o.note ? <span>{o.note}</span> : null}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      disabled={busy || status !== 'ACTIVE'}
                      onClick={() => notifyOpening(o.id)}
                      className={btnPrimary}
                    >
                      Notify clients
                    </button>

                    <button type="button" disabled={busy} onClick={() => cancelOpening(o.id)} className={btnDanger}>
                      Remove
                    </button>
                  </div>
                </div>
              )
            })
          )}

          {err ? <div className="text-[12px] font-black text-toneDanger">{err}</div> : null}
        </div>
      </section>
    </div>
  )
}
