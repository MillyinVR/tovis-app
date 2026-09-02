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
// There is deliberately no "clear the crop" verb: clearing widens back to the
// full frame, which is precisely the move this route refuses. Re-widening is a
// re-consent flow, and it does not exist yet.
//
// Nothing calls this route yet — item 2 ships dark. See
// docs/design/media-crop-rect.md.
import { MediaType } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import {
  cropContains,
  cropRectColumns,
  FULL_FRAME_CROP,
  resolveCropRect,
} from '@/lib/media/cropRect'
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

    if (!cropContains(consentBoundOf(existing), next)) {
      return jsonFail(403, WIDENED_MESSAGE)
    }

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
      data: columns,
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
 * The frame this asset was published in — the bound a re-frame must stay
 * inside. A stored rect is that frame; no stored rect means the whole photo,
 * which is what the client consented to when it was published.
 */
function consentBoundOf(asset: {
  cropX: number | null
  cropY: number | null
  cropW: number | null
  cropH: number | null
}) {
  return (
    resolveCropRect(asset.cropX, asset.cropY, asset.cropW, asset.cropH) ??
    FULL_FRAME_CROP
  )
}
