// app/pro/calendar/ProCalendarClientPage.tsx
'use client'

import { useCallback, useMemo, useState } from 'react'

import BlockTimeModal from './_components/BlockTimeModal'
import EditBlockModal from './_components/EditBlockModal'

import { BookingModal } from './_components/BookingModal'
import { BookingOverrideConfirmModal } from './_components/BookingOverrideConfirmModal'
import { CalendarCreateSheet } from './_components/CalendarCreateSheet'
import { CalendarDesktopShell } from './_components/CalendarDesktopShell'
import { CalendarMobileShell } from './_components/CalendarMobileShell'
import { CalendarTabletShell } from './_components/CalendarTabletShell'
import { ConfirmChangeModal } from './_components/ConfirmChangeModal'
import { ManagementModal } from './_components/ManagementModal'
import WaitlistOfferModal from './_components/WaitlistOfferModal'

import { useCalendarData } from './_hooks/useCalendarData'
import { useCalendarNavigation } from './_hooks/useCalendarNavigation'

import { isBlockedEvent } from './_utils/calendarMath'

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

import type { CalendarEvent, ManagementLists, ViewMode } from './_types'
import type { BrandProCalendarCopy } from '@/lib/brand/types'

import { formatInTimeZone } from '@/lib/time'

// ─── Types ────────────────────────────────────────────────────────────────────

type ProCalendarClientPageProps = {
  copy: BrandProCalendarCopy
}

// ─── Management-scope helpers ───────────────────────────────────────────────────

/** Noun for the calendar's current range, used in the management sheet copy. */
function rangeScopeWordForView(view: ViewMode): string {
  if (view === 'week') return 'week'
  if (view === 'month') return 'month'
  return 'day'
}

/**
 * A booking that occupies the schedule (anything the calendar shows that isn't a
 * pending request, which has its own tab). Waitlist rows never enter `events`.
 */
function isScheduledBookingEvent(event: CalendarEvent): boolean {
  return (
    event.kind === 'BOOKING' &&
    String(event.status).trim().toUpperCase() !== 'PENDING'
  )
}

// ─── Exported client page ─────────────────────────────────────────────────────

