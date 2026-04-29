// app/pro/calendar/_components/CalendarTabletShell.tsx
'use client'

import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { CalendarHeaderControls } from './CalendarHeader'
import { CalendarStatsPanel } from './CalendarStatsPanel'
import { DayWeekGrid } from './DayWeekGrid'
import { MonthGrid } from './MonthGrid'
import { PendingRequestSurface } from './PendingRequestSurface'
import { EditScheduleOverlay } from './EditScheduleOverlay'
import type { CalendarData } from '../_hooks/useCalendarData'
import type { ViewMode } from '../_types'
import type { BrandProCalendarCopy } from '@/lib/brand/types'

import { anchorNoonInTimeZone } from '../_utils/date'

import {
  bookingActionId,
  calendarLocationDisplayLabel,
  firstPendingBooking,
} from '../_viewModel/proCalendarDisplay'

// ─── Types ────────────────────────────────────────────────────────────────────

type CalendarTabletShellProps = {
  copy: BrandProCalendarCopy

  view: ViewMode
  setView: Dispatch<SetStateAction<ViewMode>>

  currentDate: Date
  setCurrentDate: Dispatch<SetStateAction<Date>>

  calendarTimeZone: string
  headerLabel: string
  title: string
  visibleDays: Date[]

  showInitialLoading: boolean
  showReloadLoading: boolean

  onToday: () => void
  onBack: () => void
  onNext: () => void

  cal: CalendarData
}

type CalendarLocationOption = CalendarData['scopedLocations'][number]

type TabletHeaderProps = {
  copy: BrandProCalendarCopy
  view: ViewMode
  setView: Dispatch<SetStateAction<ViewMode>>
  headerLabel: string
  title: string
  showHoursForm: boolean
  onToday: () => void
  onBack: () => void
  onNext: () => void
  onBlockTime: () => void
  onToggleHoursForm: () => void
}

type TabletToolbarProps = {
  copy: BrandProCalendarCopy
  locationsLoaded: boolean
  scopedLocations: CalendarLocationOption[]
  activeLocationId: string | null
  activeLocationLabel: string | null
  autoAccept: boolean
  savingAutoAccept: boolean
  onChangeLocation: (id: string | null) => void
  onToggleAutoAccept: () => void
}

type TabletLocationPickerProps = {
  label: string
  selectAriaLabel: string
  selectFallbackLabel: string
  optionFallbackLabel: string
  locationsLoaded: boolean
  scopedLocations: CalendarLocationOption[]
  activeLocationId: string | null
  activeLocationLabel: string | null
  onChangeLocation: (id: string | null) => void
}

type TabletAutoAcceptProps = {
  label: string
  copy: BrandProCalendarCopy['mobileAutoAccept']
  enabled: boolean
  saving: boolean
  onToggle: () => void
}

type TabletCalendarBodyProps = {
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
  cal: CalendarData
}

type TabletPendingBarProps = {
  copy: BrandProCalendarCopy
  cal: CalendarData
}

type StateBannerProps = {
  children: ReactNode
  danger?: boolean
}

// ─── Exported component ───────────────────────────────────────────────────────

