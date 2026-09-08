'use client'

import { useState } from 'react'
import type { ConsultLookBriefVersionDTO } from '@/lib/dto/consult'
import { saveConsultLookBriefAction } from '@/lib/consult/lookBrief.client'

export default function ConsultLookExpectationsForm({ consultId, brief, pathIndex, onSaved }: {
  consultId: string
  brief: ConsultLookBriefVersionDTO
  pathIndex: number
  onSaved: (brief: ConsultLookBriefVersionDTO) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = brief.adjustments.find(entry => entry.pathIndex === pathIndex && entry.field === 'EXPECTATIONS')
  async function save(form: FormData) {
    const value = String(form.get('expectations') ?? '').trim()
    if (!value) { setError('Describe what the client can expect.'); return }
    setBusy(true)
    setError(null)
    try {
      onSaved(await saveConsultLookBriefAction(consultId, true, 'adjust', {
        expectedVersion: brief.version, idempotencyKey: crypto.randomUUID(),
        adjustments: [{ field: 'EXPECTATIONS', pathIndex, visitIndex: null, offeringId: null,
          locationType: null, value, reason: String(form.get('reason') ?? '').trim() || null }],
      }))
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save expectations.')
    } finally { setBusy(false) }
  }
  return <div className="mt-2 grid gap-2 text-sm text-textPrimary">
    <button type="button" className="justify-self-start underline" disabled={busy || !brief.confirmationOpen || brief.awaitingAnalysis}
      onClick={() => setOpen(!open)}>Clarify expected result</button>
    {open && <form action={save} className="grid gap-2 rounded-lg border border-surfaceGlass/10 p-3">
      <label>What the client can expect<textarea name="expectations" defaultValue={current?.value ?? ''} required maxLength={600}
        className="mt-1 block w-full rounded bg-bgPrimary p-2 text-textPrimary" /></label>
      <label>Reason (optional)<input name="reason" maxLength={400} className="mt-1 block w-full rounded bg-bgPrimary p-2 text-textPrimary" /></label>
      <p className="text-xs text-textSecondary">This creates a new version for both of you to confirm.</p>
      <button type="submit" disabled={busy} className="justify-self-start rounded-full border border-surfaceGlass/20 px-4 py-2">{busy ? 'Saving…' : 'Save expectations'}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </div>
}
