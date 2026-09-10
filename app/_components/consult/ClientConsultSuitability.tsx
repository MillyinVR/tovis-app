import type { ConsultClientSuitabilityDTO } from '@/lib/dto/consult'
import type { BrandClientConsultResultsCopy } from '@/lib/brand/types'

export default function ClientConsultSuitability({ suitability, analysisRevisionId, copy }: {
  suitability?: ConsultClientSuitabilityDTO
  analysisRevisionId: string
  copy: BrandClientConsultResultsCopy['suitability']
}) {
  if (!suitability || suitability.analysisRevisionId !== analysisRevisionId) return null
  return <section className="grid gap-4 rounded-xl border border-surfaceGlass/10 p-4" aria-label={copy.tailoring}>
    <p className="text-sm text-textSecondary">{copy.note}</p>
    <div>
      <h3 className="font-semibold text-textPrimary">{copy.whatYouLoved}</h3>
      <ul className="mt-2 grid gap-2 text-sm text-textPrimary">{suitability.whatYouLoved.map((text, i) => <li key={i}>{text}</li>)}</ul>
    </div>
    <div>
      <h3 className="font-semibold text-textPrimary">{copy.tailoring}</h3>
      <ul className="mt-2 grid gap-2 text-sm text-textPrimary">{suitability.tailoring.map((item, i) => <li key={i}>
        <p>{item.explanation}</p>
        {item.needsConfirmation ? <p className="mt-1 text-textSecondary">{copy.needsConfirmation}</p> : null}
      </li>)}</ul>
    </div>
    <div>
      <h3 className="font-semibold text-textPrimary">{copy.confirmations}</h3>
      <ul className="mt-2 grid gap-2 text-sm text-textPrimary">{suitability.proConfirmations.map((text, i) => <li key={i}>{text}</li>)}</ul>
    </div>
  </section>
}
