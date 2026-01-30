// app/pro/calendar/_components/CalendarHeader.tsx
'use client'

import { useMemo } from 'react'
import type { ViewMode } from '../_types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/(main)/ui/select'

export function CalendarHeader() {
  return (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <p className="text-sm text-textSecondary">Visual overview of your day, week, or month.</p>
      </div>

      <a href="/pro" className="text-sm text-textSecondary hover:text-textPrimary">
        ← Back to pro dashboard
      </a>
    </header>
  )
}

function IconChevronLeft(props: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={props.className ?? ''}>
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

function IconChevronRight(props: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={props.className ?? ''}>
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

function CalendarBadgeButton(props: { onClick: () => void; dayNumber: number }) {
  const { onClick, dayNumber } = props
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'group relative inline-flex h-10 w-10 items-center justify-center',
        'rounded-2xl border border-white/10 bg-bgSecondary',
        'shadow-[0_10px_30px_rgb(0_0_0/0.22)]',
        'transition hover:bg-bgSecondary/80 hover:border-white/15',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
      ].join(' ')}
      aria-label="Go to today"
      title="Today"
    >
      {/* calendar outline */}
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="absolute h-6 w-6 text-textSecondary/70">
        <path
          d="M8 3v2M16 3v2M4.5 9.5h15"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M6.5 5.5h11A2.5 2.5 0 0 1 20 8v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19V8a2.5 2.5 0 0 1 2.5-2.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>

      {/* date number */}
      <span className="relative z-10 translate-y-[1px] text-[11px] font-black text-textPrimary">
        {dayNumber}
      </span>

      {/* subtle sheen */}
      <span className="pointer-events-none absolute inset-0 rounded-2xl bg-white/0 transition group-hover:bg-white/5" />
    </button>
  )
}

function IconButton(props: { label: string; onClick: () => void; children: React.ReactNode }) {
  const { label, onClick, children } = props
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex h-10 w-10 items-center justify-center',
        'rounded-2xl border border-white/10 bg-bgSecondary',
        'shadow-[0_10px_30px_rgb(0_0_0/0.18)]',
        'transition hover:bg-bgSecondary/80 hover:border-white/15',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
      ].join(' ')}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

function viewLabel(v: ViewMode) {
  if (v === 'day') return 'Day'
  if (v === 'month') return 'Month'
  return 'Week'
}

export function CalendarHeaderControls(props: {
  view: ViewMode
  setView: (v: ViewMode) => void
  headerLabel: string
  onToday: () => void
  onBack: () => void
  onNext: () => void
}) {
  const { view, setView, headerLabel, onToday, onBack, onNext } = props

  const todayNumber = useMemo(() => {
    try {
      return new Date().getDate()
    } catch {
      return 1
    }
  }, [])

  return (
    <section
      className={[
        'mb-3 overflow-hidden rounded-2xl border border-white/10 bg-bgPrimary',
        'shadow-[0_12px_40px_rgb(0_0_0/0.35)]',
      ].join(' ')}
    >
      <div className="px-3 py-3 sm:px-4">
        {/* grid keeps the date area truly centered */}
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
          {/* LEFT: Today calendar badge */}
          <div className="flex items-center gap-2">
            <CalendarBadgeButton onClick={onToday} dayNumber={todayNumber} />
          </div>

          {/* CENTER: arrows + centered label */}
          <div className="flex items-center justify-center gap-2">
            <IconButton label="Previous" onClick={onBack}>
              <IconChevronLeft className="h-5 w-5 text-textPrimary" />
            </IconButton>

            <div
              className={[
                'min-w-0 px-1 text-center',
                'text-[13px] font-extrabold text-textPrimary',
                'tracking-tight',
              ].join(' ')}
              title={headerLabel}
            >
              <span className="block truncate">{headerLabel}</span>
            </div>

            <IconButton label="Next" onClick={onNext}>
              <IconChevronRight className="h-5 w-5 text-textPrimary" />
            </IconButton>
          </div>

          {/* RIGHT: View dropdown (shadcn / radix) */}
          <div className="flex justify-end">
            <Select value={view} onValueChange={(v) => setView(v as ViewMode)}>
              <SelectTrigger
                className={[
                  'h-10 min-w-[120px] rounded-2xl',
                  'border border-white/10 bg-bgSecondary',
                  'px-4 text-[12px] font-black text-textPrimary',
                  'shadow-[0_10px_30px_rgb(0_0_0/0.18)]',
                  'hover:border-white/15 hover:bg-bgSecondary/80',
                  'focus:ring-2 focus:ring-accentPrimary/40 focus:ring-offset-0',
                  // ensures selected text is not washed out by radix styles
                  '[&>span]:text-textPrimary',
                ].join(' ')}
                aria-label="Calendar view"
              >
                <SelectValue>{viewLabel(view)}</SelectValue>
              </SelectTrigger>

              <SelectContent
                position="popper"
                // ✅ dark, readable, premium
                className={[
                  'z-50 overflow-hidden rounded-2xl border border-white/10',
                  'bg-bgSecondary text-textPrimary',
                  'shadow-[0_18px_70px_rgb(0_0_0/0.60)]',
                  // optional: give it a slight “glass” edge sheen without killing readability
                  'backdrop-blur-xl',
                ].join(' ')}
              >
                <SelectItem
                  value="day"
                  className={[
                    'cursor-pointer rounded-xl text-[12px] font-black',
                    'text-textPrimary',
                    'hover:bg-bgPrimary/45',
                    'focus:bg-bgPrimary/60 focus:text-textPrimary',
                    'data-[state=checked]:bg-accentPrimary/12 data-[state=checked]:text-textPrimary',
                  ].join(' ')}
                >
                  Day
                </SelectItem>

                <SelectItem
                  value="week"
                  className={[
                    'cursor-pointer rounded-xl text-[12px] font-black',
                    'text-textPrimary',
                    'hover:bg-bgPrimary/45',
                    'focus:bg-bgPrimary/60 focus:text-textPrimary',
                    'data-[state=checked]:bg-accentPrimary/12 data-[state=checked]:text-textPrimary',
                  ].join(' ')}
                >
                  Week
                </SelectItem>

                <SelectItem
                  value="month"
                  className={[
                    'cursor-pointer rounded-xl text-[12px] font-black',
                    'text-textPrimary',
                    'hover:bg-bgPrimary/45',
                    'focus:bg-bgPrimary/60 focus:text-textPrimary',
                    'data-[state=checked]:bg-accentPrimary/12 data-[state=checked]:text-textPrimary',
                  ].join(' ')}
                >
                  Month
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </section>
  )
}
