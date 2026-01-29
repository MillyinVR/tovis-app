// app/api/pro/media/[id]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

function pickString(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}
function pickBool(v: unknown) {
  return typeof v === 'boolean' ? v : null
}
function pickVisibility(v: unknown): 'PUBLIC' | 'PRIVATE' | null {
  const s = pickString(v).toUpperCase()
  if (s === 'PUBLIC' || s === 'PRIVATE') return s
  return null
}
function pickStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => pickString(x)).filter(Boolean)
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const mediaId = pickString(id)
    if (!mediaId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const proId = user.professionalProfile.id

    const existing = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: { id: true, professionalId: true },
    })
    if (!existing || existing.professionalId !== proId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({} as any))

    const captionRaw = body?.caption
    const caption = captionRaw == null ? null : pickString(captionRaw) || null

    const visibility = pickVisibility(body?.visibility)
    const isEligibleForLooks = pickBool(body?.isEligibleForLooks)
    const isFeaturedInPortfolio = pickBool(body?.isFeaturedInPortfolio)
    const serviceIds = pickStringArray(body?.serviceIds)

    await prisma.mediaAsset.update({
      where: { id: mediaId },
      data: {
        caption,
        ...(visibility ? { visibility } : {}),
        ...(isEligibleForLooks == null ? {} : { isEligibleForLooks }),
        ...(isFeaturedInPortfolio == null ? {} : { isFeaturedInPortfolio }),

        // Replace attached services
        services: {
          deleteMany: {},
          create: serviceIds.map((serviceId) => ({ serviceId })),
        },
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const mediaId = pickString(id)
    if (!mediaId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const proId = user.professionalProfile.id

    const existing = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: { id: true, professionalId: true },
    })
    if (!existing || existing.professionalId !== proId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await prisma.mediaAsset.delete({ where: { id: mediaId } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}
