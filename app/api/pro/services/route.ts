// app/api/pro/services/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const offerings = await prisma.professionalServiceOffering.findMany({
      where: {
        professionalId,
        isActive: true,
        service: { isActive: true },
      },
      select: {
        id: true,
        serviceId: true,
        salonDurationMinutes: true,
        mobileDurationMinutes: true,
        service: { select: { id: true, name: true, defaultDurationMinutes: true } },
      },
      orderBy: { service: { name: 'asc' } },
      take: 500,
    })

    const services = offerings.map((o) => ({
      id: String(o.serviceId), // IMPORTANT: matches booking.serviceId expectations
      name: o.service.name,
      durationMinutes: o.salonDurationMinutes ?? o.mobileDurationMinutes ?? o.service.defaultDurationMinutes ?? null,
      offeringId: String(o.id),
    }))

    return jsonOk({ ok: true, services }, 200)
  } catch (e) {
    console.error('GET /api/pro/services error:', e)
    return jsonFail(500, 'Failed to load services.')
  }
}
