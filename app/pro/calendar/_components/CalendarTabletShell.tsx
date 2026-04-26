// app/pro/calendar/_components/CalendarTabletShell.tsx
'use client'

import type { Dispatch, ReactNode, SetStateAction } from 'react'

import WorkingHoursTabs from './WorkingHoursTabs'

import { CalendarHeaderControls } from './CalendarHeader'
import { CalendarStatsPanel } from './CalendarStatsPanel'
import { DayWeekGrid } from './DayWeekGrid'
import { MonthGrid } from './MonthGrid'

import type { CalendarData } from '../_hooks/useCalendarData'
import type { ViewMode } from '../_types'
import type { BrandProCalendarCopy } from '@/lib/brand/types'

import { anchorNoonInTimeZone } from '../_utils/date'

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

type TabletLocationBarProps = {
  shortLabel: string
  selectAriaLabel: string
  selectFallbackLabel: string
  optionFallbackLabel: string
  locationsLoaded: boolean
  scopedLocations: CalendarLocationOption[]
  activeLocationId: string | null
  activeLocationLabel: string | null
  onChangeLocation: (id: string | null) => void
}

type WideCalendarHeaderProps = {
  eyebrow: string
  title: string
  children: ReactNode
}

type CalendarTabletBodyProps = {
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

type StateBannerProps = {
  children: ReactNode
  danger?: boolean
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function locationOptionName(args: {
  location: CalendarLocationOption
  fallback: string
}): string {
  const { location, fallback } = args

  return location.name?.trim() || location.type?.trim() || fallback
}

function activeLocationDisplayLabel(args: {
  activeLocationLabel: string | null
  scopedLocations: CalendarLocationOption[]
  activeLocationId: string | null
  optionFallbackLabel: string
  selectFallbackLabel: string
}): string {
  const explicitLabel = args.activeLocationLabel?.trim()

  if (explicitLabel) return explicitLabel

  const activeLocation = args.scopedLocations.find(
    (location) => location.id === args.activeLocationId,
  )

  if (activeLocation) {
    return locationOptionName({
      location: activeLocation,
      fallback: args.optionFallbackLabel,
    })
  }

  return args.selectFallbackLabel
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
      <WideCalendarHeader
        eyebrow={`${copy.labels.mode} · ${headerLabel}`}
        title={title}
      >
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
      </WideCalendarHeader>

      <div className="brand-pro-calendar-tablet-main">
        <CalendarStatsPanel
          copy={copy.stats}
          stats={cal.stats}
          management={cal.management}
          blockedMinutesToday={cal.blockedMinutesToday}
          onOpenManagement={cal.openManagement}
          variant="tablet"
          compact
        />

        <section className="brand-pro-calendar-tablet-toolbar">
          <TabletLocationBar
            shortLabel={copy.labels.locationShort}
            selectAriaLabel={copy.locationPanel.selectAriaLabel}
            selectFallbackLabel={copy.locationPanel.selectFallback}
            optionFallbackLabel={copy.locationPanel.selectLabel}
            locationsLoaded={cal.locationsLoaded}
            scopedLocations={cal.scopedLocations}
            activeLocationId={cal.activeLocationId}
            activeLocationLabel={cal.activeLocationLabel}
            onChangeLocation={cal.setActiveLocationId}
          />

          <button
            type="button"
            onClick={() =>
              cal.setShowHoursForm((current: boolean) => !current)
            }
            className="brand-pro-calendar-sidebar-action brand-focus"
            data-active={cal.showHoursForm ? 'true' : 'false'}
          >
            {cal.showHoursForm
              ? copy.actions.hideHours
              : copy.actions.editHours}
          </button>
        </section>

        {cal.showHoursForm ? (
          <section className="brand-pro-calendar-hours-panel">
            <WorkingHoursTabs
              canSalon={cal.canSalon}
              canMobile={cal.canMobile}
              activeEditorType={cal.hoursEditorLocationType}
              onChangeEditorType={cal.setHoursEditorLocationType}
              onSavedAny={cal.reload}
            />
          </section>
        ) : null}

        <CalendarTabletBody
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
      </div>
    </section>
  )
}

// ─── Sections ─────────────────────────────────────────────────────────────────

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

function CalendarTabletBody(props: CalendarTabletBodyProps) {
  const {
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
    <section className="brand-pro-calendar-tablet-content">
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
    </section>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TabletLocationBar(props: TabletLocationBarProps) {
  const {
    shortLabel,
    selectAriaLabel,
    selectFallbackLabel,
    optionFallbackLabel,
    locationsLoaded,
    scopedLocations,
    activeLocationId,
    activeLocationLabel,
    onChangeLocation,
  } = props

  if (!locationsLoaded || scopedLocations.length <= 1) return null

  const displayLabel = activeLocationDisplayLabel({
    activeLocationLabel,
    scopedLocations,
    activeLocationId,
    optionFallbackLabel,
    selectFallbackLabel,
  })

  return (
    <div className="brand-pro-calendar-location-bar" data-density="tablet">
      <span className="brand-pro-calendar-location-label">{shortLabel}</span>

      <select
        value={activeLocationId ?? ''}
        onChange={(event) => onChangeLocation(event.target.value || null)}
        aria-label={selectAriaLabel}
        className="brand-pro-calendar-location-select brand-focus"
      >
        {!activeLocationId ? <option value="">{displayLabel}</option> : null}

        {scopedLocations.map((location) => (
          <option key={location.id} value={location.id}>
            {locationOptionName({
              location,
              fallback: optionFallbackLabel,
            })}
          </option>
        ))}
      </select>
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