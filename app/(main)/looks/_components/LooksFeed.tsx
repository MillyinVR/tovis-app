// app/(main)/looks/_components/LooksFeed.tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useBrand } from '@/lib/brand/BrandProvider'
import { UI_SIZES } from '../../ui/layoutConstants'
import AvailabilityDrawer from '../../booking/AvailabilityDrawer'
import LooksTopBar from './LooksTopBar'
import LookSlide from './LookSlide'
import CommentsDrawer from './CommentsDrawer'
import RightActionRail from './RightActionRail'
import { safeJson } from '@/lib/http'
import {
  parseLooksCommentsResponse,
  parseLooksFeedEnvelope,
} from '@/lib/looks/mappers'
import type { DrawerContext as AvailabilityDrawerContext } from '../../booking/AvailabilityDrawer/types'
import type { FeedItem, UiCategory, UiComment } from './lookTypes'
import {
  loadViewerLocation,
  subscribeViewerLocation,
  viewerLocationToDrawerContextFields,
  type ViewerLocation,
} from '@/lib/viewerLocation'

const ALL_TAB: UiCategory = { name: 'The Looks', slug: 'all' }
const SPOTLIGHT_TAB: UiCategory = { name: 'Spotlight', slug: 'spotlight' }

const FEED_LIMIT = 24
const FEED_CACHE_TTL_MS = 15_000
const UPDATING_DELAY_MS = 250

type FeedCacheEntry = { items: FeedItem[]; expiresAt: number }

function withSpotlight(cats: UiCategory[]) {
  if (cats.some((c) => c.slug === SPOTLIGHT_TAB.slug)) return cats
  const next = [...cats]
  next.splice(1, 0, SPOTLIGHT_TAB)
  return next
}

function makeFeedKey(args: { slug: string; q: string; limit: number }) {
  const q = args.q.trim().toLowerCase()
  return `${args.slug}|${q}|${args.limit}`
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function pickString(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.trim() : null
}

function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/looks'
  return window.location.pathname + window.location.search + window.location.hash
}

function sanitizeFrom(from: string) {
  const trimmed = from.trim()
  if (!trimmed) return '/looks'
  if (!trimmed.startsWith('/')) return '/looks'
  if (trimmed.startsWith('//')) return '/looks'
  return trimmed
}

function parseCategories(raw: unknown): UiCategory[] {
  if (!isRecord(raw)) return withSpotlight([ALL_TAB])
  const arr = raw.categories
  if (!Array.isArray(arr)) return withSpotlight([ALL_TAB])

  const normalized: UiCategory[] = arr
    .filter((c): c is Partial<UiCategory> => Boolean(c && typeof c === 'object'))
    .map((c) => ({
      name: typeof c.name === 'string' ? c.name.trim() : '',
      slug: typeof c.slug === 'string' ? c.slug.trim() : '',
    }))
    .filter((c) => c.name.length > 0 && c.slug.length > 0)
    .filter(
      (c) =>
        c.name.toLowerCase() !== 'for you' &&
        c.slug.toLowerCase() !== 'for-you',
    )

  const map = new Map<string, UiCategory>()
  for (const c of normalized) map.set(c.slug, c)

  return withSpotlight([ALL_TAB, ...Array.from(map.values())])
}

function parseFeedItems(raw: unknown): FeedItem[] {
  return parseLooksFeedEnvelope(raw).items
}

function parseComments(raw: unknown): UiComment[] {
  return parseLooksCommentsResponse(raw)
}

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
const RIGHT_RAIL_BOTTOM = UI_SIZES.footerHeight + UI_SIZES.rightRailBottomOffset

function getNavigatorShare() {
  if (typeof navigator === 'undefined') return null
  const n: unknown = navigator
  if (!isRecord(n)) return null
  const share = n.share
  return typeof share === 'function'
    ? (share as (data: ShareData) => Promise<void>)
    : null
}

function buildAvailabilityDrawerContext(
  item: FeedItem,
  viewerLoc: ViewerLocation | null,
): AvailabilityDrawerContext | null {
  if (!item.professional?.id) return null

  // Feed items are canonically keyed by lookPostId now.
  // AvailabilityDrawer still carries a legacy `mediaId` field downstream,
  // so do not pass the post id through that slot.
  return {
    mediaId: null,
    professionalId: item.professional.id,
    serviceId: item.serviceId ?? null,
    source: 'DISCOVERY',
    ...viewerLocationToDrawerContextFields(viewerLoc),
  }
}

