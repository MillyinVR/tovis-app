// app/pro/calendar/page.tsx
'use client'

import { useMemo, useState } from 'react'
import WorkingHoursForm from './WorkingHoursForm'
import CreateBookingModal from './CreateBookingModal'
import BlockTimeModal from './BlockTimeModal'
import EditBlockModal from './EditBlockModal'

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

export default function ProCalendarPage() {
  const [view, setView] = useState<ViewMode>('week')
  const [currentDate, setCurrentDate] = useState<Date>(new Date())

  const cal = useCalendarData({ view, currentDate })

  const blockedMinutesToday =
    typeof (cal as any)?.blockedMinutesToday === 'number' ? ((cal as any).blockedMinutesToday as number) : 0

  const timeZone =
    typeof (cal as any)?.timeZone === 'string' && (cal as any).timeZone.trim()
      ? ((cal as any).timeZone as string)
      : 'America/Los_Angeles'

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
    <main className="mx-auto mt-10 max-w-275 px-4 font-sans text-textPrimary">
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
        <div className="mb-4 rounded-2xl border border-white/10 bg-bgSecondary p-4">
          <WorkingHoursForm initialHours={cal.workingHours} onSaved={cal.setWorkingHours} />
        </div>
      )}

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

      {cal.loading && <div className="mb-2 text-sm text-textSecondary">Loading…</div>}
      {cal.error && <div className="mb-2 text-sm text-red-400">{cal.error}</div>}

      {(view === 'day' || view === 'week') && (
        <DayWeekGrid
          view={view}
          visibleDays={visibleDays}
          events={cal.events}
          workingHours={cal.workingHours}
          timeZone={cal.timeZone}  // ✅ THIS is what TS is yelling about
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

      <CreateBookingModal
        open={cal.createOpen}
        onClose={() => cal.setCreateOpen(false)}
        workingHours={cal.workingHours}
        initialStart={cal.createInitialStart}
        services={cal.services}
        onCreated={() => cal.reload()}
      />

      <BlockTimeModal
        open={cal.blockCreateOpen}
        onClose={() => cal.setBlockCreateOpen(false)}
        initialStart={cal.blockCreateInitialStart}
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
        onSetKey={cal.setManagementKey}
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
