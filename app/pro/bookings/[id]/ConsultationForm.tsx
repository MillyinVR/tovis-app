// app/pro/bookings/[id]/ConsultationForm.tsx
'use client'

import type { FormEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookingServiceItemType } from '@prisma/client'

import {
  errorMessageFromUnknown,
  readErrorMessage,
  safeJson,
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

type NormalizedInput = {
  value: string | null
  ok: boolean
}

const FORCE_EVENT = 'tovis:pro-session:force'

function pickNullableString(value: unknown): string | null {
  return pickString(value)
}

function pickNullableNumber(value: unknown): number | null {
  return pickNumber(value)
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError'
}

function errorFromResponse(response: Response, data: unknown): string {
  const readableMessage = readErrorMessage(data)
  if (readableMessage) return readableMessage

  if (isRecord(data)) {
    const message = pickString(data.message)
    if (message) return message
  }

  if (response.status === 401) return 'Please log in to continue.'
  if (response.status === 403) return 'You don’t have access to do that.'

  return `Request failed (${response.status}).`
}

function normalizeMoneyInput(raw: string): NormalizedInput {
  const value = String(raw || '')
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .trim()

  if (!value) {
    return { value: null, ok: true }
  }

  if (!/^\d*\.?\d{0,2}$/.test(value)) {
    return { value, ok: false }
  }

  const normalized = value.startsWith('.') ? `0${value}` : value

  if (normalized === '.' || normalized === '0.') {
    return { value: null, ok: false }
  }

  return { value: normalized, ok: true }
}

function normalizeDurationInput(raw: string): NormalizedInput {
  const value = String(raw || '').trim()

  if (!value) {
    return { value: null, ok: true }
  }

  if (!/^\d+$/.test(value)) {
    return { value, ok: false }
  }

  const duration = Number(value)

  if (!Number.isFinite(duration) || duration <= 0) {
    return { value, ok: false }
  }

  return { value: String(Math.round(duration)), ok: true }
}

function normalizeInitialPrice(value: string | number | null): string | null {
  if (value === null) return null

  const raw = String(value).trim()
  if (!raw) return null

  const parsed = normalizeMoneyInput(raw)

  if (!parsed.ok || parsed.value === null) return null

  const amount = Number(parsed.value)

  if (!Number.isFinite(amount) || amount <= 0) return null

  return amount.toFixed(2)
}

function sumMoneyStrings(items: Array<{ price: string }>): number {
  let total = 0

  for (const item of items) {
    const parsed = normalizeMoneyInput(item.price)

    if (!parsed.ok || parsed.value === null) continue

    const amount = Number(parsed.value)

    if (Number.isFinite(amount)) {
      total += amount
    }
  }

  return Math.round(total * 100) / 100
}

function uid(): string {
  return `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`
}

function parseServiceOptions(payload: unknown): ServiceOption[] {
  if (!isRecord(payload)) return []

  const rawServices = payload.services
  if (!Array.isArray(rawServices)) return []

  const services: ServiceOption[] = []

  for (const row of rawServices) {
    if (!isRecord(row)) continue

    const offeringId = pickString(row.offeringId) ?? ''
    const serviceId = pickString(row.serviceId) ?? ''
    const serviceName = pickString(row.serviceName) ?? ''

    if (!offeringId || !serviceId || !serviceName) continue

    services.push({
      offeringId,
      serviceId,
      serviceName,
      categoryName: pickNullableString(row.categoryName),
      defaultPrice: pickNullableNumber(row.defaultPrice),
    })
  }

  services.sort((a, b) => {
    const categoryA = a.categoryName ?? ''
    const categoryB = b.categoryName ?? ''

    if (categoryA !== categoryB) {
      return categoryA.localeCompare(categoryB)
    }

    return a.serviceName.localeCompare(b.serviceName)
  })

  return services
}

function sortLineItems(items: LineItem[]): LineItem[] {
  return [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder
    }

    if (a.source !== b.source) {
      return a.source === 'BOOKING' ? -1 : 1
    }

    return a.label.localeCompare(b.label)
  })
}

