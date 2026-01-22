'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getZonedParts, isValidIanaTimeZone, sanitizeTimeZone, zonedTimeToUtc } from '@/lib/timeZone'

type Block = { id: string; startAt: string; endAt: string; reason: string | null }

type Initial = {
  timeZone?: string | null // ✅ PRO timezone (schedule owner)
  settings: {
    id: string
    enabled: boolean
    discountsEnabled: boolean
    windowSameDayPct: number
    window24hPct: number
    minPrice: string | null
    disableMon: boolean
    disableTue: boolean
    disableWed: boolean
    disableThu: boolean
    disableFri: boolean
    disableSat: boolean
    disableSun: boolean
    serviceRules: { serviceId: string; enabled: boolean; minPrice: string | null }[]
    blocks: Block[]
  }
  offerings: { id: string; serviceId: string; name: string; basePrice: string }[]
}

function isMoney(v: string) {
  return /^\d+(\.\d{1,2})?$/.test(v.trim())
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function clampPct(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return null
  const v = Math.trunc(n)
  return Math.max(min, Math.min(max, v))
}

/**
 * datetime-local has no timezone.
 * We treat it as a wall-clock time in `timeZone` (PRO TZ),
 * and convert using zonedTimeToUtc.
 */
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

function fmtRangeInTimeZone(startIsoUtc: string, endIsoUtc: string, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const s = new Date(startIsoUtc)
  const e = new Date(endIsoUtc)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 'Invalid range'

  const left = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(s)

  const right = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
  }).format(e)

  return `${left} → ${right}`
}

function TogglePill({
  on,
  disabled,
  labelOn,
  labelOff,
  onClick,
}: {
  on: boolean
  disabled?: boolean
  labelOn: string
  labelOff: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        'rounded-full px-4 py-2 text-[12px] font-black transition border',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-surfaceGlass',
        on ? 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary' : 'border-white/10 bg-bgPrimary text-textPrimary',
      ].join(' ')}
    >
      {on ? labelOn : labelOff}
    </button>
  )
}

