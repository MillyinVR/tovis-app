// app/api/v1/pro/media/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import {
  parseBeforeAssetField,
  resolveAutoPairedBefore,
  resolveFeaturePairing,
} from '@/lib/media/portfolioPairing'
import { canProSharePublicly, UNPROMOTED_MEDIA_MESSAGE } from '@/lib/media/publicShareGuard'
import { resolveMediaVisibility } from '@/lib/media/mediaVisibility'
import { reconcilePortfolioLookForMediaAsset } from '@/lib/looks/publication/portfolioLookSync'
import { pickBool, pickString } from '@/lib/pick'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

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

export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const mediaId = pickString(rawId)
    if (!mediaId) return jsonFail(400, 'Missing id.')

    const existing = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        professionalId: true,
        reviewId: true,
        storageBucket: true,
        caption: true,
        isEligibleForLooks: true,
        isFeaturedInPortfolio: true,
        // Before/after pairing: resolve/auto-pair when featuring via the edit modal.
        mediaType: true,
        phase: true,
        bookingId: true,
        beforeAssetId: true,
        // B3b: the booking's client media-use consent also unlocks public sharing.
        booking: { select: { mediaUseConsentAt: true } },
        services: { select: { serviceId: true } },
      },
    })

    if (!existing) return jsonFail(404, 'Not found.')
    if (existing.professionalId !== auth.professionalId) return jsonFail(403, 'Forbidden.')

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    // 🔴 Only written when the body carries the key. This used to write
    // `caption` unconditionally, so a PATCH that omitted it resolved to `null`
    // and silently WIPED the caption — which every partial save does: a sheet
    // that only re-tags services, or only re-pairs a before/after, sends
    // neither caption nor flags. The flags below were already conditional; the
    // caption was the one field a partial write destroyed.
    const captionProvided = Object.prototype.hasOwnProperty.call(body, 'caption')
    const captionRaw = body.caption
    const caption = !captionProvided
      ? undefined
      : captionRaw === null
        ? null
        : (pickString(captionRaw) ?? null)

    const looksPatch = pickBool(body.isEligibleForLooks)
    const portfolioPatch = pickBool(body.isFeaturedInPortfolio)

    const nextFlags = {
      isEligibleForLooks: looksPatch === null ? Boolean(existing.isEligibleForLooks) : looksPatch,
      isFeaturedInPortfolio:
        portfolioPatch === null ? Boolean(existing.isFeaturedInPortfolio) : portfolioPatch,
    }

    // 🔴 Bucket-aware. Un-ticking both flags used to resolve to PRO_CLIENT for
    // every asset, including the pro's own uploads sitting in the world-readable
    // media-public bucket — a "private" label over a public object. The row is
    // taken off the public surfaces by the flags, not by the visibility column.
    const nextVisibility = resolveMediaVisibility({
      storageBucket: existing.storageBucket,
      isFeaturedInPortfolio: nextFlags.isFeaturedInPortfolio,
      isEligibleForLooks: nextFlags.isEligibleForLooks,
    })

    // Consent gate: never let a pro flip a client's unpromoted private session
    // media to public. Only review-promoted (reviewId set) or public-bucket
    // media may go public.
    //
    // 🔴 Keyed on the pro asking to SHOW it, not on the computed visibility
    // column. Now that a public-bucket asset correctly stays PUBLIC when both
    // flags come off, a `=== PUBLIC` test here would also fire on a RETRACT and
    // answer 403 "this session photo can only be shared publicly after…" to a
    // pro who was trying to take the photo DOWN.
    const wantsPubliclyShown =
      nextFlags.isFeaturedInPortfolio || nextFlags.isEligibleForLooks

    if (
      wantsPubliclyShown &&
      !canProSharePublicly({
        bookingId: existing.bookingId,
        storageBucket: existing.storageBucket,
        reviewId: existing.reviewId,
        clientUseConsentAt: existing.booking?.mediaUseConsentAt ?? null,
      })
    ) {
      return jsonFail(403, UNPROMOTED_MEDIA_MESSAGE)
    }

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

    // Before/after pairing on the featured "after". An explicit `beforeAssetId`
    // in the body wins (the pro picked/cleared a before); otherwise newly
    // featuring auto-pairs from the booking (consistency with the portfolio POST
    // path) and unfeaturing clears the pairing. `undefined` → leave untouched.
    const pairField = parseBeforeAssetField(body)
    let beforeAssetIdWrite: string | null | undefined
    if (pairField.present) {
      const pairing = await resolveFeaturePairing({
        afterAssetId: mediaId,
        professionalId: auth.professionalId,
        media: existing,
        pairField,
      })
      if (!pairing.ok) return jsonFail(400, pairing.error)
      beforeAssetIdWrite = pairing.beforeAssetId
    } else if (portfolioPatch === true && !existing.isFeaturedInPortfolio) {
      // Newly featured → auto-pair (consistency with the portfolio POST path).
      beforeAssetIdWrite = await resolveAutoPairedBefore(existing, mediaId)
    } else if (portfolioPatch === false && existing.isFeaturedInPortfolio) {
      // Newly unfeatured → clear the pairing (matches the portfolio DELETE path).
      beforeAssetIdWrite = null
    }

    const data: Parameters<typeof prisma.mediaAsset.update>[0]['data'] = {
      ...(caption === undefined ? {} : { caption }),
      visibility: nextVisibility,
      ...(looksPatch === null ? {} : { isEligibleForLooks: looksPatch }),
      ...(portfolioPatch === null ? {} : { isFeaturedInPortfolio: portfolioPatch }),
      ...(beforeAssetIdWrite === undefined
        ? {}
        : { beforeAssetId: beforeAssetIdWrite }),

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

    // §19b: reconcile the LookPost with the asset's new public state — publish a
    // Look when it's now featured/Looks-eligible, or retract the live Look when
    // it's no longer public (fixes divergence b: Looks-eligible off never
    // retracted an already-published look).
    await reconcilePortfolioLookForMediaAsset(prisma, {
      professionalId: auth.professionalId,
      mediaAssetId: mediaId,
    })

    return jsonOk({ media: updated }, 200)
  } catch (e: unknown) {
    console.error('PATCH /api/v1/pro/media/[id] error', {
      error: safeError(e),
    })

    return jsonFail(500, 'Failed to update media.')
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
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
  } catch (e: unknown) {
    console.error('DELETE /api/v1/pro/media/[id] error', {
      error: safeError(e),
    })

    return jsonFail(500, 'Failed to delete media.')
  }
}