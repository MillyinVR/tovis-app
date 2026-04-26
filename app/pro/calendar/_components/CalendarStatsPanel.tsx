// app/pro/calendar/_components/CalendarStatsPanel.tsx
'use client'

import type { BrandProCalendarCopy } from '@/lib/brand/types'

import type {
  CalendarStats,
  ManagementKey,
  ManagementLists,
} from '../_types'

// ─── Types ────────────────────────────────────────────────────────────────────

type StatTone = 'paper' | 'terra' | 'pending' | 'acid' | 'fern' | 'muted'

type CalendarStatsVariant = 'mobile' | 'tablet' | 'rail'

type CalendarStatsPanelProps = {
  copy: BrandProCalendarCopy['stats']
  stats: CalendarStats
  management: ManagementLists
  blockedMinutesToday: number
  onOpenManagement: (key: ManagementKey) => void

  /**
   * Prefer variant going forward.
   * compact stays temporarily so older call sites do not need a messy all-at-once refactor.
   */
  variant?: CalendarStatsVariant
  compact?: boolean

  /**
   * Keep false until waitlistToday is backed by real route data.
   * Enterprise-ready means no cute fake dashboard numbers.
   */
  showWaitlist?: boolean
}

type StatTileConfig = {
  managementKey: ManagementKey
  label: string
  value: string | number
  sublabel: string
  tone: StatTone
  pulse: boolean
}

type StatTileProps = StatTileConfig & {
  compact: boolean
  onOpenManagement: (key: ManagementKey) => void
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

function compactForVariant(args: {
  variant?: CalendarStatsVariant
  compact?: boolean
}): boolean {
  const { variant, compact } = args

  if (typeof compact === 'boolean') return compact
  if (variant === 'mobile' || variant === 'tablet') return true

  return false
}

function containerClassName(compact: boolean): string {
  return compact
    ? 'brand-pro-calendar-stat-grid'
    : 'brand-pro-calendar-stat-list'
}

function freeSublabel(args: {
  freeHours: string
  blockedMinutesToday: number
  copy: BrandProCalendarCopy['stats']
}): string {
  const { freeHours, blockedMinutesToday, copy } = args

  if (freeHours !== '—') return copy.freeSub

  const blockedHours = formatMinutesAsHours(blockedMinutesToday)

  return `${blockedHours} ${copy.blockedSuffix}`
}

function buildStatTiles(args: {
  copy: BrandProCalendarCopy['stats']
  stats: CalendarStats
  management: ManagementLists
  blockedMinutesToday: number
  showWaitlist: boolean
}): StatTileConfig[] {
  const {
    copy,
    stats,
    management,
    blockedMinutesToday,
    showWaitlist,
  } = args

  const bookedCount = stats?.todaysBookings ?? management.todaysBookings.length
  const pendingCount =
    stats?.pendingRequests ?? management.pendingRequests.length
  const waitlistCount = management.waitlistToday.length
  const freeHours = formatHours(stats?.availableHours)

  const tiles: StatTileConfig[] = [
    {
      managementKey: 'todaysBookings',
      label: copy.booked,
      value: bookedCount,
      sublabel: copy.bookedSub,
      tone: 'paper',
      pulse: false,
    },
    {
      managementKey: 'pendingRequests',
      label: copy.pending,
      value: pendingCount,
      sublabel: copy.pendingSub,
      tone: 'pending',
      pulse: pendingCount > 0,
    },
  ]

  if (showWaitlist) {
    tiles.push({
      managementKey: 'waitlistToday',
      label: copy.waitlist,
      value: waitlistCount,
      sublabel: copy.waitlistSub,
      tone: 'acid',
      pulse: false,
    })
  }

  tiles.push({
    managementKey: 'blockedToday',
    label: copy.free,
    value: freeHours,
    sublabel: freeSublabel({
      freeHours,
      blockedMinutesToday,
      copy,
    }),
    tone: 'muted',
    pulse: false,
  })

  return tiles
}

function statTileAriaLabel(args: {
  label: string
  value: string | number
  sublabel: string
}): string {
  return `${args.label}: ${args.value}, ${args.sublabel}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatTile(props: StatTileProps) {
  const {
    managementKey,
    label,
    value,
    sublabel,
    tone,
    pulse,
    compact,
    onOpenManagement,
  } = props

  return (
    <button
      type="button"
      onClick={() => onOpenManagement(managementKey)}
      className="brand-pro-calendar-stat brand-focus"
      data-tone={tone}
      data-compact={compact ? 'true' : 'false'}
      aria-label={statTileAriaLabel({
        label,
        value,
        sublabel,
      })}
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
    copy,
    stats,
    management,
    blockedMinutesToday,
    onOpenManagement,
    variant,
    compact,
    showWaitlist = false,
  } = props

  const isCompact = compactForVariant({ variant, compact })

  const tiles = buildStatTiles({
    copy,
    stats,
    management,
    blockedMinutesToday,
    showWaitlist,
  })

  return (
    <div
      className={containerClassName(isCompact)}
      data-calendar-stats-variant={variant ?? (isCompact ? 'mobile' : 'rail')}
      data-calendar-stats-count={tiles.length}
    >
      {tiles.map((tile) => (
        <StatTile
          key={tile.managementKey}
          managementKey={tile.managementKey}
          label={tile.label}
          value={tile.value}
          sublabel={tile.sublabel}
          tone={tile.tone}
          pulse={tile.pulse}
          compact={isCompact}
          onOpenManagement={onOpenManagement}
        />
      ))}
    </div>
  )
}