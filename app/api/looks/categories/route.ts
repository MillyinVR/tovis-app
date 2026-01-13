// app/api/looks/categories/route.ts

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Public endpoint:
    // - only ACTIVE categories
    // - only ROOT categories (parentId null) to keep the top bar clean
    // - stable ordering
    const rows = await prisma.serviceCategory.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ name: 'asc' }],
      select: { name: true, slug: true },
      take: 2000,
    })

    return NextResponse.json(
      {
        ok: true,
        categories: rows.map((r) => ({
          name: r.name,
          slug: r.slug,
        })),
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('GET /api/looks/categories error', e)
    return NextResponse.json({ ok: false, categories: [] }, { status: 200 })
  }
}
