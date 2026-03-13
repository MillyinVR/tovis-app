// app/pro/calendar/page.tsx
'use client'

import { useMemo, useState } from 'react'

import BlockTimeModal from './BlockTimeModal'
import EditBlockModal from './EditBlockModal'
import WorkingHoursTabs from './WorkingHoursTabs'
import { useCalendarData } from './_hooks/useCalendarData'
import { useCalendarNavigation } from './_hooks/useCalendarNavigation'
import {
  CalendarHeader,
  CalendarHeaderControls,
} from './_components/CalendarHeader'
import { CalendarLocationPanel } from './_components/CalendarLocationPanel'
import { ManagementStrip } from './_components/ManagementStrip'
import { DayWeekGrid } from './_components/DayWeekGrid'
import { MonthGrid } from './_components/MonthGrid'
import { ConfirmChangeModal } from './_components/ConfirmChangeModal'
import { ManagementModal } from './_components/ManagementModal'
import { BookingModal } from './_components/BookingModal'

import type { ViewMode } from './_types'

import {
  anchorNoonInTimeZone,
  startOfMonthAnchorNoonInTimeZone,
  startOfWeekAnchorNoonInTimeZone,
  formatWeekRangeInTimeZone,
  formatMonthRangeInTimeZone,
  formatDayLabelInTimeZone,
} from './_utils/date'

import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  sanitizeTimeZone,
  startOfDayUtcInTimeZone,
} from '@/lib/timeZone'

function safeTz(raw: unknown) {
  return sanitizeTimeZone(typeof raw === 'string' ? raw : '', DEFAULT_TIME_ZONE)
}

function headerLabelFor(view: ViewMode, anchorUtc: Date, tz: string) {
  if (view === 'day') return formatDayLabelInTimeZone(anchorUtc, tz)
  if (view === 'week') return formatWeekRangeInTimeZone(anchorUtc, tz)
  return formatMonthRangeInTimeZone(anchorUtc, tz)
}

