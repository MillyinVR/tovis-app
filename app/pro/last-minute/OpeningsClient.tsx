'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

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

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function prettyWhen(iso: string) {
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

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

export default function OpeningsClient({ offerings }: Props) {
  const router = useRouter()

  const [items, setItems] = useState<OpeningRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // form state
  const defaultOfferingId = offerings[0]?.id ?? ''
  const [offeringId, setOfferingId] = useState(defaultOfferingId)

  const [startAt, setStartAt] = useState(() => {
    const d = new Date()
    d.setSeconds(0, 0)
    d.setMinutes(0)
    d.setHours(d.getHours() + 1)
    return toLocalInputValue(d)
  })

  const [endAt, setEndAt] = useState(() => {
    const d = new Date()
    d.setSeconds(0, 0)
    d.setMinutes(0)
    d.setHours(d.getHours() + 2)
    return toLocalInputValue(d)
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
      // Keep it stable + sorted
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
    loadOpenings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createOpening() {
    if (busy) return
    setBusy(true)
    setErr(null)

    try {
      if (!offeringId) throw new Error('Pick an offering first.')

      const s = new Date(startAt)
      if (Number.isNaN(s.getTime())) throw new Error('Start time is invalid.')

      let e: Date | null = null
      if (useEndAt) {
        e = new Date(endAt)
        if (Number.isNaN(e.getTime())) throw new Error('End time is invalid.')
        if (+e <= +s) throw new Error('End must be after start.')
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
          startAt: s.toISOString(),
          endAt: e ? e.toISOString() : null,
          discountPct: dPct,
          note: note.trim() || null,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to create opening.')

      // Reset lightweight inputs
      setNote('')
      setDiscountPct('')
      // Reload so the list includes service/offering joins + counts
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
      // optimistic remove is fine here
      setItems((prev) => prev.filter((x) => x.id !== openingId))
      router.refresh()
    } catch (e: any) {
      setErr(e?.message || 'Remove failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Create */}
      <div style={{ border: '1px solid #eee', borderRadius: 14, padding: 12, background: '#fff' }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Create a last-minute opening</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
          Add a slot in the next 48 hours. If you notify, we queue eligible clients. Humans love being “selected.”
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>Offering</span>
            <select
              value={offeringId}
              disabled={busy || offerings.length === 0}
              onChange={(e) => setOfferingId(e.target.value)}
              style={{ border: '1px solid #ddd', borderRadius: 10, padding: 10, background: '#fff' }}
            >
              {offerings.length === 0 ? <option value="">No active offerings</option> : null}
              {offerings.map((o) => (
                <option key={o.id} value={o.id}>
                  {offeringLabelById.get(o.id) || o.name}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Start</span>
              <input
                type="datetime-local"
                value={startAt}
                disabled={busy}
                onChange={(e) => setStartAt(e.target.value)}
                style={{ border: '1px solid #ddd', borderRadius: 10, padding: 10 }}
              />
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>End {useEndAt ? '' : '(optional)'}</span>
              <input
                type="datetime-local"
                value={endAt}
                disabled={busy || !useEndAt}
                onChange={(e) => setEndAt(e.target.value)}
                style={{ border: '1px solid #ddd', borderRadius: 10, padding: 10, opacity: useEndAt ? 1 : 0.6 }}
              />
            </label>
          </div>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={useEndAt}
              disabled={busy}
              onChange={() => setUseEndAt((v) => !v)}
            />
            <span style={{ fontSize: 12, color: '#111' }}>Include an end time</span>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Discount % (optional)</span>
              <input
                value={discountPct}
                disabled={busy}
                inputMode="numeric"
                placeholder="e.g. 10"
                onChange={(e) => setDiscountPct(e.target.value)}
                style={{ border: '1px solid #ddd', borderRadius: 10, padding: 10 }}
              />
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Note (optional)</span>
              <input
                value={note}
                disabled={busy}
                placeholder="e.g. ‘Perfect for trims’"
                onChange={(e) => setNote(e.target.value)}
                style={{ border: '1px solid #ddd', borderRadius: 10, padding: 10 }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              disabled={busy || offerings.length === 0}
              onClick={createOpening}
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid #111',
                background: '#111',
                color: '#fff',
                fontWeight: 900,
                cursor: busy || offerings.length === 0 ? 'not-allowed' : 'pointer',
                opacity: busy || offerings.length === 0 ? 0.6 : 1,
              }}
            >
              {busy ? 'Working…' : 'Create opening'}
            </button>
          </div>

          {err ? <div style={{ fontSize: 12, color: '#b91c1c' }}>{err}</div> : null}
        </div>
      </div>

      {/* List */}
      <div style={{ border: '1px solid #eee', borderRadius: 14, padding: 12, background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontWeight: 900 }}>Your openings</div>
          <button
            type="button"
            disabled={loading || busy}
            onClick={loadOpenings}
            style={{
              all: 'unset',
              cursor: loading || busy ? 'default' : 'pointer',
              fontSize: 12,
              fontWeight: 900,
              color: '#111',
              opacity: loading || busy ? 0.6 : 1,
            }}
          >
            Refresh
          </button>
        </div>

        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6, marginBottom: 10 }}>
          Next 48 hours. Use “Notify clients” to queue eligible recipients.
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: '#6b7280' }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ fontSize: 12, color: '#6b7280' }}>No openings yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {items.map((o) => {
              const when = prettyWhen(o.startAt)
              const svc =
                o.service?.name ||
                (o.offeringId ? offeringLabelById.get(o.offeringId)?.split(' · ')[0] : null) ||
                o.offering?.title ||
                'Service'

              const disc = o.discountPct != null ? `${o.discountPct}% off` : null
              const status = String(o.status || 'UNKNOWN')
              const notifCount = o._count?.notifications ?? 0

              return (
                <div
                  key={o.id}
                  style={{
                    border: '1px solid #eee',
                    borderRadius: 12,
                    padding: 10,
                    display: 'grid',
                    gap: 8,
                    background: '#fff',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                    <div style={{ fontWeight: 900, fontSize: 13, minWidth: 0 }}>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{svc}</span>
                      <span style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>{when}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {status}
                      {notifCount ? ` · ${notifCount} notified` : ''}
                    </div>
                  </div>

                  {disc || o.note ? (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {disc ? <span>{disc}</span> : null}
                      {disc && o.note ? <span> · </span> : null}
                      {o.note ? <span>{o.note}</span> : null}
                    </div>
                  ) : null}

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={busy || status !== 'ACTIVE'}
                      onClick={() => notifyOpening(o.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 999,
                        border: '1px solid #111',
                        background: '#111',
                        color: '#fff',
                        fontWeight: 900,
                        fontSize: 12,
                        cursor: busy || status !== 'ACTIVE' ? 'not-allowed' : 'pointer',
                        opacity: busy || status !== 'ACTIVE' ? 0.5 : 1,
                      }}
                    >
                      Notify clients
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => cancelOpening(o.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 999,
                        border: '1px solid #b91c1c',
                        background: '#fff',
                        color: '#b91c1c',
                        fontWeight: 900,
                        fontSize: 12,
                        cursor: busy ? 'not-allowed' : 'pointer',
                        opacity: busy ? 0.6 : 1,
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {err ? <div style={{ marginTop: 10, fontSize: 12, color: '#b91c1c' }}>{err}</div> : null}
      </div>
    </div>
  )
}
