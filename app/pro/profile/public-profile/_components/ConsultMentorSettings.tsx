 'use client'
import { useEffect, useState } from 'react'
import { defaultConsultMentorCopy as copy } from '@/lib/brand/defaultConsultMentorCopy'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'

export default function ConsultMentorSettings() {
  const [enabled, setEnabled] = useState(false)
  const [lines, setLines] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  useEffect(() => {
    let active = true
    void fetch('/api/v1/pro/profile').then(async response => {
      const body = await safeJson(response)
      if (!response.ok || !isRecord(body) || !isRecord(body.profile)) throw new Error()
      if (active) {
        setEnabled(body.profile.consultMentorEnabled === true)
        setLines(Array.isArray(body.profile.consultProductLines) ? body.profile.consultProductLines.filter((line): line is string => typeof line === 'string').join('\n') : '')
        setLoaded(true)
      }
    }).catch(() => { if (active) setStatus(copy.error) })
    return () => { active = false }
  }, [])
  async function save() {
    setBusy(true); setStatus('')
    try {
      const response = await fetch('/api/v1/pro/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consultMentorEnabled: enabled, consultProductLines: lines.split('\n').map(line => line.trim()).filter(Boolean) }) })
      setStatus(response.ok ? copy.saved : copy.error)
    } catch { setStatus(copy.error) } finally { setBusy(false) }
  }
  return <section className="rounded-xl border border-surfaceGlass/20 p-4 text-textPrimary">
    <h2 className="font-bold">{copy.title}</h2>
    <label className="mt-3 flex gap-2"><input type="checkbox" checked={enabled} disabled={!loaded || busy} onChange={event => setEnabled(event.target.checked)} />{copy.enable}</label>
    <label className="mt-3 block">{copy.lines}<textarea value={lines} disabled={!loaded || busy} onChange={event => setLines(event.target.value)} rows={3}
      className="mt-1 block w-full rounded-lg border border-surfaceGlass/20 bg-bgPrimary p-2" /></label>
    <p className="text-xs text-textSecondary">{copy.lineHelp}</p>
    <button type="button" disabled={!loaded || busy} onClick={() => void save()} className="mt-3 rounded-lg border border-surfaceGlass/20 px-3 py-2 disabled:opacity-50">{copy.save}</button>
    {status ? <p role="status" className="mt-2 text-sm">{status}</p> : null}
  </section>
}
