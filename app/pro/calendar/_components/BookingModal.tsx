// app/pro/calendar/_components/BookingModal.tsx
'use client'

import { useEffect, useMemo } from 'react'
import type { BookingDetails, ServiceOption } from '../_types'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'

function readBookingLocationMeta(booking: BookingDetails | null): {
  address: string | null
  lat: number | null
  lng: number | null
} {
  if (!isRecord(booking)) {
    return { address: null, lat: null, lng: null }
  }

  const address = pickString(booking.locationAddressSnapshot) ?? null

  const rawLat = booking.locationLatSnapshot
  const rawLng = booking.locationLngSnapshot

  const lat =
    typeof rawLat === 'number' && Number.isFinite(rawLat) ? rawLat : null
  const lng =
    typeof rawLng === 'number' && Number.isFinite(rawLng) ? rawLng : null

  return { address, lat, lng }
}

function mapsHref(args: {
  address: string | null
  lat: number | null
  lng: number | null
}): string | null {
  if (args.lat != null && args.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${args.lat},${args.lng}`,
    )}`
  }

  if (args.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      args.address,
    )}`
  }

  return null
}

function locationModeLabel(locationType: BookingDetails['locationType']) {
  return locationType === 'MOBILE' ? 'Mobile' : 'In-salon'
}

export function BookingModal(props: {
  open: boolean
  loading: boolean
  error: string | null
  booking: BookingDetails | null
  services: ServiceOption[]
  timeZone: string

  bookingServiceLabel?: string
  serviceItemsDraft?: BookingDetails['serviceItems']
  selectedDraftServiceIds: string[]
  hasDraftServiceItemsChanges?: boolean

  reschedDate: string
  reschedTime: string
  durationMinutes: number
  notifyClient: boolean
  allowOutsideHours: boolean
  editOutside: boolean
  saving: boolean

  onClose: () => void
  onChangeReschedDate: (v: string) => void
  onChangeReschedTime: (v: string) => void
  onChangeSelectedDraftServiceIds: (ids: string[]) => void
  onToggleNotifyClient: (v: boolean) => void
  onToggleAllowOutsideHours: (v: boolean) => void
  onSave: () => void
  onApprove: () => void
  onDeny: () => void
}) {
  const {
    open,
    loading,
    error,
    booking,
    services,
    timeZone,

    bookingServiceLabel,
    serviceItemsDraft,
    selectedDraftServiceIds,
    hasDraftServiceItemsChanges,

    reschedDate,
    reschedTime,
    durationMinutes,
    notifyClient,
    allowOutsideHours,
    editOutside,
    saving,

    onClose,
    onChangeReschedDate,
    onChangeReschedTime,
    onChangeSelectedDraftServiceIds,
    onToggleNotifyClient,
    onToggleAllowOutsideHours,
    onSave,
    onApprove,
    onDeny,
  } = props

  const tz = useMemo(
    () => sanitizeTimeZone(booking?.timeZone ?? timeZone, DEFAULT_TIME_ZONE),
    [booking?.timeZone, timeZone],
  )

  const isPending = String(booking?.status || '').toUpperCase() === 'PENDING'
  const noServicesSelected = selectedDraftServiceIds.length === 0

  const items = useMemo(() => {
    return Array.isArray(serviceItemsDraft)
      ? serviceItemsDraft
      : (booking?.serviceItems ?? [])
  }, [serviceItemsDraft, booking])

  const label = useMemo(() => {
    if (bookingServiceLabel && bookingServiceLabel.trim()) {
      return bookingServiceLabel.trim()
    }

    const names = items.map((item) => item.serviceName.trim()).filter(Boolean)
    return names.length ? names.join(' + ') : 'Appointment'
  }, [bookingServiceLabel, items])

  const totalDuration =
    Number.isFinite(durationMinutes) && durationMinutes > 0
      ? durationMinutes
      : booking?.totalDurationMinutes && booking.totalDurationMinutes > 0
        ? booking.totalDurationMinutes
        : 60

  const selectedSet = useMemo(
    () => new Set(selectedDraftServiceIds),
    [selectedDraftServiceIds],
  )

  const locationMeta = useMemo(() => readBookingLocationMeta(booking), [booking])

  const modeLabel = locationModeLabel(booking?.locationType)
  const mapsUrl = useMemo(
    () =>
      mapsHref({
        address: locationMeta.address,
        lat: locationMeta.lat,
        lng: locationMeta.lng,
      }),
    [locationMeta.address, locationMeta.lat, locationMeta.lng],
  )

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  function close() {
    if (saving) return
    onClose()
  }

  function toggleService(serviceId: string, checked: boolean) {
    if (
      !checked &&
      selectedDraftServiceIds.length === 1 &&
      selectedDraftServiceIds[0] === serviceId
    ) {
      return
    }

    const next = checked
      ? Array.from(new Set([...selectedDraftServiceIds, serviceId]))
      : selectedDraftServiceIds.filter((id) => id !== serviceId)

    onChangeSelectedDraftServiceIds(next)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-999 flex items-center justify-center bg-black/75 p-3 sm:p-4"
      onClick={close}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-170 flex-col overflow-hidden rounded-2xl border border-white/12 bg-bgPrimary shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Appointment details"
      >
        <div className="flex items-center justify-between border-b border-white/10 bg-bgPrimary/95 px-4 py-4 backdrop-blur">
          <div>
            <div className="text-sm font-extrabold text-textPrimary">
              Appointment
            </div>
            {booking ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/10 bg-bgSecondary px-2.5 py-1 text-[11px] font-extrabold text-textPrimary">
                  {modeLabel}
                </span>

                {booking.status ? (
                  <span className="rounded-full border border-white/10 bg-bgSecondary px-2.5 py-1 text-[11px] font-semibold text-textSecondary">
                    {booking.status}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="rounded-full border border-white/10 bg-bgSecondary px-3 py-1.5 text-xs font-semibold text-textPrimary hover:bg-bgSecondary/70 disabled:opacity-70"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {loading ? (
            <div className="text-sm font-semibold text-textSecondary">
              Loading booking…
            </div>
          ) : null}

          {error ? (
            <div className="mb-3 rounded-xl border border-white/10 bg-bgSecondary p-3 text-sm font-semibold text-toneDanger">
              {error}
            </div>
          ) : null}

          {booking ? (
            <>
              <div className="mb-4 grid gap-3">
                <div className="text-base font-extrabold text-textPrimary">
                  {label}
                </div>

                <div className="rounded-2xl border border-white/10 bg-bgSecondary/80 p-3">
                  <div className="grid gap-2">
                    <div className="text-sm font-semibold text-textSecondary">
                      <span className="font-black text-textPrimary">
                        Client:
                      </span>{' '}
                      {booking.client.fullName}
                      {booking.client.email ? ` • ${booking.client.email}` : ''}
                      {booking.client.phone ? ` • ${booking.client.phone}` : ''}
                    </div>

                    <div className="text-sm font-semibold text-textSecondary">
                      <span className="font-black text-textPrimary">
                        When:
                      </span>{' '}
                      <span className="font-semibold text-textPrimary">
                        {formatAppointmentWhen(
                          new Date(booking.scheduledFor),
                          tz,
                        )}
                      </span>{' '}
                      <span className="opacity-75">· {tz}</span> (
                      {totalDuration} min)
                    </div>

                    <div className="text-sm font-semibold text-textSecondary">
                      <span className="font-black text-textPrimary">
                        Mode:
                      </span>{' '}
                      {modeLabel}
                    </div>

                    {booking.locationType === 'MOBILE' ? (
                      <div className="rounded-xl border border-white/10 bg-bgPrimary/70 p-3">
                        <div className="text-xs font-black uppercase tracking-wide text-textSecondary">
                          Mobile destination
                        </div>

                        <div className="mt-1 text-sm font-semibold text-textPrimary">
                          {locationMeta.address ||
                            'Address will appear here when booking location snapshots are returned.'}
                        </div>

                        {mapsUrl ? (
                          <div className="mt-3">
                            <a
                              href={mapsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex rounded-full border border-white/10 bg-bgSecondary px-3 py-2 text-xs font-extrabold text-textPrimary hover:bg-bgSecondary/70"
                            >
                              Open in Maps
                            </a>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {typeof booking.subtotalSnapshot === 'string' &&
                    booking.subtotalSnapshot.trim() ? (
                      <div className="text-sm font-semibold text-textSecondary">
                        <span className="font-black text-textPrimary">
                          Subtotal:
                        </span>{' '}
                        ${booking.subtotalSnapshot}
                      </div>
                    ) : null}
                  </div>
                </div>

                {isPending ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={onApprove}
                      disabled={saving}
                      className="rounded-full bg-accentPrimary px-4 py-2 text-xs font-extrabold text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-70"
                    >
                      Approve
                    </button>

                    <button
                      type="button"
                      onClick={onDeny}
                      disabled={saving}
                      className="rounded-full border border-white/10 bg-transparent px-4 py-2 text-xs font-extrabold text-textPrimary hover:bg-bgSecondary/40 disabled:opacity-70"
                    >
                      Deny
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="border-t border-white/10 pt-4">
                <div className="mb-2 text-sm font-extrabold text-textPrimary">
                  Edit appointment
                </div>

                {editOutside ? (
                  <div className="mb-3 rounded-2xl border border-white/10 bg-bgSecondary p-3 text-sm">
                    <div className="font-extrabold text-textPrimary">
                      Outside working hours
                    </div>
                    <div className="mt-1 text-sm font-semibold text-textSecondary">
                      You can still schedule this, but it’s outside your set
                      hours. Toggle override to allow it.
                    </div>

                    <label className="mt-2 flex items-center gap-2 text-sm font-semibold text-textSecondary">
                      <input
                        type="checkbox"
                        checked={allowOutsideHours}
                        onChange={(e) =>
                          onToggleAllowOutsideHours(e.target.checked)
                        }
                      />
                      Allow outside working hours (pro override)
                    </label>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-textSecondary">
                      Date
                    </div>
                    <input
                      type="date"
                      value={reschedDate}
                      onChange={(e) => onChangeReschedDate(e.target.value)}
                      disabled={saving}
                      className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm font-semibold text-textPrimary disabled:opacity-70"
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-textSecondary">
                      Time
                    </div>
                    <input
                      type="time"
                      step={15 * 60}
                      value={reschedTime}
                      onChange={(e) => onChangeReschedTime(e.target.value)}
                      disabled={saving}
                      className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm font-semibold text-textPrimary disabled:opacity-70"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold text-textSecondary">
                    Select services
                  </div>

                  {services.length ? (
                    <div className="rounded-2xl border border-white/10 bg-bgSecondary p-3">
                      <div className="grid gap-2">
                        {services.map((service) => {
                          const checked = selectedSet.has(service.id)
                          const dur =
                            typeof service.durationMinutes === 'number' &&
                            service.durationMinutes > 0
                              ? service.durationMinutes
                              : null
                          const price =
                            typeof service.priceStartingAt === 'string' &&
                            service.priceStartingAt.trim()
                              ? service.priceStartingAt
                              : null

                          return (
                            <label
                              key={`${service.id}:${service.offeringId ?? 'no-offering'}`}
                              className="flex items-center gap-3 rounded-xl border border-white/10 bg-bgPrimary px-3 py-2"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  toggleService(service.id, e.target.checked)
                                }
                                disabled={saving}
                              />

                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-extrabold text-textPrimary">
                                  {service.name}
                                </div>
                                <div className="text-xs font-semibold text-textSecondary">
                                  {dur != null
                                    ? `${dur} min`
                                    : 'Duration not set'}
                                  {price != null ? ` • $${price}` : ''}
                                </div>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-bgSecondary p-3 text-sm font-semibold text-textSecondary">
                      No active services available for this booking type.
                    </div>
                  )}
                </div>

                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-textSecondary">
                      Current service items
                    </div>
                    {hasDraftServiceItemsChanges ? (
                      <div className="rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-[10px] font-extrabold text-textPrimary">
                        Unsaved service changes
                      </div>
                    ) : null}
                  </div>

                  {items.length ? (
                    <div className="rounded-2xl border border-white/10 bg-bgSecondary p-3">
                      <div className="grid gap-2">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-bgPrimary px-3 py-2"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-extrabold text-textPrimary">
                                {item.serviceName}
                              </div>
                              <div className="text-xs font-semibold text-textSecondary">
                                {item.itemType === 'BASE'
                                  ? 'Base service'
                                  : 'Add-on'}
                              </div>
                            </div>

                            <div className="text-right text-xs font-semibold text-textSecondary">
                              <div>{item.durationMinutesSnapshot} min</div>
                              <div>${item.priceSnapshot}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-bgSecondary p-3 text-sm font-semibold text-textSecondary">
                      No service items selected.
                    </div>
                  )}
                </div>

                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold text-textSecondary">
                    Total duration
                  </div>
                  <div className="rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm font-extrabold text-textPrimary">
                    {totalDuration} minutes
                  </div>
                </div>

                <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-textSecondary">
                  <input
                    type="checkbox"
                    checked={notifyClient}
                    onChange={(e) => onToggleNotifyClient(e.target.checked)}
                    disabled={saving}
                  />
                  Notify client about changes
                </label>

                {noServicesSelected ? (
                  <div className="mt-3 rounded-2xl border border-toneDanger/30 bg-bgSecondary p-3 text-sm font-semibold text-toneDanger">
                    Select at least one service before saving.
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        <div className="border-t border-white/10 bg-bgPrimary/95 px-4 py-4 backdrop-blur">
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              disabled={saving}
              className="rounded-full border border-white/10 bg-transparent px-4 py-2 text-xs font-semibold text-textPrimary hover:bg-bgSecondary/40 disabled:opacity-70"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={onSave}
              disabled={
                saving ||
                noServicesSelected ||
                (editOutside && !allowOutsideHours)
              }
              className="rounded-full bg-bgSecondary px-4 py-2 text-xs font-extrabold text-textPrimary hover:bg-bgSecondary/70 disabled:opacity-70"
              title={
                noServicesSelected
                  ? 'Select at least one service before saving.'
                  : editOutside && !allowOutsideHours
                    ? 'Enable override to save outside working hours.'
                    : ''
              }
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}