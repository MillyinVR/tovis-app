import { CONSULT_HAIR_LEVELS } from './hairLevel'
import { isSupportedConsultObservation } from './analysisValidation'
import { CONSULT_HAIR_MAP_PROMPT_VERSION, CONSULT_HAIR_MAP_SHAPE_FIELDS, CONSULT_HAIR_MAP_VERSION, CONSULT_HAIR_MAP_ZONES, type ConsultHairMap, type ConsultHairMapObservation } from './hairMap'

export type ConsultHairDifference = {
  field: string
  current: ConsultHairMapObservation
  reference: ConsultHairMapObservation
  status: 'OBSERVED_MATCH' | 'OBSERVED_DIFFERENCE' | 'NEEDS_CONFIRMATION'
  /** Positive = reference appears lighter. Not lift capability or visit count. */
  observedLevelDifference?: number
}
export type ConsultHairComparison = {
  schemaVersion: typeof CONSULT_HAIR_MAP_VERSION
  promptVersion: typeof CONSULT_HAIR_MAP_PROMPT_VERSION
  current: ConsultHairMap
  reference: ConsultHairMap
  differences: ConsultHairDifference[]
}

/** Compare observations only. Client intent is deliberately not inferred here. */
export function compareConsultHairMaps(current: ConsultHairMap, reference: ConsultHairMap): ConsultHairComparison {
  const differences: ConsultHairDifference[] = []
  const add = (field: string, a: ConsultHairMapObservation, b: ConsultHairMapObservation, level = false) => {
    const supported = [a, b].every(value => isSupportedConsultObservation({ ...value, evidence: value.evidence.map(source => source.view) }))
    const difference: ConsultHairDifference = {
      field, current: a, reference: b,
      status: !supported ? 'NEEDS_CONFIRMATION' : a.value === b.value ? 'OBSERVED_MATCH' : 'OBSERVED_DIFFERENCE',
    }
    if (supported && level) {
      const left = CONSULT_HAIR_LEVELS.findIndex(value => value === a.value)
      const right = CONSULT_HAIR_LEVELS.findIndex(value => value === b.value)
      if (left >= 0 && right >= 0 && left < 10 && right < 10) difference.observedLevelDifference = right - left
    }
    differences.push(difference)
  }
  for (const zone of CONSULT_HAIR_MAP_ZONES) {
    for (const field of ['level', 'tone', 'pattern'] as const) add(`zones.${zone}.${field}`, current.zones[zone][field], reference.zones[zone][field], field === 'level')
  }
  for (const field of CONSULT_HAIR_MAP_SHAPE_FIELDS) add(`shape.${field}`, current.shape[field], reference.shape[field])
  return { schemaVersion: CONSULT_HAIR_MAP_VERSION, promptVersion: CONSULT_HAIR_MAP_PROMPT_VERSION, current, reference, differences }
}

export function consultHairComparisonBlock(comparison: ConsultHairComparison): string {
  return [
    'ADDITIONAL VISUAL HAIR COMPARISON (hair-map-v1):',
    'These are separately read CURRENT and REFERENCE hair observations, not confirmed target attributes. Use only differences relevant to the supplied client wants; ignores and keep-as-is boundaries take precedence. Never convert every reference detail into a desired change.',
    'OBSERVED_MATCH means the same recorded category, not an exact visual match: matching length bands, MIXED tones or patterns can still look different. Do not infer exact achievability from these labels.',
    'NEEDS_CONFIRMATION is unavailable evidence for a definite claim. A numerical level difference is a visual comparison, not achievable chemical lift, a formula, a visit count, or proof that hair is virgin. History, condition, testing and the professional menu still decide feasibility. Do not override the existing safety routing.',
    'Apparent fullness and worn texture do not establish extensions or natural density/texture. Shape differences alone do not authorize cutting or adding hair. Missing detail should produce a focused clarification or professional check, not invented facts.',
    'Explain the relevant starting-point differences and necessary changes in the existing plan summary/reasons. Match required work to the supplied menu capabilities. Continue citing only eligible existing featureEvidence fields; this map does not introduce new allowed path citation keys.',
    // Differences already carry both observations and their image regions.
    // Sending the maps again would double the same provider input.
    JSON.stringify({ schemaVersion: comparison.schemaVersion, promptVersion: comparison.promptVersion, differences: comparison.differences }),
  ].join('\n')
}
