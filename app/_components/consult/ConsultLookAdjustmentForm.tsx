'use client'
import { useState } from 'react'
import type { ConsultLookBriefVersionDTO } from '@/lib/dto/consult'
import { normalizeMoney2 } from '@/lib/money'
import { saveConsultLookBriefAction } from '@/lib/consult/lookBrief.client'

type Target = { pathIndex: number; visitIndex: number; offeringId: string; locationType: 'SALON' | 'MOBILE' }
export default function ConsultLookAdjustmentForm({ consultId, brief, target, label, price, duration, onSaved }: {
  consultId: string; brief: ConsultLookBriefVersionDTO; target: Target; label: string
  price: string | null; duration: number | null; onSaved: (brief: ConsultLookBriefVersionDTO) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(form: FormData) {
    const priceInput = String(form.get('price') ?? '').trim()
    const nextPrice = priceInput ? normalizeMoney2(priceInput) : null
    const nextDuration = String(form.get('duration') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim() || null
    if ((priceInput && nextPrice === null) || (nextDuration && !/^[1-9]\d*$/.test(nextDuration)) || (!priceInput && !nextDuration)) { setError('Enter a valid price or time to adjust. Zero means complimentary.'); return }
    setBusy(true); setError(null)
    try {
      const saved = await saveConsultLookBriefAction(consultId, true, 'adjust', {
        expectedVersion: brief.version, idempotencyKey: crypto.randomUUID(), adjustments: [
          ...(nextPrice !== null ? [{ ...target, field: 'PRICE', value: nextPrice, reason }] : []),
          ...(nextDuration ? [{ ...target, field: 'DURATION', value: nextDuration, reason }] : []),
        ],
      })
      onSaved(saved); setOpen(false)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save this adjustment.') }
    finally { setBusy(false) }
  }
  return <div className="grid gap-2">
    <button type="button" className="justify-self-start underline" onClick={() => setOpen(!open)} disabled={busy || !brief.confirmationOpen || brief.awaitingAnalysis}>Adjust {label}</button>
    {open && <form action={save} className="grid gap-2 rounded-lg border border-surfaceGlass/10 p-3">
      <label>Price<input name="price" defaultValue={price ?? ''} inputMode="decimal" className="ml-2 rounded bg-bgPrimary p-2 text-textPrimary" /></label>
      <label>Minutes<input name="duration" type="number" min="1" step="1" defaultValue={duration ?? ''} className="ml-2 rounded bg-bgPrimary p-2 text-textPrimary" /></label>
      <label>Reason (optional)<input name="reason" maxLength={400} className="ml-2 rounded bg-bgPrimary p-2 text-textPrimary" /></label>
      <button type="submit" disabled={busy} className="justify-self-start rounded-full border border-surfaceGlass/20 px-4 py-2 font-semibold">{busy ? 'Saving…' : 'Save for this version'}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </div>
}
