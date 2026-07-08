'use client'

// "Recommended for this board" — the board-scoped feed (spec §4.4). Fetches the
// owner-only GET /api/v1/boards/[id]/feed and renders looks the owner hasn't
// saved yet, ranked to the board's purpose / answers / saved-look taste. Renders
// nothing until it has at least one recommendation, so an empty or brand-new
// board shows no empty shell.
import { useEffect, useState } from 'react'
import Link from 'next/link'

import RemoteImage from '@/app/_components/media/RemoteImage'
import type { LooksFeedItemDto, LooksFeedResponseDto } from '@/lib/looks/types'

type LoadState = 'loading' | 'ready' | 'error'

export default function BoardRecommendations(props: {
  boardId: string
  boardName: string
}) {
  const { boardId, boardName } = props
  const [items, setItems] = useState<LooksFeedItemDto[]>([])
  const [state, setState] = useState<LoadState>('loading')

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function load() {
      try {
        const res = await fetch(
          `/api/v1/boards/${encodeURIComponent(boardId)}/feed?limit=12`,
          { signal: controller.signal, credentials: 'same-origin' },
        )
        if (!res.ok) throw new Error(`Feed request failed: ${res.status}`)

        const body = (await res.json()) as LooksFeedResponseDto & {
          ok?: boolean
        }
        if (cancelled) return

        setItems(Array.isArray(body.items) ? body.items : [])
        setState('ready')
      } catch (error) {
        if (cancelled || controller.signal.aborted) return
        console.error('Failed to load board recommendations', error)
        setState('error')
      }
    }

    void load()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [boardId])

  // Stay invisible until there's something worth showing — an empty or failed
  // load never renders a header or shell.
  if (state !== 'ready' || items.length === 0) return null

  return (
    <section className="mt-10">
      <div className="mb-4">
        <h2 className="font-display text-xl font-semibold italic text-textPrimary">
          Recommended for this board
        </h2>
        <p className="mt-1 text-[12px] text-textSecondary">
          Looks we think fit {boardName} — you haven’t saved these yet.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => {
          const imageUrl = item.thumbUrl ?? item.url
          const caption = item.caption?.trim() || boardName

          return (
            <Link
              key={item.id}
              href="/looks"
              className="group block"
              aria-label={`Open recommended look for ${boardName}`}
            >
              <div
                className="relative overflow-hidden rounded-card border border-white/10 bg-bgSecondary transition group-hover:border-white/20"
                style={{ aspectRatio: '3 / 4' }}
              >
                {imageUrl ? (
                  <RemoteImage
                    src={imageUrl}
                    alt={caption}
                    width={300}
                    height={400}
                    className="absolute inset-0 h-full w-full object-cover"
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
      </div>
    </section>
  )
}
