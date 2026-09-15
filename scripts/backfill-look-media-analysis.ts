import { prisma } from '@/lib/prisma'
import { ANALYSABLE_ASSET, enqueueLookMediaAnalysisForAsset, lookAnalysisEnabled } from '@/lib/looks/analysis/queue'
import { LOOK_ANALYSIS_ASSET_SELECT, LOOK_ANALYSIS_VERSION, lookAnalysisSourceHash } from '@/lib/looks/analysis/identity'

/** Defaults to reporting only. --write enqueues; the normal worker owns paid calls. */
async function main() {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--write')) throw new Error('Supported option: --write')
  const write = args.includes('--write')
  if (write && !lookAnalysisEnabled()) throw new Error('Enable AI_LOOK_UPLOAD_ANALYSIS_ENABLED before enqueueing')
  let cursor: string | undefined
  let missing = 0, scanned = 0
  for (;;) {
    const assets = await prisma.mediaAsset.findMany({ where: ANALYSABLE_ASSET, select: LOOK_ANALYSIS_ASSET_SELECT, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })
    if (!assets.length) break
    for (const asset of assets) {
      scanned++
      const sourceHash = lookAnalysisSourceHash(asset)
      const exists = await prisma.lookMediaAnalysis.findUnique({ where: { mediaAssetId_sourceHash_promptVersion: { mediaAssetId: asset.id, sourceHash, promptVersion: LOOK_ANALYSIS_VERSION } }, select: { id: true } })
      if (exists) continue
      missing++
      if (write) await enqueueLookMediaAnalysisForAsset(prisma, asset.id)
    }
    cursor = assets.at(-1)?.id
  }
  console.info({ mode: write ? 'enqueued' : 'dry-run', scanned, missing })
}
main().catch(() => { console.error('Look analysis catch-up failed'); process.exitCode = 1 }).finally(() => prisma.$disconnect())
