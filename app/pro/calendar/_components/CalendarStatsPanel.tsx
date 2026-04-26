// app/pro/calendar/_components/CalendarStatsPanel.tsx
'use client'

import type {
  CalendarStats,
  ManagementKey,
  ManagementLists,
} from '../_types'

// ─── Types ────────────────────────────────────────────────────────────────────

type StatTone = 'paper' | 'terra' | 'pending' | 'acid' | 'fern' | 'muted'

type CalendarStatsPanelProps = {
  stats: CalendarStats
  management: ManagementLists
  blockedMinutesToday: number
  onOpenManagement: (key: ManagementKey) => void
  compact?: boolean
}

type StatTileProps = {
  label: string
  value: string | number
  sublabel: string
  tone: StatTone
  onClick: () => void
  compact?: boolean
  pulse?: boolean
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function formatHours(hours: number | null | undefined): string {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) return '—'

  const rounded = Math.round(hours * 10) / 10

  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`
}

function formatMinutesAsHours(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0h'

  const rounded = Math.round((minutes / 60) * 10) / 10

  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatTile(props: StatTileProps) {
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
      className="brand-pro-calendar-stat brand-focus"
      data-tone={tone}
      data-compact={compact ? 'true' : 'false'}
    >
      <span className="brand-pro-calendar-stat-label">{label}</span>

      <span className="brand-pro-calendar-stat-value">{value}</span>

      <span className="brand-pro-calendar-stat-sub">{sublabel}</span>

      {pulse ? (
        <span
          className="brand-pro-calendar-stat-dot"
          data-pulse="true"
          aria-hidden="true"
        />
      ) : null}
    </button>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────

export function CalendarStatsPanel(props: CalendarStatsPanelProps) {
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
    <div
      className={
        compact
          ? 'brand-pro-calendar-stat-grid'
          : 'brand-pro-calendar-stat-list'
      }
    >
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