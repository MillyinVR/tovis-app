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
import { ConfirmChangeModal } from './_components/ConfirmChangeModal'
import { DayWeekGrid } from './_components/DayWeekGrid'
import { ManagementModal } from './_components/ManagementModal'
import { MonthGrid } from './_components/MonthGrid'

import type {
  CalendarEvent,
  CalendarStats,
  ManagementKey,
  ManagementLists,
  ViewMode,
} from './_types'

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

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function safeTz(value: unknown) {
  return sanitizeTimeZone(
    typeof value === 'string' ? value : '',
    DEFAULT_TIME_ZONE,
  )
}

function validTimeZoneOrFallback(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback

  const candidate = value.trim()

  if (!candidate || !isValidIanaTimeZone(candidate)) {
    return fallback
  }

  return sanitizeTimeZone(candidate, fallback)
}

function headerLabelFor(view: ViewMode, anchorUtc: Date, timeZone: string) {
  if (view === 'day') return formatDayLabelInTimeZone(anchorUtc, timeZone)
  if (view === 'week') return formatWeekRangeInTimeZone(anchorUtc, timeZone)

  return formatMonthRangeInTimeZone(anchorUtc, timeZone)
}

function titleForView(view: ViewMode) {
  if (view === 'day') return 'Your day.'
  if (view === 'month') return 'This month.'

  return 'This week.'
}

function visibleDaysForView(args: {
  view: ViewMode
  anchoredCurrentDate: Date
  timeZone: string
}) {
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

function formatHours(hours: number | null | undefined) {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) return '—'

  const rounded = Math.round(hours * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`
}

function formatMinutesAsHours(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0h'

  const rounded = Math.round((minutes / 60) * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`
}

function toneTextClass(tone: StatTone) {
  switch (tone) {
    case 'terra':
      return 'text-terraGlow'
    case 'pending':
      return 'text-amber'
    case 'acid':
      return 'text-acid'
    case 'fern':
      return 'text-fern'
    case 'muted':
      return 'text-paperMute'
    case 'paper':
    default:
      return 'text-paper'
  }
}

function toneDotClass(tone: StatTone) {
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

function todayWeekdayLabel(timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'long',
  }).format(new Date())
}

function bookingActionId(event: CalendarEvent | undefined) {
  if (!event || event.kind !== 'BOOKING') return null
  return event.id
}

function firstPendingBooking(events: CalendarEvent[]) {
  return events.find((event) => event.kind === 'BOOKING')
}

function mobileSubtitleFor(args: {
  date: Date
  timeZone: string
  activeLocationLabel: string | null
}) {
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
  const [view, setView] = useState<ViewMode>('week')
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
    <main className="min-h-screen bg-ink px-0 pb-28 pt-0 font-sans text-paper md:px-8 md:pb-14 md:pt-10">
      <div className="mx-auto max-w-[1600px]">
        <PageHero />

        <section className="overflow-hidden bg-ink md:rounded-[18px] md:border md:border-[var(--line-strong)] md:shadow-[0_40px_80px_rgb(0_0_0_/_0.40)]">
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

                  {showReloadLoading ? <StateBanner>Loading…</StateBanner> : null}

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
                  <div className="p-3 md:p-0">
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
                ) : null}
              </div>
            </section>
          </div>
        </section>
      </div>

      <PendingRequestBar
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

function MobileCalendarHeader(props: {
  title: string
  subtitle: string
}) {
  const { title, subtitle } = props

  return (
    <header className="bg-ink px-5 pb-3 pt-[58px]">
      <div className="mb-3.5 flex items-center justify-between gap-4">
        <a
          href="/"
          className={[
            'inline-flex items-center gap-1.5',
            'font-sans text-xs font-bold uppercase tracking-[0.08em]',
            'text-paperMute transition hover:text-paper',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
          ].join(' ')}
        >
          <span aria-hidden="true">‹</span>
          CLIENT
        </a>

        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-terraGlow">
          ◆ PRO MODE
        </p>
      </div>

      <h1 className="font-display text-[34px] font-semibold italic leading-none tracking-[-0.03em] text-paper">
        {title}
      </h1>

      <p className="mt-1.5 truncate font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-paperMute">
        {subtitle}
      </p>
    </header>
  )
}

