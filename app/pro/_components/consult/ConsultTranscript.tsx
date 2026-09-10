'use client'

import { useEffect, useRef, useState } from 'react'
import type { ConsultProTranscriptDTO, ConsultProTranscriptEventDTO } from '@/lib/dto/consult'
import { consultTranscriptCopy as copy } from '@/lib/brand/consultTranscriptCopy'
import { formatInTimeZone } from '@/lib/time'

export default function ConsultTranscript({ consultId, timeZone }: { consultId: string; timeZone: string }) {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<ConsultProTranscriptEventDTO[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [note, setNote] = useState(copy.note)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])

  async function load(next: string | null) {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setLoading(true); setError(false)
    try {
      const suffix = next ? `?cursor=${encodeURIComponent(next)}` : ''
      const response = await fetch(`/api/v1/pro/consults/${encodeURIComponent(consultId)}/transcript${suffix}`, { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || response.status === 404) { setEvents([]); setCursor(null); setLoaded(false) }
        throw new Error()
      }
      const body: { ok: boolean; transcript: ConsultProTranscriptDTO } = await response.json()
      if (!body.ok || body.transcript.consultId !== consultId) throw new Error()
      setEvents(previous => next ? [...new Map([...previous, ...body.transcript.events].map(event => [event.id, event])).values()] : body.transcript.events)
      setCursor(body.transcript.nextCursor); setNote(body.transcript.historyNote); setLoaded(true)
    } catch { if (!controller.signal.aborted) setError(true) }
    finally { if (pending.current === controller) { pending.current = null; setLoading(false) } }
  }

  return <section className="rounded-xl border border-surfaceGlass/20 p-4">
    <button type="button" className="text-sm font-semibold text-textPrimary" aria-expanded={open}
      onClick={() => { setOpen(!open); if (!open && !loaded) void load(null) }}>
      {open ? copy.close : copy.open}
    </button>
    {open ? <div className="mt-3 grid gap-3">
      <p className="text-xs leading-5 text-textSecondary">{note}</p>
      {loaded && events.length === 0 ? <p>{copy.empty}</p> : null}
      <ol className="grid gap-3">{events.map(event => <li key={event.id} className="rounded-lg border border-surfaceGlass/10 p-3">
        <h3 className="text-sm font-semibold text-textPrimary">{event.title}</h3>
        <time dateTime={event.createdAt} className="text-xs text-textMuted">{formatInTimeZone(new Date(event.createdAt), timeZone, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
        {event.unavailable ? <p className="mt-2 text-xs text-textSecondary">{copy.unavailable}</p> : null}
        <dl className="mt-2 grid gap-2">{event.items.map((item, index) => <div key={index}>
          <dt className="text-xs text-textSecondary">{item.label}</dt>
          <dd className="whitespace-pre-wrap text-sm text-textPrimary">{item.value}</dd>
        </div>)}</dl>
      </li>)}</ol>
      {error ? <div role="alert"><p>{copy.error}</p><button type="button" disabled={loading} onClick={() => void load(loaded ? cursor : null)}>{copy.retry}</button></div> : null}
      {loading ? <p role="status">{copy.loading}</p> : cursor && !error ? <button type="button" onClick={() => void load(cursor)}>{copy.more}</button> : null}
    </div> : null}
  </section>
}
