'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type Block = { id: string; startAt: string; endAt: string; reason: string | null }

type Initial = {
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
  // ✅ include offering id so we can create openings later using offeringId
  offerings: { id: string; serviceId: string; name: string; basePrice: string }[]
}

function isMoney(v: string) {
  return /^\d+(\.\d{1,2})?$/.test(v.trim())
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtRange(startIso: string, endIso: string) {
  const s = new Date(startIso)
  const e = new Date(endIso)
  const left = s.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  const right = e.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' })
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
      style={{
        padding: '8px 12px',
        borderRadius: 999,
        border: on ? '1px solid #111' : '1px solid #e5e7eb',
        background: on ? '#111' : '#fff',
        color: on ? '#fff' : '#111',
        fontWeight: 900,
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {on ? labelOn : labelOff}
    </button>
  )
}

export default function LastMinuteSettingsClient({ initial }: { initial: Initial }) {
  const router = useRouter()

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

  // Blocks UI state
  const [blocks, setBlocks] = useState<Block[]>(initial.settings.blocks ?? [])

  const [blockStart, setBlockStart] = useState(() => {
    const d = new Date()
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 1)
    return toLocalInputValue(d)
  })

  const [blockEnd, setBlockEnd] = useState(() => {
    const d = new Date()
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 2)
    return toLocalInputValue(d)
  })

  const [blockReason, setBlockReason] = useState('')

  const ruleByService = useMemo(() => {
    const m = new Map<string, { enabled: boolean; minPrice: string | null }>()
    for (const r of initial.settings.serviceRules) m.set(r.serviceId, { enabled: r.enabled, minPrice: r.minPrice })
    return m
  }, [initial.settings.serviceRules])

  // ✅ De-dupe offerings into one row per serviceId (rules are per service)
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
      const s = new Date(blockStart)
      const e = new Date(blockEnd)
      if (isNaN(+s) || isNaN(+e) || s >= e) throw new Error('Block end must be after start.')

      const res = await fetch('/api/pro/last-minute/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startAt: s.toISOString(),
          endAt: e.toISOString(),
          reason: blockReason.trim() || null,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || `Add block failed (${res.status})`)

      setBlocks((prev) => [...prev, data.block].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)))
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

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Main settings */}
      <div style={{ border: '1px solid #eee', borderRadius: 14, padding: 12, background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 900 }}>Last-minute bookings</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Fill gaps without discount-begging. You control eligibility, windows, and blocks.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <TogglePill
              on={enabled}
              disabled={busy}
              labelOn="Enabled"
              labelOff="Disabled"
              onClick={() => {
                const next = !enabled
                setEnabled(next)
                saveSettings({ enabled: next })
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
                saveSettings({ discountsEnabled: next })
              }}
            />
          </div>
        </div>

        {/* Discount window inputs (only when discounts are on) */}
        {enabled && discountsEnabled ? (
          <div style={{ marginTop: 12, display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr 1fr' }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Same-day %</span>
              <input
                value={sameDay}
                disabled={busy}
                inputMode="numeric"
                onChange={(e) => setSameDay(e.target.value)}
                onBlur={() => {
                  const n = Math.trunc(Number(sameDay))
                  if (!Number.isFinite(n) || n < 0 || n > 50) return setErr('Same-day % must be 0–50')
                  saveSettings({ windowSameDayPct: n })
                }}
                style={{ border: '1px solid #ddd', borderRadius: 10, padding: 10 }}
              />
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Within 24h %</span>
              <input
                value={w24}
                disabled={busy}
                inputMode="numeric"
                onChange={(e) => setW24(e.target.value)}
                onBlur={() => {
                  const n = Math.trunc(Number(w24))
                  if (!Number.isFinite(n) || n < 0 || n > 50) return setErr('24h % must be 0–50')
                  saveSettings({ window24hPct: n })
                }}
                style={{ border: '1px solid #ddd', borderRadius: 10, padding: 10 }}
              />
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Global min price (optional)</span>
              <input
                value={minPrice}
                disabled={busy}
                placeholder="e.g. 80"
                inputMode="decimal"
                onChange={(e) => setMinPrice(e.target.value)}
                onBlur={() => {
                  const v = minPrice.trim()
                  if (!v) return saveSettings({ minPrice: null })
                  if (!isMoney(v)) return setErr('Min price must be like 80 or 79.99')
                  saveSettings({ minPrice: v })
                }}
                style={{ border: '1px solid #ddd', borderRadius: 10, padding: 10 }}
              />
            </label>
          </div>
        ) : (
          <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
            {enabled
              ? 'Discounts are currently OFF. Last-minute can still exist as “access”, without changing prices.'
              : 'Last-minute is OFF. Turn it on to configure windows, discounts, and blocks.'}
          </div>
        )}

        {/* Day disables */}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Disable last-minute on days</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
            ).map(([key, label]) => {
              const on = (days as any)[key]
              return (
                <button
                  key={key}
                  type="button"
                  disabled={busy || !enabled}
                  onClick={() => {
                    const next = { ...days, [key]: !on }
                    setDays(next)
                    saveSettings({ [key]: !on })
                  }}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 999,
                    border: on ? '1px solid #111' : '1px solid #e5e7eb',
                    background: on ? '#111' : '#fff',
                    color: on ? '#fff' : '#111',
                    fontWeight: 800,
                    cursor: busy || !enabled ? 'default' : 'pointer',
                    opacity: enabled ? 1 : 0.6,
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {err ? <div style={{ marginTop: 10, fontSize: 12, color: '#b91c1c' }}>{err}</div> : null}
      </div>

      {/* Eligible services */}
      <div style={{ border: '1px solid #eee', borderRadius: 14, padding: 12, background: '#fff' }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Eligible services</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
          Toggle which services can be booked last-minute. (Rules are per service, not per offering.)
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          {services.map((s) => {
            const rule = ruleByService.get(s.serviceId)
            const ruleEnabled = rule ? rule.enabled : true

            return (
              <div
                key={s.serviceId}
                style={{
                  border: '1px solid #eee',
                  borderRadius: 12,
                  padding: 10,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  alignItems: 'center',
                  background: '#fff',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.name}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Base price: ${s.basePrice}</div>
                </div>

                <button
                  type="button"
                  disabled={busy || !enabled}
                  onClick={() => saveRule(s.serviceId, { enabled: !ruleEnabled })}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 999,
                    border: ruleEnabled ? '1px solid #111' : '1px solid #e5e7eb',
                    background: ruleEnabled ? '#111' : '#fff',
                    color: ruleEnabled ? '#fff' : '#111',
                    fontWeight: 900,
                    cursor: busy || !enabled ? 'default' : 'pointer',
                    whiteSpace: 'nowrap',
                    opacity: enabled ? 1 : 0.6,
                  }}
                >
                  {ruleEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Blocks */}
      <div style={{ border: '1px solid #eee', borderRadius: 14, padding: 12, background: '#fff' }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Blocks</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
          Block specific time ranges from ever being offered as last-minute.
        </div>

        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>Start</span>
            <input
              type="datetime-local"
              value={blockStart}
              disabled={busy || !enabled}
              onChange={(e) => setBlockStart(e.target.value)}
              style={{ border: '1px solid #ddd', borderRadius: 10, padding: 10, opacity: enabled ? 1 : 0.7 }}
            />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>End</span>
            <input
              type="datetime-local"
              value={blockEnd}
              disabled={busy || !enabled}
              onChange={(e) => setBlockEnd(e.target.value)}
              style={{ border: '1px solid #ddd', borderRadius: 10, padding: 10, opacity: enabled ? 1 : 0.7 }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
          <input
            value={blockReason}
            disabled={busy || !enabled}
            onChange={(e) => setBlockReason(e.target.value)}
            placeholder="Reason (optional)"
            style={{
              flex: 1,
              border: '1px solid #ddd',
              borderRadius: 10,
              padding: 10,
              opacity: enabled ? 1 : 0.7,
            }}
          />

          <button
            type="button"
            disabled={busy || !enabled}
            onClick={addBlock}
            style={{
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid #111',
              background: '#111',
              color: '#fff',
              fontWeight: 900,
              cursor: busy || !enabled ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
              opacity: enabled ? 1 : 0.6,
            }}
          >
            Add block
          </button>
        </div>

        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {blocks.length === 0 ? (
            <div style={{ fontSize: 12, color: '#6b7280' }}>No blocks yet.</div>
          ) : (
            blocks.map((b) => (
              <div
                key={b.id}
                style={{
                  border: '1px solid #eee',
                  borderRadius: 12,
                  padding: 10,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  alignItems: 'center',
                  background: '#fff',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{fmtRange(b.startAt, b.endAt)}</div>
                  {b.reason ? <div style={{ fontSize: 12, color: '#6b7280' }}>{b.reason}</div> : null}
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeBlock(b.id)}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 999,
                    border: '1px solid #b91c1c',
                    background: '#fff',
                    color: '#b91c1c',
                    fontWeight: 900,
                    cursor: busy ? 'default' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        {err ? <div style={{ marginTop: 10, fontSize: 12, color: '#b91c1c' }}>{err}</div> : null}
      </div>

      {/* Future: Waitlist + visibility + deposit rules */}
      <div style={{ border: '1px dashed #e5e7eb', borderRadius: 14, padding: 12, background: '#fff' }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Coming next</div>
        <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.4 }}>
          Waitlist-first notifications, “hold slot” timers, deposits, and visibility controls (public vs waitlist-only).
          Luxury access, not a chaotic discount circus.
        </div>
      </div>
    </div>
  )
}
