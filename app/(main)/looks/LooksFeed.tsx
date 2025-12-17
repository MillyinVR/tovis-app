// app/(main)/looks/LooksFeed.tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UI_SIZES } from '../ui/layoutConstants'
import AvailabilityDrawer from '../booking/AvailabilityDrawer'

type FeedItem = {
  id: string
  url: string
  mediaType: 'IMAGE' | 'VIDEO'
  caption: string | null
  professional: { id: string; businessName: string | null } | null
  _count: { likes: number; comments: number }
  viewerLiked: boolean

  // from /api/looks DTO (recommended)
  serviceId?: string | null
  serviceName?: string | null
  category?: string | null
}

type UiComment = {
  id: string
  body: string
  createdAt: string
  user: {
    id: string
    displayName: string
    avatarUrl: string | null
  }
}

type DrawerContext = {
  mediaId: string
  professionalId: string
  serviceId?: string | null
} | null

function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/looks'
  return window.location.pathname + window.location.search + window.location.hash
}

/** Prevent open-redirect nonsense */
function sanitizeFrom(from: string) {
  const trimmed = from.trim()
  if (!trimmed) return '/looks'
  if (!trimmed.startsWith('/')) return '/looks'
  if (trimmed.startsWith('//')) return '/looks'
  return trimmed
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

/** Small deterministic “random” so signals don’t flicker on re-render */
function hashStringToIndex(id: string, mod: number) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return mod === 0 ? 0 : h % mod
}

const BOOKING_SIGNALS = [
  'Booked today',
  'Filling fast',
  'Popular near you',
  'New availability',
  'High rebook rate',
  'Clients saved this',
] as const

const FUTURE_SELF_LINES = [
  'Wake up ready.',
  'Low-maintenance glow.',
  'Future-you called. Do it.',
  'Main-character upgrade.',
] as const

const FOOTER_HEIGHT = UI_SIZES.footerHeight
const HEADER_SAFE_TOP = UI_SIZES.headerSafeTop
const RIGHT_RAIL_BOTTOM = UI_SIZES.footerHeight + UI_SIZES.rightRailBottomOffset

