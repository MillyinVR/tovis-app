// app/pro/calendar/page.tsx
'use client'

import { useMemo, useState } from 'react'
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
import { addDays, formatMonthRange, formatWeekRange, startOfDay } from './_utils/date'

function pickTimeZone(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : 'America/Los_Angeles'
}

export default function ProCalendarPage() {
  const [view, setView] = useState<ViewMode>('week')
  const [currentDate, setCurrentDate] = useState<Date>(new Date())

  const cal = useCalendarData({ view, currentDate })
  const timeZone = pickTimeZone(cal.timeZone)

  const visibleDays = useMemo(() => {
    if (view === 'day') return [startOfDay(currentDate)]

    if (view === 'week') {
      const start = cal.utils.startOfWeek(currentDate)
      return Array.from({ length: 7 }, (_, i) => addDays(start, i))
    }

    const first = cal.utils.startOfMonth(currentDate)
    const firstWeekStart = cal.utils.startOfWeek(first)
    return Array.from({ length: 42 }, (_, i) => addDays(firstWeekStart, i))
  }, [view, currentDate, cal.utils])

  const headerLabel =
    view === 'month'
      ? formatMonthRange(currentDate)
      : view === 'week'
        ? formatWeekRange(currentDate)
        : currentDate.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })

  return (
    <main className="mx-auto max-w-275 px-4 pb-10 pt-6 font-sans text-textPrimary md:pt-10">
      {/* ✅ unified “glass header” rhythm */}
      <CalendarHeader />

      {/* ✅ management strip already good; sits as a glass section */}
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

      {/* ✅ working hours editor becomes a proper panel */}
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

      {/* ✅ controls are now glass, mobile-stacked */}
      <CalendarHeaderControls
        view={view}
        setView={setView}
        headerLabel={headerLabel}
        onToday={() => setCurrentDate(new Date())}
        onBack={() => {
          if (view === 'day') setCurrentDate((d) => addDays(d, -1))
          else if (view === 'week') setCurrentDate((d) => addDays(d, -7))
          else setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, d.getDate()))
        }}
        onNext={() => {
          if (view === 'day') setCurrentDate((d) => addDays(d, 1))
          else if (view === 'week') setCurrentDate((d) => addDays(d, 7))
          else setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()))
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
          onPickDay={(d) => {
            setCurrentDate(d)
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
