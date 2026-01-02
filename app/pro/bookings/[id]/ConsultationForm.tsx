// app/pro/bookings/[id]/ConsultationForm.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  bookingId: string
  initialNotes: string
  initialPrice: string | number | null
}

type ServiceOption = {
  offeringId: string
  serviceId: string
  serviceName: string
  categoryName: string | null
  defaultPrice: number | null
}

type LineItem = {
  key: string
  offeringId: string
  serviceId: string
  label: string
  categoryName: string | null
  price: string // keep as string for input control
}

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
}

function errorFromResponse(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (typeof data?.message === 'string') return data.message
  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

function normalizeMoneyInput(raw: string) {
  const s = String(raw || '')
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .trim()

  if (!s) return { value: null as string | null, ok: true }

  if (!/^\d*\.?\d{0,2}$/.test(s)) return { value: s, ok: false }

  const normalized = s.startsWith('.') ? `0${s}` : s
  if (normalized === '.' || normalized === '0.') return { value: null, ok: false }

  return { value: normalized, ok: true }
}

function sumMoneyStrings(items: Array<{ price: string }>) {
  let total = 0
  for (const it of items) {
    const p = normalizeMoneyInput(it.price)
    if (!p.ok || p.value == null) continue
    const n = Number(p.value)
    if (Number.isFinite(n)) total += n
  }
  // round to 2 decimals
  total = Math.round(total * 100) / 100
  return total
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16)
}

