// app/pro/calendar/_components/BookingModal.tsx

'use client'

import type { BookingDetails, ServiceOption } from '../_types'

export function BookingModal(props: {
  open: boolean
  loading: boolean
  error: string | null
  booking: BookingDetails | null
  services: ServiceOption[]
  reschedDate: string
  reschedTime: string
  durationMinutes: number
  selectedServiceId: string
  notifyClient: boolean
  allowOutsideHours: boolean
  editOutside: boolean
  saving: boolean
  onClose: () => void
  onChangeReschedDate: (v: string) => void
  onChangeReschedTime: (v: string) => void
  onChangeDurationMinutes: (v: number) => void
  onChangeSelectedServiceId: (v: string) => void
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
    reschedDate,
    reschedTime,
    durationMinutes,
    selectedServiceId,
    notifyClient,
    allowOutsideHours,
    editOutside,
    saving,
    onClose,
    onChangeReschedDate,
    onChangeReschedTime,
    onChangeDurationMinutes,
    onChangeSelectedServiceId,
    onToggleNotifyClient,
    onToggleAllowOutsideHours,
    onSave,
    onApprove,
    onDeny,
  } = props

  if (!open) return null

  return (
    <div className="fixed inset-0 z-999 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-150 overflow-hidden rounded-2xl border border-white/10 bg-bgPrimary shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <div className="font-extrabold">Appointment</div>
          <button type="button" onClick={onClose} className="rounded-full border border-white/10 bg-bgSecondary px-3 py-1.5 text-xs font-semibold hover:bg-bgSecondary/70">
            Close
          </button>
        </div>

        <div className="p-4">
          {loading && <div className="text-sm text-textSecondary">Loading booking…</div>}
          {error && <div className="mb-2 text-sm text-red-400">{error}</div>}

          {booking && (
            <>
              <div className="mb-4 grid gap-2">
                <div className="text-sm font-extrabold">{booking.serviceName}</div>
                <div className="text-sm text-textSecondary">
                  <span className="font-semibold text-textPrimary">Client:</span> {booking.client.fullName}
                  {booking.client.email ? ` • ${booking.client.email}` : ''}
                  {booking.client.phone ? ` • ${booking.client.phone}` : ''}
                </div>

                <div className="text-sm text-textSecondary">
                  <span className="font-semibold text-textPrimary">When:</span>{' '}
                  {new Date(booking.scheduledFor).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}{' '}
                  ({booking.totalDurationMinutes} min)
                </div>

                {String(booking.status || '').toUpperCase() === 'PENDING' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={onApprove}
                      disabled={saving}
                      className="rounded-full bg-bgSecondary px-4 py-2 text-xs font-extrabold hover:bg-bgSecondary/70 disabled:opacity-70"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={onDeny}
                      disabled={saving}
                      className="rounded-full border border-white/10 bg-transparent px-4 py-2 text-xs font-extrabold hover:bg-bgSecondary/40 disabled:opacity-70"
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 pt-4">
                <div className="mb-2 text-sm font-extrabold">Edit appointment</div>

                {editOutside && (
                  <div className="mb-3 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
                    <div className="font-extrabold">Outside working hours</div>
                    <div className="mt-1 text-textSecondary">
                      You can still schedule this, but it’s outside your set hours. Toggle override to allow it.
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={allowOutsideHours} onChange={(e) => onToggleAllowOutsideHours(e.target.checked)} />
                      Allow outside working hours (pro override)
                    </label>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-xs text-textSecondary">Date</div>
                    <input
                      type="date"
                      value={reschedDate}
                      onChange={(e) => onChangeReschedDate(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs text-textSecondary">Time</div>
                    <input
                      type="time"
                      step={15 * 60}
                      value={reschedTime}
                      onChange={(e) => onChangeReschedTime(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 text-xs text-textSecondary">Duration (minutes)</div>
                  <input
                    type="number"
                    step={15}
                    min={15}
                    max={720}
                    value={durationMinutes}
                    onChange={(e) => onChangeDurationMinutes(Number(e.target.value))}
                    className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm"
                  />
                </div>

                {services?.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 text-xs text-textSecondary">Service</div>
                    <select
                      value={selectedServiceId}
                      onChange={(e) => onChangeSelectedServiceId(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm"
                    >
                      <option value="">(No service)</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={notifyClient} onChange={(e) => onToggleNotifyClient(e.target.checked)} />
                  Notify client about changes
                </label>

                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={onClose} className="rounded-full border border-white/10 bg-transparent px-4 py-2 text-xs font-semibold hover:bg-bgSecondary/40">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={saving || (editOutside && !allowOutsideHours)}
                    className="rounded-full bg-bgSecondary px-4 py-2 text-xs font-extrabold hover:bg-bgSecondary/70 disabled:opacity-70"
                    title={editOutside && !allowOutsideHours ? 'Enable override to save outside working hours.' : ''}
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
