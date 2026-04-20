// app/api/boards/[id]/items/route.ts
import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickString,
  requireClient,
} from '@/app/api/_utils'
import {
  addBoardItem,
  buildLooksBoardItemMutationResponse,
  getBoardErrorMeta,
  getViewerLookSaveState,
} from '@/lib/boards'
import { loadLookAccess } from '@/lib/looks/access'
import {
  canSaveLookPost,
  canViewLookPost,
} from '@/lib/looks/guards'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawBoardId } = await getParams(ctx)
    const boardId = pickString(rawBoardId)

    if (!boardId) {
      return jsonFail(400, 'Missing board id.', {
        code: 'MISSING_BOARD_ID',
      })
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}
    const lookPostId =
      typeof body.lookPostId === 'string' ? pickString(body.lookPostId) : null

    if (!lookPostId) {
      return jsonFail(400, 'Missing look id.', {
        code: 'MISSING_LOOK_ID',
      })
    }

    const access = await loadLookAccess(prisma, {
      lookPostId,
      viewerClientId: auth.clientId,
      viewerProfessionalId: auth.user.professionalProfile?.id ?? null,
    })

    if (!access) {
      return jsonFail(404, 'Not found.', {
        code: 'LOOK_NOT_FOUND',
      })
    }

    const canView = canViewLookPost({
      isOwner: access.isOwner,
      viewerRole: auth.user.role ?? null,
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

    const canSave = canSaveLookPost({
      isOwner: access.isOwner,
      viewerRole: auth.user.role ?? null,
      status: access.look.status,
      visibility: access.look.visibility,
      moderationStatus: access.look.moderationStatus,
      proVerificationStatus: access.look.professional.verificationStatus,
      viewerFollowsProfessional: access.viewerFollowsProfessional,
    })

    if (!canSave) {
      return jsonFail(403, 'You can’t save this look.', {
        code: 'SAVE_FORBIDDEN',
      })
    }

    const result = await addBoardItem(prisma, {
      boardId,
      clientId: auth.clientId,
      lookPostId,
    })

    const state = await getViewerLookSaveState(prisma, {
      viewerClientId: auth.clientId,
      lookPostId,
    })

    return jsonOk(
      buildLooksBoardItemMutationResponse({
        boardId: result.board.id,
        lookPostId,
        inBoard: true,
        saveCount: result.saveCount,
        state,
      }),
      result.added ? 201 : 200,
    )
  } catch (error) {
    const boardError = getBoardErrorMeta(error)
    if (boardError) {
      return jsonFail(boardError.status, boardError.message, {
        code: boardError.code,
      })
    }

    console.error('POST /api/boards/[id]/items error', error)
    return jsonFail(500, 'Couldn’t add that look to the board. Try again.', {
      code: 'INTERNAL',
    })
  }
}