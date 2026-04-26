// app/pro/calendar/page.tsx
'use client'

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import BlockTimeModal from './BlockTimeModal'
import EditBlockModal from './EditBlockModal'
import WorkingHoursTabs from './WorkingHoursTabs'

import { useCalendarData } from './_hooks/useCalendarData'
import { useCalendarNavigation } from './_hooks/useCalendarNavigation'

import { BookingModal } from './_components/BookingModal'
import { CalendarHeaderControls } from './_components/CalendarHeader'
import { CalendarLocationPanel } from './_components/CalendarLocationPanel'
import { CalendarStatsPanel } from './_components/CalendarStatsPanel'
import { ConfirmChangeModal } from './_components/ConfirmChangeModal'
import { DayWeekGrid } from './_components/DayWeekGrid'
import { ManagementModal } from './_components/ManagementModal'
import { MobileAutoAcceptBar } from './_components/MobileAutoAcceptBar'
import { MobileCalendarControls } from './_components/MobileCalendarControls'
import { MobileCalendarFab } from './_components/MobileCalendarFab'
import { MobileCalendarHeader } from './_components/MobileCalendarHeader'
import { MobileMonthGrid } from './_components/MobileMonthGrid'
import { MobilePendingRequestBar } from './_components/MobilePendingRequestBar'
import { MonthGrid } from './_components/MonthGrid'

import type { CalendarEvent, ViewMode } from './_types'

import {
  addDaysAnchorNoonInTimeZone,
  anchorNoonInTimeZone,
  formatDayLabelInTimeZone,
  formatMonthRangeInTimeZone,
  formatWeekRangeInTimeZone,
  startOfMonthAnchorNoonInTimeZone,
  startOfWeekAnchorNoonInTimeZone,
} from './_utils/date'

import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  sanitizeTimeZone,
  startOfDayUtcInTimeZone,
} from '@/lib/timeZone'

// ─── Types ────────────────────────────────────────────────────────────────────

type StatTone = 'paper' | 'terra' | 'pending' | 'acid' | 'fern' | 'muted'

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEK_DAY_COUNT = 7
const MONTH_GRID_DAY_COUNT = 42
const DEFAULT_CALENDAR_VIEW: ViewMode = 'day'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function safeTz(value: unknown): string {
  return sanitizeTimeZone(
    typeof value === 'string' ? value : '',
    DEFAULT_TIME_ZONE,
  )
}

function validTimeZoneOrFallback(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback

  const candidate = value.trim()

  if (!candidate || !isValidIanaTimeZone(candidate)) {
    return fallback
  }

  return sanitizeTimeZone(candidate, fallback)
}

function headerLabelFor(
  view: ViewMode,
  anchorUtc: Date,
  timeZone: string,
): string {
  if (view === 'day') return formatDayLabelInTimeZone(anchorUtc, timeZone)
  if (view === 'week') return formatWeekRangeInTimeZone(anchorUtc, timeZone)

  return formatMonthRangeInTimeZone(anchorUtc, timeZone)
}

function titleForView(view: ViewMode): string {
  if (view === 'day') return 'Your day.'
  if (view === 'month') return 'This month.'

  return 'This week.'
}

function visibleDaysForView(args: {
  view: ViewMode
  anchoredCurrentDate: Date
  timeZone: string
}): Date[] {
  const { view, anchoredCurrentDate, timeZone } = args

  if (view === 'day') {
    return [startOfDayUtcInTimeZone(anchoredCurrentDate, timeZone)]
  }

  if (view === 'week') {
    const weekStartNoon = startOfWeekAnchorNoonInTimeZone(
      anchoredCurrentDate,
      timeZone,
    )

    return Array.from({ length: WEEK_DAY_COUNT }, (_, index) => {
      const dayNoon = addDaysAnchorNoonInTimeZone(
        weekStartNoon,
        index,
        timeZone,
      )

      return startOfDayUtcInTimeZone(dayNoon, timeZone)
    })
  }

  const monthStartNoon = startOfMonthAnchorNoonInTimeZone(
    anchoredCurrentDate,
    timeZone,
  )

  const firstGridDayNoon = startOfWeekAnchorNoonInTimeZone(
    monthStartNoon,
    timeZone,
  )

  return Array.from({ length: MONTH_GRID_DAY_COUNT }, (_, index) => {
    const dayNoon = addDaysAnchorNoonInTimeZone(
      firstGridDayNoon,
      index,
      timeZone,
    )

    return startOfDayUtcInTimeZone(dayNoon, timeZone)
  })
}

