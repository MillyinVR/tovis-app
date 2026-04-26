// app/pro/calendar/_components/ManagementModal.tsx
'use client'

import { useEffect, useMemo, useState }
from 'react'
import type { MouseEvent, ReactNode } from 'react'

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

type ButtonTone = 'default' | 'danger' | 'primary' | 'ghost'

type ButtonProps = {
  children: ReactNode
  tone?: ButtonTone
  disabled?: boolean
  onClick?: () => void
  ariaLabel?: string
  title?: string
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
    emptyBody:
      'When waitlist data is available, same-day holds will appear here.',
  },
  {
    key: 'blockedToday',
    title: 'Blocked time today',
    shortTitle: 'Blocked',
    description:
      'Time you blocked off for breaks, admin work, or personal time.',
    emptyTitle: 'No blocked time.',
    emptyBody: 'Use block time to protect breaks or close off the full day.',
  },
]

const PENDING_STATUS_PRIORITY = 'PENDING'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function tabForKey(key: ManagementKey): ManagementTab {
  return MANAGEMENT_TABS.find((tab) => tab.key === key) ?? MANAGEMENT_TABS[0]
}

function managementListForKey(
  management: ManagementLists,
  key: ManagementKey,
): CalendarEvent[] {
  return management[key]
}

function bookingIdFor(event: CalendarEvent): string | null {
  return event.kind === 'BOOKING' ? event.id : null
}

function canMessageEvent(key: ManagementKey, event: CalendarEvent): boolean {
  if (isBlockedEvent(event)) return false

  return key === 'pendingRequests' || key === 'todaysBookings'
}

function canModerateEvent(key: ManagementKey, event: CalendarEvent): boolean {
  if (isBlockedEvent(event)) return false

  return key === 'pendingRequests'
}