function CalendarStatsPanel(props: {
  stats: CalendarStats
  management: ManagementLists
  blockedMinutesToday: number
  onOpenManagement: (key: ManagementKey) => void
  compact?: boolean
}) {
  const {
    stats,
    management,
    blockedMinutesToday,
    onOpenManagement,
    compact = false,
  } = props

  const bookedCount = stats?.todaysBookings ?? management.todaysBookings.length
  const pendingCount =
    stats?.pendingRequests ?? management.pendingRequests.length
  const waitlistCount = management.waitlistToday.length
  const freeHours = formatHours(stats?.availableHours)
  const blockedHours = formatMinutesAsHours(blockedMinutesToday)

  return (
    <div className={compact ? 'grid grid-cols-4 gap-1.5' : 'grid gap-2.5'}>
      <StatTile
        label="Booked"
        value={bookedCount}
        sublabel="today"
        tone="paper"
        compact={compact}
        onClick={() => onOpenManagement('todaysBookings')}
      />

      <StatTile
        label="Pending"
        value={pendingCount}
        sublabel="review"
        tone="pending"
        pulse={pendingCount > 0}
        compact={compact}
        onClick={() => onOpenManagement('pendingRequests')}
      />

      <StatTile
        label="Waitlist"
        value={waitlistCount}
        sublabel="people"
        tone="acid"
        compact={compact}
        onClick={() => onOpenManagement('waitlistToday')}
      />

      <StatTile
        label="Free"
        value={freeHours}
        sublabel={freeHours === '—' ? `${blockedHours} blocked` : 'gaps'}
        tone="muted"
        compact={compact}
        onClick={() => onOpenManagement('blockedToday')}
      />
    </div>
  )
}

function StatTile(props: {
  label: string
  value: string | number
  sublabel: string
  tone: StatTone
  onClick: () => void
  compact?: boolean
  pulse?: boolean
}) {
  const {
    label,
    value,
    sublabel,
    tone,
    onClick,
    compact = false,
    pulse = false,
  } = props

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'relative rounded-xl border border-[var(--line)] bg-paper/[0.02] text-left',
        'transition hover:border-[var(--line-strong)] hover:bg-paper/[0.04]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
        compact ? 'px-2 py-2' : 'px-3.5 py-3',
      ].join(' ')}
    >
      <span
        className={[
          'block font-mono font-semibold uppercase text-paperMute',
          compact
            ? 'text-[9px] tracking-[0.10em]'
            : 'text-[10px] tracking-[0.14em]',
        ].join(' ')}
      >
        {label}
      </span>

      <span
        className={[
          'mt-1 block font-display font-semibold leading-none',
          toneTextClass(tone),
          compact ? 'text-[22px]' : 'text-[28px]',
        ].join(' ')}
      >
        {value}
      </span>

      <span
        className={[
          'mt-1 block text-paperMute',
          compact ? 'text-[9.5px]' : 'text-xs',
        ].join(' ')}
      >
        {sublabel}
      </span>

      {pulse ? (
        <span
          className={[
            'absolute right-2 top-2 h-1.5 w-1.5 rounded-full',
            toneDotClass(tone),
          ].join(' ')}
          aria-hidden="true"
        />
      ) : null}
    </button>
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

/**
 * Floating pending-request tray — mobile only (lg:hidden).
 * Surfaces the top pending booking with inline approve/deny, keeping pros in
 * flow without a modal dive.
 */
