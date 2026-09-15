import 'server-only'
import { LookPostStatus, LookPostVisibility, ModerationStatus, Prisma } from '@prisma/client'
import { readOptionalEnv } from '@/lib/env'
import { LOOK_ANALYSIS_ASSET_SELECT, LOOK_ANALYSIS_VERSION, lookAnalysisSourceHash } from './identity'

export function lookAnalysisEnabled(): boolean { return readOptionalEnv('AI_LOOK_UPLOAD_ANALYSIS_ENABLED') === 'true' }
export const ANALYSABLE_LOOK = { status: LookPostStatus.PUBLISHED, visibility: LookPostVisibility.PUBLIC, moderationStatus: ModerationStatus.APPROVED, clientAuthorId: null, service: { category: { consultFamily: 'HAIR' } } } satisfies Prisma.LookPostWhereInput
export const ANALYSABLE_ASSET = {
  OR: [{ lookPostPrimaryFor: { some: ANALYSABLE_LOOK } }, { lookPostAssets: { some: { lookPost: ANALYSABLE_LOOK } } }],
} satisfies Prisma.MediaAssetWhereInput
/** Enqueued in the publication transaction. Existing pending/claimed/reviewed rows never reset. */
export async function enqueueLookMediaAnalyses(db: Prisma.TransactionClient, lookPostId: string): Promise<void> {
  if (!lookAnalysisEnabled()) return
  const look = await db.lookPost.findFirst({ where: { id: lookPostId, ...ANALYSABLE_LOOK }, select: { primaryMediaAssetId: true, assets: { select: { mediaAssetId: true } } } })
  if (!look) return
  const ids = [...new Set([look.primaryMediaAssetId, ...look.assets.map(asset => asset.mediaAssetId)])]
  const assets = await db.mediaAsset.findMany({ where: { id: { in: ids }, ...ANALYSABLE_ASSET }, select: LOOK_ANALYSIS_ASSET_SELECT })
  for (const asset of assets) {
    const sourceHash = lookAnalysisSourceHash(asset)
    await db.lookMediaAnalysis.upsert({ where: { mediaAssetId_sourceHash_promptVersion: { mediaAssetId: asset.id, sourceHash, promptVersion: LOOK_ANALYSIS_VERSION } }, update: {}, create: { mediaAssetId: asset.id, sourceHash, promptVersion: LOOK_ANALYSIS_VERSION } })
  }
}

/** Reframes change the pixels; publication identity must be queued again atomically. */
export async function enqueueLookMediaAnalysisForAsset(db: Prisma.TransactionClient, mediaAssetId: string): Promise<void> {
  if (!lookAnalysisEnabled()) return
  const asset = await db.mediaAsset.findFirst({ where: { id: mediaAssetId, ...ANALYSABLE_ASSET }, select: LOOK_ANALYSIS_ASSET_SELECT })
  if (!asset) return
  const sourceHash = lookAnalysisSourceHash(asset)
  await db.lookMediaAnalysis.upsert({ where: { mediaAssetId_sourceHash_promptVersion: { mediaAssetId, sourceHash, promptVersion: LOOK_ANALYSIS_VERSION } }, update: {}, create: { mediaAssetId, sourceHash, promptVersion: LOOK_ANALYSIS_VERSION } })
}