export default function ProCalendarPage() {
  const [view, setView] = useState<ViewMode>('week')
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date())

  const cal = useCalendarData({ view, currentDate })

  const calendarTimeZone = useMemo(() => safeTz(cal.timeZone), [cal.timeZone])

  const activeLocationTimeZone = useMemo(() => {
    const raw = cal.activeLocation?.timeZone
    if (
      typeof raw === 'string' &&
      raw.trim() &&
      isValidIanaTimeZone(raw.trim())
    ) {
      return sanitizeTimeZone(raw.trim(), calendarTimeZone)
    }
    return calendarTimeZone
  }, [cal.activeLocation?.timeZone, calendarTimeZone])

  const bookingModalTimeZone = useMemo(() => {
    return safeTz(cal.booking?.timeZone ?? calendarTimeZone)
  }, [cal.booking?.timeZone, calendarTimeZone])

  const anchoredCurrentDate = useMemo(
    () => anchorNoonInTimeZone(currentDate, calendarTimeZone),
    [currentDate, calendarTimeZone],
  )

  const { goToToday, goBack, goNext } = useCalendarNavigation({
    view,
    timeZone: calendarTimeZone,
    setCurrentDate,
  })

  const showInitialLoading = cal.loading && cal.events.length === 0
  const showReloadLoading = cal.loading && cal.events.length > 0

  const visibleDays = useMemo(() => {
    const tz = calendarTimeZone

    if (view === 'day') {
      return [startOfDayUtcInTimeZone(anchoredCurrentDate, tz)]
    }

    if (view === 'week') {
      const weekStartNoon = startOfWeekAnchorNoonInTimeZone(
        anchoredCurrentDate,
        tz,
      )
      const weekStartUtc = startOfDayUtcInTimeZone(weekStartNoon, tz)

      return Array.from({ length: 7 }, (_, index) => {
        return new Date(weekStartUtc.getTime() + index * 24 * 60 * 60_000)
      })
    }

    const monthStartNoon = startOfMonthAnchorNoonInTimeZone(
      anchoredCurrentDate,
      tz,
    )
    const firstWeekNoon = startOfWeekAnchorNoonInTimeZone(monthStartNoon, tz)
    const firstGridDayUtc = startOfDayUtcInTimeZone(firstWeekNoon, tz)

    return Array.from({ length: 42 }, (_, index) => {
      return new Date(firstGridDayUtc.getTime() + index * 24 * 60 * 60_000)
    })
  }, [view, anchoredCurrentDate, calendarTimeZone])

  const headerLabel = useMemo(
    () => headerLabelFor(view, anchoredCurrentDate, calendarTimeZone),
    [view, anchoredCurrentDate, calendarTimeZone],
  )

  return (
    <main className="mx-auto max-w-275 px-4 pb-10 pt-6 font-sans text-textPrimary md:pt-10">
      <CalendarHeader />

      <ManagementStrip
        stats={cal.stats}
        management={cal.management}
        blockedMinutesToday={cal.blockedMinutesToday}
        showHoursForm={cal.showHoursForm}
        setShowHoursForm={cal.setShowHoursForm}
        autoAccept={cal.autoAccept}
        savingAutoAccept={cal.savingAutoAccept}
        onToggleAutoAccept={cal.toggleAutoAccept}
        onOpenManagement={cal.openManagement}
      />

      <CalendarLocationPanel
        locationsLoaded={cal.locationsLoaded}
        scopedLocations={cal.scopedLocations}
        activeLocationId={cal.activeLocationId}
        activeLocationLabel={cal.activeLocationLabel}
        calendarTimeZone={calendarTimeZone}
        onChangeLocation={cal.setActiveLocationId}
      />

      {cal.showHoursForm && (
        <section className="mb-4">
          <div className="tovis-glass-soft tovis-noise border border-white/10 px-4 py-4 md:px-5">
            <WorkingHoursTabs
              canSalon={Boolean(cal.canSalon)}
              canMobile={Boolean(cal.canMobile)}
              activeEditorType={cal.hoursEditorLocationType}
              onChangeEditorType={cal.setHoursEditorLocationType}
              onSavedAny={() => cal.reload()}
            />
          </div>
        </section>
      )}

      <CalendarHeaderControls
        view={view}
        setView={setView}
        headerLabel={headerLabel}
        onToday={goToToday}
        onBack={goBack}
        onNext={goNext}
      />

      {showInitialLoading && (
        <div className="mb-3 tovis-glass-soft tovis-noise rounded-2xl border border-white/10 px-4 py-6 text-sm text-textSecondary">
          Loading calendar…
        </div>
      )}

      {showReloadLoading && (
        <div className="mb-3 tovis-glass-soft tovis-noise rounded-2xl border border-white/10 px-4 py-3 text-sm text-textSecondary">
          Loading…
        </div>
      )}

      {cal.error && (
        <div className="mb-3 tovis-glass-soft tovis-noise rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-toneDanger">
          {cal.error}
        </div>
      )}

      {(view === 'day' || view === 'week') && !showInitialLoading && (
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
      )}

      {view === 'month' && !showInitialLoading && (
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
      )}

      <BlockTimeModal
        open={cal.blockCreateOpen}
        onClose={() => cal.setBlockCreateOpen(false)}
        initialStart={cal.blockCreateInitialStart}
        timeZone={activeLocationTimeZone}
        locationId={cal.activeLocationId}
        locationLabel={cal.activeLocationLabel}
        stepMinutes={cal.activeStepMinutes}
        onCreated={() => cal.reload()}
      />

      <EditBlockModal
        open={cal.editBlockOpen}
        blockId={cal.editBlockId}
        timeZone={activeLocationTimeZone}
        stepMinutes={cal.activeStepMinutes}
        onClose={() => {
          cal.setEditBlockOpen(false)
          cal.setEditBlockId(null)
        }}
        onSaved={() => cal.reload()}
      />

      <ManagementModal
        open={cal.managementOpen}
        activeKey={cal.managementKey}
        management={cal.management}
        viewportTimeZone={calendarTimeZone}
        onClose={cal.closeManagement}
        onSetKey={cal.setManagementKey}
        onPickEvent={(event) => {
          cal.closeManagement()
          cal.openBookingOrBlock(event.id)
        }}
        onCreateBlockNow={() => {
          cal.closeManagement()
          cal.openCreateBlockNow()
        }}
        onBlockFullDayToday={() => {
          cal.closeManagement()
          void cal.oneClickBlockFullDay(new Date())
        }}
        onApproveBookingId={(bookingId) => void cal.approveBookingById(bookingId)}
        onDenyBookingId={(bookingId) => void cal.denyBookingById(bookingId)}
        actionBusyId={cal.managementActionBusyId}
        actionError={cal.managementActionError}
      />

      <ConfirmChangeModal
        open={cal.confirmOpen}
        change={cal.pendingChange}
        applying={cal.applyingChange}
        onCancel={cal.cancelConfirm}
        onConfirm={cal.applyConfirm}
      />

      <BookingModal
        open={Boolean(cal.openBookingId)}
        loading={cal.bookingLoading}
        error={cal.bookingError}
        booking={cal.booking}
        services={cal.services}
        appointmentTimeZone={bookingModalTimeZone}
        bookingServiceLabel={cal.bookingServiceLabel}
        serviceItemsDraft={cal.serviceItemsDraft}
        selectedDraftServiceIds={cal.selectedDraftServiceIds}
        hasDraftServiceItemsChanges={cal.hasDraftServiceItemsChanges}
        reschedDate={cal.reschedDate}
        reschedTime={cal.reschedTime}
        durationMinutes={cal.durationMinutes}
        notifyClient={cal.notifyClient}
        allowOutsideHours={cal.allowOutsideHours}
        editOutside={cal.editOutside}
        saving={cal.savingReschedule}
        onClose={cal.closeBooking}
        onChangeReschedDate={cal.setReschedDate}
        onChangeReschedTime={cal.setReschedTime}
        onChangeSelectedDraftServiceIds={cal.setDraftServiceIds}
        onToggleNotifyClient={cal.setNotifyClient}
        onToggleAllowOutsideHours={cal.setAllowOutsideHours}
        onSave={cal.submitChanges}
        onApprove={cal.approveBooking}
        onDeny={cal.denyBooking}
      />
    </main>
  )
}