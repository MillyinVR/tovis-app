'use client'

// app/pro/migrate/services/MigrateServicesClient.tsx
//
// Real service-menu import: upload CSV → client-side parse → match against the
// license-gated catalog (POST /preview) → review/map + tune raises → commit
// (POST /commit). Server types are type-only imports (erased at build).

import Papa from 'papaparse'
import Link from 'next/link'
import { useMemo, useState } from 'react'

import type { MigrationCopy } from '@/lib/brand/defaultMigrationCopy'
import type {
  CatalogOption,
  ServicePreviewRow,
} from '@/lib/migration/serviceImportServer'

import { MigrationStepper } from '../_components/MigrationStepper'
import { SummaryBar, type SummaryStat } from '../_components/SummaryBar'
import type {
  CanonicalService,
  PriceGrace,
  ServiceMapRow as Row,
} from '../_types'
import {
  RaisePlanSection,
  type GraceRow,
  type RaiseConfigChange,
} from './_components/RaisePlanSection'
import { ServiceMapRow } from './_components/ServiceMapRow'

type Phase = 'upload' | 'map' | 'done'
type RawCsvRow = Record<string, string>

type PreviewResponse = {
  ok: boolean
  catalog?: CatalogOption[]
  rows?: ServicePreviewRow[]
  error?: string
}
type CommitResponse = {
  ok: boolean
  summary?: { attempted: number; created: number; skipped: number; rampsCreated: number }
  error?: string
}

const DEFAULT_RAMP: RaiseConfigChange = { mode: 'PCT', value: 10, cadenceWeeks: 10 }

