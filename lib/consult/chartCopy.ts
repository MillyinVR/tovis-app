import 'server-only'

// Decision 2026-08-26 (full-analysis launch): with the client's recorded
// chart-copy choice, accepted consult photos are copied to durable PRO_CLIENT
// MediaAssets on the anchoring booking BEFORE the transient raw objects are
// purged. The copy reuses the existing chart-access rails end to end: the
// single MediaAsset write choke point, the private bucket, and the standard
// booking-media surfaces. It is best-effort relative to the analysis itself —
// an analysis never fails because the chart copy could not run — but the raw
// purge always proceeds regardless, so a failed copy loses the photos rather
// than retaining them without consent semantics.

import {
  ConsultCaptureStatus,
  MediaPhase,
  MediaType,
  MediaVisibility,
  Role,
} from '@prisma/client'

import { buildMediaAssetCreateData } from '@/lib/media/recordMediaAsset'
import { prisma } from '@/lib/prisma'

import { HAIR_COLOR_CAPTURE_PACK } from './capturePack'
import {
  CONSULT_CAPTURE_BUCKET,
  consultCaptureStorage,
  type ConsultCaptureStorage,
} from './captureStorage'

function extensionFor(contentType: string): string {
  return contentType === 'image/png'
    ? 'png'
    : contentType === 'image/webp'
      ? 'webp'
      : 'jpg'
}

function chartCopyObjectPath(args: {
  consultSessionId: string
  captureId: string
  shotKey: string
  contentType: string
}): string {
  // Deterministic per capture so a retried copy is idempotent (the storage
  // copy treats an existing destination as success, and the MediaAsset
  // bucket+path unique constraint dedupes the row).
  return `consult-chart/v1/${args.consultSessionId}/${args.shotKey}-${args.captureId}.${extensionFor(args.contentType)}`
}

function shotTitle(shotKey: string): string {
  return (
    HAIR_COLOR_CAPTURE_PACK.shots.find((shot) => shot.key === shotKey)?.title ??
    shotKey
  )
}

/**
 * Copies the consumed, accepted captures of a completed consult to the
 * client's chart as PRO_CLIENT booking media. Runs post-commit, after the
 * analysis revision is durable and before the raw purge. At most once per
 * consult (chartCopyCompletedAt marker); a consult whose client opted out is
 * a no-op.
 */
export async function copyConsultCapturesToChart(args: {
  consultSessionId: string
  captureIds: readonly string[]
  now?: Date
  storage?: ConsultCaptureStorage
}): Promise<void> {
  if (args.captureIds.length === 0) return
  const now = args.now ?? new Date()
  const storage = args.storage ?? consultCaptureStorage

  const session = await prisma.consultSession.findUnique({
    where: { id: args.consultSessionId },
    select: {
      id: true,
      chartCopyOptIn: true,
      chartCopyCompletedAt: true,
      professionalId: true,
      client: { select: { userId: true } },
      booking: { select: { id: true, serviceId: true, proTenantId: true } },
    },
  })
  if (!session || !session.chartCopyOptIn || session.chartCopyCompletedAt) {
    return
  }
  // A chart copy is BOOKING media: a MediaAsset is anchored to a booking and a
  // primary service, and it lands on the pro's booking-media surfaces. A
  // look-anchored consult has no visit to file the photos under yet (the
  // booking proposal is B4), so there is nothing honest to write and the copy
  // is skipped rather than invented against some other booking. The raw
  // captures still purge on the normal path.
  const booking = session.booking
  if (!booking) return

  const captures = await prisma.consultCapture.findMany({
    where: {
      id: { in: [...args.captureIds] },
      consultSessionId: session.id,
      status: ConsultCaptureStatus.ACCEPTED,
      purgedAt: null,
      storagePath: { not: null },
    },
    select: {
      id: true,
      shotKey: true,
      storageBucket: true,
      storagePath: true,
      contentType: true,
    },
    orderBy: [{ shotKey: 'asc' }, { id: 'asc' }],
  })
  if (captures.length === 0) return

  const copied: Array<{ path: string; caption: string }> = []
  for (const capture of captures) {
    if (!capture.storagePath || capture.storageBucket !== CONSULT_CAPTURE_BUCKET) {
      continue
    }
    const toPath = chartCopyObjectPath({
      consultSessionId: session.id,
      captureId: capture.id,
      shotKey: capture.shotKey,
      contentType: capture.contentType,
    })
    await storage.copyObject({ fromPath: capture.storagePath, toPath })
    copied.push({ path: toPath, caption: shotTitle(capture.shotKey) })
  }
  if (copied.length === 0) return

  await prisma.$transaction(async (tx) => {
    await tx.mediaAsset.createMany({
      data: copied.map((object) =>
        buildMediaAssetCreateData({
          professionalId: session.professionalId,
          proTenantId: booking.proTenantId,
          primaryServiceId: booking.serviceId,
          bookingId: booking.id,
          uploadedByUserId: session.client.userId,
          uploadedByRole: Role.CLIENT,
          storageBucket: CONSULT_CAPTURE_BUCKET,
          storagePath: object.path,
          mediaType: MediaType.IMAGE,
          visibility: MediaVisibility.PRO_CLIENT,
          phase: MediaPhase.BEFORE,
          caption: object.caption,
        }),
      ),
      skipDuplicates: true,
    })
    await tx.consultSession.update({
      where: { id: session.id },
      data: { chartCopyCompletedAt: now },
    })
  })
}
