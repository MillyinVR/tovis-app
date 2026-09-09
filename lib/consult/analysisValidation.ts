// Shared boundary checks for analysis observations and look-plan output.
import type { ConsultAnalysisObservationDTO } from '@/lib/dto/consult'

/** Existing look-plan evidence floor, shared with Suitability Translation. */
export function isSupportedConsultObservation(value: ConsultAnalysisObservationDTO<string>): boolean {
  return value.value !== 'UNKNOWN' && value.confidence.min >= 0.5 &&
    value.evidence.some(key => key !== 'intake')
}

export class ConsultAnalysisProviderError extends Error {
  constructor(readonly kind: 'unavailable' | 'refused' | 'bad_output') {
    super('Consult analysis is unavailable.')
    this.name = 'ConsultAnalysisProviderError'
  }
}

// Schema v2 deliberately removed skin-tone/undertone/face-shape/eye-shape from
// this list (they are now first-class cosmetic observations, per the 2026-08-26
// decision record). Identity, ethnicity, age, and medical language remain
// forbidden in every free-text field.
const FORBIDDEN_LANGUAGE = /\b(diagnos(?:e|is|ed|tic)|dermatolog(?:y|ist|ical)|disease|disorder|infection|psoriasis|eczema|alopecia|medical|doctor|physician|health condition|identity|ethnic(?:ity)?|race|nationality|religion|gender|age|aging|youthful|anti[ -]?age)\b/i

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') throw new ConsultAnalysisProviderError('bad_output')
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (!cleaned || cleaned.length > max || FORBIDDEN_LANGUAGE.test(cleaned)) {
    throw new ConsultAnalysisProviderError('bad_output')
  }
  return cleaned
}

export function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  onInvalid: () => never = () => { throw new ConsultAnalysisProviderError('bad_output') },
): T[number] {
  const matched = values.find((candidate) => candidate === value)
  if (!matched) return onInvalid()
  return matched
}
