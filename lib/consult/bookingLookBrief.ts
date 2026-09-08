import 'server-only'
import { prisma } from '@/lib/prisma'
import { isAiConsultC6ExposureEnabledForPro } from './access'

/** Appointment navigation only; full brief reads repeat consent and scope checks. */
export async function loadBookingLookBriefLink(bookingId: string, professionalId: string) {
  if (!isAiConsultC6ExposureEnabledForPro(professionalId)) return null
  const version = await prisma.consultLookBriefVersion.findFirst({
    where: { consultSession: { professionalId, OR: [
      { bookingId }, { inspiredBookings: { some: { id: bookingId, professionalId } } },
    ] } },
    orderBy: { version: 'desc' },
    select: { consultSessionId: true, version: true, clientAcknowledgedAt: true, professionalAcknowledgedAt: true },
  })
  return version ? { consultId: version.consultSessionId, version: version.version,
    confirmed: Boolean(version.clientAcknowledgedAt && version.professionalAcknowledgedAt) } : null
}
