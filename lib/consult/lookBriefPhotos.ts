import 'server-only'
import type { ConsultLookBriefPhotosDTO } from '@/lib/dto/consult'
import { prisma } from '@/lib/prisma'
import { requireAuthorizedProLookScope } from './lookBrief'
import { consultCaptureStorage } from './captureStorage'
import { resolveLockedConsultInspirationReadTarget, mintConsultInspirationReadUrl } from './inspirationContract'
import { ConsultWriteError } from './errors'

/** Read permission and retention are checked before issuing short-lived URLs. */
export async function loadProLookBriefPhotos(args: {
  consultSessionId: string; professionalId: string; actorUserId: string
}): Promise<ConsultLookBriefPhotosDTO> {
  return prisma.$transaction(async tx => {
    const session = await requireAuthorizedProLookScope(tx, args, { readOnly: true })
    const now = new Date()
    const captures = await tx.consultCapture.findMany({ where: {
      consultSessionId: session.id, status: 'ACCEPTED', purgedAt: null, purgeRequestedAt: null,
      rawExpiresAt: { gt: now }, storagePath: { not: null },
    }, select: { id: true, shotKey: true, storagePath: true }, orderBy: { createdAt: 'desc' } })
    const latest = [...new Map(captures.toReversed().flatMap(capture => capture.storagePath ? [[capture.shotKey, { ...capture, storagePath: capture.storagePath }] as const] : [])).values()]
    let inspirationUrl: string | null = null
    try {
      const target = await resolveLockedConsultInspirationReadTarget(tx, session, now)
      inspirationUrl = (await mintConsultInspirationReadUrl(target)).url
    } catch (error) {
      if (!(error instanceof ConsultWriteError) || !['NOT_FOUND', 'INSPIRATION_LOOK_UNAVAILABLE'].includes(error.code)) throw error
    }
    const expiresInSeconds = 120
    if (latest.length) await consultCaptureStorage.assertReady()
    return { inspirationUrl, expiresInSeconds, captures: await Promise.all(latest.map(async capture => ({
      id: capture.id, label: capture.shotKey.replaceAll('_', ' ').replaceAll('-', ' '),
      url: await consultCaptureStorage.createSignedRead(capture.storagePath, expiresInSeconds),
    }))) }
  })
}
