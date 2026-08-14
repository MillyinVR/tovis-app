import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * Handing a client's inspiration board to their pro, for one booking.
 *
 * 🔴 THIS IS A DISCLOSURE, NOT A VISIBILITY CHANGE. `Board.visibility` is never
 * written here. A PRIVATE board that has been shared to a booking stays private
 * to the whole rest of the world — the pro on that one booking can read it
 * because a `BookingBoardShare` row says so, and deleting that row takes the
 * access away again.
 *
 * Every pro-side read of a client's board goes through `proBoardsForBooking`
 * below, so there is exactly ONE place in the codebase that widens who can see
 * a board. If a second one ever appears, this comment is the thing that was
 * wrong.
 */

/** Four tiles is what both clients draw; asking for more would be dead data. */
export const BOARD_SHARE_TILE_COUNT = 4

export type SharedBoardSummary = {
  boardId: string
  name: string
  itemCount: number
  /** Already-resolved tile urls, newest saved look first. */
  tileImageUrls: string[]
  sharedAt: Date
}

const boardShareSelect = {
  boardId: true,
  sharedAt: true,
  board: {
    select: {
      id: true,
      name: true,
      _count: { select: { items: true } },
      items: {
        orderBy: { createdAt: 'desc' },
        take: BOARD_SHARE_TILE_COUNT,
        select: {
          lookPost: {
            select: {
              primaryMediaAsset: {
                select: { thumbUrl: true, url: true },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.BookingBoardShareSelect

type ShareRow = Prisma.BookingBoardShareGetPayload<{
  select: typeof boardShareSelect
}>

function tileUrls(share: ShareRow): string[] {
  return share.board.items
    .map(
      (item) =>
        item.lookPost?.primaryMediaAsset?.thumbUrl ??
        item.lookPost?.primaryMediaAsset?.url ??
        null,
    )
    .filter((url): url is string => typeof url === 'string' && url.length > 0)
}

/**
 * The boards the CLIENT has handed to the pro for this booking.
 *
 * Callers must already have proved the reader is the pro on `bookingId` — this
 * scopes to the booking, not to the viewer.
 */
export async function proBoardsForBooking(
  db: PrismaClient | Prisma.TransactionClient,
  bookingId: string,
): Promise<SharedBoardSummary[]> {
  const shares = await db.bookingBoardShare.findMany({
    where: { bookingId },
    orderBy: { sharedAt: 'asc' },
    select: boardShareSelect,
  })

  return shares.map((share) => ({
    boardId: share.boardId,
    name: share.board.name,
    itemCount: share.board._count.items,
    tileImageUrls: tileUrls(share),
    sharedAt: share.sharedAt,
  }))
}

/** The board ids the client has already sent for this booking. */
export async function sharedBoardIdsForBooking(
  db: PrismaClient | Prisma.TransactionClient,
  bookingId: string,
): Promise<string[]> {
  const rows = await db.bookingBoardShare.findMany({
    where: { bookingId },
    select: { boardId: true },
  })
  return rows.map((row) => row.boardId)
}
