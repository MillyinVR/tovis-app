// app/pro/calendar/_components/CalendarHeader.tsx
'use client'

import { useEffect, useRef, useState } from 'react'

import { Z } from '@/lib/zIndex'

import type { ViewMode } from '../_types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalendarViewLabels = Record<ViewMode, string>

type CalendarHeaderControlsBaseProps = {
  view: ViewMode
  setView: (view: ViewMode) => void
  headerLabel: string

  todayLabel: string
  previousLabel: string
  nextLabel: string
  viewTabsLabel: string
  ariaLabel: string

  onToday: () => void
  onBack: () => void
  onNext: () => void

  viewLabels: CalendarViewLabels
  viewAriaLabels: CalendarViewLabels
}

type CalendarHeaderControlsWithCreateMenu = CalendarHeaderControlsBaseProps & {
  /**
   * Tablet / desktop inline "+ Add" menu — choose add-appointment vs block time.
   * Mobile uses MobileCalendarFab + CalendarCreateSheet instead.
   */
  onBlockTime: () => void
  onAddAppointment: () => void
  createMenuButtonLabel: string
  createMenuLabel: string
  addAppointmentLabel: string
  blockPersonalTimeLabel: string
}

type CalendarHeaderControlsWithoutCreateMenu =
  CalendarHeaderControlsBaseProps & {
    onBlockTime?: undefined
    onAddAppointment?: undefined
    createMenuButtonLabel?: undefined
    createMenuLabel?: undefined
    addAppointmentLabel?: undefined
    blockPersonalTimeLabel?: undefined
  }

type CalendarHeaderControlsProps =
  | CalendarHeaderControlsWithCreateMenu
  | CalendarHeaderControlsWithoutCreateMenu

type IconButtonDirection = 'previous' | 'next'

type IconProps = {
  direction: IconButtonDirection
}

type IconButtonProps = {
  label: string
  onClick: () => void
  direction: IconButtonDirection
}

type ViewOption = {
  value: ViewMode
  label: string
  ariaLabel: string
}

type ViewTabButtonProps = ViewOption & {
  active: boolean
  onSelect: (view: ViewMode) => void
}

type CreateMenuButtonProps = {
  buttonLabel: string
  menuLabel: string
  appointmentLabel: string
  blockLabel: string
  onAddAppointment: () => void
  onBlockTime: () => void
}

