// app/api/boards/[id]/route.ts
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
import type {
  LooksBoardDeleteResponseDto,
  LooksBoardDetailResponseDto,
} from '@/lib/looks/types'
import { BoardVisibility } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawId } = await getParams(ctx)
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

    console.error('GET /api/boards/[id] error', error)
    return jsonFail(500, 'Couldn’t load board. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawId } = await getParams(ctx)
    const boardId = pickString(rawId)

    if (!boardId) {
      return jsonFail(400, 'Missing board id.', {
        code: 'MISSING_BOARD_ID',
      })
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const hasName = Object.prototype.hasOwnProperty.call(body, 'name')
    const hasVisibility = Object.prototype.hasOwnProperty.call(body, 'visibility')

    if (!hasName && !hasVisibility) {
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

    await updateBoard(prisma, {
      boardId,
      clientId: auth.clientId,
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(nextVisibility !== undefined
        ? { visibility: nextVisibility }
        : {}),
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

    console.error('PATCH /api/boards/[id] error', error)
    return jsonFail(500, 'Couldn’t update board. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawId } = await getParams(ctx)
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

    console.error('DELETE /api/boards/[id] error', error)
    return jsonFail(500, 'Couldn’t delete board. Try again.', {
      code: 'INTERNAL',
    })
  }
}