// app/api/v1/pro/clients/search/route.ts
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { getVisibleClientIdSetForPro } from '@/lib/clientVisibility'

export const dynamic = 'force-dynamic'

function norm(s: string) {
  return (s || '').trim()
}

function digitsOnly(s: string) {
  return (s || '').replace(/[^\d]/g, '')
}

const SELECT_CLIENT = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  user: { select: { email: true } },
} satisfies Prisma.ClientProfileSelect

type SearchClientRow = Prisma.ClientProfileGetPayload<{
  select: typeof SELECT_CLIENT
}>

function mapOut(c: SearchClientRow) {
  const id = String(c.id)

  return {
    id,
    fullName:
      `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() ||
      c.user?.email ||
      'Client',
    canViewClient: true,
    email: c.user?.email ?? null,
    phone: c.phone ?? null,
  }
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const url = new URL(req.url)
    const qRaw = norm(url.searchParams.get('q') || '')
    const q = qRaw.slice(0, 80)

    if (!q) {
      return jsonOk({ recentClients: [], otherClients: [], query: '' }, 200)
    }

    // Single policy: visible client ids for this pro.
    const visibleClientIdSet = await getVisibleClientIdSetForPro(professionalId)
    const visibleClientIds = Array.from(visibleClientIdSet)

    if (!visibleClientIds.length) {
      return jsonOk({ query: q, recentClients: [], otherClients: [] }, 200)
    }

    const qDigits = digitsOnly(q)
    const looksLikePhone = qDigits.length >= 3

    const phoneOr: Prisma.ClientProfileWhereInput[] = []

    if (looksLikePhone) {
      phoneOr.push({ phone: { contains: qDigits } })

      if (q !== qDigits) {
        phoneOr.push({ phone: { contains: q } })
      }
    }

    const whereMatch = {
      AND: [
        // Scope FIRST. No enumeration.
        { id: { in: visibleClientIds } },
        {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            ...phoneOr,
            { user: { email: { contains: q, mode: 'insensitive' } } },
          ],
        },
      ],
    } satisfies Prisma.ClientProfileWhereInput

    // Recent clients for THIS pro, still useful for sorting.
    const recentBookings = await prisma.booking.findMany({
      where: { professionalId },
      select: { clientId: true, scheduledFor: true },
      orderBy: { scheduledFor: 'desc' },
      take: 200,
    })

    const seen = new Set<string>()
    const recentClientIds: string[] = []

    for (const booking of recentBookings) {
      const clientId = String(booking.clientId)

      if (!visibleClientIdSet.has(clientId)) continue

      if (!seen.has(clientId)) {
        seen.add(clientId)
        recentClientIds.push(clientId)
      }

      if (recentClientIds.length >= 75) break
    }

    const recentClients = recentClientIds.length
      ? await prisma.clientProfile.findMany({
          where: {
            AND: [
              whereMatch,
              { id: { in: recentClientIds } },
            ],
          },
          select: SELECT_CLIENT,
          take: 12,
        })
      : []

    const otherClients = await prisma.clientProfile.findMany({
      where: {
        AND: [
          whereMatch,
          ...(recentClientIds.length
            ? [{ id: { notIn: recentClientIds } }]
            : []),
        ],
      },
      select: SELECT_CLIENT,
      take: 12,
    })

    return jsonOk(
      {
        query: q,
        recentClients: recentClients.map(mapOut),
        otherClients: otherClients.map(mapOut),
      },
      200,
    )
  } catch (error: unknown) {
    console.error('GET /api/v1/pro/clients/search error:', error)
    return jsonFail(500, 'Failed to search clients.')
  }
}