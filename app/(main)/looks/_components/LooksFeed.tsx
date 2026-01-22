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

const ALL_TAB: UiCategory = { name: 'The Looks', slug: 'all' }

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

const FUTURE_SELF_LINES = ['Wake up ready.', 'Low-maintenance glow.', 'Future-you called. Do it.', 'Main-character upgrade.'] as const

const FOOTER_HEIGHT = UI_SIZES.footerHeight
const RIGHT_RAIL_BOTTOM = UI_SIZES.footerHeight + UI_SIZES.rightRailBottomOffset

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
      const res = await fetch('/api/looks/categories', { cache: 'no-store' })
      const raw = (await safeJson(res)) as LooksCategoriesResponse

      const fromServer = Array.isArray(raw?.categories) ? raw.categories : []

      const normalized: UiCategory[] = fromServer
        .filter((c): c is Partial<UiCategory> => Boolean(c))
        .map((c) => ({
          name: typeof c.name === 'string' ? c.name.trim() : '',
          slug: typeof c.slug === 'string' ? c.slug.trim() : '',
        }))
        .filter((c) => c.name.length > 0 && c.slug.length > 0)
        .filter((c) => c.name.toLowerCase() !== 'for you' && c.slug.toLowerCase() !== 'for-you')

      // de-dupe by slug
      const map = new Map<string, UiCategory>()
      for (const c of normalized) map.set(c.slug, c)

      const next: UiCategory[] = [ALL_TAB, ...Array.from(map.values())]
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

      // ✅ IMPORTANT: send category SLUG (API will filter by slug)
      if (activeCategorySlug && activeCategorySlug !== ALL_TAB.slug) qs.set('category', activeCategorySlug)
      if (query.trim()) qs.set('q', query.trim())

      const res = await fetch(`/api/looks?${qs.toString()}`, { cache: 'no-store' })
      const data = await safeJson(res)

      if (!res.ok) throw new Error(data?.error || 'Failed to load looks')

      const next = Array.isArray(data.items) ? (data.items as FeedItem[]) : []
      setItems(next)
    } catch (e: any) {
      setFeedError(e?.message || 'Failed to load looks')
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
        const data = await safeJson(res)

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
        setCommentError(data?.error || 'Failed to post comment')
        return
      }

      await openCommentsDrawer(mediaId)
    } catch (e: any) {
      setComments((prev) => prev.filter((c) => c.id !== tempId))
      setItems((prev) =>
        prev.map((m) =>
          m.id === mediaId
            ? { ...m, _count: { ...m._count, comments: Math.max(0, m._count.comments - 1) } }
            : m,
        ),
      )
      setCommentError(e?.message || 'Failed to post comment')
    } finally {
      setPosting(false)
    }
  }

  function openAvailabilityFor(item: FeedItem) {
    if (!item.professional?.id) return

    const ctx: AvailabilityDrawerContext = {
      mediaId: item.id,
      professionalId: item.professional.id,
      serviceId: item.serviceId ?? null,
      source: 'DISCOVERY',
    }

    setDrawerCtx(ctx)
    setAvailabilityOpen(true)
  }

  const shareLook = useCallback(async (item: FeedItem) => {
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}/looks?m=${encodeURIComponent(item.id)}`

    try {
      const nav: any = navigator
      if (nav?.share) {
        await nav.share({
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

  // ✅ Branding copy
  if (loading) return <div className="p-3 text-textSecondary">Loading Looks…</div>
  if (feedError) return <div className="p-3 text-toneDanger">{feedError}</div>
  if (!items.length) return <div className="p-3 text-textSecondary">No Looks yet. This is where the glow-ups will live.</div>

  const FEED_VIEWPORT_HEIGHT = `calc(100dvh - ${FOOTER_HEIGHT}px)`

  return (
    <>
      <div className="bg-bgPrimary" style={{ height: FEED_VIEWPORT_HEIGHT, width: '100%', overflow: 'hidden', position: 'relative' }}>
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
                pro={m.professional ? { id: m.professional.id, businessName: m.professional.businessName, avatarUrl: m.professional.avatarUrl ?? null } : null}
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

      {drawerCtx ? <AvailabilityDrawer open={availabilityOpen} onClose={() => setAvailabilityOpen(false)} context={drawerCtx} /> : null}

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
