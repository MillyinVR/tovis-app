import { LookMediaAnalysisStatus, MediaType, type LookMediaAnalysis } from '@prisma/client'
import { sanitizeConsultInspirationAnalysis, toConsultInspirationAnalysisJson } from '@/lib/consult/inspirationVision'
import type { LookAnalysisFrame } from './reading'
import { LOOK_ANALYSIS_VERSION, lookAnalysisSourceHash, type LookAnalysisAsset } from './identity'

export const asset: LookAnalysisAsset = {
  id: 'asset-1', professionalId: 'pro-1', mediaType: MediaType.VIDEO,
  storageBucket: 'media', storagePath: 'pro-1/immutable.mp4',
  cropX: null, cropY: null, cropW: null, cropH: null, caption: null,
}
export function analysis(tone = 'COOL', confidence = 0.7) {
  const values = { baseLevel: 'LEVEL_5', lightestLevel: 'LEVEL_8', tone, technique: 'BALAYAGE', placement: 'MIDS_TO_ENDS', rootBlend: 'SHADOW_ROOT', finish: 'HIGH_SHINE', dimension: 'MEDIUM' }
  return sanitizeConsultInspirationAnalysis(Object.fromEntries(Object.entries(values).map(([field, value]) => [field, {
    value, confidence: { min: confidence, max: 0.9 }, evidence: ['inspiration'], region: '0.1,0.2,0.5,0.6',
  }])))
}
export function lookReadingFixture(tone = 'COOL') {
  return { model: 'fixture-model', attributes: toConsultInspirationAnalysisJson(analysis(tone)), credibilityFlags: [] }
}
function frame(atSeconds: number): LookAnalysisFrame { return { atSeconds, base64: Buffer.from(`frame-${atSeconds}`).toString('base64'), mediaType: 'image/jpeg' } }
export const frames: [LookAnalysisFrame, LookAnalysisFrame] = [frame(0), frame(1)]
export function analysisRow(overrides: Partial<LookMediaAnalysis> = {}): LookMediaAnalysis {
  return {
    id: 'analysis-1', mediaAssetId: asset.id, sourceHash: lookAnalysisSourceHash(asset), promptVersion: LOOK_ANALYSIS_VERSION,
    status: LookMediaAnalysisStatus.NEEDS_PRO, revision: 2, selectedFrame: 0, frames, frameCount: 2,
    readings: [lookReadingFixture(), lookReadingFixture('WARM')], hairMaps: null, proAnswers: null, reviewedAnalysis: null,
    reviewedByUserId: null, reviewedAt: null, failure: null, attemptCount: 1, claimedAt: null,
    runAt: new Date('2026-09-15T00:00:00Z'), createdAt: new Date('2026-09-15T00:00:00Z'), updatedAt: new Date('2026-09-15T00:00:00Z'),
    ...overrides,
  }
}
