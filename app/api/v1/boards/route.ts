// app/api/v1/boards/route.ts

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
import {
  normalizeBoardAnswers,
  parseBoardContextInput,
} from '@/lib/boards/context'
import { applyBoardAnswersWriteThrough } from '@/lib/personalization/selfProfileStore'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import type {
  LooksBoardDetailResponseDto,
  LooksBoardsListResponseDto,
} from '@/lib/looks/types'

export const dynamic = 'force-dynamic'

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
    console.error('GET /api/v1/boards error', error)
    return jsonFail(500, 'Couldn’t load boards. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const body = await readJsonRecord(req)

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

    const context = parseBoardContextInput(body)
    if (!context.ok) {
      return jsonFail(400, context.error.message, {
        code: context.error.code,
      })
    }

    const created = await createBoard(prisma, {
      clientId: auth.clientId,
      name,
      ...(visibility ? { visibility } : {}),
      ...context.value,
    })

    // Self-profile write-through (spec §7.3): only on the client's explicit
    // opt-in, and only the person-describing subset of the stored answers.
    if (body.writeThroughSelfProfile === true) {
      await applyBoardAnswersWriteThrough(prisma, {
        clientId: auth.clientId,
        answers: normalizeBoardAnswers(created.type, created.answers),
        now: new Date(),
      })
    }

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

    console.error('POST /api/v1/boards error', error)
    return jsonFail(500, 'Couldn’t create board. Try again.', {
      code: 'INTERNAL',
    })
  }
}