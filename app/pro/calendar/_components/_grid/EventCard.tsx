// app/pro/calendar/_components/_grid/EventCard.tsx
'use client'

import type {
  CSSProperties,
  DragEvent,
  KeyboardEvent,
  MutableRefObject,
} from 'react'

import type { CalendarEvent, EntityType } from '../../_types'

import { calendarStatusMeta } from '../../_utils/statusStyles'

// ─── Types ────────────────────────────────────────────────────────────────────

type BeginResizeArgs = {
  entityType: EntityType
  eventId: string
  apiId: string
  day: Date
  startMinutes: number
  originalDuration: number
  columnTop: number
}

export type EventCardFallbackCopy = {
  clientFallback: string
  bookingFallback: string
  blockFallback: string
  bookingEyebrow: string
  blockEyebrow: string
  breakLabel: string
  pendingBadge: string
  blockTitle: string
  bookingTitle: string
  resizeLabelPrefix: string
  serviceCountSingular: string
  serviceCountPlural: string
}

type EventCardProps = {
  ev: CalendarEvent
  entityType: EntityType
  apiId: string | null

  topPx: number
  heightPx: number
  timeLabel: string
  compact: boolean
  micro: boolean

  day: Date
  startMinutes: number
  originalDuration: number
  getColumnTop: () => number

  suppressClickRef: MutableRefObject<boolean>
  onClickEvent: (id: string) => void
  onDragStart: (event: CalendarEvent, dragEvent: DragEvent<HTMLDivElement>) => void
  onDropOnDayColumn: (day: Date, clientY: number, columnTop: number) => void
  onBeginResize: (args: BeginResizeArgs) => void

  /**
   * Bridge until event-card microcopy is moved into BrandProCalendarCopy.
   */
  copy?: Partial<EventCardFallbackCopy>
}

type EventCardDisplayCopy = {
  primary: string
  secondary: string
  eyebrow: string
  status: string
}

