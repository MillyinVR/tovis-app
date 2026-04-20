// app/api/boards/[id]/items/[lookId]/route.ts
import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickString,
  requireClient,
} from '@/app/api/_utils'
import {
  buildLooksBoardItemMutationResponse,
  getBoardErrorMeta,
  getViewerLookSaveState,
  removeBoardItem,
} from '@/lib/boards'

export const dynamic = 'force-dynamic'

type Params = { id: string; lookId: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawBoardId, lookId: rawLookId } = await getParams(ctx)
    const boardId = pickString(rawBoardId)
    const lookPostId = pickString(rawLookId)

    if (!boardId) {
      return jsonFail(400, 'Missing board id.', {
        code: 'MISSING_BOARD_ID',
      })
    }

    if (!lookPostId) {
      return jsonFail(400, 'Missing look id.', {
        code: 'MISSING_LOOK_ID',
      })
    }

    const look = await prisma.lookPost.findUnique({
      where: { id: lookPostId },
      select: { id: true },
    })

    if (!look) {
      return jsonFail(404, 'Not found.', {
        code: 'LOOK_NOT_FOUND',
      })
    }

    const result = await removeBoardItem(prisma, {
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
        inBoard: false,
        saveCount: result.saveCount,
        state,
      }),
      200,
    )
  } catch (error) {
    const boardError = getBoardErrorMeta(error)
    if (boardError) {
      return jsonFail(boardError.status, boardError.message, {
        code: boardError.code,
      })
    }

    console.error('DELETE /api/boards/[id]/items/[lookId] error', error)
    return jsonFail(500, 'Couldn’t remove that look from the board. Try again.', {
      code: 'INTERNAL',
    })
  }
}