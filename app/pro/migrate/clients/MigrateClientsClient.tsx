'use client'

// app/pro/migrate/clients/MigrateClientsClient.tsx
//
// Real client-import flow: upload CSV → map columns → live dedupe preview
// (POST /preview) → commit (POST /commit). All data comes from the server,
// which reuses upsertProClient. Type-only imports from the server module are
// erased at build time, so no server code is bundled into the client.

import Papa from 'papaparse'
import Link from 'next/link'
import { useMemo, useState } from 'react'

import type { MigrationCopy } from '@/lib/brand/defaultMigrationCopy'
import type {
  ClientImportField,
  ColumnMapping,
  RawCsvRow,
} from '@/lib/migration/clientImport'
import type { ClientImportPreviewRow } from '@/lib/migration/clientImportServer'

import { MigrationStepper } from '../_components/MigrationStepper'
import { StatusChip } from '../_components/StatusChip'
import { SummaryBar, type SummaryStat } from '../_components/SummaryBar'
import { ToggleSwitch } from '../_components/ToggleSwitch'

type Phase = 'upload' | 'map' | 'preview' | 'done'

type PreviewResponse = {
  ok: boolean
  rows?: ClientImportPreviewRow[]
  error?: string
}

type CommitResponse = {
  ok: boolean
  summary?: { attempted: number; imported: number; failed: number; skipped: number }
  error?: string
}

const FIELD_ORDER: ClientImportField[] = ['firstName', 'lastName', 'email', 'phone']
const REQUIRED_FIELDS: ClientImportField[] = ['firstName', 'lastName']

function guessMapping(headers: string[]): ColumnMapping {
  const find = (subs: string[]): string | undefined =>
    headers.find((h) => subs.some((s) => h.toLowerCase().includes(s)))
  const mapping: ColumnMapping = {}
  const first = find(['first'])
  const last = find(['last', 'surname'])
  const email = find(['email', 'e-mail'])
  const phone = find(['phone', 'mobile', 'cell'])
  if (first) mapping.firstName = first // pii-plaintext-read-ok: CSV column-header names, not contact values
  if (last) mapping.lastName = last // pii-plaintext-read-ok: CSV column-header names, not contact values
  if (email) mapping.email = email // pii-plaintext-read-ok: CSV column-header names, not contact values
  if (phone) mapping.phone = phone // pii-plaintext-read-ok: CSV column-header names, not contact values
  return mapping
}