function messageHrefForBooking(bookingId: string): string {
  return `/messages/start?contextType=BOOKING&contextId=${encodeURIComponent(
    bookingId,
  )}`
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function initialsFromName(name: string): string {
  const trimmedName = name.trim()
  if (!trimmedName) return '?'

  const parts = trimmedName.split(/\s+/)
  const firstInitial = parts[0]?.charAt(0) ?? ''
  const lastInitial =
    parts.length > 1 ? parts[parts.length - 1]?.charAt(0) ?? '' : ''

  return `${firstInitial}${lastInitial}`.toUpperCase() || '?'
}

function eventDisplayTimeZone(
  event: CalendarEvent,
  viewportTimeZone: string,
): string {
  if (event.kind === 'BOOKING') return event.timeZone

  return viewportTimeZone
}

function buildTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatStartsAt(startsAt: string, timeZone: string): string {
  const date = new Date(startsAt)

  if (!Number.isFinite(date.getTime())) {
    return 'Time unavailable'
  }

  return buildTimeFormatter(timeZone).format(date)
}

function startMs(event: CalendarEvent): number {
  const ms = new Date(event.startsAt).getTime()

  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER
}

function statusPriority(event: CalendarEvent): number {
  return event.status.toUpperCase() === PENDING_STATUS_PRIORITY ? 0 : 1
}

function sortManagementEvents(
  key: ManagementKey,
  events: CalendarEvent[],
): CalendarEvent[] {
  return [...events].sort((first, second) => {
    if (key === 'pendingRequests') {
      const priorityDiff = statusPriority(first) - statusPriority(second)

      if (priorityDiff !== 0) return priorityDiff
    }

    const startDiff = startMs(first) - startMs(second)

    if (startDiff !== 0) return startDiff

    return first.id.localeCompare(second.id)
  })
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

function stopDialogMouseDown(event: MouseEvent<HTMLDivElement>): void {
  event.stopPropagation()
}

function closeOnEscape(args: {
  open: boolean
  onClose: () => void
}): (() => void) | undefined {
  const { open, onClose } = args

  if (!open) return undefined

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose()
  }

  window.addEventListener('keydown', onKeyDown)

  return () => window.removeEventListener('keydown', onKeyDown)
}

function lockBodyScroll(open: boolean): (() => void) | undefined {
  if (!open) return undefined

  const previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'

  return () => {
    document.body.style.overflow = previousOverflow
  }
}

// ─── Class helpers ────────────────────────────────────────────────────────────

function buttonClassName(tone: ButtonTone = 'default'): string {
  const base = [
    'rounded-full px-4 py-2 font-mono text-[11px] font-black uppercase tracking-[0.08em]',
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ].join(' ')

  if (tone === 'primary') {
    return [
      base,
      'border border-accentPrimary/30',
      'bg-[rgb(var(--accent-primary))] text-[rgb(var(--bg-primary))]',
      'hover:bg-[rgb(var(--accent-primary-hover))]',
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
      'border border-[var(--line)] bg-transparent',
      'text-[rgb(var(--text-muted))]',
      'hover:bg-[rgb(var(--surface-glass)_/_0.05)] hover:text-[rgb(var(--text-primary))]',
    ].join(' ')
  }

  return [
    base,
    'border border-[var(--line)]',
    'bg-[rgb(var(--surface-glass)_/_0.04)] text-[rgb(var(--text-primary))]',
    'hover:bg-[rgb(var(--surface-glass)_/_0.07)]',
  ].join(' ')
}

function tabButtonClassName(active: boolean): string {
  return [
    'shrink-0 rounded-full border px-3 py-2',
    'font-mono text-[10px] font-black uppercase tracking-[0.08em]',
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    active
      ? [
          'border-[rgb(var(--text-primary))]',
          'bg-[rgb(var(--text-primary))]',
          'text-[rgb(var(--bg-primary))]',
        ].join(' ')
      : [
          'border-[var(--line)] bg-transparent',
          'text-[rgb(var(--text-muted))]',
          'hover:bg-[rgb(var(--surface-glass)_/_0.05)] hover:text-[rgb(var(--text-primary))]',
        ].join(' '),
  ].join(' ')
}

function eventArticleClassName(args: {
  status: string
  isBlocked: boolean
}): string {
  const { status, isBlocked } = args

  return [
    'rounded-2xl border p-4 transition',
    'bg-[rgb(var(--surface-glass)_/_0.03)]',
    'hover:bg-[rgb(var(--surface-glass)_/_0.05)]',
    eventChipClassName({ status, isBlocked }),
  ].join(' ')
}

function modalPanelClassName(): string {
  return [
    'w-full overflow-hidden rounded-t-[24px]',
    'border border-[var(--line-strong)]',
    'bg-[rgb(var(--bg-primary))]',
    'shadow-[0_28px_80px_rgb(0_0_0_/_0.60)]',
    'sm:max-w-[56rem] sm:rounded-[24px]',
  ].join(' ')
}

function modalHeaderClassName(): string {
  return [
    'sticky top-0 z-10 border-b border-[var(--line-strong)]',
    'bg-[rgb(var(--bg-primary)_/_0.95)] backdrop-blur-xl',
  ].join(' ')
}

function modalFooterClassName(): string {
  return [
    'border-t border-[var(--line-strong)]',
    'bg-[rgb(var(--bg-primary)_/_0.90)] px-4 py-3',
    'font-mono text-[10px] font-semibold uppercase tracking-[0.10em]',
    'text-[rgb(var(--text-muted))] backdrop-blur-xl sm:px-5',
  ].join(' ')
}

function mutedTextClassName(): string {
  return 'text-[rgb(var(--text-muted))]'
}

function primaryTextClassName(): string {
  return 'text-[rgb(var(--text-primary))]'
}

function secondaryTextClassName(): string {
  return 'text-[rgb(var(--text-secondary))]'
}

// ─── Small components ─────────────────────────────────────────────────────────

function ActionButton(props: ButtonProps) {
  const {
    children,
    tone = 'default',
    disabled = false,
    onClick,
    ariaLabel,
    title,
  } = props

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={buttonClassName(tone)}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </button>
  )
}

