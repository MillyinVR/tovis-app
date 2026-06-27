// app/(main)/search/_components/LooksBookableGrid.tsx
'use client'

import { useEffect, useState } from 'react'
import RemoteImage from '@/app/_components/media/RemoteImage'
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

const LOOKS_GRID_LIMIT = 12

interface LooksBookableGridProps {
  // The active discover category slug (ServiceCategory.slug), or null for "all".
  // Looks share the same category source, so the slug filters the feed directly.
  categorySlug: string | null
}

function formatStartingPrice(price: number | null): string | null {
  const dollars = formatRoundedDollars(price)
  return dollars ? `From ${dollars}` : null
}

export default function LooksBookableGrid({ categorySlug }: LooksBookableGridProps) {
  const viewerLoc = useViewerLocation()
  const [looks, setLooks] = useState<LooksFeedItemDto[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerCtx, setDrawerCtx] = useState<AvailabilityDrawerContext | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    async function load() {
      setLoading(true)

      try {
        const qs = new URLSearchParams()
        qs.set('limit', String(LOOKS_GRID_LIMIT))
        qs.set('sort', 'ranked')
        if (categorySlug) qs.set('category', categorySlug)

        const res = await fetch(`/api/v1/looks?${qs.toString()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })

        const raw = await safeJson(res)
        if (!active || controller.signal.aborted) return

        if (!res.ok) {
          throw new Error(asTrimmedString(isRecord(raw) ? raw.error : null) ?? 'Failed to load looks')
        }

        setLooks(parseLooksFeedEnvelope(raw).items)
      } catch {
        if (active && !controller.signal.aborted) setLooks([])
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

  // Hide the whole section when there's nothing bookable to show — avoids an
  // empty band under the grid. While loading, show lightweight skeleton tiles.
  if (!loading && looks.length === 0) return null

  return (
    <section className="px-1">
      <div className="mb-2.5 font-mono text-[10px] font-black uppercase tracking-[0.14em] text-textMuted">
        ◆ Looks you&rsquo;d book
      </div>

      <div className="grid grid-cols-2 gap-2">
        {loading
          ? Array.from({ length: 4 }).map((_, index) => (
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
                      <div className="absolute left-1.5 top-1.5 rounded-md bg-bgPrimary/70 px-1.5 py-1 font-mono text-[9px] font-black uppercase tracking-[0.1em] text-textPrimary backdrop-blur-md">
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
