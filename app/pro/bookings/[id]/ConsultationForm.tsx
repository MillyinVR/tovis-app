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
  price: string
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
  const s = String(raw || '').replace(/\$/g, '').replace(/,/g, '').trim()
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

  useEffect(() => {
    if (items.length) return
    const raw = initialPrice !== null && initialPrice !== undefined ? String(initialPrice) : ''
    const parsed = normalizeMoneyInput(raw)
    if (!parsed.ok || parsed.value == null) return

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
    setItems((prev) => prev.map((x) => (x.key === key ? { ...x, price } : x)))
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
      const proposedServicesJson = {
        currency: 'USD',
        items: items.map((it) => ({
          offeringId: it.offeringId || null,
          serviceId: it.serviceId || null,
          label: it.label,
          categoryName: it.categoryName || null,
          price: normalizeMoneyInput(it.price).value,
        })),
      }

      const proposedTotal = total.toFixed(2)

      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/consultation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ notes, proposedTotal, proposedServicesJson }),
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

  const field =
    'w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary/70 focus:outline-none focus:ring-2 focus:ring-accentPrimary/40 disabled:opacity-60'

  return (
    <form onSubmit={handleSubmit} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4 grid gap-4">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="text-[12px] font-black text-textPrimary">Services (what you’re actually doing)</div>
          <div className="text-[12px] font-black text-textPrimary">
            Total: <span className="text-textPrimary">{totalLabel}</span>
          </div>
        </div>

        {loadingServices ? (
          <div className="mt-3 text-[12px] text-textSecondary">Loading your services…</div>
        ) : services.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={selectedOfferingId}
              disabled={saving}
              onChange={(e) => setSelectedOfferingId(e.target.value)}
              className={field}
              style={{ minWidth: 280 }}
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
              className="rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/20 disabled:opacity-60"
            >
              + Add
            </button>
          </div>
        ) : (
          <div className="mt-3 rounded-card border border-toneDanger/30 bg-bgPrimary p-3 text-[12px] text-toneDanger">
            No services found for your profile. Add offerings before sending consult approvals.
          </div>
        )}
      </div>

      <div className="grid gap-2">
        {items.length ? (
          items.map((it) => {
            const parsed = normalizeMoneyInput(it.price)
            return (
              <div key={it.key} className="rounded-card border border-white/10 bg-bgPrimary p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-[220px]">
                    <div className="text-[13px] font-black text-textPrimary">{it.label}</div>
                    {it.categoryName ? <div className="text-[12px] text-textSecondary">{it.categoryName}</div> : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-textSecondary">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={it.price}
                      disabled={saving}
                      onChange={(e) => updateItemPrice(it.key, e.target.value)}
                      placeholder="0.00"
                      className={[
                        field,
                        'w-[140px]',
                        parsed.ok ? '' : 'ring-2 ring-toneDanger/40',
                      ].join(' ')}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => removeItem(it.key)}
                    disabled={saving}
                    className="ml-auto rounded-full border border-white/10 bg-bgSecondary px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/20 disabled:opacity-60"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })
        ) : (
          <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] text-textSecondary">
            Add services above. Sending a consult with “nothing” is not a personality trait.
          </div>
        )}
      </div>

      <div className="grid gap-2">
        <label className="text-[12px] font-black text-textPrimary">Consultation notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          disabled={saving}
          placeholder="Goals, techniques, anything you agreed on…"
          className={field}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-full border border-accentPrimary/60 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Sending…' : 'Send to client for approval'}
        </button>

        <span className="text-[12px] text-textSecondary">
          Client sees line items + total and must approve before you proceed.
        </span>

        {message ? <span className="text-[12px] font-black text-toneSuccess">{message}</span> : null}
        {error ? <span className="text-[12px] font-black text-toneDanger">{error}</span> : null}
      </div>
    </form>
  )
}
