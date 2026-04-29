// app/pro/calendar/_components/CalendarMobileShell.tsx
'use client'

import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { CalendarStatsPanel } from './CalendarStatsPanel'
import { DayWeekGrid } from './DayWeekGrid'
import { MobileAutoAcceptBar } from './MobileAutoAcceptBar'
import { MobileCalendarControls } from './MobileCalendarControls'
import { MobileCalendarFab } from './MobileCalendarFab'
import { MobileCalendarHeader } from './MobileCalendarHeader'
import { MobileMonthGrid } from './MobileMonthGrid'
import { MobilePendingRequestBar } from './MobilePendingRequestBar'
import { EditScheduleOverlay } from './EditScheduleOverlay'
import type { CalendarData } from '../_hooks/useCalendarData'
import type { CalendarEvent, ViewMode } from '../_types'
import type { BrandProCalendarCopy } from '@/lib/brand/types'

import { anchorNoonInTimeZone } from '../_utils/date'
import { calendarLocationDisplayLabel } from '../_viewModel/proCalendarDisplay'

// ─── Types ────────────────────────────────────────────────────────────────────

type CalendarMobileShellProps = {
  copy: BrandProCalendarCopy

  view: ViewMode
  setView: Dispatch<SetStateAction<ViewMode>>

  currentDate: Date
  setCurrentDate: Dispatch<SetStateAction<Date>>

  calendarTimeZone: string
  headerLabel: string
  title: string
  subtitle: string
  visibleDays: Date[]

  showInitialLoading: boolean
  showReloadLoading: boolean

  onToday: () => void
  onBack: () => void
  onNext: () => void

  topPendingRequest: CalendarEvent | undefined
  topPendingBookingId: string | null

  cal: CalendarData
}

type CalendarLocationOption = CalendarData['scopedLocations'][number]

type MobileLocationBarProps = {
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

type StateBannerProps = {
  children: ReactNode
  danger?: boolean
}

// ─── Exported component ───────────────────────────────────────────────────────

export function CalendarMobileShell(props: CalendarMobileShellProps) {
  const {
    copy,
    view,
    setView,
    currentDate,
    setCurrentDate,
    calendarTimeZone,
    headerLabel,
    title,
    subtitle,
    visibleDays,
    showInitialLoading,
    showReloadLoading,
    onToday,
    onBack,
    onNext,
    topPendingRequest,
    topPendingBookingId,
    cal,
  } = props

  return (
    <>
      <section className="brand-pro-calendar-shell" data-device="mobile">
        <MobileCalendarHeader title={title} subtitle={subtitle} />

        <div className="px-5 pb-3">
          <CalendarStatsPanel
            copy={copy.stats}
            stats={cal.stats}
            management={cal.management}
            blockedMinutesToday={cal.blockedMinutesToday}
            onOpenManagement={cal.openManagement}
            variant="mobile"
            compact
          />
        </div>

        <div className="px-5 pb-3">
          <MobileCalendarControls
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
          />
        </div>

        <MobileLocationBar
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
        <div className="p-0">
          <div className="px-4 pt-3">
            {showInitialLoading ? (
              <StateBanner>{copy.labels.loadingCalendar}</StateBanner>
            ) : null}

            {showReloadLoading ? (
              <StateBanner>{copy.labels.loadingRefresh}</StateBanner>
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
            <MobileMonthGrid
              visibleDays={visibleDays}
              currentDate={currentDate}
              events={cal.events}
              timeZone={calendarTimeZone}
              onPickDay={(date) => {
                setCurrentDate(anchorNoonInTimeZone(date, calendarTimeZone))
                setView('day')
              }}
            />
          ) : null}
        </div>
      </section>

      <EditScheduleOverlay
        open={cal.showHoursForm}
        device="mobile"
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
      <MobileCalendarFab
        onClick={cal.openCreateBlockNow}
        label={copy.actions.createBlock}
      />

      <MobileAutoAcceptBar
        copy={copy.mobileAutoAccept}
        enabled={cal.autoAccept}
        saving={cal.savingAutoAccept}
        onToggle={() => void cal.toggleAutoAccept(!cal.autoAccept)}
      />

      <MobilePendingRequestBar
        copy={copy.mobilePendingRequest}
        event={topPendingRequest}
        pendingCount={cal.management.pendingRequests.length}
        busy={Boolean(
          topPendingBookingId &&
            cal.managementActionBusyId === topPendingBookingId,
        )}
        error={cal.managementActionError}
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
    </>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MobileLocationBar(props: MobileLocationBarProps) {
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

  const displayLabel = calendarLocationDisplayLabel({
    activeLocationId,
    activeLocationLabel,
    scopedLocations,
    fallbackLabel: selectFallbackLabel,
  })

  return (
    <div className="brand-pro-calendar-location-bar">
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
            {calendarLocationDisplayLabel({
              activeLocationId: location.id,
              activeLocationLabel: null,
              scopedLocations,
              fallbackLabel: optionFallbackLabel,
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