export function ProCalendarClientPage(props: ProCalendarClientPageProps) {
  const { copy } = props

  const [view, setView] = useState<ViewMode>(DEFAULT_CALENDAR_VIEW)
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date())

  const cal = useCalendarData({ view, currentDate })

  // Waitlist "Offer a time" modal: the event whose client we're offering a slot.
  const [offerEvent, setOfferEvent] = useState<CalendarEvent | null>(null)

  const calendarTimeZone = useMemo(
    () => safeCalendarTimeZone(cal.timeZone),
    [cal.timeZone],
  )

  // v1 offers are in-salon only, so anchor them to the pro's salon/suite location
  // (prefer the primary). null when the pro has no bookable salon location.
  const offerSalonLocation = useMemo(
    () =>
      (cal.locations ?? [])
        .filter(
          (location) =>
            location.isBookable &&
            (location.type === 'SALON' || location.type === 'SUITE'),
        )
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0] ?? null,
    [cal.locations],
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

  // Dismissal is keyed to the current set of pending requests, so the bar
  // returns as soon as a new request arrives or the set changes.
  const pendingRequestsKey = useMemo(
    () => cal.management.pendingRequests.map((event) => event.id).join('|'),
    [cal.management.pendingRequests],
  )

  const [dismissedPendingKey, setDismissedPendingKey] = useState<
    string | null
  >(null)

  const pendingBarDismissed =
    pendingRequestsKey.length > 0 && dismissedPendingKey === pendingRequestsKey

  const dismissPendingBar = useCallback(() => {
    setDismissedPendingKey(pendingRequestsKey)
  }, [pendingRequestsKey])

  const viewTitle = useMemo(
    () => calendarTitleForView(view, copy.titles),
    [copy.titles, view],
  )

  // The "Booked" and "Blocked" tabs reflect the timeframe the calendar is on
  // (day/week/month), derived from the already-fetched range events, while
  // "Pending" and "Waitlist" stay global (all requests / all waitlist clients).
  const managementForModal = useMemo<ManagementLists>(
    () => ({
      ...cal.management,
      todaysBookings: cal.events.filter(isScheduledBookingEvent),
      blockedToday: cal.events.filter(isBlockedEvent),
    }),
    [cal.management, cal.events],
  )

  // Heading for the click-to-create choice sheet, stamped with the clicked
  // slot so the pro can confirm the click landed on the intended time.
  const createChoiceHeading = useMemo(() => {
    if (!cal.createChoiceStart) return copy.actions.createMenu

    const timeLabel = formatInTimeZone(
      cal.createChoiceStart,
      activeLocationTimeZone,
      {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      },
    )

    return `${copy.actions.createMenu} · ${timeLabel}`
  }, [activeLocationTimeZone, cal.createChoiceStart, copy.actions.createMenu])

  const managementCopyOverride = useMemo(() => {
    const scopeWord = rangeScopeWordForView(view)

    return {
      tabs: {
        todaysBookings: {
          title: `Booked · ${headerLabel}`,
          shortTitle: 'Booked',
          description: `Appointments on your schedule for the selected ${scopeWord}.`,
          emptyTitle: 'No booked appointments.',
          emptyBody: `Nothing is on your schedule for the selected ${scopeWord}.`,
        },
        blockedToday: {
          title: `Blocked time · ${headerLabel}`,
          description: `Personal time you've blocked off for the selected ${scopeWord}.`,
          emptyTitle: 'No blocked time.',
          emptyBody: `Use block time to protect breaks or close off the ${scopeWord}.`,
        },
      },
    }
  }, [headerLabel, view])

  return (
    <main className="brand-pro-calendar-page">
      {/* Calendar-level errors (failed loads, rejected drag-reschedules) land in
          cal.error; without this toast a rejected move just snaps back silently. */}
      {cal.error ? (
        <div
          role="alert"
          className="fixed inset-x-0 top-4 z-70 mx-auto w-fit max-w-[92vw] rounded-card border border-toneDanger/30 bg-bgSecondary px-4 py-2.5 text-[13px] font-semibold text-toneDanger shadow-lg"
        >
          {cal.error}
        </div>
      ) : null}

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
        pendingBarDismissed={pendingBarDismissed}
        onDismissPendingBar={dismissPendingBar}
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
        pendingBarDismissed={pendingBarDismissed}
        onDismissPendingBar={dismissPendingBar}
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
        pendingBarDismissed={pendingBarDismissed}
        onDismissPendingBar={dismissPendingBar}
        cal={cal}
      />

      <CalendarCreateSheet
        open={cal.createChoiceStart !== null}
        onClose={cal.closeCreateChoice}
        heading={createChoiceHeading}
        appointmentLabel={copy.actions.addAppointment}
        appointmentHint={copy.actions.addAppointmentHint}
        blockLabel={copy.actions.blockPersonalTime}
        blockHint={copy.actions.blockPersonalTimeHint}
        onAddAppointment={cal.chooseCreateAppointment}
        onBlockTime={cal.chooseCreateBlock}
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
        management={managementForModal}
        copy={managementCopyOverride}
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
        onOfferTime={
          offerSalonLocation && cal.professionalId
            ? (event) => {
                cal.closeManagement()
                setOfferEvent(event)
              }
            : undefined
        }
        actionBusyId={cal.managementActionBusyId}
        actionError={cal.managementActionError}
      />

      {offerEvent &&
      offerEvent.kind === 'BOOKING' &&
      offerEvent.waitlistEntryId &&
      offerEvent.serviceId &&
      offerSalonLocation &&
      cal.professionalId ? (
        <WaitlistOfferModal
          open
          onClose={() => setOfferEvent(null)}
          professionalId={cal.professionalId}
          waitlistEntryId={offerEvent.waitlistEntryId}
          serviceId={offerEvent.serviceId}
          offeringId={offerEvent.offeringId ?? null}
          locationId={offerSalonLocation.id}
          timeZone={validTimeZoneOrFallback(
            offerSalonLocation.timeZone,
            calendarTimeZone,
          )}
          clientName={offerEvent.clientName}
          serviceName={offerEvent.details.serviceName}
          onOffered={() => {
            setOfferEvent(null)
            void cal.reload()
          }}
        />
      ) : null}

      <ConfirmChangeModal
        open={cal.confirmOpen}
        change={cal.pendingChange}
        applying={cal.applyingChange}
        outsideWorkingHours={cal.pendingOutsideWorkingHours}
        overlapName={cal.pendingOverlapName}
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
        onStartSession={() => {
          void cal.startSession()
        }}
      />

      <BookingOverrideConfirmModal
        open={Boolean(cal.bookingOverridePrompt)}
        prompt={cal.bookingOverridePrompt}
        intent={cal.bookingOverrideIntent}
        busy={cal.savingReschedule}
        reason={cal.bookingOverrideReason}
        onChangeReason={cal.setBookingOverrideReason}
        onCancel={cal.cancelBookingOverride}
        onConfirm={() => {
          void cal.confirmBookingOverride()
        }}
      />

      <BookingOverrideConfirmModal
        open={Boolean(cal.changeOverridePrompt)}
        prompt={cal.changeOverridePrompt}
        intent="edit"
        busy={cal.applyingChange}
        reason={cal.changeOverrideReason}
        onChangeReason={cal.setChangeOverrideReason}
        onCancel={cal.cancelChangeOverride}
        onConfirm={() => {
          void cal.confirmChangeOverride()
        }}
      />

      <BookingOverrideConfirmModal
        open={Boolean(cal.managementOverridePrompt)}
        prompt={cal.managementOverridePrompt}
        busy={cal.managementOverrideBusy}
        reason={cal.managementOverrideReason}
        onChangeReason={cal.setManagementOverrideReason}
        onCancel={cal.cancelManagementOverride}
        onConfirm={() => {
          void cal.confirmManagementOverride()
        }}
      />
    </main>
  )
}