function toneDotClass(tone: StatTone): string {
  switch (tone) {
    case 'terra':
      return 'bg-terra shadow-[0_0_14px_rgb(var(--terra-glow)_/_0.65)]'
    case 'pending':
      return 'bg-amber shadow-[0_0_10px_rgb(var(--amber)_/_0.75)]'
    case 'acid':
      return 'bg-acid shadow-[0_0_14px_rgb(var(--acid)_/_0.45)]'
    case 'fern':
      return 'bg-fern shadow-[0_0_14px_rgb(var(--fern)_/_0.65)]'
    case 'muted':
      return 'bg-paperMute'
    case 'paper':
    default:
      return 'bg-paper'
  }
}

function todayWeekdayLabel(timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'long',
  }).format(new Date())
}

function bookingActionId(event: CalendarEvent | undefined): string | null {
  if (!event || event.kind !== 'BOOKING') return null

  return event.id
}

function firstPendingBooking(events: CalendarEvent[]): CalendarEvent | undefined {
  return events.find((event) => event.kind === 'BOOKING')
}

function mobileSubtitleFor(args: {
  date: Date
  timeZone: string
  activeLocationLabel: string | null
}): string {
  const { date, timeZone, activeLocationLabel } = args

  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(undefined, { timeZone, ...options })
      .format(date)
      .toUpperCase()

  const parts = [
    format({ weekday: 'short' }),
    format({ month: 'short', day: 'numeric' }),
  ]

  const locationName = activeLocationLabel?.split(' — ')[0]?.trim()

  if (locationName) {
    parts.push(locationName.toUpperCase())
  }

  return parts.join(' · ')
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProCalendarPage() {
  const [view, setView] = useState<ViewMode>(DEFAULT_CALENDAR_VIEW)
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date())

  const cal = useCalendarData({ view, currentDate })

  const calendarTimeZone = useMemo(() => safeTz(cal.timeZone), [cal.timeZone])

  const activeLocationTimeZone = useMemo(
    () =>
      validTimeZoneOrFallback(
        cal.activeLocation?.timeZone,
        calendarTimeZone,
      ),
    [cal.activeLocation?.timeZone, calendarTimeZone],
  )

  const bookingModalTimeZone = useMemo(
    () => safeTz(cal.booking?.timeZone ?? calendarTimeZone),
    [cal.booking?.timeZone, calendarTimeZone],
  )

  const anchoredCurrentDate = useMemo(
    () => anchorNoonInTimeZone(currentDate, calendarTimeZone),
    [calendarTimeZone, currentDate],
  )

  const { goToToday, goBack, goNext } = useCalendarNavigation({
    view,
    timeZone: calendarTimeZone,
    setCurrentDate,
  })

  const visibleDays = useMemo(
    () =>
      visibleDaysForView({
        view,
        anchoredCurrentDate,
        timeZone: calendarTimeZone,
      }),
    [anchoredCurrentDate, calendarTimeZone, view],
  )

  const headerLabel = useMemo(
    () => headerLabelFor(view, anchoredCurrentDate, calendarTimeZone),
    [anchoredCurrentDate, calendarTimeZone, view],
  )

  const sidebarTodayLabel = useMemo(
    () => todayWeekdayLabel(calendarTimeZone),
    [calendarTimeZone],
  )

  const mobileSubtitle = useMemo(
    () =>
      mobileSubtitleFor({
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

  const topPendingBookingId = bookingActionId(topPendingRequest)

  return (
    <main className="brand-pro-calendar-page">
      <div className="brand-pro-calendar-desktop-wrap">
        <PageHero />

        <section className="brand-pro-calendar-panel">
          <div className="md:hidden">
            <MobileCalendarHeader
              title={titleForView(view)}
              subtitle={mobileSubtitle}
            />

            <div className="px-5 pb-3">
              <CalendarStatsPanel
                stats={cal.stats}
                management={cal.management}
                blockedMinutesToday={cal.blockedMinutesToday}
                onOpenManagement={cal.openManagement}
                compact
              />
            </div>

            <div className="px-5 pb-3">
              <MobileCalendarControls
                view={view}
                setView={setView}
                headerLabel={headerLabel}
                onToday={goToToday}
                onBack={goBack}
                onNext={goNext}
              />
            </div>
          </div>

          <div className="hidden border-b border-[var(--line-strong)] px-7 py-5 md:flex md:flex-wrap md:items-end md:justify-between md:gap-4">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-terraGlow">
                ◆ Pro · {headerLabel}
              </p>

              <h2 className="mt-2 font-display text-[42px] font-semibold italic leading-none tracking-[-0.04em] text-paper">
                {titleForView(view)}
              </h2>
            </div>

            <CalendarHeaderControls
              view={view}
              setView={setView}
              headerLabel={headerLabel}
              onToday={goToToday}
              onBack={goBack}
              onNext={goNext}
              onBlockTime={cal.openCreateBlockNow}
            />
          </div>

          <div className="grid lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="hidden border-r border-[var(--line-strong)] p-5 lg:block">
              <p className="mb-4 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-paperMute">
                {sidebarTodayLabel} · Today
              </p>

              <CalendarStatsPanel
                stats={cal.stats}
                management={cal.management}
                blockedMinutesToday={cal.blockedMinutesToday}
                onOpenManagement={cal.openManagement}
              />

              <div className="mt-5">
                <CalendarLocationPanel
                  locationsLoaded={cal.locationsLoaded}
                  scopedLocations={cal.scopedLocations}
                  activeLocationId={cal.activeLocationId}
                  activeLocationLabel={cal.activeLocationLabel}
                  calendarTimeZone={calendarTimeZone}
                  onChangeLocation={cal.setActiveLocationId}
                />
              </div>

              <StatusLegend />

              <AutoAcceptCard
                enabled={cal.autoAccept}
                saving={cal.savingAutoAccept}
                onToggle={() => void cal.toggleAutoAccept(!cal.autoAccept)}
              />

              <div className="mt-4">
                <ActionButton
                  onClick={() => cal.setShowHoursForm((current) => !current)}
                  active={cal.showHoursForm}
                >
                  {cal.showHoursForm ? 'Hide hours' : 'Edit hours'}
                </ActionButton>
              </div>
            </aside>

            <section className="min-w-0">
              <MobileLocationBar
                locationsLoaded={cal.locationsLoaded}
                scopedLocations={cal.scopedLocations}
                activeLocationId={cal.activeLocationId}
                activeLocationLabel={cal.activeLocationLabel}
                onChangeLocation={cal.setActiveLocationId}
              />

              {cal.showHoursForm ? (
                <section className="border-b border-[var(--line-strong)] p-4 md:p-5">
                  <WorkingHoursTabs
                    canSalon={cal.canSalon}
                    canMobile={cal.canMobile}
                    activeEditorType={cal.hoursEditorLocationType}
                    onChangeEditorType={cal.setHoursEditorLocationType}
                    onSavedAny={cal.reload}
                  />
                </section>
              ) : null}

              <div className="p-0 md:p-5">
                <div className="px-4 pt-3 md:px-0 md:pt-0">
                  {showInitialLoading ? (
                    <StateBanner>Loading calendar…</StateBanner>
                  ) : null}

                  {showReloadLoading ? (
                    <StateBanner>Loading…</StateBanner>
                  ) : null}

                  {cal.error ? (
                    <StateBanner danger>{cal.error}</StateBanner>
                  ) : null}
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
                  <>
                    <MobileMonthGrid
                      visibleDays={visibleDays}
                      currentDate={currentDate}
                      events={cal.events}
                      timeZone={calendarTimeZone}
                      onPickDay={(date) => {
                        setCurrentDate(
                          anchorNoonInTimeZone(date, calendarTimeZone),
                        )
                        setView('day')
                      }}
                    />

                    <div className="hidden p-3 md:block md:p-0">
                      <MonthGrid
                        visibleDays={visibleDays}
                        currentDate={currentDate}
                        events={cal.events}
                        timeZone={calendarTimeZone}
                        onPickDay={(date) => {
                          setCurrentDate(
                            anchorNoonInTimeZone(date, calendarTimeZone),
                          )
                          setView('day')
                        }}
                      />
                    </div>
                  </>
                ) : null}
              </div>
            </section>
          </div>
        </section>
      </div>

      <MobileCalendarFab onClick={cal.openCreateBlockNow} />

      <MobileAutoAcceptBar
        enabled={cal.autoAccept}
        saving={cal.savingAutoAccept}
        onToggle={() => void cal.toggleAutoAccept(!cal.autoAccept)}
      />

      <MobilePendingRequestBar
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
        onApproveBookingId={(bookingId) =>
          void cal.approveBookingById(bookingId)
        }
        onDenyBookingId={(bookingId) => void cal.denyBookingById(bookingId)}
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
        onSave={() => void cal.submitChanges()}
        onApprove={() => void cal.approveBooking()}
        onDeny={() => void cal.denyBooking()}
      />
    </main>
  )
}

// ─── Page-level sub-components ────────────────────────────────────────────────

function PageHero() {
  return (
    <header className="mb-8 hidden flex-col gap-4 md:flex md:flex-row md:items-end md:justify-between">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-terraGlow">
          ◆ Pro mode
        </p>

        <h1 className="mt-2 font-display text-4xl font-semibold italic leading-none tracking-[-0.04em] text-paper md:text-5xl">
          tovis<span className="text-terra">.</span> / pro
        </h1>
      </div>

      <a
        href="/pro"
        className={[
          'font-mono text-xs font-black uppercase tracking-[0.10em]',
          'text-paperMute transition hover:text-paper',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
        ].join(' ')}
      >
        ← Pro dashboard
      </a>
    </header>
  )
}

function StatusLegend() {
  return (
    <div className="mt-6 border-t border-[var(--line)] pt-5">
      <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-paperMute">
        Status key
      </p>

      <div className="grid gap-2">
        <LegendRow tone="terra" label="Accepted" />
        <LegendRow tone="pending" label="Pending request" />
        <LegendRow tone="fern" label="Completed" />
        <LegendRow tone="acid" label="Waitlist hold" />
        <LegendRow tone="muted" label="Blocked / break" dashed />
      </div>
    </div>
  )
}

function LegendRow(props: {
  tone: StatTone
  label: string
  dashed?: boolean
}) {
  const { tone, label, dashed = false } = props

  return (
    <div className="flex items-center gap-2">
      <span
        className={[
          'h-1 w-5 rounded-full',
          dashed
            ? 'border border-dashed border-paperMute bg-transparent'
            : toneDotClass(tone),
        ].join(' ')}
        aria-hidden="true"
      />

      <span className="text-xs text-paperDim">{label}</span>
    </div>
  )
}

function AutoAcceptCard(props: {
  enabled: boolean
  saving: boolean
  onToggle: () => void
}) {
  const { enabled, saving, onToggle } = props

  return (
    <div className="mt-6 rounded-xl border border-[var(--line-strong)] bg-terra/5 p-3.5">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-terraGlow">
        ◆ Auto-accept
      </p>

      <p className="mt-2 text-xs leading-5 text-paperDim">
        New bookings that fit your hours skip the request step.
      </p>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span
          className={[
            'font-mono text-[11px] font-black uppercase tracking-[0.08em]',
            enabled ? 'text-fern' : 'text-paperMute',
          ].join(' ')}
        >
          {saving ? 'Saving…' : enabled ? 'On' : 'Off'}
        </span>

        <button
          type="button"
          onClick={onToggle}
          disabled={saving}
          className={[
            'relative h-6 w-11 rounded-full border border-[var(--line-strong)] transition',
            enabled ? 'bg-fern' : 'bg-paper/10',
            saving ? 'cursor-wait opacity-70' : '',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
          ].join(' ')}
          aria-pressed={enabled}
          aria-label={`Auto-accept is ${enabled ? 'on' : 'off'}`}
        >
          <span
            className={[
              'absolute top-0.5 h-5 w-5 rounded-full bg-paper transition-[left]',
              enabled ? 'left-[21px]' : 'left-0.5',
            ].join(' ')}
          />
        </button>
      </div>
    </div>
  )
}

function ActionButton(props: {
  children: ReactNode
  onClick: () => void
  active?: boolean
}) {
  const { children, onClick, active = false } = props

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-xl px-4 py-2 font-mono text-[11px] font-black uppercase tracking-[0.08em]',
        'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
        active
          ? 'border border-[var(--line-strong)] bg-paper text-ink'
          : 'border border-[var(--line-strong)] bg-transparent text-paper hover:bg-paper/5',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function MobileLocationBar(props: {
  locationsLoaded: boolean
  scopedLocations: Array<{
    id: string
    name?: string | null
    formattedAddress?: string | null
    type?: string | null
  }>
  activeLocationId: string | null
  activeLocationLabel: string | null
  onChangeLocation: (id: string | null) => void
}) {
  const {
    locationsLoaded,
    scopedLocations,
    activeLocationId,
    activeLocationLabel,
    onChangeLocation,
  } = props

  if (!locationsLoaded || scopedLocations.length <= 1) return null

  const displayLabel =
    activeLocationLabel?.trim() ||
    scopedLocations
      .find((location) => location.id === activeLocationId)
      ?.name?.trim() ||
    'Select location'

  return (
    <div
      className="flex items-center gap-2 border-b border-[var(--line-strong)] px-4 py-2.5 lg:hidden"
      data-mobile-location-bar="1"
    >
      <span className="font-mono text-[9px] font-black uppercase tracking-[0.14em] text-paperMute">
        Loc
      </span>

      <select
        value={activeLocationId ?? ''}
        onChange={(event) => onChangeLocation(event.target.value || null)}
        aria-label="Select calendar location"
        className={[
          'min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-ink2',
          'px-2.5 py-1.5 font-mono text-[10px] font-black uppercase tracking-[0.06em]',
          'text-paper outline-none',
          'focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
        ].join(' ')}
      >
        {!activeLocationId ? <option value="">{displayLabel}</option> : null}

        {scopedLocations.map((location) => {
          const name = location.name?.trim() || location.type || 'Location'

          return (
            <option key={location.id} value={location.id}>
              {name}
            </option>
          )
        })}
      </select>
    </div>
  )
}

function StateBanner(props: {
  children: ReactNode
  danger?: boolean
}) {
  const { children, danger = false } = props

  return (
    <div
      className={[
        'mb-3 rounded-2xl border px-4 py-3 text-sm font-semibold',
        danger
          ? 'border-toneDanger/25 bg-toneDanger/10 text-toneDanger'
          : 'border-[var(--line)] bg-paper/[0.03] text-paperDim',
      ].join(' ')}
    >
      {children}
    </div>
  )
}