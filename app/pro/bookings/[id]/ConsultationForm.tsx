// app/pro/bookings/[id]/ConsultationForm.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { safeJson, readErrorMessage, errorMessageFromUnknown } from '@/lib/http'
import { isRecord } from '@/lib/guards'

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
  price: string // "12.34"
}

const FORCE_EVENT = 'tovis:pro-session:force'

function pickString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function pickNullableString(v: unknown): string | null {
  const s = pickString(v)
  return s ? s : null
}

function pickNullableNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

function errorFromResponse(res: Response, data: unknown) {
  const msg = readErrorMessage(data)
  if (msg) return msg
  if (isRecord(data) && typeof data.message === 'string' && data.message.trim()) return data.message.trim()
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

/** Turns unknown "initial price" into a clean "12.34" string, or null. */
function normalizeInitialPrice(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  const parsed = normalizeMoneyInput(s)
  if (!parsed.ok || parsed.value == null) return null
  const n = Number(parsed.value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n.toFixed(2)
}

function sumMoneyStrings(items: Array<{ price: string }>) {
  let total = 0
  for (const it of items) {
    const p = normalizeMoneyInput(it.price)
    if (!p.ok || p.value == null) continue
    const n = Number(p.value)
    if (Number.isFinite(n)) total += n
  }
  return Math.round(total * 100) / 100
}

function uid() {
  return `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`
}

function parseServiceOptions(data: unknown): ServiceOption[] {
  if (!isRecord(data)) return []
  const raw = data.services
  if (!Array.isArray(raw)) return []

  const out: ServiceOption[] = []
  for (const row of raw) {
    if (!isRecord(row)) continue

    const offeringId = pickString(row.offeringId)
    const serviceId = pickString(row.serviceId)
    const serviceName = pickString(row.serviceName)

    if (!offeringId || !serviceId || !serviceName) continue

    out.push({
      offeringId,
      serviceId,
      serviceName,
      categoryName: pickNullableString(row.categoryName),
      defaultPrice: pickNullableNumber(row.defaultPrice),
    })
  }

  // stable-ish ordering for dropdown
  out.sort((a, b) => {
    const ac = a.categoryName ?? ''
    const bc = b.categoryName ?? ''
    if (ac !== bc) return ac.localeCompare(bc)
    return a.serviceName.localeCompare(b.serviceName)
  })

  return out
}

export default function ConsultationForm({ bookingId, initialNotes, initialPrice }: Props) {
  const router = useRouter()

  const suggestedTotal = useMemo(() => normalizeInitialPrice(initialPrice), [initialPrice])

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

        const list = parseServiceOptions(data)

        if (!cancelled) {
          setServices(list)
          setSelectedOfferingId(list[0]?.offeringId ?? '')
        }
      } catch (e: unknown) {
        if (!cancelled) setError(errorMessageFromUnknown(e, 'Failed to load services.'))
      } finally {
        if (!cancelled) setLoadingServices(false)
      }
    }

    if (bookingId) void load()
    return () => {
      cancelled = true
    }
  }, [bookingId])

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

    // Use suggestedTotal only for the first line item, if provided
    const price =
      items.length === 0 && suggestedTotal
        ? suggestedTotal
        : opt.defaultPrice != null
          ? opt.defaultPrice.toFixed(2)
          : ''

    setItems((prev) => [
      ...prev,
      {
        key: uid(),
        offeringId: opt.offeringId,
        serviceId: opt.serviceId,
        label: opt.serviceName,
        categoryName: opt.categoryName,
        price,
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
      if (!it.offeringId || !it.serviceId) return false
      const p = normalizeMoneyInput(it.price)
      if (!p.ok || p.value == null) return false
      const n = Number(p.value)
      if (!Number.isFinite(n) || n <= 0) return false
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
        items: items.map((it) => {
          const parsed = normalizeMoneyInput(it.price)
          if (!parsed.ok || !parsed.value) throw new Error('Invalid price in line items.')
          return {
            offeringId: it.offeringId,
            serviceId: it.serviceId,
            label: it.label,
            categoryName: it.categoryName || null,
            price: parsed.value, // "12.34"
          }
        }),
      }

      const proposedTotal = total.toFixed(2)

      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/consultation-proposal`, {
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
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(FORCE_EVENT))

      router.push(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    } catch (err: unknown) {
      if (isRecord(err) && err.name === 'AbortError') return
      console.error(err)
      setError(errorMessageFromUnknown(err, 'Network error sending consultation.'))
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

          <div className="flex flex-wrap items-center gap-2">
            {suggestedTotal ? (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textSecondary">
                Suggested: ${suggestedTotal}
              </span>
            ) : null}

            <div className="text-[12px] font-black text-textPrimary">
              Total: <span className="text-textPrimary">{totalLabel}</span>
            </div>
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
                      className={[field, 'w-[140px]', parsed.ok ? '' : 'ring-2 ring-toneDanger/40'].join(' ')}
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