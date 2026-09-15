'use client'

import { useCallback, useEffect, useState } from 'react'
import { lookAnalysisCopy as copy } from '@/lib/brand/lookAnalysisCopy'
import { lookAnalysisReviewCopy as reviewCopy } from '@/lib/brand/lookAnalysisReviewCopy'
import { consultProInspirationCredibilityCopy } from '@/lib/brand/consultProInspirationCredibilityCopy'
import { CONSULT_INSPIRATION_ANALYSIS_FIELDS, CONSULT_INSPIRATION_FIELD_VALUES, type ConsultInspirationAnalysisField } from '@/lib/consult/inspirationAttributes'
import type { LookAnalysisItem, LookAnalysisMutation, LookAnalysisObservation } from '@/lib/looks/analysis/contracts'

const control = 'min-h-11 w-full rounded-lg border border-surfaceGlass/20 bg-bgPrimary px-3 py-2 text-textPrimary'
const button = 'min-h-11 rounded-lg border border-surfaceGlass/20 px-4 py-2 font-semibold disabled:opacity-50'
const emptyObservation: LookAnalysisObservation = { value: 'UNKNOWN', confidence: { min: 0, max: 0 }, region: null }
function valueLabel(field: ConsultInspirationAnalysisField, value: string) {
  return reviewCopy.valueLabels[`${field}:${value}`] ?? copy.unknown
}
function validObservation(value: LookAnalysisObservation) {
  const { min, max } = value.confidence
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 1 || min >= max) return false
  const area = value.region
  return !area || (Object.values(area).every(Number.isFinite) && area.x >= 0 && area.y >= 0 && area.w > 0 && area.h > 0 && area.x + area.w <= 1 && area.y + area.h <= 1)
}

export default function LookAnalysisReview({ mode }: { mode: 'pro' | 'admin' }) {
  const [items, setItems] = useState<LookAnalysisItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const endpoint = `/api/v1/${mode}/looks/analysis`
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(endpoint, { cache: 'no-store' })
      const data: { ok?: boolean; items?: LookAnalysisItem[] } = await response.json()
      if (!response.ok || data.ok !== true || !Array.isArray(data.items)) throw new Error('load')
      setItems(data.items)
      return true
    } catch {
      setError(copy.failed)
      return false
    } finally { setLoading(false) }
  }, [endpoint])
  useEffect(() => { void refresh() }, [refresh])

  return <section className="mx-auto w-full max-w-[1100px] space-y-5 px-4 py-6 text-textPrimary">
    <header className="space-y-2">
      <h1 className="text-2xl font-bold">{mode === 'admin' ? copy.adminTitle : copy.title}</h1>
      <p className="text-sm text-textSecondary">{mode === 'admin' ? copy.adminIntro : copy.intro}</p>
      <button className={button} onClick={() => void refresh()} disabled={loading}>{copy.refresh}</button>
    </header>
    {loading ? <p role="status">{copy.loading}</p> : null}
    {error ? <p role="alert" className="text-toneDanger">{error}</p> : null}
    {!loading && !error && items.length === 0 ? <p>{copy.empty}</p> : null}
    {!loading && !error ? items.map(item => <ReviewItem key={`${item.id}:${item.revision}`} item={item} mode={mode} endpoint={endpoint} refresh={refresh} />) : null}
  </section>
}

