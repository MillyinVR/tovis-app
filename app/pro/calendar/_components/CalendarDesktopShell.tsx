// app/pro/calendar/_components/CalendarDesktopShell.tsx
'use client'

import type { Dispatch, ReactNode, SetStateAction } from 'react'

import WorkingHoursTabs from './WorkingHoursTabs'

import { CalendarHeaderControls } from './CalendarHeader'
import { CalendarLocationPanel } from './CalendarLocationPanel'
import { CalendarStatsPanel } from './CalendarStatsPanel'
import { DayWeekGrid } from './DayWeekGrid'
import { MonthGrid } from './MonthGrid'

import type { CalendarData } from '../_hooks/useCalendarData'
import type { ViewMode } from '../_types'
import type { BrandProCalendarCopy } from '@/lib/brand/types'

import { anchorNoonInTimeZone } from '../_utils/date'

// ─── Types ────────────────────────────────────────────────────────────────────

type CalendarDesktopShellProps = {
  copy: BrandProCalendarCopy

  view: ViewMode
  setView: Dispatch<SetStateAction<ViewMode>>

  currentDate: Date
  setCurrentDate: Dispatch<SetStateAction<Date>>

  calendarTimeZone: string
  headerLabel: string
  title: string
  sidebarTodayLabel: string
  visibleDays: Date[]

  showInitialLoading: boolean
  showReloadLoading: boolean

  onToday: () => void
  onBack: () => void
  onNext: () => void

  cal: CalendarData
}

type CalendarLegendTone =
  | 'accepted'
  | 'pending'
  | 'completed'
  | 'waitlist'
  | 'blocked'

type WideCalendarHeaderProps = {
  eyebrow: string
  title: string
  children: ReactNode
}

type PageHeroProps = {
  modeLabel: string
  copy: BrandProCalendarCopy['pageHero']
}

type CalendarDesktopBodyProps = {
  view: ViewMode
  currentDate: Date
  setCurrentDate: Dispatch<SetStateAction<Date>>
  setView: Dispatch<SetStateAction<ViewMode>>
  calendarTimeZone: string
  visibleDays: Date[]
  showInitialLoading: boolean
  showReloadLoading: boolean
  loadingCalendarLabel: string
  loadingRefreshLabel: string
  cal: CalendarData
}

type StatusLegendProps = {
  title: string
  copy: BrandProCalendarCopy['legend']
}

type AutoAcceptCardProps = {
  label: string
  copy: BrandProCalendarCopy['mobileAutoAccept']
  enabled: boolean
  saving: boolean
  onToggle: () => void
}

type ActionButtonProps = {
  children: ReactNode
  onClick: () => void
  active?: boolean
}

