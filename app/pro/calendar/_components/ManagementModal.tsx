// app/pro/calendar/_components/ManagementModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

import type { CalendarEvent, ManagementKey, ManagementLists } from '../_types'

import { isBlockedEvent } from '../_utils/calendarMath'
import { calendarStatusMeta } from '../_utils/statusStyles'

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

  /**
   * Bridge until this modal copy moves fully into BrandProCalendarCopy.
   */
  copy?: ManagementModalCopyOverride
}

type ManagementTab = {
  key: ManagementKey
  title: string
  shortTitle: string
  description: string
  emptyTitle: string
  emptyBody: string
}

type ManagementTabCopy = Omit<ManagementTab, 'key'>

type ManagementModalCopy = {
  eyebrow: string
  closeLabel: string

  blockTimeAction: string
  blockFullDayAction: string

  reviewRescheduleAction: string
  openAction: string
  messageAction: string

  cancelAction: string
  denyAction: string
  confirmDenyAction: string
  approveAction: string
  workingLabel: string

  timeUnavailable: string
  blockedTimeTitle: string
  personalTimeFallback: string
  appointmentFallback: string
  clientFallback: string
  blockedInitials: string

  pressEscPrefix: string
  pressEscKeyLabel: string
  pressEscSuffix: string

  tabs: Record<ManagementKey, ManagementTabCopy>
}