export default function LooksFeed() {
  const router = useRouter()
  const { brand } = useBrand()

  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [feedError, setFeedError] = useState<string | null>(null)

  const [cats, setCats] = useState<UiCategory[]>(withSpotlight([ALL_TAB]))
  const [activeCategorySlug, setActiveCategorySlug] = useState<string>(
    ALL_TAB.slug,
  )

  const categoriesForTopBar = useMemo(() => cats.map((c) => c.name), [cats])
  const activeCategoryName = useMemo(
    () => cats.find((c) => c.slug === activeCategorySlug)?.name ?? ALL_TAB.name,
    [cats, activeCategorySlug],
  )

  const [query, setQuery] = useState('')

  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null)
  const [comments, setComments] = useState<UiComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)

  const hasLoadedOnceRef = useRef(false)
  const feedCacheRef = useRef(new Map<string, FeedCacheEntry>())
  const abortRef = useRef<AbortController | null>(null)
  const updatingTimerRef = useRef<number | null>(null)

  const likeInFlight = useRef<Record<string, boolean>>({})
  const lastTapRef = useRef<Record<string, number>>({})
  const feedScrollRef = useRef<HTMLDivElement | null>(null)

  const [availabilityOpen, setAvailabilityOpen] = useState(false)
  const [drawerCtx, setDrawerCtx] = useState<AvailabilityDrawerContext | null>(
    null,
  )
  const [activeIndex, setActiveIndex] = useState(0)

  const [viewerLoc, setViewerLoc] = useState<ViewerLocation | null>(null)

  useEffect(() => {
    setViewerLoc(loadViewerLocation())
    return subscribeViewerLocation(setViewerLoc)
  }, [])

  const redirectToLogin = useCallback(
    (reason: string) => {
      const from = sanitizeFrom(currentPathWithQuery())
      const qs = new URLSearchParams({ from, reason })
      router.push(`/login?${qs.toString()}`)
    },
    [router],
  )

  function isGuestBlocked(status: number) {
    return status === 401
  }

  const snapToIndex = useCallback((index: number) => {
    const el = feedScrollRef.current
    if (!el) return
    const itemHeight = el.clientHeight
    el.scrollTo({ top: index * itemHeight, behavior: 'smooth' })
  }, [])

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/looks/categories', {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      const raw = await safeJson(res)

      if (!res.ok) {
        throw new Error(
          isRecord(raw)
            ? pickString(raw.error) ?? 'Failed to load categories'
            : 'Failed to load categories',
        )
      }

      const next = parseCategories(raw)
      setCats(next)
      setActiveCategorySlug((cur) =>
        next.some((x) => x.slug === cur) ? cur : ALL_TAB.slug,
      )
    } catch {
      const next = withSpotlight([ALL_TAB])
      setCats(next)
      setActiveCategorySlug((cur) =>
        next.some((x) => x.slug === cur) ? cur : ALL_TAB.slug,
      )
    }
  }, [])

  const loadFeed = useCallback(async () => {
    const key = makeFeedKey({
      slug: activeCategorySlug,
      q: query,
      limit: FEED_LIMIT,
    })
    const now = Date.now()

    const cached = feedCacheRef.current.get(key)
    const cachedFresh = Boolean(cached && cached.expiresAt > now)

    if (cachedFresh && cached) {
      setItems(cached.items)
      setFeedError(null)
      setLoading(false)
      setRefreshing(false)
      hasLoadedOnceRef.current = true
    }

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    if (updatingTimerRef.current) window.clearTimeout(updatingTimerRef.current)
    if (hasLoadedOnceRef.current && !cachedFresh) {
      updatingTimerRef.current = window.setTimeout(
        () => setRefreshing(true),
        UPDATING_DELAY_MS,
      )
    } else {
      setRefreshing(false)
    }

    if (!hasLoadedOnceRef.current && !cachedFresh) {
      setLoading(true)
    }

    setFeedError(null)

    try {
      const qs = new URLSearchParams()
      qs.set('limit', String(FEED_LIMIT))

      if (activeCategorySlug && activeCategorySlug !== ALL_TAB.slug) {
        qs.set('category', activeCategorySlug)
      }

      if (query.trim()) {
        qs.set('q', query.trim())
      }

      const res = await fetch(`/api/looks?${qs.toString()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: ac.signal,
      })

      const raw = await safeJson(res)
      if (ac.signal.aborted) return

      if (!res.ok) {
        throw new Error(
          isRecord(raw)
            ? pickString(raw.error) ?? 'Failed to load looks'
            : 'Failed to load looks',
        )
      }

      const nextItems = parseFeedItems(raw)

      setItems(nextItems)
      feedCacheRef.current.set(key, {
        items: nextItems,
        expiresAt: Date.now() + FEED_CACHE_TTL_MS,
      })
      hasLoadedOnceRef.current = true
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      if (ac.signal.aborted) return

      setFeedError(e instanceof Error ? e.message : 'Failed to load looks')
    } finally {
      if (updatingTimerRef.current) {
        window.clearTimeout(updatingTimerRef.current)
      }
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeCategorySlug, query])

  useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  useEffect(() => {
    void loadFeed()
  }, [loadFeed])

  function onSelectCategory(categoryName: string) {
    const found = cats.find((c) => c.name === categoryName)
    setActiveCategorySlug(found?.slug ?? ALL_TAB.slug)
    snapToIndex(0)
  }

  useEffect(() => {
    const el = feedScrollRef.current
    if (!el) return

    const slides = Array.from(
      el.querySelectorAll('[data-look-slide="1"]'),
    ) as HTMLElement[]

    if (!slides.length) return

    const io = new IntersectionObserver(
      (entries) => {
        let best: { idx: number; ratio: number } | null = null

        for (const ent of entries) {
          const idx = Number((ent.target as HTMLElement).dataset.index || '0')
          const ratio = ent.intersectionRatio || 0
          if (!best || ratio > best.ratio) best = { idx, ratio }
        }

        if (best && best.ratio >= 0.6) {
          setActiveIndex(best.idx)
        }
      },
      { root: el, threshold: [0.35, 0.6, 0.8, 1] },
    )

    slides.forEach((s) => io.observe(s))
    return () => io.disconnect()
  }, [items.length])

  const toggleLike = useCallback(
    async (lookPostId: string) => {
      if (likeInFlight.current[lookPostId]) return
      likeInFlight.current[lookPostId] = true

      let beforeLiked = false
      let beforeCount = 0

      setItems((prev) => {
        const cur = prev.find((x) => x.id === lookPostId)
        beforeLiked = !!cur?.viewerLiked
        beforeCount = cur?._count.likes ?? 0

        return prev.map((m) => {
          if (m.id !== lookPostId) return m
          const nextLiked = !m.viewerLiked
          const nextCount = Math.max(0, m._count.likes + (nextLiked ? 1 : -1))

          return {
            ...m,
            viewerLiked: nextLiked,
            _count: { ...m._count, likes: nextCount },
          }
        })
      })

      try {
        const res = await fetch(`/api/looks/${lookPostId}/like`, {
          method: beforeLiked ? 'DELETE' : 'POST',
        })
        const raw = await safeJson(res)

        if (isGuestBlocked(res.status)) {
          setItems((prev) =>
            prev.map((m) =>
              m.id === lookPostId
                ? {
                    ...m,
                    viewerLiked: beforeLiked,
                    _count: { ...m._count, likes: beforeCount },
                  }
                : m,
            ),
          )
          redirectToLogin('like')
          return
        }

        if (!res.ok) {
          setItems((prev) =>
            prev.map((m) =>
              m.id === lookPostId
                ? {
                    ...m,
                    viewerLiked: beforeLiked,
                    _count: { ...m._count, likes: beforeCount },
                  }
                : m,
            ),
          )
          return
        }

        const serverLiked =
          isRecord(raw) && typeof raw.liked === 'boolean'
            ? raw.liked
            : !beforeLiked

        const serverCount =
          isRecord(raw) && typeof raw.likeCount === 'number'
            ? raw.likeCount
            : isRecord(raw) &&
                isRecord(raw._count) &&
                typeof raw._count.likes === 'number'
              ? raw._count.likes
              : undefined

        setItems((prev) =>
          prev.map((m) =>
            m.id === lookPostId
              ? {
                  ...m,
                  viewerLiked: serverLiked,
                  _count: {
                    ...m._count,
                    likes:
                      typeof serverCount === 'number'
                        ? serverCount
                        : m._count.likes,
                  },
                }
              : m,
          ),
        )
      } finally {
        likeInFlight.current[lookPostId] = false
      }
    },
    [redirectToLogin],
  )

  const likeOnly = useCallback(
    (lookPostId: string) => {
      const item = items.find((x) => x.id === lookPostId)
      if (!item || item.viewerLiked) return
      void toggleLike(lookPostId)
    },
    [items, toggleLike],
  )

  const handleDoubleClickLikeOnly = useCallback(
    (lookPostId: string) => likeOnly(lookPostId),
    [likeOnly],
  )

  const handleTouchEndLikeOnly = useCallback(
    (lookPostId: string) => {
      const now = Date.now()
      const last = lastTapRef.current[lookPostId] ?? 0
      lastTapRef.current[lookPostId] = now
      if (now - last < 280) likeOnly(lookPostId)
    },
    [likeOnly],
  )

  async function openCommentsDrawer(lookPostId: string) {
    setOpenCommentsFor(lookPostId)
    setComments([])
    setCommentText('')
    setCommentError(null)
    setCommentsLoading(true)

    try {
      const res = await fetch(`/api/looks/${lookPostId}/comments`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      const raw = await safeJson(res)

      if (isGuestBlocked(res.status)) {
        setOpenCommentsFor(null)
        redirectToLogin('comment')
        return
      }

      if (!res.ok) {
        throw new Error(
          isRecord(raw)
            ? pickString(raw.error) ?? 'Failed to load comments'
            : 'Failed to load comments',
        )
      }

      setComments(parseComments(raw))
    } catch (e: unknown) {
      setCommentError(
        e instanceof Error ? e.message : 'Failed to load comments',
      )
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

    const lookPostId = openCommentsFor
    const tempId = `temp_${Date.now()}`

    const optimistic: UiComment = {
      id: tempId,
      body,
      createdAt: new Date().toISOString(),
      user: { id: 'me', displayName: 'You', avatarUrl: null },
    }

    setComments((prev) => [optimistic, ...prev])
    setCommentText('')
    setItems((prev) =>
      prev.map((m) =>
        m.id === lookPostId
          ? {
              ...m,
              _count: { ...m._count, comments: m._count.comments + 1 },
            }
          : m,
      ),
    )

    try {
      const res = await fetch(`/api/looks/${lookPostId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ body }),
      })

      const raw = await safeJson(res)

      if (isGuestBlocked(res.status)) {
        setComments((prev) => prev.filter((c) => c.id !== tempId))
        setItems((prev) =>
          prev.map((m) =>
            m.id === lookPostId
              ? {
                  ...m,
                  _count: {
                    ...m._count,
                    comments: Math.max(0, m._count.comments - 1),
                  },
                }
              : m,
          ),
        )
        redirectToLogin('comment')
        return
      }

      if (!res.ok) {
        setComments((prev) => prev.filter((c) => c.id !== tempId))
        setItems((prev) =>
          prev.map((m) =>
            m.id === lookPostId
              ? {
                  ...m,
                  _count: {
                    ...m._count,
                    comments: Math.max(0, m._count.comments - 1),
                  },
                }
              : m,
          ),
        )

        const msg = isRecord(raw) ? pickString(raw.error) : null
        setCommentError(msg ?? 'Failed to post comment')
        return
      }

      await openCommentsDrawer(lookPostId)
    } catch (e: unknown) {
      setComments((prev) => prev.filter((c) => c.id !== tempId))
      setItems((prev) =>
        prev.map((m) =>
          m.id === lookPostId
            ? {
                ...m,
                _count: {
                  ...m._count,
                  comments: Math.max(0, m._count.comments - 1),
                },
              }
            : m,
        ),
      )
      setCommentError(e instanceof Error ? e.message : 'Failed to post comment')
    } finally {
      setPosting(false)
    }
  }

  const closeAvailability = useCallback(() => {
    setAvailabilityOpen(false)
    window.setTimeout(() => setDrawerCtx(null), 150)
  }, [])

  const openAvailabilityFor = useCallback(
    (item: FeedItem) => {
      const ctx = buildAvailabilityDrawerContext(item, viewerLoc)
      if (!ctx) return

      setDrawerCtx(ctx)
      setAvailabilityOpen(true)
    },
    [viewerLoc],
  )

  const shareLook = useCallback(
    async (item: FeedItem) => {
      if (typeof window === 'undefined') return

      const lookPostId = item.id
      const url = `${window.location.origin}/looks?m=${encodeURIComponent(lookPostId)}`

      try {
        const share = getNavigatorShare()
        if (share) {
          await share({
            title: `${brand.displayName} Look`,
            text: item.caption ? item.caption.slice(0, 120) : undefined,
            url,
          })
          return
        }

        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url)
          return
        }

        window.prompt('Copy this link:', url)
      } catch {
        // ignore
      }
    },
    [brand.displayName],
  )

  const FEED_VIEWPORT_HEIGHT = `calc(100dvh - ${FOOTER_HEIGHT}px)`

  return (
    <>
      <div
        className="bg-bgPrimary"
        style={{
          height: FEED_VIEWPORT_HEIGHT,
          width: '100%',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <LooksTopBar
          categories={categoriesForTopBar}
          activeCategory={activeCategoryName}
          onSelectCategory={onSelectCategory}
          query={query}
          setQuery={setQuery}
        />

        <div style={{ height: '100%', position: 'relative' }}>
          <div
            ref={feedScrollRef}
            className="looksNoScrollbar h-full overflow-y-auto overscroll-contain"
            style={{
              scrollSnapType: 'y mandatory',
              WebkitOverflowScrolling: 'touch',
              transition: 'opacity 120ms ease',
              opacity: refreshing ? 0.92 : 1,
            }}
          >
            {loading && !items.length ? (
              <div className="p-3 text-textSecondary">Loading Looks…</div>
            ) : !items.length ? (
              <div className="p-3 text-textSecondary">
                No Looks yet. This is where the glow-ups will live.
              </div>
            ) : (
              items.map((m, idx) => {
                const signal =
                  BOOKING_SIGNALS[hashStringToIndex(m.id, BOOKING_SIGNALS.length)]
                const futureSelf =
                  FUTURE_SELF_LINES[
                    hashStringToIndex(m.id + '_future', FUTURE_SELF_LINES.length)
                  ]
                const isActive = idx === activeIndex

                const rightRail = (
                  <RightActionRail
                    pro={
                      m.professional
                        ? {
                            id: m.professional.id,
                            businessName: m.professional.businessName,
                            avatarUrl: m.professional.avatarUrl ?? null,
                          }
                        : null
                    }
                    viewerLiked={m.viewerLiked}
                    likeCount={m._count.likes}
                    commentCount={m._count.comments}
                    bottom={RIGHT_RAIL_BOTTOM}
                    onOpenAvailability={() => openAvailabilityFor(m)}
                    onToggleLike={() => void toggleLike(m.id)}
                    onOpenComments={() => void openCommentsDrawer(m.id)}
                    onShare={() => void shareLook(m)}
                  />
                )

                return (
                  <LookSlide
                    key={m.id}
                    index={idx}
                    item={m}
                    isActive={isActive}
                    rightRailBottom={RIGHT_RAIL_BOTTOM}
                    signal={signal}
                    futureSelf={futureSelf}
                    rightRail={rightRail}
                    onDoubleClickLike={() => handleDoubleClickLikeOnly(m.id)}
                    onTouchEndLike={() => handleTouchEndLikeOnly(m.id)}
                    onToggleLike={() => void toggleLike(m.id)}
                    onOpenComments={() => void openCommentsDrawer(m.id)}
                    onOpenAvailability={() => openAvailabilityFor(m)}
                  />
                )
              })
            )}
          </div>

          {feedError ? (
            <div
              className="p-3 text-toneDanger"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 70,
                pointerEvents: 'none',
              }}
            >
              {feedError}
            </div>
          ) : null}

          {refreshing ? (
            <div
              className="text-xs font-semibold text-textSecondary"
              style={{
                position: 'absolute',
                right: 12,
                top: 72,
                background: 'rgba(0,0,0,0.28)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 999,
                padding: '6px 10px',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                pointerEvents: 'none',
              }}
            >
              Updating…
            </div>
          ) : null}
        </div>
      </div>

      {drawerCtx ? (
        <AvailabilityDrawer
          open={availabilityOpen}
          onClose={closeAvailability}
          context={drawerCtx}
        />
      ) : null}

      <CommentsDrawer
        open={Boolean(openCommentsFor)}
        onClose={() => setOpenCommentsFor(null)}
        loading={commentsLoading}
        error={commentError}
        comments={comments}
        commentText={commentText}
        setCommentText={setCommentText}
        posting={posting}
        onPost={postComment}
      />
    </>
  )
}