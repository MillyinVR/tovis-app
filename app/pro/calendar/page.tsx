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

import { DEFAULT_TIME_ZONE, sanitizeTimeZone, startOfDayUtcInTimeZone } from '@/lib/timeZone'

function safeTz(raw: unknown) {
  return sanitizeTimeZone(typeof raw === 'string' ? raw : '', DEFAULT_TIME_ZONE)
}

function headerLabelFor(view: ViewMode, anchorUtc: Date, tz: string) {
  if (view === 'day') return formatDayLabelInTimeZone(anchorUtc, tz)
  if (view === 'week') return formatWeekRangeInTimeZone(anchorUtc, tz)
  return formatMonthRangeInTimeZone(anchorUtc, tz)
}

function labelForLocation(l: {
  id: string
  type?: string | null
  name?: string | null
  formattedAddress?: string | null
}) {
  const t = String(l.type || '').toUpperCase()
  const base =
    (l.name && l.name.trim()) ||
    (t === 'MOBILE_BASE' ? 'Mobile base' : t === 'SUITE' ? 'Suite' : t === 'SALON' ? 'Salon' : 'Location')

  const addr = l.formattedAddress && l.formattedAddress.trim() ? ` — ${l.formattedAddress.trim()}` : ''
  return `${base}${addr}`
}