type ManagementModalCopyOverride =
  Partial<Omit<ManagementModalCopy, 'tabs'>> & {
    tabs?: Partial<Record<ManagementKey, Partial<ManagementTabCopy>>>
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

type ActionLinkProps = {
  href: string
  children: ReactNode
  tone?: ButtonTone
}

type ManagementEventRowProps = {
  event: CalendarEvent
  activeKey: ManagementKey
  viewportTimeZone: string
  copy: ManagementModalCopy
  confirmDenyId: string | null
  actionBusyId: string | null
  onSetConfirmDenyId: (id: string | null) => void
  onPickEvent: (event: CalendarEvent) => void
  onApproveBookingId?: (bookingId: string) => void | Promise<void>
  onDenyBookingId?: (bookingId: string) => void | Promise<void>
}

type ModerationActionsProps = {
  eventId: string
  bookingId: string | null
  busy: boolean
  copy: ManagementModalCopy
  confirmDenyId: string | null
  onSetConfirmDenyId: (id: string | null) => void
  onApproveBookingId?: (bookingId: string) => void | Promise<void>
  onDenyBookingId?: (bookingId: string) => void | Promise<void>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MANAGEMENT_KEY_ORDER: readonly ManagementKey[] = [
  'todaysBookings',
  'pendingRequests',
  'waitlistToday',
  'blockedToday',
]

const DEFAULT_COPY: ManagementModalCopy = {
  eyebrow: '◆ Calendar management',
  closeLabel: 'Close',

  blockTimeAction: '+ Block time',
  blockFullDayAction: 'Block full day',

  reviewRescheduleAction: 'Review / Reschedule',
  openAction: 'Open',
  messageAction: 'Message',

  cancelAction: 'Cancel',
  denyAction: 'Deny',
  confirmDenyAction: 'Confirm deny',
  approveAction: 'Approve',
  workingLabel: 'Working…',

  timeUnavailable: 'Time unavailable',
  blockedTimeTitle: 'Blocked time',
  personalTimeFallback: 'Personal time',
  appointmentFallback: 'Appointment',
  clientFallback: 'Client',
  blockedInitials: '⏱',

  pressEscPrefix: 'Press',
  pressEscKeyLabel: 'Esc',
  pressEscSuffix: 'to close.',

  tabs: {
    todaysBookings: {
      title: "Today's bookings",
      shortTitle: 'Today',
      description: 'Accepted and completed appointments happening today.',
      emptyTitle: 'No bookings today.',
      emptyBody: 'Nothing is scheduled for the selected calendar day.',
    },
    pendingRequests: {
      title: 'Pending requests',
      shortTitle: 'Pending',
      description: 'Client requests waiting for approval or denial.',
      emptyTitle: 'No pending requests.',
      emptyBody: 'Freshly calm. Suspicious, but we will take it.',
    },
    waitlistToday: {
      title: 'Waitlist today',
      shortTitle: 'Waitlist',
      description: 'Clients trying to get into an opening today.',
      emptyTitle: 'No waitlist entries.',
      emptyBody:
        'When waitlist data is available, same-day holds will appear here.',
    },
    blockedToday: {
      title: 'Blocked time today',
      shortTitle: 'Blocked',
      description:
        'Time you blocked off for breaks, admin work, or personal time.',
      emptyTitle: 'No blocked time.',
      emptyBody: 'Use block time to protect breaks or close off the full day.',
    },
  },
}

const PENDING_STATUS_PRIORITY = 'PENDING'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function resolveCopy(
  override: ManagementModalCopyOverride | undefined,
): ManagementModalCopy {
  return {
    ...DEFAULT_COPY,
    ...override,
    tabs: {
      todaysBookings: {
        ...DEFAULT_COPY.tabs.todaysBookings,
        ...override?.tabs?.todaysBookings,
      },
      pendingRequests: {
        ...DEFAULT_COPY.tabs.pendingRequests,
        ...override?.tabs?.pendingRequests,
      },
      waitlistToday: {
        ...DEFAULT_COPY.tabs.waitlistToday,
        ...override?.tabs?.waitlistToday,
      },
      blockedToday: {
        ...DEFAULT_COPY.tabs.blockedToday,
        ...override?.tabs?.blockedToday,
      },
    },
  }
}

function managementTabs(copy: ManagementModalCopy): ManagementTab[] {
  return MANAGEMENT_KEY_ORDER.map((key) => ({
    key,
    ...copy.tabs[key],
  }))
}

function tabForKey(
  key: ManagementKey,
  tabs: readonly ManagementTab[],
): ManagementTab {
  return tabs.find((tab) => tab.key === key) ?? tabs[0] ?? {
    key: 'todaysBookings',
    ...DEFAULT_COPY.tabs.todaysBookings,
  }
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

function formatStartsAt(args: {
  startsAt: string
  timeZone: string
  fallback: string
}): string {
  const date = new Date(args.startsAt)

  if (!Number.isFinite(date.getTime())) {
    return args.fallback
  }

  return buildTimeFormatter(args.timeZone).format(date)
}

function startMs(event: CalendarEvent): number {
  const ms = new Date(event.startsAt).getTime()

  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER
}

function normalizeStatus(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function statusPriority(event: CalendarEvent): number {
  return normalizeStatus(event.status) === PENDING_STATUS_PRIORITY ? 0 : 1
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
  copy: ManagementModalCopy
}): EventRowCopy {
  const { event, viewportTimeZone, copy } = args
  const isBlock = isBlockedEvent(event)

  const statusMeta = calendarStatusMeta({
    status: event.status,
    isBlocked: isBlock,
  })

  const timeZone = eventDisplayTimeZone(event, viewportTimeZone)
  const timeLabel = formatStartsAt({
    startsAt: event.startsAt,
    timeZone,
    fallback: copy.timeUnavailable,
  })

  if (event.kind === 'BLOCK') {
    const note = normalizeText(event.note)
    const title = normalizeText(event.title)

    return {
      title: copy.blockedTimeTitle,
      subtitle: `${note || title || copy.personalTimeFallback} · ${timeLabel}`,
      initials: copy.blockedInitials,
      timeLabel,
      statusLabel: statusMeta.label,
    }
  }

  const clientName = normalizeText(event.clientName)
  const title = normalizeText(event.title)

  return {
    title: title || copy.appointmentFallback,
    subtitle: `${clientName || copy.clientFallback} · ${timeLabel}`,
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
      className="brand-pro-calendar-management-button brand-focus"
      data-tone={tone}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </button>
  )
}

function ActionLink(props: ActionLinkProps) {
  const { href, children, tone = 'ghost' } = props

  return (
    <a
      href={href}
      className="brand-pro-calendar-management-button brand-focus"
      data-tone={tone}
    >
      {children}
    </a>
  )
}

function AvatarInitials(props: { initials: string }) {
  const { initials } = props

  return (
    <div
      className="brand-pro-calendar-management-avatar"
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}

function EmptyManagementState(props: { tab: ManagementTab }) {
  const { tab } = props

  return (
    <div className="brand-pro-calendar-management-empty">
      <p className="brand-pro-calendar-management-empty-title">
        {tab.emptyTitle}
      </p>

      <p className="brand-pro-calendar-management-empty-body">
        {tab.emptyBody}
      </p>
    </div>
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
    copy: copyOverride,
  } = props

  const [confirmDenyId, setConfirmDenyId] = useState<string | null>(null)

  const copy = useMemo(() => resolveCopy(copyOverride), [copyOverride])
  const tabs = useMemo(() => managementTabs(copy), [copy])
  const activeTab = tabForKey(activeKey, tabs)

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
      className="brand-pro-calendar-management-overlay"
      onMouseDown={onClose}
    >
      <div
        className="brand-pro-calendar-management-panel"
        onMouseDown={stopDialogMouseDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-management-title"
      >
        <div className="brand-pro-calendar-management-header">
          <div className="brand-pro-calendar-management-heading-row">
            <div className="brand-pro-calendar-management-heading-copy">
              <p className="brand-pro-calendar-management-eyebrow">
                {copy.eyebrow}
              </p>

              <h2
                id="calendar-management-title"
                className="brand-pro-calendar-management-title"
              >
                {activeTab.title}
              </h2>

              <p className="brand-pro-calendar-management-description">
                {activeTab.description}
              </p>

              {actionError ? (
                <div
                  className="brand-pro-calendar-management-error"
                  role="status"
                >
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
              ariaLabel={copy.closeLabel}
            >
              {copy.closeLabel}
            </ActionButton>
          </div>

          <div className="brand-pro-calendar-management-tabs-wrap">
            <div className="brand-pro-calendar-management-tabs looksNoScrollbar">
              {tabs.map((tab) => {
                const active = activeKey === tab.key
                const count = managementListForKey(management, tab.key).length

                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => onSetKey(tab.key)}
                    className="brand-pro-calendar-management-tab brand-focus"
                    data-active={active ? 'true' : 'false'}
                    aria-pressed={active}
                  >
                    {tab.shortTitle}{' '}
                    <span className="brand-pro-calendar-management-tab-count">
                      ({count})
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {activeKey === 'blockedToday' ? (
            <div className="brand-pro-calendar-management-block-actions">
              <ActionButton
                tone="primary"
                onClick={() => {
                  setConfirmDenyId(null)
                  onCreateBlockNow()
                }}
              >
                {copy.blockTimeAction}
              </ActionButton>

              <ActionButton
                onClick={() => {
                  setConfirmDenyId(null)
                  onBlockFullDayToday()
                }}
              >
                {copy.blockFullDayAction}
              </ActionButton>
            </div>
          ) : null}
        </div>

        <div className="brand-pro-calendar-management-body">
          {sortedList.length === 0 ? (
            <EmptyManagementState tab={activeTab} />
          ) : (
            <div className="brand-pro-calendar-management-list">
              {sortedList.map((event) => (
                <ManagementEventRow
                  key={event.id}
                  event={event}
                  activeKey={activeKey}
                  viewportTimeZone={viewportTimeZone}
                  copy={copy}
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

        <div className="brand-pro-calendar-management-footer">
          {copy.pressEscPrefix}{' '}
          <span className="brand-pro-calendar-management-kbd">
            {copy.pressEscKeyLabel}
          </span>{' '}
          {copy.pressEscSuffix}
        </div>
      </div>
    </div>
  )
}

// ─── Row components ───────────────────────────────────────────────────────────

function ManagementEventRow(props: ManagementEventRowProps) {
  const {
    event,
    activeKey,
    viewportTimeZone,
    copy,
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
    copy,
  })

  const statusMeta = calendarStatusMeta({
    status: event.status,
    isBlocked: isBlock,
  })

  const busy = Boolean(actionBusyId && bookingId && actionBusyId === bookingId)

  const messageBookingId =
    canMessageEvent(activeKey, event) && bookingId ? bookingId : null

  const showModeration = canModerateEvent(activeKey, event)

  return (
    <article
      className="brand-pro-calendar-management-row"
      data-calendar-event-kind={event.kind}
      data-calendar-event-status={statusMeta.normalizedStatus || 'SCHEDULED'}
      data-calendar-event-tone={statusMeta.tone}
      data-calendar-event-blocked={isBlock ? 'true' : 'false'}
    >
      <div className="brand-pro-calendar-management-row-main">
        <div className="brand-pro-calendar-management-row-copy">
          <AvatarInitials initials={rowCopy.initials} />

          <div className="brand-pro-calendar-management-row-text">
            <div className="brand-pro-calendar-management-row-titleline">
              <h3 className="brand-pro-calendar-management-row-title">
                {rowCopy.title}
              </h3>

              <span
                className="brand-pro-calendar-management-status-badge"
                data-tone={statusMeta.tone}
              >
                {rowCopy.statusLabel}
              </span>
            </div>

            <p className="brand-pro-calendar-management-row-subtitle">
              {rowCopy.subtitle}
            </p>
          </div>
        </div>

        <p className="brand-pro-calendar-management-row-time">
          {rowCopy.timeLabel}
        </p>
      </div>

      <div className="brand-pro-calendar-management-row-actions">
        <div className="brand-pro-calendar-management-row-primary-actions">
          <ActionButton
            onClick={() => {
              onSetConfirmDenyId(null)
              onPickEvent(event)
            }}
          >
            {activeKey === 'pendingRequests' && !isBlock
              ? copy.reviewRescheduleAction
              : copy.openAction}
          </ActionButton>

          {messageBookingId ? (
            <ActionLink href={messageHrefForBooking(messageBookingId)}>
              {copy.messageAction}
            </ActionLink>
          ) : null}
        </div>

        {showModeration ? (
          <ModerationActions
            eventId={event.id}
            bookingId={bookingId}
            busy={busy}
            copy={copy}
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

function ModerationActions(props: ModerationActionsProps) {
  const {
    eventId,
    bookingId,
    busy,
    copy,
    confirmDenyId,
    onSetConfirmDenyId,
    onApproveBookingId,
    onDenyBookingId,
  } = props

  const confirmingDeny = confirmDenyId === eventId

  return (
    <div className="brand-pro-calendar-management-moderation-actions">
      {confirmingDeny ? (
        <>
          <ActionButton
            tone="ghost"
            disabled={busy}
            onClick={() => onSetConfirmDenyId(null)}
          >
            {copy.cancelAction}
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
            {busy ? copy.workingLabel : copy.confirmDenyAction}
          </ActionButton>
        </>
      ) : (
        <ActionButton
          tone="danger"
          disabled={busy || !onDenyBookingId || !bookingId}
          onClick={() => onSetConfirmDenyId(eventId)}
        >
          {copy.denyAction}
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
        {busy ? copy.workingLabel : copy.approveAction}
      </ActionButton>
    </div>
  )
}