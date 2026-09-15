import { isRecord } from '@/lib/guards'
import { sanitizeConsultHairMap } from '@/lib/consult/hairMap'
import 'server-only'
import type { Prisma } from '@prisma/client'
import { LOOK_ANALYSIS_ASSET_SELECT, LOOK_ANALYSIS_VERSION, lookAnalysisSourceHash, type LookAnalysisAsset } from './identity'
import { parseFrames, parseReading, readingAt } from './reading'
import { ANALYSABLE_ASSET, lookAnalysisEnabled } from './queue'

/** Caller first resolves the look through BOTH consultation participants' visibility rules. */
export async function loadReusableLookAnalysis(db: Prisma.TransactionClient, asset: LookAnalysisAsset) {
  if (!lookAnalysisEnabled()) return null
  const eligible = await db.mediaAsset.findFirst({ where: { id: asset.id, ...ANALYSABLE_ASSET }, select: LOOK_ANALYSIS_ASSET_SELECT })
  if (!eligible || lookAnalysisSourceHash(eligible) !== lookAnalysisSourceHash(asset)) return null
  const row = await db.lookMediaAnalysis.findUnique({ where: { mediaAssetId_sourceHash_promptVersion: { mediaAssetId: asset.id, sourceHash: lookAnalysisSourceHash(asset), promptVersion: LOOK_ANALYSIS_VERSION } } })
  if (!row || row.status !== 'READY' || !row.frames || !row.readings) return null
  const original = readingAt(row.readings, row.selectedFrame)
  const reading = row.reviewedAnalysis ? parseReading(row.reviewedAnalysis) : original
  const changed = JSON.stringify(reading.attributes) !== JSON.stringify(original.attributes)
  const frame = parseFrames(row.frames)[row.selectedFrame]
  if (!frame) return null
  const map = Array.isArray(row.hairMaps) ? row.hairMaps[row.selectedFrame] : null
  const referenceMap = !changed && isRecord(map) && typeof map.model === 'string' ? { model: map.model, map: sanitizeConsultHairMap(map.map, { role: 'REFERENCE', views: ['inspiration'] }) } : undefined
  return { referenceMap, id: row.id, revision: row.revision, reading, frame, reviewed: row.reviewedByUserId !== null }
}