type StateBannerProps = {
  children: ReactNode
  danger?: boolean
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function autoAcceptStatusLabel(args: {
  enabled: boolean
  saving: boolean
  copy: BrandProCalendarCopy['mobileAutoAccept']
}): string {
  const { enabled, saving, copy } = args

  if (saving) return copy.savingLabel

  return enabled ? copy.onLabel : copy.offLabel
}

function autoAcceptAriaLabel(args: {
  enabled: boolean
  copy: BrandProCalendarCopy['mobileAutoAccept']
}): string {
  return args.enabled ? args.copy.ariaLabelOn : args.copy.ariaLabelOff
}

// ─── Exported component ───────────────────────────────────────────────────────

export function CalendarDesktopShell(props: CalendarDesktopShellProps) {
  const {
    copy,
    view,
    setView,
    currentDate,
    setCurrentDate,
    calendarTimeZone,
    headerLabel,
    title,
    sidebarTodayLabel,
    visibleDays,
    showInitialLoading,
    showReloadLoading,
    onToday,
    onBack,
    onNext,
    cal,
  } = props

  return (
    <section className="brand-pro-calendar-shell" data-device="desktop">
      <PageHero modeLabel={copy.labels.mode} copy={copy.pageHero} />

      <section className="brand-pro-calendar-panel">
        <WideCalendarHeader
          eyebrow={`${copy.labels.mode} · ${headerLabel}`}
          title={title}
        >
          <CalendarHeaderControls
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
            onBlockTime={cal.openCreateBlockNow}
            blockTimeLabel={copy.actions.blockTime}
          />
        </WideCalendarHeader>

        <div className="brand-pro-calendar-desktop-main">
          <aside className="brand-pro-calendar-sidebar">
            <p className="brand-cap mb-4">
              {sidebarTodayLabel} · {copy.actions.today}
            </p>

            <CalendarStatsPanel
              copy={copy.stats}
              stats={cal.stats}
              management={cal.management}
              blockedMinutesToday={cal.blockedMinutesToday}
              onOpenManagement={cal.openManagement}
              variant="rail"
            />

            <div className="mt-5">
              <CalendarLocationPanel
                copy={copy.locationPanel}
                locationsLoaded={cal.locationsLoaded}
                scopedLocations={cal.scopedLocations}
                activeLocationId={cal.activeLocationId}
                activeLocationLabel={cal.activeLocationLabel}
                calendarTimeZone={calendarTimeZone}
                onChangeLocation={cal.setActiveLocationId}
              />
            </div>

            <StatusLegend
              title={copy.labels.statusKey}
              copy={copy.legend}
            />

            <AutoAcceptCard
              label={copy.actions.autoAccept}
              copy={copy.mobileAutoAccept}
              enabled={cal.autoAccept}
              saving={cal.savingAutoAccept}
              onToggle={() => void cal.toggleAutoAccept(!cal.autoAccept)}
            />

            <div className="mt-4">
              <ActionButton
                onClick={() =>
                  cal.setShowHoursForm((current: boolean) => !current)
                }
                active={cal.showHoursForm}
              >
                {cal.showHoursForm
                  ? copy.actions.hideHours
                  : copy.actions.editHours}
              </ActionButton>
            </div>
          </aside>

          <section className="brand-pro-calendar-content">
            <CalendarDesktopBody
              view={view}
              currentDate={currentDate}
              setCurrentDate={setCurrentDate}
              setView={setView}
              calendarTimeZone={calendarTimeZone}
              visibleDays={visibleDays}
              showInitialLoading={showInitialLoading}
              showReloadLoading={showReloadLoading}
              loadingCalendarLabel={copy.labels.loadingCalendar}
              loadingRefreshLabel={copy.labels.loadingRefresh}
              cal={cal}
            />
          </section>
        </div>
      </section>
    </section>
  )
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function PageHero(props: PageHeroProps) {
  const { modeLabel, copy } = props

  return (
    <header className="brand-pro-calendar-page-hero">
      <div>
        <p className="brand-pro-calendar-wide-eyebrow">{modeLabel}</p>

        <h1 className="brand-pro-calendar-page-hero-title">
          {copy.title}
          <span className="text-terra">{copy.accentMark}</span>
          {copy.suffix}
        </h1>
      </div>

      <a href={copy.dashboardHref} className="brand-pro-calendar-page-hero-link">
        {copy.dashboardLabel}
      </a>
    </header>
  )
}

function WideCalendarHeader(props: WideCalendarHeaderProps) {
  const { eyebrow, title, children } = props

  return (
    <div className="brand-pro-calendar-wide-header">
      <div>
        <p className="brand-pro-calendar-wide-eyebrow">{eyebrow}</p>

        <h2 className="brand-pro-calendar-wide-title">{title}</h2>
      </div>

      {children}
    </div>
  )
}

function CalendarDesktopBody(props: CalendarDesktopBodyProps) {
  const {
    view,
    currentDate,
    setCurrentDate,
    setView,
    calendarTimeZone,
    visibleDays,
    showInitialLoading,
    showReloadLoading,
    loadingCalendarLabel,
    loadingRefreshLabel,
    cal,
  } = props

  return (
    <>
      {cal.showHoursForm ? (
        <section className="brand-pro-calendar-hours-panel">
          <WorkingHoursTabs
            canSalon={cal.canSalon}
            canMobile={cal.canMobile}
            activeEditorType={cal.hoursEditorLocationType}
            onChangeEditorType={cal.setHoursEditorLocationType}
            onSavedAny={cal.reload}
          />
        </section>
      ) : null}

      <div className="brand-pro-calendar-desktop-content-inner">
        <div className="brand-pro-calendar-desktop-state-list">
          {showInitialLoading ? (
            <StateBanner>{loadingCalendarLabel}</StateBanner>
          ) : null}

          {showReloadLoading ? (
            <StateBanner>{loadingRefreshLabel}</StateBanner>
          ) : null}

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
          <div className="brand-pro-calendar-month-desktop">
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
          </div>
        ) : null}
      </div>
    </>
  )
}

// ─── Sidebar sub-components ───────────────────────────────────────────────────

function StatusLegend(props: StatusLegendProps) {
  const { title, copy } = props

  return (
    <div className="brand-pro-calendar-legend">
      <p className="brand-pro-calendar-legend-title">{title}</p>

      <div className="brand-pro-calendar-legend-list">
        <LegendRow tone="accepted" label={copy.accepted} />
        <LegendRow tone="pending" label={copy.pending} />
        <LegendRow tone="completed" label={copy.completed} />
        <LegendRow tone="waitlist" label={copy.waitlist} />
        <LegendRow tone="blocked" label={copy.blocked} dashed />
      </div>
    </div>
  )
}

function LegendRow(props: {
  tone: CalendarLegendTone
  label: string
  dashed?: boolean
}) {
  const { tone, label, dashed = false } = props

  return (
    <div className="brand-pro-calendar-legend-row">
      <span
        className="brand-pro-calendar-legend-dot"
        data-tone={tone}
        data-dashed={dashed ? 'true' : 'false'}
        aria-hidden="true"
      />

      <span className="brand-pro-calendar-legend-label">{label}</span>
    </div>
  )
}

function AutoAcceptCard(props: AutoAcceptCardProps) {
  const { label, copy, enabled, saving, onToggle } = props

  const status = autoAcceptStatusLabel({
    enabled,
    saving,
    copy,
  })

  const ariaLabel = autoAcceptAriaLabel({
    enabled,
    copy,
  })

  return (
    <div className="brand-pro-calendar-auto-card">
      <p className="brand-pro-calendar-wide-eyebrow">◆ {label}</p>

      <p className="brand-pro-calendar-auto-card-description">
        {status} · {copy.subtitle}
      </p>

      <div className="brand-pro-calendar-auto-card-row">
        <span className="brand-cap">{status}</span>

        <button
          type="button"
          onClick={onToggle}
          disabled={saving}
          className="brand-pro-calendar-switch brand-focus"
          data-enabled={enabled ? 'true' : 'false'}
          data-saving={saving ? 'true' : 'false'}
          aria-pressed={enabled}
          aria-label={ariaLabel}
          title={ariaLabel}
        >
          <span className="brand-pro-calendar-switch-thumb" />
        </button>
      </div>
    </div>
  )
}

function ActionButton(props: ActionButtonProps) {
  const { children, onClick, active = false } = props

  return (
    <button
      type="button"
      onClick={onClick}
      className="brand-pro-calendar-sidebar-action brand-focus"
      data-active={active ? 'true' : 'false'}
    >
      {children}
    </button>
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