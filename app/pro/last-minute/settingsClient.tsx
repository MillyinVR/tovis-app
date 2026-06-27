// app/pro/last-minute/settingsClient.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DEFAULT_TIME_ZONE,
  getZonedParts,
  isValidIanaTimeZone,
  sanitizeTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'
import {
  datetimeLocalToUtcIsoStrict,
  formatRangeInTimeZone,
  WALL_TIME_ERROR_MESSAGE,
  type WallTimeToUtcResult,
} from '@/lib/time'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'

type VisibilityMode = 'TARGETED_ONLY' | 'PUBLIC_AT_DISCOVERY' | 'PUBLIC_IMMEDIATE'

type Block = {
  id: string
  startAt: string
  endAt: string
  reason: string | null
}

type Initial = {
  timeZone?: string | null
  settings: {
    id: string
    enabled: boolean
    priorityOfferEnabled: boolean
    priorityOfferMinutes: number
    defaultVisibilityMode: VisibilityMode
    minCollectedSubtotal: string | null
    tier2NightBeforeMinutes: number
    tier3DayOfMinutes: number
    disableMon: boolean
    disableTue: boolean
    disableWed: boolean
    disableThu: boolean
    disableFri: boolean
    disableSat: boolean
    disableSun: boolean
    serviceRules: {
      serviceId: string
      enabled: boolean
      minCollectedSubtotal: string | null
    }[]
    blocks: Block[]
  }
  offerings: {
    id: string
    serviceId: string
    name: string
    basePrice: string
  }[]
}

type DaysState = Pick<
  Initial['settings'],
  'disableMon' | 'disableTue' | 'disableWed' | 'disableThu' | 'disableFri' | 'disableSat' | 'disableSun'
>

type SettingsPatch = Partial<
  Pick<
    Initial['settings'],
    | 'enabled'
    | 'priorityOfferEnabled'
    | 'priorityOfferMinutes'
    | 'defaultVisibilityMode'
    | 'minCollectedSubtotal'
    | 'tier2NightBeforeMinutes'
    | 'tier3DayOfMinutes'
  > &
    DaysState
>

type RulePatch = Partial<
  Pick<Initial['settings']['serviceRules'][number], 'enabled' | 'minCollectedSubtotal'>
>

function isMoney(v: string) {
  return /^\d+(\.\d{1,2})?$/.test(v.trim())
}

function apiErrorFrom(v: unknown): string | null {
  if (!isRecord(v)) return null
  if (v.ok !== false) return null
  return typeof v.error === 'string' && v.error.trim() ? v.error : null
}

function messageFromUnknown(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'string' && e.trim()) return e
  return 'Something went wrong'
}

function clampMinutes(n: number): number | null {
  if (!Number.isFinite(n)) return null
  const v = Math.trunc(n)
  if (v < 0 || v > 1439) return null
  return v
}

function toDatetimeLocalFromIso(isoUtc: string, timeZone: string) {
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return ''

  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
  const p = getZonedParts(d, tz)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

function datetimeLocalToIso(value: string, timeZone: string): WallTimeToUtcResult {
  return datetimeLocalToUtcIsoStrict(value, timeZone)
}

function fmtRangeInTimeZone(startIsoUtc: string, endIsoUtc: string, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
  return formatRangeInTimeZone(startIsoUtc, endIsoUtc, tz)
}

function fmtMinutesAsTime(minutes: number) {
  const safe = Math.max(0, Math.min(1439, Math.trunc(minutes)))
  const hh = String(Math.floor(safe / 60)).padStart(2, '0')
  const mm = String(safe % 60).padStart(2, '0')
  return `${hh}:${mm}`
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
        on
          ? 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary'
          : 'border-white/10 bg-bgPrimary text-textPrimary',
      ].join(' ')}
    >
      {on ? labelOn : labelOff}
    </button>
  )
}

function seedDatetimeLocalNowPlusMinutes(timeZone: string, plusMinutes: number) {
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
  const nowUtc = new Date()
  const p = getZonedParts(nowUtc, tz)

  const baseUtc = zonedTimeToUtc({
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour,
    minute: 0,
    second: 0,
    timeZone: tz,
  })

  const shifted = new Date(baseUtc.getTime() + plusMinutes * 60_000)
  return toDatetimeLocalFromIso(shifted.toISOString(), tz)
}

