import { CONSULT_HAIR_MAP_PROMPT_VERSION } from '@/lib/consult/hairMap'
import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION, CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION } from '@/lib/consult/inspirationVision'

export const LOOK_ANALYSIS_VERSION = `look-media-v1:${CONSULT_HAIR_MAP_PROMPT_VERSION}:${CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION}:${CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION}`
export const LOOK_ANALYSIS_ASSET_SELECT = {
  id: true, professionalId: true, mediaType: true, storageBucket: true, storagePath: true,
  cropX: true, cropY: true, cropW: true, cropH: true, caption: true,
} satisfies Prisma.MediaAssetSelect
export type LookAnalysisAsset = Prisma.MediaAssetGetPayload<{ select: typeof LOOK_ANALYSIS_ASSET_SELECT }>
/** Immutable storage object + consent crop. Captions and pro answers do not change pixels. */
export function lookAnalysisSourceHash(asset: LookAnalysisAsset): string {
  return createHash('sha256').update(JSON.stringify([asset.id, asset.mediaType, asset.storageBucket, asset.storagePath, asset.cropX, asset.cropY, asset.cropW, asset.cropH])).digest('hex')
}
