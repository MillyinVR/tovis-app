// app/pro/calendar/_components/_grid/EventCard.tsx
'use client'

import { useId } from 'react'
import type {
  CSSProperties,
  DragEvent,
  KeyboardEvent,
  MutableRefObject,
} from 'react'

import type { ClientConfirmationBadge } from '@/lib/booking/clientConfirmation'

import type { BrandProCalendarCopy } from '@/lib/brand/types'
import type { CalendarEvent, EntityType } from '../../_types'

import { calendarStatusMeta } from '../../_utils/statusStyles'
import { eventStatusLabel } from '../../_viewModel/proCalendarDisplay'

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
  /** Passive double-book signal: this booking overlaps another (amber ring + glyph). */
  conflict: boolean

  topPx: number
  heightPx: number
  timeLabel: string
  compact: boolean
  micro: boolean

  /**
   * Short label for the event's own location, when the grid is showing more
   * than one (K3). Undefined = don't mark the card at all, which is the case
   * for a single-location pro and for a calendar filtered to one location —
   * there, naming it on every card is noise, not information.
   */
  locationLabel?: string

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

  // Neither a block nor a hold carries services — a hold is deliberately
  // anonymous, so it has no service to count (B5).
  if (event.kind === 'BLOCK' || event.kind === 'HOLD') return null

  const serviceCount = event.details.serviceItems.length

  if (serviceCount <= 1) return null

  const label =
    serviceCount === 1 ? copy.labels.service : copy.labels.services

  return `${serviceCount} ${label.toLowerCase()}`
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

  // A hold names nobody and nothing — it says only "this time is spoken for".
  // Reading `event.clientName` here would still be safe (it holds the fixed
  // 'Held' label), but going through brand copy keeps the surface white-label
  // and keeps the anonymity a property of the CARD, not of the payload.
  if (event.kind === 'HOLD') {
    return {
      primary: copy.legend.held,
      secondary: '',
      eyebrow: copy.statusLabels.held,
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

function PaymentBadgeChip(props: { label: string; tone: string }) {
  return (
    <span className="brand-pro-calendar-event-payment" data-tone={props.tone}>
      {props.label}
    </span>
  )
}

/**
 * NR/NNR/RR/RNR client-relationship mark (K5) — the salon-book shorthand,
 * mapped server-side from the per-booking snapshot. Same visual system as the
 * payment chip (shared CSS declarations), its own class so the two stay
 * distinguishable in the DOM. The chip prints the mark; the plain-words
 * expansion rides `title` and the card's accessible name.
 */
function RelationshipBadgeChip(props: {
  label: string
  description: string
  tone: string
}) {
  return (
    <span
      className="brand-pro-calendar-event-relationship"
      data-tone={props.tone}
      title={props.description}
    >
      {props.label}
    </span>
  )
}

/**
 * Which location this job is at, on a grid that mixes them.
 *
 * Deliberately TEXT, not a colour: status already owns the card's fill and the
 * accent stripe is spoken for (the colour system is K7's step, and its channel
 * allocation gives the stripe to service). A word also survives being read by
 * a colour-blind pro, and needs no legend entry to decode.
 */
function LocationChip(props: { label: string }) {
  return (
    <span className="brand-pro-calendar-event-location">{props.label}</span>
  )
}

/**
 * Unsigned consent form (K15) — the FIFTH text chip a card can carry.
 *
 * A word, not a colour and not a second warning glyph: the glyph channel is
 * K11's and the conflict triangle already owns the "something is wrong" shape,
 * so a second triangle would make both mean "one of two things". `title` and
 * the card's accessible name carry which form it is — the chip has room for a
 * flag, not a document name.
 */
function ConsentRequirementChip(props: { label: string; description: string }) {
  return (
    <span
      className="brand-pro-calendar-event-consent"
      data-tone="warn"
      title={props.description}
    >
      {props.label}
    </span>
  )
}

function ConflictBadge(props: { label: string }) {
  return (
    <span
      className="brand-pro-calendar-event-conflict"
      title={props.label}
      aria-hidden="true"
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10.29 3.86 1.82 18a1 1 0 0 0 .86 1.5h16.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </span>
  )
}

/**
 * Client-confirmation corner glyph (K11, decision D3) — the one channel K7's
 * budget reserved for it. 🔴 Deliberately a CIRCLED glyph family, distinct
 * from CompletedCheck's bare ✓ (K7-A): the two can share a row on a completed
 * booking, and two same-shape checks with different meanings is the
 * glyph-shaped version of the disease B10 cured.
 *
 * The family reads: SOLID disc = the client answered (knocked-out ✓ =
 * confirmed, knocked-out ✕ = declined — D3's "filled"), HOLLOW ring = still
 * waiting (stroked ?). The knockout is an SVG mask, not a painted colour, so
 * the mark shows the card's own fill through it and needs no per-status
 * colour token. Words never render here — `description` rides the card's
 * accessible name and `title` (K5's rule: screen readers don't get shapes).
 */
function ConfirmationGlyph(props: { badge: ClientConfirmationBadge }) {
  const { badge } = props
  const maskId = useId()

  return (
    <span
      className="brand-pro-calendar-event-confirmation"
      data-kind={badge.kind}
      data-tone={badge.tone}
      title={badge.description}
      aria-hidden="true"
    >
      {badge.kind === 'AWAITING_CLIENT' ? (
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9.5" />
          <path d="M9.3 9.2a2.8 2.8 0 0 1 5.44.93c0 1.87-2.8 2.8-2.8 2.8" />
          <line x1="12" y1="16.8" x2="12.01" y2="16.8" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24">
          <mask id={maskId}>
            <rect width="24" height="24" fill="white" />
            {badge.kind === 'DECLINED' ? (
              <g
                stroke="black"
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
              >
                <line x1="8.2" y1="8.2" x2="15.8" y2="15.8" />
                <line x1="15.8" y1="8.2" x2="8.2" y2="15.8" />
              </g>
            ) : (
              <polyline
                points="17 8.6 10.6 15.4 7 11.9"
                stroke="black"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            )}
          </mask>
          <circle cx="12" cy="12" r="10.5" fill="currentColor" mask={`url(#${maskId})`} />
        </svg>
      )}
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
    conflict,
    locationLabel,
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
  const isHold = ev.kind === 'HOLD'
  const statusMeta = calendarStatusMeta({ status: ev.status, isBlocked })

  const displayCopy = buildEventCardCopy({
    event: ev,
    copy,
  })

  // Payment state chip — derived server-side by THE one helper
  // (lib/booking/paymentBadge.ts). `significant` gates it here so a wall of
  // "Unpaid" upcoming cards stays quiet; the helper owns that call, not the card.
  const paymentBadge =
    ev.kind === 'BOOKING' && ev.paymentBadge?.significant
      ? ev.paymentBadge
      : null

  // Client-relationship mark (K5) — same significance gate: UNKNOWN (imported /
  // pro-created / legacy rows) renders nothing, per the helper's call.
  const relationshipBadge =
    ev.kind === 'BOOKING' && ev.relationshipBadge?.significant
      ? ev.relationshipBadge
      : null

  // The SERVICE channel (K7): the pro's colour for this booking's service,
  // painted on the accent stripe. Blocks and holds are not a service, so they
  // never claim it. Absent → the stripe keeps its status tone, unchanged.
  const serviceSwatch = ev.kind === 'BOOKING' ? ev.serviceSwatch : undefined

  // The CONFIRMATION channel (K11): whether the client said they're coming.
  // Same significance gate as the other badges — NOT_REQUESTED (every booking
  // until K12 ships the writers) renders nothing, so the card is unchanged.
  const clientConfirmation =
    ev.kind === 'BOOKING' && ev.clientConfirmation?.significant
      ? ev.clientConfirmation
      : null

  // The CONSENT mark (K15): a form this service requires that the client has
  // not signed. Same significance gate as the others — the helper decides, and
  // it says nothing about an appointment that already happened.
  const consentRequirement =
    ev.kind === 'BOOKING' && ev.consentRequirement?.significant
      ? ev.consentRequirement
      : null

  const canDragOrResize = apiId !== null
  const baseLabel = cardAriaLabel({ copy: displayCopy, timeLabel })
  // The accessible name spells the mark out ("Returning client · requested
  // you") — screen readers shouldn't be handed bare letters.
  const withRelationship = relationshipBadge
    ? `${baseLabel}, ${relationshipBadge.description}`
    : baseLabel
  const withPayment = paymentBadge
    ? `${withRelationship}, ${paymentBadge.label}`
    : withRelationship
  // The glyph is aria-hidden; the WORDS live here (K5's rule). "Awaiting
  // client confirmation", never a bare shape — and never the bare word
  // "Confirmed", which B10 gave to the ACCEPTED status.
  const withConfirmation = clientConfirmation
    ? `${withPayment}, ${clientConfirmation.description}`
    : withPayment
  // Always in the accessible name, even where the chip is too small to render —
  // on a mixed-location grid, which location a job is at is not decoration.
  // The chip prints "Form due"; the accessible name says WHICH form, because
  // "which waiver?" is the pro's very next question (K5's words-not-shapes rule
  // applied to an abbreviation).
  const withConsent = consentRequirement
    ? `${withConfirmation}, ${consentRequirement.description}`
    : withConfirmation
  const withLocation = locationLabel
    ? `${withConsent}, ${locationLabel}`
    : withConsent
  const accessibleLabel = conflict
    ? `${withLocation}, ${copy.labels.overlapWarning}`
    : withLocation

  return (
    <div
      data-cal-event="1"
      data-calendar-event-kind={ev.kind}
      data-calendar-event-status={statusMeta.normalizedStatus || 'SCHEDULED'}
      data-calendar-event-tone={statusMeta.tone}
      data-calendar-event-compact={compact ? 'true' : 'false'}
      data-calendar-event-micro={micro ? 'true' : 'false'}
      data-calendar-event-blocked={isBlocked ? 'true' : 'false'}
      data-calendar-event-conflict={conflict ? 'true' : 'false'}
      data-calendar-event-location={locationLabel}
      // A hold does nothing when activated, so it must not advertise itself as
      // a button or take focus — that would be an accessibility lie (B5).
      role={isHold ? undefined : 'button'}
      tabIndex={isHold ? -1 : 0}
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
        // A hold is read-only occupancy: there is nothing to open, and every
        // downstream detail surface assumes a booking or a block (B5).
        if (isHold) return

        onClickEvent(ev.id)
      }}
      onKeyDown={(keyboardEvent) => {
        if (isHold) return

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
        // Brand CSS paints data-swatch over data-tone when both are present —
        // the stripe is the service channel, and falls back to the status tone
        // only while a booking has no colour of its own.
        data-swatch={serviceSwatch}
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

              {relationshipBadge ? (
                <RelationshipBadgeChip
                  label={relationshipBadge.label}
                  description={relationshipBadge.description}
                  tone={relationshipBadge.tone}
                />
              ) : null}

              {paymentBadge ? (
                <PaymentBadgeChip
                  label={paymentBadge.label}
                  tone={paymentBadge.tone}
                />
              ) : null}

              {consentRequirement ? (
                <ConsentRequirementChip
                  label={consentRequirement.label}
                  description={consentRequirement.description}
                />
              ) : null}

              {clientConfirmation ? (
                <ConfirmationGlyph badge={clientConfirmation} />
              ) : null}

              {statusMeta.isCompleted ? <CompletedCheck /> : null}

              {conflict ? (
                <ConflictBadge label={copy.labels.overlapWarning} />
              ) : null}
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

            <p className="brand-pro-calendar-event-time">
              {timeLabel}
              {locationLabel ? <LocationChip label={locationLabel} /> : null}
            </p>
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