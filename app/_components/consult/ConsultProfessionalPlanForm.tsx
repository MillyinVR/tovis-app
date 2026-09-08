'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ConsultLookPlanDTO, ConsultLookBriefVersionDTO } from '@/lib/dto/consult'
import { isRecord } from '@/lib/guards'
import { saveConsultLookBriefAction } from '@/lib/consult/lookBrief.client'

export default function ConsultProfessionalPlanForm({ consultId, plan, brief, onSaved }: {
  consultId: string; plan: ConsultLookPlanDTO; brief: ConsultLookBriefVersionDTO; onSaved: (brief: ConsultLookBriefVersionDTO) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [offerings, setOfferings] = useState<Array<{ offeringId: string; name: string }>>([])
  const [visits, setVisits] = useState<string[][]>(plan.paths[0]?.visits.map(visit => visit.steps.map(step => step.offeringId)) ?? [[]])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function begin() {
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/v1/pro/consults/${encodeURIComponent(consultId)}/look-plan/author`, { cache: 'no-store' })
      const raw: unknown = await response.json()
      if (!response.ok || !isRecord(raw) || !Array.isArray(raw.offerings)) throw new Error('Could not load your menu.')
      setOfferings(raw.offerings.map(item => {
        if (!isRecord(item) || typeof item.offeringId !== 'string' || typeof item.name !== 'string') throw new Error('Could not read your menu.')
        return { offeringId: item.offeringId, name: item.name }
      })); setOpen(true)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load your menu.') }
    finally { setBusy(false) }
  }
  async function save(data: FormData) {
    setBusy(true); setError(null)
    try {
      const saved = await saveConsultLookBriefAction(consultId, true, 'author', {
        expectedVersion: brief.version, idempotencyKey: crypto.randomUUID(), visits,
        tier: data.get('tier'), title: data.get('title'), summary: data.get('summary'),
        whyThisWorksForYou: data.get('reasoning'), reviewNote: data.get('reviewNote'), reviewedClientDetails: data.get('reviewed') === 'on',
      })
      onSaved(saved); setOpen(false); router.refresh()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save this look.') }
    finally { setBusy(false) }
  }
  return <section className="grid gap-3">
    <button type="button" onClick={() => void begin()} disabled={busy || !brief.confirmationOpen}
      className="justify-self-start rounded-full border border-surfaceGlass/20 px-4 py-2 text-sm font-semibold text-textPrimary">
      {busy ? 'Loading…' : 'Author or revise the look plan'}
    </button>
    {open && <form action={save} className="grid gap-3 rounded-xl border border-surfaceGlass/20 p-4 text-sm text-textPrimary">
      <p>This creates a new version for the client to choose and confirm. Previous price and time overrides are replaced by your menu estimates.</p>
      <label>Direction<select name="tier" defaultValue={plan.tier} className="ml-2 bg-bgPrimary p-2"><option value="EXACT">Exact</option><option value="CLOSE">Close</option><option value="TOWARD">Toward</option></select></label>
      <label>Client-facing look title<input name="title" required maxLength={100} defaultValue={plan.paths[0]?.title} className="mt-1 block w-full rounded bg-bgPrimary p-2" /></label>
      <label>Desired result<textarea name="summary" required maxLength={400} defaultValue={plan.summary} className="mt-1 block w-full rounded bg-bgPrimary p-2" /></label>
      <label>Why this direction works<textarea name="reasoning" required maxLength={320} defaultValue={plan.paths[0]?.whyThisWorksForYou} className="mt-1 block w-full rounded bg-bgPrimary p-2" /></label>
      {visits.map((selected, index) => <fieldset key={index} className="grid gap-2 rounded border border-surfaceGlass/10 p-3">
        <legend>Visit {index + 1} — required work</legend>
        {offerings.map(offering => <label key={offering.offeringId} className="flex gap-2">
          <input type="checkbox" checked={selected.includes(offering.offeringId)} disabled={!selected.includes(offering.offeringId) && selected.length >= 6}
            onChange={event => setVisits(current => current.map((visit, visitIndex) => visitIndex !== index ? visit : event.target.checked
              ? [...visit, offering.offeringId] : visit.filter(id => id !== offering.offeringId)))} />{offering.name}
        </label>)}
        {visits.length > 1 && <button type="button" onClick={() => setVisits(current => current.filter((_, visitIndex) => visitIndex !== index))} className="justify-self-start underline">Remove this visit</button>}
      </fieldset>)}
      {visits.length < 8 && <button type="button" onClick={() => setVisits(current => [...current, []])} className="justify-self-start underline">Add a later visit</button>}
      <label>Review note<textarea name="reviewNote" required maxLength={400} placeholder="Record what you assessed and any prerequisites or expectations." className="mt-1 block w-full rounded bg-bgPrimary p-2" /></label>
      <label className="flex gap-2"><input name="reviewed" type="checkbox" required />I reviewed the client’s current photos, preferences, history, and any prerequisites for this plan.</label>
      <button type="submit" disabled={busy || visits.some(visit => !visit.length)} className="justify-self-start rounded-full border border-surfaceGlass/20 px-4 py-2 font-semibold">{busy ? 'Saving…' : 'Save new look version'}</button>
      <button type="button" onClick={() => setOpen(false)} className="justify-self-start underline">Cancel</button>
    </form>}
    {error && <p role="alert" className="text-sm text-textSecondary">{error}</p>}
  </section>
}