function isBlock(v: unknown): v is Block {
  if (!isRecord(v)) return false
  if (typeof v.id !== 'string' || !v.id.trim()) return false
  if (typeof v.startAt !== 'string' || !v.startAt.trim()) return false
  if (typeof v.endAt !== 'string' || !v.endAt.trim()) return false
  const r = v.reason
  return r === null || typeof r === 'string'
}

function unwrapBlockFromApi(payload: unknown): Block | null {
  if (!isRecord(payload)) return null
  if (payload.ok !== true) return null
  const maybeBlock = payload.block
  return isBlock(maybeBlock) ? maybeBlock : null
}

const dayDefs = [
  { key: 'disableMon', label: 'Mon' },
  { key: 'disableTue', label: 'Tue' },
  { key: 'disableWed', label: 'Wed' },
  { key: 'disableThu', label: 'Thu' },
  { key: 'disableFri', label: 'Fri' },
  { key: 'disableSat', label: 'Sat' },
  { key: 'disableSun', label: 'Sun' },
] satisfies ReadonlyArray<{ key: keyof DaysState; label: string }>

function dayPatch(key: keyof DaysState, value: boolean): SettingsPatch {
  switch (key) {
    case 'disableMon':
      return { disableMon: value }
    case 'disableTue':
      return { disableTue: value }
    case 'disableWed':
      return { disableWed: value }
    case 'disableThu':
      return { disableThu: value }
    case 'disableFri':
      return { disableFri: value }
    case 'disableSat':
      return { disableSat: value }
    case 'disableSun':
      return { disableSun: value }
  }
}

function visibilityLabel(mode: VisibilityMode) {
  if (mode === 'TARGETED_ONLY') return 'Targeted only'
  if (mode === 'PUBLIC_IMMEDIATE') return 'Public immediately'
  return 'Public at discovery'
}

