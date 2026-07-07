// app/(main)/search/_components/LooksBookableGrid.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import RemoteImage from '@/app/_components/media/RemoteImage'
import EmptyState from '@/app/_components/boundaries/EmptyState'
import { asTrimmedString, isRecord } from '@/lib/guards'
import { formatRoundedDollars } from '@/lib/money'
import { safeJson } from '@/lib/http'
import { cn } from '@/lib/utils'
import { parseLooksFeedEnvelope } from '@/lib/looks/parsers'
import { pickProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { useViewerLocation } from '@/lib/useViewerLocation'
import { viewerLocationToDrawerContextFields } from '@/lib/viewerLocation'
import AvailabilityDrawer from '../../booking/AvailabilityDrawer'
import type { DrawerContext as AvailabilityDrawerContext } from '../../booking/AvailabilityDrawer/types'
import type { LooksFeedItemDto } from '@/lib/looks/types'

// Primary looks-browse surface for Discover (social-first D2). Ranked +
// category-filtered + inline Book, now responsive across breakpoints with
// cursor-paginated "Load more" so it reads as a real inspiration grid.
const LOOKS_GRID_LIMIT = 24

interface LooksBookableGridProps {
  // The active discover category slug (ServiceCategory.slug), or null for "all".
  // Looks share the same category source, so the slug filters the feed directly.
  categorySlug: string | null
  // When true (looks-first primary surface) an empty result renders a friendly
  // empty state instead of collapsing to null (the secondary/pro-mode default).
  showEmptyState?: boolean
  // Section label; pass null to render the grid without an internal heading.
  heading?: string | null
}

function formatStartingPrice(price: number | null): string | null {
  const dollars = formatRoundedDollars(price)
  return dollars ? `From ${dollars}` : null
}

function buildLooksUrl(categorySlug: string | null, cursor: string | null): string {
  const qs = new URLSearchParams()
  qs.set('limit', String(LOOKS_GRID_LIMIT))
  qs.set('sort', 'ranked')
  if (categorySlug) qs.set('category', categorySlug)
  if (cursor) qs.set('cursor', cursor)
  return `/api/v1/looks?${qs.toString()}`
}

export default function LooksBookableGrid({
  categorySlug,
  showEmptyState = false,
  heading = "◆ Looks you'd book",
}: LooksBookableGridProps) {
  const viewerLoc = useViewerLocation()
  const [looks, setLooks] = useState<LooksFeedItemDto[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const [drawerCtx, setDrawerCtx] = useState<AvailabilityDrawerContext | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const loadMoreAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    async function load() {
      setLoading(true)
      // A category switch invalidates any in-flight "load more".
      loadMoreAbortRef.current?.abort()

      try {
        const res = await fetch(buildLooksUrl(categorySlug, null), {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })

        const raw = await safeJson(res)
        if (!active || controller.signal.aborted) return

        if (!res.ok) {
          throw new Error(asTrimmedString(isRecord(raw) ? raw.error : null) ?? 'Failed to load looks')
        }

        const envelope = parseLooksFeedEnvelope(raw)
        setLooks(envelope.items)
        setCursor(envelope.nextCursor)
      } catch {
        if (active && !controller.signal.aborted) {
          setLooks([])
          setCursor(null)
        }
      } finally {
        if (active && !controller.signal.aborted) setLoading(false)
      }
    }

    void load()

    return () => {
      active = false
      controller.abort()
    }
  }, [categorySlug])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return

    loadMoreAbortRef.current?.abort()
    const controller = new AbortController()
    loadMoreAbortRef.current = controller
    setLoadingMore(true)

    try {
      const res = await fetch(buildLooksUrl(categorySlug, cursor), {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })

      const raw = await safeJson(res)
      if (controller.signal.aborted) return
      if (!res.ok) return

      const envelope = parseLooksFeedEnvelope(raw)
      // Dedupe on append — the ranked cursor is stable, but guard against overlap.
      setLooks((prev) => {
        const seen = new Set(prev.map((look) => look.id))
        return [...prev, ...envelope.items.filter((look) => !seen.has(look.id))]
      })
      setCursor(envelope.nextCursor)
    } catch {
      // Best-effort — leave the current page intact on failure.
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false)
      if (loadMoreAbortRef.current === controller) loadMoreAbortRef.current = null
    }
  }, [categorySlug, cursor, loadingMore])

  useEffect(() => {
    return () => loadMoreAbortRef.current?.abort()
  }, [])

  function openBooking(look: LooksFeedItemDto) {
    if (!look.professional?.id) return

    setDrawerCtx({
      professionalId: look.professional.id,
      lookPostId: look.id,
      mediaId: null,
      serviceId: look.serviceId ?? null,
      source: 'DISCOVERY',
      ...viewerLocationToDrawerContextFields(viewerLoc),
    })
    setDrawerOpen(true)
  }

  // Empty: collapse to null in secondary contexts, or a friendly state when this
  // is the primary looks-first surface.
  if (!loading && looks.length === 0) {
    if (!showEmptyState) return null

    return (
      <EmptyState
        className="border-0 bg-transparent"
        title="No looks to book yet"
        description="Try a different category, or switch to Find a pro to browse by location."
      />
    )
  }

  const gridClass = 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4'

  return (
    <section className="px-1">
      {heading ? (
        <div className="mb-2.5 font-mono text-[10px] font-black uppercase tracking-[0.14em] text-textMuted">
          {heading}
        </div>
      ) : null}

      <div className={gridClass}>
        {loading
          ? Array.from({ length: 8 }).map((_, index) => (
              <div
                key={`looks-skeleton-${index}`}
                className="overflow-hidden rounded-card border border-white/10 bg-bgSecondary"
              >
                <div className="aspect-3/4 animate-pulse bg-bgPrimary/45" />
                <div className="space-y-1.5 p-2.5">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-bgPrimary/45" />
                  <div className="h-2.5 w-1/2 animate-pulse rounded bg-bgPrimary/45" />
                </div>
              </div>
            ))
          : looks.map((look) => {
              const proName = look.professional
                ? pickProfessionalPublicDisplayName(look.professional)
                : null
              const tag = look.category ?? look.serviceName
              const priceLabel = formatStartingPrice(look.priceStartingAt)
              const serviceLabel = look.serviceName ?? look.caption

              return (
                <article
                  key={look.id}
                  className="overflow-hidden rounded-card border border-white/10 bg-bgSecondary"
                >
                  <div className="relative aspect-3/4 overflow-hidden bg-bgPrimary/45">
                    <RemoteImage
                      src={look.thumbUrl ?? look.url}
                      alt={serviceLabel ?? 'Look'}
                      width={300}
                      height={400}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />

                    <div
                      aria-hidden
                      className="absolute inset-0 bg-linear-to-b from-transparent via-transparent to-bgPrimary/60"
                    />

                    {tag ? (
                      <div className="absolute left-1.5 top-1.5 rounded-md bg-bgPrimary/70 px-1.5 py-1 font-mono text-[9px] font-black uppercase tracking-widest text-textPrimary backdrop-blur-md">
                        {tag}
                      </div>
                    ) : null}

                    {priceLabel ? (
                      <div className="absolute right-1.5 top-1.5 rounded-full bg-bgPrimary/70 px-2 py-1 font-mono text-[9px] font-black uppercase tracking-[0.08em] text-textPrimary backdrop-blur-md">
                        {priceLabel}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => openBooking(look)}
                      className={cn(
                        'absolute bottom-1.5 right-1.5 rounded-full bg-accentPrimary px-3 py-1.5',
                        'font-mono text-[10px] font-black uppercase tracking-[0.08em] text-bgPrimary',
                        'transition hover:bg-accentPrimaryHover',
                      )}
                      aria-label={
                        proName
                          ? `Book ${serviceLabel ?? 'this look'} with ${proName}`
                          : `Book ${serviceLabel ?? 'this look'}`
                      }
                    >
                      Book
                    </button>
                  </div>

                  <div className="p-2.5">
                    <div className="truncate text-[12px] font-black text-textPrimary">
                      {proName ?? 'Pro'}
                    </div>

                    {serviceLabel ? (
                      <div className="mt-0.5 truncate text-[11px] font-semibold text-textMuted">
                        {serviceLabel}
                      </div>
                    ) : null}
                  </div>
                </article>
              )
            })}
      </div>

      {!loading && cursor ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className={cn(
              'rounded-full border border-white/15 bg-bgPrimary/25 px-5 py-2.5',
              'font-mono text-[11px] font-black uppercase tracking-[0.08em] text-textPrimary',
              'transition hover:bg-white/10 disabled:opacity-60',
            )}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}

      {drawerCtx ? (
        <AvailabilityDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          context={drawerCtx}
        />
      ) : null}
    </section>
  )
}
