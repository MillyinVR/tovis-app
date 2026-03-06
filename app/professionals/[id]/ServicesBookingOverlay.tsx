// app/professionals/[id]/ServicesBookingOverlay.tsx
'use client'

import * as React from 'react'
import AvailabilityDrawer from '@/app/(main)/booking/AvailabilityDrawer'
import type { DrawerContext } from '@/app/(main)/booking/AvailabilityDrawer/types'
import { loadViewerLocation, viewerLocationToDrawerContextFields } from '@/lib/viewerLocation'

type UiOffering = {
  id: string // offeringId
  serviceId: string
  name: string
  description: string | null
  imageUrl: string | null
  pricingLines: string[]
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

export default function ServicesBookingOverlay({
  professionalId,
  offerings,
  initialFavoritedServiceIds,
}: {
  professionalId: string
  offerings: UiOffering[]
  initialFavoritedServiceIds?: string[]
}) {
  const [open, setOpen] = React.useState(false)
  const [ctx, setCtx] = React.useState<DrawerContext | null>(null)

  const [favSet, setFavSet] = React.useState<Set<string>>(
    () => new Set((initialFavoritedServiceIds ?? []).filter(Boolean)),
  )
  const [favBusy, setFavBusy] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    setFavSet(new Set((initialFavoritedServiceIds ?? []).filter(Boolean)))
  }, [initialFavoritedServiceIds])

  const close = React.useCallback(() => {
    setOpen(false)
    window.setTimeout(() => setCtx(null), 150)
  }, [])

  const openForOffering = React.useCallback(
    (off: UiOffering) => {
      const viewer = loadViewerLocation()

      const next: DrawerContext = {
        professionalId,
        serviceId: off.serviceId,
        offeringId: off.id,
        mediaId: null,
        source: 'REQUESTED',
        ...viewerLocationToDrawerContextFields(viewer),
      }

      setCtx(next)
      setOpen(true)
    },
    [professionalId],
  )

  const redirectToLogin = React.useCallback((reason: string) => {
    if (typeof window === 'undefined') return
    const from = sanitizeFrom(currentPathWithQuery())
    const qs = new URLSearchParams({ from, reason })
    window.location.href = `/login?${qs.toString()}`
  }, [])

  const toggleFavoriteService = React.useCallback(
    async (serviceId: string) => {
      if (!serviceId) return
      if (favBusy[serviceId]) return

      const before = favSet.has(serviceId)
      const next = !before

      setFavBusy((p) => ({ ...p, [serviceId]: true }))
      setFavSet((prev) => {
        const copy = new Set(prev)
        if (next) copy.add(serviceId)
        else copy.delete(serviceId)
        return copy
      })

      try {
        const res = await fetch(`/api/services/${encodeURIComponent(serviceId)}/favorite`, {
          method: before ? 'DELETE' : 'POST',
          headers: { Accept: 'application/json' },
        })

        if (res.status === 401) {
          // revert + login
          setFavSet((prev) => {
            const copy = new Set(prev)
            if (before) copy.add(serviceId)
            else copy.delete(serviceId)
            return copy
          })
          redirectToLogin('favorite_service')
          return
        }

        if (!res.ok) {
          // revert on error
          setFavSet((prev) => {
            const copy = new Set(prev)
            if (before) copy.add(serviceId)
            else copy.delete(serviceId)
            return copy
          })
          return
        }
      } catch {
        // revert on network fail
        setFavSet((prev) => {
          const copy = new Set(prev)
          if (before) copy.add(serviceId)
          else copy.delete(serviceId)
          return copy
        })
      } finally {
        setFavBusy((p) => {
          const copy = { ...p }
          delete copy[serviceId]
          return copy
        })
      }
    },
    [favBusy, favSet, redirectToLogin],
  )

  const onRowKeyDown = React.useCallback(
    (e: React.KeyboardEvent, off: UiOffering) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openForOffering(off)
      }
    },
    [openForOffering],
  )

  if (!offerings || offerings.length === 0) return null

  return (
    <>
      <div className="tovis-glass grid gap-2 rounded-card border border-white/10 bg-bgSecondary p-3">
        {offerings.map((off) => {
          const isFav = favSet.has(off.serviceId)
          const busy = Boolean(favBusy[off.serviceId])

          return (
            <div
              key={off.id}
              role="button"
              tabIndex={0}
              onClick={() => openForOffering(off)}
              onKeyDown={(e) => onRowKeyDown(e, off)}
              className={[
                'flex w-full items-start justify-between gap-3 rounded-card border border-white/10 bg-bgPrimary p-3 text-left text-textPrimary',
                'transition hover:border-white/20 hover:bg-surfaceGlass',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/50',
                'cursor-pointer select-none',
              ].join(' ')}
              aria-label={`Book ${off.name}`}
              title="Book this service"
            >
              {/* LEFT */}
              <div className="flex min-w-0 flex-1 gap-3">
                <div className="h-13 w-13 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-bgSecondary">
                  {off.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={off.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>

                <div className="min-w-0">
                  <div className="truncate text-[13px] font-black">{off.name}</div>

                  {off.description ? (
                    <div className="mt-1 line-clamp-2 text-[12px] font-semibold text-textSecondary">{off.description}</div>
                  ) : null}

                  {off.pricingLines.length ? (
                    <div className="mt-2 grid gap-1 text-[12px] font-semibold">
                      {off.pricingLines.map((line) => (
                        <div key={line} className="text-textSecondary">
                          {line}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-[12px] font-semibold text-textSecondary opacity-80">Pricing not set</div>
                  )}
                </div>
              </div>

              {/* RIGHT actions */}
              <div className="grid justify-items-end gap-2">
                {/* Book pill with arrow inside */}
                <div className="rounded-full bg-accentPrimary px-3 py-2 text-[12px] font-black text-bgPrimary">
                  <span className="inline-flex items-center gap-1">
                    Book <span aria-hidden>→</span>
                  </span>
                </div>

                {/* Save pill (same “pill” feel, no outline box) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleFavoriteService(off.serviceId)
                  }}
                  disabled={busy}
                  className={[
                    'pointer-events-auto rounded-full px-3 py-2 text-[12px] font-black',
                    // no border; just a fill
                    isFav ? 'bg-white/12 text-white' : 'bg-bgPrimary/25 text-textPrimary hover:bg-white/8',
                    busy ? 'opacity-70' : '',
                  ].join(' ')}
                  title={isFav ? 'Saved (tap to remove)' : 'Save this service'}
                  aria-label={isFav ? 'Unsave service' : 'Save service'}
                >
                  {busy ? '…' : isFav ? 'Saved' : 'Save'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {ctx ? <AvailabilityDrawer open={open} onClose={close} context={ctx} /> : null}
    </>
  )
}