function ActionLink(props: {
  href: string
  children: ReactNode
  tone?: ButtonTone
}) {
  const { href, children, tone = 'ghost' } = props

  return (
    <a href={href} className={buttonClassName(tone)}>
      {children}
    </a>
  )
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
    >
      <div
        className={modalPanelClassName()}
        onMouseDown={stopDialogMouseDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-management-title"
      >
        <div className={modalHeaderClassName()}>
          <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[rgb(var(--accent-primary-hover))]">
                ◆ Calendar management
              </p>

              <h2
                id="calendar-management-title"
                className="mt-1 truncate font-display text-3xl font-semibold italic tracking-[-0.05em] text-[rgb(var(--text-primary))]"
              >
                {activeTab.title}
              </h2>

              <p
                className={[
                  'mt-1 max-w-2xl text-sm leading-6',
                  secondaryTextClassName(),
                ].join(' ')}
              >
                {activeTab.description}
              </p>

              {actionError ? (
                <div className="mt-3 rounded-xl border border-toneDanger/30 bg-toneDanger/10 px-3 py-2 text-sm font-semibold text-toneDanger">
                  {actionError}
                </div>
              ) : null}
            </div>

            <ActionButton
              tone="ghost"
              onClick={() => {
                setConfirmDenyId(null)
                onClose()
              }}
              ariaLabel="Close calendar management"
            >
              Close
            </ActionButton>
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
                    <span
                      className={
                        active
                          ? 'text-[rgb(var(--bg-primary)_/_0.60)]'
                          : mutedTextClassName()
                      }
                    >
                      ({count})
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {activeKey === 'blockedToday' ? (
            <div className="flex flex-wrap gap-2 border-t border-[var(--line)] px-4 py-3 sm:px-5">
              <ActionButton
                tone="primary"
                onClick={() => {
                  setConfirmDenyId(null)
                  onCreateBlockNow()
                }}
              >
                + Block time
              </ActionButton>

              <ActionButton
                onClick={() => {
                  setConfirmDenyId(null)
                  onBlockFullDayToday()
                }}
              >
                Block full day
              </ActionButton>
            </div>
          ) : null}
        </div>

        <div className="max-h-[72vh] overflow-auto p-4 sm:p-5">
          {sortedList.length === 0 ? (
            <EmptyManagementState tab={activeTab} />
          ) : (
            <div className="grid gap-3">
              {sortedList.map((event) => (
                <ManagementEventRow
                  key={event.id}
                  event={event}
                  activeKey={activeKey}
                  viewportTimeZone={viewportTimeZone}
                  confirmDenyId={confirmDenyId}
                  actionBusyId={actionBusyId}
                  onSetConfirmDenyId={setConfirmDenyId}
                  onPickEvent={onPickEvent}
                  onApproveBookingId={onApproveBookingId}
                  onDenyBookingId={onDenyBookingId}
                />
              ))}
            </div>
          )}
        </div>

        <div className={modalFooterClassName()}>
          Press <span className={primaryTextClassName()}>Esc</span> to close.
        </div>
      </div>
    </div>
  )
}

// ─── Row components ───────────────────────────────────────────────────────────