function ReviewItem({ item, mode, endpoint, refresh }: { item: LookAnalysisItem; mode: 'pro' | 'admin'; endpoint: string; refresh: () => Promise<boolean> }) {
  const [answers, setAnswers] = useState(item.answers)
  const [frame, setFrame] = useState(item.selectedFrame)
  const [corrections, setCorrections] = useState<NonNullable<LookAnalysisMutation['corrections']>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [stale, setStale] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [inspected, setInspected] = useState(false)
  const frameChanged = frame !== item.selectedFrame
  const reviewable = item.frameCount > 0 && (mode === 'admin' ? ['NEEDS_ADMIN', 'NEEDS_PRO', 'READY'].includes(item.status) : item.status === 'NEEDS_PRO')
  const mutate = async (mutation: Omit<LookAnalysisMutation, 'revision'>) => {
    setError(null)
    setBusy(true)
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(item.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...mutation, revision: item.revision }) })
      if (response.status === 409) { setStale(true); setError(copy.conflict); return }
      const data: { ok?: boolean } = await response.json()
      if (!response.ok || data.ok !== true) throw new Error('save')
      // Do not show stale observations (or successful feedback) when the reload fails.
      await refresh()
    } catch { setError(copy.failed) }
    finally { setBusy(false) }
  }
  const approve = () => {
    if (!Object.values(corrections).every(validObservation)) { setError(reviewCopy.invalid); return }
    void mutate({ action: 'approve', selectedFrame: item.selectedFrame, corrections })
  }
  return <article className="space-y-4 rounded-2xl border border-surfaceGlass/20 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      {item.caption ? <h2 className="min-w-0 break-words font-semibold">{item.caption}</h2> : null}
      <p className="text-sm text-textSecondary">{copy.statuses[item.status]}</p>
    </div>
    {item.status === 'FAILED' ? <p className="text-toneWarn">{copy.statuses.FAILED}</p> : null}
    {item.frameCount > 0 ? <div className="space-y-3">
      {/* The authenticated binary endpoint must not pass through an image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={frame} src={`${item.frameReadBase}/${frame}`} alt={reviewCopy.imageAlt} className="max-h-[480px] w-full rounded-xl object-contain" onLoad={() => setImageLoaded(true)} onError={() => { setImageFailed(true); setImageLoaded(false) }} />
      {imageFailed ? <p role="alert" className="text-toneDanger">{reviewCopy.imageUnavailable}</p> : null}
      {item.frameCount > 1 ? <label className="block space-y-1 text-sm">{copy.frame}
        <select className={control} value={frame} disabled={busy || stale || !reviewable} onChange={event => { setFrame(Number(event.target.value)); setImageLoaded(false); setImageFailed(false); setInspected(false) }}>
          {Array.from({ length: item.frameCount }, (_, index) => <option key={index} value={index}>{reviewCopy.frameNumber.replace('{number}', String(index + 1))}</option>)}
        </select>
      </label> : null}
      {frameChanged ? <><p className="text-sm text-toneWarn">{reviewCopy.frameChanged}</p><button className={button} disabled={busy || stale || !imageLoaded} onClick={() => void mutate({ action: 'answer', selectedFrame: frame })}>{reviewCopy.saveFrame}</button></> : null}
    </div> : null}
    {!frameChanged ? <>
      {item.flags.map(flag => consultProInspirationCredibilityCopy.flags[flag]).filter(Boolean).map(flag => <p key={flag} className="text-sm text-toneWarn">{flag}</p>)}
      <section className="space-y-2"><h3 className="font-semibold">{copy.proAnswers}</h3>
        {mode === 'pro' && reviewable ? <p className="text-sm text-textSecondary">{copy.uncertainty}</p> : null}
        {item.questions.map(question => <label key={question.key} className="block space-y-1 text-sm">{question.label}
          {mode === 'pro' && reviewable ? <select className={control} value={answers[question.key] ?? ''} disabled={busy || stale} onChange={event => setAnswers(previous => ({ ...previous, [question.key]: event.target.value }))}>
            <option value="">{reviewCopy.choose}</option>{question.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select> : <span className="block text-textSecondary">{question.options.find(option => option.value === item.answers[question.key])?.label ?? reviewCopy.noAnswer}</span>}
        </label>)}
      </section>
      <ObservationList title={copy.original} observations={item.observations} showDetails={mode === 'admin'} />
      {item.reviewedObservations ? <ObservationList title={reviewCopy.approved} observations={item.reviewedObservations} showDetails={mode === 'admin'} /> : null}
      {mode === 'admin' && reviewable ? <section className="space-y-3"><h3 className="font-semibold">{reviewCopy.corrections}</h3>
        <p className="text-sm text-textSecondary">{reviewCopy.confidenceHelp}</p>
        {CONSULT_INSPIRATION_ANALYSIS_FIELDS.map(field => <ObservationEditor key={field} field={field} value={corrections[field] ?? item.reviewedObservations?.[field] ?? item.observations[field] ?? emptyObservation} disabled={busy || stale} onChange={value => { setCorrections(previous => ({ ...previous, [field]: value })); setInspected(false) }} />)}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={inspected} disabled={busy || stale || !imageLoaded} onChange={event => setInspected(event.target.checked)} />{reviewCopy.inspect}</label>
      </section> : null}
    </> : null}
    {error ? <p role="alert" className="text-toneDanger">{error}</p> : null}
    <div className="flex flex-wrap gap-2">
      {mode === 'pro' && reviewable && !frameChanged ? <button className={button} disabled={busy || stale} onClick={() => {
        if (item.questions.some(question => !answers[question.key])) { setError(reviewCopy.required); return }
        void mutate({ action: 'answer', answers, selectedFrame: item.selectedFrame })
      }}>{copy.answer}</button> : null}
      {mode === 'admin' && reviewable ? <><button className={`${button} bg-accentPrimary text-bgPrimary`} disabled={busy || stale || frameChanged || !imageLoaded || !inspected} onClick={approve}>{copy.approve}</button>
        <button className={`${button} text-toneDanger`} disabled={busy || stale || frameChanged} onClick={() => void mutate({ action: 'reject' })}>{copy.reject}</button></> : null}
      {mode === 'admin' && item.status === 'FAILED' ? <button className={button} disabled={busy || stale} onClick={() => void mutate({ action: 'retry' })}>{copy.retry}</button> : null}
      {busy ? <span role="status">{reviewCopy.busy}</span> : null}
    </div>
  </article>
}

function ObservationEditor({ field, value, disabled, onChange }: { field: ConsultInspirationAnalysisField; value: LookAnalysisObservation; disabled: boolean; onChange: (value: LookAnalysisObservation) => void }) {
  return <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-surfaceGlass/20 p-3">
    <legend className="px-1 font-medium">{copy.fields[field]}</legend>
    <label className="block text-sm">{copy.fields[field]}<select className={control} value={value.value} onChange={event => onChange(event.target.value === 'UNKNOWN' ? { value: 'UNKNOWN', confidence: { min: 0, max: 0.35 }, region: null } : { ...value, value: event.target.value })}>{CONSULT_INSPIRATION_FIELD_VALUES[field].map(option => <option key={option} value={option}>{valueLabel(field, option)}</option>)}</select></label>
    <div className="grid grid-cols-2 gap-2">{(['min', 'max'] as const).map(bound => <label key={bound} className="text-sm">{bound === 'min' ? reviewCopy.confidenceMin : reviewCopy.confidenceMax}<input type="number" className={control} min={0} max={1} step={0.01} value={Number.isNaN(value.confidence[bound]) ? '' : value.confidence[bound]} onChange={event => onChange({ ...value, confidence: { ...value.confidence, [bound]: event.target.valueAsNumber } })} /></label>)}</div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.region !== null} onChange={event => onChange({ ...value, region: event.target.checked ? { x: 0, y: 0, w: 1, h: 1 } : null })} />{reviewCopy.region}</label>
    {value.region ? <><p className="text-xs text-textSecondary">{reviewCopy.regionHelp}</p><div className="grid grid-cols-2 gap-2">{(['x', 'y', 'w', 'h'] as const).map(axis => <label key={axis} className="text-sm">{reviewCopy.regionLabels[axis]}<input type="number" className={control} min={0} max={1} step={0.01} value={Number.isNaN(value.region?.[axis]) ? '' : value.region?.[axis]} onChange={event => { if (value.region) onChange({ ...value, region: { ...value.region, [axis]: event.target.valueAsNumber } }) }} /></label>)}</div></> : null}
  </fieldset>
}

function ObservationDetails({ value }: { value: LookAnalysisObservation }) {
  const area = value.region
  return <div className="mt-1 space-y-1 text-xs text-textSecondary">
    <p>{reviewCopy.confidenceRange.replace('{min}', String(value.confidence.min)).replace('{max}', String(value.confidence.max))}</p>
    <p>{area ? reviewCopy.originalArea.replace('{x}', String(area.x)).replace('{y}', String(area.y)).replace('{w}', String(area.w)).replace('{h}', String(area.h)) : reviewCopy.noArea}</p>
  </div>
}

function ObservationList({ title, observations, showDetails }: {
  title: string
  observations: LookAnalysisItem['observations']
  showDetails: boolean
}) {
  return <section className="space-y-3" aria-label={title}>
    <h3 className="font-semibold">{title}</h3>
    <dl className="grid gap-3 sm:grid-cols-2">
      {CONSULT_INSPIRATION_ANALYSIS_FIELDS.map(field => {
        const observation = observations[field]
        return <div key={field}>
          <dt className="text-sm text-textSecondary">{copy.fields[field]}</dt>
          <dd>
            {valueLabel(field, observation?.value ?? 'UNKNOWN')}
            {showDetails && observation ? <ObservationDetails value={observation} /> : null}
          </dd>
        </div>
      })}
    </dl>
  </section>
}
