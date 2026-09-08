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
  Prisma,
} from '@prisma/client'

import { buildMediaAssetCreateData } from '@/lib/media/recordMediaAsset'
import { prisma } from '@/lib/prisma'
import { requireCurrentConsultAgreementAcceptances } from './agreementContract'
import { safeError } from '@/lib/security/logging'
import { CONSULT_OPEN_WINDOW_SELECT, consultLinkedBooking } from './openWindow'

import { findConsultCaptureShot } from './capture/registry'
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
  return findConsultCaptureShot(shotKey)?.title ?? shotKey
}

/**
 * Copies the consumed, accepted captures of a completed consult to the
 * client's chart as PRO_CLIENT booking media. Runs post-commit, after the
 * analysis revision is durable, and again after booking. Object paths make
 * each capture idempotent; a later accepted retake must not be skipped because
 * an older capture already set the completion marker. Opted-out sessions are
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

  return prisma.$transaction(async (tx) => {
    // Revocation and chart-copy choice use this same session lock. Consent
    // must remain current until durable chart media is recorded.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "ConsultSession" WHERE id = ${args.consultSessionId} FOR UPDATE`)
    const session = await tx.consultSession.findUnique({
      where: { id: args.consultSessionId },
      select: {
        id: true,
        chartCopyOptIn: true,
        bookingId: true,
        status: true,
        professionalId: true,
        client: { select: { userId: true } },
        booking: { select: { ...CONSULT_OPEN_WINDOW_SELECT.booking.select, serviceId: true, proTenantId: true } },
        inspiredBookings: { ...CONSULT_OPEN_WINDOW_SELECT.inspiredBookings,
          select: { ...CONSULT_OPEN_WINDOW_SELECT.inspiredBookings.select, serviceId: true, proTenantId: true } },
      },
    })
    if (!session || !session.chartCopyOptIn || session.status === 'CANCELLED') {
      return
    }
    // Resolve the persisted link used by both booking entry paths. Before a
    // look is booked there is no chart visit; finalize retries after linking it.
    const booking = consultLinkedBooking(session)
    if (!booking || ['CANCELLED', 'NO_SHOW'].includes(booking.status)) return
    await requireCurrentConsultAgreementAcceptances(tx, session.id)

    const captures = await tx.consultCapture.findMany({
      where: {
        id: { in: [...args.captureIds] },
        consultSessionId: session.id,
        status: ConsultCaptureStatus.ACCEPTED,
        purgedAt: null,
        purgeRequestedAt: null,
        rawExpiresAt: { gt: now },
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
  }, { maxWait: 10_000, timeout: 60_000 })
}

/** Post-booking retry: use only the booking's committed consultation link. */
export async function copyBookedConsultCapturesToChart(bookingId: string): Promise<void> {
  try {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId },
      select: { sourceConsultSessionId: true } })
    if (!booking?.sourceConsultSessionId) return
    const captures = await prisma.consultCapture.findMany({ where: {
      consultSessionId: booking.sourceConsultSessionId, status: 'ACCEPTED',
      purgedAt: null, purgeRequestedAt: null, rawExpiresAt: { gt: new Date() },
    }, select: { id: true } })
    await copyConsultCapturesToChart({ consultSessionId: booking.sourceConsultSessionId,
      captureIds: captures.map(capture => capture.id) })
  } catch (error) {
    // The appointment has committed; a storage failure cannot undo booking.
    console.error('Booked consultation chart copy failed', { bookingId, error: safeError(error) })
  }
}
