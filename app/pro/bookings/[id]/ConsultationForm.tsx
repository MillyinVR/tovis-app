// app/pro/bookings/[id]/ConsultationForm.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookingServiceItemType } from '@prisma/client'
import {
  safeJson,
  readErrorMessage,
  errorMessageFromUnknown,
} from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { pickNumber, pickString } from '@/lib/pick'

export type ConsultationInitialItem = {
  key: string
  bookingServiceItemId: string | null
  serviceId: string
  offeringId: string | null
  itemType: BookingServiceItemType
  label: string
  categoryName: string | null
  price: string
  durationMinutes: string
  notes: string
  sortOrder: number
  source: 'BOOKING' | 'PROPOSAL'
}

type Props = {
  bookingId: string
  initialNotes: string
  initialPrice: string | number | null
  initialItems?: ConsultationInitialItem[]
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
  bookingServiceItemId: string | null
  offeringId: string | null
  serviceId: string
  itemType: BookingServiceItemType
  label: string
  categoryName: string | null
  price: string
  durationMinutes: string
  notes: string
  sortOrder: number
  source: 'BOOKING' | 'PROPOSAL'
}

const FORCE_EVENT = 'tovis:pro-session:force'

function pickNullableString(v: unknown): string | null {
  return pickString(v)
}

function pickNullableNumber(v: unknown): number | null {
  return pickNumber(v)
}

function isAbortError(err: unknown): boolean {
  return isRecord(err) && err.name === 'AbortError'
}

function errorFromResponse(res: Response, data: unknown) {
  const msg = readErrorMessage(data)
  if (msg) return msg

  if (isRecord(data)) {
    const message = pickString(data.message)
    if (message) return message
  }

  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

function normalizeMoneyInput(raw: string) {
  const s = String(raw || '').replace(/\$/g, '').replace(/,/g, '').trim()
  if (!s) return { value: null as string | null, ok: true }
  if (!/^\d*\.?\d{0,2}$/.test(s)) return { value: s, ok: false }

  const normalized = s.startsWith('.') ? `0${s}` : s
  if (normalized === '.' || normalized === '0.') {
    return { value: null, ok: false }
  }

  return { value: normalized, ok: true }
}

function normalizeDurationInput(raw: string) {
  const s = String(raw || '').trim()
  if (!s) return { value: null as string | null, ok: true }
  if (!/^\d+$/.test(s)) return { value: s, ok: false }

  const n = Number(s)
  if (!Number.isFinite(n) || n <= 0) return { value: s, ok: false }

  return { value: String(Math.round(n)), ok: true }
}

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

function parseServiceOptions(payload: unknown): ServiceOption[] {
  if (!isRecord(payload)) return []

  const raw = payload.services
  if (!Array.isArray(raw)) return []

  const out: ServiceOption[] = []

  for (const row of raw) {
    if (!isRecord(row)) continue

    const offeringId = pickString(row.offeringId) ?? ''
    const serviceId = pickString(row.serviceId) ?? ''
    const serviceName = pickString(row.serviceName) ?? ''

    if (!offeringId || !serviceId || !serviceName) continue

    out.push({
      offeringId,
      serviceId,
      serviceName,
      categoryName: pickNullableString(row.categoryName),
      defaultPrice: pickNullableNumber(row.defaultPrice),
    })
  }

  out.sort((a, b) => {
    const ac = a.categoryName ?? ''
    const bc = b.categoryName ?? ''
    if (ac !== bc) return ac.localeCompare(bc)
    return a.serviceName.localeCompare(b.serviceName)
  })

  return out
}

function sortLineItems(items: LineItem[]) {
  return [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    if (a.source !== b.source) return a.source === 'BOOKING' ? -1 : 1
    return a.label.localeCompare(b.label)
  })
}

