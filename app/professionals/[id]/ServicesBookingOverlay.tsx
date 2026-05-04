// app/professionals/[id]/ServicesBookingOverlay.tsx
'use client'

import * as React from 'react'

import AvailabilityDrawer from '@/app/(main)/booking/AvailabilityDrawer'
import type { DrawerContext } from '@/app/(main)/booking/AvailabilityDrawer/types'

import {
  loadViewerLocation,
  viewerLocationToDrawerContextFields,
} from '@/lib/viewerLocation'

type UiOffering = {
  id: string
  serviceId: string
  name: string
  description: string | null
  imageUrl: string | null
  pricingLines: string[]
}

type ServicesBookingOverlayProps = {
  professionalId: string
  offerings: UiOffering[]
  initialFavoritedServiceIds?: string[]
}

type FavoriteStatePatch = {
  serviceId: string
  favorited: boolean
}

function currentPathWithQuery(): string {
  if (typeof window === 'undefined') return '/looks'

  return window.location.pathname + window.location.search + window.location.hash
}

function sanitizeLocalPath(value: string): string {
  const trimmed = value.trim()

  if (!trimmed) return '/looks'
  if (!trimmed.startsWith('/')) return '/looks'
  if (trimmed.startsWith('//')) return '/looks'

  return trimmed
}

function favoriteSetFromServiceIds(serviceIds: string[] | undefined): Set<string> {
  return new Set((serviceIds ?? []).filter(Boolean))
}

function patchFavoriteSet(
  previous: Set<string>,
  patch: FavoriteStatePatch,
): Set<string> {
  const next = new Set(previous)

  if (patch.favorited) {
    next.add(patch.serviceId)
  } else {
    next.delete(patch.serviceId)
  }

  return next
}

function isBusy(
  busyByServiceId: Readonly<Record<string, boolean>>,
  serviceId: string,
): boolean {
  return Boolean(busyByServiceId[serviceId])
}

export default function ServicesBookingOverlay({
  professionalId,
  offerings,
  initialFavoritedServiceIds,
}: ServicesBookingOverlayProps) {
  const [open, setOpen] = React.useState(false)
  const [ctx, setCtx] = React.useState<DrawerContext | null>(null)

  const [favSet, setFavSet] = React.useState<Set<string>>(() =>
    favoriteSetFromServiceIds(initialFavoritedServiceIds),
  )

  const [favBusy, setFavBusy] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    setFavSet(favoriteSetFromServiceIds(initialFavoritedServiceIds))
  }, [initialFavoritedServiceIds])

  const close = React.useCallback(() => {
    setOpen(false)

    window.setTimeout(() => {
      setCtx(null)
    }, 150)
  }, [])

  const openForOffering = React.useCallback(
    (offering: UiOffering) => {
      const viewer = loadViewerLocation()

      const nextContext: DrawerContext = {
        professionalId,
        serviceId: offering.serviceId,
        offeringId: offering.id,
        mediaId: null,
        source: 'REQUESTED',
        ...viewerLocationToDrawerContextFields(viewer),
      }

      setCtx(nextContext)
      setOpen(true)
    },
    [professionalId],
  )

  const redirectToLogin = React.useCallback((reason: string) => {
    if (typeof window === 'undefined') return

    const from = sanitizeLocalPath(currentPathWithQuery())
    const params = new URLSearchParams({ from, reason })

    window.location.href = `/login?${params.toString()}`
  }, [])

  const markFavoriteBusy = React.useCallback(
    (serviceId: string, busy: boolean) => {
      setFavBusy((previous) => {
        const next = { ...previous }

        if (busy) {
          next[serviceId] = true
        } else {
          delete next[serviceId]
        }

        return next
      })
    },
    [],
  )

  const setFavoriteOptimistic = React.useCallback(
    (serviceId: string, favorited: boolean) => {
      setFavSet((previous) =>
        patchFavoriteSet(previous, {
          serviceId,
          favorited,
        }),
      )
    },
    [],
  )

  const toggleFavoriteService = React.useCallback(
    async (serviceId: string) => {
      if (!serviceId) return
      if (isBusy(favBusy, serviceId)) return

      const wasFavorited = favSet.has(serviceId)
      const shouldFavorite = !wasFavorited

      markFavoriteBusy(serviceId, true)
      setFavoriteOptimistic(serviceId, shouldFavorite)

      try {
        const response = await fetch(
          `/api/services/${encodeURIComponent(serviceId)}/favorite`,
          {
            method: wasFavorited ? 'DELETE' : 'POST',
            headers: { Accept: 'application/json' },
          },
        )

        if (response.status === 401) {
          setFavoriteOptimistic(serviceId, wasFavorited)
          redirectToLogin('favorite_service')
          return
        }

        if (!response.ok) {
          setFavoriteOptimistic(serviceId, wasFavorited)
        }
      } catch {
        setFavoriteOptimistic(serviceId, wasFavorited)
      } finally {
        markFavoriteBusy(serviceId, false)
      }
    },
    [
      favBusy,
      favSet,
      markFavoriteBusy,
      redirectToLogin,
      setFavoriteOptimistic,
    ],
  )

  if (offerings.length === 0) return null

  return (
    <>
      <div className="grid gap-3">
        {offerings.map((offering) => (
          <ServiceOfferingCard
            key={offering.id}
            offering={offering}
            favorited={favSet.has(offering.serviceId)}
            busy={isBusy(favBusy, offering.serviceId)}
            onBook={openForOffering}
            onToggleFavorite={toggleFavoriteService}
          />
        ))}
      </div>

      {ctx ? (
        <AvailabilityDrawer open={open} onClose={close} context={ctx} />
      ) : null}
    </>
  )
}

