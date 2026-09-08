import 'server-only'
import { NotificationEventKey, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isAiConsultC6ExposureEnabledForPro, AI_CONSULT_PRO_ALLOWLIST } from '@/lib/consult/access'
import { CONSULT_OPEN_WINDOW_SELECT, consultLinkedBooking, resolveConsultInputWindow } from '@/lib/consult/openWindow'
import { requireCurrentConsultAgreementAcceptances, CONSULT_REQUIRED_AGREEMENT_KINDS } from '@/lib/consult/agreementContract'
import { ConsultWriteError } from '@/lib/consult/errors'
import { createProNotification } from './proNotifications'
import { upsertClientNotification } from './clientNotifications'

export function lookBriefReminderStage(scheduledFor: Date, now: Date): 'AHEAD' | 'SOON' | 'DUE' | null {
  const hours = (scheduledFor.getTime() - now.getTime()) / 3_600_000
  return hours <= 0 || hours > 72 ? null : hours <= 2 ? 'DUE' : hours <= 24 ? 'SOON' : 'AHEAD'
}

/** Re-evaluate the latest version, appointment and consent at delivery time. */
export async function drainLookBriefReminders(now = new Date()) {
  const unrestricted = isAiConsultC6ExposureEnabledForPro('__non_allowlisted_pro__')
  const enabledPros = AI_CONSULT_PRO_ALLOWLIST.filter(isAiConsultC6ExposureEnabledForPro)
  if (!unrestricted && !enabledPros.length) return { scanned: 0, processed: 0 }
  const exposureFilter = unrestricted ? Prisma.sql`true` : Prisma.sql`s."professionalId" IN (${Prisma.join(enabledPros)})`
  // Exclude delivered bands in SQL so a busy pro's first page cannot starve
  // later appointments. New versions and rescheduled appointments get new keys.
  const candidates = await prisma.$queryRaw<Array<{ consultSessionId: string; versionId: string; bookingId: string }>>(Prisma.sql`
    WITH due AS (
      SELECT s.id AS "consultSessionId", s."clientId", s."professionalId", v.id AS "versionId", b.id AS "bookingId",
        v."clientAcknowledgedAt", v."professionalAcknowledgedAt",
        'look-review:' || v.id || ':' || b.id || ':' || (extract(epoch FROM b."scheduledFor") * 1000)::bigint::text || ':' ||
          CASE WHEN b."scheduledFor" <= ${now}::timestamp + interval '2 hours' THEN 'DUE'
            WHEN b."scheduledFor" <= ${now}::timestamp + interval '24 hours' THEN 'SOON' ELSE 'AHEAD' END AS key
      FROM "ConsultSession" s
      JOIN LATERAL (SELECT * FROM "ConsultLookBriefVersion" WHERE "consultSessionId" = s.id ORDER BY version DESC LIMIT 1) v ON true
      JOIN "Booking" b ON b.id = s."bookingId" OR b."sourceConsultSessionId" = s.id
      WHERE ${exposureFilter}
        AND (SELECT count(DISTINCT a.kind) FROM "ConsultAgreementAcceptance" a
          JOIN "ConsultAgreementVersion" av ON av.id = a."agreementVersionId"
          WHERE a."consultSessionId" = s.id AND a."revokedAt" IS NULL
            AND a.kind::text IN (${Prisma.join([...CONSULT_REQUIRED_AGREEMENT_KINDS])})
            AND av."publishedAt" <= ${now}
            AND NOT EXISTS (SELECT 1 FROM "ConsultAgreementVersion" newer
              WHERE newer.kind = av.kind AND newer.version > av.version AND newer."publishedAt" <= ${now})
        ) = ${CONSULT_REQUIRED_AGREEMENT_KINDS.length}
        AND s.status = 'COMPLETED' AND b.status IN ('PENDING','ACCEPTED')
        AND b."scheduledFor" > ${now} AND b."scheduledFor" <= ${now}::timestamp + interval '72 hours'
    )
    SELECT "consultSessionId", "versionId", "bookingId" FROM due
    WHERE ("professionalAcknowledgedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "Notification" n
      WHERE n."professionalId" = due."professionalId" AND n."dedupeKey" = due.key))
      OR ("clientAcknowledgedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "ClientNotification" n
      WHERE n."clientId" = due."clientId" AND n."dedupeKey" = due.key))
    ORDER BY "bookingId" LIMIT 50
  `)
  let processed = 0
  for (const candidate of candidates) {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "ConsultSession" WHERE id = ${candidate.consultSessionId} FOR UPDATE`)
      const session = await tx.consultSession.findUnique({ where: { id: candidate.consultSessionId }, select: {
        ...CONSULT_OPEN_WINDOW_SELECT, id: true,
        lookBriefVersions: { orderBy: { version: 'desc' }, take: 1 },
      } })
      if (!session || !isAiConsultC6ExposureEnabledForPro(session.professionalId) || !resolveConsultInputWindow(session, now).open) return
      const version = session.lookBriefVersions[0]
      const booking = consultLinkedBooking(session)
      if (!version || version.id !== candidate.versionId || !booking || booking.id !== candidate.bookingId ||
        !['PENDING','ACCEPTED'].includes(booking.status)) return
      const stage = lookBriefReminderStage(booking.scheduledFor, now)
      if (!stage || (version.clientAcknowledgedAt && version.professionalAcknowledgedAt)) return
      try { await requireCurrentConsultAgreementAcceptances(tx, session.id) }
      catch (error) { if (error instanceof ConsultWriteError) return; throw error }
      const common = { tx, eventKey: NotificationEventKey.LOOK_BRIEF_REVIEW,
        title: stage === 'DUE' ? 'Appointment soon — review the look' : 'Confirm the current look plan',
        body: `Version ${version.version} still needs confirmation before the appointment. Open the brief to review the latest details.`,
        dedupeKey: `look-review:${version.id}:${booking.id}:${booking.scheduledFor.getTime()}:${stage}`,
        data: { consultSessionId: session.id, lookBriefVersionId: version.id, version: version.version, stage },
      }
      if (!version.professionalAcknowledgedAt) await createProNotification({ ...common, professionalId: session.professionalId,
        href: `/pro/consults/${encodeURIComponent(session.id)}` })
      if (!version.clientAcknowledgedAt) await upsertClientNotification({ ...common, clientId: session.clientId, bookingId: booking.id,
        href: `/client/consult/${encodeURIComponent(session.id)}` })
      processed++
    })
  }
  return { scanned: candidates.length, processed }
}