type TextClampOptions = {
  lines: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_COPY: EventCardFallbackCopy = {
  clientFallback: 'Client',
  bookingFallback: 'Appointment',
  blockFallback: 'Personal time',
  bookingEyebrow: 'Booking',
  blockEyebrow: 'Break',
  breakLabel: 'Break',
  pendingBadge: 'Request',
  blockTitle: 'Drag to move, drag bottom to resize. Click to edit block.',
  bookingTitle: 'Drag to move, drag bottom to resize. Click to view booking.',
  resizeLabelPrefix: 'Resize',
  serviceCountSingular: 'service',
  serviceCountPlural: 'services',
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function resolveCopy(
  copy: Partial<EventCardFallbackCopy> | undefined,
): EventCardFallbackCopy {
  return {
    ...DEFAULT_COPY,
    ...copy,
  }
}

function textClampStyle(options: TextClampOptions): CSSProperties {
  return {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: options.lines,
    overflow: 'hidden',
  }
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function serviceItemCountLabel(args: {
  event: CalendarEvent
  copy: EventCardFallbackCopy
}): string | null {
  const { event, copy } = args

  if (event.kind === 'BLOCK') return null

  const serviceCount = event.details.serviceItems.length

  if (serviceCount <= 1) return null

  const label =
    serviceCount === 1 ? copy.serviceCountSingular : copy.serviceCountPlural

  return `${serviceCount} ${label}`
}

function buildEventCardCopy(args: {
  event: CalendarEvent
  statusLabel: string
  copy: EventCardFallbackCopy
}): EventCardDisplayCopy {
  const { event, statusLabel, copy } = args

  if (event.kind === 'BLOCK') {
    const note = normalizeText(event.note)

    return {
      primary: note || copy.blockFallback,
      secondary: note ? copy.breakLabel : '',
      eyebrow: copy.blockEyebrow,
      status: statusLabel,
    }
  }

  const clientName = normalizeText(event.clientName)
  const bookingTitle = normalizeText(event.title)
  const serviceCount = serviceItemCountLabel({ event, copy })

  return {
    primary: clientName || copy.clientFallback,
    secondary: bookingTitle || copy.bookingFallback,
    eyebrow: serviceCount ?? copy.bookingEyebrow,
    status: statusLabel,
  }
}

function cardTitle(args: {
  event: CalendarEvent
  copy: EventCardFallbackCopy
}): string {
  const { event, copy } = args

  return event.kind === 'BLOCK' ? copy.blockTitle : copy.bookingTitle
}

function cardAriaLabel(args: {
  copy: EventCardDisplayCopy
  timeLabel: string
}): string {
  const { copy, timeLabel } = args

  return [copy.primary, copy.secondary, copy.status, timeLabel]
    .filter((part) => part.trim().length > 0)
    .join(', ')
}

function eventCardPositionStyle(args: {
  topPx: number
  heightPx: number
}): CSSProperties {
  return {
    top: args.topPx,
    height: args.heightPx,
  }
}

function openOnKeyboard(args: {
  event: KeyboardEvent<HTMLDivElement>
  eventId: string
  suppressClickRef: MutableRefObject<boolean>
  onClickEvent: (id: string) => void
}): void {
  const { event, eventId, suppressClickRef, onClickEvent } = args

  if (event.key !== 'Enter' && event.key !== ' ') return

  event.preventDefault()

  if (suppressClickRef.current) return

  onClickEvent(eventId)
}

function displayPrimaryText(args: {
  value: string
  isBlocked: boolean
}): string {
  const { value, isBlocked } = args

  return isBlocked ? value.toUpperCase() : value
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PendingBadge(props: { label: string }) {
  return (
    <span className="brand-pro-calendar-event-badge" data-tone="pending">
      {props.label}
    </span>
  )
}

function CompletedCheck() {
  return (
    <span
      className="brand-pro-calendar-event-completed-check"
      aria-hidden="true"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────

export function EventCard(props: EventCardProps) {
  const {
    ev,
    entityType,
    apiId,
    topPx,
    heightPx,
    timeLabel,
    compact,
    micro,
    day,
    startMinutes,
    originalDuration,
    getColumnTop,
    suppressClickRef,
    onClickEvent,
    onDragStart,
    onDropOnDayColumn,
    onBeginResize,
    copy: copyOverride,
  } = props

  const eventCardCopy = resolveCopy(copyOverride)
  const isBlocked = ev.kind === 'BLOCK'
  const statusMeta = calendarStatusMeta({ status: ev.status, isBlocked })

  const displayCopy = buildEventCardCopy({
    event: ev,
    statusLabel: statusMeta.label,
    copy: eventCardCopy,
  })

  const canDragOrResize = apiId !== null

  return (
    <div
      data-cal-event="1"
      data-calendar-event-kind={ev.kind}
      data-calendar-event-status={statusMeta.normalizedStatus || 'SCHEDULED'}
      data-calendar-event-tone={statusMeta.tone}
      data-calendar-event-compact={compact ? 'true' : 'false'}
      data-calendar-event-micro={micro ? 'true' : 'false'}
      data-calendar-event-blocked={isBlocked ? 'true' : 'false'}
      role="button"
      tabIndex={0}
      aria-label={cardAriaLabel({ copy: displayCopy, timeLabel })}
      draggable={canDragOrResize}
      onDragStart={(dragEvent) => {
        if (!apiId) {
          dragEvent.preventDefault()
          return
        }

        onDragStart(ev, dragEvent)
      }}
      onDragOver={(dragEvent) => {
        dragEvent.preventDefault()
      }}
      onDrop={(dropEvent) => {
        dropEvent.preventDefault()
        dropEvent.stopPropagation()

        onDropOnDayColumn(day, dropEvent.clientY, getColumnTop())
      }}
      onMouseDown={(mouseEvent) => {
        mouseEvent.stopPropagation()
      }}
      onClick={() => {
        if (suppressClickRef.current) return

        onClickEvent(ev.id)
      }}
      onKeyDown={(keyboardEvent) => {
        openOnKeyboard({
          event: keyboardEvent,
          eventId: ev.id,
          suppressClickRef,
          onClickEvent,
        })
      }}
      className="brand-pro-calendar-event-card brand-focus"
      style={eventCardPositionStyle({
        topPx,
        heightPx,
      })}
      title={cardTitle({ event: ev, copy: eventCardCopy })}
    >
      <div
        className="brand-pro-calendar-event-accent"
        data-tone={statusMeta.tone}
        aria-hidden="true"
      />

      {isBlocked ? (
        <div
          className="brand-pro-calendar-event-block-outline"
          aria-hidden="true"
        />
      ) : null}

      <div className="brand-pro-calendar-event-inner">
        {micro ? (
          <div className="brand-pro-calendar-event-row">
            <span className="brand-pro-calendar-event-primary">
              {displayPrimaryText({
                value: displayCopy.primary,
                isBlocked,
              })}
            </span>
          </div>
        ) : (
          <>
            <div className="brand-pro-calendar-event-row">
              <span
                className="brand-pro-calendar-event-primary"
                style={textClampStyle({ lines: 1 })}
              >
                {displayPrimaryText({
                  value: displayCopy.primary,
                  isBlocked,
                })}
              </span>

              {statusMeta.isPending ? (
                <PendingBadge label={eventCardCopy.pendingBadge} />
              ) : null}

              {statusMeta.isCompleted ? <CompletedCheck /> : null}
            </div>

            {!isBlocked ? (
              <p
                className="brand-pro-calendar-event-secondary"
                style={textClampStyle({ lines: compact ? 1 : 2 })}
              >
                {displayCopy.secondary}
              </p>
            ) : displayCopy.secondary ? (
              <p className="brand-pro-calendar-event-block-secondary">
                {displayCopy.secondary}
              </p>
            ) : null}

            <p className="brand-pro-calendar-event-time">{timeLabel}</p>
          </>
        )}

        <button
          type="button"
          onMouseDown={(mouseEvent) => {
            mouseEvent.stopPropagation()
            mouseEvent.preventDefault()

            if (!apiId) return

            onBeginResize({
              entityType,
              eventId: ev.id,
              apiId,
              day,
              startMinutes,
              originalDuration,
              columnTop: getColumnTop(),
            })
          }}
          className="brand-pro-calendar-event-resize brand-focus"
          data-enabled={canDragOrResize ? 'true' : 'false'}
          aria-label={`${eventCardCopy.resizeLabelPrefix} ${displayCopy.primary}`}
          disabled={!canDragOrResize}
        />
      </div>
    </div>
  )
}