export default function ProCalendarPage() {
  const [view, setView] = useState<ViewMode>('week')
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date())

  const cal = useCalendarData({ view, currentDate })

  const timeZone = useMemo(() => safeTz(cal.timeZone), [cal.timeZone])

  const didBootRef = useRef(false)
  const booted = didBootRef.current

  useEffect(() => {
    if (didBootRef.current) return
    if (cal.loading) return

    didBootRef.current = true
    setCurrentDate(anchorNoonInTimeZone(new Date(), timeZone))
  }, [cal.loading, timeZone])

  const visibleDays = useMemo(() => {
    const tz = timeZone

    if (view === 'day') {
      const startUtc = startOfDayUtcInTimeZone(currentDate, tz)
      return [startUtc]
    }

    if (view === 'week') {
      const weekStartNoon = startOfWeekAnchorNoonInTimeZone(currentDate, tz)
      const weekStartDayStartUtc = startOfDayUtcInTimeZone(weekStartNoon, tz)
      return Array.from({ length: 7 }, (_, i) => new Date(weekStartDayStartUtc.getTime() + i * 24 * 60 * 60_000))
    }

    const monthStartNoon = startOfMonthAnchorNoonInTimeZone(currentDate, tz)
    const firstWeekNoon = startOfWeekAnchorNoonInTimeZone(monthStartNoon, tz)
    const firstGridDayStartUtc = startOfDayUtcInTimeZone(firstWeekNoon, tz)

    return Array.from({ length: 42 }, (_, i) => new Date(firstGridDayStartUtc.getTime() + i * 24 * 60 * 60_000))
  }, [view, currentDate, timeZone])

  const headerLabel = useMemo(() => headerLabelFor(view, currentDate, timeZone), [view, currentDate, timeZone])

  const hasLocations = Boolean(
    cal.locationsLoaded && Array.isArray(cal.scopedLocations) && cal.scopedLocations.length > 0,
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

      {cal.locationsLoaded && (
        <section className="mb-4">
          <div className="tovis-glass-soft tovis-noise rounded-2xl border border-white/10 px-4 py-4 md:px-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-[12px] font-black text-textSecondary">Calendar location</div>
                <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                  Clients are limited to working hours. Pros can schedule outside hours when needed.
                </div>
              </div>

              {hasLocations ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={cal.activeLocationId ?? ''}
                    onChange={(e) => cal.setActiveLocationId(e.target.value || null)}
                    className="rounded-2xl border border-white/12 bg-bgPrimary/30 px-3 py-2 text-[13px] font-bold text-textPrimary outline-none"
                    aria-label="Select calendar location"
                  >
                    {cal.scopedLocations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {labelForLocation(l)}
                      </option>
                    ))}
                  </select>

                  <div className="text-[12px] font-semibold text-textSecondary">
                    TZ: <span className="font-black text-textPrimary">{timeZone}</span>
                  </div>
                </div>
              ) : (
                <div className="text-[12px] font-semibold text-toneWarn">
                  No bookable locations yet. Add a location to use the calendar.
                </div>
              )}
            </div>

            {cal.activeLocationLabel ? (
              <div className="mt-3 text-[12px] font-semibold text-textSecondary">
                Viewing: <span className="font-black text-textPrimary">{cal.activeLocationLabel}</span>
              </div>
            ) : null}
          </div>
        </section>
      )}

      {cal.showHoursForm && (
        <section className="mb-4">
          <div className="tovis-glass-soft tovis-noise border border-white/10 px-4 py-4 md:px-5">
            <WorkingHoursTabs
              canSalon={Boolean(cal.canSalon)}
              canMobile={Boolean(cal.canMobile)}
              activeLocationType={cal.activeLocationType}
              onChangeLocationType={(next) => cal.setActiveLocationType(next)}
              onSavedAny={() => cal.reload()}
            />
          </div>
        </section>
      )}

      <CalendarHeaderControls
        view={view}
        setView={setView}
        headerLabel={headerLabel}
        onToday={() => {
          const next = anchorNoonInTimeZone(new Date(), timeZone)
          setCurrentDate(next)
          didBootRef.current = true
        }}
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

      {!booted && (
        <div className="mb-3 tovis-glass-soft tovis-noise rounded-2xl border border-white/10 px-4 py-6 text-sm text-textSecondary">
          Loading calendar…
        </div>
      )}

      {booted && cal.loading && (
        <div className="mb-3 tovis-glass-soft tovis-noise rounded-2xl border border-white/10 px-4 py-3 text-sm text-textSecondary">
          Loading…
        </div>
      )}

      {cal.error && (
        <div className="mb-3 tovis-glass-soft tovis-noise rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-toneDanger">
          {cal.error}
        </div>
      )}

      {(view === 'day' || view === 'week') && booted && (
        <DayWeekGrid
          view={view}
          visibleDays={visibleDays}
          events={cal.events}
          workingHoursSalon={cal.workingHoursSalon}
          workingHoursMobile={cal.workingHoursMobile}
          activeLocationType={cal.activeLocationType}
          timeZone={timeZone}
          onClickEvent={cal.openBookingOrBlock}
          onCreateForClick={cal.openCreateForClick}
          onDragStart={cal.drag.onDragStart}
          onDropOnDayColumn={cal.drag.onDropOnDayColumn}
          onBeginResize={cal.resize.beginResize}
          suppressClickRef={cal.ui.suppressClickRef}
          isBusy={cal.ui.isOverlayOpen}
        />
      )}

      {view === 'month' && booted && (
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

      <CreateBookingModal
        open={cal.createOpen}
        onClose={() => cal.setCreateOpen(false)}
        workingHours={cal.workingHoursActive}
        initialStart={cal.createInitialStart}
        timeZone={timeZone}
        services={cal.services}
        onCreated={() => cal.reload()}
        locationId={cal.activeLocationId ?? ''}
        locationType={cal.activeLocationType}
        locationLabel={cal.activeLocationLabel}
        stepMinutes={cal.activeLocation?.stepMinutes ?? undefined}
      />

      <BlockTimeModal
        open={cal.blockCreateOpen}
        onClose={() => cal.setBlockCreateOpen(false)}
        initialStart={cal.blockCreateInitialStart}
        timeZone={timeZone}
        locationId={cal.activeLocationId}
        locationLabel={cal.activeLocationLabel}
        stepMinutes={cal.activeLocation?.stepMinutes ?? undefined}
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
        bookingServiceLabel={cal.bookingServiceLabel}
        serviceItemsDraft={cal.serviceItemsDraft}
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
        selectedDraftServiceIds={cal.selectedDraftServiceIds}
        hasDraftServiceItemsChanges={cal.hasDraftServiceItemsChanges}
        onChangeSelectedDraftServiceIds={cal.setDraftServiceIds}
        onToggleNotifyClient={cal.setNotifyClient}
        onToggleAllowOutsideHours={cal.setAllowOutsideHours}
        onSave={() => void cal.submitChanges()}
        onApprove={() => void cal.approveBooking()}
        onDeny={() => void cal.denyBooking()}
      />
    </main>
  )
}