export function CalendarTabletShell(props: CalendarTabletShellProps) {
  const {
    copy,
    view,
    setView,
    currentDate,
    setCurrentDate,
    calendarTimeZone,
    headerLabel,
    title,
    visibleDays,
    showInitialLoading,
    showReloadLoading,
    onToday,
    onBack,
    onNext,
    cal,
  } = props

  return (
    <section className="brand-pro-calendar-shell" data-device="tablet">
      <div className="brand-pro-calendar-tablet-frame">
        <TabletHeader
          copy={copy}
          view={view}
          setView={setView}
          headerLabel={headerLabel}
          title={title}
          showHoursForm={cal.showHoursForm}
          onToday={onToday}
          onBack={onBack}
          onNext={onNext}
          onBlockTime={cal.openCreateBlockNow}
          onToggleHoursForm={() => {
            cal.setShowHoursForm((current) => !current)
          }}
        />

        <section className="brand-pro-calendar-tablet-stats-strip">
          <CalendarStatsPanel
            copy={copy.stats}
            stats={cal.stats}
            management={cal.management}
            blockedMinutesToday={cal.blockedMinutesToday}
            onOpenManagement={cal.openManagement}
            variant="tablet"
            compact
          />
        </section>

        <TabletToolbar
          copy={copy}
          locationsLoaded={cal.locationsLoaded}
          scopedLocations={cal.scopedLocations}
          activeLocationId={cal.activeLocationId}
          activeLocationLabel={cal.activeLocationLabel}
          autoAccept={cal.autoAccept}
          savingAutoAccept={cal.savingAutoAccept}
          onChangeLocation={cal.setActiveLocationId}
          onToggleAutoAccept={() => {
            void cal.toggleAutoAccept(!cal.autoAccept)
          }}
        />

        <TabletCalendarBody
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
          cal={cal}
        />

        <TabletPendingBar copy={copy} cal={cal} />

        <EditScheduleOverlay
          open={cal.showHoursForm}
          device="tablet"
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
      </div>
    </section>
  )
}

// ─── Tablet layout sections ───────────────────────────────────────────────────

function TabletHeader(props: TabletHeaderProps) {
  const {
    copy,
    view,
    setView,
    headerLabel,
    title,
    showHoursForm,
    onToday,
    onBack,
    onNext,
    onBlockTime,
    onToggleHoursForm,
  } = props

  return (
    <header className="brand-pro-calendar-tablet-header">
      <div className="brand-pro-calendar-tablet-header-copy">
        <p className="brand-pro-calendar-tablet-eyebrow">
          {copy.tablet.eyebrowPrefix} · {headerLabel}
        </p>

        <h2 className="brand-pro-calendar-tablet-title">{title}</h2>
      </div>

      <div className="brand-pro-calendar-tablet-header-controls">
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
          onBlockTime={onBlockTime}
          blockTimeLabel={copy.actions.blockTime}
        />

        <button
          type="button"
          onClick={onToggleHoursForm}
          className="brand-pro-calendar-tablet-schedule-button brand-focus"
          data-active={showHoursForm ? 'true' : 'false'}
          aria-pressed={showHoursForm}
        >
          {showHoursForm ? copy.actions.hideHours : copy.actions.editSchedule}
        </button>
      </div>
    </header>
  )
}

function TabletToolbar(props: TabletToolbarProps) {
  const {
    copy,
    locationsLoaded,
    scopedLocations,
    activeLocationId,
    activeLocationLabel,
    autoAccept,
    savingAutoAccept,
    onChangeLocation,
    onToggleAutoAccept,
  } = props

  return (
    <section className="brand-pro-calendar-tablet-toolbar">
      <TabletLocationPicker
        label={copy.tablet.locationToolbarLabel}
        selectAriaLabel={copy.locationPanel.selectAriaLabel}
        selectFallbackLabel={copy.locationPanel.selectFallback}
        optionFallbackLabel={copy.locationPanel.selectLabel}
        locationsLoaded={locationsLoaded}
        scopedLocations={scopedLocations}
        activeLocationId={activeLocationId}
        activeLocationLabel={activeLocationLabel}
        onChangeLocation={onChangeLocation}
      />

      <TabletAutoAccept
        label={copy.actions.autoAccept}
        copy={copy.mobileAutoAccept}
        enabled={autoAccept}
        saving={savingAutoAccept}
        onToggle={onToggleAutoAccept}
      />
    </section>
  )
}

function TabletCalendarBody(props: TabletCalendarBodyProps) {
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
    cal,
  } = props

  return (
    <section className="brand-pro-calendar-tablet-calendar-area">
      <div className="brand-pro-calendar-tablet-state-list">
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
          onClickEvent={cal.openBookingOrBlock}
          onCreateForClick={cal.openCreateForClick}
          onDragStart={cal.drag.onDragStart}
          onDropOnDayColumn={cal.drag.onDropOnDayColumn}
          onBeginResize={cal.resize.beginResize}
          suppressClickRef={cal.ui.suppressClickRef}
          isBusy={cal.ui.isOverlayOpen}
        />
      ) : null}

      {view === 'month' && !showInitialLoading ? (
        <div className="brand-pro-calendar-tablet-month-wrap">
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
    </section>
  )
}

