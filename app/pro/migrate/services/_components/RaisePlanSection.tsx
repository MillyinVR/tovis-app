'use client'

// app/pro/migrate/services/_components/RaisePlanSection.tsx
//
// The "Your raises" section: every below-min service collected into one celebratory
// place (never a popup). Each row expands to a live calculator the pro can play with.

import { useEffect, useMemo, useState } from 'react'

import type { MigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import type { PriceGrace, RaiseStepMode } from '../../_types'
import {
  buildRampSchedule,
  clampCadenceWeeks,
  clampStepValue,
  floorStepValue,
  formatMoney,
  formatRampDate,
} from '../../_utils/raiseRamp'

export type GraceRow = {
  rowId: string
  serviceName: string
  grace: PriceGrace
}

type RaiseConfig = { mode: RaiseStepMode; value: number; cadenceWeeks: number }

export type RaiseConfigChange = {
  mode: RaiseStepMode
  value: number
  cadenceWeeks: number
}

type Props = {
  rows: GraceRow[]
  copy: MigrationCopy['services']['raise']
  onConfigChange?: (rowId: string, config: RaiseConfigChange) => void
}

export function RaisePlanSection({ rows, copy, onConfigChange }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(
    rows[0]?.rowId ?? null,
  )

  if (rows.length === 0) return null

  return (
    <section className="mt-8 overflow-hidden rounded-card border border-accentPrimary/40 bg-accentPrimary/[0.06]">
      <header className="flex flex-col gap-3 border-b border-accentPrimary/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-[17px] font-medium text-textPrimary">
          {rows.length} of your services{' '}
          {rows.length === 1 ? 'is' : 'are'} below the {copy.brand}{' '}
          {copy.headingSuffix} 🎉
        </h2>
        <button
          type="button"
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-full px-4 text-[13px] font-medium hover:opacity-90"
          style={{ background: 'var(--cta)', color: 'rgb(var(--on-cta))' }}
        >
          {copy.acceptAll}
        </button>
      </header>

      <div className="flex flex-col divide-y divide-accentPrimary/15">
        {rows.map((row) => (
          <RaiseRow
            key={row.rowId}
            row={row}
            copy={copy}
            expanded={expandedId === row.rowId}
            onToggle={() =>
              setExpandedId((cur) => (cur === row.rowId ? null : row.rowId))
            }
            onConfigChange={onConfigChange}
          />
        ))}
      </div>
    </section>
  )
}

function RaiseRow({
  row,
  copy,
  expanded,
  onToggle,
  onConfigChange,
}: {
  row: GraceRow
  copy: Props['copy']
  expanded: boolean
  onToggle: () => void
  onConfigChange?: (rowId: string, config: RaiseConfigChange) => void
}) {
  const [config, setConfigState] = useState<RaiseConfig>({
    mode: row.grace.step.mode,
    value: row.grace.step.value,
    cadenceWeeks: row.grace.cadenceWeeks,
  })

  function setConfig(next: RaiseConfig) {
    setConfigState(next)
    onConfigChange?.(row.rowId, next)
  }

  if (!expanded) {
    return (
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[14px] text-textPrimary">{row.serviceName}</span>
          <span className="text-[13px] text-textMuted">
            {formatMoney(row.grace.grandfatheredPrice)} →{' '}
            {formatMoney(row.grace.platformMin)}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-textMuted">
            {config.mode === 'PCT'
              ? `${config.value}% / ${config.cadenceWeeks} wks`
              : `${formatMoney(config.value)} / ${config.cadenceWeeks} wks`}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded-full border border-white/10 px-3 py-1 text-[12px] text-textSecondary hover:border-white/20"
        >
          {copy.tune} ▾
        </button>
      </div>
    )
  }

  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[14px] font-medium text-textPrimary">
          {row.serviceName}
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-full border border-white/10 px-3 py-1 text-[12px] text-textSecondary hover:border-white/20"
        >
          {copy.tune} ▴
        </button>
      </div>
      <RaiseConfigurator
        grace={row.grace}
        config={config}
        onChange={setConfig}
        copy={copy}
      />
    </div>
  )
}