export default function LastMinuteSettingsClient({ initial }: { initial: Initial }) {
  const router = useRouter()

  // ✅ PRO TIMEZONE is truth. Browser TZ is not.
  const timeZone = useMemo(() => {
    const raw = typeof initial?.timeZone === 'string' ? initial.timeZone.trim() : ''
    if (raw && isValidIanaTimeZone(raw)) return raw
    return 'America/Los_Angeles' // safe default for your MVP, but ideally always present
  }, [initial?.timeZone])

  const tzLabel = sanitizeTimeZone(timeZone, 'UTC')

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [enabled, setEnabled] = useState(initial.settings.enabled)
  const [discountsEnabled, setDiscountsEnabled] = useState(initial.settings.discountsEnabled)

  const [sameDay, setSameDay] = useState(String(initial.settings.windowSameDayPct))
  const [w24, setW24] = useState(String(initial.settings.window24hPct))
  const [minPrice, setMinPrice] = useState(initial.settings.minPrice ?? '')

  const [days, setDays] = useState({
    disableMon: initial.settings.disableMon,
    disableTue: initial.settings.disableTue,
    disableWed: initial.settings.disableWed,
    disableThu: initial.settings.disableThu,
    disableFri: initial.settings.disableFri,
    disableSat: initial.settings.disableSat,
    disableSun: initial.settings.disableSun,
  })

  const [blocks, setBlocks] = useState<Block[]>(initial.settings.blocks ?? [])

  // Seed defaults in PRO TZ, not browser TZ
  const [blockStart, setBlockStart] = useState(() => {
    const now = new Date()
    now.setSeconds(0, 0)
    now.setMinutes(0)
    now.setHours(now.getHours() + 1)
    return toDatetimeLocalFromIso(now.toISOString(), timeZone)
  })

  const [blockEnd, setBlockEnd] = useState(() => {
    const now = new Date()
    now.setSeconds(0, 0)
    now.setMinutes(0)
    now.setHours(now.getHours() + 2)
    return toDatetimeLocalFromIso(now.toISOString(), timeZone)
  })

  const [blockReason, setBlockReason] = useState('')

  const ruleByService = useMemo(() => {
    const m = new Map<string, { enabled: boolean; minPrice: string | null }>()
    for (const r of initial.settings.serviceRules) m.set(r.serviceId, { enabled: r.enabled, minPrice: r.minPrice })
    return m
  }, [initial.settings.serviceRules])

  // De-dupe offerings into one row per serviceId (rules are per service)
  const services = useMemo(() => {
    const m = new Map<string, { serviceId: string; name: string; basePrice: string }>()
    for (const o of initial.offerings) {
      if (!m.has(o.serviceId)) m.set(o.serviceId, { serviceId: o.serviceId, name: o.name, basePrice: o.basePrice })
    }
    return Array.from(m.values())
  }, [initial.offerings])

  async function saveSettings(patch: any) {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/pro/last-minute/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || `Save failed (${res.status})`)
      router.refresh()
    } catch (e: any) {
      setErr(e?.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function saveRule(serviceId: string, patch: any) {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/pro/last-minute/rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId, ...patch }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || `Save failed (${res.status})`)
      router.refresh()
    } catch (e: any) {
      setErr(e?.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function addBlock() {
    setBusy(true)
    setErr(null)
    try {
      const startIso = datetimeLocalToIso(blockStart, timeZone)
      const endIso = datetimeLocalToIso(blockEnd, timeZone)
      if (!startIso || !endIso) throw new Error('Pick valid start and end times.')
      if (+new Date(endIso) <= +new Date(startIso)) throw new Error('Block end must be after start.')

      const res = await fetch('/api/pro/last-minute/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startAt: startIso,
          endAt: endIso,
          reason: blockReason.trim() || null,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || `Add block failed (${res.status})`)

      const newBlock = (data?.block ?? data) as Block
      setBlocks((prev) => [...prev, newBlock].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)))
      setBlockReason('')
      router.refresh()
    } catch (e: any) {
      setErr(e?.message || 'Add block failed')
    } finally {
      setBusy(false)
    }
  }

  async function removeBlock(id: string) {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/pro/last-minute/blocks?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || `Remove failed (${res.status})`)
      setBlocks((prev) => prev.filter((b) => b.id !== id))
      router.refresh()
    } catch (e: any) {
      setErr(e?.message || 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  // Branding tokens
  const card = 'tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4'
  const label = 'text-[12px] font-black text-textPrimary'
  const hint = 'text-[12px] font-semibold text-textSecondary'
  const field =
    'w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary/70 focus:outline-none focus:ring-2 focus:ring-accentPrimary/40 disabled:opacity-60'
  const btnPrimary =
    'rounded-full border border-accentPrimary/60 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-60'
  const btnDanger =
    'rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-toneDanger hover:bg-surfaceGlass disabled:opacity-60'

  return (
    <div className="grid gap-3">
      {/* Main settings */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-220px">
            <div className="text-[14px] font-black text-textPrimary">Last-minute bookings</div>
            <div className={`${hint} mt-1`}>
              Fill gaps without discount-begging. You control eligibility, windows, and blocks.
            </div>
            <div className={`${hint} mt-2`}>
              Times are interpreted in <span className="font-black">{tzLabel}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <TogglePill
              on={enabled}
              disabled={busy}
              labelOn="Enabled"
              labelOff="Disabled"
              onClick={() => {
                const next = !enabled
                setEnabled(next)
                void saveSettings({ enabled: next })
              }}
            />

            <TogglePill
              on={discountsEnabled}
              disabled={busy || !enabled}
              labelOn="Discounts ON"
              labelOff="Discounts OFF"
              onClick={() => {
                const next = !discountsEnabled
                setDiscountsEnabled(next)
                void saveSettings({ discountsEnabled: next })
              }}
            />
          </div>
        </div>

        {/* Discount window inputs */}
        {enabled && discountsEnabled ? (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className={label}>Same-day %</span>
              <input
                value={sameDay}
                disabled={busy}
                inputMode="numeric"
                onChange={(e) => setSameDay(e.target.value)}
                onBlur={() => {
                  const n = clampPct(Number(sameDay), 0, 50)
                  if (n == null) return setErr('Same-day % must be a number.')
                  setErr(null)
                  void saveSettings({ windowSameDayPct: n })
                }}
                className={field}
              />
            </label>

            <label className="grid gap-2">
              <span className={label}>Within 24h %</span>
              <input
                value={w24}
                disabled={busy}
                inputMode="numeric"
                onChange={(e) => setW24(e.target.value)}
                onBlur={() => {
                  const n = clampPct(Number(w24), 0, 50)
                  if (n == null) return setErr('24h % must be a number.')
                  setErr(null)
                  void saveSettings({ window24hPct: n })
                }}
                className={field}
              />
            </label>

            <label className="grid gap-2">
              <span className={label}>Global min price (optional)</span>
              <input
                value={minPrice}
                disabled={busy}
                placeholder="e.g. 80"
                inputMode="decimal"
                onChange={(e) => setMinPrice(e.target.value)}
                onBlur={() => {
                  const v = minPrice.trim()
                  if (!v) return void saveSettings({ minPrice: null })
                  if (!isMoney(v)) return setErr('Min price must be like 80 or 79.99')
                  setErr(null)
                  void saveSettings({ minPrice: v })
                }}
                className={field}
              />
            </label>
          </div>
        ) : (
          <div className={`${hint} mt-4`}>
            {enabled
              ? 'Discounts are OFF. Last-minute can still work as “access” without changing prices.'
              : 'Last-minute is OFF. Turn it on to configure windows, discounts, and blocks.'}
          </div>
        )}

        {/* Day disables */}
        <div className="mt-4">
          <div className={`${hint} mb-2`}>Disable last-minute on days</div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['disableMon', 'Mon'],
                ['disableTue', 'Tue'],
                ['disableWed', 'Wed'],
                ['disableThu', 'Thu'],
                ['disableFri', 'Fri'],
                ['disableSat', 'Sat'],
                ['disableSun', 'Sun'],
              ] as const
            ).map(([key, dayLabel]) => {
              const on = (days as any)[key] as boolean
              const classes = on
                ? 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary'
                : 'border-white/10 bg-bgPrimary text-textPrimary'
              return (
                <button
                  key={key}
                  type="button"
                  disabled={busy || !enabled}
                  onClick={() => {
                    const next = { ...days, [key]: !on }
                    setDays(next)
                    void saveSettings({ [key]: !on })
                  }}
                  className={[
                    'rounded-full border px-3 py-2 text-[12px] font-black transition',
                    classes,
                    busy || !enabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-surfaceGlass',
                  ].join(' ')}
                >
                  {dayLabel}
                </button>
              )
            })}
          </div>
        </div>

        {err ? <div className="mt-3 text-[12px] font-black text-toneDanger">{err}</div> : null}
      </section>

      {/* Eligible services */}
      <section className={card}>
        <div className="text-[14px] font-black text-textPrimary">Eligible services</div>
        <div className={`${hint} mt-1`}>
          Toggle which services can be booked last-minute. (Rules are per service, not per offering.)
        </div>

        <div className="mt-4 grid gap-3">
          {services.map((s) => {
            const rule = ruleByService.get(s.serviceId)
            const ruleEnabled = rule ? rule.enabled : true

            return (
              <div
                key={s.serviceId}
                className="rounded-card border border-white/10 bg-bgPrimary p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-black text-textPrimary truncate">{s.name}</div>
                  <div className={hint}>Base price: ${s.basePrice}</div>
                </div>

                <button
                  type="button"
                  disabled={busy || !enabled}
                  onClick={() => void saveRule(s.serviceId, { enabled: !ruleEnabled })}
                  className={[
                    'rounded-full border px-4 py-2 text-[12px] font-black transition',
                    ruleEnabled
                      ? 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary'
                      : 'border-white/10 bg-bgPrimary text-textPrimary',
                    busy || !enabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-surfaceGlass',
                  ].join(' ')}
                >
                  {ruleEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* Blocks */}
      <section className={card}>
        <div className="text-[14px] font-black text-textPrimary">Blocks</div>
        <div className={`${hint} mt-1`}>Block specific time ranges from ever being offered as last-minute.</div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className={label}>Start</span>
            <input
              type="datetime-local"
              value={blockStart}
              disabled={busy || !enabled}
              onChange={(e) => setBlockStart(e.target.value)}
              className={field}
            />
          </label>

          <label className="grid gap-2">
            <span className={label}>End</span>
            <input
              type="datetime-local"
              value={blockEnd}
              disabled={busy || !enabled}
              onChange={(e) => setBlockEnd(e.target.value)}
              className={field}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
          <input
            value={blockReason}
            disabled={busy || !enabled}
            onChange={(e) => setBlockReason(e.target.value)}
            placeholder="Reason (optional)"
            className={field}
          />

          <button type="button" disabled={busy || !enabled} onClick={addBlock} className={btnPrimary}>
            Add block
          </button>
        </div>

        <div className="mt-4 grid gap-2">
          {blocks.length === 0 ? (
            <div className={hint}>No blocks yet.</div>
          ) : (
            blocks.map((b) => (
              <div
                key={b.id}
                className="rounded-card border border-white/10 bg-bgPrimary p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-black text-textPrimary">
                    {fmtRangeInTimeZone(b.startAt, b.endAt, timeZone)}
                  </div>
                  {b.reason ? <div className={hint}>{b.reason}</div> : null}
                </div>

                <button type="button" disabled={busy} onClick={() => void removeBlock(b.id)} className={btnDanger}>
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        {err ? <div className="mt-3 text-[12px] font-black text-toneDanger">{err}</div> : null}
      </section>

      {/* Future */}
      <section className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4 opacity-90">
        <div className="text-[14px] font-black text-textPrimary">Coming next</div>
        <div className={`${hint} mt-1`}>
          Waitlist-first notifications, hold timers, deposits, and visibility controls (public vs waitlist-only). Luxury
          access, not a chaotic discount circus.
        </div>
      </section>
    </div>
  )
}
