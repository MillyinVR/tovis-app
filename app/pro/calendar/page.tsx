// app/pro/calendar/page.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import CreateBookingModal from './CreateBookingModal'
import BlockTimeModal from './BlockTimeModal'
import EditBlockModal from './EditBlockModal'
import WorkingHoursTabs from './WorkingHoursTabs'
import { useCalendarData } from './_hooks/useCalendarData'
import { CalendarHeader, CalendarHeaderControls } from './_components/CalendarHeader'
import { ManagementStrip } from './_components/ManagementStrip'
import { DayWeekGrid } from './_components/DayWeekGrid'
import { MonthGrid } from './_components/MonthGrid'
import { ConfirmChangeModal } from './_components/ConfirmChangeModal'
import { ManagementModal } from './_components/ManagementModal'
import { BookingModal } from './_components/BookingModal'

import type { ViewMode } from './_types'

// ✅ Single source of truth for calendar date math
import {
  anchorNoonInTimeZone,
  addDaysAnchorNoonInTimeZone,
  addMonthsAnchorNoonInTimeZone,
  startOfMonthAnchorNoonInTimeZone,
  startOfWeekAnchorNoonInTimeZone,
  formatWeekRangeInTimeZone,
  formatMonthRangeInTimeZone,
  formatDayLabelInTimeZone,
} from './_utils/date'

import { DEFAULT_TIME_ZONE, sanitizeTimeZone, startOfDayUtcInTimeZone, ymdInTimeZone } from '@/lib/timeZone'

function safeTz(raw: unknown) {
  return sanitizeTimeZone(typeof raw === 'string' ? raw : '', DEFAULT_TIME_ZONE)
}

function sameLocalDayInTz(aUtc: Date, bUtc: Date, tz: string) {
  return ymdInTimeZone(aUtc, tz) === ymdInTimeZone(bUtc, tz)
}

function headerLabelFor(view: ViewMode, anchorUtc: Date, tz: string) {
  if (view === 'day') return formatDayLabelInTimeZone(anchorUtc, tz)
  if (view === 'week') return formatWeekRangeInTimeZone(anchorUtc, tz)
  return formatMonthRangeInTimeZone(anchorUtc, tz)
}