function parseNum(v: string | undefined): number | null {
  if (!v) return null
  const m = v.replace(/,/g, '').match(/\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}

function toCanonical(c: CatalogOption): CanonicalService {
  return {
    id: c.id,
    name: c.name,
    categoryId: c.categoryName ?? 'other',
    categoryName: c.categoryName ?? 'Other',
    minPrice: c.minPrice,
    licensedForPro: true, // catalog is already license-filtered server-side
  }
}

function graceFor(price: number, min: number): PriceGrace {
  return {
    platformMin: min,
    grandfatheredPrice: price,
    step: { mode: DEFAULT_RAMP.mode, value: DEFAULT_RAMP.value },
    cadenceWeeks: DEFAULT_RAMP.cadenceWeeks,
  }
}

function buildRow(p: ServicePreviewRow, byId: Map<string, CatalogOption>): Row {
  const serviceId = p.bestServiceId
  const mapped = serviceId ? byId.get(serviceId) : undefined
  const price = p.sourcePrice ?? mapped?.minPrice ?? null
  const duration = p.sourceDurationMinutes ?? mapped?.defaultDurationMinutes ?? null

  let status: Row['status']
  let priceGrace: PriceGrace | undefined
  let selection: Row['selection']

  if (!serviceId || !mapped) {
    status = 'NEEDS_ATTENTION'
    selection = { kind: 'SKIP' }
  } else if (price !== null && price < mapped.minPrice) {
    status = 'PRICE_GRACE'
    priceGrace = graceFor(price, mapped.minPrice)
    selection = { kind: 'MAP', serviceId }
  } else {
    status = 'OK'
    selection = { kind: 'MAP', serviceId }
  }

  return {
    rowId: String(p.index),
    sourceName: p.sourceName,
    sourcePrice: p.sourcePrice ?? undefined,
    sourceDurationMinutes: p.sourceDurationMinutes ?? undefined,
    suggestedServiceId: serviceId,
    selection,
    offering: {
      offersInSalon: true,
      offersMobile: false,
      salonPrice: price ?? undefined,
      salonDurationMinutes: duration ?? undefined,
    },
    priceGrace,
    status,
  }
}

export function MigrateServicesClient({ copy }: { copy: MigrationCopy['services'] }) {
  const [phase, setPhase] = useState<Phase>('upload')
  const [catalog, setCatalog] = useState<CatalogOption[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [rampConfigs, setRampConfigs] = useState<Map<string, RaiseConfigChange>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; skipped: number; rampsCreated: number } | null>(
    null,
  )

  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog])
  const canonical = useMemo(() => catalog.map(toCanonical), [catalog])

  function handleFile(file: File): void {
    setError(null)
    Papa.parse<RawCsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (res) => {
        const headers = res.meta.fields ?? []
        const data = res.data.filter((r): r is RawCsvRow => Boolean(r) && typeof r === 'object')
        if (headers.length === 0 || data.length === 0) {
          setError(copy.parseError)
          return
        }
        const find = (subs: string[]) =>
          headers.find((h) => subs.some((s) => h.toLowerCase().includes(s)))
        const nameCol = find(['service', 'name', 'item']) ?? headers[0]
        const priceCol = find(['price', 'cost', 'rate', 'amount'])
        const durationCol = find(['duration', 'time', 'min', 'length'])

        const menuRows = data
          .map((r) => ({
            name: (nameCol ? r[nameCol] : '')?.trim() ?? '',
            price: priceCol ? parseNum(r[priceCol]) : null,
            durationMinutes: durationCol ? parseNum(r[durationCol]) : null,
          }))
          .filter((r) => r.name.length > 0)

        if (menuRows.length === 0) {
          setError(copy.parseError)
          return
        }
        await runPreview(menuRows)
      },
      error: () => setError(copy.parseError),
    })
  }

  async function runPreview(
    menuRows: Array<{ name: string; price: number | null; durationMinutes: number | null }>,
  ): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/pro/migrate/services/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: menuRows }),
      })
      const data: PreviewResponse = await res.json()
      if (!res.ok || !data.ok || !data.catalog || !data.rows) {
        setError(data.error ?? 'Could not match your menu.')
        return
      }
      const byId = new Map(data.catalog.map((c) => [c.id, c]))
      setCatalog(data.catalog)
      setRows(data.rows.map((p) => buildRow(p, byId)))
      setRampConfigs(new Map())
      setPhase('map')
    } catch {
      setError('Could not match your menu.')
    } finally {
      setBusy(false)
    }
  }

  function handleSelectService(rowId: string, serviceId: string): void {
    setRows((cur) =>
      cur.map((r) => {
        if (r.rowId !== rowId) return r
        const mapped = catalogById.get(serviceId)
        if (!mapped) return r
        const price = r.offering.salonPrice ?? r.sourcePrice ?? mapped.minPrice
        const duration =
          r.offering.salonDurationMinutes ??
          r.sourceDurationMinutes ??
          mapped.defaultDurationMinutes
        const isGrace = price < mapped.minPrice
        return {
          ...r,
          selection: { kind: 'MAP', serviceId },
          offering: { ...r.offering, salonPrice: price, salonDurationMinutes: duration },
          status: isGrace ? 'PRICE_GRACE' : 'OK',
          priceGrace: isGrace ? graceFor(price, mapped.minPrice) : undefined,
        }
      }),
    )
  }

  const graceRows: GraceRow[] = useMemo(
    () =>
      rows
        .filter((r) => r.status === 'PRICE_GRACE' && r.priceGrace)
        .map((r) => {
          const sel = r.selection
          const name =
            sel.kind === 'MAP' ? catalogById.get(sel.serviceId)?.name ?? r.sourceName : r.sourceName
          return { rowId: r.rowId, serviceName: name, grace: r.priceGrace! }
        }),
    [rows, catalogById],
  )

  const counts = useMemo(() => {
    let willAdd = 0
    let raises = 0
    let needsAttention = 0
    for (const r of rows) {
      if (r.status === 'OK' || r.status === 'PRICE_GRACE') willAdd += 1
      if (r.status === 'PRICE_GRACE') raises += 1
      if (r.status === 'NEEDS_ATTENTION') needsAttention += 1
    }
    return { willAdd, raises, needsAttention }
  }, [rows])

  async function runCommit(): Promise<void> {
    const decisions = rows.flatMap((r) => {
      if (r.selection.kind !== 'MAP') return []
      if (r.status !== 'OK' && r.status !== 'PRICE_GRACE') return []
      const cfg = rampConfigs.get(r.rowId) ?? DEFAULT_RAMP
      return [
        {
          serviceId: r.selection.serviceId,
          offersInSalon: true,
          offersMobile: false,
          salonPrice: r.offering.salonPrice ?? null,
          salonDurationMinutes: r.offering.salonDurationMinutes ?? null,
          mobilePrice: null,
          mobileDurationMinutes: null,
          ramp: { stepMode: cfg.mode, stepValue: cfg.value, cadenceWeeks: cfg.cadenceWeeks },
        },
      ]
    })

    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/pro/migrate/services/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions }),
      })
      const data: CommitResponse = await res.json()
      if (!res.ok || !data.ok || !data.summary) {
        setError(data.error ?? 'Could not add your services.')
        return
      }
      setResult({
        created: data.summary.created,
        skipped: data.summary.skipped,
        rampsCreated: data.summary.rampsCreated,
      })
      setPhase('done')
    } catch {
      setError('Could not add your services.')
    } finally {
      setBusy(false)
    }
  }

  const stats: SummaryStat[] = [
    { value: String(counts.willAdd), label: 'will be added', tone: 'accent' },
    { value: `🎉 ${counts.raises}`, label: 'raises unlocked', tone: 'accent' },
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

        <h1 className="mt-6 font-display text-[28px] font-medium tracking-[-0.02em]">
          {copy.title}
        </h1>

        {error ? (
          <div className="mt-4 rounded-card border border-ember/40 bg-ember/[0.06] px-4 py-3 text-[13px] text-ember">
            {error}
          </div>
        ) : null}

        {phase === 'upload' ? <UploadStep copy={copy} onFile={handleFile} busy={busy} /> : null}

        {phase === 'map' ? (
          <>
            <p className="mt-3 max-w-2xl text-[14px] text-textSecondary">{copy.subtitle}</p>

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
                  catalog={canonical}
                  copy={copy}
                  onSelectService={handleSelectService}
                />
              ))}
            </div>

            <RaisePlanSection
              rows={graceRows}
              copy={copy.raise}
              onConfigChange={(rowId, cfg) =>
                setRampConfigs((cur) => new Map(cur).set(rowId, cfg))
              }
            />
          </>
        ) : null}

        {phase === 'done' && result ? (
          <DoneStep copy={copy} result={result} />
        ) : null}
      </div>

      {phase === 'map' ? (
        <SummaryBar
          stats={stats}
          cta={{
            label: busy ? copy.importing : copy.addBtn,
            disabled: busy || counts.needsAttention > 0 || counts.willAdd === 0,
            onClick: runCommit,
          }}
        />
      ) : null}
    </div>
  )
}

