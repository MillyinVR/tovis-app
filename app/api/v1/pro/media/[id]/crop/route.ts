// app/api/v1/pro/media/[id]/crop/route.ts
//
// The re-frame write path (capture chain item 2). Sets the non-destructive
// publish CROP on a MediaAsset the pro owns: the rect of the stored image the
// surfaces should display, normalized [0,1] from the top-left.
//
// It is a SEPARATE route from the media PATCH on purpose. The consent rule
// below has to compare the incoming rect against the rect currently stored, so
// it needs a read-then-write it can serialize; folding it into the omnibus
// PATCH would let a caption save and a re-frame interleave, and would give a
// partial PATCH a way to touch framing it never meant to.
//
// 🔴 THE CONSENT BOUND, ENFORCED HERE AND NOT IN THE UI.
// The stored rect is the frame the pro published and the client consented to
// seeing. A re-frame may move and narrow ANYWHERE inside that rect. It may
// never reach OUTSIDE it — that reveals pixels the published frame had removed
// (the rest of the room, another client, the body below a head crop), which is
// a fresh disclosure of the client's photo and needs fresh consent. An asset
// with no rect yet is bounded by the full stored frame, so the FIRST re-frame
// may go anywhere inside the photo the client already consented to.
//
// 🟢 THE UNDO WINDOW (item 4, Tori's decision 2026-09-01). The ratchet above
// made a pro's own mis-drag permanent, so for 24h after a crop — or until the
// look is viewed by anyone, whichever comes first — the bound is the frame that
// stood BEFORE the narrowing rather than the narrowed rect. That lets a pro put
// their own crop back without ever reaching past a frame already consented to.
// The rule is lib/media/cropUndoWindow.ts; it is applied HERE, at the write.
//
// There is still deliberately no "clear the crop" verb. Clearing means "the
// full frame" unconditionally, which outside the window is exactly the move
// this route refuses — and inside it, sending the pre-narrowing rect back says
// the same thing without needing a verb that means different things on
// different days.
//
// See docs/design/media-crop-rect.md.
import { MediaType } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import {
  cropContains,
  cropRectColumns,
  resolveCropRect,
} from '@/lib/media/cropRect'
import {
  cropConsentBound,
  cropUndoWindowColumnsForWrite,
} from '@/lib/media/cropUndoWindow'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

const WIDENED_MESSAGE =
  'A re-frame can move or tighten inside the frame you published, but not reach outside it. Widening a published photo needs the client’s consent again.'

const CROP_SELECT = {
  id: true,
  professionalId: true,
  mediaType: true,
  cropX: true,
  cropY: true,
  cropW: true,
  cropH: true,
  cropUndoBoundX: true,
  cropUndoBoundY: true,
  cropUndoBoundW: true,
  cropUndoBoundH: true,
  cropUndoExpiresAt: true,
  cropUndoViewBaseline: true,
  // Every look this asset appears in, primary or not — "viewed by anyone" is a
  // question about the asset, not about one post. The totals are summed rather
  // than maxed: a second look picking up its first view has to close the window
  // even while a busier one is unchanged.
  lookPostPrimaryFor: { select: { viewCount: true } },
  lookPostAssets: { select: { lookPost: { select: { viewCount: true } } } },
} as const

// PUT — replace the crop rect. The whole rect, always: a partial rect is not a
// degraded crop, it is an unanswerable one.
export async function PUT(req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id: rawId } = await resolveRouteParams(ctx)
    const mediaId = pickString(rawId)
    if (!mediaId) return jsonFail(400, 'Missing media id.')

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    // Unlike the create paths — where a malformed crop degrades to null so a
    // bad hint can never cost a pro their upload — a re-frame that cannot be
    // read is a 400. Silently storing "no crop" here would WIDEN the frame to
    // the full image, which is the one thing this route exists to prevent.
    const next = resolveCropRect(
      typeof body.cropX === 'number' ? body.cropX : null,
      typeof body.cropY === 'number' ? body.cropY : null,
      typeof body.cropW === 'number' ? body.cropW : null,
      typeof body.cropH === 'number' ? body.cropH : null,
    )

    if (!next) {
      return jsonFail(
        400,
        'Send cropX, cropY, cropW and cropH as numbers describing a rect inside the image.',
      )
    }

    const existing = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: CROP_SELECT,
    })

    if (!existing) return jsonFail(404, 'Not found.')
    if (existing.professionalId !== professionalId) return jsonFail(403, 'Forbidden.')

    // Images only. A stored rect that no player honors would be a silent lie
    // about what ships; refusing is reversible, a stored-and-ignored rect is not
    // visible as a defect.
    if (existing.mediaType !== MediaType.IMAGE) {
      return jsonFail(400, 'Only photos can be re-framed.')
    }

    const now = new Date()
    const viewCountTotal = totalViewCount(existing)
    const bound = cropConsentBound(existing, existing, { now, viewCountTotal })

    if (!cropContains(bound, next)) {
      return jsonFail(403, WIDENED_MESSAGE)
    }

    // Opened around the bound we just enforced against, so the pro can return to
    // exactly the frame they were allowed a moment ago. `null` means a window is
    // already open and must be left alone — refreshing it would let a pro hold
    // the bound open forever by re-cropping every 23 hours.
    const undoColumns = cropUndoWindowColumnsForWrite(bound, existing, {
      now,
      viewCountTotal,
    })

    // Re-check the bound at EXECUTION, not just at validation: two re-frames in
    // flight at once would both pass the check above against the same stored
    // rect, and the second could then land outside what the first narrowed to.
    // `updateMany` with the bound in the WHERE makes the read and the write one
    // statement — a zero count means someone narrowed underneath us.
    const columns = cropRectColumns(next)
    const written = await prisma.mediaAsset.updateMany({
      where: {
        id: mediaId,
        professionalId,
        // The rect this request was authorized against. Anything else and the
        // authorization is stale.
        cropX: existing.cropX,
        cropY: existing.cropY,
        cropW: existing.cropW,
        cropH: existing.cropH,
      },
      data: { ...columns, ...(undoColumns ?? {}) },
    })

    if (written.count === 0) {
      return jsonFail(
        409,
        'This photo was re-framed somewhere else while you were editing. Reopen it and try again.',
      )
    }

    return jsonOk({ media: { id: mediaId, ...columns } }, 200)
  } catch (e: unknown) {
    console.error('PUT /api/v1/pro/media/[id]/crop error', {
      error: safeError(e),
    })
    return jsonFail(500, 'Failed to update crop.')
  }
}

/**
 * Total views across every look this asset appears in — the signal the undo
 * window closes on.
 *
 * ⚠️ `LookPost.viewCount` is sampled and batch-applied (APPLY_LOOK_VIEWS), never
 * written on the view hot path, so this lags. It errs toward leaving the window
 * open slightly too long, which is the safe direction: the widest the window can
 * reach is a frame already consented to, and the 24h expiry caps it anyway.
 */
function totalViewCount(asset: {
  lookPostPrimaryFor: { viewCount: number }[]
  lookPostAssets: { lookPost: { viewCount: number } }[]
}): number {
  const primary = asset.lookPostPrimaryFor.reduce((n, p) => n + p.viewCount, 0)
  const secondary = asset.lookPostAssets.reduce(
    (n, a) => n + a.lookPost.viewCount,
    0,
  )
  return primary + secondary
}