function normalizeInitialItems(items: ConsultationInitialItem[]): LineItem[] {
  return sortLineItems(
    items.map((it, index) => ({
      key: it.key || uid(),
      bookingServiceItemId: it.bookingServiceItemId ?? null,
      offeringId: it.offeringId ?? null,
      serviceId: it.serviceId,
      itemType: it.itemType,
      label: it.label,
      categoryName: it.categoryName ?? null,
      price: it.price ?? '',
      durationMinutes: it.durationMinutes ?? '',
      notes: it.notes ?? '',
      sortOrder: Number.isFinite(it.sortOrder) ? it.sortOrder : index,
      source: it.source,
    })),
  )
}

export default function ConsultationForm({
  bookingId,
  initialNotes,
  initialPrice,
  initialItems = [],
}: Props) {
  const router = useRouter()

  const suggestedTotal = useMemo(
    () => normalizeInitialPrice(initialPrice),
    [initialPrice],
  )

  const [notes, setNotes] = useState(initialNotes || '')
  const [services, setServices] = useState<ServiceOption[]>([])
  const [items, setItems] = useState<LineItem[]>(() =>
    normalizeInitialItems(initialItems),
  )
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
    setItems(normalizeInitialItems(initialItems))
  }, [initialItems])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoadingServices(true)
      setError(null)

      try {
        const res = await fetch(
          `/api/pro/bookings/${encodeURIComponent(bookingId)}/consultation-services`,
          { cache: 'no-store' },
        )
        const data: unknown = await safeJson(res)

        if (!res.ok) {
          throw new Error(errorFromResponse(res, data))
        }

        const list = parseServiceOptions(data)

        if (!cancelled) {
          setServices(list)
          setSelectedOfferingId((current) => current || list[0]?.offeringId || '')
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(errorMessageFromUnknown(e, 'Failed to load services.'))
        }
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

    const price =
      items.length === 0 && suggestedTotal
        ? suggestedTotal
        : opt.defaultPrice != null
          ? opt.defaultPrice.toFixed(2)
          : ''

    setItems((prev) =>
      sortLineItems([
        ...prev,
        {
          key: uid(),
          bookingServiceItemId: null,
          offeringId: opt.offeringId,
          serviceId: opt.serviceId,
          itemType: BookingServiceItemType.BASE,
          label: opt.serviceName,
          categoryName: opt.categoryName,
          price,
          durationMinutes: '',
          notes: '',
          sortOrder: prev.length,
          source: 'PROPOSAL',
        },
      ]),
    )
  }

  function removeItem(key: string) {
    setItems((prev) =>
      sortLineItems(
        prev
          .filter((x) => x.key !== key)
          .map((x, index) => ({ ...x, sortOrder: index })),
      ),
    )
  }

  function updateItem(
    key: string,
    patch: Partial<Pick<LineItem, 'price' | 'durationMinutes' | 'notes'>>,
  ) {
    setItems((prev) =>
      prev.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    )
  }

  const itemsValid = useMemo(() => {
    if (!items.length) return false

    for (const it of items) {
      if (!it.serviceId) return false

      if (it.itemType === BookingServiceItemType.BASE && !it.offeringId) {
        return false
      }

      const p = normalizeMoneyInput(it.price)
      if (!p.ok || p.value == null) return false

      const n = Number(p.value)
      if (!Number.isFinite(n) || n <= 0) return false

      const d = normalizeDurationInput(it.durationMinutes)
      if (!d.ok || d.value == null) return false
    }

    return true
  }, [items])

  const canSubmit = Boolean(bookingId && !saving && itemsValid && total > 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)

    if (!bookingId) {
      setError('Missing booking id.')
      return
    }
    if (saving) return
    if (!items.length) {
      setError('Add at least one service.')
      return
    }
    if (!itemsValid) {
      setError('Fix line items before sending. Price must be valid and duration must be whole minutes.')
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setSaving(true)

    try {
      const proposedServicesJson = {
        currency: 'USD',
        items: items.map((it, index) => {
          const parsedPrice = normalizeMoneyInput(it.price)
          const parsedDuration = normalizeDurationInput(it.durationMinutes)

          if (!parsedPrice.ok || !parsedPrice.value) {
            throw new Error('Invalid price in line items.')
          }
          if (!parsedDuration.ok || !parsedDuration.value) {
            throw new Error('Invalid duration in line items.')
          }

          return {
            bookingServiceItemId: it.bookingServiceItemId,
            offeringId: it.offeringId,
            serviceId: it.serviceId,
            itemType: it.itemType,
            label: it.label,
            categoryName: it.categoryName || null,
            price: parsedPrice.value,
            durationMinutes: parsedDuration.value,
            notes: it.notes.trim() || null,
            sortOrder: index,
            source: it.source,
          }
        }),
      }

      const proposedTotal = total.toFixed(2)

      const res = await fetch(
        `/api/pro/bookings/${encodeURIComponent(bookingId)}/consultation-proposal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            notes,
            proposedTotal,
            proposedServicesJson,
          }),
        },
      )

      const data: unknown = await safeJson(res)
      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      setMessage('Sent to client for approval.')

      router.refresh()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(FORCE_EVENT))
      }

      router.push(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    } catch (err: unknown) {
      if (isAbortError(err)) return

      console.error(err)
      setError(
        errorMessageFromUnknown(err, 'Network error sending consultation.'),
      )
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setSaving(false)
    }
  }

  const field =
    'w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary/70 focus:outline-none focus:ring-2 focus:ring-accentPrimary/40 disabled:opacity-60'

  const pillBase =
    'inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black'

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-4 rounded-card border border-white/10 bg-bgSecondary p-4 tovis-glass"
    >
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="text-[12px] font-black text-textPrimary">
            Services (what you’re actually doing)
          </div>

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
          <div className="mt-3 text-[12px] text-textSecondary">
            Loading your services…
          </div>
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
              + Add service
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
            const parsedPrice = normalizeMoneyInput(it.price)
            const parsedDuration = normalizeDurationInput(it.durationMinutes)
            const isAddOn = it.itemType === BookingServiceItemType.ADD_ON

            return (
              <div
                key={it.key}
                className="rounded-card border border-white/10 bg-bgPrimary p-3"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-[220px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[13px] font-black text-textPrimary">
                        {it.label}
                      </div>

                      <span
                        className={[
                          pillBase,
                          'border-white/10 bg-bgSecondary text-textSecondary',
                        ].join(' ')}
                      >
                        {isAddOn ? 'Add-on' : 'Service'}
                      </span>

                      <span
                        className={[
                          pillBase,
                          it.source === 'BOOKING'
                            ? 'border-accentPrimary/30 bg-bgSecondary text-textPrimary'
                            : 'border-white/10 bg-bgSecondary text-textSecondary',
                        ].join(' ')}
                      >
                        {it.source === 'BOOKING' ? 'Booked' : 'Proposal'}
                      </span>
                    </div>

                    {it.categoryName ? (
                      <div className="mt-1 text-[12px] text-textSecondary">
                        {it.categoryName}
                      </div>
                    ) : null}
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

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-black text-textPrimary">
                      Line-item price
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-textSecondary">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={it.price}
                        disabled={saving}
                        onChange={(e) => updateItem(it.key, { price: e.target.value })}
                        placeholder="0.00"
                        className={[
                          field,
                          parsedPrice.ok ? '' : 'ring-2 ring-toneDanger/40',
                        ].join(' ')}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-black text-textPrimary">
                      Duration (minutes)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={it.durationMinutes}
                      disabled={saving}
                      onChange={(e) =>
                        updateItem(it.key, { durationMinutes: e.target.value })
                      }
                      placeholder="60"
                      className={[
                        field,
                        parsedDuration.ok ? '' : 'ring-2 ring-toneDanger/40',
                      ].join(' ')}
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="mb-1 block text-[11px] font-black text-textPrimary">
                    Line-item notes
                  </label>
                  <textarea
                    value={it.notes}
                    onChange={(e) => updateItem(it.key, { notes: e.target.value })}
                    rows={2}
                    disabled={saving}
                    placeholder="Optional details for this line item…"
                    className={field}
                  />
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
        <label className="text-[12px] font-black text-textPrimary">
          Consultation notes
        </label>
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

        {message ? (
          <span className="text-[12px] font-black text-toneSuccess">
            {message}
          </span>
        ) : null}
        {error ? (
          <span className="text-[12px] font-black text-toneDanger">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  )
}