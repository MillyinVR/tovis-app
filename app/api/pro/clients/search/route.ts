// app/api/pro/clients/search/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function norm(s: string) {
  return (s || '').trim()
}

function digitsOnly(s: string) {
  return (s || '').replace(/[^\d]/g, '')
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const url = new URL(req.url)
    const qRaw = norm(url.searchParams.get('q') || '')
    const q = qRaw.slice(0, 80)

    if (!q) return jsonOk({ recentClients: [], otherClients: [], query: '' }, 200)

    const qDigits = digitsOnly(q)
    const looksLikePhone = qDigits.length >= 3

    const recentBookings = await prisma.booking.findMany({
      where: { professionalId },
      select: { clientId: true, scheduledFor: true },
      orderBy: { scheduledFor: 'desc' },
      take: 200,
    })

    const seen = new Set<string>()
    const recentClientIds: string[] = []
    for (const b of recentBookings) {
      const cid = String(b.clientId)
      if (!seen.has(cid)) {
        seen.add(cid)
        recentClientIds.push(cid)
      }
      if (recentClientIds.length >= 75) break
    }

    const phoneOr: any[] = []
    if (looksLikePhone) {
      phoneOr.push({ phone: { contains: qDigits } })
      if (q !== qDigits) phoneOr.push({ phone: { contains: q } })
    }

    const whereMatch = {
      OR: [
        { firstName: { contains: q, mode: 'insensitive' as const } },
        { lastName: { contains: q, mode: 'insensitive' as const } },
        ...phoneOr,
        { user: { email: { contains: q, mode: 'insensitive' as const } } },
      ],
    }

    const selectClient = {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      user: { select: { email: true } },
    } as const

    const recentClients = recentClientIds.length
      ? await prisma.clientProfile.findMany({
          where: { id: { in: recentClientIds }, ...whereMatch },
          select: selectClient,
          take: 12,
        })
      : []

    const otherClients = await prisma.clientProfile.findMany({
      where: { ...(recentClientIds.length ? { id: { notIn: recentClientIds } } : {}), ...whereMatch },
      select: selectClient,
      take: 12,
    })

    const mapOut = (c: any) => ({
      id: String(c.id),
      fullName: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.user?.email || 'Client',
      email: c.user?.email ?? null,
      phone: c.phone ?? null,
    })

    return jsonOk(
      {
        query: q,
        recentClients: recentClients.map(mapOut),
        otherClients: otherClients.map(mapOut),
      },
      200,
    )
  } catch (e) {
    console.error('GET /api/pro/clients/search error:', e)
    return jsonFail(500, 'Failed to search clients.')
  }
}
