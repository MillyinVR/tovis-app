'use client'

// app/pro/migrate/services/MigrateServicesClient.tsx

import { useMemo, useState } from 'react'

import type { MigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import { ColumnMappingBanner } from '../_components/ColumnMappingBanner'
import { MigrationStepper } from '../_components/MigrationStepper'
import { SummaryBar, type SummaryStat } from '../_components/SummaryBar'
import type { MigrateServicesViewModel, ServiceMapRow as Row } from '../_types'
import { RaisePlanSection, type GraceRow } from './_components/RaisePlanSection'
import { ServiceMapRow } from './_components/ServiceMapRow'

type Props = {
  copy: MigrationCopy['services']
  vm: MigrateServicesViewModel
}

export function MigrateServicesClient({ copy, vm }: Props) {
  const [rows, setRows] = useState<Row[]>(vm.rows)

  function handleSelectService(rowId: string, serviceId: string) {
    setRows((cur) =>
      cur.map((r) =>
        r.rowId === rowId
          ? {
              ...r,
              selection: { kind: 'MAP', serviceId },
              // picking a confident match resolves a "needs attention" row
              status: r.status === 'NEEDS_ATTENTION' ? 'OK' : r.status,
            }
          : r,
      ),
    )
  }

  const graceRows: GraceRow[] = useMemo(() => {
    return rows
      .filter((r) => r.status === 'PRICE_GRACE' && r.priceGrace)
      .map((r) => {
        const sel = r.selection
        const mapped =
          sel.kind === 'MAP'
            ? vm.catalog.find((c) => c.id === sel.serviceId)
            : undefined
        return {
          rowId: r.rowId,
          serviceName: mapped?.name ?? r.sourceName,
          grace: r.priceGrace!,
        }
      })
  }, [rows, vm.catalog])

  const counts = useMemo(() => {
    let willAdd = 0
    let raises = 0
    let skipped = 0
    let needsAttention = 0
    for (const r of rows) {
      if (r.status === 'OK' || r.status === 'PRICE_GRACE') willAdd += 1
      if (r.status === 'PRICE_GRACE') raises += 1
      if (r.status === 'SKIPPED') skipped += 1
      if (r.status === 'NEEDS_ATTENTION') needsAttention += 1
    }
    return { willAdd, raises, skipped, needsAttention }
  }, [rows])

  const stats: SummaryStat[] = [
    { value: String(counts.willAdd), label: 'will be added', tone: 'accent' },
    { value: `🎉 ${counts.raises}`, label: 'raises unlocked', tone: 'accent' },
    { value: String(counts.skipped), label: 'skipped', tone: 'muted' },
    {
      value: String(counts.needsAttention),
      label: 'need attention',
      tone: counts.needsAttention > 0 ? 'gold' : 'muted',
    },
  ]

  return (
    <div className="min-h-screen text-textPrimary">
      <div className="mx-auto w-full max-w-5xl px-4 pt-8">
        <MigrationStepper active="services" />

        <header className="mt-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[28px] font-medium tracking-[-0.02em]">
              {copy.title}
            </h1>
            <span className="rounded-full bg-white/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-textMuted">
              {rows.length} {copy.importedSuffix}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-[14px] text-textSecondary">
            {copy.subtitle}
          </p>
        </header>

        <div className="mt-5">
          <ColumnMappingBanner mappings={vm.columnMappings} />
        </div>

        {/* Desktop column headers */}
        <div className="mt-5 hidden grid-cols-[1fr_1.1fr_1fr] gap-3 px-4 md:grid">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-textMuted">
            {copy.colYours}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-textMuted">
            {copy.colMapped}
          </span>
          <span className="text-right font-mono text-[10px] uppercase tracking-[0.12em] text-textMuted">
            {copy.colPrice}
          </span>
        </div>

        <div className="mt-2 flex flex-col gap-3">
          {rows.map((row) => (
            <ServiceMapRow
              key={row.rowId}
              row={row}
              catalog={vm.catalog}
              copy={copy}
              onSelectService={handleSelectService}
            />
          ))}
        </div>

        <RaisePlanSection rows={graceRows} copy={copy.raise} />
      </div>

      <SummaryBar
        stats={stats}
        cta={{ label: copy.cta, disabled: counts.needsAttention > 0 }}
      />
    </div>
  )
}