function normalizeInitialItems(items: ConsultationInitialItem[]): LineItem[] {
  return sortLineItems(
    items.map((item, index) => ({
      key: item.key || uid(),
      bookingServiceItemId: item.bookingServiceItemId ?? null,
      offeringId: item.offeringId ?? null,
      serviceId: item.serviceId,
      itemType: item.itemType,
      label: item.label,
      categoryName: item.categoryName ?? null,
      price: item.price ?? '',
      durationMinutes: item.durationMinutes ?? '',
      notes: item.notes ?? '',
      sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : index,
      source: item.source,
    })),
  )
}

function serviceOptionLabel(service: ServiceOption): string {
  const categoryPrefix = service.categoryName
    ? `${service.categoryName} · `
    : ''
  const priceSuffix =
    service.defaultPrice !== null ? ` ($${service.defaultPrice.toFixed(2)})` : ''

  return `${categoryPrefix}${service.serviceName}${priceSuffix}`
}

function lineItemTypeLabel(itemType: BookingServiceItemType): string {
  return itemType === BookingServiceItemType.ADD_ON ? 'ADD-ON' : 'SERVICE'
}

function lineItemSourceLabel(source: LineItem['source']): string {
  return source === 'BOOKING' ? 'BOOKED' : 'PROPOSAL'
}

