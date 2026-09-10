import type { ConsultProSuitabilityDTO, ConsultSuitabilityEvidenceDTO } from '@/lib/dto/consult'
import { consultSuitabilityCopy as copy } from '@/lib/brand/consultSuitabilityCopy'

function Sources({ sources }: { sources: ConsultSuitabilityEvidenceDTO[] }) {
  return <ul className="mt-2 grid gap-1 text-xs text-textSecondary">{sources.map((source, i) => <li key={i}>
    <span className="font-semibold">{source.provenance === 'OBSERVED' ? copy.observed : copy.clientReported}</span>
    {' · '}{source.label}: {source.value}
    {source.confidence ? <> · {Math.round(source.confidence.min * 100)}–{Math.round(source.confidence.max * 100)}% {copy.confidence}</> : null}
    {source.evidence?.length ? <> · {source.evidence.map(key => key.replaceAll('_', ' ')).join(', ')}</> : null}
  </li>)}</ul>
}
export default function ProConsultSuitability({ suitability, analysisRevisionId }: {
  suitability?: ConsultProSuitabilityDTO
  analysisRevisionId: string
}) {
  if (!suitability || suitability.analysisRevisionId !== analysisRevisionId) return null
  return <section className="grid gap-4 rounded-xl border border-surfaceGlass/10 p-4" aria-label={copy.professionalTitle}>
    <div><h3 className="font-semibold text-textPrimary">{copy.professionalTitle}</h3>
      <p className="mt-1 text-sm text-textSecondary">{copy.professionalNote}</p></div>
    <div><h4 className="font-semibold text-textPrimary">{copy.whatYouLoved}</h4>
      <ul className="mt-2 grid gap-1 text-sm text-textPrimary">{suitability.whatYouLoved.map((text, i) => <li key={i}>{text}</li>)}</ul></div>
    <div><h4 className="font-semibold text-textPrimary">{copy.professionalTailoring}</h4>
      <ul className="mt-2 grid gap-3">{suitability.tailoring.map((item, i) => <li key={i}>
        <p className="text-sm text-textPrimary">{item.direction}</p>
        {item.needsConfirmation ? <p className="text-sm text-textSecondary">{copy.professionalConfirmations}</p> : null}
        <Sources sources={item.sources} />
      </li>)}</ul></div>
    <div><h4 className="font-semibold text-textPrimary">{copy.professionalConfirmations}</h4>
      <ul className="mt-2 grid gap-3">{suitability.proConfirmations.map((item, i) => <li key={i}>
        <p className="text-sm text-textPrimary">{item.check}</p><Sources sources={item.sources} />
      </li>)}</ul></div>
  </section>
}
