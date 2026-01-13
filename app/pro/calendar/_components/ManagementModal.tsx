// app/pro/calendar/_components/ManagementModal.tsx

'use client'

import type { CalendarEvent, ManagementKey, ManagementLists } from '../_types'
import { statusLabel } from '../_utils/statusStyles'
import { eventChipClasses } from '../_utils/statusStyles'
import { isBlockedEvent } from '../_utils/calendarMath'

function titleFor(key: ManagementKey) {
  if (key === 'todaysBookings') return "Today's bookings"
  if (key === 'pendingRequests') return 'Pending requests'
  if (key === 'waitlistToday') return 'Waitlist (today)'
  return 'Blocked time (today)'
}

function descFor(key: ManagementKey) {
  if (key === 'todaysBookings') return 'Accepted + completed appointments happening today.'
  if (key === 'pendingRequests') return 'Requests waiting on you to accept/reschedule/decline.'
  if (key === 'waitlistToday') return 'Clients trying to get in today.'
  return 'Time you blocked off for yourself.'
}

export function ManagementModal(props: {
  open: boolean
  activeKey: ManagementKey
  management: ManagementLists
  onClose: () => void
  onSetKey: (k: ManagementKey) => void
  onPickEvent: (ev: CalendarEvent) => void
  onCreateBlockNow: () => void
  onBlockFullDayToday: () => void
}) {
  const { open, activeKey, management, onClose, onSetKey, onPickEvent, onCreateBlockNow, onBlockFullDayToday } = props
  if (!open) return null

  const activeList = management[activeKey] || []
  const activeCount = activeList.length

  return (
    <div className="fixed inset-0 z-1100 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-180 overflow-hidden rounded-2xl border border-white/10 bg-bgPrimary shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
          <div className="min-w-0">
            <div className="font-extrabold">{titleFor(activeKey)}</div>
            <div className="mt-1 text-sm text-textSecondary">{descFor(activeKey)}</div>
          </div>

          <div className="flex items-center gap-2">
            {activeKey === 'blockedToday' && (
              <>
                <button type="button" onClick={onCreateBlockNow} className="rounded-full bg-bgSecondary px-4 py-2 text-xs font-extrabold hover:bg-bgSecondary/70">
                  + Block personal time
                </button>
                <button type="button" onClick={onBlockFullDayToday} className="rounded-full border border-white/10 bg-transparent px-4 py-2 text-xs font-extrabold hover:bg-bgSecondary/40">
                  Block full day
                </button>
              </>
            )}

            <button type="button" onClick={onClose} className="rounded-full border border-white/10 bg-bgSecondary px-4 py-2 text-xs font-semibold hover:bg-bgSecondary/70">
              Close
            </button>
          </div>
        </div>

        <div className="p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {(['todaysBookings', 'pendingRequests', 'waitlistToday', 'blockedToday'] as ManagementKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onSetKey(k)}
                className={[
                  'rounded-full border px-3 py-1.5 text-xs font-semibold',
                  activeKey === k ? 'border-white/10 bg-bgSecondary' : 'border-white/10 bg-transparent hover:bg-bgSecondary/40',
                ].join(' ')}
              >
                {titleFor(k)} ({management[k]?.length ?? 0})
              </button>
            ))}
          </div>

          {activeCount === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-bgSecondary p-4 text-sm text-textSecondary">
              Nothing here right now.
              <div className="mt-2 text-textSecondary">
                If you haven’t implemented <span className="font-semibold text-textPrimary">WAITLIST</span> / <span className="font-semibold text-textPrimary">BLOCKED</span> yet, this being empty is expected.
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              {activeList.map((ev) => {
                const isBlock = isBlockedEvent(ev)
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onPickEvent(ev)}
                    className={['rounded-2xl p-4 text-left', eventChipClasses(ev)].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-extrabold">{isBlock ? 'Blocked time' : ev.title}</div>
                        <div className="mt-1 truncate text-sm text-textSecondary">
                          {isBlock ? ev.clientName || ev.note || 'Personal time' : ev.clientName} • {statusLabel(ev.status)}
                        </div>
                      </div>
                      <div className="shrink-0 text-sm text-textSecondary">
                        {new Date(ev.startsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
