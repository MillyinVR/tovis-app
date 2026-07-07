// app/api/v1/boards/[id]/route.ts
import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickString,
  requireClient,
} from '@/app/api/_utils'
import {
  deleteBoard,
  getBoardDetail,
  getBoardErrorMeta,
  parseBoardVisibility,
  updateBoard,
} from '@/lib/boards'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { parseBoardContextInput } from '@/lib/boards/context'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import type {
  LooksBoardDeleteResponseDto,
  LooksBoardDetailResponseDto,
} from '@/lib/looks/types'
import { BoardVisibility } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const boardId = pickString(rawId)

    if (!boardId) {
      return jsonFail(400, 'Missing board id.', {
        code: 'MISSING_BOARD_ID',
      })
    }

    const board = await getBoardDetail(prisma, {
      boardId,
      clientId: auth.clientId,
    })

    const response: LooksBoardDetailResponseDto = {
      board,
    }

    return jsonOk(response, 200)
  } catch (error) {
    const boardError = getBoardErrorMeta(error)
    if (boardError) {
      return jsonFail(boardError.status, boardError.message, {
        code: boardError.code,
      })
    }

    console.error('GET /api/v1/boards/[id] error', error)
    return jsonFail(500, 'Couldn’t load board. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const boardId = pickString(rawId)

    if (!boardId) {
      return jsonFail(400, 'Missing board id.', {
        code: 'MISSING_BOARD_ID',
      })
    }

    const body = await readJsonRecord(req)

    const hasName = Object.prototype.hasOwnProperty.call(body, 'name')
    const hasVisibility = Object.prototype.hasOwnProperty.call(body, 'visibility')
    const hasContext = ['type', 'eventDate', 'answers'].some((key) =>
      Object.prototype.hasOwnProperty.call(body, key),
    )

    if (!hasName && !hasVisibility && !hasContext) {
      return jsonFail(400, 'Nothing to update.', {
        code: 'NOTHING_TO_UPDATE',
      })
    }

    let nextName: string | undefined
    if (hasName) {
      if (typeof body.name !== 'string') {
        return jsonFail(400, 'Invalid board name.', {
          code: 'INVALID_BOARD_NAME',
        })
      }
      nextName = body.name
    }

    let nextVisibility: BoardVisibility | undefined
    if (hasVisibility) {
      if (typeof body.visibility !== 'string') {
        return jsonFail(400, 'Invalid board visibility.', {
          code: 'INVALID_BOARD_VISIBILITY',
        })
      }

      const parsedVisibility = parseBoardVisibility(body.visibility)
      if (!parsedVisibility) {
        return jsonFail(400, 'Invalid board visibility.', {
          code: 'INVALID_BOARD_VISIBILITY',
        })
      }

      nextVisibility = parsedVisibility
    }

    const context = parseBoardContextInput(body)
    if (!context.ok) {
      return jsonFail(400, context.error.message, {
        code: context.error.code,
      })
    }

    await updateBoard(prisma, {
      boardId,
      clientId: auth.clientId,
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(nextVisibility !== undefined
        ? { visibility: nextVisibility }
        : {}),
      ...context.value,
    })

    const board = await getBoardDetail(prisma, {
      boardId,
      clientId: auth.clientId,
    })

    const response: LooksBoardDetailResponseDto = {
      board,
    }

    return jsonOk(response, 200)
  } catch (error) {
    const boardError = getBoardErrorMeta(error)
    if (boardError) {
      return jsonFail(boardError.status, boardError.message, {
        code: boardError.code,
      })
    }

    console.error('PATCH /api/v1/boards/[id] error', error)
    return jsonFail(500, 'Couldn’t update board. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const boardId = pickString(rawId)

    if (!boardId) {
      return jsonFail(400, 'Missing board id.', {
        code: 'MISSING_BOARD_ID',
      })
    }

    const deleted = await deleteBoard(prisma, {
      boardId,
      clientId: auth.clientId,
    })

    const response: LooksBoardDeleteResponseDto = {
      deleted: true,
      id: deleted.id,
    }

    return jsonOk(response, 200)
  } catch (error) {
    const boardError = getBoardErrorMeta(error)
    if (boardError) {
      return jsonFail(boardError.status, boardError.message, {
        code: boardError.code,
      })
    }

    console.error('DELETE /api/v1/boards/[id] error', error)
    return jsonFail(500, 'Couldn’t delete board. Try again.', {
      code: 'INTERNAL',
    })
  }
}