export default function LastMinuteSettingsClient({ initial }: { initial: Initial }) {
  const router = useRouter()

  const timeZone = useMemo(() => {
    const raw = typeof initial?.timeZone === 'string' ? initial.timeZone.trim() : ''
    if (raw && isValidIanaTimeZone(raw)) return raw
    return DEFAULT_TIME_ZONE
  }, [initial?.timeZone])

  const tzLabel = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [enabled, setEnabled] = useState(initial.settings.enabled)
  const [priorityOfferEnabled, setPriorityOfferEnabled] = useState(
    initial.settings.priorityOfferEnabled,
  )
  const [priorityOfferMinutes, setPriorityOfferMinutes] = useState(
    String(initial.settings.priorityOfferMinutes),
  )
  const [defaultVisibilityMode, setDefaultVisibilityMode] = useState<VisibilityMode>(
    initial.settings.defaultVisibilityMode,
  )
  const [minCollectedSubtotal, setMinCollectedSubtotal] = useState(
    initial.settings.minCollectedSubtotal ?? '',
  )
  const [tier2NightBeforeMinutes, setTier2NightBeforeMinutes] = useState(
    String(initial.settings.tier2NightBeforeMinutes),
  )
  const [tier3DayOfMinutes, setTier3DayOfMinutes] = useState(
    String(initial.settings.tier3DayOfMinutes),
  )

  const [days, setDays] = useState<DaysState>({
    disableMon: initial.settings.disableMon,
    disableTue: initial.settings.disableTue,
    disableWed: initial.settings.disableWed,
    disableThu: initial.settings.disableThu,
    disableFri: initial.settings.disableFri,
    disableSat: initial.settings.disableSat,
    disableSun: initial.settings.disableSun,
  })

  const [blocks, setBlocks] = useState<Block[]>(initial.settings.blocks ?? [])
  const [blockStart, setBlockStart] = useState(() => seedDatetimeLocalNowPlusMinutes(timeZone, 60))
  const [blockEnd, setBlockEnd] = useState(() => seedDatetimeLocalNowPlusMinutes(timeZone, 120))
  const [blockReason, setBlockReason] = useState('')

  const ruleByService = useMemo(() => {
    const m = new Map<string, { enabled: boolean; minCollectedSubtotal: string | null }>()
    for (const r of initial.settings.serviceRules) {
      m.set(r.serviceId, {
        enabled: r.enabled,
        minCollectedSubtotal: r.minCollectedSubtotal,
      })
    }
    return m
  }, [initial.settings.serviceRules])

  const services = useMemo(() => {
    const m = new Map<string, { serviceId: string; name: string; basePrice: string }>()
    for (const o of initial.offerings) {
      if (!m.has(o.serviceId)) {
        m.set(o.serviceId, {
          serviceId: o.serviceId,
          name: o.name,
          basePrice: o.basePrice,
        })
      }
    }
    return Array.from(m.values())
  }, [initial.offerings])

  async function saveSettings(patch: SettingsPatch) {
    setBusy(true)
    setErr(null)

    try {
      const res = await fetch('/api/v1/pro/last-minute/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(apiErrorFrom(data) ?? `Save failed (${res.status})`)
      router.refresh()
    } catch (e) {
      setErr(messageFromUnknown(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveRule(serviceId: string, patch: RulePatch) {
    setBusy(true)
    setErr(null)

    try {
      const res = await fetch('/api/v1/pro/last-minute/rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId, ...patch }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(apiErrorFrom(data) ?? `Save failed (${res.status})`)
      router.refresh()
    } catch (e) {
      setErr(messageFromUnknown(e))
    } finally {
      setBusy(false)
    }
  }

  async function addBlock() {
    setBusy(true)
    setErr(null)

    try {
      const startRes = datetimeLocalToIso(blockStart, timeZone)
      const endRes = datetimeLocalToIso(blockEnd, timeZone)

      if (!startRes.ok) {
        throw new Error(WALL_TIME_ERROR_MESSAGE[startRes.reason])
      }
      if (!endRes.ok) {
        throw new Error(WALL_TIME_ERROR_MESSAGE[endRes.reason])
      }
      const startIso = startRes.iso
      const endIso = endRes.iso
      if (+new Date(endIso) <= +new Date(startIso)) {
        throw new Error('Block end must be after start.')
      }

      const res = await fetch('/api/v1/pro/last-minute/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startAt: startIso,
          endAt: endIso,
          reason: blockReason.trim() || null,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(apiErrorFrom(data) ?? `Add block failed (${res.status})`)

      const newBlock = unwrapBlockFromApi(data)
      if (!newBlock) throw new Error('Unexpected response while creating block.')

      setBlocks((prev) =>
        [...prev, newBlock].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)),
      )
      setBlockReason('')
      setBlockStart(seedDatetimeLocalNowPlusMinutes(timeZone, 60))
      setBlockEnd(seedDatetimeLocalNowPlusMinutes(timeZone, 120))
      router.refresh()
    } catch (e) {
      setErr(messageFromUnknown(e))
    } finally {
      setBusy(false)
    }
  }

  async function removeBlock(id: string) {
    setBusy(true)
    setErr(null)

    try {
      const res = await fetch(`/api/v1/pro/last-minute/blocks?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(apiErrorFrom(data) ?? `Remove failed (${res.status})`)
      setBlocks((prev) => prev.filter((b) => b.id !== id))
      router.refresh()
    } catch (e) {
      setErr(messageFromUnknown(e))
    } finally {
      setBusy(false)
    }
  }

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
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-[220px]">
            <div className="text-[14px] font-black text-textPrimary">Last-minute defaults</div>
            <div className={`${hint} mt-1`}>
              Set the default visibility, floor protection, tier anchors, and blocked days for last-minute openings.
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
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="grid gap-2">
            <span className={label}>Default visibility</span>
            <select
              value={defaultVisibilityMode}
              disabled={busy || !enabled}
              onChange={(e) => {
                const next = e.target.value as VisibilityMode
                setDefaultVisibilityMode(next)
                void saveSettings({ defaultVisibilityMode: next })
              }}
              className={field}
            >
              <option value="TARGETED_ONLY">{visibilityLabel('TARGETED_ONLY')}</option>
              <option value="PUBLIC_AT_DISCOVERY">{visibilityLabel('PUBLIC_AT_DISCOVERY')}</option>
              <option value="PUBLIC_IMMEDIATE">{visibilityLabel('PUBLIC_IMMEDIATE')}</option>
            </select>
          </label>

          <label className="grid gap-2">
            <span className={label}>Minimum collected subtotal</span>
            <input
              value={minCollectedSubtotal}
              disabled={busy || !enabled}
              placeholder="e.g. 80 or 79.99"
              inputMode="decimal"
              onChange={(e) => setMinCollectedSubtotal(e.target.value)}
              onBlur={() => {
                const v = minCollectedSubtotal.trim()
                if (!v) {
                  void saveSettings({ minCollectedSubtotal: null })
                  return
                }
                if (!isMoney(v)) {
                  setErr('Minimum collected subtotal must be like 80 or 79.99')
                  return
                }
                setErr(null)
                void saveSettings({ minCollectedSubtotal: v })
              }}
              className={field}
            />
          </label>

          <div className="grid gap-2">
            <span className={label}>Current mode</span>
            <div className="rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] font-semibold text-textSecondary">
              {visibilityLabel(defaultVisibilityMode)}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className={label}>Tier 2 night-before anchor (minutes after midnight)</span>
            <input
              value={tier2NightBeforeMinutes}
              disabled={busy || !enabled}
              inputMode="numeric"
              onChange={(e) => setTier2NightBeforeMinutes(e.target.value)}
              onBlur={() => {
                const n = clampMinutes(Number(tier2NightBeforeMinutes))
                if (n == null) {
                  setErr('Tier 2 minutes must be a whole number from 0 to 1439.')
                  return
                }
                setErr(null)
                setTier2NightBeforeMinutes(String(n))
                void saveSettings({ tier2NightBeforeMinutes: n })
              }}
              className={field}
            />
            <span className={hint}>Current local anchor: {fmtMinutesAsTime(Number(tier2NightBeforeMinutes) || 0)}</span>
          </label>

          <label className="grid gap-2">
            <span className={label}>Tier 3 day-of anchor (minutes after midnight)</span>
            <input
              value={tier3DayOfMinutes}
              disabled={busy || !enabled}
              inputMode="numeric"
              onChange={(e) => setTier3DayOfMinutes(e.target.value)}
              onBlur={() => {
                const n = clampMinutes(Number(tier3DayOfMinutes))
                if (n == null) {
                  setErr('Tier 3 minutes must be a whole number from 0 to 1439.')
                  return
                }
                setErr(null)
                setTier3DayOfMinutes(String(n))
                void saveSettings({ tier3DayOfMinutes: n })
              }}
              className={field}
            />
            <span className={hint}>Current local anchor: {fmtMinutesAsTime(Number(tier3DayOfMinutes) || 0)}</span>
          </label>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-bgPrimary/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-[220px]">
              <div className="text-[13px] font-black text-textPrimary">
                Priority offers for your waitlist
              </div>
              <div className={`${hint} mt-1`}>
                Offer last-minute openings to waitlist clients one at a time in
                join order, instead of notifying everyone at once. Each client
                gets a private window to claim before it passes to the next.
              </div>
            </div>

            <TogglePill
              on={priorityOfferEnabled}
              disabled={busy || !enabled}
              labelOn="Priority offers on"
              labelOff="Notify all at once"
              onClick={() => {
                const next = !priorityOfferEnabled
                setPriorityOfferEnabled(next)
                void saveSettings({ priorityOfferEnabled: next })
              }}
            />
          </div>

          {priorityOfferEnabled ? (
            <label className="mt-4 grid max-w-[320px] gap-2">
              <span className={label}>Claim window (minutes)</span>
              <input
                value={priorityOfferMinutes}
                disabled={busy || !enabled}
                inputMode="numeric"
                onChange={(e) => setPriorityOfferMinutes(e.target.value)}
                onBlur={() => {
                  const n = Math.trunc(Number(priorityOfferMinutes))
                  if (!Number.isFinite(n) || n < 5 || n > 120) {
                    setErr('Claim window must be a whole number from 5 to 120 minutes.')
                    return
                  }
                  setErr(null)
                  setPriorityOfferMinutes(String(n))
                  void saveSettings({ priorityOfferMinutes: n })
                }}
                className={field}
              />
              <span className={hint}>
                How long each client has to claim before the offer moves on. 5–120 minutes.
              </span>
            </label>
          ) : null}
        </div>

        <div className="mt-4">
          <div className={`${hint} mb-2`}>Disable last-minute on days</div>
          <div className="flex flex-wrap gap-2">
            {dayDefs.map(({ key, label: dayLabel }) => {
              const on = days[key]
              const classes = on
                ? 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary'
                : 'border-white/10 bg-bgPrimary text-textPrimary'

              return (
                <button
                  key={key}
                  type="button"
                  disabled={busy || !enabled}
                  onClick={() => {
                    const nextValue = !on
                    const nextDays: DaysState = { ...days, [key]: nextValue }
                    setDays(nextDays)
                    void saveSettings(dayPatch(key, nextValue))
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

      <section className={card}>
        <div className="text-[14px] font-black text-textPrimary">Service eligibility</div>
        <div className={`${hint} mt-1`}>
          Last-minute rules are per service. Enable or disable each service and set an optional minimum collected subtotal.
        </div>

        <div className="mt-4 grid gap-3">
          {services.map((service) => {
            const rule = ruleByService.get(service.serviceId)
            const ruleEnabled = rule ? rule.enabled : true
            const initialRuleMin = rule?.minCollectedSubtotal ?? ''

            return (
              <ServiceRuleRow
                key={service.serviceId}
                busy={busy}
                enabled={enabled}
                label={service.name}
                basePrice={service.basePrice}
                ruleEnabled={ruleEnabled}
                initialMinCollectedSubtotal={initialRuleMin}
                onToggle={() => void saveRule(service.serviceId, { enabled: !ruleEnabled })}
                onSaveMinCollectedSubtotal={(value) => void saveRule(service.serviceId, { minCollectedSubtotal: value })}
              />
            )
          })}
        </div>
      </section>

      <section className={card}>
        <div className="text-[14px] font-black text-textPrimary">Blocks</div>
        <div className={`${hint} mt-1`}>
          Block specific time ranges from ever being offered as last-minute openings.
        </div>

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
    </div>
  )
}

function ServiceRuleRow({
  busy,
  enabled,
  label,
  basePrice,
  ruleEnabled,
  initialMinCollectedSubtotal,
  onToggle,
  onSaveMinCollectedSubtotal,
}: {
  busy: boolean
  enabled: boolean
  label: string
  basePrice: string
  ruleEnabled: boolean
  initialMinCollectedSubtotal: string
  onToggle: () => void
  onSaveMinCollectedSubtotal: (value: string | null) => void
}) {
  const [minCollectedSubtotal, setMinCollectedSubtotal] = useState(initialMinCollectedSubtotal)

  const hint = 'text-[12px] font-semibold text-textSecondary'
  const field =
    'w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary/70 focus:outline-none focus:ring-2 focus:ring-accentPrimary/40 disabled:opacity-60'

  return (
    <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-black text-textPrimary truncate">{label}</div>
          <div className={hint}>Base price: ${basePrice}</div>
        </div>

        <button
          type="button"
          disabled={busy || !enabled}
          onClick={onToggle}
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

      <div className="mt-3">
        <label className="grid gap-2">
          <span className="text-[12px] font-black text-textPrimary">Minimum collected subtotal</span>
          <input
            value={minCollectedSubtotal}
            disabled={busy || !enabled}
            placeholder="Leave blank to inherit global floor"
            inputMode="decimal"
            onChange={(e) => setMinCollectedSubtotal(e.target.value)}
            onBlur={() => {
              const v = minCollectedSubtotal.trim()
              if (!v) {
                onSaveMinCollectedSubtotal(null)
                return
              }
              if (!isMoney(v)) {
                return
              }
              onSaveMinCollectedSubtotal(v)
            }}
            className={field}
          />
        </label>
      </div>
    </div>
  )
}