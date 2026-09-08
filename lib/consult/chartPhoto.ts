import 'server-only'
import { createHash } from 'node:crypto'
import { ConsultActorType, Prisma } from '@prisma/client'
import { readOptionalEnv } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { formatInTimeZone, DEFAULT_TIME_ZONE } from '@/lib/time'
import type { ConsultChartPhotoDTO } from '@/lib/dto/consult'
import { defaultClientConsultThreadCopy } from '@/lib/brand/defaultClientConsultThreadCopy'
import { fillConsultThreadCopy } from './threadCopy'
import { loadClientChartFacts } from './chartFacts'
import { ConsultWriteError } from './errors'
import { requireCurrentConsultAgreementAcceptances } from './agreementContract'
import { CONSULT_OPEN_WINDOW_SELECT, assertConsultReadableScope } from './openWindow'
import { loadConsultCaptureState, issueConsultCaptureUpload, attachConsultCaptureUpload, checkConsultCaptureQuality } from './captureContract'
import { consultCaptureStorage, CONSULT_CAPTURE_BUCKET, CONSULT_CAPTURE_MAX_BYTES } from './captureStorage'
import { CONSULT_EARLY_PHOTO_SHOT_KEY, CONSULT_EARLY_PHOTO_PACK_VERSION } from './capture/earlyPhoto'

async function requirePhotoScope(tx: Prisma.TransactionClient, args: { consultSessionId: string; clientId: string }) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ConsultSession" WHERE id = ${args.consultSessionId} FOR SHARE`)
  const session = await tx.consultSession.findUnique({ where: { id: args.consultSessionId },
    select: { ...CONSULT_OPEN_WINDOW_SELECT, id: true, status: true } })
  if (!session || session.clientId !== args.clientId) throw new ConsultWriteError('NOT_FOUND', 'Consultation unavailable.')
  assertConsultReadableScope(session)
  await requireCurrentConsultAgreementAcceptances(tx, session.id)
  return session
}

async function sourcePhoto(tx: Prisma.TransactionClient, args: { consultSessionId: string; clientId: string; professionalId: string; mediaAssetId: string }) {
  const chart = await loadClientChartFacts({ ...args, excludeConsultSessionId: args.consultSessionId, tx })
  const dated = chart.photos.find(photo => photo.mediaAssetId === args.mediaAssetId)
  if (!dated) throw new ConsultWriteError('NOT_FOUND', 'This chart photo is no longer available.')
  const photo = await tx.mediaAsset.findFirst({ where: { id: args.mediaAssetId, professionalId: args.professionalId,
    storageBucket: CONSULT_CAPTURE_BUCKET, storagePath: { startsWith: 'consult-chart/v1/' } },
    select: { id: true, storagePath: true } })
  if (!photo) throw new ConsultWriteError('NOT_FOUND', 'This chart photo is no longer available.')
  return { ...photo, recordedAt: dated.recordedAt }
}

/** A signed preview is issued only after current consult and chart consent. */
export async function loadClientChartPhotoOffers(args: { consultSessionId: string; clientId: string }): Promise<ConsultChartPhotoDTO[]> {
  if (readOptionalEnv('AI_CONSULT_CHART_PREFILL_ENABLED') !== 'true') return []
  return prisma.$transaction(async tx => {
    const session = await requirePhotoScope(tx, args)
    const chart = await loadClientChartFacts({ ...args, professionalId: session.professionalId, excludeConsultSessionId: session.id, tx })
    const photos = await tx.mediaAsset.findMany({ where: {
      id: { in: chart.photos.map(photo => photo.mediaAssetId) }, professionalId: session.professionalId,
      storageBucket: CONSULT_CAPTURE_BUCKET, storagePath: { startsWith: 'consult-chart/v1/' },
    }, select: { id: true, storagePath: true }, orderBy: { createdAt: 'desc' }, take: 3 })
    if (!photos.length) return []
    await consultCaptureStorage.assertReady()
    return Promise.all(photos.map(async photo => {
      const dated = chart.photos.find(item => item.mediaAssetId === photo.id)!
      return { mediaAssetId: photo.id, recordedAt: dated.recordedAt,
        url: await consultCaptureStorage.createSignedRead(photo.storagePath, 120),
        label: fillConsultThreadCopy(defaultClientConsultThreadCopy.chartPhotoConfirm, { date: formatInTimeZone(dated.recordedAt, DEFAULT_TIME_ZONE,
          { month: 'long', day: 'numeric', year: 'numeric' }) }) }
    }))
  })
}

