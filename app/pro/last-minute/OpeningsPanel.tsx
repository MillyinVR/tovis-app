// app/pro/last-minute/OpeningsPanel.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { safeJsonRecord, readErrorMessage } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { pickStringOrEmpty } from '@/lib/pick'

type Offering = { id: string; name: string; basePrice: string; serviceId: string }

type Opening = {
  id: string
  startAt: string
  endAt: string | null
  status: string
  discountPct: number | null
  note: string | null
  offeringId: string | null
  serviceId: string | null
  offering: { id: string; title: string | null; durationMinutes: number; service: { name: string } } | null
  service: { id: string; name: string } | null
  _count?: { notifications: number }
}

function pretty(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Invalid date'
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function readArrayField(data: Record<string, unknown> | null, key: string): unknown[] {
  if (!data) return []
  const v = data[key]
  return Array.isArray(v) ? v : []
}

function readNumberField(data: Record<string, unknown> | null, key: string): number | null {
  if (!data) return null
  const v = data[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function parseOpening(x: unknown): Opening | null {
  if (!isRecord(x)) return null

  const id = pickStringOrEmpty(x.id)
  const startAt = pickStringOrEmpty(x.startAt)
  const status = pickStringOrEmpty(x.status)

  if (!id || !startAt || !status) return null

  const offeringId = asStringOrNull(x.offeringId)
  const serviceId = asStringOrNull(x.serviceId)

  const offering = (() => {
    if (!isRecord(x.offering)) return null
    const oid = pickStringOrEmpty(x.offering.id)
    const title = asStringOrNull(x.offering.title)
    const durationMinutes = typeof x.offering.durationMinutes === 'number' && Number.isFinite(x.offering.durationMinutes) ? x.offering.durationMinutes : 0
    const svc = isRecord(x.offering.service) ? x.offering.service : null
    const svcName = svc ? asStringOrNull(svc.name) : null
    if (!oid) return null
    return { id: oid, title, durationMinutes, service: { name: svcName ?? 'Service' } }
  })()

  const service = (() => {
    if (!isRecord(x.service)) return null
    const sid = pickStringOrEmpty(x.service.id)
    const name = asStringOrNull(x.service.name) ?? 'Service'
    if (!sid) return null
    return { id: sid, name }
  })()

  const count = (() => {
    if (!isRecord(x._count)) return undefined
    const n = asNumberOrNull(x._count.notifications) ?? 0
    return { notifications: n }
  })()

  return {
    id,
    startAt,
    endAt: asStringOrNull(x.endAt),
    status,
    discountPct: asNumberOrNull(x.discountPct),
    note: asStringOrNull(x.note),
    offeringId,
    serviceId,
    offering,
    service,
    _count: count,
  }
}

export default function OpeningsPanel({ offerings }: { offerings: Offering[] }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [items, setItems] = useState<Opening[]>([])

  // form state
  const [offeringId, setOfferingId] = useState(offerings[0]?.id ?? '')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [discountPct, setDiscountPct] = useState('')
  const [note, setNote] = useState('')

  const canSubmit = useMemo(() => Boolean(offeringId && startAt), [offeringId, startAt])

  async function loadOpenings() {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch('/api/pro/openings?days=7&take=50', { cache: 'no-store' })
      const data = await safeJsonRecord(res)

      if (!res.ok) throw new Error(readErrorMessage(data) ?? 'Failed to load openings')

      const openings = readArrayField(data, 'openings').map(parseOpening).filter(Boolean) as Opening[]
      setItems(openings)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load openings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadOpenings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createOpening() {
    if (!canSubmit) return
    setLoading(true)
    setErr(null)

    try {
      const start = new Date(startAt)
      if (Number.isNaN(start.getTime())) throw new Error('Start time is invalid.')

      const payload: {
        offeringId: string
        startAt: string
        endAt?: string
        discountPct?: number
        note?: string
      } = {
        offeringId,
        startAt: start.toISOString(),
      }

      if (endAt) {
        const end = new Date(endAt)
        if (Number.isNaN(end.getTime())) throw new Error('End time is invalid.')
        payload.endAt = end.toISOString()
      }

      const dpRaw = discountPct.trim()
      if (dpRaw) {
        const n = Number(dpRaw)
        if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Discount % must be a number from 0 to 100.')
        payload.discountPct = n
      }

      const noteTrim = note.trim()
      if (noteTrim) payload.note = noteTrim

      const res = await fetch('/api/pro/openings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await safeJsonRecord(res)
      if (!res.ok) throw new Error(readErrorMessage(data) ?? 'Failed to create opening')

      // reload list so we also get _count + selects
      setStartAt('')
      setEndAt('')
      setDiscountPct('')
      setNote('')
      await loadOpenings()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create opening')
    } finally {
      setLoading(false)
    }
  }

  async function notify(openingId: string) {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/openings/${encodeURIComponent(openingId)}/notify`, { method: 'POST' })
      const data = await safeJsonRecord(res)

      if (!res.ok) throw new Error(readErrorMessage(data) ?? 'Failed to notify')

      await loadOpenings()

      const created = readNumberField(data, 'created') ?? 0
      alert(`Notifications queued: ${created}`)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to notify')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section style={{ marginTop: 18, display: 'grid', gap: 12 }}>
      <div style={{ border: '1px solid #eee', borderRadius: 14, padding: 14, background: '#fff' }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Create last-minute opening</div>

        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Offering</div>
            <select
              value={offeringId}
              onChange={(e) => setOfferingId(e.target.value)}
              style={{ padding: 10, borderRadius: 10, border: '1px solid #ddd' }}
            >
              {offerings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · ${o.basePrice}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Start</div>
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                style={{ padding: 10, borderRadius: 10, border: '1px solid #ddd' }}
              />
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>End (optional)</div>
              <input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                style={{ padding: 10, borderRadius: 10, border: '1px solid #ddd' }}
              />
            </label>
          </div>

          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '140px 1fr' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Discount %</div>
              <input
                inputMode="numeric"
                value={discountPct}
                onChange={(e) => setDiscountPct(e.target.value)}
                placeholder="e.g. 10"
                style={{ padding: 10, borderRadius: 10, border: '1px solid #ddd' }}
              />
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Note (optional)</div>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. ‘Today only’"
                style={{ padding: 10, borderRadius: 10, border: '1px solid #ddd' }}
              />
            </label>
          </div>

          {err ? <div style={{ color: '#ef4444', fontSize: 13 }}>{err}</div> : null}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={createOpening}
              disabled={!canSubmit || loading}
              style={{
                borderRadius: 999,
                border: 'none',
                padding: '10px 14px',
                fontWeight: 900,
                background: '#111',
                color: '#fff',
                opacity: !canSubmit || loading ? 0.6 : 1,
                cursor: !canSubmit || loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '…' : 'Create opening'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ border: '1px solid #eee', borderRadius: 14, padding: 14, background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontWeight: 900 }}>Upcoming openings</div>
          <button
            type="button"
            onClick={loadOpenings}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#6b7280', fontSize: 13 }}
          >
            Refresh
          </button>
        </div>

        {!items.length ? (
          <div style={{ color: '#6b7280', fontSize: 13, marginTop: 10 }}>
            No openings yet. Create one, then weaponize the Notify button responsibly.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            {items.map((o) => {
              const svcName = o.offering?.title || o.offering?.service?.name || o.service?.name || 'Service'
              const when = pretty(o.startAt)
              const notifCount = o._count?.notifications ?? 0

              return (
                <div key={o.id} style={{ border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontWeight: 900 }}>{svcName}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{when}</div>
                  </div>

                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                    Status: <span style={{ fontWeight: 800, color: '#111' }}>{o.status}</span>
                    {o.discountPct != null ? <span> · {o.discountPct}% off</span> : null}
                    <span> · Notified: {notifCount}</span>
                  </div>

                  {o.note ? <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>{o.note}</div> : null}

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => notify(o.id)}
                      disabled={loading || o.status !== 'ACTIVE'}
                      style={{
                        borderRadius: 999,
                        border: '1px solid #111',
                        padding: '8px 12px',
                        fontSize: 12,
                        fontWeight: 900,
                        background: '#fff',
                        color: '#111',
                        opacity: loading || o.status !== 'ACTIVE' ? 0.5 : 1,
                        cursor: loading || o.status !== 'ACTIVE' ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Notify
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}