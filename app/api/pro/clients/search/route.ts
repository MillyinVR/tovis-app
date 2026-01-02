// app/api/pro/clients/search/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function isProRole(role: unknown) {
  const r = typeof role === 'string' ? role.toUpperCase() : ''
  return r === 'PROFESSIONAL' || r === 'PRO'
}

function norm(s: string) {
  return (s || '').trim()
}

function digitsOnly(s: string) {
  return (s || '').replace(/[^\d]/g, '')
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)

    if (!user || !isProRole((user as any).role) || !(user as any).professionalProfile?.id) {
      return NextResponse.json({ error: 'Only professionals can search clients.' }, { status: 401 })
    }

    const professionalId = String((user as any).professionalProfile.id)
    const url = new URL(req.url)

    const qRaw = norm(url.searchParams.get('q') || '')
    const q = qRaw.slice(0, 80) // keep it sane

    // IMPORTANT: match the UI response keys even for empty queries
    if (!q) {
      return NextResponse.json({ ok: true, recentClients: [], otherClients: [] }, { status: 200 })
    }

    const qDigits = digitsOnly(q)
    const looksLikePhone = qDigits.length >= 3

    // Pull recent clientIds (clients who booked with this pro)
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

    // Build matching filter. We include both q and qDigits for phone because DB
    // might store formatting like (555) 123-4567.
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

    // Recent clients (who booked with this pro)
    const recentClients = recentClientIds.length
      ? await prisma.clientProfile.findMany({
          where: {
            id: { in: recentClientIds },
            ...whereMatch,
          },
          select: selectClient,
          take: 12,
        })
      : []

    // Other clients (global search excluding recent)
    const otherClients = await prisma.clientProfile.findMany({
      where: {
        ...(recentClientIds.length ? { id: { notIn: recentClientIds } } : {}),
        ...whereMatch,
      },
      select: selectClient,
      take: 12,
    })

    const mapOut = (c: any) => ({
      id: String(c.id),
      fullName: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.user?.email || 'Client',
      email: c.user?.email ?? null,
      phone: c.phone ?? null,
    })

    // ✅ MATCHES CreateBookingModal.tsx EXPECTATION:
    // data.recentClients, data.otherClients
    return NextResponse.json(
      {
        ok: true,
        query: q,
        recentClients: recentClients.map(mapOut),
        otherClients: otherClients.map(mapOut),
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('GET /api/pro/clients/search error:', e)
    return NextResponse.json({ error: 'Failed to search clients.' }, { status: 500 })
  }
}
