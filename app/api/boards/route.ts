// app/api/boards/route.ts

import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickInt,
  requireClient,
} from '@/app/api/_utils'
import {
  createBoard,
  getBoardDetail,
  getBoardErrorMeta,
  getBoardSummaries,
  parseBoardVisibility,
} from '@/lib/boards'
import type {
  LooksBoardDetailResponseDto,
  LooksBoardsListResponseDto,
} from '@/lib/looks/types'

export const dynamic = 'force-dynamic'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function GET(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { searchParams } = new URL(req.url)
    const take = pickInt(searchParams.get('limit')) ?? 24
    const skip = pickInt(searchParams.get('skip')) ?? 0

    const boards = await getBoardSummaries(prisma, {
      clientId: auth.clientId,
      viewerClientId: auth.clientId,
      take,
      skip,
    })

    const body: LooksBoardsListResponseDto = {
      boards,
    }

    return jsonOk(body, 200)
  } catch (error) {
    console.error('GET /api/boards error', error)
    return jsonFail(500, 'Couldn’t load boards. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const name = typeof body.name === 'string' ? body.name : ''
    const rawVisibility =
      typeof body.visibility === 'string' ? body.visibility : undefined
    const visibility =
      rawVisibility === undefined
        ? undefined
        : parseBoardVisibility(rawVisibility)

    if (rawVisibility !== undefined && !visibility) {
      return jsonFail(400, 'Invalid board visibility.', {
        code: 'INVALID_BOARD_VISIBILITY',
      })
    }

    const created = await createBoard(prisma, {
      clientId: auth.clientId,
      name,
      ...(visibility ? { visibility } : {}),
    })

    const board = await getBoardDetail(prisma, {
      boardId: created.id,
      clientId: auth.clientId,
    })

    const response: LooksBoardDetailResponseDto = {
      board,
    }

    return jsonOk(response, 201)
  } catch (error) {
    const boardError = getBoardErrorMeta(error)
    if (boardError) {
      return jsonFail(boardError.status, boardError.message, {
        code: boardError.code,
      })
    }

    console.error('POST /api/boards error', error)
    return jsonFail(500, 'Couldn’t create board. Try again.', {
      code: 'INTERNAL',
    })
  }
}