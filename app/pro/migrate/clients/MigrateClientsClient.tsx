'use client'

// app/pro/migrate/clients/MigrateClientsClient.tsx

import { useMemo, useState } from 'react'

import type { MigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import { ColumnMappingBanner } from '../_components/ColumnMappingBanner'
import { MigrationStepper } from '../_components/MigrationStepper'
import { StatusChip } from '../_components/StatusChip'
import { SummaryBar, type SummaryStat } from '../_components/SummaryBar'
import { ToggleSwitch } from '../_components/ToggleSwitch'
import type {
  ClientImportRow,
  DupeResolution,
  MigrateClientsViewModel,
} from '../_types'

type Props = {
  copy: MigrationCopy['clients']
  vm: MigrateClientsViewModel
}

function initials(r: ClientImportRow): string {
  return `${r.firstName[0] ?? ''}${r.lastName[0] ?? ''}`.toUpperCase()
}

export function MigrateClientsClient({ copy, vm }: Props) {
  const [rows, setRows] = useState<ClientImportRow[]>(vm.rows)
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      `${r.firstName} ${r.lastName} ${r.email ?? ''} ${r.phone ?? ''}`
        .toLowerCase()
        .includes(q),
    )
  }, [rows, query])

  function setIncluded(rowId: string, included: boolean) {
    setRows((cur) => cur.map((r) => (r.rowId === rowId ? { ...r, included } : r)))
  }
  function resolveDupe(rowId: string, resolution: DupeResolution) {
    setRows((cur) =>
      cur.map((r) => (r.rowId === rowId ? { ...r, dupeResolution: resolution } : r)),
    )
  }
  function setAll(included: boolean) {
    const ids = new Set(visible.map((r) => r.rowId))
    setRows((cur) => cur.map((r) => (ids.has(r.rowId) ? { ...r, included } : r)))
  }

  const counts = useMemo(() => {
    let imported = 0
    let autoMatched = 0
    let dupes = 0
    let excluded = 0
    for (const r of rows) {
      if (!r.included) excluded += 1
      else if (r.match !== 'MISSING_INFO') imported += 1
      if (r.match === 'AUTO_MATCHED') autoMatched += 1
      if (r.match === 'POSSIBLE_DUPE' && r.dupeResolution === 'UNRESOLVED')
        dupes += 1
    }
    return { imported, autoMatched, dupes, excluded }
  }, [rows])

  const blockingMissing = rows.some(
    (r) => r.included && r.match === 'MISSING_INFO',
  )
  const ctaDisabled = counts.dupes > 0 || blockingMissing

  const stats: SummaryStat[] = [
    { value: String(counts.imported), label: 'will be imported', tone: 'accent' },
    { value: String(counts.autoMatched), label: 'auto-matched', tone: 'accent' },
    {
      value: String(counts.dupes),
      label: 'to resolve',
      tone: counts.dupes > 0 ? 'gold' : 'muted',
    },
    { value: String(counts.excluded), label: 'excluded', tone: 'muted' },
  ]

  return (
    <div className="min-h-screen text-textPrimary">
      <div className="mx-auto w-full max-w-5xl px-4 pt-8">
        <MigrationStepper active="clients" />

        <header className="mt-6 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[28px] font-medium tracking-[-0.02em]">
            {copy.title}
          </h1>
          <span className="rounded-full bg-white/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-textMuted">
            {vm.contactsFound} {copy.contactsSuffix}
          </span>
        </header>

        <div className="mt-5">
          <ColumnMappingBanner mappings={vm.columnMappings} />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.search}
            className="h-9 w-full max-w-xs rounded-[12px] border border-white/10 bg-white/[0.03] px-3 text-[13px] text-textPrimary outline-none placeholder:text-textMuted focus:border-white/25"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAll(true)}
              className="rounded-full border border-white/10 px-3 py-1.5 text-[12px] text-textSecondary hover:border-white/20"
            >
              {copy.selectAll}
            </button>
            <button
              type="button"
              onClick={() => setAll(false)}
              className="rounded-full border border-white/10 px-3 py-1.5 text-[12px] text-textSecondary hover:border-white/20"
            >
              {copy.deselectAll}
            </button>
          </div>
        </div>

        <p className="mt-4 text-[12px] text-textMuted">{copy.noMessages}</p>

        <div className="mt-3 flex flex-col gap-3">
          {visible.map((row) => (
            <ClientRow
              key={row.rowId}
              row={row}
              copy={copy}
              onToggle={(v) => setIncluded(row.rowId, v)}
              onResolve={(res) => resolveDupe(row.rowId, res)}
            />
          ))}
        </div>
      </div>

      <SummaryBar stats={stats} cta={{ label: copy.cta, disabled: ctaDisabled }} />
    </div>
  )
}

