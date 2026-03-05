// app/api/pro/media/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { MediaVisibility } from '@prisma/client'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { pickBool, pickString } from '@/lib/pick'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

function normalizeVisibilityFromFlags(flags: {
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
}): MediaVisibility {
  return flags.isEligibleForLooks || flags.isFeaturedInPortfolio
    ? MediaVisibility.PUBLIC
    : MediaVisibility.PRO_CLIENT
}

function uniqueStrings(input: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of input) {
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function parseServiceIds(v: unknown, max = 50): string[] | null {
  if (v === undefined) return null // means "not provided"
  if (!Array.isArray(v)) return []
  const cleaned = v
    .map((x) => pickString(x))
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .slice(0, max)
  return uniqueStrings(cleaned)
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id: rawId } = await ctx.params
    const mediaId = pickString(rawId)
    if (!mediaId) return jsonFail(400, 'Missing id.')

    const existing = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        professionalId: true,
        caption: true,
        isEligibleForLooks: true,
        isFeaturedInPortfolio: true,
        services: { select: { serviceId: true } },
      },
    })

    if (!existing) return jsonFail(404, 'Not found.')
    if (existing.professionalId !== auth.professionalId) return jsonFail(403, 'Forbidden.')

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    const captionRaw = body.caption
    const caption = captionRaw === null ? null : (pickString(captionRaw) ?? null)

    const looksPatch = pickBool(body.isEligibleForLooks)
    const portfolioPatch = pickBool(body.isFeaturedInPortfolio)

    const nextFlags = {
      isEligibleForLooks: looksPatch === null ? Boolean(existing.isEligibleForLooks) : looksPatch,
      isFeaturedInPortfolio:
        portfolioPatch === null ? Boolean(existing.isFeaturedInPortfolio) : portfolioPatch,
    }

    const nextVisibility = normalizeVisibilityFromFlags(nextFlags)

    const serviceIds = parseServiceIds(body.serviceIds)
    const serviceIdsProvided = serviceIds !== null

    const existingServiceCount = existing.services?.length ?? 0

    if (serviceIdsProvided) {
      if (serviceIds.length === 0) return jsonFail(400, 'Select at least one service tag.')

      const valid = await prisma.service.findMany({
        where: { id: { in: serviceIds }, isActive: true },
        select: { id: true },
      })
      if (valid.length !== serviceIds.length) return jsonFail(400, 'One or more serviceIds are invalid.')
    } else {
      if (existingServiceCount === 0) {
        return jsonFail(
          409,
          'This media has no services attached. Please add at least one service before saving edits.',
        )
      }
    }

    const data: Parameters<typeof prisma.mediaAsset.update>[0]['data'] = {
      caption,
      visibility: nextVisibility,
      ...(looksPatch === null ? {} : { isEligibleForLooks: looksPatch }),
      ...(portfolioPatch === null ? {} : { isFeaturedInPortfolio: portfolioPatch }),

      ...(serviceIdsProvided
        ? {
            services: {
              deleteMany: {},
              create: serviceIds.map((serviceId) => ({ serviceId })),
            },
          }
        : {}),
    }

    const updated = await prisma.mediaAsset.update({
      where: { id: mediaId },
      data,
      select: {
        id: true,
        caption: true,
        visibility: true,
        isEligibleForLooks: true,
        isFeaturedInPortfolio: true,
      },
    })

    return jsonOk({ media: updated }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/media/[id] error', e)
    return jsonFail(500, 'Failed to update media.')
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id: rawId } = await ctx.params
    const mediaId = pickString(rawId)
    if (!mediaId) return jsonFail(400, 'Missing id.')

    const existing = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: { id: true, professionalId: true },
    })

    if (!existing) return jsonFail(404, 'Not found.')
    if (existing.professionalId !== auth.professionalId) return jsonFail(403, 'Forbidden.')

    await prisma.mediaAsset.delete({ where: { id: mediaId } })
    return jsonOk({}, 200)
  } catch (e) {
    console.error('DELETE /api/pro/media/[id] error', e)
    return jsonFail(500, 'Failed to delete media.')
  }
}