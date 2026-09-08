'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useBrand } from '@/lib/brand/BrandProvider'
import { DEFAULT_TIME_ZONE, formatInTimeZone, getViewerTimeZone } from '@/lib/time'
import type { ClientConsultSessionsDTO } from '@/lib/dto/consult'

type Item = ClientConsultSessionsDTO['consultations'][number]

export default function ClientConsultSessions() {
  const { brand } = useBrand()
  const copy = brand.clientConsultThread.homeSessions
  const [items, setItems] = useState<Item[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const load = useCallback(async (after?: string) => {
    setLoading(true); setLoadFailed(false)
    try {
      const response = await fetch(`/api/v1/client/consult/sessions${after ? `?cursor=${encodeURIComponent(after)}` : ''}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('load failed')
      const body: ClientConsultSessionsDTO = await response.json()
      setItems(previous => after ? [...previous, ...body.consultations] : body.consultations)
      setCursor(body.nextCursor)
    } catch { setLoadFailed(true) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function remove(id: string) {
    setDeleting(true); setDeleteFailed(false)
    try {
      const response = await fetch(`/api/v1/client/consult/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok && response.status !== 404) throw new Error('delete failed')
      setItems(previous => previous.filter(item => item.id !== id)); setSelected(null)
    } catch {
      setDeleteFailed(true)
      // The server may have stopped it while photo cleanup waits for a retry.
      setItems(previous => previous.map(item => item.id === id ? { ...item, canResume: false } : item))
    } finally { setDeleting(false) }
  }

  return <section className="rounded-2xl border border-textPrimary/10 bg-bgSecondary p-5" aria-label={copy.title}>
    <h2 className="font-display text-xl">{copy.title}</h2>
    {loadFailed ? <p role="alert">{copy.loadFailed} <button disabled={loading} onClick={() => void load()}>{copy.retry}</button></p> : null}
    {!loading && !loadFailed && !cursor && items.length === 0 ? <p className="mt-3 text-sm text-textMuted">{copy.empty}</p> : null}
    {items.map(item => <article key={item.id} className="border-b border-textPrimary/10 py-4 last:border-0">
      <p className="font-semibold">{item.professionalName ?? copy.proFallback}</p>
      <time className="text-sm text-textMuted" dateTime={item.updatedAt}>{formatInTimeZone(item.updatedAt, getViewerTimeZone() ?? DEFAULT_TIME_ZONE, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
      {selected === item.id ? <div className="mt-3 space-y-3" role="group" aria-label={copy.confirmTitle}>
        <p className="font-semibold">{copy.confirmTitle}</p><p className="text-sm text-textSecondary">{copy.confirmBody}</p>
        {deleteFailed ? <p role="alert">{copy.failed}</p> : null}
        <div className="flex flex-wrap gap-4">
          <button className="min-h-11 underline" disabled={deleting} onClick={() => void remove(item.id)}>{deleting ? copy.deleting : copy.delete}</button>
          <button className="min-h-11" disabled={deleting} onClick={() => { setSelected(null); setDeleteFailed(false) }}>{copy.keep}</button>
        </div>
      </div> : <div className="mt-2 flex flex-wrap items-center gap-4">
        {item.canResume ? <Link className="flex min-h-11 items-center text-accentPrimary underline" href={`/client/consult/${encodeURIComponent(item.id)}`}>{copy.resume}</Link> : <p className="text-sm text-textMuted">{copy.stopped}</p>}
        <button className="min-h-11 text-sm underline" disabled={deleting} onClick={() => { setSelected(item.id); setDeleteFailed(false) }}>{copy.delete}</button>
      </div>}
    </article>)}
    {cursor ? <button className="mt-3 min-h-11 underline" disabled={loading} onClick={() => void load(cursor)}>{copy.more}</button> : null}
    <div role="status" aria-live="polite">{loading ? '…' : null}</div>
  </section>
}
