// Shared boundary checks for analysis observations and look-plan output.
import type { ConsultAnalysisObservationDTO } from '@/lib/dto/consult'

/** Existing look-plan evidence floor, shared with Suitability Translation. */
export function isSupportedConsultObservation(value: ConsultAnalysisObservationDTO<string>): boolean {
  return value.value !== 'UNKNOWN' && value.confidence.min >= 0.5 &&
    value.evidence.some(key => key !== 'intake')
}

export class ConsultAnalysisProviderError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'refused' | 'bad_output',
    /**
     * Which check refused, as a content-free name (`eye_color_evidence`,
     * `text_length`, …) — for `rejectedAt`'s log line, never for the client.
     * Until 2026-09-12 a `bad_output` named only its stage, and the check
     * that took "Build my plan" down in prod needed a paid reproduction to
     * find. Null for kinds that are not a check.
     */
    readonly check: string | null = null,
  ) {
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
  if (typeof value !== 'string') throw new ConsultAnalysisProviderError('bad_output', 'text_type')
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (!cleaned) throw new ConsultAnalysisProviderError('bad_output', 'text_empty')
  if (cleaned.length > max) throw new ConsultAnalysisProviderError('bad_output', 'text_length')
  if (FORBIDDEN_LANGUAGE.test(cleaned)) throw new ConsultAnalysisProviderError('bad_output', 'text_forbidden')
  return cleaned
}

export function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  onInvalid: () => never = () => { throw new ConsultAnalysisProviderError('bad_output', 'enum') },
): T[number] {
  const matched = values.find((candidate) => candidate === value)
  if (!matched) return onInvalid()
  return matched
}
