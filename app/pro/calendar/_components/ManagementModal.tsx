// app/pro/calendar/_components/ManagementModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CalendarEvent, ManagementKey, ManagementLists } from '../_types'
import { statusLabel, eventChipClasses } from '../_utils/statusStyles'
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

function canShowActions(key: ManagementKey, ev: CalendarEvent) {
  if (isBlockedEvent(ev)) return false
  return key === 'pendingRequests'
}

function canShowMessage(key: ManagementKey, ev: CalendarEvent) {
  if (isBlockedEvent(ev)) return false
  return key === 'pendingRequests' || key === 'todaysBookings'
}

function messageHrefForBooking(bookingId: string) {
  return `/messages/start?contextType=BOOKING&contextId=${encodeURIComponent(bookingId)}`
}

function initialsFrom(name?: string | null) {
  const n = (name || '').trim()
  if (!n) return '?'
  const parts = n.split(/\s+/).filter(Boolean)
  const a = parts[0]?.[0] ?? ''
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : ''
  return (a + b).toUpperCase()
}

function formatStartsAt(startsAt: string) {
  const d = new Date(startsAt)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function prettyServiceTitle(title?: string | null) {
  const t = (title || '').trim()
  return t || 'Appointment'
}

// ✅ Booking events have clean id, blocks have "block_<id>".
// This guarantees approve/deny/message never accidentally uses a block id.
function bookingIdFor(ev: CalendarEvent): string | null {
  const raw = String((ev as any)?.bookingId || (ev as any)?.apiId || ev.id || '').trim()
  if (!raw) return null
  if (raw.startsWith('block_')) return null
  return raw.replace(/^booking[_:]/, '').trim()
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

  onApproveBookingId?: (bookingId: string) => void | Promise<void>
  onDenyBookingId?: (bookingId: string) => void | Promise<void>
  actionBusyId?: string | null
  actionError?: string | null
}) {
  const {
    open,
    activeKey,
    management,
    onClose,
    onSetKey,
    onPickEvent,
    onCreateBlockNow,
    onBlockFullDayToday,
    onApproveBookingId,
    onDenyBookingId,
    actionBusyId,
    actionError,
  } = props

  const [confirmDenyId, setConfirmDenyId] = useState<string | null>(null)

  // ✅ hooks must run every render (no conditional return before this)
  const activeList = management?.[activeKey] || []

  const sortedList = useMemo(() => {
    // Premium touch: pending sorted a bit more intentionally
    if (activeKey !== 'pendingRequests') return activeList
    const copy = [...activeList]
    copy.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    return copy
  }, [activeKey, activeList])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setConfirmDenyId(null)
      return
    }
    setConfirmDenyId(null)
  }, [open, activeKey])

  // ✅ safe to return null AFTER hooks
  if (!open) return null

  const activeCount = sortedList.length

  return (
    <div
      className="fixed inset-0 z-1100 flex items-center justify-center bg-black/75 p-3 backdrop-blur-md sm:p-6"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="tovis-glass w-full max-w-200 overflow-hidden rounded-card border border-white/10 bg-bgSecondary shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-white/10 bg-bgSecondary/70 backdrop-blur-md">
          <div className="flex items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-black text-textPrimary">{titleFor(activeKey)}</div>
              <div className="mt-1 text-[12px] font-semibold text-textSecondary">{descFor(activeKey)}</div>

              {actionError ? (
                <div className="mt-3 rounded-card border border-toneDanger/30 bg-bgPrimary px-3 py-2 text-[12px] font-semibold text-toneDanger">
                  {actionError}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {activeKey === 'blockedToday' ? (
                <>
                  <button
                    type="button"
                    onClick={onCreateBlockNow}
                    className="rounded-full bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
                  >
                    + Block time
                  </button>
                  <button
                    type="button"
                    onClick={onBlockFullDayToday}
                    className="rounded-full border border-white/10 bg-transparent px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
                  >
                    Block full day
                  </button>
                </>
              ) : null}

              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
              >
                Close
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="px-4 pb-4">
            <div className="flex flex-wrap gap-2">
              {(['todaysBookings', 'pendingRequests', 'waitlistToday', 'blockedToday'] as ManagementKey[]).map((k) => {
                const active = activeKey === k
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => onSetKey(k)}
                    className={[
                      'rounded-full border px-3 py-1.5 text-[12px] font-black transition',
                      active
                        ? 'border-white/10 bg-bgPrimary text-textPrimary'
                        : 'border-white/10 bg-transparent text-textSecondary hover:bg-surfaceGlass hover:text-textPrimary',
                    ].join(' ')}
                  >
                    {titleFor(k)} <span className="text-textSecondary">({management[k]?.length ?? 0})</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[72vh] overflow-auto p-4">
          {activeCount === 0 ? (
            <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
              Nothing here right now.
              <div className="mt-2 text-textSecondary/90">
                If you haven’t implemented <span className="font-black text-textPrimary">WAITLIST</span> /{' '}
                <span className="font-black text-textPrimary">BLOCKED</span> yet, this being empty is expected.
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              {sortedList.map((ev) => {
                const isBlock = isBlockedEvent(ev)
                const busy = Boolean(actionBusyId && actionBusyId === ev.id)

                const clientName = (ev.clientName || '').trim()
                const timeLabel = formatStartsAt(ev.startsAt)

                const bookingId = bookingIdFor(ev)

                return (
                  <div
                    key={ev.id}
                    className={[
                      'group rounded-card border border-white/10 p-4 transition',
                      'hover:border-white/15 hover:bg-surfaceGlass/20',
                      eventChipClasses(ev),
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-bgPrimary text-[12px] font-black text-textPrimary">
                          {isBlock ? '⏱' : initialsFrom(clientName)}
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-[13px] font-black text-textPrimary">
                              {isBlock ? 'Blocked time' : prettyServiceTitle(ev.title)}
                            </div>
                            <span className="rounded-full border border-white/10 bg-bgPrimary px-2 py-0.5 text-[11px] font-black text-textSecondary">
                              {statusLabel(ev.status)}
                            </span>
                          </div>

                          <div className="mt-1 truncate text-[12px] font-semibold text-textSecondary">
                            {isBlock ? ev.clientName || ev.note || 'Personal time' : clientName || 'Client'} • {timeLabel}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 text-right text-[11px] font-semibold text-textSecondary">
                        <div className="opacity-90">{timeLabel}</div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onPickEvent(ev)}
                          className="rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
                        >
                          {activeKey === 'pendingRequests' && !isBlock ? 'Review / Reschedule' : 'Open'}
                        </button>

                        {canShowMessage(activeKey, ev) && bookingId ? (
                          <a
                            href={messageHrefForBooking(bookingId)}
                            className="rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
                          >
                            Message
                          </a>
                        ) : null}
                      </div>

                      {canShowActions(activeKey, ev) ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {confirmDenyId === ev.id ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmDenyId(null)}
                                className="rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textSecondary hover:bg-surfaceGlass disabled:opacity-50"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={busy || !onDenyBookingId || !bookingId}
                                onClick={() => {
                                  if (bookingId) void onDenyBookingId?.(bookingId)
                                  setConfirmDenyId(null)
                                }}
                                className="rounded-full border border-toneDanger/30 bg-bgPrimary px-4 py-2 text-[12px] font-black text-toneDanger hover:bg-surfaceGlass disabled:opacity-50"
                              >
                                {busy ? 'Working…' : 'Confirm deny'}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={busy || !onDenyBookingId || !bookingId}
                              onClick={() => setConfirmDenyId(ev.id)}
                              className="rounded-full border border-toneDanger/30 bg-bgPrimary px-4 py-2 text-[12px] font-black text-toneDanger hover:bg-surfaceGlass disabled:opacity-50"
                            >
                              Deny
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={busy || !onApproveBookingId || !bookingId}
                            onClick={() => {
                              if (bookingId) void onApproveBookingId?.(bookingId)
                            }}
                            className="rounded-full bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-50"
                          >
                            {busy ? 'Working…' : 'Approve'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t border-white/10 bg-bgSecondary/60 px-4 py-3 text-[11px] font-semibold text-textSecondary backdrop-blur-md">
          Tip: Press <span className="font-black text-textPrimary">Esc</span> to close.
        </div>
      </div>
    </div>
  )
}
