import { runConsultHairMap, type ConsultHairMapProvider } from '@/lib/consult/hairMapRuntime'
import { sanitizeConsultHairMap } from '@/lib/consult/hairMap'
import { flushConsultProviderMeter, type ConsultProviderCallRecord } from '@/lib/consult/providerMeter'
import 'server-only'
import { Prisma, MediaType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { runConsultInspirationVision, toConsultInspirationAnalysisJson, ConsultInspirationVisionError, type ConsultInspirationVisionProvider } from '@/lib/consult/inspirationVision'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { LOOK_ANALYSIS_ASSET_SELECT, LOOK_ANALYSIS_VERSION, lookAnalysisSourceHash } from './identity'
import { ANALYSABLE_ASSET, lookAnalysisEnabled } from './queue'
import { loadLookAnalysisFrames } from './images'
import { analysisQuestions, parseFrames, type LookAnalysisReading } from './reading'
import { notifyLookAnalysis } from './notify'

/** One media item per invocation: three 50s vision reads plus decoding fit the 300s route. */
export async function processNextLookAnalysis(deps: { provider?: ConsultInspirationVisionProvider; hairMapProvider?: ConsultHairMapProvider; frames?: typeof loadLookAnalysisFrames } = {}) {
  if (!lookAnalysisEnabled()) return { status: 'DISABLED' }
  const now = new Date(), leaseCutoff = new Date(now.getTime() - 6 * 60_000)
  const claimed = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "LookMediaAnalysis" WHERE (status = 'PENDING' AND "runAt" <= ${now})
      OR (status = 'PROCESSING' AND "claimedAt" < ${leaseCutoff})
      ORDER BY "runAt", id FOR UPDATE SKIP LOCKED LIMIT 1`)
    if (!rows[0]) return null
    return tx.lookMediaAnalysis.update({ where: { id: rows[0].id }, data: { status: 'PROCESSING', claimedAt: now, attemptCount: { increment: 1 } } })
  })
  if (!claimed) return { status: 'IDLE' }
  try {
    if (claimed.attemptCount > 3) throw new Error('Attempt limit reached')
    const asset = await prisma.mediaAsset.findFirst({ where: { id: claimed.mediaAssetId, ...ANALYSABLE_ASSET }, select: LOOK_ANALYSIS_ASSET_SELECT })
    if (!asset || lookAnalysisSourceHash(asset) !== claimed.sourceHash || claimed.promptVersion !== LOOK_ANALYSIS_VERSION) {
      await prisma.lookMediaAnalysis.updateMany({ where: { id: claimed.id, status: 'PROCESSING', claimedAt: now }, data: { status: 'REJECTED', failure: 'SOURCE_CHANGED', frames: Prisma.DbNull, readings: Prisma.DbNull } })
      return { status: 'SOURCE_CHANGED' }
    }
    const frames = parseFrames(claimed.frames ?? await (deps.frames ?? loadLookAnalysisFrames)(asset))
    // Save normalized frames before calling so a retry does not decode video again.
    const saved = await prisma.lookMediaAnalysis.updateMany({ where: { id: claimed.id, claimedAt: now, status: 'PROCESSING' }, data: { frames, frameCount: frames.length } })
    if (!saved.count) return { status: 'LEASE_LOST' }
    const readings: Array<LookAnalysisReading | null> = []
    const hairMaps: Array<Prisma.InputJsonValue | null> = []
    const meter = { record: async (record: ConsultProviderCallRecord) => {
      await prisma.lookMediaAnalysisCall.create({ data: { analysisId: claimed.id, measurement: JSON.parse(JSON.stringify(record)) } })
    } }
    for (const frame of frames) {
      try {
        const results = await Promise.allSettled([
          (deps.provider ?? runConsultInspirationVision)({ image: frame, meter }),
          (deps.hairMapProvider ?? runConsultHairMap)({ scope: { role: 'REFERENCE', views: ['inspiration'] }, images: [{ view: 'inspiration', image: frame }], meter }),
        ])
        const [vision, hairMap] = results
        if (vision.status === 'rejected') throw vision.reason
        if (hairMap.status === 'rejected') throw hairMap.reason
        const result = vision.value, map = hairMap.value
        const sanitizedMap = sanitizeConsultHairMap(map.raw, { role: 'REFERENCE', views: ['inspiration'] })
        readings.push({ model: result.model, attributes: toConsultInspirationAnalysisJson(result.analysis), credibilityFlags: result.credibilityFlags })
        hairMaps.push(JSON.parse(JSON.stringify({ model: map.model, map: sanitizedMap })))
      } catch (error) {
        if (asset.mediaType !== MediaType.VIDEO || !(error instanceof ConsultInspirationVisionError) || error.kind !== 'unreadable') throw error
        readings.push(null); hairMaps.push(null)
      }
    }
    await flushConsultProviderMeter()
    const selectedFrame = readings.findIndex(reading => reading !== null)
    if (selectedFrame < 0) throw new ConsultInspirationVisionError('unreadable')
    const needsPro = analysisQuestions(readings[selectedFrame] ?? null, asset.mediaType === MediaType.VIDEO).length > 0
    const completed = await prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "MediaAsset" WHERE id = ${asset.id} FOR SHARE`)
      const current = await tx.mediaAsset.findFirst({ where: { id: asset.id, ...ANALYSABLE_ASSET }, select: LOOK_ANALYSIS_ASSET_SELECT })
      const valid = current && lookAnalysisSourceHash(current) === claimed.sourceHash
      const result = await tx.lookMediaAnalysis.updateMany({ where: { id: claimed.id, claimedAt: now, status: 'PROCESSING' }, data: valid ? {
        readings: JSON.parse(JSON.stringify(readings)), hairMaps, selectedFrame, status: needsPro ? 'NEEDS_PRO' : 'READY', claimedAt: null, failure: null, revision: { increment: 1 },
      } : { status: 'REJECTED', failure: 'SOURCE_CHANGED', frames: Prisma.DbNull, readings: Prisma.DbNull } })
      if (result.count && valid && needsPro) await notifyLookAnalysis(tx, { id: claimed.id, professionalId: asset.professionalId, revision: claimed.revision + 1, admin: false })
      return !result.count ? 'LEASE_LOST' : !valid ? 'SOURCE_CHANGED' : needsPro ? 'NEEDS_PRO' : 'READY'
    })
    kickNotificationDrain()
    return { status: completed }
  } catch (error) {
    const retryable = !(error instanceof ConsultInspirationVisionError) || error.kind === 'unavailable'
    const retry = retryable && claimed.attemptCount < 3
    // Media content, provider output and credentials never become error messages.
    const failure = error instanceof ConsultInspirationVisionError ? `VISION_${error.kind.toUpperCase()}` : 'ANALYSIS_FAILED'
    await prisma.$transaction(async tx => {
      const changed = await tx.lookMediaAnalysis.updateMany({ where: { id: claimed.id, claimedAt: now, status: 'PROCESSING' }, data: {
        status: retry ? 'PENDING' : 'FAILED', claimedAt: null, failure, runAt: new Date(Date.now() + 5 * 60_000), revision: { increment: 1 },
      } })
      const asset = await tx.mediaAsset.findUnique({ where: { id: claimed.mediaAssetId }, select: { professionalId: true } })
      if (!retry && changed.count && asset) await notifyLookAnalysis(tx, { id: claimed.id, professionalId: asset.professionalId, revision: claimed.revision + 1, admin: true })
    })
    kickNotificationDrain()
    return { status: retry ? 'RETRY_SCHEDULED' : 'FAILED' }
  }
}
