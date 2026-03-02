// app/(main)/looks/_components/LooksFeed.tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UI_SIZES } from '../../ui/layoutConstants'
import AvailabilityDrawer from '../../booking/AvailabilityDrawer'
import LooksTopBar from './LooksTopBar'
import LookSlide from './LookSlide'
import CommentsDrawer from './CommentsDrawer'
import RightActionRail from './RightActionRail'

import type { DrawerContext as AvailabilityDrawerContext } from '../../booking/AvailabilityDrawer/types'
import type { FeedItem, UiCategory, UiComment } from './lookTypes'

type LooksCategoriesResponse = {
  categories?: Array<Partial<UiCategory> | null>
}

type ViewerLocation = {
  label: string
  placeId: string | null
  lat: number
  lng: number
  radiusMiles: number
  updatedAtMs: number
}

const STORAGE_KEY = 'tovis.viewerLocation.v1'

const ALL_TAB: UiCategory = { name: 'The Looks', slug: 'all' }

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function pickString(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.trim() : null
}

function pickNumber(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(n)
  return Math.min(Math.max(x, min), max)
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

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

function parseCategories(raw: unknown): UiCategory[] {
  if (!isRecord(raw)) return [ALL_TAB]
  const arr = raw.categories
  if (!Array.isArray(arr)) return [ALL_TAB]

  const normalized: UiCategory[] = arr
    .filter((c): c is Partial<UiCategory> => Boolean(c && typeof c === 'object'))
    .map((c) => ({
      name: typeof c.name === 'string' ? c.name.trim() : '',
      slug: typeof c.slug === 'string' ? c.slug.trim() : '',
    }))
    .filter((c) => c.name.length > 0 && c.slug.length > 0)
    .filter((c) => c.name.toLowerCase() !== 'for you' && c.slug.toLowerCase() !== 'for-you')

  const map = new Map<string, UiCategory>()
  for (const c of normalized) map.set(c.slug, c)

  return [ALL_TAB, ...Array.from(map.values())]
}

/**
 * NOTE:
 * The /api/looks contract is internal and already matches FeedItem.
 * We keep runtime validation minimal and avoid `any`.
 * This is a *local, justified* assertion at a module boundary.
 */
function parseFeedItems(raw: unknown): FeedItem[] {
  if (!isRecord(raw)) return []
  const items = raw.items
  if (!Array.isArray(items)) return []
  return items as unknown as FeedItem[]
}

function parseComments(raw: unknown): UiComment[] {
  if (!isRecord(raw)) return []
  const comments = raw.comments
  if (!Array.isArray(comments)) return []
  return comments as unknown as UiComment[]
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

const FUTURE_SELF_LINES = ['Wake up ready.', 'Low-maintenance glow.', 'Future-you called. Do it.', 'Main-character upgrade.'] as const

const FOOTER_HEIGHT = UI_SIZES.footerHeight
const RIGHT_RAIL_BOTTOM = UI_SIZES.footerHeight + UI_SIZES.rightRailBottomOffset

function loadViewerLocation(): ViewerLocation | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null

    const label = pickString(parsed.label)
    const lat = pickNumber(parsed.lat)
    const lng = pickNumber(parsed.lng)
    const radiusMiles = pickNumber(parsed.radiusMiles)
    const updatedAtMs = pickNumber(parsed.updatedAtMs)
    const placeId = parsed.placeId == null ? null : pickString(parsed.placeId)

    if (!label || lat == null || lng == null || radiusMiles == null || updatedAtMs == null) return null

    return {
      label,
      lat,
      lng,
      radiusMiles: clampInt(radiusMiles, 5, 50),
      updatedAtMs,
      placeId: placeId ?? null,
    }
  } catch {
    return null
  }
}

function getNavigatorShare() {
  if (typeof navigator === 'undefined') return null
  const n: unknown = navigator
  if (!isRecord(n)) return null
  const share = n.share
  return typeof share === 'function' ? (share as (data: ShareData) => Promise<void>) : null
}