function UploadStep({
  copy,
  onFile,
  busy,
}: {
  copy: MigrationCopy['services']
  onFile: (file: File) => void
  busy: boolean
}) {
  return (
    <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
      <div className="rounded-card border border-white/10 bg-bgSurface p-5">
        <h2 className="font-display text-[16px] font-medium">{copy.guideTitle}</h2>
        <ol className="mt-3 flex flex-col gap-3">
          {copy.guideSteps.map((step, i) => (
            <li key={step} className="flex gap-3 text-[14px] text-textSecondary">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accentPrimary/12 font-mono text-[12px] text-accentPrimary"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-white/15 bg-bgSurface p-8 text-center">
        <p className="text-[15px] font-medium">{copy.upload}</p>
        <p className="text-[13px] text-textMuted">{copy.uploadHint}</p>
        <label className="mt-2 inline-flex h-11 cursor-pointer items-center justify-center rounded-full border border-white/15 px-6 text-[14px] font-medium hover:border-white/30">
          {busy ? copy.importing : copy.chooseFile}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onFile(file)
              e.target.value = ''
            }}
          />
        </label>
      </div>
    </div>
  )
}

function DoneStep({
  copy,
  result,
}: {
  copy: MigrationCopy['services']
  result: { created: number; skipped: number; rampsCreated: number }
}) {
  return (
    <div className="mt-6 flex flex-col items-center gap-4 rounded-card border border-white/10 bg-bgSecondary px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-fern/15 text-[22px] text-fern" aria-hidden="true">
        ✓
      </span>
      <h2 className="font-display text-[20px] font-medium">{copy.resultTitle}</h2>
      <p className="text-[14px] text-textSecondary">
        {result.created} added · {result.skipped} skipped
        {result.rampsCreated > 0 ? ` · 🎉 ${result.rampsCreated} raises` : ''}
      </p>
      <Link
        href="/pro/migrate/clients"
        className="inline-flex h-10 items-center justify-center rounded-full px-6 text-[14px] font-medium"
        style={{ background: 'var(--cta)', color: 'rgb(var(--on-cta))' }}
      >
        {copy.cta} →
      </Link>
    </div>
  )
}