function ServiceOfferingCard({
  offering,
  favorited,
  busy,
  onBook,
  onToggleFavorite,
}: {
  offering: UiOffering
  favorited: boolean
  busy: boolean
  onBook: (offering: UiOffering) => void
  onToggleFavorite: (serviceId: string) => void
}) {
  const bookLabel = `Book ${offering.name}`
  const favoriteLabel = favorited ? 'Unsave service' : 'Save service'

  return (
    <article className="brand-profile-service-card">
      <div className="flex min-w-0 flex-1 gap-3">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-bgSurface">
          {offering.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={offering.imageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="brand-profile-hero-fallback pointer-events-none h-full w-full"
              aria-hidden
            />
          )}
        </div>

        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-black text-textPrimary">
            {offering.name}
          </h3>

          {offering.description ? (
            <p className="mt-1 line-clamp-2 text-[12px] font-semibold text-textSecondary">
              {offering.description}
            </p>
          ) : null}

          {offering.pricingLines.length > 0 ? (
            <div className="mt-2 grid gap-1 text-[12px] font-semibold text-textSecondary">
              {offering.pricingLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-[12px] font-semibold text-textSecondary opacity-80">
              Pricing not set
            </div>
          )}
        </div>
      </div>

      <div className="grid shrink-0 justify-items-end gap-2">
        <button
          type="button"
          onClick={() => onBook(offering)}
          className="brand-button-primary brand-focus rounded-full px-3 py-2 text-[12px]"
          aria-label={bookLabel}
          title={bookLabel}
        >
          <span className="inline-flex items-center gap-1">
            Book <span aria-hidden>→</span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => onToggleFavorite(offering.serviceId)}
          disabled={busy}
          className={[
            'brand-focus rounded-full px-3 py-2 text-[12px] font-black transition',
            favorited
              ? 'bg-[rgb(var(--surface-glass)/0.14)] text-textPrimary'
              : 'bg-[rgb(var(--bg-primary)/0.45)] text-textSecondary hover:text-textPrimary',
            busy ? 'cursor-wait opacity-70' : '',
          ].join(' ')}
          title={favorited ? 'Saved. Tap to remove.' : 'Save this service'}
          aria-label={favoriteLabel}
          aria-pressed={favorited}
        >
          {busy ? '…' : favorited ? 'Saved' : 'Save'}
        </button>
      </div>
    </article>
  )
}