type CreateMenuItemProps = {
  label: string
  onClick: () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VIEW_ORDER: readonly ViewMode[] = ['day', 'week', 'month']

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function buildViewOptions(args: {
  labels: CalendarViewLabels
  ariaLabels: CalendarViewLabels
}): ViewOption[] {
  const { labels, ariaLabels } = args

  return VIEW_ORDER.map((value) => ({
    value,
    label: labels[value],
    ariaLabel: ariaLabels[value],
  }))
}

function viewTabClassName(): string {
  return 'brand-pro-calendar-segment-button brand-focus'
}

function iconButtonClassName(): string {
  return 'brand-pro-calendar-nav-button brand-focus'
}

function todayButtonClassName(): string {
  return 'brand-pro-calendar-today-button brand-focus'
}

function blockTimeButtonClassName(): string {
  return 'brand-pro-calendar-block-button brand-focus'
}

function shouldShowCreateMenu(
  props: CalendarHeaderControlsProps,
): props is CalendarHeaderControlsWithCreateMenu {
  return (
    typeof props.onBlockTime === 'function' &&
    typeof props.onAddAppointment === 'function' &&
    typeof props.createMenuButtonLabel === 'string' &&
    props.createMenuButtonLabel.trim().length > 0
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconChevron(props: IconProps) {
  const { direction } = props

  const path =
    direction === 'previous'
      ? 'M12.75 4.75L7.25 10L12.75 15.25'
      : 'M7.25 4.75L12.75 10L7.25 15.25'

  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ViewTabButton(props: ViewTabButtonProps) {
  const { value, label, ariaLabel, active, onSelect } = props

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={ariaLabel}
      onClick={() => {
        if (!active) onSelect(value)
      }}
      className={viewTabClassName()}
      data-active={active ? 'true' : 'false'}
      data-calendar-view-option={value}
    >
      {label}
    </button>
  )
}

function IconButton(props: IconButtonProps) {
  const { label, onClick, direction } = props

  return (
    <button
      type="button"
      onClick={onClick}
      className={iconButtonClassName()}
      aria-label={label}
      title={label}
      data-calendar-nav-direction={direction}
    >
      <IconChevron direction={direction} />
    </button>
  )
}

function CreateMenuButton(props: CreateMenuButtonProps) {
  const {
    buttonLabel,
    menuLabel,
    appointmentLabel,
    blockLabel,
    onAddAppointment,
    onBlockTime,
  } = props

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }

    // Dismiss on any pointerdown outside the menu. Using a passive document
    // listener (instead of a full-viewport scrim button) means the same click
    // that closes the menu still reaches its target — e.g. the Week/Month
    // toggle actuates on the first click instead of being swallowed.
    function onPointerDown(event: PointerEvent): void {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setOpen(false)
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)

    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  function choose(action: () => void): void {
    setOpen(false)
    action()
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={blockTimeButtonClassName()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuLabel}
        title={menuLabel}
      >
        {buttonLabel}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={menuLabel}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: Z.modal,
            minWidth: 220,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 6,
            background: 'rgb(var(--bg-surface))',
            border: '1px solid var(--line)',
            borderRadius: 14,
            boxShadow: 'var(--shadow-strong)',
          }}
        >
          <CreateMenuItem
            label={appointmentLabel}
            onClick={() => choose(onAddAppointment)}
          />
          <CreateMenuItem
            label={blockLabel}
            onClick={() => choose(onBlockTime)}
          />
        </div>
      ) : null}
    </div>
  )
}

function CreateMenuItem(props: CreateMenuItemProps) {
  const { label, onClick } = props

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="tovis-focus"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '10px 12px',
        borderRadius: 10,
        border: 'none',
        background: 'transparent',
        color: 'rgb(var(--text-primary))',
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
        fontSize: 14,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────

export function CalendarHeaderControls(props: CalendarHeaderControlsProps) {
  const {
    view,
    setView,
    headerLabel,
    onToday,
    onBack,
    onNext,
    todayLabel,
    previousLabel,
    nextLabel,
    viewTabsLabel,
    viewLabels,
    viewAriaLabels,
    ariaLabel,
  } = props

  const viewOptions = buildViewOptions({
    labels: viewLabels,
    ariaLabels: viewAriaLabels,
  })

  return (
    <div
      className="brand-pro-calendar-controls"
      role="group"
      aria-label={ariaLabel}
    >
      <div
        className="brand-pro-calendar-segment"
        role="tablist"
        aria-label={viewTabsLabel}
      >
        {viewOptions.map((option) => (
          <ViewTabButton
            key={option.value}
            value={option.value}
            label={option.label}
            ariaLabel={option.ariaLabel}
            active={option.value === view}
            onSelect={setView}
          />
        ))}
      </div>

      <div className="brand-pro-calendar-nav-row">
        <IconButton
          label={previousLabel}
          onClick={onBack}
          direction="previous"
        />

        <button
          type="button"
          onClick={onToday}
          className={todayButtonClassName()}
          aria-label={todayLabel}
          title={headerLabel}
        >
          {todayLabel}
        </button>

        <IconButton label={nextLabel} onClick={onNext} direction="next" />

        {shouldShowCreateMenu(props) ? (
          <CreateMenuButton
            buttonLabel={props.createMenuButtonLabel}
            menuLabel={props.createMenuLabel}
            appointmentLabel={props.addAppointmentLabel}
            blockLabel={props.blockPersonalTimeLabel}
            onAddAppointment={props.onAddAppointment}
            onBlockTime={props.onBlockTime}
          />
        ) : null}
      </div>
    </div>
  )
}