function AddIcon() {
  return (
    <svg
      aria-hidden="true"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
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
  const [selectedOfferingId, setSelectedOfferingId] = useState('')

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

    async function loadServices() {
      setLoadingServices(true)
      setError(null)

      try {
        const response = await fetch(
          `/api/pro/bookings/${encodeURIComponent(
            bookingId,
          )}/consultation-services`,
          { cache: 'no-store' },
        )

        const data: unknown = await safeJson(response)

        if (!response.ok) {
          throw new Error(errorFromResponse(response, data))
        }

        const serviceOptions = parseServiceOptions(data)

        if (!cancelled) {
          setServices(serviceOptions)
          setSelectedOfferingId(
            (current) => current || serviceOptions[0]?.offeringId || '',
          )
        }
      } catch (caughtError: unknown) {
        if (!cancelled) {
          setError(
            errorMessageFromUnknown(
              caughtError,
              'Failed to load services.',
            ),
          )
        }
      } finally {
        if (!cancelled) {
          setLoadingServices(false)
        }
      }
    }

    if (bookingId) {
      void loadServices()
    }

    return () => {
      cancelled = true
    }
  }, [bookingId])

  const total = useMemo(() => sumMoneyStrings(items), [items])
  const totalLabel = useMemo(() => `$${total.toFixed(2)}`, [total])

  const itemsValid = useMemo(() => {
    if (items.length === 0) return false

    for (const item of items) {
      if (!item.serviceId) return false

      if (
        item.itemType === BookingServiceItemType.BASE &&
        !item.offeringId
      ) {
        return false
      }

      const parsedPrice = normalizeMoneyInput(item.price)

      if (!parsedPrice.ok || parsedPrice.value === null) return false

      const amount = Number(parsedPrice.value)

      if (!Number.isFinite(amount) || amount <= 0) return false

      const parsedDuration = normalizeDurationInput(item.durationMinutes)

      if (!parsedDuration.ok || parsedDuration.value === null) {
        return false
      }
    }

    return true
  }, [items])

  const canSubmit = Boolean(bookingId && !saving && itemsValid && total > 0)

  function addSelectedService() {
    setError(null)
    setMessage(null)

    const selectedService = services.find(
      (service) => service.offeringId === selectedOfferingId,
    )

    if (!selectedService) {
      setError('Select a service to add.')
      return
    }

    const price =
      items.length === 0 && suggestedTotal
        ? suggestedTotal
        : selectedService.defaultPrice !== null
          ? selectedService.defaultPrice.toFixed(2)
          : ''

    setItems((previousItems) =>
      sortLineItems([
        ...previousItems,
        {
          key: uid(),
          bookingServiceItemId: null,
          offeringId: selectedService.offeringId,
          serviceId: selectedService.serviceId,
          itemType: BookingServiceItemType.BASE,
          label: selectedService.serviceName,
          categoryName: selectedService.categoryName,
          price,
          durationMinutes: '',
          notes: '',
          sortOrder: previousItems.length,
          source: 'PROPOSAL',
        },
      ]),
    )
  }

  function removeItem(key: string) {
    setItems((previousItems) =>
      sortLineItems(
        previousItems
          .filter((item) => item.key !== key)
          .map((item, index) => ({
            ...item,
            sortOrder: index,
          })),
      ),
    )
  }

  function updateItem(
    key: string,
    patch: Partial<Pick<LineItem, 'price' | 'durationMinutes' | 'notes'>>,
  ) {
    setItems((previousItems) =>
      previousItems.map((item) =>
        item.key === key ? { ...item, ...patch } : item,
      ),
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (!bookingId) {
      setError('Missing booking id.')
      return
    }

    if (saving) return

    if (items.length === 0) {
      setError('Add at least one service.')
      return
    }

    if (!itemsValid) {
      setError(
        'Fix line items before sending. Price must be valid and duration must be whole minutes.',
      )
      return
    }

    abortRef.current?.abort()

    const controller = new AbortController()
    abortRef.current = controller
    setSaving(true)

    try {
      const proposedServicesJson = {
        currency: 'USD',
        items: items.map((item, index) => {
          const parsedPrice = normalizeMoneyInput(item.price)
          const parsedDuration = normalizeDurationInput(item.durationMinutes)

          if (!parsedPrice.ok || parsedPrice.value === null) {
            throw new Error('Invalid price in line items.')
          }

          if (!parsedDuration.ok || parsedDuration.value === null) {
            throw new Error('Invalid duration in line items.')
          }

          return {
            bookingServiceItemId: item.bookingServiceItemId,
            offeringId: item.offeringId,
            serviceId: item.serviceId,
            itemType: item.itemType,
            label: item.label,
            categoryName: item.categoryName || null,
            price: parsedPrice.value,
            durationMinutes: parsedDuration.value,
            notes: item.notes.trim() || null,
            sortOrder: index,
            source: item.source,
          }
        }),
      }

      const proposedTotal = total.toFixed(2)

      const response = await fetch(
        `/api/pro/bookings/${encodeURIComponent(
          bookingId,
        )}/consultation-proposal`,
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

      const data: unknown = await safeJson(response)

      if (!response.ok) {
        setError(errorFromResponse(response, data))
        return
      }

      setMessage('Sent to client for approval.')
      router.refresh()

      window.dispatchEvent(new Event(FORCE_EVENT))
      router.push(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    } catch (caughtError: unknown) {
      if (isAbortError(caughtError)) return

      console.error(caughtError)

      setError(
        errorMessageFromUnknown(
          caughtError,
          'Network error sending consultation.',
        ),
      )
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }

      setSaving(false)
    }
  }

  return (
    <form
      id="consultation-form"
      onSubmit={handleSubmit}
      className="brand-pro-session-card"
    >
      <div className="brand-pro-session-section-row">
        <div className="brand-pro-session-section-title">Services</div>

        <div className="brand-pro-session-section-total">
          Total: <strong>{totalLabel}</strong>
        </div>
      </div>

      {suggestedTotal ? (
        <div className="brand-pro-session-chip-row">
          <span className="brand-pro-session-pill">
            Suggested ${suggestedTotal}
          </span>
        </div>
      ) : null}

      <div>
        {items.length > 0 ? (
          items.map((item) => {
            const parsedPrice = normalizeMoneyInput(item.price)
            const parsedDuration = normalizeDurationInput(item.durationMinutes)

            return (
              <div key={item.key} className="brand-pro-session-line-item">
                <div className="brand-pro-session-line-row">
                  <div className="brand-pro-session-line-main">
                    <div className="brand-pro-session-line-title">
                      {item.label}
                    </div>

                    <div className="brand-pro-session-line-meta">
                      <span className="brand-pro-session-pill">
                        {lineItemTypeLabel(item.itemType)}
                      </span>

                      <span
                        className="brand-pro-session-pill"
                        data-state={
                          item.source === 'BOOKING' ? 'active' : undefined
                        }
                      >
                        {lineItemSourceLabel(item.source)}
                      </span>
                    </div>

                    {item.categoryName ? (
                      <div className="brand-pro-session-line-price-sub">
                        {item.categoryName}
                      </div>
                    ) : null}
                  </div>

                  <div className="brand-pro-session-line-price">
                    <div className="brand-pro-session-line-price-value">
                      ${item.price || '0.00'}
                    </div>

                    <div className="brand-pro-session-line-price-sub">
                      {item.durationMinutes || '—'} min
                    </div>
                  </div>
                </div>

                <div className="brand-pro-session-add-row">
                  <label className="brand-pro-session-line-main">
                    <span className="brand-pro-session-section-title">
                      Price
                    </span>

                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.price}
                      disabled={saving}
                      onChange={(event) =>
                        updateItem(item.key, {
                          price: event.target.value,
                        })
                      }
                      placeholder="0.00"
                      className="brand-pro-session-input"
                      aria-invalid={!parsedPrice.ok}
                    />
                  </label>

                  <label className="brand-pro-session-line-main">
                    <span className="brand-pro-session-section-title">
                      Duration
                    </span>

                    <input
                      type="text"
                      inputMode="numeric"
                      value={item.durationMinutes}
                      disabled={saving}
                      onChange={(event) =>
                        updateItem(item.key, {
                          durationMinutes: event.target.value,
                        })
                      }
                      placeholder="60"
                      className="brand-pro-session-input"
                      aria-invalid={!parsedDuration.ok}
                    />
                  </label>
                </div>

                <label>
                  <span className="brand-pro-session-section-title">
                    Line-item notes
                  </span>

                  <textarea
                    value={item.notes}
                    onChange={(event) =>
                      updateItem(item.key, {
                        notes: event.target.value,
                      })
                    }
                    rows={2}
                    disabled={saving}
                    placeholder="Optional details for this line item…"
                    className="brand-pro-session-textarea"
                  />
                </label>

                <div className="brand-pro-session-action-row">
                  <button
                    type="button"
                    onClick={() => removeItem(item.key)}
                    disabled={saving}
                    className="brand-pro-session-button brand-focus"
                    data-variant="ghost"
                    data-full="true"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })
        ) : (
          <div className="brand-pro-session-card-body">
            Add services above. Sending a consult with “nothing” is not a
            personality trait.
          </div>
        )}
      </div>

      {loadingServices ? (
        <div className="brand-pro-session-card-body">
          Loading your services…
        </div>
      ) : services.length > 0 ? (
        <div className="brand-pro-session-add-row">
          <select
            value={selectedOfferingId}
            disabled={saving}
            onChange={(event) => setSelectedOfferingId(event.target.value)}
            className="brand-pro-session-input"
            aria-label="Select a service"
          >
            {services.map((service) => (
              <option key={service.offeringId} value={service.offeringId}>
                {serviceOptionLabel(service)}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={addSelectedService}
            disabled={saving}
            className="brand-pro-session-button brand-focus"
            data-variant="ghost"
            data-full="false"
          >
            <AddIcon />
            Add
          </button>
        </div>
      ) : (
        <div className="brand-pro-session-error">
          No services found for your profile. Add offerings before sending
          consult approvals.
        </div>
      )}

      <label>
        <span className="brand-pro-session-section-title">
          Consultation notes
        </span>

        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          disabled={saving}
          placeholder="Goals, techniques, anything you agreed on…"
          className="brand-pro-session-textarea"
        />
      </label>

      <button
        type="submit"
        disabled={!canSubmit}
        className="brand-pro-session-button brand-focus"
        data-full="true"
      >
        <SendIcon />
        {saving ? 'Sending…' : 'Send to client for approval'}
      </button>

      <div className="brand-pro-session-help-text">
        Client sees line items + total and must approve before you proceed.
      </div>

      {message ? (
        <div className="brand-pro-session-success">{message}</div>
      ) : null}

      {error ? <div className="brand-pro-session-error">{error}</div> : null}
    </form>
  )
}