// app/pro/calendar/_components/ManagementModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent } from 'react'

import type { CalendarEvent, ManagementKey, ManagementLists } from '../_types'

import { isBlockedEvent } from '../_utils/calendarMath'
import {
  calendarStatusMeta,
  eventBadgeClassName,
  eventChipClassName,
} from '../_utils/statusStyles'

// ─── Types ────────────────────────────────────────────────────────────────────

type ManagementModalProps = {
  open: boolean
  activeKey: ManagementKey
  management: ManagementLists
  viewportTimeZone: string
  onClose: () => void
  onSetKey: (key: ManagementKey) => void
  onPickEvent: (event: CalendarEvent) => void
  onCreateBlockNow: () => void
  onBlockFullDayToday: () => void

  onApproveBookingId?: (bookingId: string) => void | Promise<void>
  onDenyBookingId?: (bookingId: string) => void | Promise<void>
  actionBusyId?: string | null
  actionError?: string | null
}

type ManagementTab = {
  key: ManagementKey
  title: string
  shortTitle: string
  description: string
  emptyTitle: string
  emptyBody: string
}

type EventRowCopy = {
  title: string
  subtitle: string
  initials: string
  timeLabel: string
  statusLabel: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MANAGEMENT_TABS: ReadonlyArray<ManagementTab> = [
  {
    key: 'todaysBookings',
    title: "Today's bookings",
    shortTitle: 'Today',
    description: 'Accepted and completed appointments happening today.',
    emptyTitle: 'No bookings today.',
    emptyBody: 'Nothing is scheduled for the selected calendar day.',
  },
  {
    key: 'pendingRequests',
    title: 'Pending requests',
    shortTitle: 'Pending',
    description: 'Client requests waiting for approval or denial.',
    emptyTitle: 'No pending requests.',
    emptyBody: 'Freshly calm. Suspicious, but we will take it.',
  },
  {
    key: 'waitlistToday',
    title: 'Waitlist today',
    shortTitle: 'Waitlist',
    description: 'Clients trying to get into an opening today.',
    emptyTitle: 'No waitlist entries.',
    emptyBody: 'When waitlist data is available, same-day holds will appear here.',
  },
  {
    key: 'blockedToday',
    title: 'Blocked time today',
    shortTitle: 'Blocked',
    description: 'Time you blocked off for breaks, admin work, or personal time.',
    emptyTitle: 'No blocked time.',
    emptyBody: 'Use block time to protect breaks or close off the full day.',
  },
]

const PENDING_STATUS_PRIORITY = 'PENDING'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function tabForKey(key: ManagementKey) {
  return MANAGEMENT_TABS.find((tab) => tab.key === key) ?? MANAGEMENT_TABS[0]
}

function managementListForKey(management: ManagementLists, key: ManagementKey) {
  return management[key]
}

function bookingIdFor(event: CalendarEvent) {
  return event.kind === 'BOOKING' ? event.id : null
}

function canMessageEvent(key: ManagementKey, event: CalendarEvent) {
  if (isBlockedEvent(event)) return false

  return key === 'pendingRequests' || key === 'todaysBookings'
}

function canModerateEvent(key: ManagementKey, event: CalendarEvent) {
  if (isBlockedEvent(event)) return false

  return key === 'pendingRequests'
}

function messageHrefForBooking(bookingId: string) {
  return `/messages/start?contextType=BOOKING&contextId=${encodeURIComponent(
    bookingId,
  )}`
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

function initialsFromName(name: string) {
  const trimmedName = name.trim()
  if (!trimmedName) return '?'

  const parts = trimmedName.split(/\s+/)
  const firstInitial = parts[0]?.charAt(0) ?? ''
  const lastInitial =
    parts.length > 1 ? parts[parts.length - 1]?.charAt(0) ?? '' : ''

  return `${firstInitial}${lastInitial}`.toUpperCase() || '?'
}

function eventDisplayTimeZone(event: CalendarEvent, viewportTimeZone: string) {
  if (event.kind === 'BOOKING') return event.timeZone

  return viewportTimeZone
}

function buildTimeFormatter(timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatStartsAt(startsAt: string, timeZone: string) {
  const date = new Date(startsAt)

  if (!Number.isFinite(date.getTime())) {
    return 'Time unavailable'
  }

  return buildTimeFormatter(timeZone).format(date)
}

function startMs(event: CalendarEvent) {
  const ms = new Date(event.startsAt).getTime()

  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER
}

function sortManagementEvents(key: ManagementKey, events: CalendarEvent[]) {
  const copy = [...events]

  copy.sort((first, second) => {
    if (key === 'pendingRequests') {
      const firstPending =
        first.status.toUpperCase() === PENDING_STATUS_PRIORITY ? 0 : 1
      const secondPending =
        second.status.toUpperCase() === PENDING_STATUS_PRIORITY ? 0 : 1

      if (firstPending !== secondPending) {
        return firstPending - secondPending
      }
    }

    return startMs(first) - startMs(second)
  })

  return copy
}

function buildEventRowCopy(args: {
  event: CalendarEvent
  viewportTimeZone: string
}): EventRowCopy {
  const { event, viewportTimeZone } = args
  const isBlock = isBlockedEvent(event)

  const statusMeta = calendarStatusMeta({
    status: event.status,
    isBlocked: isBlock,
  })

  const timeZone = eventDisplayTimeZone(event, viewportTimeZone)
  const timeLabel = formatStartsAt(event.startsAt, timeZone)

  if (event.kind === 'BLOCK') {
    const note = normalizeText(event.note)
    const title = normalizeText(event.title)

    return {
      title: 'Blocked time',
      subtitle: `${note || title || 'Personal time'} · ${timeLabel}`,
      initials: '⏱',
      timeLabel,
      statusLabel: statusMeta.label,
    }
  }

  const clientName = normalizeText(event.clientName)
  const title = normalizeText(event.title)

  return {
    title: title || 'Appointment',
    subtitle: `${clientName || 'Client'} · ${timeLabel}`,
    initials: initialsFromName(clientName),
    timeLabel,
    statusLabel: statusMeta.label,
  }
}

function stopDialogMouseDown(event: MouseEvent<HTMLDivElement>) {
  event.stopPropagation()
}

function closeOnEscape(args: {
  open: boolean
  onClose: () => void
}) {
  const { open, onClose } = args

  if (!open) return

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose()
  }

  window.addEventListener('keydown', onKeyDown)

  return () => window.removeEventListener('keydown', onKeyDown)
}

function lockBodyScroll(open: boolean) {
  if (!open) return

  const previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'

  return () => {
    document.body.style.overflow = previousOverflow
  }
}

function buttonClassName(options?: {
  tone?: 'default' | 'danger' | 'primary' | 'ghost'
}) {
  const tone = options?.tone ?? 'default'

  const base = [
    'rounded-full px-4 py-2 font-mono text-[11px] font-black uppercase tracking-[0.08em]',
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ].join(' ')

  if (tone === 'primary') {
    return [
      base,
      'border border-accentPrimary/30 bg-accentPrimary text-ink hover:bg-accentPrimaryHover',
    ].join(' ')
  }

  if (tone === 'danger') {
    return [
      base,
      'border border-toneDanger/30 bg-toneDanger/10 text-toneDanger hover:bg-toneDanger/15',
    ].join(' ')
  }

  if (tone === 'ghost') {
    return [
      base,
      'border border-[var(--line)] bg-transparent text-paperMute',
      'hover:bg-paper/5 hover:text-paper',
    ].join(' ')
  }

  return [
    base,
    'border border-[var(--line)] bg-paper/[0.04] text-paper hover:bg-paper/[0.07]',
  ].join(' ')
}

function tabButtonClassName(active: boolean) {
  return [
    'shrink-0 rounded-full border px-3 py-2',
    'font-mono text-[10px] font-black uppercase tracking-[0.08em]',
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    active
      ? 'border-paper bg-paper text-ink'
      : 'border-[var(--line)] bg-transparent text-paperMute hover:bg-paper/5 hover:text-paper',
  ].join(' ')
}

function eventArticleClassName(args: {
  status: string
  isBlocked: boolean
}) {
  const { status, isBlocked } = args

  return [
    'rounded-2xl border p-4 transition',
    'bg-paper/[0.03] hover:bg-paper/[0.05]',
    eventChipClassName({ status, isBlocked }),
  ].join(' ')
}

// ─── Exported component ───────────────────────────────────────────────────────

export function ManagementModal(props: ManagementModalProps) {
  const {
    open,
    activeKey,
    management,
    viewportTimeZone,
    onClose,
    onSetKey,
    onPickEvent,
    onCreateBlockNow,
    onBlockFullDayToday,
    onApproveBookingId,
    onDenyBookingId,
    actionBusyId = null,
    actionError = null,
  } = props

  const [confirmDenyId, setConfirmDenyId] = useState<string | null>(null)

  const activeTab = tabForKey(activeKey)

  const sortedList = useMemo(
    () =>
      sortManagementEvents(
        activeKey,
        managementListForKey(management, activeKey),
      ),
    [activeKey, management],
  )

  useEffect(() => closeOnEscape({ open, onClose }), [open, onClose])
  useEffect(() => lockBodyScroll(open), [open])

  useEffect(() => {
    setConfirmDenyId(null)
  }, [activeKey, open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/75 p-0 backdrop-blur-md sm:items-center sm:p-6"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-management-title"
    >
      <div
        className={[
          'w-full overflow-hidden rounded-t-[24px] border border-[var(--line-strong)]',
          'bg-ink shadow-[0_28px_80px_rgb(0_0_0_/_0.60)]',
          'sm:max-w-[56rem] sm:rounded-[24px]',
        ].join(' ')}
        onMouseDown={stopDialogMouseDown}
      >
        <div className="sticky top-0 z-10 border-b border-[var(--line-strong)] bg-ink/95 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-terraGlow">
                ◆ Calendar management
              </p>

              <h2
                id="calendar-management-title"
                className="mt-1 truncate font-display text-3xl font-semibold italic tracking-[-0.05em] text-paper"
              >
                {activeTab.title}
              </h2>

              <p className="mt-1 max-w-2xl text-sm leading-6 text-paperDim">
                {activeTab.description}
              </p>

              {actionError ? (
                <div className="mt-3 rounded-xl border border-toneDanger/30 bg-toneDanger/10 px-3 py-2 text-sm font-semibold text-toneDanger">
                  {actionError}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => {
                setConfirmDenyId(null)
                onClose()
              }}
              className={buttonClassName({ tone: 'ghost' })}
              aria-label="Close calendar management"
            >
              Close
            </button>
          </div>

          <div className="px-4 pb-4 sm:px-5">
            <div className="flex gap-2 overflow-x-auto pb-1 looksNoScrollbar">
              {MANAGEMENT_TABS.map((tab) => {
                const active = activeKey === tab.key
                const count = managementListForKey(management, tab.key).length

                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => onSetKey(tab.key)}
                    className={tabButtonClassName(active)}
                    aria-pressed={active}
                  >
                    {tab.shortTitle}{' '}
                    <span className={active ? 'text-ink/60' : 'text-paperMute'}>
                      ({count})
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {activeKey === 'blockedToday' ? (
            <div className="flex flex-wrap gap-2 border-t border-[var(--line)] px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={() => {
                  setConfirmDenyId(null)
                  onCreateBlockNow()
                }}
                className={buttonClassName({ tone: 'primary' })}
              >
                + Block time
              </button>

              <button
                type="button"
                onClick={() => {
                  setConfirmDenyId(null)
                  onBlockFullDayToday()
                }}
                className={buttonClassName()}
              >
                Block full day
              </button>
            </div>
          ) : null}
        </div>

        <div className="max-h-[72vh] overflow-auto p-4 sm:p-5">
          {sortedList.length === 0 ? (
            <EmptyManagementState tab={activeTab} />
          ) : (
            <div className="grid gap-3">
              {sortedList.map((event) => {
                const bookingId = bookingIdFor(event)
                const isBlock = isBlockedEvent(event)
                const rowCopy = buildEventRowCopy({
                  event,
                  viewportTimeZone,
                })

                const busy = Boolean(
                  actionBusyId && bookingId && actionBusyId === bookingId,
                )

                const messageBookingId =
                  canMessageEvent(activeKey, event) && bookingId
                    ? bookingId
                    : null

                const showModeration = canModerateEvent(activeKey, event)

                return (
                  <article
                    key={event.id}
                    className={eventArticleClassName({
                      status: event.status,
                      isBlocked: isBlock,
                    })}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div
                          className={[
                            'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                            'border border-[var(--line)] bg-ink',
                            'font-mono text-xs font-black text-paper',
                          ].join(' ')}
                          aria-hidden="true"
                        >
                          {rowCopy.initials}
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate font-display text-lg font-semibold italic tracking-[-0.04em] text-paper">
                              {rowCopy.title}
                            </h3>

                            <span
                              className={[
                                'rounded-full border px-2 py-0.5',
                                'font-mono text-[9px] font-black uppercase tracking-[0.08em]',
                                eventBadgeClassName({
                                  status: event.status,
                                  isBlocked: isBlock,
                                }),
                              ].join(' ')}
                            >
                              {rowCopy.statusLabel}
                            </span>
                          </div>

                          <p className="mt-1 truncate text-sm font-semibold text-paperDim">
                            {rowCopy.subtitle}
                          </p>
                        </div>
                      </div>

                      <p className="hidden shrink-0 text-right font-mono text-[10px] font-black uppercase tracking-[0.08em] text-paperMute sm:block">
                        {rowCopy.timeLabel}
                      </p>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDenyId(null)
                            onPickEvent(event)
                          }}
                          className={buttonClassName()}
                        >
                          {activeKey === 'pendingRequests' && !isBlock
                            ? 'Review / Reschedule'
                            : 'Open'}
                        </button>

                        {messageBookingId ? (
                          <a
                            href={messageHrefForBooking(messageBookingId)}
                            className={buttonClassName({ tone: 'ghost' })}
                          >
                            Message
                          </a>
                        ) : null}
                      </div>

                      {showModeration ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {confirmDenyId === event.id ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmDenyId(null)}
                                className={buttonClassName({ tone: 'ghost' })}
                              >
                                Cancel
                              </button>

                              <button
                                type="button"
                                disabled={busy || !onDenyBookingId || !bookingId}
                                onClick={() => {
                                  if (!bookingId || !onDenyBookingId) return

                                  void onDenyBookingId(bookingId)
                                  setConfirmDenyId(null)
                                }}
                                className={buttonClassName({ tone: 'danger' })}
                              >
                                {busy ? 'Working…' : 'Confirm deny'}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={busy || !onDenyBookingId || !bookingId}
                              onClick={() => setConfirmDenyId(event.id)}
                              className={buttonClassName({ tone: 'danger' })}
                            >
                              Deny
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={busy || !onApproveBookingId || !bookingId}
                            onClick={() => {
                              setConfirmDenyId(null)

                              if (!bookingId || !onApproveBookingId) return

                              void onApproveBookingId(bookingId)
                            }}
                            className={buttonClassName({ tone: 'primary' })}
                          >
                            {busy ? 'Working…' : 'Approve'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--line-strong)] bg-ink/90 px-4 py-3 font-mono text-[10px] font-semibold uppercase tracking-[0.10em] text-paperMute backdrop-blur-xl sm:px-5">
          Press <span className="text-paper">Esc</span> to close.
        </div>
      </div>
    </div>
  )
}

function EmptyManagementState(props: { tab: ManagementTab }) {
  const { tab } = props

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-paper/[0.03] p-5">
      <p className="font-display text-2xl font-semibold italic tracking-[-0.04em] text-paper">
        {tab.emptyTitle}
      </p>

      <p className="mt-2 max-w-xl text-sm leading-6 text-paperDim">
        {tab.emptyBody}
      </p>
    </div>
  )
}