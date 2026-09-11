import type { ConsultProBriefDTO, ConsultMentorDTO } from '@/lib/dto/consult'
import { defaultConsultMentorCopy as copy } from '@/lib/brand/defaultConsultMentorCopy'

import { composeConsultInspirationCredibilityProLine } from './inspirationCredibility'

function label(value: string) { return value.toLowerCase().replaceAll('_', ' ') }

/** Read-only projection of this immutable Brief; no provider calls or formulas. */
export function buildConsultMentor(brief: ConsultProBriefDTO): ConsultMentorDTO {
  const source = brief.sourceAnalysisRevisionId
  const observed = (name: string, observation: { value: string; confidence: { min: number; max: number } }, sourceId: string) => ({
    text: `${name}: ${label(observation.value)} (${Math.round(observation.confidence.min * 100)}–${Math.round(observation.confidence.max * 100)}% ${copy.confidence})`, sourceId,
  })
  const inspiration = brief.inspirationAnalysis
  // C2-6b — the reference note leads "what the consult saw": the same line the
  // Brief shows, from the same composer, so the two cannot say different things
  // about one photograph. Absent when nothing was flagged.
  const credibility = inspiration ? composeConsultInspirationCredibilityProLine(inspiration.credibilityFlags ?? []) : null
  const saw = inspiration ? [
    ...(credibility ? [{ text: credibility, sourceId: inspiration.revisionId }] : []),
    ...Object.entries(inspiration.attributes).map(([key, value]) =>
      observed(label(key.replace(/([A-Z])/g, '_$1')), value, inspiration.revisionId)),
  ] : [{ text: copy.noInspiration, sourceId: brief.briefRevisionId }]
  const likes = brief.inspiration.exactClientDetails.map(detail => ({ text: `${label(detail.sentiment)}: ${detail.clientWords}`, sourceId: brief.inspiration.revisionId ?? brief.briefRevisionId }))
  const hairDirections = brief.styleDirections.filter(direction => ['HAIR_COLOR_HARMONY', 'CUT_AND_SHAPE', 'BANGS'].includes(direction.domain))
  const starting = [observed('Base level', brief.aiObservations.baseLevel, source),
    observed('Lightest level', brief.aiObservations.lightestLevel, source), observed('Tone', brief.aiObservations.currentTone, source),
    observed('Visible condition', brief.aiObservations.visibleCondition, source),
    observed('Face proportion', brief.profile.faceProportion, source), observed('Forehead proportion', brief.profile.foreheadProportion, source),
    ...hairDirections.map(direction => ({ text: `${direction.title}: ${direction.whyItFlatters}`, sourceId: source })),
    ...brief.safetyFlags.map(flag => ({ text: flag.summary, sourceId: source })),
  ]
  const plan = brief.lookBrief?.professionalPlan ?? brief.lookPlan
  const selected = brief.lookBrief?.selectedPathIndex
  const paths = plan?.paths.filter((_, index) => selected == null || index === selected) ?? []
  const path = paths.map(item => ({ text: `${item.title} · ${item.sessionCount} visit${item.sessionCount === 1 ? '' : 's'}. ${item.whyThisWorksForYou}`,
    sourceId: brief.lookBrief?.professionalPlan ? brief.lookBrief.id : source }))
  if (plan) path.push({ text: `${plan.summary} ${plan.nextStep}`, sourceId: brief.lookBrief?.professionalPlan ? brief.lookBrief.id : source })
  const placement = [
    ...(inspiration ? [observed('Reference placement', inspiration.attributes.placement, inspiration.revisionId), observed('Reference root blend', inspiration.attributes.rootBlend, inspiration.revisionId)] : []),
    ...hairDirections.map(direction => ({ text: `${direction.direction} ${direction.whyItFlatters}`, sourceId: source })),
    { text: copy.placementCheck, sourceId: brief.briefRevisionId },
  ]
  return { title: copy.title, authority: copy.authority, formulationNote: copy.noFormulation,
    sections: [saw, likes.length ? likes : [{ text: copy.noPreferences, sourceId: brief.briefRevisionId }], starting,
      path.length ? path : [{ text: copy.noPath, sourceId: source }], placement].map((items, index) => ({ id: index + 1,
        title: copy.sections[index]!, items: items.filter((item, position) => items.findIndex(candidate => candidate.text === item.text) === position) })) }
}
