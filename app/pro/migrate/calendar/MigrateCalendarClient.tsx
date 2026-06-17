'use client'

// app/pro/migrate/calendar/MigrateCalendarClient.tsx

import { useMemo, useState } from 'react'

import type { MigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import { MigrationStepper } from '../_components/MigrationStepper'
import { StatusChip } from '../_components/StatusChip'
import { SummaryBar, type SummaryStat } from '../_components/SummaryBar'
import { ToggleSwitch } from '../_components/ToggleSwitch'
import type { BookingTransferRow, MigrateCalendarViewModel } from '../_types'

type Props = {
  copy: MigrationCopy['calendar']
  vm: MigrateCalendarViewModel
}

export function MigrateCalendarClient({ copy, vm }: Props) {
  const [bookings, setBookings] = useState<BookingTransferRow[]>(vm.bookings)

  function setTransfer(rowId: string, transfer: boolean) {
    setBookings((cur) =>
      cur.map((b) =>
        b.rowId === rowId
          ? { ...b, transfer, status: transfer ? b.status : 'SKIPPED' }
          : b,
      ),
    )
  }

  const counts = useMemo(() => {
    let transferring = 0
    let conflicts = 0
    let skipped = 0
    for (const b of bookings) {
      if (b.transfer) transferring += 1
      else skipped += 1
      if (b.transfer && b.conflictNote) conflicts += 1
    }
    return { transferring, conflicts, skipped }
  }, [bookings])

  const stats: SummaryStat[] = [
    { value: String(counts.transferring), label: 'transferring', tone: 'accent' },
    {
      value: String(counts.conflicts),
      label: 'time conflict',
      tone: counts.conflicts > 0 ? 'gold' : 'muted',
    },
    { value: String(counts.skipped), label: 'skipped', tone: 'muted' },
  ]

  return (
    <div className="min-h-screen text-textPrimary">
      <div className="mx-auto w-full max-w-5xl px-4 pt-8">
        <MigrationStepper active="calendar" />

        <header className="mt-6 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[28px] font-medium tracking-[-0.02em]">
            {copy.title}
          </h1>
          <span className="rounded-full bg-white/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-textMuted">
            {bookings.length} {copy.bookingsSuffix}
          </span>
        </header>

        {/* Two-panel: working hours + time blocks */}
        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Working hours */}
          <div className="rounded-card border border-white/10 bg-bgSurface p-4">
            <p className="mb-3 text-[14px] font-medium">{copy.workingHours}</p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {vm.workingHours.map((d) => (
                <div
                  key={d.key}
                  className={[
                    'flex flex-col items-center gap-1 rounded-inner border px-1 py-2 text-center',
                    d.enabled
                      ? 'border-accentPrimary/40 bg-accentPrimary/10'
                      : 'border-white/10 bg-white/[0.02]',
                  ].join(' ')}
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-textMuted">
                    {d.label}
                  </span>
                  <span
                    className={[
                      'text-[12px]',
                      d.enabled ? 'text-textPrimary' : 'text-textMuted',
                    ].join(' ')}
                  >
                    {d.enabled ? d.hours : copy.off}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-textMuted">
              <span>
                {copy.buffer}:{' '}
                <span className="text-textSecondary">{vm.bufferMinutes} min</span>
              </span>
              <span>
                {copy.advance}:{' '}
                <span className="text-textSecondary">{vm.advanceWeeks} weeks</span>
              </span>
            </div>
          </div>

          {/* Time blocks */}
          <div className="rounded-card border border-white/10 bg-bgSurface p-4">
            <p className="mb-3 text-[14px] font-medium">{copy.timeBlocks}</p>
            <div className="flex flex-col gap-2">
              {vm.timeBlocks.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between rounded-inner bg-white/[0.03] px-3 py-2"
                >
                  <span className="text-[13px] text-textPrimary">{b.label}</span>
                  <span className="text-[12px] text-textMuted">
                    {b.range} · {b.cadence}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-textMuted">{copy.timeBlocksNote}</p>
          </div>
        </div>

        {/* Booking transfer */}
        <div className="mt-5 hidden grid-cols-[1.3fr_1.3fr_0.7fr_0.9fr_auto] gap-3 px-4 md:grid">
          {[copy.colWhen, copy.colClient, copy.colDuration, copy.colStatus, copy.colTransfer].map(
            (c, i) => (
              <span
                key={c}
                className={[
                  'font-mono text-[10px] uppercase tracking-[0.12em] text-textMuted',
                  i === 4 ? 'text-right' : '',
                ].join(' ')}
              >
                {c}
              </span>
            ),
          )}
        </div>

        <div className="mt-2 flex flex-col gap-3">
          {bookings.map((b) => (
            <BookingRow
              key={b.rowId}
              row={b}
              copy={copy}
              onToggle={(v) => setTransfer(b.rowId, v)}
            />
          ))}
        </div>

        {/* Past history note */}
        <div className="mt-4 rounded-card border border-white/10 bg-bgSecondary px-4 py-3 text-[13px] text-textSecondary">
          <span className="font-medium text-textPrimary">{vm.pastVisitsCount}</span>{' '}
          {copy.pastNoteSuffix}
        </div>
      </div>

      <SummaryBar stats={stats} cta={{ label: copy.cta }} />
    </div>
  )
}

function BookingRow({
  row,
  copy,
  onToggle,
}: {
  row: BookingTransferRow
  copy: MigrationCopy['calendar']
  onToggle: (v: boolean) => void
}) {
  const dim = !row.transfer
  const pending = row.transfer && row.status === 'PENDING'

  return (
    <div
      className={[
        'rounded-card border bg-bgSurface p-4 transition',
        pending ? 'border-amber/50' : 'border-white/10',
        dim ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.3fr_1.3fr_0.7fr_0.9fr_auto] md:items-center">
        <div className="text-[13px] text-textPrimary">{row.startLabel}</div>
        <div className="text-[13px]">
          <p className="text-textPrimary">{row.clientName}</p>
          <p className="text-textMuted">{row.serviceName}</p>
        </div>
        <div className="text-[13px] text-textMuted">{row.durationMinutes} min</div>
        <div>
          {row.status === 'CONFIRMED' || (row.transfer && row.status !== 'PENDING') ? (
            <StatusChip variant="accent">{copy.chips.confirmed}</StatusChip>
          ) : pending ? (
            <StatusChip variant="gold">{copy.chips.pending}</StatusChip>
          ) : (
            <StatusChip variant="muted">{copy.chips.skipped}</StatusChip>
          )}
        </div>
        <div className="flex md:justify-end">
          <ToggleSwitch
            on={row.transfer}
            onChange={onToggle}
            label={`Transfer ${row.clientName} booking`}
          />
        </div>
      </div>
      {pending && row.conflictNote ? (
        <p className="mt-2 flex items-center gap-2 text-[12px] text-amber">
          <span aria-hidden="true">⚠</span> {row.conflictNote}
        </p>
      ) : null}
    </div>
  )
}
