import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { getCurrentUser } from '@/lib/currentUser'
import { loadLookAccess } from '@/lib/looks/access'
import {
  canCommentOnLookPost,
  canModerateLookPost,
  canSaveLookPost,
  canViewLookPost,
} from '@/lib/looks/guards'
import {
  mapLooksDetailMediaToRenderable,
  mapLooksDetailToDto,
} from '@/lib/looks/mappers'
import { looksDetailSelect } from '@/lib/looks/selects'
import type { LooksDetailResponseDto } from '@/lib/looks/types'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id: rawId } = await getParams(ctx)
    const lookPostId = pickString(rawId)

    if (!lookPostId) {
      return jsonFail(400, 'Missing look id.', {
        code: 'MISSING_LOOK_ID',
      })
    }

    const viewer = await getCurrentUser().catch(() => null)

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

    const [row, liked] = await Promise.all([
      prisma.lookPost.findUnique({
        where: { id: lookPostId },
        select: looksDetailSelect,
      }),
      viewer
        ? prisma.lookLike.findUnique({
            where: {
              lookPostId_userId: {
                lookPostId,
                userId: viewer.id,
              },
            },
            select: {
              lookPostId: true,
            },
          })
        : Promise.resolve(null),
    ])

    if (!row) {
      return jsonFail(404, 'Not found.', {
        code: 'LOOK_NOT_FOUND',
      })
    }

    const renderable = await mapLooksDetailMediaToRenderable(row)

    if (!renderable) {
      console.error('GET /api/looks/[id] missing renderable media', {
        lookPostId,
      })

      return jsonFail(500, 'Couldn’t load that look. Try again.', {
        code: 'INTERNAL',
      })
    }

    const canComment = canCommentOnLookPost({
      isOwner: access.isOwner,
      viewerRole: viewer?.role ?? null,
      status: access.look.status,
      visibility: access.look.visibility,
      moderationStatus: access.look.moderationStatus,
      proVerificationStatus: access.look.professional.verificationStatus,
      viewerFollowsProfessional: access.viewerFollowsProfessional,
    })

    const canSave = canSaveLookPost({
      isOwner: access.isOwner,
      viewerRole: viewer?.role ?? null,
      status: access.look.status,
      visibility: access.look.visibility,
      moderationStatus: access.look.moderationStatus,
      proVerificationStatus: access.look.professional.verificationStatus,
      viewerFollowsProfessional: access.viewerFollowsProfessional,
    })

    const canModerate = canModerateLookPost({
      viewerRole: viewer?.role ?? null,
    })

    const body: LooksDetailResponseDto = {
      item: mapLooksDetailToDto({
        item: renderable,
        viewerContext: {
          isAuthenticated: Boolean(viewer),
          viewerLiked: Boolean(liked),
          canComment,
          canSave,
          isOwner: access.isOwner,
          canModerate,
        },
      }),
    }

    return jsonOk(body, 200)
  } catch (e) {
    console.error('GET /api/looks/[id] error', e)
    return jsonFail(500, 'Couldn’t load that look. Try again.', {
      code: 'INTERNAL',
    })
  }
}