function PendingRequestBar(props: {
  event: CalendarEvent | undefined
  pendingCount: number
  busy: boolean
  error: string | null
  onOpenAll: () => void
  onApprove: () => void
  onDeny: () => void
}) {
  const {
    event,
    pendingCount,
    busy,
    error,
    onOpenAll,
    onApprove,
    onDeny,
  } = props

  if (!event || event.kind !== 'BOOKING' || pendingCount <= 0) return null

  const clientName = event.clientName || 'Client'
  const title = event.title || 'Appointment'
  const moreCount = pendingCount - 1

  return (
    <div className="fixed bottom-24 left-4 right-4 z-20 lg:hidden">
      <div
        className={[
          'relative overflow-hidden rounded-2xl border p-3',
          'shadow-[0_16px_46px_rgb(0_0_0_/_0.62)] backdrop-blur-xl',
        ].join(' ')}
        style={{
          background:
            'linear-gradient(135deg, rgb(var(--amber) / 0.22), rgb(var(--ink-2) / 0.94) 46%, rgb(var(--terra) / 0.12))',
          borderColor: 'rgb(var(--amber) / 0.30)',
          boxShadow:
            '0 0 0 1px rgb(var(--amber) / 0.10), 0 16px 46px rgb(0 0 0 / 0.62)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ backgroundColor: 'rgb(var(--amber) / 0.55)' }}
          aria-hidden="true"
        />

        <div
          className="pointer-events-none absolute -bottom-12 right-10 h-24 w-24 rounded-full blur-3xl"
          style={{ backgroundColor: 'rgb(var(--terra) / 0.22)' }}
          aria-hidden="true"
        />

        <div className="relative flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenAll}
            className={[
              'grid h-11 w-11 shrink-0 place-items-center rounded-xl',
              'border font-display text-xl font-semibold leading-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
            ].join(' ')}
            style={{
              backgroundColor: 'rgb(var(--amber) / 0.20)',
              borderColor: 'rgb(var(--amber) / 0.42)',
              color: 'rgb(var(--amber))',
              boxShadow: 'inset 0 0 0 1px rgb(var(--amber) / 0.10)',
            }}
            aria-label="Open all pending requests"
          >
            {pendingCount}
          </button>

          <button
            type="button"
            onClick={onOpenAll}
            className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40"
          >
            <p
              className={[
                'font-mono text-[9px] font-black uppercase tracking-[0.16em]',
              ].join(' ')}
              style={{ color: 'rgb(var(--amber))' }}
            >
              ◆ Pending request
            </p>

            <p className="mt-1 truncate text-sm font-black text-[var(--paper)]">
              {clientName} — {title}
            </p>

            {moreCount > 0 ? (
              <p className="mt-0.5 text-xs font-semibold text-[var(--paper-mute)]">
                +{moreCount} more waiting
              </p>
            ) : null}
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onApprove()
            }}
            disabled={busy}
            className={[
              'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
              'text-sm font-black',
              'disabled:cursor-wait disabled:opacity-60',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
            ].join(' ')}
            style={{
              backgroundColor: 'rgb(var(--fern))',
              border: '1px solid rgb(var(--fern) / 0.65)',
              color: 'rgb(var(--paper))',
              boxShadow:
                '0 0 0 1px rgb(var(--fern) / 0.22), 0 8px 20px rgb(var(--fern) / 0.34)',
            }}
            aria-label="Approve pending booking"
            title="Approve pending booking"
          >
            ✓
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onDeny()
            }}
            disabled={busy}
            className={[
              'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
              'text-sm font-black',
              'disabled:cursor-wait disabled:opacity-60',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
            ].join(' ')}
            style={{
              backgroundColor: 'rgb(var(--ember) / 0.92)',
              border: '1px solid rgb(var(--ember) / 0.70)',
              color: 'rgb(var(--paper))',
              boxShadow:
                '0 0 0 1px rgb(var(--ember) / 0.22), 0 8px 20px rgb(var(--ember) / 0.30)',
            }}
            aria-label="Deny pending booking"
            title="Deny pending booking"
          >
            ×
          </button>
        </div>

        {error ? (
          <p className="relative mt-2 text-xs font-semibold text-toneDanger">
            {error}
          </p>
        ) : null}
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
    scopedLocations.find((location) => location.id === activeLocationId)?.name?.trim() ||
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

function StateBanner(props: { children: ReactNode; danger?: boolean }) {
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