function TabletPendingBar(props: TabletPendingBarProps) {
  const { copy, cal } = props

  const topPendingRequest = firstPendingBooking(cal.management.pendingRequests)
  const topPendingBookingId = bookingActionId(topPendingRequest)

  return (
    <div className="brand-pro-calendar-tablet-pending-bar">
      <PendingRequestSurface
        copy={copy.mobilePendingRequest}
        event={topPendingRequest}
        pendingCount={cal.management.pendingRequests.length}
        busy={Boolean(
          topPendingBookingId &&
            cal.managementActionBusyId === topPendingBookingId,
        )}
        error={cal.managementActionError}
        variant="tablet"
        actionMode="label"
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
    </div>
  )
}

// ─── Tablet controls ──────────────────────────────────────────────────────────

function TabletLocationPicker(props: TabletLocationPickerProps) {
  const {
    label,
    selectAriaLabel,
    selectFallbackLabel,
    optionFallbackLabel,
    locationsLoaded,
    scopedLocations,
    activeLocationId,
    activeLocationLabel,
    onChangeLocation,
  } = props

  if (!locationsLoaded) return null

  const firstLocation = scopedLocations[0]

  const singleLocationFallbackLabel = firstLocation
    ? calendarLocationDisplayLabel({
        activeLocationId: firstLocation.id,
        activeLocationLabel: null,
        scopedLocations,
        fallbackLabel: selectFallbackLabel,
      })
    : selectFallbackLabel

  const displayLabel = calendarLocationDisplayLabel({
    activeLocationId,
    activeLocationLabel,
    scopedLocations,
    fallbackLabel: singleLocationFallbackLabel,
  })

  const hasMultipleLocations = scopedLocations.length > 1

  return (
    <div className="brand-pro-calendar-tablet-location">
      <span className="brand-pro-calendar-tablet-toolbar-label">{label}</span>

      {hasMultipleLocations ? (
        <select
          value={activeLocationId ?? ''}
          onChange={(event) => onChangeLocation(event.target.value || null)}
          aria-label={selectAriaLabel}
          className="brand-pro-calendar-tablet-location-select brand-focus"
        >
          {!activeLocationId ? <option value="">{displayLabel}</option> : null}

          {scopedLocations.map((location) => (
            <option key={location.id} value={location.id}>
              {calendarLocationDisplayLabel({
                activeLocationId: location.id,
                activeLocationLabel: null,
                scopedLocations,
                fallbackLabel: optionFallbackLabel,
              })}
            </option>
          ))}
        </select>
      ) : (
        <span className="brand-pro-calendar-tablet-location-static">
          {displayLabel}
        </span>
      )}
    </div>
  )
}

function TabletAutoAccept(props: TabletAutoAcceptProps) {
  const { label, copy, enabled, saving, onToggle } = props

  const statusLabel = saving
    ? copy.savingLabel
    : enabled
      ? copy.onLabel
      : copy.offLabel

  const ariaLabel = enabled ? copy.ariaLabelOn : copy.ariaLabelOff

  return (
    <div className="brand-pro-calendar-tablet-auto-accept">
      <div className="brand-pro-calendar-tablet-auto-copy">
        <span
          className="brand-pro-calendar-tablet-auto-dot"
          data-enabled={enabled ? 'true' : 'false'}
          aria-hidden="true"
        />

        <span className="brand-pro-calendar-tablet-auto-label">
          {label}
        </span>

        <span className="brand-pro-calendar-tablet-auto-subtitle">
          {copy.subtitle}
        </span>
      </div>

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
        title={`${label}: ${statusLabel}`}
      >
        <span className="brand-pro-calendar-switch-thumb" />
      </button>
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