export default function LooksFeed() {
  const router = useRouter()

  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [feedError, setFeedError] = useState<string | null>(null)

  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null)
  const [comments, setComments] = useState<UiComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)

  // per-media locks & double tap tracking
  const likeInFlight = useRef<Record<string, boolean>>({})
  const lastTapRef = useRef<Record<string, number>>({})

  // scroll container ref (feed-only scroll)
  const feedScrollRef = useRef<HTMLDivElement | null>(null)

  // Availability Drawer state
  const [availabilityOpen, setAvailabilityOpen] = useState(false)
  const [drawerCtx, setDrawerCtx] = useState<DrawerContext>(null)

  // Header UI state (future filter)
  const categories = useMemo(
    () => ['For You', 'Hair', 'Mens Grooming', 'Nails', 'Lashes', 'Makeup', 'Massage'],
    [],
  )
  const [activeCategory, setActiveCategory] = useState('For You')
  const [query, setQuery] = useState('')

  const redirectToLogin = useCallback(
    (reason: string) => {
      const from = sanitizeFrom(currentPathWithQuery())
      const qs = new URLSearchParams({ from, reason })
      router.push(`/login?${qs.toString()}`)
    },
    [router],
  )

  const loadFeed = useCallback(async () => {
    setLoading(true)
    setFeedError(null)

    try {
      // Future-proof:
      // const qs = new URLSearchParams({ limit: '24', category: activeCategory, q: query })
      // const res = await fetch(`/api/looks?${qs.toString()}`, { cache: 'no-store' })

      const res = await fetch('/api/looks?limit=24', { cache: 'no-store' })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to load looks')

      setItems(Array.isArray(data.items) ? data.items : [])
    } catch (e: any) {
      setFeedError(e?.message || 'Failed to load looks')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFeed()
  }, [loadFeed])

  // Guests should be able to scroll, but actions redirect on 401
  function isGuestBlocked(status: number) {
    return status === 401
  }

  const snapToIndex = useCallback((index: number) => {
    const el = feedScrollRef.current
    if (!el) return
    const itemHeight = el.clientHeight
    el.scrollTo({ top: index * itemHeight, behavior: 'smooth' })
  }, [])

  const toggleLike = useCallback(
    async (mediaId: string) => {
      if (likeInFlight.current[mediaId]) return
      likeInFlight.current[mediaId] = true

      let beforeLiked = false
      let beforeCount = 0

      setItems((prev) => {
        const cur = prev.find((x) => x.id === mediaId)
        beforeLiked = !!cur?.viewerLiked
        beforeCount = cur?._count.likes ?? 0

        return prev.map((m) => {
          if (m.id !== mediaId) return m
          const nextLiked = !m.viewerLiked
          const nextCount = Math.max(0, m._count.likes + (nextLiked ? 1 : -1))
          return { ...m, viewerLiked: nextLiked, _count: { ...m._count, likes: nextCount } }
        })
      })

      try {
        const res = await fetch(`/api/looks/${mediaId}/like`, {
          method: beforeLiked ? 'DELETE' : 'POST',
        })
        const data = await safeJson(res)

        if (isGuestBlocked(res.status)) {
          // rollback
          setItems((prev) =>
            prev.map((m) =>
              m.id === mediaId
                ? { ...m, viewerLiked: beforeLiked, _count: { ...m._count, likes: beforeCount } }
                : m,
            ),
          )
          redirectToLogin('like')
          return
        }

        if (!res.ok) {
          // rollback
          setItems((prev) =>
            prev.map((m) =>
              m.id === mediaId
                ? { ...m, viewerLiked: beforeLiked, _count: { ...m._count, likes: beforeCount } }
                : m,
            ),
          )
          return
        }

        const serverLiked = typeof data?.liked === 'boolean' ? data.liked : !beforeLiked
        const serverCount =
          typeof data?.likeCount === 'number'
            ? data.likeCount
            : typeof data?.likes === 'number'
              ? data.likes
              : typeof data?._count?.likes === 'number'
                ? data._count.likes
                : undefined

        setItems((prev) =>
          prev.map((m) =>
            m.id === mediaId
              ? {
                  ...m,
                  viewerLiked: serverLiked,
                  _count: { ...m._count, likes: typeof serverCount === 'number' ? serverCount : m._count.likes },
                }
              : m,
          ),
        )
      } finally {
        likeInFlight.current[mediaId] = false
      }
    },
    [redirectToLogin],
  )

  // TikTok-like: double tap should only LIKE (not unlike)
  const likeOnly = useCallback(
    (mediaId: string) => {
      const item = items.find((x) => x.id === mediaId)
      if (!item || item.viewerLiked) return
      toggleLike(mediaId)
    },
    [items, toggleLike],
  )

  const handleDoubleClickLikeOnly = useCallback(
    (mediaId: string) => {
      likeOnly(mediaId)
    },
    [likeOnly],
  )

  const handleTouchEndLikeOnly = useCallback(
    (mediaId: string) => {
      const now = Date.now()
      const last = lastTapRef.current[mediaId] ?? 0
      lastTapRef.current[mediaId] = now
      if (now - last < 280) likeOnly(mediaId)
    },
    [likeOnly],
  )

  async function openCommentsDrawer(mediaId: string) {
    setOpenCommentsFor(mediaId)
    setComments([])
    setCommentText('')
    setCommentError(null)
    setCommentsLoading(true)

    try {
      const res = await fetch(`/api/looks/${mediaId}/comments`, { cache: 'no-store' })
      const data = await safeJson(res)

      if (isGuestBlocked(res.status)) {
        setOpenCommentsFor(null)
        redirectToLogin('comment')
        return
      }

      if (!res.ok) throw new Error(data?.error || 'Failed to load comments')
      setComments(Array.isArray(data.comments) ? data.comments : [])
    } catch (e: any) {
      setCommentError(e?.message || 'Failed to load comments')
    } finally {
      setCommentsLoading(false)
    }
  }

  async function postComment() {
    if (!openCommentsFor || posting) return
    const body = commentText.trim()
    if (!body) return

    setPosting(true)
    setCommentError(null)

    const mediaId = openCommentsFor
    const tempId = `temp_${Date.now()}`

    const optimistic: UiComment = {
      id: tempId,
      body,
      createdAt: new Date().toISOString(),
      user: { id: 'me', displayName: 'You', avatarUrl: null },
    }

    // optimistic UI
    setComments((prev) => [optimistic, ...prev])
    setCommentText('')
    setItems((prev) =>
      prev.map((m) => (m.id === mediaId ? { ...m, _count: { ...m._count, comments: m._count.comments + 1 } } : m)),
    )

    try {
      const res = await fetch(`/api/looks/${mediaId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })

      const data = await safeJson(res)

      if (isGuestBlocked(res.status)) {
        // rollback
        setComments((prev) => prev.filter((c) => c.id !== tempId))
        setItems((prev) =>
          prev.map((m) =>
            m.id === mediaId ? { ...m, _count: { ...m._count, comments: Math.max(0, m._count.comments - 1) } } : m,
          ),
        )
        redirectToLogin('comment')
        return
      }

      if (!res.ok) {
        // rollback
        setComments((prev) => prev.filter((c) => c.id !== tempId))
        setItems((prev) =>
          prev.map((m) =>
            m.id === mediaId ? { ...m, _count: { ...m._count, comments: Math.max(0, m._count.comments - 1) } } : m,
          ),
        )
        setCommentError(data?.error || 'Failed to post comment')
        return
      }

      await openCommentsDrawer(mediaId)
    } catch (e: any) {
      // rollback
      setComments((prev) => prev.filter((c) => c.id !== tempId))
      setItems((prev) =>
        prev.map((m) =>
          m.id === mediaId ? { ...m, _count: { ...m._count, comments: Math.max(0, m._count.comments - 1) } } : m,
        ),
      )
      setCommentError(e?.message || 'Failed to post comment')
    } finally {
      setPosting(false)
    }
  }

  function onSelectCategory(cat: string) {
    setActiveCategory(cat)
    snapToIndex(0)
  }

  function openAvailabilityFor(item: FeedItem) {
    if (!item.professional?.id) return
    setDrawerCtx({
      mediaId: item.id,
      professionalId: item.professional.id,
      serviceId: item.serviceId ?? null,
    })
    setAvailabilityOpen(true)
  }

  if (loading) return <div style={{ padding: 12 }}>Loading…</div>
  if (feedError) return <div style={{ padding: 12, color: '#ef4444' }}>{feedError}</div>
  if (!items.length) return <div style={{ padding: 12 }}>No looks yet.</div>

  const FEED_VIEWPORT_HEIGHT = `calc(100dvh - ${FOOTER_HEIGHT}px)`

  return (
    <>
      {/* Fixed shell: only feed scrolls */}
      <div
        style={{
          height: FEED_VIEWPORT_HEIGHT,
          width: '100%',
          overflow: 'hidden',
          position: 'relative',
          background: '#000',
        }}
      >
        {/* Feed scroll only */}
        <div
          ref={feedScrollRef}
          className="looksNoScrollbar"
          style={{
            height: '100%',
            overflowY: 'auto',
            scrollSnapType: 'y mandatory',
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
          }}
        >
          {items.map((m) => {
            const signal = BOOKING_SIGNALS[hashStringToIndex(m.id, BOOKING_SIGNALS.length)]
            const futureSelf = FUTURE_SELF_LINES[hashStringToIndex(m.id + '_future', FUTURE_SELF_LINES.length)]

            return (
              <article
                key={m.id}
                style={{
                  height: '100%',
                  scrollSnapAlign: 'start',
                  scrollSnapStop: 'always',
                  position: 'relative',
                  background: '#000',
                }}
                onDoubleClick={() => handleDoubleClickLikeOnly(m.id)}
                onTouchEnd={() => handleTouchEndLikeOnly(m.id)}
              >
                {/* Media */}
                {m.mediaType === 'IMAGE' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.url}
                    alt={m.caption || 'Look'}
                    draggable={false}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <video
                    src={m.url}
                    muted
                    loop
                    playsInline
                    controls
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                )}

                {/* Legibility gradient */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background:
                      'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.20) 40%, rgba(0,0,0,0) 70%)',
                    pointerEvents: 'none',
                  }}
                />

                {/* Caption + future-self framing */}
                {(m.caption || futureSelf) && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 12,
                      right: 84,
                      bottom: RIGHT_RAIL_BOTTOM,
                      color: '#fff',
                      zIndex: 2,
                      fontSize: 13,
                      lineHeight: 1.25,
                      pointerEvents: 'none',
                    }}
                  >
                    {m.caption ? (
                      <div
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          marginBottom: 6,
                        }}
                      >
                        {m.caption}
                      </div>
                    ) : null}

                    <div style={{ fontSize: 12, opacity: 0.85 }}>{futureSelf}</div>
                  </div>
                )}

                {/* Right rail */}
                <div
                  style={{
                    position: 'absolute',
                    right: 12,
                    bottom: RIGHT_RAIL_BOTTOM,
                    display: 'grid',
                    gap: 14,
                    color: '#fff',
                    textAlign: 'center',
                    zIndex: 3,
                    userSelect: 'none',
                  }}
                >
                  <button onClick={() => toggleLike(m.id)} style={{ all: 'unset', cursor: 'pointer' }} title="Like">
                    <div style={{ fontSize: 22 }}>{m.viewerLiked ? '❤️' : '🤍'}</div>
                    <div style={{ fontSize: 12 }}>{clamp(m._count.likes, 0, 999999)}</div>
                  </button>

                  <button
                    onClick={() => openCommentsDrawer(m.id)}
                    style={{ all: 'unset', cursor: 'pointer' }}
                    title="Comments"
                  >
                    <div style={{ fontSize: 22 }}>💬</div>
                    <div style={{ fontSize: 12 }}>{clamp(m._count.comments, 0, 999999)}</div>
                  </button>

                  {m.professional?.id ? (
                    <div style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
                      {/* micro-signal */}
                      <div
                        style={{
                          fontSize: 11,
                          opacity: 0.85,
                          background: 'rgba(255,255,255,0.12)',
                          border: '1px solid rgba(255,255,255,0.2)',
                          padding: '4px 8px',
                          borderRadius: 999,
                          backdropFilter: 'blur(10px)',
                          maxWidth: 130,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={signal}
                      >
                        {signal}
                      </div>

                      {/* CTA -> opens drawer */}
                      <button
                        type="button"
                        onClick={() => openAvailabilityFor(m)}
                        style={{
                          border: 'none',
                          background: '#fff',
                          color: '#000',
                          padding: '8px 10px',
                          borderRadius: 999,
                          fontWeight: 900,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        View availability
                      </button>

                      <div style={{ fontSize: 11, opacity: 0.8 }}>Takes 10 seconds</div>

                      {/* tiny debug-friendly hint while you’re building */}
                      {!m.serviceId ? (
                        <div style={{ fontSize: 10, opacity: 0.65 }}>Missing service link</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>

        {/* Overlay Header (tabs + search) */}
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            top: 0,
            padding: `10px 12px 8px`,
            paddingTop: `calc(env(safe-area-inset-top, 0px) + 10px)`,
            zIndex: 50,
            color: '#fff',
            fontFamily: 'system-ui',
            pointerEvents: 'none',
          }}
        >
          <div style={{ pointerEvents: 'auto', display: 'grid', gap: 10 }}>
            {/* Tabs */}
            <div className="looksNoScrollbar" style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 2 }}>
              {categories.map((c) => {
                const active = c === activeCategory
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onSelectCategory(c)}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      padding: '6px 10px',
                      borderRadius: 999,
                      background: active ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.25)',
                      border: '1px solid rgba(255,255,255,0.22)',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: active ? 900 : 600,
                      whiteSpace: 'nowrap',
                      backdropFilter: 'blur(10px)',
                    }}
                  >
                    {c}
                  </button>
                )
              })}
            </div>

            {/* Search */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                background: 'rgba(0,0,0,0.25)',
                border: '1px solid rgba(255,255,255,0.22)',
                borderRadius: 999,
                padding: '10px 12px',
                backdropFilter: 'blur(10px)',
              }}
            >
              <span style={{ fontSize: 14, opacity: 0.9 }}>⌕</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pros or services"
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: '#fff',
                  fontSize: 13,
                }}
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  style={{ all: 'unset', cursor: 'pointer', fontSize: 14, opacity: 0.9 }}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Availability Drawer */}
      <AvailabilityDrawer
        open={availabilityOpen}
        onClose={() => setAvailabilityOpen(false)}
        context={drawerCtx}
      />

      {/* Comments Drawer */}
      {openCommentsFor && (
        <div
          onClick={() => setOpenCommentsFor(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              background: '#fff',
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              padding: 12,
              maxHeight: '70dvh',
              display: 'grid',
              gridTemplateRows: 'auto 1fr auto',
              gap: 10,
              fontFamily: 'system-ui',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 900 }}>Comments</div>
              <button
                onClick={() => setOpenCommentsFor(null)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div className="looksNoScrollbar" style={{ overflowY: 'auto', paddingRight: 4 }}>
              {commentsLoading ? (
                <div style={{ color: '#6b7280' }}>Loading comments…</div>
              ) : commentError ? (
                <div style={{ color: '#ef4444' }}>{commentError}</div>
              ) : comments.length ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {comments.map((c) => (
                    <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 999,
                          background: '#eee',
                          overflow: 'hidden',
                          flex: '0 0 auto',
                        }}
                      >
                        {c.user.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.user.avatarUrl}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : null}
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 800 }}>{c.user.displayName}</div>
                        <div style={{ fontSize: 13, color: '#111', whiteSpace: 'pre-wrap' }}>{c.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#6b7280' }}>No comments yet.</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment…"
                style={{
                  flex: 1,
                  borderRadius: 999,
                  border: '1px solid #ddd',
                  padding: '10px 12px',
                  fontSize: 13,
                }}
              />
              <button
                onClick={postComment}
                disabled={posting || !commentText.trim()}
                style={{
                  borderRadius: 999,
                  border: 'none',
                  padding: '10px 14px',
                  fontWeight: 900,
                  background: '#111',
                  color: '#fff',
                  opacity: posting || !commentText.trim() ? 0.6 : 1,
                  cursor: posting || !commentText.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {posting ? '…' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scrollbar annihilation */}
      <style jsx global>{`
        .looksNoScrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .looksNoScrollbar::-webkit-scrollbar {
          display: none;
          width: 0;
          height: 0;
        }
      `}</style>
    </>
  )
}