/** Reuse traverses the same upload, attach and quality gates as a new photo. */
export async function confirmClientChartPhoto(args: {
  consultSessionId: string; clientId: string; actorUserId: string; mediaAssetId: string; idempotencyKey: string
}) {
  if (readOptionalEnv('AI_CONSULT_CHART_PREFILL_ENABLED') !== 'true') throw new ConsultWriteError('NOT_FOUND', 'Consultation unavailable.')
  if (!args.idempotencyKey.trim() || args.idempotencyKey.length > 128) throw new ConsultWriteError('INVALID_REQUEST', 'Invalid photo confirmation.')
  const state = await loadConsultCaptureState(args)
  const actor = { type: ConsultActorType.CLIENT, id: args.actorUserId } as const
  const previous = await prisma.consultChartPhotoUse.findUnique({ where: {
    consultSessionId_idempotencyKey: { consultSessionId: args.consultSessionId, idempotencyKey: args.idempotencyKey },
  } })
  if (previous) {
    if (previous.mediaAssetId !== args.mediaAssetId) throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'This confirmation was used for another photo.')
    await checkConsultCaptureQuality({ ...args, actor, captureId: previous.captureId,
      loadInput: async () => ({ idempotencyKey: `chart-quality:${previous.id}`, shotPackVersion: CONSULT_EARLY_PHOTO_PACK_VERSION, schemaVersion: state.shotPack.schemaVersion }) })
    return
  }
  const source = await prisma.$transaction(async tx => {
    const session = await requirePhotoScope(tx, args)
    return sourcePhoto(tx, { ...args, professionalId: session.professionalId })
  })
  const contentType = source.storagePath.endsWith('.png') ? 'image/png' : source.storagePath.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
  await consultCaptureStorage.assertReady()
  const object = await consultCaptureStorage.inspectObject({ path: source.storagePath, expectedContentType: contentType,
    maxBytes: CONSULT_CAPTURE_MAX_BYTES, expectedChecksumSha256: null })
  const key = createHash('sha256').update(JSON.stringify([args.idempotencyKey, args.mediaAssetId])).digest('hex')
  let capture = await prisma.consultCapture.findUnique({ where: { consultSessionId_attachIdempotencyKey: {
    consultSessionId: args.consultSessionId, attachIdempotencyKey: `chart-attach:${key}`,
  } }, select: { id: true } })
  if (!capture) {
    const issued = await issueConsultCaptureUpload({ ...args, actor, loadInput: async ({ tx, professionalId }) => {
      const current = await sourcePhoto(tx, { ...args, professionalId })
      if (current.storagePath !== source.storagePath) throw new ConsultWriteError('INVALID_STATE', 'The chart photo changed. Review it again.')
      return { idempotencyKey: `chart-issue:${key}`, shotKey: CONSULT_EARLY_PHOTO_SHOT_KEY,
        shotPackVersion: CONSULT_EARLY_PHOTO_PACK_VERSION, schemaVersion: state.shotPack.schemaVersion,
        contentType, sizeBytes: object.sizeBytes, checksumSha256: object.checksumSha256 }
    } })
    const upload = await prisma.uploadSession.findUniqueOrThrow({ where: { id: issued.upload.uploadSessionId }, select: { storagePath: true } })
    await consultCaptureStorage.copyObject({ fromPath: source.storagePath, toPath: upload.storagePath })
    const attached = await attachConsultCaptureUpload({ ...args, actor, loadInput: async () => ({
      idempotencyKey: `chart-attach:${key}`, uploadSessionId: issued.upload.uploadSessionId,
      shotKey: CONSULT_EARLY_PHOTO_SHOT_KEY, shotPackVersion: CONSULT_EARLY_PHOTO_PACK_VERSION, schemaVersion: state.shotPack.schemaVersion,
    }) })
    capture = { id: attached.captureId }
  }
  const captureId = capture.id
  const use = await prisma.$transaction(async tx => {
    const session = await requirePhotoScope(tx, args)
    await sourcePhoto(tx, { ...args, professionalId: session.professionalId })
    await tx.consultChartPhotoUse.createMany({ skipDuplicates: true, data: [{ consultSessionId: args.consultSessionId,
      captureId, mediaAssetId: source.id, sourceRecordedAt: new Date(source.recordedAt), idempotencyKey: args.idempotencyKey }] })
    const saved = await tx.consultChartPhotoUse.findUniqueOrThrow({ where: { consultSessionId_idempotencyKey: {
      consultSessionId: args.consultSessionId, idempotencyKey: args.idempotencyKey,
    } } })
    if (saved.mediaAssetId !== args.mediaAssetId || saved.captureId !== captureId) {
      throw new ConsultWriteError('IDEMPOTENCY_CONFLICT', 'This confirmation was used for another photo.')
    }
    return saved
  })
  await checkConsultCaptureQuality({ ...args, actor, captureId: use.captureId,
    loadInput: async () => ({ idempotencyKey: `chart-quality:${use.id}`, shotPackVersion: CONSULT_EARLY_PHOTO_PACK_VERSION, schemaVersion: state.shotPack.schemaVersion }) })
}
