// app/api/pro/media/[id]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { MediaVisibility } from '@prisma/client'

function pickString(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function pickBool(v: unknown) {
  return typeof v === 'boolean' ? v : null
}

/**
 * Accepts UI-friendly values and maps them to Prisma enum.
 * - "PUBLIC" -> MediaVisibility.PUBLIC
 * - "PRIVATE" -> MediaVisibility.PRO_CLIENT (private between pro + client)
 * Also accepts real enum strings like "PRO_CLIENT" if sent.
 */
function pickVisibility(v: unknown): MediaVisibility | null {
  const s = pickString(v).toUpperCase()
  if (!s) return null

  if (s === 'PUBLIC') return MediaVisibility.PUBLIC
  if (s === 'PRIVATE') return MediaVisibility.PRO_CLIENT

  // Allow passing the actual enum value directly
  if (s === 'PRO_CLIENT') return MediaVisibility.PRO_CLIENT

  return null
}

function pickStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => pickString(x)).filter(Boolean)
}

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const mediaId = pickString(id)
    if (!mediaId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const user = await getCurrentUser().catch(() => null)
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

    const body = (await req.json().catch(() => ({}))) as any

    const captionRaw = body?.caption
    const caption = captionRaw == null ? null : pickString(captionRaw) || null

    const visibility = pickVisibility(body?.visibility)
    const isEligibleForLooks = pickBool(body?.isEligibleForLooks)
    const isFeaturedInPortfolio = pickBool(body?.isFeaturedInPortfolio)
    const serviceIds = pickStringArray(body?.serviceIds)

    // Build update object in a Prisma-friendly way
    const data: Parameters<typeof prisma.mediaAsset.update>[0]['data'] = {
      caption,

      ...(visibility ? { visibility } : {}),
      ...(isEligibleForLooks == null ? {} : { isEligibleForLooks }),
      ...(isFeaturedInPortfolio == null ? {} : { isFeaturedInPortfolio }),

      // Replace attached services
      services: {
        deleteMany: {},
        create: serviceIds.map((serviceId) => ({ serviceId })),
      },
    }

    await prisma.mediaAsset.update({
      where: { id: mediaId },
      data,
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('PATCH /api/pro/media/[id] error', e)
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const mediaId = pickString(id)
    if (!mediaId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const user = await getCurrentUser().catch(() => null)
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
    console.error('DELETE /api/pro/media/[id] error', e)
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}
