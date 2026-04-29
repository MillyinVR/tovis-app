// app/pro/calendar/ProCalendarClientPage.tsx
'use client'

import { useMemo, useState } from 'react'

import BlockTimeModal from './_components/BlockTimeModal'
import EditBlockModal from './_components/EditBlockModal'

import { BookingModal } from './_components/BookingModal'
import { CalendarDesktopShell } from './_components/CalendarDesktopShell'
import { CalendarMobileShell } from './_components/CalendarMobileShell'
import { CalendarTabletShell } from './_components/CalendarTabletShell'
import { ConfirmChangeModal } from './_components/ConfirmChangeModal'
import { ManagementModal } from './_components/ManagementModal'

import { useCalendarData } from './_hooks/useCalendarData'
import { useCalendarNavigation } from './_hooks/useCalendarNavigation'

import { DEFAULT_CALENDAR_VIEW } from './_constants'

import {
  anchoredCalendarDate,
  bookingActionId,
  calendarHeaderLabelForView,
  calendarTitleForView,
  firstPendingBooking,
  mobileCalendarSubtitleFor,
  safeCalendarTimeZone,
  todayWeekdayLabel,
  validTimeZoneOrFallback,
  visibleDaysForCalendarView,
} from './_viewModel/proCalendarDisplay'

import type { ViewMode } from './_types'
import type { BrandProCalendarCopy } from '@/lib/brand/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type ProCalendarClientPageProps = {
  copy: BrandProCalendarCopy
}

// ─── Exported client page ─────────────────────────────────────────────────────

export function ProCalendarClientPage(props: ProCalendarClientPageProps) {
  const { copy } = props

  const [view, setView] = useState<ViewMode>(DEFAULT_CALENDAR_VIEW)
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date())

  const cal = useCalendarData({ view, currentDate })

  const calendarTimeZone = useMemo(
    () => safeCalendarTimeZone(cal.timeZone),
    [cal.timeZone],
  )

  const activeLocationTimeZone = useMemo(
    () =>
      validTimeZoneOrFallback(
        cal.activeLocation?.timeZone,
        calendarTimeZone,
      ),
    [cal.activeLocation?.timeZone, calendarTimeZone],
  )

  const bookingModalTimeZone = useMemo(
    () => safeCalendarTimeZone(cal.booking?.timeZone ?? calendarTimeZone),
    [cal.booking?.timeZone, calendarTimeZone],
  )

  const anchoredCurrentDate = useMemo(
    () => anchoredCalendarDate(currentDate, calendarTimeZone),
    [calendarTimeZone, currentDate],
  )

  const { goToToday, goBack, goNext } = useCalendarNavigation({
    view,
    timeZone: calendarTimeZone,
    setCurrentDate,
  })

  const visibleDays = useMemo(
    () =>
      visibleDaysForCalendarView({
        view,
        anchoredCurrentDate,
        timeZone: calendarTimeZone,
      }),
    [anchoredCurrentDate, calendarTimeZone, view],
  )

  const headerLabel = useMemo(
    () =>
      calendarHeaderLabelForView(
        view,
        anchoredCurrentDate,
        calendarTimeZone,
      ),
    [anchoredCurrentDate, calendarTimeZone, view],
  )

  const sidebarTodayLabel = useMemo(
    () => todayWeekdayLabel(calendarTimeZone),
    [calendarTimeZone],
  )

  const mobileSubtitle = useMemo(
    () =>
      mobileCalendarSubtitleFor({
        date: anchoredCurrentDate,
        timeZone: calendarTimeZone,
        activeLocationLabel: cal.activeLocationLabel,
      }),
    [anchoredCurrentDate, calendarTimeZone, cal.activeLocationLabel],
  )

  const showInitialLoading = cal.loading && cal.events.length === 0
  const showReloadLoading = cal.loading && cal.events.length > 0

  const topPendingRequest = useMemo(
    () => firstPendingBooking(cal.management.pendingRequests),
    [cal.management.pendingRequests],
  )

  const topPendingBookingId = useMemo(
    () => bookingActionId(topPendingRequest),
    [topPendingRequest],
  )

  const viewTitle = useMemo(
    () => calendarTitleForView(view, copy.titles),
    [copy.titles, view],
  )

  return (
    <main className="brand-pro-calendar-page">
      <CalendarMobileShell
        copy={copy}
        view={view}
        setView={setView}
        currentDate={currentDate}
        setCurrentDate={setCurrentDate}
        calendarTimeZone={calendarTimeZone}
        headerLabel={headerLabel}
        title={viewTitle}
        subtitle={mobileSubtitle}
        visibleDays={visibleDays}
        showInitialLoading={showInitialLoading}
        showReloadLoading={showReloadLoading}
        onToday={goToToday}
        onBack={goBack}
        onNext={goNext}
        topPendingRequest={topPendingRequest}
        topPendingBookingId={topPendingBookingId}
        cal={cal}
      />

      <CalendarTabletShell
        copy={copy}
        view={view}
        setView={setView}
        currentDate={currentDate}
        setCurrentDate={setCurrentDate}
        calendarTimeZone={calendarTimeZone}
        headerLabel={headerLabel}
        title={viewTitle}
        visibleDays={visibleDays}
        showInitialLoading={showInitialLoading}
        showReloadLoading={showReloadLoading}
        onToday={goToToday}
        onBack={goBack}
        onNext={goNext}
        cal={cal}
      />

      <CalendarDesktopShell
        copy={copy}
        view={view}
        setView={setView}
        currentDate={currentDate}
        setCurrentDate={setCurrentDate}
        calendarTimeZone={calendarTimeZone}
        headerLabel={headerLabel}
        title={viewTitle}
        sidebarTodayLabel={sidebarTodayLabel}
        visibleDays={visibleDays}
        showInitialLoading={showInitialLoading}
        showReloadLoading={showReloadLoading}
        onToday={goToToday}
        onBack={goBack}
        onNext={goNext}
        cal={cal}
      />

      <BlockTimeModal
        open={cal.blockCreateOpen}
        onClose={() => cal.setBlockCreateOpen(false)}
        initialStart={cal.blockCreateInitialStart}
        timeZone={activeLocationTimeZone}
        locationId={cal.activeLocationId}
        locationLabel={cal.activeLocationLabel}
        stepMinutes={cal.activeStepMinutes}
        onCreated={cal.reload}
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
        onSaved={cal.reload}
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
        onApproveBookingId={(bookingId) => {
          void cal.approveBookingById(bookingId)
        }}
        onDenyBookingId={(bookingId) => {
          void cal.denyBookingById(bookingId)
        }}
        actionBusyId={cal.managementActionBusyId}
        actionError={cal.managementActionError}
      />

      <ConfirmChangeModal
        open={cal.confirmOpen}
        change={cal.pendingChange}
        applying={cal.applyingChange}
        outsideWorkingHours={cal.pendingOutsideWorkingHours}
        overrideReason={cal.overrideReason}
        onChangeOverrideReason={cal.setOverrideReason}
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
        onSave={() => {
          void cal.submitChanges()
        }}
        onApprove={() => {
          void cal.approveBooking()
        }}
        onDeny={() => {
          void cal.denyBooking()
        }}
      />
    </main>
  )
}