export default function ProCalendarPage() {
  const [view, setView] = useState<ViewMode>('week')

  // ✅ Strict: focus date stored as a TZ-noon anchor (UTC Date).
  // Start with "now", then normalize once we know TZ.
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date())

  const cal = useCalendarData({ view, currentDate })

  // ✅ Use calendar tz; if missing/invalid the hook uses DEFAULT_TIME_ZONE (UTC).
  const timeZone = useMemo(() => safeTz(cal.timeZone), [cal.timeZone])

  // ✅ Normalize currentDate to noon-in-TZ. Avoid pointless re-anchoring loops.
  const didNormalizeRef = useRef(false)
  useEffect(() => {
    setCurrentDate((d) => {
      const anchored = anchorNoonInTimeZone(d, timeZone)

      if (!didNormalizeRef.current) {
        didNormalizeRef.current = true
        return anchored
      }

      // Only change if it would actually move the local calendar day in this TZ
      return sameLocalDayInTz(d, anchored, timeZone) ? d : anchored
    })
  }, [timeZone])

  const visibleDays = useMemo(() => {
    const tz = timeZone

    // Build the grid using TZ-anchored day starts (UTC Dates representing midnight-in-TZ)
    if (view === 'day') {
      const startUtc = startOfDayUtcInTimeZone(currentDate, tz)
      return [startUtc]
    }

    if (view === 'week') {
      // ✅ Monday-start week (comes from _utils/date.ts)
      const weekStartNoon = startOfWeekAnchorNoonInTimeZone(currentDate, tz)
      const weekStartDayStartUtc = startOfDayUtcInTimeZone(weekStartNoon, tz)
      return Array.from({ length: 7 }, (_, i) => new Date(weekStartDayStartUtc.getTime() + i * 24 * 60 * 60_000))
    }

    // month grid: start at week start that contains the 1st of the month
    const monthStartNoon = startOfMonthAnchorNoonInTimeZone(currentDate, tz)
    const firstWeekNoon = startOfWeekAnchorNoonInTimeZone(monthStartNoon, tz)
    const firstGridDayStartUtc = startOfDayUtcInTimeZone(firstWeekNoon, tz)

    return Array.from({ length: 42 }, (_, i) => new Date(firstGridDayStartUtc.getTime() + i * 24 * 60 * 60_000))
  }, [view, currentDate, timeZone])

  const headerLabel = useMemo(() => headerLabelFor(view, currentDate, timeZone), [view, currentDate, timeZone])

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

      {cal.showHoursForm && (
        <section className="mb-4">
          <div className="tovis-glass-soft tovis-noise border border-white/10 px-4 py-4 md:px-5">
            <WorkingHoursTabs
              canSalon={Boolean(cal.canSalon)}
              canMobile={Boolean(cal.canMobile)}
              activeLocationType={cal.activeLocationType}
              onChangeLocationType={(next) => cal.setActiveLocationType(next)}
              onSavedAny={() => {
                cal.reload()
              }}
            />
          </div>
        </section>
      )}

      <CalendarHeaderControls
        view={view}
        setView={setView}
        headerLabel={headerLabel}
        onToday={() => setCurrentDate(anchorNoonInTimeZone(new Date(), timeZone))}
        onBack={() => {
          if (view === 'day') setCurrentDate((d) => addDaysAnchorNoonInTimeZone(d, -1, timeZone))
          else if (view === 'week') setCurrentDate((d) => addDaysAnchorNoonInTimeZone(d, -7, timeZone))
          else setCurrentDate((d) => addMonthsAnchorNoonInTimeZone(d, -1, timeZone))
        }}
        onNext={() => {
          if (view === 'day') setCurrentDate((d) => addDaysAnchorNoonInTimeZone(d, 1, timeZone))
          else if (view === 'week') setCurrentDate((d) => addDaysAnchorNoonInTimeZone(d, 7, timeZone))
          else setCurrentDate((d) => addMonthsAnchorNoonInTimeZone(d, 1, timeZone))
        }}
      />

      {cal.loading && (
        <div className="mb-3 tovis-glass-soft tovis-noise rounded-2xl border border-white/10 px-4 py-3 text-sm text-textSecondary">
          Loading…
        </div>
      )}

      {cal.error && (
        <div className="mb-3 tovis-glass-soft tovis-noise rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-toneDanger">
          {cal.error}
        </div>
      )}

      {(view === 'day' || view === 'week') && (
        <DayWeekGrid
          view={view}
          visibleDays={visibleDays}
          events={cal.events}
          workingHours={cal.workingHours}
          timeZone={timeZone}
          locationType={cal.activeLocationType}
          onClickEvent={cal.openBookingOrBlock}
          onCreateForClick={cal.openCreateForClick}
          onDragStart={cal.drag.onDragStart}
          onDropOnDayColumn={cal.drag.onDropOnDayColumn}
          onBeginResize={cal.resize.beginResize}
          suppressClickRef={cal.ui.suppressClickRef}
          isBusy={cal.ui.isOverlayOpen}
        />
      )}

      {view === 'month' && (
        <MonthGrid
          visibleDays={visibleDays}
          currentDate={currentDate}
          events={cal.events}
          timeZone={timeZone}
          onPickDay={(d) => {
            setCurrentDate(anchorNoonInTimeZone(d, timeZone))
            setView('day')
          }}
        />
      )}

      {/* Modals */}
      <CreateBookingModal
        open={cal.createOpen}
        onClose={() => cal.setCreateOpen(false)}
        workingHours={cal.workingHours}
        initialStart={cal.createInitialStart}
        timeZone={timeZone}
        services={cal.services}
        onCreated={() => cal.reload()}
      />

      <BlockTimeModal
        open={cal.blockCreateOpen}
        onClose={() => cal.setBlockCreateOpen(false)}
        initialStart={cal.blockCreateInitialStart}
        timeZone={timeZone}
        onCreated={() => cal.reload()}
      />

      <EditBlockModal
        open={cal.editBlockOpen}
        blockId={cal.editBlockId}
        timeZone={timeZone}
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
        onClose={cal.closeManagement}
        onSetKey={(k) => cal.setManagementKey(k)}
        onPickEvent={(ev) => {
          cal.closeManagement()
          cal.openBookingOrBlock(ev.id)
        }}
        onCreateBlockNow={() => {
          cal.closeManagement()
          cal.openCreateBlockNow()
        }}
        onBlockFullDayToday={() => {
          cal.closeManagement()
          void cal.oneClickBlockFullDay(new Date())
        }}
        onApproveBookingId={(bookingId: string) => void cal.approveBookingById(bookingId)}
        onDenyBookingId={(bookingId: string) => void cal.denyBookingById(bookingId)}
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
        timeZone={timeZone}
        reschedDate={cal.reschedDate}
        reschedTime={cal.reschedTime}
        durationMinutes={cal.durationMinutes}
        selectedServiceId={cal.selectedServiceId}
        notifyClient={cal.notifyClient}
        allowOutsideHours={cal.allowOutsideHours}
        editOutside={cal.editOutside}
        saving={cal.savingReschedule}
        onClose={cal.closeBooking}
        onChangeReschedDate={cal.setReschedDate}
        onChangeReschedTime={cal.setReschedTime}
        onChangeDurationMinutes={cal.setDurationMinutes}
        onChangeSelectedServiceId={cal.setSelectedServiceId}
        onToggleNotifyClient={cal.setNotifyClient}
        onToggleAllowOutsideHours={cal.setAllowOutsideHours}
        onSave={() => void cal.submitChanges()}
        onApprove={() => void cal.approveBooking()}
        onDeny={() => void cal.denyBooking()}
      />
    </main>
  )
}