function RaiseConfigurator({
  grace,
  config,
  onChange,
  copy,
}: {
  grace: PriceGrace
  config: RaiseConfig
  onChange: (next: RaiseConfig) => void
  copy: Props['copy']
}) {
  // Capture "today" after mount to avoid SSR/CSR hydration drift on dates.
  const [today, setToday] = useState<Date | null>(null)
  useEffect(() => {
    setToday(new Date())
  }, [])

  const schedule = useMemo(() => {
    if (!today) return []
    return buildRampSchedule(
      {
        ...grace,
        step: { mode: config.mode, value: config.value },
        cadenceWeeks: config.cadenceWeeks,
      },
      today,
    )
  }, [today, grace, config])

  const last = schedule[schedule.length - 1]
  const min = grace.platformMin
  const cur = grace.grandfatheredPrice

  function setMode(mode: RaiseStepMode) {
    const value = mode === 'PCT' ? 10 : floorStepValue('USD', cur)
    onChange({ ...config, mode, value })
  }

  const valueFloor = floorStepValue(config.mode, cur)
  const valueMax = config.mode === 'PCT' ? 50 : Math.max(valueFloor, min - cur)

  return (
    <div className="flex flex-col gap-4">
      {/* Mode toggle + step */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] text-textSecondary">{copy.stepLabel}</span>
        <div
          role="group"
          aria-label="Increase mode"
          className="inline-flex overflow-hidden rounded-full border border-white/15"
        >
          {(['PCT', 'USD'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setMode(mode)}
              className={[
                'px-3.5 py-1.5 text-[12px] transition',
                config.mode === mode
                  ? 'bg-accentPrimary/15 text-accentPrimary'
                  : 'text-textMuted hover:text-textSecondary',
              ].join(' ')}
            >
              {mode === 'PCT' ? copy.modePercent : copy.modeDollars}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="range"
          min={valueFloor}
          max={valueMax}
          step={config.mode === 'PCT' ? 5 : 1}
          value={config.value}
          onChange={(e) =>
            onChange({
              ...config,
              value: clampStepValue(config.mode, Number(e.target.value), cur),
            })
          }
          className="h-1.5 flex-1 cursor-pointer accent-accentPrimary"
          aria-label={copy.stepLabel}
        />
        <span className="min-w-[64px] text-right text-[14px] font-medium text-textPrimary">
          {config.mode === 'PCT' ? `${config.value}%` : formatMoney(config.value)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="min-w-[78px] text-[13px] text-textSecondary">
          {copy.cadenceLabel}
        </span>
        <input
          type="range"
          min={2}
          max={10}
          step={1}
          value={config.cadenceWeeks}
          onChange={(e) =>
            onChange({
              ...config,
              cadenceWeeks: clampCadenceWeeks(Number(e.target.value)),
            })
          }
          className="h-1.5 flex-1 cursor-pointer accent-accentPrimary"
          aria-label={copy.cadenceLabel}
        />
        <span className="min-w-[64px] text-right text-[14px] font-medium text-textPrimary">
          {config.cadenceWeeks} wks
        </span>
      </div>

      <p className="text-[12px] text-textMuted">{copy.floorNote}</p>

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          label={copy.newClients}
          value={formatMoney(min)}
          hint={copy.newClientsHint}
        />
        <MetricCard
          label={copy.existingClients}
          value={formatMoney(cur)}
          hint={copy.existingClientsHint}
        />
        <MetricCard
          label={copy.fullyAtMin}
          value={last ? formatRampDate(last.date) : '—'}
          hint={
            schedule.length
              ? `${schedule.length} ${schedule.length === 1 ? 'step' : 'steps'}`
              : '—'
          }
        />
      </div>

      {/* Schedule */}
      <ol className="flex flex-col gap-1.5">
        {schedule.map((s) => {
          const atMin = s.to === min
          return (
            <li
              key={s.index}
              className={[
                'flex items-center justify-between gap-3 rounded-inner px-3 py-2',
                atMin ? 'bg-fern/12' : 'bg-white/[0.03]',
              ].join(' ')}
            >
              <span className="flex items-center gap-3">
                <span className="min-w-[52px] font-mono text-[11px] uppercase tracking-[0.08em] text-textMuted">
                  Step {s.index}
                </span>
                <span className="text-[13px] text-textSecondary">
                  {formatRampDate(s.date)}
                </span>
              </span>
              <span className="flex items-center gap-2 text-[14px]">
                <span className="font-medium text-textPrimary">
                  {formatMoney(s.to)}
                </span>
                <span
                  className={[
                    'text-[12px]',
                    atMin ? 'text-fern' : 'text-textMuted',
                  ].join(' ')}
                >
                  {atMin ? copy.atMinimum : `+${formatMoney(s.to - s.from)}`}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-inner bg-white/[0.03] p-3">
      <p className="text-[12px] text-textMuted">{label}</p>
      <p className="mt-1 text-[20px] font-medium text-textPrimary">{value}</p>
      <p className="mt-0.5 text-[11px] text-textMuted">{hint}</p>
    </div>
  )
}