export default function LooksFeed() {
  const router = useRouter()

  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [feedError, setFeedError] = useState<string | null>(null)

  // categories
  const [cats, setCats] = useState<UiCategory[]>([ALL_TAB])
  const [activeCategorySlug, setActiveCategorySlug] = useState<string>(ALL_TAB.slug)

  // top bar props (strings only)
  const categoriesForTopBar = useMemo(() => cats.map((c) => c.name), [cats])
  const activeCategoryName = useMemo(
    () => cats.find((c) => c.slug === activeCategorySlug)?.name ?? ALL_TAB.name,
    [cats, activeCategorySlug],
  )

  // search
  const [query, setQuery] = useState('')

  // comments
  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null)
  const [comments, setComments] = useState<UiComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)

  // likes + double tap tracking
  const likeInFlight = useRef<Record<string, boolean>>({})
  const lastTapRef = useRef<Record<string, number>>({})

  // feed viewport
  const feedScrollRef = useRef<HTMLDivElement | null>(null)

  // availability drawer
  const [availabilityOpen, setAvailabilityOpen] = useState(false)
  const [drawerCtx, setDrawerCtx] = useState<AvailabilityDrawerContext | null>(null)

  // active slide index (for future autoplay)
  const [activeIndex, setActiveIndex] = useState(0)

  // viewer location (from SearchClient persistence)
  const [viewerLoc, setViewerLoc] = useState<ViewerLocation | null>(null)

  useEffect(() => {
    setViewerLoc(loadViewerLocation())

    const onEvt = (e: Event) => {
      const ce = e as CustomEvent<unknown>
      const d = ce.detail
      if (d == null) {
        setViewerLoc(null)
        return
      }
      if (!isRecord(d)) return
      const label = pickString(d.label)
      const lat = pickNumber(d.lat)
      const lng = pickNumber(d.lng)
      const radiusMiles = pickNumber(d.radiusMiles)
      const updatedAtMs = pickNumber(d.updatedAtMs)
      const placeId = d.placeId == null ? null : pickString(d.placeId)

      if (!label || lat == null || lng == null || radiusMiles == null || updatedAtMs == null) return
      setViewerLoc({
        label,
        lat,
        lng,
        radiusMiles: clampInt(radiusMiles, 5, 50),
        updatedAtMs,
        placeId: placeId ?? null,
      })
    }

    window.addEventListener('tovis:viewerLocation', onEvt as EventListener)
    return () => window.removeEventListener('tovis:viewerLocation', onEvt as EventListener)
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
      const res = await fetch('/api/looks/categories', { cache: 'no-store', headers: { Accept: 'application/json' } })
      const raw = await safeJson(res)
      if (!res.ok) throw new Error(isRecord(raw) ? pickString(raw.error) ?? 'Failed to load categories' : 'Failed to load categories')

      const next = parseCategories(raw)
      setCats(next)
      setActiveCategorySlug((cur) => (next.some((x) => x.slug === cur) ? cur : ALL_TAB.slug))
    } catch {
      setCats([ALL_TAB])
      setActiveCategorySlug(ALL_TAB.slug)
    }
  }, [])

  const loadFeed = useCallback(async () => {
    setLoading(true)
    setFeedError(null)

    try {
      const qs = new URLSearchParams()
      qs.set('limit', '24')
      if (activeCategorySlug && activeCategorySlug !== ALL_TAB.slug) qs.set('category', activeCategorySlug)
      if (query.trim()) qs.set('q', query.trim())

      const res = await fetch(`/api/looks?${qs.toString()}`, { cache: 'no-store', headers: { Accept: 'application/json' } })
      const raw = await safeJson(res)

      if (!res.ok) throw new Error(isRecord(raw) ? pickString(raw.error) ?? 'Failed to load looks' : 'Failed to load looks')

      setItems(parseFeedItems(raw))
    } catch (e: unknown) {
      setFeedError(e instanceof Error ? e.message : 'Failed to load looks')
      setItems([])
    } finally {
      setLoading(false)
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

  // IntersectionObserver: active slide
  useEffect(() => {
    const el = feedScrollRef.current
    if (!el) return
    const slides = Array.from(el.querySelectorAll('[data-look-slide="1"]')) as HTMLElement[]
    if (!slides.length) return

    const io = new IntersectionObserver(
      (entries) => {
        let best: { idx: number; ratio: number } | null = null
        for (const ent of entries) {
          const idx = Number((ent.target as HTMLElement).dataset.index || '0')
          const ratio = ent.intersectionRatio || 0
          if (!best || ratio > best.ratio) best = { idx, ratio }
        }
        if (best && best.ratio >= 0.6) setActiveIndex(best.idx)
      },
      { root: el, threshold: [0.35, 0.6, 0.8, 1] },
    )

    slides.forEach((s) => io.observe(s))
    return () => io.disconnect()
  }, [items.length])

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
        const res = await fetch(`/api/looks/${mediaId}/like`, { method: beforeLiked ? 'DELETE' : 'POST' })
        const raw = await safeJson(res)

        if (isGuestBlocked(res.status)) {
          setItems((prev) =>
            prev.map((m) =>
              m.id === mediaId ? { ...m, viewerLiked: beforeLiked, _count: { ...m._count, likes: beforeCount } } : m,
            ),
          )
          redirectToLogin('like')
          return
        }

        if (!res.ok) {
          setItems((prev) =>
            prev.map((m) =>
              m.id === mediaId ? { ...m, viewerLiked: beforeLiked, _count: { ...m._count, likes: beforeCount } } : m,
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
            : isRecord(raw) && typeof raw.likes === 'number'
              ? raw.likes
              : isRecord(raw) && isRecord(raw._count) && typeof raw._count.likes === 'number'
                ? raw._count.likes
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

  const likeOnly = useCallback(
    (mediaId: string) => {
      const item = items.find((x) => x.id === mediaId)
      if (!item || item.viewerLiked) return
      toggleLike(mediaId)
    },
    [items, toggleLike],
  )

  const handleDoubleClickLikeOnly = useCallback((mediaId: string) => likeOnly(mediaId), [likeOnly])

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
      const res = await fetch(`/api/looks/${mediaId}/comments`, { cache: 'no-store', headers: { Accept: 'application/json' } })
      const raw = await safeJson(res)

      if (isGuestBlocked(res.status)) {
        setOpenCommentsFor(null)
        redirectToLogin('comment')
        return
      }

      if (!res.ok) throw new Error(isRecord(raw) ? pickString(raw.error) ?? 'Failed to load comments' : 'Failed to load comments')
      setComments(parseComments(raw))
    } catch (e: unknown) {
      setCommentError(e instanceof Error ? e.message : 'Failed to load comments')
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

    setComments((prev) => [optimistic, ...prev])
    setCommentText('')
    setItems((prev) =>
      prev.map((m) => (m.id === mediaId ? { ...m, _count: { ...m._count, comments: m._count.comments + 1 } } : m)),
    )

    try {
      const res = await fetch(`/api/looks/${mediaId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ body }),
      })

      const raw = await safeJson(res)

      if (isGuestBlocked(res.status)) {
        setComments((prev) => prev.filter((c) => c.id !== tempId))
        setItems((prev) =>
          prev.map((m) =>
            m.id === mediaId
              ? { ...m, _count: { ...m._count, comments: Math.max(0, m._count.comments - 1) } }
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
            m.id === mediaId
              ? { ...m, _count: { ...m._count, comments: Math.max(0, m._count.comments - 1) } }
              : m,
          ),
        )
        const msg = isRecord(raw) ? pickString(raw.error) : null
        setCommentError(msg ?? 'Failed to post comment')
        return
      }

      await openCommentsDrawer(mediaId)
    } catch (e: unknown) {
      setComments((prev) => prev.filter((c) => c.id !== tempId))
      setItems((prev) =>
        prev.map((m) =>
          m.id === mediaId
            ? { ...m, _count: { ...m._count, comments: Math.max(0, m._count.comments - 1) } }
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
    // let drawer animate closed before clearing context
    window.setTimeout(() => setDrawerCtx(null), 150)
  }, [])

  function readViewerLocFromStorage():
  | { lat: number; lng: number; radiusMiles: number | null; placeId: string | null }
  | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem('tovis.viewerLocation')
    if (!raw) return null
    const j = JSON.parse(raw) as { lat?: unknown; lng?: unknown; radiusMiles?: unknown; placeId?: unknown }
    const lat = typeof j.lat === 'number' && Number.isFinite(j.lat) ? j.lat : null
    const lng = typeof j.lng === 'number' && Number.isFinite(j.lng) ? j.lng : null
    if (lat == null || lng == null) return null
    const radiusMiles = typeof j.radiusMiles === 'number' && Number.isFinite(j.radiusMiles) ? j.radiusMiles : null
    const placeId = typeof j.placeId === 'string' && j.placeId.trim() ? j.placeId.trim() : null
    return { lat, lng, radiusMiles, placeId }
  } catch {
    return null
  }
}

function openAvailabilityFor(item: FeedItem) {
  if (!item.professional?.id) return

  const viewer = readViewerLocFromStorage()

  const ctx: AvailabilityDrawerContext = {
    mediaId: item.id,
    professionalId: item.professional.id,
    serviceId: item.serviceId ?? null,
    source: 'DISCOVERY',

    ...(viewer
      ? {
          viewerLat: viewer.lat,
          viewerLng: viewer.lng,
          viewerRadiusMiles: viewer.radiusMiles,
          viewerPlaceId: viewer.placeId,
        }
      : {}),
  }

  setDrawerCtx(ctx)
  setAvailabilityOpen(true)
}

  const shareLook = useCallback(async (item: FeedItem) => {
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}/looks?m=${encodeURIComponent(item.id)}`

    try {
      const share = getNavigatorShare()
      if (share) {
        await share({
          title: 'TOVIS Look',
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
  }, [])

  // Branding copy
  if (loading) return <div className="p-3 text-textSecondary">Loading Looks…</div>
  if (feedError) return <div className="p-3 text-toneDanger">{feedError}</div>
  if (!items.length) return <div className="p-3 text-textSecondary">No Looks yet. This is where the glow-ups will live.</div>

  const FEED_VIEWPORT_HEIGHT = `calc(100dvh - ${FOOTER_HEIGHT}px)`

  return (
    <>
      <div
        className="bg-bgPrimary"
        style={{ height: FEED_VIEWPORT_HEIGHT, width: '100%', overflow: 'hidden', position: 'relative' }}
      >
        <LooksTopBar
          categories={categoriesForTopBar}
          activeCategory={activeCategoryName}
          onSelectCategory={onSelectCategory}
          query={query}
          setQuery={setQuery}
        />

        <div
          ref={feedScrollRef}
          className="looksNoScrollbar h-full overflow-y-auto overscroll-contain"
          style={{ scrollSnapType: 'y mandatory', WebkitOverflowScrolling: 'touch' }}
        >
          {items.map((m, idx) => {
            const signal = BOOKING_SIGNALS[hashStringToIndex(m.id, BOOKING_SIGNALS.length)]
            const futureSelf = FUTURE_SELF_LINES[hashStringToIndex(m.id + '_future', FUTURE_SELF_LINES.length)]
            const isActive = idx === activeIndex

            const rightRail = (
              <RightActionRail
                pro={
                  m.professional
                    ? { id: m.professional.id, businessName: m.professional.businessName, avatarUrl: m.professional.avatarUrl ?? null }
                    : null
                }
                viewerLiked={m.viewerLiked}
                likeCount={m._count.likes}
                commentCount={m._count.comments}
                bottom={RIGHT_RAIL_BOTTOM}
                onOpenAvailability={() => openAvailabilityFor(m)}
                onToggleLike={() => toggleLike(m.id)}
                onOpenComments={() => openCommentsDrawer(m.id)}
                onShare={() => shareLook(m)}
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
                onToggleLike={() => toggleLike(m.id)}
                onOpenComments={() => openCommentsDrawer(m.id)}
                onOpenAvailability={() => openAvailabilityFor(m)}
              />
            )
          })}
        </div>
      </div>

      {drawerCtx ? <AvailabilityDrawer open={availabilityOpen} onClose={closeAvailability} context={drawerCtx} /> : null}

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