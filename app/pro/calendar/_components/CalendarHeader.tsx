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

function todayDayNumber() {
  return new Date().getDate()
}

function viewTabClassName(active: boolean) {
  const base = [
    'rounded-full px-3.5 py-1.5 text-center',
    'font-mono text-[10px] font-black uppercase tracking-[0.10em]',
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
  ].join(' ')

  if (active) {
    return [
      base,
      'bg-[var(--paper)] text-[var(--ink)] shadow-[0_4px_12px_rgb(0_0_0/0.22)]',
    ].join(' ')
  }

  return [
    base,
    'text-[var(--paper-mute)] hover:bg-[var(--paper)]/[0.06] hover:text-[var(--paper)]',
  ].join(' ')
}

function iconButtonClassName() {
  return [
    'inline-flex h-9 w-9 shrink-0 items-center justify-center',
    'rounded-xl border border-[var(--line-strong)]',
    'text-[var(--paper)]',
    'transition hover:bg-[var(--paper)]/[0.06]',
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

/**
 * Inline control bar: view-mode tabs + prev/today/next navigation + optional
 * block-time CTA. Designed to sit directly in the calendar card header row —
 * no wrapping shell of its own.
 *
 * On narrow viewports the flex container wraps naturally; no JS breakpoint
 * logic needed.
 */
export function CalendarHeaderControls(props: CalendarHeaderControlsProps) {
  const { view, setView, headerLabel, onToday, onBack, onNext, onBlockTime } =
    props

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Calendar navigation"
    >
      {/* View tabs pill */}
      <div
        className={[
          'flex gap-0.5 rounded-full border border-[var(--line)]',
          'bg-[var(--paper)]/[0.04] p-0.5',
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

      {/* Visual divider */}
      <div
        className="h-5 w-px bg-[var(--line-strong)]"
        aria-hidden="true"
      />

      {/* Prev / Today·N / Next */}
      <div className="flex items-center gap-1">
        <IconButton label="Previous calendar range" onClick={onBack}>
          <IconChevronLeft className="h-4 w-4" />
        </IconButton>

        <button
          type="button"
          onClick={onToday}
          className={[
            'h-9 rounded-xl border border-[var(--line-strong)] bg-transparent',
            'px-3 font-mono text-[11px] font-black uppercase tracking-[0.06em] text-[var(--paper)]',
            'transition hover:bg-[var(--paper)]/[0.06]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
          ].join(' ')}
          aria-label="Go to today"
          title={headerLabel}
        >
          Today · {todayDayNumber()}
        </button>

        <IconButton label="Next calendar range" onClick={onNext}>
          <IconChevronRight className="h-4 w-4" />
        </IconButton>
      </div>

      {/* Block time CTA — desktop only; mobile FAB handles this action */}
      {onBlockTime !== undefined ? (
        <button
          type="button"
          onClick={onBlockTime}
          className={[
            'hidden md:inline-flex',
            'relative h-9 items-center rounded-xl px-4',
            'bg-terra font-mono text-[11px] font-black uppercase tracking-[0.04em] text-[var(--paper)]',
            'shadow-[0_8px_22px_rgb(var(--terra)/0.40)]',
            'transition hover:brightness-110',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
          ].join(' ')}
        >
          + Block time
        </button>
      ) : null}
    </div>
  )
}
