// app/pro/calendar/_components/CalendarHeader.tsx
'use client'

import type { ReactNode } from 'react'

import type { ViewMode } from '../_types'

// ─── Types ────────────────────────────────────────────────────────────────────

type CalendarHeaderControlsProps = {
  view: ViewMode
  setView: (view: ViewMode) => void
  headerLabel: string
  onToday: () => void
  onBack: () => void
  onNext: () => void
  /** When provided, renders the "+ Block time" accent CTA inline with the controls. */
  onBlockTime?: () => void
}

type IconProps = {
  className?: string
}

type IconButtonProps = {
  label: string
  onClick: () => void
  children: ReactNode
}

type ViewOption = {
  value: ViewMode
  label: string
}

type ViewTabButtonProps = ViewOption & {
  active: boolean
  onSelect: (view: ViewMode) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VIEW_OPTIONS: ReadonlyArray<ViewOption> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function viewTabClassName(active: boolean) {
  const base = [
    'rounded-full px-3.5 py-1.5',
    'text-[11px] font-extrabold uppercase tracking-[0.06em]',
    'transition',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
  ].join(' ')

  if (active) {
    return [base, 'bg-paper text-ink'].join(' ')
  }

  return [base, 'bg-transparent text-paperMute hover:text-paper'].join(' ')
}

function iconButtonClassName() {
  return [
    'inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center',
    'rounded-lg border border-[var(--line-strong)] bg-transparent',
    'text-paper transition hover:bg-paper/[0.06]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
  ].join(' ')
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ViewTabButton(props: ViewTabButtonProps) {
  const { value, label, active, onSelect } = props

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => {
        if (!active) onSelect(value)
      }}
      className={viewTabClassName(active)}
    >
      {label}
    </button>
  )
}

function IconButton(props: IconButtonProps) {
  const { label, onClick, children } = props

  return (
    <button
      type="button"
      onClick={onClick}
      className={iconButtonClassName()}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

function IconChevronLeft(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={props.className}
    >
      <path
        d="M12.75 4.75L7.25 10L12.75 15.25"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconChevronRight(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={props.className}
    >
      <path
        d="M7.25 4.75L12.75 10L7.25 15.25"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ─── Exported components ──────────────────────────────────────────────────────

export function CalendarHeaderControls(props: CalendarHeaderControlsProps) {
  const { view, setView, headerLabel, onToday, onBack, onNext, onBlockTime } =
    props

  return (
    <div
      className="flex w-full items-center justify-between gap-2 md:w-auto md:flex-wrap md:justify-end"
      role="group"
      aria-label="Calendar navigation"
    >
      <div
        className={[
          'flex shrink-0 gap-0.5 rounded-full border border-[var(--line)]',
          'bg-paper/[0.05] p-[3px]',
        ].join(' ')}
        role="tablist"
        aria-label="Calendar view"
      >
        {VIEW_OPTIONS.map((option) => (
          <ViewTabButton
            key={option.value}
            value={option.value}
            label={option.label}
            active={option.value === view}
            onSelect={setView}
          />
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <IconButton label="Previous calendar range" onClick={onBack}>
          <IconChevronLeft className="h-4 w-4" />
        </IconButton>

        <button
          type="button"
          onClick={onToday}
          className={[
            'h-[30px] rounded-lg border border-[var(--line-strong)] bg-transparent px-2.5',
            'font-mono text-[11px] font-extrabold uppercase tracking-[0.05em] text-paper',
            'transition hover:bg-paper/[0.06]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
          ].join(' ')}
          aria-label="Go to today"
          title={headerLabel}
        >
          Today
        </button>

        <IconButton label="Next calendar range" onClick={onNext}>
          <IconChevronRight className="h-4 w-4" />
        </IconButton>

        {onBlockTime !== undefined ? (
          <button
            type="button"
            onClick={onBlockTime}
            className={[
              'hidden md:inline-flex',
              'h-[30px] items-center rounded-lg px-3',
              'bg-terra font-mono text-[11px] font-extrabold uppercase tracking-[0.05em] text-paper',
              'shadow-[0_8px_22px_rgb(var(--terra)_/_0.40)]',
              'transition hover:brightness-110',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
            ].join(' ')}
          >
            + Block time
          </button>
        ) : null}
      </div>
    </div>
  )
}