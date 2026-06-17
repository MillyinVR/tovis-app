'use client'

// app/pro/migrate/services/_components/ServiceMapRow.tsx

import { useEffect, useMemo, useRef, useState } from 'react'

import type { MigrationCopy } from '@/lib/brand/defaultMigrationCopy'

import { StatusChip } from '../../_components/StatusChip'
import type { CanonicalService, ServiceMapRow as Row } from '../../_types'
import { formatMoney } from '../../_utils/raiseRamp'

type Props = {
  row: Row
  catalog: CanonicalService[]
  copy: MigrationCopy['services']
  onSelectService: (rowId: string, serviceId: string) => void
}

const BORDER_BY_STATUS: Record<Row['status'], string> = {
  OK: 'border-white/10',
  PRICE_GRACE: 'border-accentPrimary/40',
  UNLICENSED: 'border-white/10 opacity-70',
  NEEDS_ATTENTION: 'border-amber/50',
  REQUEST_PENDING: 'border-white/10',
  SKIPPED: 'border-white/10 opacity-60',
}

export function ServiceMapRow({ row, catalog, copy, onSelectService }: Props) {
  const sel = row.selection
  const mapped =
    sel.kind === 'MAP'
      ? catalog.find((c) => c.id === sel.serviceId) ?? null
      : null

  return (
    <div
      className={[
        'grid grid-cols-1 gap-3 rounded-card border bg-bgSurface p-4 md:grid-cols-[1fr_1.1fr_1fr] md:items-center',
        BORDER_BY_STATUS[row.status],
      ].join(' ')}
    >
      {/* Left — your service */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-textMuted md:hidden">
          {copy.colYours}
        </p>
        <p className="text-[14px] text-textPrimary">{row.sourceName}</p>
        <p className="mt-0.5 text-[12px] text-textMuted">
          {row.sourcePrice != null ? formatMoney(row.sourcePrice) : '—'}
          {row.sourceDurationMinutes != null
            ? ` · ${row.sourceDurationMinutes} min`
            : ''}
        </p>
      </div>

      {/* Center — mapping */}
      <div>
        <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-textMuted md:hidden">
          {copy.colMapped}
        </p>
        <MappingControl
          row={row}
          mapped={mapped}
          catalog={catalog}
          copy={copy}
          onSelectService={onSelectService}
        />
      </div>

      {/* Right — price / availability + status */}
      <div className="flex flex-col items-start gap-2 md:items-end">
        <RightColumn row={row} mapped={mapped} copy={copy} />
        <StatusFooter row={row} copy={copy} />
      </div>
    </div>
  )
}

function MappingControl({
  row,
  mapped,
  catalog,
  copy,
  onSelectService,
}: {
  row: Row
  mapped: CanonicalService | null
  catalog: CanonicalService[]
  copy: MigrationCopy['services']
  onSelectService: (rowId: string, serviceId: string) => void
}) {
  if (row.status === 'UNLICENSED') {
    return (
      <span className="inline-flex items-center gap-2 text-[13px] text-textMuted">
        <span aria-hidden="true">🔒</span> Unavailable
      </span>
    )
  }
  if (row.selection.kind === 'REQUEST_NEW') {
    return (
      <span className="inline-flex items-center gap-2 rounded-[12px] border border-dashed border-amber/50 px-3 py-1.5 text-[13px] text-amber">
        Requested
      </span>
    )
  }
  if (row.selection.kind === 'SKIP') {
    return (
      <ServiceDropdown
        row={row}
        mapped={mapped}
        catalog={catalog}
        copy={copy}
        onSelectService={onSelectService}
        placeholder={row.status === 'SKIPPED' ? copy.skip : 'Choose a service'}
      />
    )
  }
  return (
    <ServiceDropdown
      row={row}
      mapped={mapped}
      catalog={catalog}
      copy={copy}
      onSelectService={onSelectService}
      placeholder="Choose a service"
    />
  )
}

function ServiceDropdown({
  row,
  mapped,
  catalog,
  copy,
  onSelectService,
  placeholder,
}: {
  row: Row
  mapped: CanonicalService | null
  catalog: CanonicalService[]
  copy: MigrationCopy['services']
  onSelectService: (rowId: string, serviceId: string) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = catalog.filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.categoryName.toLowerCase().includes(q),
    )
    const byCat = new Map<string, CanonicalService[]>()
    for (const svc of filtered) {
      const list = byCat.get(svc.categoryName) ?? []
      list.push(svc)
      byCat.set(svc.categoryName, list)
    }
    return [...byCat.entries()]
  }, [catalog, query])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={[
          'flex w-full items-center justify-between gap-2 rounded-[12px] border px-3 py-2 text-left text-[13px] transition',
          open ? 'border-white/25' : 'border-white/10 hover:border-white/20',
        ].join(' ')}
      >
        <span className={mapped ? 'text-textPrimary' : 'text-textMuted'}>
          {mapped ? mapped.name : placeholder}
        </span>
        <span className="text-textMuted" aria-hidden="true">
          ▾
        </span>
      </button>

      {row.status === 'OK' && mapped ? (
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-accentPrimary">
          {copy.bestMatch}
        </p>
      ) : null}

      {open ? (
        <div
          role="listbox"
          className="tovis-glass-strong absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-card border border-white/15 bg-bgSurface p-2 shadow-[0_24px_50px_rgb(var(--shadow-color)/0.4)]"
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.dropdownSearch}
            className="mb-2 w-full rounded-[10px] border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-textPrimary outline-none placeholder:text-textMuted focus:border-white/25"
          />
          {groups.map(([cat, services]) => (
            <div key={cat} className="mb-1">
              <p className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-textMuted">
                {cat}
              </p>
              {services.map((svc) => {
                const selected = mapped?.id === svc.id
                return (
                  <button
                    key={svc.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={!svc.licensedForPro}
                    onClick={() => {
                      onSelectService(row.rowId, svc.id)
                      setOpen(false)
                    }}
                    className={[
                      'flex w-full items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] transition',
                      svc.licensedForPro
                        ? 'hover:bg-white/5'
                        : 'cursor-not-allowed opacity-40',
                      selected ? 'text-accentPrimary' : 'text-textSecondary',
                    ].join(' ')}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-accentPrimary/60"
                        aria-hidden="true"
                      />
                      {svc.name}
                    </span>
                    {selected ? <span aria-hidden="true">✓</span> : null}
                  </button>
                )
              })}
            </div>
          ))}
          <div className="mt-1 border-t border-white/10 pt-1">
            <button
              type="button"
              className="flex w-full rounded-[8px] px-2 py-1.5 text-left text-[13px] text-amber hover:bg-white/5"
            >
              {copy.requestNew}
            </button>
            <button
              type="button"
              className="flex w-full rounded-[8px] px-2 py-1.5 text-left text-[13px] text-textMuted hover:bg-white/5"
            >
              {copy.skip}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function RightColumn({
  row,
  mapped,
  copy,
}: {
  row: Row
  mapped: CanonicalService | null
  copy: MigrationCopy['services']
}) {
  if (row.status === 'UNLICENSED') {
    return <p className="text-[13px] text-textMuted">{copy.lockedUntilLicensed}</p>
  }
  if (row.status === 'SKIPPED' || row.selection.kind === 'SKIP') {
    return <p className="text-[13px] text-textMuted">{copy.notImported}</p>
  }

  const isGrace = row.status === 'PRICE_GRACE'
  const price = row.offering.salonPrice ?? row.sourcePrice
  const min = mapped?.minPrice

  return (
    <div className="flex flex-col items-start gap-1 md:items-end">
      <div className="flex items-baseline gap-2">
        <span
          className={[
            'text-[15px] font-medium',
            isGrace ? 'text-accentPrimary' : 'text-textPrimary',
          ].join(' ')}
        >
          {price != null ? formatMoney(price) : '—'}
        </span>
        {row.offering.salonDurationMinutes != null ? (
          <span className="text-[12px] text-textMuted">
            {row.offering.salonDurationMinutes} min
          </span>
        ) : null}
      </div>
      {isGrace && min != null ? (
        <span className="text-[11px] text-textMuted">
          {copy.raise.brand} min {formatMoney(min)}
        </span>
      ) : null}
      <div className="flex gap-1.5">
        {row.offering.offersInSalon ? <Pill>Salon</Pill> : null}
        {row.offering.offersMobile ? <Pill>Mobile</Pill> : null}
      </div>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-textMuted">
      {children}
    </span>
  )
}

function StatusFooter({
  row,
  copy,
}: {
  row: Row
  copy: MigrationCopy['services']
}) {
  switch (row.status) {
    case 'PRICE_GRACE':
      return <StatusChip variant="accent">🎉 {copy.chips.raiseUnlocked}</StatusChip>
    case 'NEEDS_ATTENTION':
      return <StatusChip variant="gold">{copy.chips.needsAttention}</StatusChip>
    case 'UNLICENSED':
      return <StatusChip variant="muted">{copy.chips.licensedOnly}</StatusChip>
    case 'REQUEST_PENDING':
      return <StatusChip variant="gold">{copy.chips.requestPending}</StatusChip>
    case 'SKIPPED':
      return <StatusChip variant="muted">{copy.chips.skipped}</StatusChip>
    default:
      return null
  }
}
