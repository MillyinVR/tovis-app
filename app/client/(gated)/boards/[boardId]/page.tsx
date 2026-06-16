// app/client/boards/[boardId]/page.tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import { getBoardDetail, getBoardErrorMeta } from '@/lib/boards'
import type { LooksBoardDetailDto, LooksBoardDetailItemDto } from '@/lib/looks/types'

export const dynamic = 'force-dynamic'

type PageParams = {
  boardId: string
}

type MaybeCurrentUser = Awaited<ReturnType<typeof getCurrentUser>>

type AuthedClientUser = NonNullable<MaybeCurrentUser> & {
  role: 'CLIENT'
  clientProfile: { id: string }
}

function isAuthedClientUser(
  user: MaybeCurrentUser | null,
): user is AuthedClientUser {
  return Boolean(
    user &&
      user.role === 'CLIENT' &&
      user.clientProfile &&
      typeof user.clientProfile.id === 'string' &&
      user.clientProfile.id.trim(),
  )
}

async function requireAuthedClientUser(): Promise<AuthedClientUser> {
  const user = await getCurrentUser().catch(() => null)

  if (!isAuthedClientUser(user)) {
    redirect('/login?from=/client/me')
  }

  return user
}

async function resolvePageParams(
  value: PageParams | Promise<PageParams>,
): Promise<PageParams> {
  return Promise.resolve(value)
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function boardImageUrl(item: LooksBoardDetailItemDto): string | null {
  return (
    item.lookPost?.primaryMedia?.thumbUrl ??
    item.lookPost?.primaryMedia?.url ??
    null
  )
}

function boardItemHref(_item: LooksBoardDetailItemDto): string {
  // Temporary safe destination until a dedicated look detail route is confirmed.
  return '/looks'
}

function visibilityLabel(board: LooksBoardDetailDto): string {
  return board.visibility.toLowerCase()
}

export default async function ClientBoardDetailPage(props: {
  params: PageParams | Promise<PageParams>
}) {
  const user = await requireAuthedClientUser()
  const { boardId } = await resolvePageParams(props.params)

  const normalizedBoardId = boardId.trim()
  if (!normalizedBoardId) {
    notFound()
  }

  let board: LooksBoardDetailDto

  try {
    board = await getBoardDetail(prisma, {
      boardId: normalizedBoardId,
      clientId: user.clientProfile.id,
    })
  } catch (error) {
    const boardError = getBoardErrorMeta(error)

    if (boardError?.status === 404) {
      notFound()
    }

    if (boardError?.status === 403) {
      redirect('/client/me')
    }

    throw error
  }

  return (
    <main
      className="mx-auto w-full max-w-5xl px-4 pb-24 text-textPrimary"
      style={{
        paddingTop: 'max(48px, env(safe-area-inset-top, 0px) + 24px)',
      }}
    >
      <header className="mb-6 border-b border-white/10 pb-5">
        <Link
          href="/client/me"
          className="inline-flex items-center text-[12px] font-bold text-textSecondary transition hover:text-textPrimary"
        >
          ← Back to Me
        </Link>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-textSecondary/60">
              Board
            </div>
            <h1 className="mt-1 truncate font-display text-3xl font-semibold italic leading-tight text-textPrimary">
              {board.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-textSecondary">
              <span>{countLabel(board.itemCount, 'saved look', 'saved looks')}</span>
              <span>·</span>
              <span className="capitalize">{visibilityLabel(board)}</span>
            </div>
          </div>

          <Link
            href="/looks"
            className="inline-flex items-center rounded-full border border-white/10 bg-bgSecondary px-4 py-2 text-[12px] font-bold text-textPrimary transition hover:border-white/20"
          >
            Browse Looks
          </Link>
        </div>
      </header>

      {board.items.length === 0 ? (
        <section className="rounded-card border border-white/10 bg-bgSecondary px-5 py-10 text-center">
          <div className="text-[14px] font-bold text-textPrimary">
            This board is empty.
          </div>
          <div className="mt-2 text-[13px] text-textSecondary">
            Save looks from the feed to start building it.
          </div>
          <div className="mt-4">
            <Link
              href="/looks"
              className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-bold text-textPrimary transition hover:border-white/20"
            >
              Go to Looks
            </Link>
          </div>
        </section>
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {board.items.map((item) => {
            const imageUrl = boardImageUrl(item)
            const itemHref = boardItemHref(item)
            const caption = item.lookPost?.caption?.trim() || board.name

            return (
              <Link
                key={item.id}
                href={itemHref}
                className="group block"
                aria-label={`Open saved look from ${board.name}`}
              >
                <div
                  className="relative overflow-hidden rounded-card border border-white/10 bg-bgSecondary transition group-hover:border-white/20"
                  style={{ aspectRatio: '3 / 4' }}
                >
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={caption}
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-bgSurface to-bgPrimary" />
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-bgPrimary/85 via-transparent to-transparent" />

                  <div className="absolute inset-x-0 bottom-0 p-2">
                    <div className="line-clamp-2 text-[11px] font-semibold text-textPrimary">
                      {caption}
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </section>
      )}
    </main>
  )
}