// app/pro/calendar/_components/CalendarDesktopShell.tsx
'use client'

import { useMemo, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'

import WorkingHoursTabs from './WorkingHoursTabs'

import { CalendarHeaderControls } from './CalendarHeader'
import { CalendarLocationPanel } from './CalendarLocationPanel'
import { CalendarStatsPanel } from './CalendarStatsPanel'
import { DayWeekGrid } from './DayWeekGrid'
import { MonthGrid } from './MonthGrid'
import { PendingRequestSurface } from './PendingRequestSurface'

import type {
  BookingCalendarEvent,
  CalendarEvent,
  ViewMode,
} from '../_types'
import type { CalendarData } from '../_hooks/useCalendarData'
import type { BrandProCalendarCopy } from '@/lib/brand/types'

import { anchorNoonInTimeZone } from '../_utils/date'

import {
  bookingActionId,
  firstPendingBooking,
  isBookingCalendarEvent,
} from '../_viewModel/proCalendarDisplay'

// ─── Types ────────────────────────────────────────────────────────────────────

type CalendarDesktopShellProps = {
  copy: BrandProCalendarCopy

  view: ViewMode
  setView: Dispatch<SetStateAction<ViewMode>>

  currentDate: Date
  setCurrentDate: Dispatch<SetStateAction<Date>>

  calendarTimeZone: string
  headerLabel: string
  title: string
  sidebarTodayLabel: string
  visibleDays: Date[]

  showInitialLoading: boolean
  showReloadLoading: boolean

  onToday: () => void
  onBack: () => void
  onNext: () => void

  cal: CalendarData
}

type CalendarLegendTone =
  | 'accepted'
  | 'pending'
  | 'completed'
  | 'waitlist'
  | 'blocked'

type PageHeroProps = {
  modeLabel: string
  pageHero: BrandProCalendarCopy['pageHero']
  desktop: BrandProCalendarCopy['desktop']
}

type WideCalendarHeaderProps = {
  eyebrow: string
  title: string
  children: ReactNode
}

type CalendarDesktopBodyProps = {
  copy: BrandProCalendarCopy

  view: ViewMode
  currentDate: Date
  setCurrentDate: Dispatch<SetStateAction<Date>>
  setView: Dispatch<SetStateAction<ViewMode>>
  calendarTimeZone: string
  visibleDays: Date[]
  showInitialLoading: boolean
  showReloadLoading: boolean
  loadingCalendarLabel: string
  loadingRefreshLabel: string
  onPickEventId: (eventId: string) => void
  cal: CalendarData
}

type CalendarDesktopDetailPanelProps = {
  copy: BrandProCalendarCopy
  event: CalendarEvent | null
  calendarTimeZone: string
  onClose: () => void
  onOpenFullDetails: (eventId: string) => void
}

type DesktopEditScheduleOverlayProps = {
  open: boolean
  copy: BrandProCalendarCopy
  canSalon: boolean
  canMobile: boolean
  activeEditorType: CalendarData['hoursEditorLocationType']
  onChangeEditorType: CalendarData['setHoursEditorLocationType']
  onSavedAny: () => void
  onClose: () => void
}

type StatusLegendProps = {
  title: string
  copy: BrandProCalendarCopy['legend']
}

type AutoAcceptCardProps = {
  label: string
  copy: BrandProCalendarCopy['mobileAutoAccept']
  enabled: boolean
  saving: boolean
  onToggle: () => void
}

type ActionButtonProps = {
  children: ReactNode
  onClick: () => void
  active?: boolean
}

type StateBannerProps = {
  children: ReactNode
  danger?: boolean
}

// ─── Exported component ───────────────────────────────────────────────────────

export function CalendarDesktopShell(props: CalendarDesktopShellProps) {
  const {
    copy,
    view,
    setView,
    currentDate,
    setCurrentDate,
    calendarTimeZone,
    headerLabel,
    title,
    sidebarTodayLabel,
    visibleDays,
    showInitialLoading,
    showReloadLoading,
    onToday,
    onBack,
    onNext,
    cal,
  } = props

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

  const selectedEvent = useMemo(
    () =>
      selectedEventId
        ? cal.events.find((event) => event.id === selectedEventId) ?? null
        : null,
    [cal.events, selectedEventId],
  )

  const topPendingRequest = firstPendingBooking(cal.management.pendingRequests)
  const topPendingBookingId = bookingActionId(topPendingRequest)

  const desktopPendingRequestCopy = useMemo(
    () => ({
      ...copy.mobilePendingRequest,
      label: copy.desktop.pendingFooterLabel,
      openAllLabel: copy.desktop.pendingFooterViewAllLabel,
    }),
    [
      copy.desktop.pendingFooterLabel,
      copy.desktop.pendingFooterViewAllLabel,
      copy.mobilePendingRequest,
    ],
  )

  const panelEyebrow = [
    headerLabel,
    cal.activeLocationLabel ?? copy.locationPanel.titleFallback,
  ]
    .filter((part) => part.trim().length > 0)
    .join(' · ')

  return (
    <section className="brand-pro-calendar-shell" data-device="desktop">
      <PageHero
        modeLabel={copy.labels.mode}
        pageHero={copy.pageHero}
        desktop={copy.desktop}
      />

      <section className="brand-pro-calendar-panel">
        <WideCalendarHeader eyebrow={`◆ ${panelEyebrow}`} title={title}>
          <div className="brand-pro-calendar-desktop-header-actions">
            <CalendarHeaderControls
              view={view}
              setView={setView}
              headerLabel={headerLabel}
              todayLabel={copy.actions.today}
              previousLabel={copy.header.previousRangeLabel}
              nextLabel={copy.header.nextRangeLabel}
              viewTabsLabel={copy.header.viewTabsLabel}
              ariaLabel={copy.header.controlsAriaLabel}
              viewLabels={copy.header.viewLabels}
              viewAriaLabels={copy.header.viewAriaLabels}
              onToday={onToday}
              onBack={onBack}
              onNext={onNext}
              onBlockTime={cal.openCreateBlockNow}
              blockTimeLabel={copy.actions.blockTime}
            />

            <button
              type="button"
              onClick={() => {
                cal.setShowHoursForm((current) => !current)
              }}
              className="brand-pro-calendar-desktop-edit-button brand-focus"
              data-active={cal.showHoursForm ? 'true' : 'false'}
              aria-pressed={cal.showHoursForm}
            >
              {cal.showHoursForm
                ? copy.actions.hideHours
                : copy.actions.editSchedule}
            </button>
          </div>
        </WideCalendarHeader>

        <div
          className="brand-pro-calendar-desktop-frame"
          data-detail-open={selectedEvent ? 'true' : 'false'}
        >
          <div className="brand-pro-calendar-desktop-main">
            <aside className="brand-pro-calendar-sidebar">
              <p className="brand-cap mb-4">
                {sidebarTodayLabel} · {copy.desktop.sidebarTodayPrefix}
              </p>

              <CalendarStatsPanel
                copy={copy.stats}
                stats={cal.stats}
                management={cal.management}
                blockedMinutesToday={cal.blockedMinutesToday}
                onOpenManagement={cal.openManagement}
                variant="rail"
              />

              <StatusLegend
                title={copy.desktop.sidebarStatusKeyTitle}
                copy={copy.legend}
              />

              <AutoAcceptCard
                label={copy.actions.autoAccept}
                copy={copy.mobileAutoAccept}
                enabled={cal.autoAccept}
                saving={cal.savingAutoAccept}
                onToggle={() => {
                  void cal.toggleAutoAccept(!cal.autoAccept)
                }}
              />

              <div className="mt-5">
                <p className="brand-cap mb-3">
                  {copy.desktop.sidebarLocationTitle}
                </p>

                <CalendarLocationPanel
                  copy={copy.locationPanel}
                  locationsLoaded={cal.locationsLoaded}
                  scopedLocations={cal.scopedLocations}
                  activeLocationId={cal.activeLocationId}
                  activeLocationLabel={cal.activeLocationLabel}
                  calendarTimeZone={calendarTimeZone}
                  onChangeLocation={cal.setActiveLocationId}
                />
              </div>

              <div className="mt-4">
                <ActionButton
                  onClick={() => {
                    cal.setShowHoursForm((current) => !current)
                  }}
                  active={cal.showHoursForm}
                >
                  {cal.showHoursForm
                    ? copy.actions.hideHours
                    : copy.desktop.sidebarEditScheduleLabel}
                </ActionButton>
              </div>
            </aside>

            <section className="brand-pro-calendar-content">
              <CalendarDesktopBody
                copy={copy}
                view={view}
                currentDate={currentDate}
                setCurrentDate={setCurrentDate}
                setView={setView}
                calendarTimeZone={calendarTimeZone}
                visibleDays={visibleDays}
                showInitialLoading={showInitialLoading}
                showReloadLoading={showReloadLoading}
                loadingCalendarLabel={copy.labels.loadingCalendar}
                loadingRefreshLabel={copy.labels.loadingRefresh}
                onPickEventId={setSelectedEventId}
                cal={cal}
              />
            </section>

            <CalendarDesktopDetailPanel
              copy={copy}
              event={selectedEvent}
              calendarTimeZone={calendarTimeZone}
              onClose={() => setSelectedEventId(null)}
              onOpenFullDetails={cal.openBookingOrBlock}
            />
          </div>

          <footer className="brand-pro-calendar-desktop-pending-banner">
            <PendingRequestSurface
              copy={desktopPendingRequestCopy}
              event={topPendingRequest}
              pendingCount={cal.management.pendingRequests.length}
              busy={Boolean(
                topPendingBookingId &&
                  cal.managementActionBusyId === topPendingBookingId,
              )}
              error={cal.managementActionError}
              variant="desktop"
              actionMode="label"
              showOpenAllAction
              onOpenAll={() => cal.openManagement('pendingRequests')}
              onApprove={() => {
                if (topPendingBookingId) {
                  void cal.approveBookingById(topPendingBookingId)
                }
              }}
              onDeny={() => {
                if (topPendingBookingId) {
                  void cal.denyBookingById(topPendingBookingId)
                }
              }}
            />
          </footer>
        </div>

        <DesktopEditScheduleOverlay
          open={cal.showHoursForm}
          copy={copy}
          canSalon={cal.canSalon}
          canMobile={cal.canMobile}
          activeEditorType={cal.hoursEditorLocationType}
          onChangeEditorType={cal.setHoursEditorLocationType}
          onSavedAny={cal.reload}
          onClose={() => {
            cal.setShowHoursForm(false)
          }}
        />
      </section>
    </section>
  )
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function PageHero(props: PageHeroProps) {
  const { modeLabel, pageHero, desktop } = props

  return (
    <header className="brand-pro-calendar-page-hero">
      <div>
        <p className="brand-pro-calendar-wide-eyebrow">{modeLabel}</p>

        <h1 className="brand-pro-calendar-page-hero-title">
          {pageHero.title}
          <span className="brand-pro-calendar-page-hero-accent">
            {pageHero.accentMark}
          </span>
          {pageHero.suffix}
        </h1>
      </div>

      <nav className="brand-pro-calendar-page-hero-links">
        <a
          href={desktop.mobileHref}
          className="brand-pro-calendar-page-hero-link"
        >
          {desktop.mobileLabel}
        </a>

        <a
          href={desktop.dashboardHref}
          className="brand-pro-calendar-page-hero-link"
        >
          {desktop.dashboardLabel}
        </a>
      </nav>
    </header>
  )
}

function WideCalendarHeader(props: WideCalendarHeaderProps) {
  const { eyebrow, title, children } = props

  return (
    <div className="brand-pro-calendar-wide-header">
      <div>
        <p className="brand-pro-calendar-wide-eyebrow">{eyebrow}</p>

        <h2 className="brand-pro-calendar-wide-title">{title}</h2>
      </div>

      {children}
    </div>
  )
}

function CalendarDesktopBody(props: CalendarDesktopBodyProps) {
  const {
    copy,
    view,
    currentDate,
    setCurrentDate,
    setView,
    calendarTimeZone,
    visibleDays,
    showInitialLoading,
    showReloadLoading,
    loadingCalendarLabel,
    loadingRefreshLabel,
    onPickEventId,
    cal,
  } = props

  return (
    <div className="brand-pro-calendar-desktop-content-inner">
      <div className="brand-pro-calendar-desktop-state-list">
        {showInitialLoading ? (
          <StateBanner>{loadingCalendarLabel}</StateBanner>
        ) : null}

        {showReloadLoading ? (
          <StateBanner>{loadingRefreshLabel}</StateBanner>
        ) : null}

        {cal.error ? <StateBanner danger>{cal.error}</StateBanner> : null}
      </div>

      {(view === 'day' || view === 'week') && !showInitialLoading ? (
        <DayWeekGrid
          copy={copy}
          view={view}
          visibleDays={visibleDays}
          events={cal.events}
          workingHoursSalon={cal.workingHoursSalon}
          workingHoursMobile={cal.workingHoursMobile}
          activeLocationType={cal.activeLocationType}
          stepMinutes={cal.activeStepMinutes}
          timeZone={calendarTimeZone}
          onClickEvent={onPickEventId}
          onCreateForClick={cal.openCreateForClick}
          onDragStart={cal.drag.onDragStart}
          onDropOnDayColumn={cal.drag.onDropOnDayColumn}
          onBeginResize={cal.resize.beginResize}
          suppressClickRef={cal.ui.suppressClickRef}
          isBusy={cal.ui.isOverlayOpen}
        />
      ) : null}

      {view === 'month' && !showInitialLoading ? (
        <div className="brand-pro-calendar-month-desktop">
          <MonthGrid
            visibleDays={visibleDays}
            currentDate={currentDate}
            events={cal.events}
            timeZone={calendarTimeZone}
            onPickDay={(date) => {
              setCurrentDate(anchorNoonInTimeZone(date, calendarTimeZone))
              setView('day')
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

function CalendarDesktopDetailPanel(props: CalendarDesktopDetailPanelProps) {
  const { copy, event, calendarTimeZone, onClose, onOpenFullDetails } = props

  if (!event) return null

  const isBooking = isBookingCalendarEvent(event)
  const eventTimeZone = isBooking ? event.timeZone : calendarTimeZone
  const timeRange = eventTimeRangeLabel(event, eventTimeZone)
  const serviceLabel = eventServiceLabel(event, copy)
  const totalLabel = isBooking ? bookingTotalLabel(event) : null
  const statusLabel = eventStatusLabel(event, copy)

  return (
    <aside
      className="brand-pro-calendar-desktop-detail-panel"
      data-event-kind={event.kind}
      data-event-status={isBooking ? event.status : 'BLOCKED'}
    >
      <div className="brand-pro-calendar-desktop-detail-header">
        <p className="brand-pro-calendar-wide-eyebrow">
          ◆ {isBooking ? copy.labels.appointment : copy.legend.blocked}
        </p>

        <button
          type="button"
          onClick={onClose}
          className="brand-pro-calendar-desktop-detail-close brand-focus"
          aria-label={copy.actions.close}
          title={copy.actions.close}
        >
          ×
        </button>
      </div>

      <div className="brand-pro-calendar-desktop-detail-client-row">
        <div className="brand-pro-calendar-desktop-detail-avatar">
          {eventInitials(event)}
        </div>

        <div>
          <h3 className="brand-pro-calendar-desktop-detail-title">
            {eventDisplayTitle(event, copy)}
          </h3>

          <p className="brand-pro-calendar-desktop-detail-subtitle">
            {isBooking ? copy.labels.client : copy.legend.blocked}
          </p>
        </div>
      </div>

      <div className="brand-pro-calendar-desktop-detail-card">
        <DetailRow label={copy.labels.service} value={serviceLabel} />
        <DetailRow label={copy.labels.time} value={timeRange} />
        <DetailRow label={copy.labels.status} value={statusLabel} />

        {totalLabel ? (
          <div className="brand-pro-calendar-desktop-detail-total">
            <span className="brand-cap">{copy.labels.total}</span>
            <span>{totalLabel}</span>
          </div>
        ) : null}
      </div>

      {event.kind === 'BLOCK' && event.note ? (
        <div className="brand-pro-calendar-desktop-detail-note">
          <p className="brand-cap">{copy.editBlockModal.reasonLabel}</p>
          <p>{event.note}</p>
        </div>
      ) : null}

      {isBooking ? (
        <BookingServiceList
          copy={copy}
          event={event}
        />
      ) : null}

      <div className="brand-pro-calendar-desktop-detail-actions">
        <button
          type="button"
          className="brand-pro-calendar-desktop-detail-action brand-focus"
          onClick={() => onOpenFullDetails(event.id)}
        >
          {copy.actions.reschedule}
        </button>

        <button
          type="button"
          className="brand-pro-calendar-desktop-detail-action brand-focus"
          onClick={() => onOpenFullDetails(event.id)}
        >
          {copy.actions.messageClient}
        </button>

        <button
          type="button"
          className="brand-pro-calendar-desktop-detail-action brand-focus"
          data-tone="primary"
          onClick={() => onOpenFullDetails(event.id)}
        >
          {copy.actions.checkIn}
        </button>
      </div>
    </aside>
  )
}

function BookingServiceList(props: {
  copy: BrandProCalendarCopy
  event: BookingCalendarEvent
}) {
  const { copy, event } = props

  if (event.details.serviceItems.length === 0) return null

  return (
    <div className="brand-pro-calendar-desktop-detail-card">
      <p className="brand-cap">{copy.labels.services}</p>

      <div className="brand-pro-calendar-desktop-detail-service-list">
        {event.details.serviceItems.map((item) => (
          <div
            key={item.id}
            className="brand-pro-calendar-desktop-detail-service-row"
          >
            <span>{item.name ?? event.details.serviceName}</span>
            <span>{item.price ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DesktopEditScheduleOverlay(props: DesktopEditScheduleOverlayProps) {
  const {
    open,
    copy,
    canSalon,
    canMobile,
    activeEditorType,
    onChangeEditorType,
    onSavedAny,
    onClose,
  } = props

  if (!open) return null

  return (
    <div className="brand-pro-calendar-desktop-edit-overlay">
      <section className="brand-pro-calendar-desktop-edit-panel">
        <header className="brand-pro-calendar-desktop-edit-header">
          <div>
            <p className="brand-pro-calendar-wide-eyebrow">
              ◆ {copy.actions.editSchedule}
            </p>

            <h3 className="brand-pro-calendar-desktop-edit-title">
              {copy.actions.editSchedule}
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="brand-pro-calendar-desktop-detail-close brand-focus"
            aria-label={copy.actions.close}
            title={copy.actions.close}
          >
            ×
          </button>
        </header>

        <div className="brand-pro-calendar-desktop-edit-body">
          <WorkingHoursTabs
            canSalon={canSalon}
            canMobile={canMobile}
            activeEditorType={activeEditorType}
            onChangeEditorType={onChangeEditorType}
            onSavedAny={onSavedAny}
          />
        </div>
      </section>
    </div>
  )
}

// ─── Sidebar sub-components ───────────────────────────────────────────────────

function StatusLegend(props: StatusLegendProps) {
  const { title, copy } = props

  return (
    <div className="brand-pro-calendar-legend">
      <p className="brand-pro-calendar-legend-title">{title}</p>

      <div className="brand-pro-calendar-legend-list">
        <LegendRow tone="accepted" label={copy.accepted} />
        <LegendRow tone="pending" label={copy.pending} />
        <LegendRow tone="completed" label={copy.completed} />
        <LegendRow tone="waitlist" label={copy.waitlist} />
        <LegendRow tone="blocked" label={copy.blocked} dashed />
      </div>
    </div>
  )
}

function LegendRow(props: {
  tone: CalendarLegendTone
  label: string
  dashed?: boolean
}) {
  const { tone, label, dashed = false } = props

  return (
    <div className="brand-pro-calendar-legend-row">
      <span
        className="brand-pro-calendar-legend-dot"
        data-tone={tone}
        data-dashed={dashed ? 'true' : 'false'}
        aria-hidden="true"
      />

      <span className="brand-pro-calendar-legend-label">{label}</span>
    </div>
  )
}

function AutoAcceptCard(props: AutoAcceptCardProps) {
  const { label, copy, enabled, saving, onToggle } = props

  const statusLabel = saving
    ? copy.savingLabel
    : enabled
      ? copy.onLabel
      : copy.offLabel

  const ariaLabel = enabled ? copy.ariaLabelOn : copy.ariaLabelOff

  return (
    <div className="brand-pro-calendar-auto-card">
      <p className="brand-pro-calendar-wide-eyebrow">◆ {label}</p>

      <p className="brand-pro-calendar-auto-card-description">
        {copy.subtitle}
      </p>

      <div className="brand-pro-calendar-auto-card-row">
        <span className="brand-cap">{statusLabel}</span>

        <button
          type="button"
          onClick={onToggle}
          disabled={saving}
          className="brand-pro-calendar-switch brand-focus"
          data-enabled={enabled ? 'true' : 'false'}
          data-saving={saving ? 'true' : 'false'}
          role="switch"
          aria-checked={enabled}
          aria-label={ariaLabel}
          title={ariaLabel}
        >
          <span className="brand-pro-calendar-switch-thumb" />
        </button>
      </div>
    </div>
  )
}

function ActionButton(props: ActionButtonProps) {
  const { children, onClick, active = false } = props

  return (
    <button
      type="button"
      onClick={onClick}
      className="brand-pro-calendar-sidebar-action brand-focus"
      data-active={active ? 'true' : 'false'}
    >
      {children}
    </button>
  )
}

function DetailRow(props: { label: string; value: string }) {
  const { label, value } = props

  return (
    <div className="brand-pro-calendar-desktop-detail-row">
      <span className="brand-cap">{label}</span>
      <span>{value}</span>
    </div>
  )
}

function StateBanner(props: StateBannerProps) {
  const { children, danger = false } = props

  return (
    <div
      className="brand-pro-calendar-state"
      data-danger={danger ? 'true' : 'false'}
    >
      {children}
    </div>
  )
}

// ─── Pure display helpers ─────────────────────────────────────────────────────

function eventDisplayTitle(
  event: CalendarEvent,
  copy: BrandProCalendarCopy,
): string {
  if (event.kind === 'BLOCK') {
    return event.note?.trim() || event.title || copy.legend.blocked
  }

  return event.clientName.trim() || copy.bookingModal.clientFallback
}

function eventServiceLabel(
  event: CalendarEvent,
  copy: BrandProCalendarCopy,
): string {
  if (event.kind === 'BLOCK') {
    return event.title.trim() || copy.legend.blocked
  }

  return event.details.serviceName.trim() || event.title || copy.labels.service
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

function eventInitials(event: CalendarEvent): string {
  const source =
    event.kind === 'BOOKING'
      ? event.clientName.trim() || event.title.trim()
      : event.title.trim() || event.note?.trim() || 'B'

  const words = source.split(/\s+/).filter((word) => word.length > 0)
  const first = words[0]?.[0] ?? 'B'
  const second = words[1]?.[0] ?? ''

  return `${first}${second}`.toUpperCase()
}

function eventTimeRangeLabel(event: CalendarEvent, timeZone: string): string {
  const startsAt = new Date(event.startsAt)
  const endsAt = new Date(event.endsAt)

  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  })

  return `${formatter.format(startsAt)} → ${timeFormatter.format(endsAt)}`
}

function bookingTotalLabel(event: BookingCalendarEvent): string | null {
  const prices = event.details.serviceItems
    .map((item) => item.price)
    .filter((price): price is string => Boolean(price?.trim()))

  if (prices.length === 0) return null
  if (prices.length === 1) return prices[0]

  return prices.join(' + ')
}