function ClientRow({
  row,
  copy,
  onToggle,
  onResolve,
}: {
  row: ClientImportRow
  copy: MigrationCopy['clients']
  onToggle: (v: boolean) => void
  onResolve: (res: DupeResolution) => void
}) {
  const dim = !row.included
  const dupeBorder =
    row.match === 'POSSIBLE_DUPE' && row.dupeResolution === 'UNRESOLVED'
  const missing = row.match === 'MISSING_INFO'

  return (
    <div
      className={[
        'rounded-card border bg-bgSurface p-4 transition',
        dupeBorder
          ? 'border-amber/50'
          : missing
            ? 'border-ember/40'
            : 'border-white/10',
        dim ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_1.2fr_1fr_0.8fr_auto] md:items-center">
        {/* Client */}
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accentPrimary/15 text-[12px] font-medium text-accentPrimary"
            aria-hidden="true"
          >
            {initials(row)}
          </span>
          <span className="text-[14px] text-textPrimary">
            {row.firstName} {row.lastName}
          </span>
        </div>

        {/* Contact */}
        <div className="text-[13px] text-textSecondary">
          {row.email ? <p>{row.email}</p> : null}
          {row.phone ? <p className="text-textMuted">{row.phone}</p> : null}
          {!row.email && !row.phone ? (
            <p className="text-ember">{copy.noContact}</p>
          ) : null}
        </div>

        {/* Match */}
        <div>
          <MatchChip row={row} copy={copy} />
        </div>

        {/* Last visit */}
        <div className="text-[13px] text-textMuted">
          {row.lastVisit ?? '—'}
          {row.visitCount != null ? (
            <span className="block text-[11px]">{row.visitCount} visits</span>
          ) : null}
        </div>

        {/* Include */}
        <div className="flex items-center gap-2 md:justify-end">
          <ToggleSwitch
            on={row.included}
            onChange={onToggle}
            label={`Include ${row.firstName} ${row.lastName}`}
          />
          {dim ? (
            <span className="text-[11px] text-textMuted md:hidden">
              {copy.chips.excluded}
            </span>
          ) : null}
        </div>
      </div>

      {dupeBorder ? <DupePanel copy={copy} onResolve={onResolve} /> : null}
    </div>
  )
}

function MatchChip({
  row,
  copy,
}: {
  row: ClientImportRow
  copy: MigrationCopy['clients']
}) {
  if (!row.included) return <StatusChip variant="muted">{copy.chips.excluded}</StatusChip>
  switch (row.match) {
    case 'AUTO_MATCHED':
      return <StatusChip variant="accent">{copy.chips.autoMatched}</StatusChip>
    case 'NEW':
      return <StatusChip variant="muted">{copy.chips.newClient}</StatusChip>
    case 'POSSIBLE_DUPE':
      return row.dupeResolution === 'MERGE' ? (
        <StatusChip variant="accent">Merged</StatusChip>
      ) : row.dupeResolution === 'SEPARATE' ? (
        <StatusChip variant="muted">Kept separate</StatusChip>
      ) : (
        <StatusChip variant="violet">{copy.chips.possibleDupe}</StatusChip>
      )
    case 'MISSING_INFO':
      return <StatusChip variant="warn">{copy.chips.missingInfo}</StatusChip>
    default:
      return null
  }
}

function DupePanel({
  copy,
  onResolve,
}: {
  copy: MigrationCopy['clients']
  onResolve: (res: DupeResolution) => void
}) {
  return (
    <div className="mt-3 rounded-inner border border-acid/30 bg-acid/[0.06] p-3">
      <p className="mb-2 text-[13px] text-textPrimary">{copy.dupe.question}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onResolve('MERGE')}
          className="flex flex-col items-start rounded-inner border border-accentPrimary/40 bg-accentPrimary/10 px-3 py-2 text-left hover:border-accentPrimary/60"
        >
          <span className="text-[13px] font-medium text-accentPrimary">
            {copy.dupe.merge}
          </span>
          <span className="text-[12px] text-textMuted">{copy.dupe.mergeHint}</span>
        </button>
        <button
          type="button"
          onClick={() => onResolve('SEPARATE')}
          className="flex flex-col items-start rounded-inner border border-white/10 px-3 py-2 text-left hover:border-white/20"
        >
          <span className="text-[13px] font-medium text-textPrimary">
            {copy.dupe.separate}
          </span>
          <span className="text-[12px] text-textMuted">{copy.dupe.separateHint}</span>
        </button>
      </div>
    </div>
  )
}
