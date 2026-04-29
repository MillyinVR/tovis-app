// app/pro/calendar/_components/_grid/EventCard.tsx
'use client'

import type {
  CSSProperties,
  DragEvent,
  KeyboardEvent,
  MutableRefObject,
} from 'react'

import type { BrandProCalendarCopy } from '@/lib/brand/types'
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

type EventCardProps = {
  copy: BrandProCalendarCopy

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

// ─── Pure helpers ─────────────────────────────────────────────────────────────

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
  copy: BrandProCalendarCopy
}): string | null {
  const { event, copy } = args

  if (event.kind === 'BLOCK') return null

  const serviceCount = event.details.serviceItems.length

  if (serviceCount <= 1) return null

  const label =
    serviceCount === 1 ? copy.labels.service : copy.labels.services

  return `${serviceCount} ${label.toLowerCase()}`
}

function eventStatusLabel(
  event: CalendarEvent,
  copy: BrandProCalendarCopy,
): string {
  if (event.kind === 'BLOCK') return copy.statusLabels.blocked

  if (event.status === 'PENDING') return copy.statusLabels.pending
  if (event.status === 'COMPLETED') return copy.statusLabels.completed
  if (event.status === 'WAITLIST') return copy.statusLabels.waitlist
  if (event.status === 'CANCELLED' || event.status === 'DECLINED') {
    return copy.statusLabels.cancelled
  }

  return copy.statusLabels.accepted
}

function buildEventCardCopy(args: {
  event: CalendarEvent
  copy: BrandProCalendarCopy
}): EventCardDisplayCopy {
  const { event, copy } = args
  const statusLabel = eventStatusLabel(event, copy)

  if (event.kind === 'BLOCK') {
    const note = normalizeText(event.note)

    return {
      primary: note || copy.editBlockModal.title,
      secondary: note ? copy.legend.blocked : '',
      eyebrow: copy.legend.blocked,
      status: statusLabel,
    }
  }

  const clientName = normalizeText(event.clientName)
  const bookingTitle = normalizeText(event.title)
  const serviceCount = serviceItemCountLabel({ event, copy })

  return {
    primary: clientName || copy.bookingModal.clientFallback,
    secondary: bookingTitle || copy.bookingModal.serviceFallback,
    eyebrow: serviceCount ?? copy.labels.appointment,
    status: statusLabel,
  }
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

function resizeControlLabel(args: {
  event: CalendarEvent
  copy: BrandProCalendarCopy
  displayCopy: EventCardDisplayCopy
}): string {
  const { event, copy, displayCopy } = args

  const action =
    event.kind === 'BLOCK' ? copy.editBlockModal.title : copy.actions.reschedule

  return `${action}: ${displayCopy.primary}`
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
    copy,
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
  } = props

  const isBlocked = ev.kind === 'BLOCK'
  const statusMeta = calendarStatusMeta({ status: ev.status, isBlocked })

  const displayCopy = buildEventCardCopy({
    event: ev,
    copy,
  })

  const canDragOrResize = apiId !== null
  const accessibleLabel = cardAriaLabel({ copy: displayCopy, timeLabel })

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
      aria-label={accessibleLabel}
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
      title={accessibleLabel}
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
                <PendingBadge label={copy.statusLabels.pending} />
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
          aria-label={resizeControlLabel({
            event: ev,
            copy,
            displayCopy,
          })}
          disabled={!canDragOrResize}
        />
      </div>
    </div>
  )
}