function ManagementEventRow(props: {
  event: CalendarEvent
  activeKey: ManagementKey
  viewportTimeZone: string
  confirmDenyId: string | null
  actionBusyId: string | null
  onSetConfirmDenyId: (id: string | null) => void
  onPickEvent: (event: CalendarEvent) => void
  onApproveBookingId?: (bookingId: string) => void | Promise<void>
  onDenyBookingId?: (bookingId: string) => void | Promise<void>
}) {
  const {
    event,
    activeKey,
    viewportTimeZone,
    confirmDenyId,
    actionBusyId,
    onSetConfirmDenyId,
    onPickEvent,
    onApproveBookingId,
    onDenyBookingId,
  } = props

  const bookingId = bookingIdFor(event)
  const isBlock = isBlockedEvent(event)

  const rowCopy = buildEventRowCopy({
    event,
    viewportTimeZone,
  })

  const busy = Boolean(actionBusyId && bookingId && actionBusyId === bookingId)

  const messageBookingId =
    canMessageEvent(activeKey, event) && bookingId ? bookingId : null

  const showModeration = canModerateEvent(activeKey, event)

  return (
    <article
      className={eventArticleClassName({
        status: event.status,
        isBlocked: isBlock,
      })}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <AvatarInitials initials={rowCopy.initials} />

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-display text-lg font-semibold italic tracking-[-0.04em] text-[rgb(var(--text-primary))]">
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

            <p
              className={[
                'mt-1 truncate text-sm font-semibold',
                secondaryTextClassName(),
              ].join(' ')}
            >
              {rowCopy.subtitle}
            </p>
          </div>
        </div>

        <p
          className={[
            'hidden shrink-0 text-right font-mono text-[10px] font-black uppercase tracking-[0.08em] sm:block',
            mutedTextClassName(),
          ].join(' ')}
        >
          {rowCopy.timeLabel}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <ActionButton
            onClick={() => {
              onSetConfirmDenyId(null)
              onPickEvent(event)
            }}
          >
            {activeKey === 'pendingRequests' && !isBlock
              ? 'Review / Reschedule'
              : 'Open'}
          </ActionButton>

          {messageBookingId ? (
            <ActionLink href={messageHrefForBooking(messageBookingId)}>
              Message
            </ActionLink>
          ) : null}
        </div>

        {showModeration ? (
          <ModerationActions
            eventId={event.id}
            bookingId={bookingId}
            busy={busy}
            confirmDenyId={confirmDenyId}
            onSetConfirmDenyId={onSetConfirmDenyId}
            onApproveBookingId={onApproveBookingId}
            onDenyBookingId={onDenyBookingId}
          />
        ) : null}
      </div>
    </article>
  )
}

function AvatarInitials(props: { initials: string }) {
  const { initials } = props

  return (
    <div
      className={[
        'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
        'border border-[var(--line)] bg-[rgb(var(--bg-secondary))]',
        'font-mono text-xs font-black text-[rgb(var(--text-primary))]',
      ].join(' ')}
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}

function ModerationActions(props: {
  eventId: string
  bookingId: string | null
  busy: boolean
  confirmDenyId: string | null
  onSetConfirmDenyId: (id: string | null) => void
  onApproveBookingId?: (bookingId: string) => void | Promise<void>
  onDenyBookingId?: (bookingId: string) => void | Promise<void>
}) {
  const {
    eventId,
    bookingId,
    busy,
    confirmDenyId,
    onSetConfirmDenyId,
    onApproveBookingId,
    onDenyBookingId,
  } = props

  const confirmingDeny = confirmDenyId === eventId

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirmingDeny ? (
        <>
          <ActionButton
            tone="ghost"
            disabled={busy}
            onClick={() => onSetConfirmDenyId(null)}
          >
            Cancel
          </ActionButton>

          <ActionButton
            tone="danger"
            disabled={busy || !onDenyBookingId || !bookingId}
            onClick={() => {
              if (!bookingId || !onDenyBookingId) return

              void onDenyBookingId(bookingId)
              onSetConfirmDenyId(null)
            }}
          >
            {busy ? 'Working…' : 'Confirm deny'}
          </ActionButton>
        </>
      ) : (
        <ActionButton
          tone="danger"
          disabled={busy || !onDenyBookingId || !bookingId}
          onClick={() => onSetConfirmDenyId(eventId)}
        >
          Deny
        </ActionButton>
      )}

      <ActionButton
        tone="primary"
        disabled={busy || !onApproveBookingId || !bookingId}
        onClick={() => {
          onSetConfirmDenyId(null)

          if (!bookingId || !onApproveBookingId) return

          void onApproveBookingId(bookingId)
        }}
      >
        {busy ? 'Working…' : 'Approve'}
      </ActionButton>
    </div>
  )
}

function EmptyManagementState(props: { tab: ManagementTab }) {
  const { tab } = props

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[rgb(var(--surface-glass)_/_0.03)] p-5">
      <p className="font-display text-2xl font-semibold italic tracking-[-0.04em] text-[rgb(var(--text-primary))]">
        {tab.emptyTitle}
      </p>

      <p
        className={[
          'mt-2 max-w-xl text-sm leading-6',
          secondaryTextClassName(),
        ].join(' ')}
      >
        {tab.emptyBody}
      </p>
    </div>
  )
}