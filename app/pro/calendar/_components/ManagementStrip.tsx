// app/pro/calendar/_components/ManagementStrip.tsx
'use client'

import type { CalendarStats, ManagementKey, ManagementLists } from '../_types'

// ─── Types ────────────────────────────────────────────────────────────────────

type ManagementStripProps = {
  stats: CalendarStats
  management: ManagementLists
  blockedMinutesToday: number
  showHoursForm: boolean
  setShowHoursForm: (update: (previous: boolean) => boolean) => void
  autoAccept: boolean
  savingAutoAccept: boolean
  onToggleAutoAccept: (next: boolean) => void
  onOpenManagement: (key: ManagementKey) => void
}

type ManagementMetric = {
  key: ManagementKey
  label: string
  value: string | number
  sublabel: string
  tone: 'paper' | 'pending' | 'acid' | 'muted'
}

type MetricCardProps = ManagementMetric & {
  onOpenManagement: (key: ManagementKey) => void
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function formatHoursFromMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0h'

  const rounded = Math.round((minutes / 60) * 10) / 10

  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`
}

function buildMetrics(args: {
  stats: CalendarStats
  management: ManagementLists
  blockedMinutesToday: number
}): ManagementMetric[] {
  const { stats, management, blockedMinutesToday } = args

  return [
    {
      key: 'todaysBookings',
      label: "Today's bookings",
      value: stats?.todaysBookings ?? management.todaysBookings.length,
      sublabel: 'View list',
      tone: 'paper',
    },
    {
      key: 'pendingRequests',
      label: 'Pending requests',
      value: stats?.pendingRequests ?? management.pendingRequests.length,
      sublabel: 'Review',
      tone: 'pending',
    },
    {
      key: 'waitlistToday',
      label: 'Waitlist today',
      value: management.waitlistToday.length,
      sublabel: 'View list',
      tone: 'acid',
    },
    {
      key: 'blockedToday',
      label: 'Blocked time',
      value: formatHoursFromMinutes(blockedMinutesToday),
      sublabel: 'View list',
      tone: 'muted',
    },
  ]
}

function panelClassName(): string {
  return [
    'mb-4 rounded-2xl border border-[var(--line)]',
    'bg-[rgb(var(--surface-glass)_/_0.03)] p-4',
  ].join(' ')
}

function actionButtonClassName(active: boolean): string {
  return [
    'rounded-full border px-3 py-1.5',
    'font-mono text-[10px] font-black uppercase tracking-[0.08em]',
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    active
      ? [
          'border-[rgb(var(--text-primary))]',
          'bg-[rgb(var(--text-primary))]',
          'text-[rgb(var(--bg-primary))]',
        ].join(' ')
      : [
          'border-[var(--line)] bg-transparent',
          'text-[rgb(var(--text-secondary))]',
          'hover:bg-[rgb(var(--surface-glass)_/_0.06)]',
          'hover:text-[rgb(var(--text-primary))]',
        ].join(' '),
  ].join(' ')
}

function metricCardClassName(): string {
  return [
    'brand-pro-calendar-stat brand-focus',
    'min-h-[6rem]',
  ].join(' ')
}

function autoAcceptShellClassName(): string {
  return [
    'mt-3 flex items-center justify-between gap-3 rounded-xl',
    'border border-[var(--line)]',
    'bg-[rgb(var(--bg-secondary))] p-3',
  ].join(' ')
}

function autoAcceptToggleClassName(enabled: boolean): string {
  return [
    'brand-pro-calendar-switch brand-focus shrink-0',
    enabled ? '' : '',
  ].join(' ')
}

function statusText(enabled: boolean, saving: boolean): string {
  if (saving) return 'Saving…'

  return enabled ? 'On' : 'Off'
}

// ─── Exported component ───────────────────────────────────────────────────────

export function ManagementStrip(props: ManagementStripProps) {
  const {
    stats,
    management,
    blockedMinutesToday,
    showHoursForm,
    setShowHoursForm,
    autoAccept,
    savingAutoAccept,
    onToggleAutoAccept,
    onOpenManagement,
  } = props

  const metrics = buildMetrics({
    stats,
    management,
    blockedMinutesToday,
  })

  return (
    <section className={panelClassName()} data-calendar-management-strip="1">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[rgb(var(--accent-primary-hover))]">
            ◆ Calendar management
          </p>

          <h2 className="mt-1 font-display text-2xl font-semibold italic tracking-[-0.04em] text-[rgb(var(--text-primary))]">
            Manage availability.
          </h2>

          <p className="mt-1 text-sm leading-6 text-[rgb(var(--text-secondary))]">
            Review appointments, protect time, and control auto-accept.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowHoursForm((previous) => !previous)}
          className={actionButtonClassName(showHoursForm)}
          aria-pressed={showHoursForm}
        >
          {showHoursForm ? 'Hide hours' : 'Edit hours'}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard
            key={metric.key}
            label={metric.label}
            value={metric.value}
            sublabel={metric.sublabel}
            tone={metric.tone}
            onOpenManagement={onOpenManagement}
          />
        ))}
      </div>

      <div className={autoAcceptShellClassName()}>
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-[rgb(var(--text-primary))]">
            Auto-accept bookings
          </div>

          <div className="mt-0.5 text-sm text-[rgb(var(--text-secondary))]">
            When enabled, new client requests go straight to{' '}
            <span className="font-semibold text-[rgb(var(--text-primary))]">
              Accepted
            </span>
            .
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px] font-black uppercase tracking-[0.08em] text-[rgb(var(--text-muted))]">
            {statusText(autoAccept, savingAutoAccept)}
          </span>

          <button
            type="button"
            onClick={() => onToggleAutoAccept(!autoAccept)}
            disabled={savingAutoAccept}
            className={autoAcceptToggleClassName(autoAccept)}
            data-enabled={autoAccept ? 'true' : 'false'}
            aria-pressed={autoAccept}
            aria-label={`Auto-accept is ${autoAccept ? 'on' : 'off'}`}
          >
            <span className="brand-pro-calendar-switch-thumb" />
          </button>
        </div>
      </div>
    </section>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard(props: MetricCardProps) {
  const {
    key,
    label,
    value,
    sublabel,
    tone,
    onOpenManagement,
  } = props

  return (
    <button
      type="button"
      onClick={() => onOpenManagement(key)}
      className={metricCardClassName()}
      data-tone={tone}
      data-compact="false"
    >
      <span className="brand-pro-calendar-stat-label">{label}</span>

      <span className="brand-pro-calendar-stat-value">{value}</span>

      <span className="brand-pro-calendar-stat-sub">{sublabel}</span>

      {tone === 'pending' && Number(value) > 0 ? (
        <span
          className="brand-pro-calendar-stat-dot"
          data-pulse="true"
          aria-hidden="true"
        />
      ) : null}
    </button>
  )
}