export default function ConsultationForm({ bookingId, initialNotes, initialPrice }: Props) {
  const router = useRouter()

  const [notes, setNotes] = useState(initialNotes || '')
  const [services, setServices] = useState<ServiceOption[]>([])
  const [items, setItems] = useState<LineItem[]>([])
  const [selectedOfferingId, setSelectedOfferingId] = useState<string>('')

  const [saving, setSaving] = useState(false)
  const [loadingServices, setLoadingServices] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  // Load offered services for this pro/booking
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoadingServices(true)
      setError(null)

      try {
        const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/consultation-services`, {
          cache: 'no-store',
        })
        const data = await safeJson(res)
        if (!res.ok) throw new Error(errorFromResponse(res, data))

        const list = Array.isArray(data?.services) ? (data.services as ServiceOption[]) : []
        if (!cancelled) {
          setServices(list)
          setSelectedOfferingId(list[0]?.offeringId || '')
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load services.')
      } finally {
        if (!cancelled) setLoadingServices(false)
      }
    }

    if (bookingId) load()
    return () => {
      cancelled = true
    }
  }, [bookingId])

  // Seed: if you previously had a plain consultation price, put it in one “Booking service” line item
  useEffect(() => {
    // Only seed once, and only if empty
    if (items.length) return

    const raw = initialPrice !== null && initialPrice !== undefined ? String(initialPrice) : ''
    const parsed = normalizeMoneyInput(raw)
    if (!parsed.ok || parsed.value == null) return

    // We don’t know the exact service label here without another fetch,
    // so we seed a generic line. The pro can replace it with real dropdown picks.
    setItems([
      {
        key: uid(),
        offeringId: '',
        serviceId: '',
        label: 'Consultation total (legacy)',
        categoryName: null,
        price: parsed.value,
      },
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrice])

  const total = useMemo(() => sumMoneyStrings(items), [items])
  const totalLabel = useMemo(() => `$${total.toFixed(2)}`, [total])

  function addSelectedService() {
    setError(null)
    setMessage(null)

    const opt = services.find((s) => s.offeringId === selectedOfferingId)
    if (!opt) {
      setError('Select a service to add.')
      return
    }

    setItems((prev) => [
      ...prev,
      {
        key: uid(),
        offeringId: opt.offeringId,
        serviceId: opt.serviceId,
        label: opt.serviceName,
        categoryName: opt.categoryName,
        price: opt.defaultPrice != null ? String(opt.defaultPrice.toFixed(2)) : '',
      },
    ])
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((x) => x.key !== key))
  }

  function updateItemPrice(key: string, price: string) {
    setItems((prev) =>
      prev.map((x) => (x.key === key ? { ...x, price } : x)),
    )
  }

  const itemsValid = useMemo(() => {
    if (!items.length) return false
    for (const it of items) {
      const p = normalizeMoneyInput(it.price)
      if (!p.ok || p.value == null) return false
    }
    return true
  }, [items])

  const canSubmit = Boolean(bookingId && !saving && itemsValid && total > 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)

    if (!bookingId) return setError('Missing booking id.')
    if (saving) return
    if (!items.length) return setError('Add at least one service.')
    if (!itemsValid) return setError('Fix the prices (numbers only, up to 2 decimals).')

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setSaving(true)

    try {
      // Build proposedServicesJson that is actually useful across the app.
      const proposedServicesJson = {
        currency: 'USD',
        items: items.map((it) => ({
          offeringId: it.offeringId || null,
          serviceId: it.serviceId || null,
          label: it.label,
          categoryName: it.categoryName || null,
          price: normalizeMoneyInput(it.price).value, // string number
        })),
      }

      const proposedTotal = total.toFixed(2)

      // One canonical call. Your existing /consultation already upserts approval + moves step.
      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/consultation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          notes,
          proposedTotal,
          proposedServicesJson,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      setMessage('Sent to client for approval.')
      router.refresh()
      router.push(`/pro/bookings/${encodeURIComponent(bookingId)}?step=consult`)
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error(err)
      setError('Network error sending consultation.')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        borderRadius: 12,
        border: '1px solid #eee',
        padding: 16,
        background: '#fff',
        display: 'grid',
        gap: 12,
        fontSize: 13,
      }}
    >
      {/* Service picker */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 800 }}>
            Services (what you’re actually doing)
          </label>
          <div style={{ fontSize: 12, fontWeight: 900, color: '#111' }}>
            Total: <span style={{ color: '#111' }}>{totalLabel}</span>
          </div>
        </div>

        {loadingServices ? (
          <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>Loading your services…</div>
        ) : services.length ? (
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={selectedOfferingId}
              disabled={saving}
              onChange={(e) => setSelectedOfferingId(e.target.value)}
              style={{
                borderRadius: 8,
                border: '1px solid #ddd',
                padding: '8px 10px',
                fontSize: 13,
                background: '#fff',
                minWidth: 280,
              }}
            >
              {services.map((s) => (
                <option key={s.offeringId} value={s.offeringId}>
                  {(s.categoryName ? `${s.categoryName} · ` : '') + s.serviceName}
                  {s.defaultPrice != null ? ` ($${s.defaultPrice.toFixed(2)})` : ''}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={addSelectedService}
              disabled={saving}
              style={{
                border: '1px solid #111',
                borderRadius: 999,
                padding: '8px 12px',
                fontSize: 12,
                fontWeight: 900,
                background: '#fff',
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              + Add
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 8, fontSize: 12, color: '#7f1d1d' }}>
            No services found for your profile. Add offerings before sending consult approvals.
          </div>
        )}
      </div>

      {/* Line items */}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.length ? (
          items.map((it) => {
            const parsed = normalizeMoneyInput(it.price)
            return (
              <div
                key={it.key}
                style={{
                  border: '1px solid #eee',
                  borderRadius: 10,
                  padding: 10,
                  background: '#fafafa',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontWeight: 900, color: '#111' }}>{it.label}</div>
                  {it.categoryName ? (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{it.categoryName}</div>
                  ) : null}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13 }}>$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={it.price}
                    disabled={saving}
                    onChange={(e) => updateItemPrice(it.key, e.target.value)}
                    placeholder="0.00"
                    style={{
                      width: 120,
                      borderRadius: 8,
                      border: `1px solid ${parsed.ok ? '#ddd' : '#ef4444'}`,
                      padding: '6px 8px',
                      fontSize: 13,
                      fontFamily: 'inherit',
                      background: '#fff',
                    }}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => removeItem(it.key)}
                  disabled={saving}
                  style={{
                    marginLeft: 'auto',
                    border: '1px solid #ddd',
                    borderRadius: 999,
                    padding: '6px 10px',
                    fontSize: 12,
                    fontWeight: 900,
                    background: '#fff',
                    cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >
                  Remove
                </button>
              </div>
            )
          })
        ) : (
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Add services above. Sending a consult with “nothing” is not a personality trait.
          </div>
        )}
      </div>

      {/* Notes */}
      <div>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 800, marginBottom: 4 }}>
          Consultation notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          disabled={saving}
          placeholder="Goals, techniques, anything you agreed on…"
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid #ddd',
            padding: 8,
            fontSize: 13,
            fontFamily: 'inherit',
            resize: 'vertical',
            opacity: saving ? 0.85 : 1,
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            padding: '8px 16px',
            borderRadius: 999,
            border: 'none',
            fontSize: 13,
            fontWeight: 900,
            background: !canSubmit ? '#374151' : '#111',
            color: '#fff',
            cursor: !canSubmit ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.9 : 1,
          }}
        >
          {saving ? 'Sending…' : 'Send to client for approval'}
        </button>

        <span style={{ fontSize: 12, color: '#6b7280' }}>
          Client sees the line items + total and must approve before you can proceed.
        </span>

        {message ? <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 800 }}>{message}</span> : null}
        {error ? <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 800 }}>{error}</span> : null}
      </div>
    </form>
  )
}

