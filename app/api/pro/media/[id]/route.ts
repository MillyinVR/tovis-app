// app/api/pro/media/[id]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { MediaVisibility } from '@prisma/client'

export const dynamic = 'force-dynamic'

function pickString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function pickBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

/**
 * Accepts UI-friendly values and maps them to Prisma enum.
 * - "PUBLIC"  -> MediaVisibility.PUBLIC
 * - "PRIVATE" -> MediaVisibility.PRO_CLIENT
 * Also accepts real enum strings like "PRO_CLIENT".
 */
function pickVisibility(v: unknown): MediaVisibility | null {
  const s = pickString(v).toUpperCase()
  if (!s) return null

  if (s === 'PUBLIC') return MediaVisibility.PUBLIC
  if (s === 'PRIVATE') return MediaVisibility.PRO_CLIENT
  if (s === 'PRO_CLIENT') return MediaVisibility.PRO_CLIENT

  return null
}

function uniqueStrings(input: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    const s = (raw || '').trim()
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function pickStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return uniqueStrings(v.map((x) => pickString(x)).filter((x) => x.length > 0))
}

/**
 * Single-source-of-truth rule:
 * If either Looks or Portfolio is enabled, visibility must be PUBLIC.
 * If both are off, visibility must be PRO_CLIENT.
 */
function normalizeVisibilityFromFlags(flags: { isEligibleForLooks: boolean; isFeaturedInPortfolio: boolean }): MediaVisibility {
  return flags.isEligibleForLooks || flags.isFeaturedInPortfolio ? MediaVisibility.PUBLIC : MediaVisibility.PRO_CLIENT
}

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const mediaId = pickString(id)
    if (!mediaId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const proId = user.professionalProfile.id

    // Load owned media + current services (for invariants)
    const existing = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        professionalId: true,
        isEligibleForLooks: true,
        isFeaturedInPortfolio: true,
        services: { select: { serviceId: true } },
      },
    })

    if (!existing || existing.professionalId !== proId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = (await req.json().catch(() => ({}))) as any

    // Caption
    const captionRaw = body?.caption
    const caption = captionRaw == null ? null : pickString(captionRaw) || null

    // Flags (nullable so PATCH can be partial)
    const isEligibleForLooksPatch = pickBool(body?.isEligibleForLooks)
    const isFeaturedInPortfolioPatch = pickBool(body?.isFeaturedInPortfolio)

    // Apply patch values over existing to get "next" flags
    const nextFlags = {
      isEligibleForLooks: isEligibleForLooksPatch == null ? Boolean(existing.isEligibleForLooks) : isEligibleForLooksPatch,
      isFeaturedInPortfolio:
        isFeaturedInPortfolioPatch == null ? Boolean(existing.isFeaturedInPortfolio) : isFeaturedInPortfolioPatch,
    }

    // serviceIds: only rewrite if provided
    const serviceIdsProvided = Array.isArray(body?.serviceIds)
    const serviceIds = serviceIdsProvided ? pickStringArray(body?.serviceIds) : []

    // Invariant: ALL media must have >= 1 service
    // - If client provides serviceIds: require >=1
    // - If not provided: require existing already has >=1 (forces cleanup of any legacy bad rows)
    const existingServiceCount = (existing.services || []).length

    if (serviceIdsProvided) {
      if (serviceIds.length === 0) {
        return NextResponse.json({ error: 'Select at least one service tag.' }, { status: 400 })
      }

      // Validate serviceIds (exists + active)
      const services = await prisma.service.findMany({
        where: { id: { in: serviceIds }, isActive: true },
        select: { id: true },
      })
      if (services.length !== serviceIds.length) {
        return NextResponse.json({ error: 'One or more serviceIds are invalid.' }, { status: 400 })
      }
    } else {
      if (existingServiceCount === 0) {
        return NextResponse.json(
          { error: 'This media has no services attached. Please add at least one service before saving edits.' },
          { status: 409 },
        )
      }
    }

    // Visibility:
    // We accept incoming visibility, but we normalize it from flags so DB can’t drift.
    // (If you *really* want manual override, remove normalization and enforce consistency instead.)
    const _incomingVisibility = pickVisibility(body?.visibility) // allowed for UI compatibility, but not trusted
    const visibility = normalizeVisibilityFromFlags(nextFlags)

    const data: Parameters<typeof prisma.mediaAsset.update>[0]['data'] = {
      caption,
      visibility,
      ...(isEligibleForLooksPatch == null ? {} : { isEligibleForLooks: isEligibleForLooksPatch }),
      ...(isFeaturedInPortfolioPatch == null ? {} : { isFeaturedInPortfolio: isFeaturedInPortfolioPatch }),

      ...(serviceIdsProvided
        ? {
            services: {
              deleteMany: {},
              create: serviceIds.map((serviceId) => ({ serviceId })),
            },
          }
        : {}),
    }

    await prisma.mediaAsset.update({ where: { id: mediaId }, data })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('PATCH /api/pro/media/[id] error', e)
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const mediaId = pickString(id)
    if (!mediaId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
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