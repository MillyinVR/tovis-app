'use client'

// "Creators to follow" rail on the client Me → Following tab (social-first D3).
// Fetches /api/v1/client/follow-suggestions and lets the viewer follow a
// suggested creator inline (POST /api/v1/client/follow/[handle]).

import { useEffect, useState } from 'react'
import Link from 'next/link'

import RemoteImage from '@/app/_components/media/RemoteImage'

type Suggestion = {
  clientId: string
  handle: string
  avatarUrl: string | null
  likedLookCount: number
}

export default function FollowSuggestionsRail() {
  const [items, setItems] = useState<Suggestion[]>([])
  const [loaded, setLoaded] = useState(false)
  const [followed, setFollowed] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/v1/client/follow-suggestions')
        if (!res.ok) throw new Error('failed')
        const data = (await res.json()) as { items?: Suggestion[] }
        if (!cancelled) setItems(Array.isArray(data.items) ? data.items : [])
      } catch {
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function follow(handle: string) {
    if (busy) return
    setBusy(handle)
    try {
      const res = await fetch(
        `/api/v1/client/follow/${encodeURIComponent(handle)}`,
        { method: 'POST' },
      )
      if (!res.ok) throw new Error('failed')
      const data = (await res.json()) as { following?: boolean }
      setFollowed((prev) => ({ ...prev, [handle]: data.following !== false }))
    } catch {
      // Leave the button as-is; a transient failure just means "try again".
    } finally {
      setBusy(null)
    }
  }

  if (!loaded || items.length === 0) return null

  return (
    <section className="mb-5 rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[13px] font-black uppercase tracking-wide text-textPrimary">
          Creators to follow
        </h3>
        <span className="text-[11px] text-textSecondary">
          From looks you’ve liked
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {items.map((item) => {
          const isFollowing = followed[item.handle] === true
          return (
            <div
              key={item.clientId}
              className="flex w-36 flex-none flex-col items-center rounded-card border border-white/10 bg-bgPrimary p-3 text-center"
            >
              <Link href={`/u/${item.handle}`} className="block">
                <div className="mx-auto h-14 w-14 overflow-hidden rounded-full border border-white/10 bg-bgSurface">
                  {item.avatarUrl ? (
                    <RemoteImage
                      src={item.avatarUrl}
                      alt={`@${item.handle}`}
                      width={56}
                      height={56}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="mt-2 truncate text-[12px] font-bold text-textPrimary">
                  @{item.handle}
                </div>
              </Link>
              <button
                type="button"
                disabled={busy === item.handle || isFollowing}
                onClick={() => follow(item.handle)}
                className="mt-2 w-full rounded-full border border-accentPrimary/60 bg-accentPrimary px-3 py-1.5 text-[11px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isFollowing ? 'Following' : busy === item.handle ? '…' : 'Follow'}
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
