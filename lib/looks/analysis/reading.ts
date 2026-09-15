import type { Prisma } from '@prisma/client'
import { isRecord } from '@/lib/guards'
import { lookAnalysisCopy as copy } from '@/lib/brand/lookAnalysisCopy'
import { CONSULT_INSPIRATION_ANALYSIS_FIELDS, CONSULT_INSPIRATION_FIELD_VALUES } from '@/lib/consult/inspirationAttributes'
import { sanitizeConsultInspirationAnalysis, sanitizeConsultInspirationCredibilityFlags, toConsultInspirationAnalysisJson, type ConsultInspirationAnalysis } from '@/lib/consult/inspirationVision'
import type { LookAnalysisQuestion } from './contracts'

export type LookAnalysisFrame = { atSeconds: number; base64: string; mediaType: 'image/jpeg' }
export type LookAnalysisReading = { model: string; attributes: ReturnType<typeof toConsultInspirationAnalysisJson>; credibilityFlags: ReturnType<typeof sanitizeConsultInspirationCredibilityFlags> }
export function parseFrames(value: Prisma.JsonValue | unknown): LookAnalysisFrame[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new Error('Invalid frames')
  return value.map(frame => {
    if (!isRecord(frame) || frame.mediaType !== 'image/jpeg' || typeof frame.atSeconds !== 'number' || !Number.isFinite(frame.atSeconds) || frame.atSeconds < 0 || typeof frame.base64 !== 'string' || frame.base64.length > 2_700_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(frame.base64)) throw new Error('Invalid frame')
    return { atSeconds: frame.atSeconds, base64: frame.base64, mediaType: 'image/jpeg' }
  })
}
/** Reuse the canonical validator. Stored boxes are objects; provider boxes are strings. */
export function readAnalysis(raw: unknown): ConsultInspirationAnalysis {
  if (!isRecord(raw)) throw new Error('Invalid reading')
  const wire = Object.fromEntries(CONSULT_INSPIRATION_ANALYSIS_FIELDS.map(field => {
    const value = raw[field]
    if (!isRecord(value)) throw new Error('Missing observation')
    const box = value.region
    return [field, { ...value, region: isRecord(box) ? [box.x, box.y, box.w, box.h].join(',') : box }]
  }))
  const degraded: Parameters<typeof sanitizeConsultInspirationAnalysis>[1] = []
  const result = sanitizeConsultInspirationAnalysis(wire, degraded)
  if (degraded.length) throw new Error('Invalid observation')
  return result
}
export function parseReading(raw: unknown): LookAnalysisReading {
  if (!isRecord(raw) || typeof raw.model !== 'string' || !raw.model.trim() || raw.model.length > 128) throw new Error('Invalid reading')
  return { model: raw.model, attributes: toConsultInspirationAnalysisJson(readAnalysis(raw.attributes)), credibilityFlags: sanitizeConsultInspirationCredibilityFlags(raw.credibilityFlags) }
}
export function readingAt(raw: Prisma.JsonValue, index: number): LookAnalysisReading {
  if (!Array.isArray(raw) || !Number.isInteger(index) || index < 0 || index >= raw.length) throw new Error('Invalid frame selection')
  return parseReading(raw[index])
}
export function stringAnswers(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}
const options = (values: readonly string[]) => values.map(value => ({ value, label: value === 'UNKNOWN' ? copy.unknown : value.toLowerCase().replaceAll('_', ' ') }))
export function analysisQuestions(reading: LookAnalysisReading | null, video = false): LookAnalysisQuestion[] {
  const questions: LookAnalysisQuestion[] = []
  if (video) questions.push({ key: 'mediaRole', label: copy.role, options: options(['FINISHED', 'BEFORE', 'MIXED', 'UNKNOWN']) })
  if (!reading) return questions
  for (const field of CONSULT_INSPIRATION_ANALYSIS_FIELDS) {
    const observed = reading.attributes[field]
    if (observed?.value === 'UNKNOWN' || (observed?.confidence.min ?? 0) < 0.5) questions.push({ key: `field:${field}`, label: copy.fields[field], options: options(CONSULT_INSPIRATION_FIELD_VALUES[field]) })
  }
  if (reading.credibilityFlags.includes('EXTENSIONS_LIKELY')) questions.push({ key: 'extensions', label: copy.extensions, options: options(['YES', 'NO', 'UNKNOWN']) })
  if (reading.credibilityFlags.some(flag => ['LIKELY_EDITED', 'LIKELY_AI_GENERATED'].includes(flag))) questions.push({ key: 'edited', label: copy.edited, options: options(['YES', 'NO', 'UNKNOWN']) })
  return questions
}
