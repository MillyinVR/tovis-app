// app/pro/calendar/_components/BookingModal.tsx
'use client'

import { useMemo } from 'react'
import type { BookingDetails, ServiceOption } from '../_types'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'

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

  const items = useMemo(() => {
    if (serviceItemsDraft && serviceItemsDraft.length > 0) return serviceItemsDraft
    return booking?.serviceItems ?? []
  }, [serviceItemsDraft, booking])

  const label = useMemo(() => {
    if (bookingServiceLabel && bookingServiceLabel.trim()) return bookingServiceLabel.trim()

    const names = items.map((item) => item.serviceName.trim()).filter(Boolean)
    return names.length ? names.join(' + ') : 'Appointment'
  }, [bookingServiceLabel, items])

  const totalDuration = useMemo(() => {
    if (Number.isFinite(durationMinutes) && durationMinutes > 0) return durationMinutes
    if (booking?.totalDurationMinutes && booking.totalDurationMinutes > 0) return booking.totalDurationMinutes
    return 60
  }, [durationMinutes, booking?.totalDurationMinutes])

  const selectedSet = useMemo(() => new Set(selectedDraftServiceIds), [selectedDraftServiceIds])

  function close() {
    if (saving) return
    onClose()
  }

  function toggleService(serviceId: string, checked: boolean) {
    const next = checked
      ? Array.from(new Set([...selectedDraftServiceIds, serviceId]))
      : selectedDraftServiceIds.filter((id) => id !== serviceId)

    onChangeSelectedDraftServiceIds(next)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-999 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div
        className="w-full max-w-170 overflow-hidden rounded-2xl border border-white/10 bg-bgPrimary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <div className="text-sm font-extrabold text-textPrimary">Appointment</div>

          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="rounded-full border border-white/10 bg-bgSecondary px-3 py-1.5 text-xs font-semibold text-textPrimary hover:bg-bgSecondary/70 disabled:opacity-70"
          >
            Close
          </button>
        </div>

        <div className="p-4">
          {loading ? <div className="text-sm font-semibold text-textSecondary">Loading booking…</div> : null}

          {error ? (
            <div className="mb-3 rounded-xl border border-white/10 bg-bgSecondary p-3 text-sm font-semibold text-toneDanger">
              {error}
            </div>
          ) : null}

          {booking ? (
            <>
              <div className="mb-4 grid gap-2">
                <div className="text-sm font-extrabold text-textPrimary">{label}</div>

                <div className="text-sm font-semibold text-textSecondary">
                  <span className="font-black text-textPrimary">Client:</span> {booking.client.fullName}
                  {booking.client.email ? ` • ${booking.client.email}` : ''}
                  {booking.client.phone ? ` • ${booking.client.phone}` : ''}
                </div>

                <div className="text-sm font-semibold text-textSecondary">
                  <span className="font-black text-textPrimary">When:</span>{' '}
                  <span className="font-semibold text-textPrimary">
                    {formatAppointmentWhen(new Date(booking.scheduledFor), tz)}
                  </span>{' '}
                  <span className="opacity-75">· {tz}</span> ({totalDuration} min)
                </div>

                {typeof booking.subtotalSnapshot === 'string' && booking.subtotalSnapshot.trim() ? (
                  <div className="text-sm font-semibold text-textSecondary">
                    <span className="font-black text-textPrimary">Subtotal:</span> ${booking.subtotalSnapshot}
                  </div>
                ) : null}

                {isPending ? (
                  <div className="mt-2 flex flex-wrap gap-2">
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
                <div className="mb-2 text-sm font-extrabold text-textPrimary">Edit appointment</div>

                {editOutside ? (
                  <div className="mb-3 rounded-2xl border border-white/10 bg-bgSecondary p-3 text-sm">
                    <div className="font-extrabold text-textPrimary">Outside working hours</div>
                    <div className="mt-1 text-sm font-semibold text-textSecondary">
                      You can still schedule this, but it’s outside your set hours. Toggle override to allow it.
                    </div>

                    <label className="mt-2 flex items-center gap-2 text-sm font-semibold text-textSecondary">
                      <input
                        type="checkbox"
                        checked={allowOutsideHours}
                        onChange={(e) => onToggleAllowOutsideHours(e.target.checked)}
                      />
                      Allow outside working hours (pro override)
                    </label>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-textSecondary">Date</div>
                    <input
                      type="date"
                      value={reschedDate}
                      onChange={(e) => onChangeReschedDate(e.target.value)}
                      disabled={saving}
                      className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm font-semibold text-textPrimary disabled:opacity-70"
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-textSecondary">Time</div>
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
                  <div className="mb-1 text-xs font-semibold text-textSecondary">Select services</div>

                  {services.length ? (
                    <div className="rounded-2xl border border-white/10 bg-bgSecondary p-3">
                      <div className="grid gap-2">
                        {services.map((service) => {
                          const checked = selectedSet.has(service.id)
                          const dur =
                            typeof service.durationMinutes === 'number' && service.durationMinutes > 0
                              ? service.durationMinutes
                              : null
                          const price =
                            typeof service.priceStartingAt === 'string' && service.priceStartingAt.trim()
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
                                onChange={(e) => toggleService(service.id, e.target.checked)}
                                disabled={saving}
                              />

                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-extrabold text-textPrimary">
                                  {service.name}
                                </div>
                                <div className="text-xs font-semibold text-textSecondary">
                                  {dur != null ? `${dur} min` : 'Duration not set'}
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
                    <div className="text-xs font-semibold text-textSecondary">Current service items</div>
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
                                {item.itemType === 'BASE' ? 'Base service' : 'Add-on'}
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
                  <div className="mb-1 text-xs font-semibold text-textSecondary">Total duration</div>
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

                <div className="mt-4 flex justify-end gap-2">
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
                    disabled={saving || (editOutside && !allowOutsideHours)}
                    className="rounded-full bg-bgSecondary px-4 py-2 text-xs font-extrabold text-textPrimary hover:bg-bgSecondary/70 disabled:opacity-70"
                    title={editOutside && !allowOutsideHours ? 'Enable override to save outside working hours.' : ''}
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}