// app/api/v1/looks/[id]/share/route.ts
//
// Fire-and-forget share ping. Guests can share a public look (the share sheet
// works signed-out), so this intentionally uses the optional viewer — the
// canView gate still 404s anything the caller couldn't see. shareCount has no
// source-of-truth table (unlike likes/saves); the denormalized counter IS the
// record, so we increment it atomically and refresh the persisted scores.
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { getOptionalUser } from '@/app/api/_utils/auth/getOptionalUser'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { canViewLookPost } from '@/lib/looks/guards'
import { recomputeLookPostScores } from '@/lib/looks/counters'
import { loadLookAccess } from '@/lib/looks/access'
import type { LooksShareResponseDto } from '@/lib/looks/types'
import { enqueueRecomputeLookCounts } from '@/lib/jobs/looksSocial/enqueue'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const viewer = await getOptionalUser()

    const { id: rawId } = await resolveRouteParams(ctx)
    const lookPostId = pickString(rawId)

    if (!lookPostId) {
      return jsonFail(400, 'Missing look id.', {
        code: 'MISSING_LOOK_ID',
      })
    }

    const access = await loadLookAccess(prisma, {
      lookPostId,
      viewerClientId: viewer?.clientProfile?.id ?? null,
      viewerProfessionalId: viewer?.professionalProfile?.id ?? null,
    })

    if (!access) {
      return jsonFail(404, 'Not found.', {
        code: 'LOOK_NOT_FOUND',
      })
    }

    const canView = canViewLookPost({
      isOwner: access.isOwner,
      viewerRole: viewer?.role ?? null,
      status: access.look.status,
      visibility: access.look.visibility,
      moderationStatus: access.look.moderationStatus,
      proVerificationStatus: access.look.professional.verificationStatus,
      viewerFollowsProfessional: access.viewerFollowsProfessional,
    })

    if (!canView) {
      return jsonFail(404, 'Not found.', {
        code: 'LOOK_NOT_FOUND',
      })
    }

    const result = await prisma.$transaction(
      async (tx): Promise<LooksShareResponseDto> => {
        const updated = await tx.lookPost.update({
          where: { id: lookPostId },
          data: { shareCount: { increment: 1 } },
          select: { shareCount: true },
        })

        await recomputeLookPostScores(tx, lookPostId)
        await enqueueRecomputeLookCounts(tx, { lookPostId })

        return {
          lookPostId,
          shareCount: updated.shareCount,
        }
      },
    )

    return jsonOk(result, 200)
  } catch (e) {
    console.error('POST /api/v1/looks/[id]/share error', e)
    return jsonFail(500, 'Couldn’t record that share. Try again.', {
      code: 'INTERNAL',
    })
  }
}
