// app/api/pro/notifications/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function asInt(v: unknown, fallback: number) {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? Math.trunc(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

export async function GET(req: Request) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res
  const professionalId = auth.professionalId

  const url = new URL(req.url)
  const take = Math.max(1, Math.min(100, asInt(url.searchParams.get('take'), 60)))
  const cursor = (url.searchParams.get('cursor') || '').trim() || null

  const rows = await prisma.notification.findMany({
    where: { professionalId },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor
      ? {
          cursor: { id: cursor },
          skip: 1,
        }
      : {}),
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      href: true,
      createdAt: true,
      readAt: true,
      bookingId: true,
      reviewId: true,
    },
  })

  const hasMore = rows.length > take
  const items = hasMore ? rows.slice(0, take) : rows
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null

  return NextResponse.json(
    {
      ok: true,
      items,
      nextCursor,
    },
    { status: 200 },
  )
}
