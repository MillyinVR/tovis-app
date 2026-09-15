import 'server-only'
import { MediaType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isRecord } from '@/lib/guards'
import { CONSULT_INSPIRATION_ANALYSIS_FIELDS, CONSULT_INSPIRATION_FIELD_VALUES } from '@/lib/consult/inspirationAttributes'
import { toConsultInspirationAnalysisJson } from '@/lib/consult/inspirationVision'
import { ANALYSABLE_ASSET } from './queue'
import { LOOK_ANALYSIS_ASSET_SELECT, LOOK_ANALYSIS_VERSION, lookAnalysisSourceHash } from './identity'
import { analysisQuestions, parseFrames, parseReading, readAnalysis, readingAt, stringAnswers } from './reading'
import { notifyLookAnalysis } from './notify'
import type { LookAnalysisItem, LookAnalysisMutation } from './contracts'

export class LookAnalysisError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}
export type LookReviewScope = { actorUserId: string; professionalId: string | null; admin: boolean }
const include = { mediaAsset: { select: LOOK_ANALYSIS_ASSET_SELECT } } satisfies Prisma.LookMediaAnalysisInclude
function scopeWhere(scope: LookReviewScope): Prisma.LookMediaAnalysisWhereInput {
  if (!scope.admin && !scope.professionalId) throw new LookAnalysisError(404, 'Not found')
  return { promptVersion: LOOK_ANALYSIS_VERSION, mediaAsset: { ...ANALYSABLE_ASSET, ...(scope.admin ? {} : { professionalId: scope.professionalId! }) } }
}
/** Reject malformed requests, rather than allowing a malformed correction to degrade to UNKNOWN. */
export function parseLookReview(raw: unknown): LookAnalysisMutation {
  if (!isRecord(raw) || !Number.isInteger(raw.revision) || Number(raw.revision) < 0 || !['answer', 'approve', 'reject', 'retry'].includes(String(raw.action)) || Object.keys(raw).some(key => !['revision', 'action', 'selectedFrame', 'answers', 'corrections'].includes(key))) throw new LookAnalysisError(400, 'Invalid review')
  const action = (['answer', 'approve', 'reject', 'retry'] as const).find(value => value === raw.action)!
  const result: LookAnalysisMutation = { revision: Number(raw.revision), action }
  if (raw.selectedFrame !== undefined) {
    if (!Number.isInteger(raw.selectedFrame) || Number(raw.selectedFrame) < 0 || Number(raw.selectedFrame) > 2) throw new LookAnalysisError(400, 'Invalid frame')
    result.selectedFrame = Number(raw.selectedFrame)
  }
  if (raw.answers !== undefined) {
    if (!isRecord(raw.answers) || Object.keys(raw.answers).length > 12 || Object.entries(raw.answers).some(([key, value]) => key.length > 40 || typeof value !== 'string' || value.length > 80)) throw new LookAnalysisError(400, 'Invalid answers')
    result.answers = stringAnswers(raw.answers)
  }
  if (raw.corrections !== undefined) {
    if (!isRecord(raw.corrections)) throw new LookAnalysisError(400, 'Invalid corrections')
    const corrections: NonNullable<LookAnalysisMutation['corrections']> = {}
    for (const [key, value] of Object.entries(raw.corrections)) {
      const field = CONSULT_INSPIRATION_ANALYSIS_FIELDS.find(field => field === key)
      if (!field || !isRecord(value) || typeof value.value !== 'string' || !CONSULT_INSPIRATION_FIELD_VALUES[field].includes(value.value) || !isRecord(value.confidence)) throw new LookAnalysisError(400, 'Invalid correction')
      const { min, max } = value.confidence
      if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 1 || min >= max) throw new LookAnalysisError(400, 'Invalid confidence')
      let region = null
      if (value.region !== null) {
        const box = value.region
        if (!isRecord(box) || typeof box.x !== 'number' || typeof box.y !== 'number' || typeof box.w !== 'number' || typeof box.h !== 'number' || ![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.x < 0 || box.y < 0 || box.w < 0.02 || box.h < 0.02 || box.x + box.w > 1 || box.y + box.h > 1) throw new LookAnalysisError(400, 'Invalid region')
        region = { x: box.x, y: box.y, w: box.w, h: box.h }
      }
      if (value.value === 'UNKNOWN' ? region !== null || max > 0.35 : region === null) throw new LookAnalysisError(400, 'Unsupported correction')
      corrections[field] = { value: value.value, confidence: { min, max }, region }
    }
    result.corrections = corrections
  }
  return result
}
export async function listLookAnalyses(scope: LookReviewScope): Promise<LookAnalysisItem[]> {
  const rows = await prisma.lookMediaAnalysis.findMany({ where: scopeWhere(scope), select: {
    id: true, mediaAssetId: true, sourceHash: true, status: true, revision: true, readings: true,
    reviewedAnalysis: true, proAnswers: true, selectedFrame: true, frameCount: true, failure: true, reviewedByUserId: true,
    mediaAsset: { select: LOOK_ANALYSIS_ASSET_SELECT },
  }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 100 })
  return rows.filter(row => lookAnalysisSourceHash(row.mediaAsset) === row.sourceHash).map(row => {
    const reading = row.readings ? readingAt(row.readings, row.selectedFrame) : null
    return { id: row.id, mediaAssetId: row.mediaAssetId, status: row.status, revision: row.revision,
      mediaType: row.mediaAsset.mediaType, caption: row.mediaAsset.caption, selectedFrame: row.selectedFrame,
      frameCount: row.frameCount, frameReadBase: `/api/v1/${scope.admin ? 'admin' : 'pro'}/looks/analysis/${row.id}/frames`,
      questions: analysisQuestions(reading, row.mediaAsset.mediaType === MediaType.VIDEO), answers: stringAnswers(row.proAnswers),
      observations: reading?.attributes ?? {}, reviewedObservations: row.reviewedAnalysis ? parseReading(row.reviewedAnalysis).attributes : undefined, flags: reading?.credibilityFlags ?? [], failure: row.failure, reviewedByUserId: row.reviewedByUserId }
  })
}
export async function readReviewFrame(scope: LookReviewScope, id: string, index: number) {
  const row = await prisma.lookMediaAnalysis.findFirst({ where: { id, ...scopeWhere(scope) }, include })
  if (!row || lookAnalysisSourceHash(row.mediaAsset) !== row.sourceHash || !row.frames) throw new LookAnalysisError(404, 'Not found')
  const frame = parseFrames(row.frames)[index]
  if (!frame) throw new LookAnalysisError(404, 'Not found')
  return Buffer.from(frame.base64, 'base64')
}
export async function mutateLookAnalysis(scope: LookReviewScope, id: string, change: LookAnalysisMutation) {
  if (!scope.admin && (change.action !== 'answer' || change.corrections !== undefined)) throw new LookAnalysisError(403, 'Not permitted')
  await prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "LookMediaAnalysis" WHERE id = ${id} FOR UPDATE`)
    const row = await tx.lookMediaAnalysis.findFirst({ where: { id, ...scopeWhere(scope) }, include })
    if (!row || lookAnalysisSourceHash(row.mediaAsset) !== row.sourceHash) throw new LookAnalysisError(404, 'Not found')
    if (row.revision !== change.revision || row.status === 'PROCESSING') throw new LookAnalysisError(409, 'Reading changed. Refresh before reviewing.')
    if (!scope.admin && row.status !== 'NEEDS_PRO') throw new LookAnalysisError(409, 'This reading is no longer awaiting clarification')
    const next = row.revision + 1
    if (change.action === 'retry') {
      if (row.status !== 'FAILED') throw new LookAnalysisError(409, 'Only failed analyses may be retried')
      await tx.lookMediaAnalysis.update({ where: { id }, data: { status: 'PENDING', attemptCount: 0, runAt: new Date(), claimedAt: null, failure: null, revision: next } })
    } else if (change.action === 'reject') {
      await tx.lookMediaAnalysis.update({ where: { id }, data: { status: 'REJECTED', revision: next } })
    } else {
      const selectedFrame = change.selectedFrame ?? row.selectedFrame
      if (!row.frames || !row.readings || !parseFrames(row.frames)[selectedFrame]) throw new LookAnalysisError(409, 'Analysis is not ready for review')
      let original
      try { original = readingAt(row.readings, selectedFrame) } catch { throw new LookAnalysisError(409, 'This frame could not be read. Select a different frame.') }
      if (change.action === 'answer') {
        const questions = analysisQuestions(original, row.mediaAsset.mediaType === MediaType.VIDEO)
        const answers = change.answers ?? {}
        for (const [key, value] of Object.entries(answers)) {
          const question = questions.find(question => question.key === key)
          if (!question?.options.some(option => option.value === value)) throw new LookAnalysisError(400, 'Invalid clarification')
        }
        const selectingFrame = selectedFrame !== row.selectedFrame && change.answers === undefined
        if (!scope.admin && !selectingFrame && questions.some(question => !answers[question.key])) throw new LookAnalysisError(400, 'Answer each clarification or choose not sure')
        await tx.lookMediaAnalysis.update({ where: { id }, data: { selectedFrame, proAnswers: answers, reviewedAnalysis: Prisma.DbNull, reviewedAt: null, reviewedByUserId: null, status: selectingFrame && !scope.admin ? 'NEEDS_PRO' : 'NEEDS_ADMIN', revision: next } })
        if (!selectingFrame || scope.admin) await notifyLookAnalysis(tx, { id, professionalId: row.mediaAsset.professionalId, revision: next, admin: true })
      } else {
        if (selectedFrame !== row.selectedFrame) throw new LookAnalysisError(409, 'Save and inspect the selected frame before approval')
        const merged = { ...(row.reviewedAnalysis ? parseReading(row.reviewedAnalysis).attributes : original.attributes) }
        for (const field of CONSULT_INSPIRATION_ANALYSIS_FIELDS) {
          const correction = change.corrections?.[field]
          if (correction) merged[field] = { ...correction, evidence: correction.value === 'UNKNOWN' ? [] : ['inspiration'] }
        }
        let analysis
        try { analysis = readAnalysis(merged) } catch { throw new LookAnalysisError(400, 'The reviewed reading is invalid or has no supported observations') }
        await tx.lookMediaAnalysis.update({ where: { id }, data: { reviewedAnalysis: { ...original, attributes: toConsultInspirationAnalysisJson(analysis) }, reviewedByUserId: scope.actorUserId, reviewedAt: new Date(), status: 'READY', revision: next } })
      }
    }
    // Append-only review history preserves both the original model reading and each human decision.
    await tx.lookMediaAnalysisReview.create({ data: { analysisId: id, actorUserId: scope.actorUserId, actorRole: scope.admin ? 'ADMIN' : 'PRO', action: change.action, revision: next, payload: JSON.parse(JSON.stringify(change)) } })
  })
}
