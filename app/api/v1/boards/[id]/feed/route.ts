// app/api/v1/boards/[id]/feed/route.ts
//
// GET the board-scoped "Recommended for this board" feed (spec §4.4): a ranked
// set of looks the board owner hasn't saved yet, personalized to the board's
// declared purpose, chip answers, saved-look taste, and the owner's
// self-profile. Owner-only (a board's recommendations are private to its owner,
// like the board-detail GET). Returns the standard looks-feed DTO so clients
// render it with the same card component as every other feed.
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, pickString } from '@/app/api/_utils'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { getBoardErrorMeta, requireBoardOwner } from '@/lib/boards'
import { buildBoardFeedPage } from '@/lib/looks/boardFeed'
import { decodeLooksFeedCursor } from '@/lib/looks/feed'
import { mapLooksFeedMediaToDto } from '@/lib/looks/mappers'
import { buildLooksViewerFlagResolver } from '@/lib/looks/viewerFlags'
import { loadClientLinkViewer } from '@/lib/clientVisibility'
import { resolveTenantContextForRequest } from '@/lib/tenant'
import { parseSeenLookIds } from '@/lib/looks/forYouFeed'
import { logLooksFeedServe } from '@/lib/observability/looksFeedEvents'
import type { LooksFeedResponseDto } from '@/lib/looks/types'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const boardId = pickString(rawId)
    if (!boardId) {
      return jsonFail(400, 'Missing board id.', { code: 'MISSING_BOARD_ID' })
    }

    // Owner check + board context in one lookup (throws on missing/forbidden).
    const board = await requireBoardOwner(prisma, {
      boardId,
      clientId: auth.clientId,
    })

    const { searchParams } = new URL(req.url)

    const requestedLimit = pickInt(searchParams.get('limit')) ?? 12
    const limit = Math.max(1, Math.min(requestedLimit, 50))

    const rawCursor = pickString(searchParams.get('cursor'))
    const cursor = decodeLooksFeedCursor(rawCursor)
    if (rawCursor && !cursor) {
      return jsonFail(400, 'Invalid looks cursor.')
    }

    const seenLookIds = parseSeenLookIds(searchParams.get('seen'))
    const tenant = await resolveTenantContextForRequest(req)

    const page = await buildBoardFeedPage({
      tenant,
      board: {
        id: board.id,
        clientId: board.clientId,
        type: board.type,
        eventDate: board.eventDate,
        answers: board.answers,
      },
      limit,
      cursor,
      seenLookIds,
      now: new Date(),
    })

    const resolveViewerFlags = await buildLooksViewerFlagResolver({
      user: auth.user,
      items: page.items,
    })
    const clientLinkViewer = await loadClientLinkViewer(auth.user)

    const mapped = await Promise.all(
      page.items.map((item) =>
        mapLooksFeedMediaToDto({
          item,
          ...resolveViewerFlags(item),
          clientLinkViewer,
        }),
      ),
    )

    const payload = mapped.filter(
      (item): item is NonNullable<typeof item> => item !== null,
    )

    logLooksFeedServe({
      cohort: 'board_feed',
      authed: true,
      page: cursor ? 'more' : 'entry',
      itemCount: payload.length,
      userId: auth.user.id,
      backboneCount: page.meta.backboneCount,
      injectedCount: page.meta.injectedCount,
      seenCount: page.meta.seenCount,
      occasionTagCount: page.meta.occasionTagCount,
      tasteSignalCount: page.meta.tasteSignalCount,
      candidateEmbeddingCount: page.meta.candidateEmbeddingCount,
      answerTagCount: page.meta.answerTagCount,
      feasibilityTagCount: page.meta.feasibilityTagCount,
      savedExcludedCount: page.meta.savedExcludedCount,
    })

    const body: LooksFeedResponseDto & { ok: true } = {
      ok: true,
      items: payload,
      nextCursor: page.nextCursor,
      viewerContext: { isAuthenticated: true },
    }

    return jsonOk(body)
  } catch (error) {
    const boardError = getBoardErrorMeta(error)
    if (boardError) {
      return jsonFail(boardError.status, boardError.message, {
        code: boardError.code,
      })
    }

    console.error('GET /api/v1/boards/[id]/feed error', error)
    return jsonFail(500, 'Couldn’t load board recommendations. Try again.', {
      code: 'INTERNAL',
    })
  }
}