export function MigrateClientsClient({ copy }: { copy: MigrationCopy['clients'] }) {
  const [phase, setPhase] = useState<Phase>('upload')
  const [rawRows, setRawRows] = useState<RawCsvRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [previewRows, setPreviewRows] = useState<ClientImportPreviewRow[]>([])
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ imported: number; skipped: number; failed: number } | null>(
    null,
  )

  const mappingValid = REQUIRED_FIELDS.every((f) => Boolean(mapping[f]))

  function handleFile(file: File): void {
    setError(null)
    Papa.parse<RawCsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const fields = res.meta.fields ?? []
        const rows = res.data.filter((r): r is RawCsvRow => Boolean(r) && typeof r === 'object')
        if (fields.length === 0 || rows.length === 0) {
          setError(copy.parseError)
          return
        }
        setHeaders(fields)
        setRawRows(rows)
        setMapping(guessMapping(fields))
        setPhase('map')
      },
      error: () => setError(copy.parseError),
    })
  }

  async function runPreview(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/pro/migrate/clients/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rawRows, mapping }),
      })
      const data: PreviewResponse = await res.json()
      if (!res.ok || !data.ok || !data.rows) {
        setError(data.error ?? 'Could not preview the import.')
        return
      }
      setPreviewRows(data.rows)
      setExcluded(new Set(data.rows.filter((r) => !r.importable).map((r) => r.index)))
      setPhase('preview')
    } catch {
      setError('Could not preview the import.')
    } finally {
      setBusy(false)
    }
  }

  async function runCommit(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/pro/migrate/clients/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rawRows, mapping, excludeIndices: [...excluded] }),
      })
      const data: CommitResponse = await res.json()
      if (!res.ok || !data.ok || !data.summary) {
        setError(data.error ?? 'Could not import your clients.')
        return
      }
      setResult({
        imported: data.summary.imported,
        skipped: data.summary.skipped,
        failed: data.summary.failed,
      })
      setPhase('done')
    } catch {
      setError('Could not import your clients.')
    } finally {
      setBusy(false)
    }
  }

  function reset(): void {
    setPhase('upload')
    setRawRows([])
    setHeaders([])
    setMapping({})
    setPreviewRows([])
    setExcluded(new Set())
    setResult(null)
    setError(null)
  }

  const includedCount = useMemo(
    () => previewRows.filter((r) => r.importable && !excluded.has(r.index)).length,
    [previewRows, excluded],
  )

  const stats: SummaryStat[] = [
    { value: String(includedCount), label: 'will be imported', tone: 'accent' },
    {
      value: String(previewRows.filter((r) => r.match === 'EXISTING').length),
      label: 'already in book',
      tone: 'accent',
    },
    {
      value: String(previewRows.filter((r) => !r.importable).length),
      label: 'needs info',
      tone: previewRows.some((r) => !r.importable) ? 'gold' : 'muted',
    },
  ]

  return (
    <div className="min-h-screen text-textPrimary">
      <div className="mx-auto w-full max-w-5xl px-4 pt-8">
        <MigrationStepper active="clients" />

        <h1 className="mt-6 font-display text-[28px] font-medium tracking-[-0.02em]">
          {copy.title}
        </h1>

        {error ? (
          <div className="mt-4 rounded-card border border-ember/40 bg-ember/[0.06] px-4 py-3 text-[13px] text-ember">
            {error}
          </div>
        ) : null}

        {phase === 'upload' ? (
          <UploadStep copy={copy} onFile={handleFile} />
        ) : null}

        {phase === 'map' ? (
          <MapStep
            copy={copy}
            headers={headers}
            mapping={mapping}
            setMapping={setMapping}
            rowCount={rawRows.length}
            valid={mappingValid}
            busy={busy}
            onBack={reset}
            onContinue={runPreview}
          />
        ) : null}

        {phase === 'preview' ? (
          <PreviewStep
            copy={copy}
            rows={previewRows}
            excluded={excluded}
            onToggle={(index, include) => {
              setExcluded((cur) => {
                const next = new Set(cur)
                if (include) next.delete(index)
                else next.add(index)
                return next
              })
            }}
          />
        ) : null}

        {phase === 'done' && result ? (
          <DoneStep copy={copy} result={result} onReset={reset} />
        ) : null}
      </div>

      {phase === 'preview' ? (
        <SummaryBar
          stats={stats}
          cta={{
            label: busy ? copy.importing : copy.importBtn,
            disabled: busy || includedCount === 0,
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
}: {
  copy: MigrationCopy['clients']
  onFile: (file: File) => void
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
          {copy.chooseFile}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
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

function MapStep({
  copy,
  headers,
  mapping,
  setMapping,
  rowCount,
  valid,
  busy,
  onBack,
  onContinue,
}: {
  copy: MigrationCopy['clients']
  headers: string[]
  mapping: ColumnMapping
  setMapping: (m: ColumnMapping) => void
  rowCount: number
  valid: boolean
  busy: boolean
  onBack: () => void
  onContinue: () => void
}) {
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-[18px] font-medium">{copy.mapTitle}</h2>
        <span className="rounded-full bg-white/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-textMuted">
          {rowCount} rows
        </span>
      </div>
      <p className="mt-1 text-[13px] text-textMuted">{copy.mapHint}</p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELD_ORDER.map((field) => (
          <label key={field} className="flex flex-col gap-1.5">
            <span className="text-[13px] text-textSecondary">
              {copy.fields[field]}
              {REQUIRED_FIELDS.includes(field) ? (
                <span className="text-ember"> *</span>
              ) : null}
            </span>
            <select
              value={mapping[field] ?? ''}
              onChange={(e) => {
                const next: ColumnMapping = { ...mapping }
                if (e.target.value) next[field] = e.target.value
                else delete next[field]
                setMapping(next)
              }}
              className="h-10 rounded-[12px] border border-white/10 bg-white/[0.03] px-3 text-[14px] text-textPrimary outline-none focus:border-white/25"
            >
              <option value="">{copy.unmapped}</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-white/10 px-4 py-2 text-[13px] text-textSecondary hover:border-white/20"
        >
          {copy.reparse}
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={!valid || busy}
          className="inline-flex h-10 items-center justify-center rounded-full px-6 text-[14px] font-medium disabled:opacity-50"
          style={{ background: 'var(--cta)', color: 'rgb(var(--on-cta))' }}
        >
          {busy ? copy.importing : copy.previewTitle} →
        </button>
      </div>
    </div>
  )
}

function PreviewStep({
  copy,
  rows,
  excluded,
  onToggle,
}: {
  copy: MigrationCopy['clients']
  rows: ClientImportPreviewRow[]
  excluded: Set<number>
  onToggle: (index: number, include: boolean) => void
}) {
  return (
    <div className="mt-5">
      <h2 className="font-display text-[18px] font-medium">{copy.previewTitle}</h2>
      <p className="mt-1 text-[12px] text-textMuted">{copy.noMessages}</p>

      <div className="mt-3 flex flex-col gap-3">
        {rows.map((row) => {
          const included = row.importable && !excluded.has(row.index)
          // Imported contact the pro is reviewing — plaintext display is the point.
          const fullName = `${row.firstName} ${row.lastName}` // pii-plaintext-read-ok: pro reviews own imported contacts
          const email = row.email // pii-plaintext-read-ok: pro reviews own imported contacts
          const phone = row.phone // pii-plaintext-read-ok: pro reviews own imported contacts
          return (
            <div
              key={row.index}
              className={[
                'rounded-card border bg-bgSurface p-4 transition',
                row.match === 'MISSING_INFO' ? 'border-ember/40' : 'border-white/10',
                included ? '' : 'opacity-60',
              ].join(' ')}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_1.4fr_1fr_auto] md:items-center">
                <span className="text-[14px] text-textPrimary">{fullName}</span>
                <div className="text-[13px] text-textSecondary">
                  {email ? <p>{email}</p> : null}
                  {phone ? <p className="text-textMuted">{phone}</p> : null}
                  {!email && !phone ? (
                    <p className="text-ember">{copy.noContact}</p>
                  ) : null}
                </div>
                <div>
                  {row.match === 'EXISTING' ? (
                    <StatusChip variant="accent">{copy.chips.existing}</StatusChip>
                  ) : row.match === 'MISSING_INFO' ? (
                    <StatusChip variant="warn">{copy.chips.missingInfo}</StatusChip>
                  ) : (
                    <StatusChip variant="muted">{copy.chips.newClient}</StatusChip>
                  )}
                </div>
                <div className="flex md:justify-end">
                  {row.importable ? (
                    <ToggleSwitch
                      on={included}
                      onChange={(v) => onToggle(row.index, v)}
                      label={`Include ${fullName}`}
                    />
                  ) : (
                    <span className="text-[11px] text-textMuted">{copy.chips.excluded}</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DoneStep({
  copy,
  result,
  onReset,
}: {
  copy: MigrationCopy['clients']
  result: { imported: number; skipped: number; failed: number }
  onReset: () => void
}) {
  return (
    <div className="mt-6 flex flex-col items-center gap-4 rounded-card border border-white/10 bg-bgSecondary px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-fern/15 text-[22px] text-fern" aria-hidden="true">
        ✓
      </span>
      <h2 className="font-display text-[20px] font-medium">{copy.resultTitle}</h2>
      <p className="text-[14px] text-textSecondary">
        {result.imported} imported · {result.skipped} skipped
        {result.failed > 0 ? ` · ${result.failed} failed` : ''}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-white/10 px-5 py-2 text-[13px] text-textSecondary hover:border-white/20"
        >
          {copy.startOver}
        </button>
        <Link
          href="/pro/migrate/calendar"
          className="inline-flex h-10 items-center justify-center rounded-full px-6 text-[14px] font-medium"
          style={{ background: 'var(--cta)', color: 'rgb(var(--on-cta))' }}
        >
          {copy.cta} →
        </Link>
      </div>
    </div>
  )
}
