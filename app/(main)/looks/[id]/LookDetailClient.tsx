// app/(main)/looks/[id]/LookDetailClient.tsx
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'

import { useBrand } from '@/lib/brand/BrandProvider'
import { isRecord } from '@/lib/guards'
import { safeJson } from '@/lib/http'
import { cn } from '@/lib/utils'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { formatFollowerLabel } from '@/lib/profiles/publicProfileFormatting'
import type { LooksDetailItemDto } from '@/lib/looks/types'
import {
  viewerLocationToDrawerContextFields,
  type ViewerLocation,
} from '@/lib/viewerLocation'
import { useViewerLocation } from '@/lib/useViewerLocation'

import AvailabilityDrawer from '../../booking/AvailabilityDrawer'
import type { DrawerContext as AvailabilityDrawerContext } from '../../booking/AvailabilityDrawer/types'
import RemoteImage from '@/app/_components/media/RemoteImage'

import CommentsDrawer from '../_components/CommentsDrawer'
import RightActionRail from '../_components/RightActionRail'
import { useProFollow } from '../_components/useProFollow'

function currentLooksDetailPath(lookPostId: string): string {
  return `/looks/${encodeURIComponent(lookPostId)}`
}

function isGuestBlocked(status: number): boolean {
  return status === 401
}

function getNavigatorShare() {
  if (typeof navigator === 'undefined') return null

  const value: unknown = navigator
  if (!isRecord(value)) return null

  const share = value.share
  return typeof share === 'function'
    ? (share as (data: ShareData) => Promise<void>)
    : null
}

function buildAvailabilityDrawerContext(args: {
  item: LooksDetailItemDto
  viewerLoc: ViewerLocation | null
}): AvailabilityDrawerContext | null {
  const professionalId = args.item.professional?.id
  if (!professionalId) return null

  return {
    professionalId,
    lookPostId: args.item.id,
    mediaId: null,
    serviceId: args.item.service?.id ?? null,
    source: 'DISCOVERY',
    ...viewerLocationToDrawerContextFields(args.viewerLoc),
  }
}

export default function LookDetailClient({
  initialItem,
}: {
  initialItem: LooksDetailItemDto
}) {
  const router = useRouter()
  const { brand } = useBrand()

  const [item, setItem] = useState(initialItem)

  const [commentsOpen, setCommentsOpen] = useState(false)

  const viewerLoc = useViewerLocation()
  const [availabilityOpen, setAvailabilityOpen] = useState(false)
  const [drawerCtx, setDrawerCtx] = useState<AvailabilityDrawerContext | null>(
    null,
  )

  const redirectToLogin = useCallback(
    (reason: string) => {
      const qs = new URLSearchParams({
        from: currentLooksDetailPath(item.id),
        reason,
      })
      router.push(`/login?${qs.toString()}`)
    },
    [item.id, router],
  )

  const {
    following,
    followerCount,
    toggle: toggleFollow,
  } = useProFollow({
    professionalId: item.professional.id,
    onRequireAuth: redirectToLogin,
  })

  const proDisplayName = formatProfessionalPublicDisplayName(item.professional)

  const closeAvailability = useCallback(() => {
    setAvailabilityOpen(false)
    window.setTimeout(() => setDrawerCtx(null), 150)
  }, [])

  const openAvailability = useCallback(() => {
    const context = buildAvailabilityDrawerContext({
      item,
      viewerLoc,
    })
    if (!context) return

    setDrawerCtx(context)
    setAvailabilityOpen(true)
  }, [item, viewerLoc])

  const handleCommentCountChange = useCallback(
    (_lookPostId: string, commentsCount: number) => {
      setItem((prev) => ({
        ...prev,
        _count: { ...prev._count, comments: commentsCount },
      }))
    },
    [],
  )

  const toggleLike = useCallback(async () => {
    const lookPostId = item.id
    const beforeLiked = item.viewerContext.viewerLiked
    const beforeCount = item._count.likes

    setItem((prev) => ({
      ...prev,
      viewerContext: {
        ...prev.viewerContext,
        viewerLiked: !beforeLiked,
      },
      _count: {
        ...prev._count,
        likes: Math.max(0, beforeCount + (beforeLiked ? -1 : 1)),
      },
    }))

    try {
      const res = await fetch(
        `/api/looks/${encodeURIComponent(lookPostId)}/like`,
        {
          method: beforeLiked ? 'DELETE' : 'POST',
        },
      )

      const raw = await safeJson(res)

      if (isGuestBlocked(res.status)) {
        setItem((prev) => ({
          ...prev,
          viewerContext: {
            ...prev.viewerContext,
            viewerLiked: beforeLiked,
          },
          _count: {
            ...prev._count,
            likes: beforeCount,
          },
        }))
        redirectToLogin('like')
        return
      }

      if (!res.ok) {
        setItem((prev) => ({
          ...prev,
          viewerContext: {
            ...prev.viewerContext,
            viewerLiked: beforeLiked,
          },
          _count: {
            ...prev._count,
            likes: beforeCount,
          },
        }))
        return
      }

      const liked =
        isRecord(raw) && typeof raw.liked === 'boolean'
          ? raw.liked
          : !beforeLiked

      const likeCount =
        isRecord(raw) && typeof raw.likeCount === 'number'
          ? raw.likeCount
          : Math.max(0, beforeCount + (beforeLiked ? -1 : 1))

      setItem((prev) => ({
        ...prev,
        viewerContext: {
          ...prev.viewerContext,
          viewerLiked: liked,
        },
        _count: {
          ...prev._count,
          likes: likeCount,
        },
      }))
    } catch {
      setItem((prev) => ({
        ...prev,
        viewerContext: {
          ...prev.viewerContext,
          viewerLiked: beforeLiked,
        },
        _count: {
          ...prev._count,
          likes: beforeCount,
        },
      }))
    }
  }, [item, redirectToLogin])

  const shareLook = useCallback(async () => {
    if (typeof window === 'undefined') return

    const url = `${window.location.origin}${currentLooksDetailPath(item.id)}`

    try {
      const share = getNavigatorShare()

      if (share) {
        await share({
          title: `${brand.displayName} Look`,
          text: item.caption ?? undefined,
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
  }, [brand.displayName, item.caption, item.id])

  const review = item.primaryMedia.review
  const reviewStars = review
    ? '★'.repeat(Math.max(0, Math.min(review.rating, 5))).padEnd(5, '☆')
    : null

  const secondaryAssets = useMemo(
    () => item.assets.filter((asset) => asset.media.id !== item.primaryMedia.id),
    [item.assets, item.primaryMedia.id],
  )

  return (
    <>
      <main className="mx-auto max-w-[960px] px-4 pb-24 pt-6 text-textPrimary">
        <Link
          href="/looks"
          className="inline-flex items-center gap-2 text-xs font-black text-textPrimary opacity-80 hover:opacity-100"
        >
          <span aria-hidden>←</span> Back to Looks
        </Link>

        <section className="relative mt-3 overflow-hidden rounded-card border border-surfaceGlass/10 bg-bgSecondary">
          <div className="grid max-h-[520px] place-items-center bg-bgPrimary pr-[92px]">
            {item.primaryMedia.mediaType === 'VIDEO' ? (
              <video
                src={item.primaryMedia.url}
                controls
                playsInline
                preload="metadata"
                className="h-auto w-full max-h-[520px]"
              />
            ) : (
              <RemoteImage
                src={item.primaryMedia.url}
                alt={item.caption || `Look by ${proDisplayName}`}
                className="block h-auto w-full"
                intrinsic
              />
            )}
          </div>

          <RightActionRail
            lookPostId={item.id}
            lookTitle={item.caption ?? null}
            pro={{
              id: item.professional.id,
              businessName: item.professional.businessName,
              firstName: item.professional.firstName,
              lastName: item.professional.lastName,
              avatarUrl: item.professional.avatarUrl,
            }}
            viewerLiked={item.viewerContext.viewerLiked}
            likeCount={item._count.likes}
            commentCount={item._count.comments}
            bottom={16}
            right={12}
            onOpenAvailability={openAvailability}
            onToggleLike={() => void toggleLike()}
            onOpenComments={() => setCommentsOpen(true)}
            onShare={() => void shareLook()}
            onSaveStateChange={(state) => {
              setItem((prev) => ({
                ...prev,
                _count: {
                  ...prev._count,
                  saves: state.saveCount,
                },
              }))
            }}
          />

          <div className="grid gap-3 p-4">
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="text-base font-extrabold">{proDisplayName}</div>

                <button
                  type="button"
                  aria-pressed={following}
                  aria-label={
                    following
                      ? `Unfollow ${proDisplayName}`
                      : `Follow ${proDisplayName}`
                  }
                  onClick={() => toggleFollow()}
                  className={cn(
                    'inline-flex shrink-0 items-center rounded-full border px-3 py-1',
                    'font-mono text-[10px] font-bold uppercase tracking-[0.06em] transition',
                    following
                      ? 'border-surfaceGlass/35 bg-surfaceGlass/12 text-textPrimary/70 hover:text-textPrimary'
                      : 'border-accentPrimary/40 bg-accentPrimary/10 text-textPrimary hover:border-accentPrimary/60',
                  )}
                >
                  {following ? 'Following' : 'Follow'}
                </button>

                {followerCount > 0 ? (
                  <span className="font-mono text-[11px] font-semibold text-textSecondary">
                    {formatFollowerLabel(followerCount)}
                  </span>
                ) : null}
              </div>

              <div className="text-xs text-textSecondary">
                {item.professional.professionType || 'Beauty pro'}
                {item.professional.location
                  ? ` • ${item.professional.location}`
                  : ''}
              </div>
            </div>

            {item.service ? (
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-surfaceGlass/12 bg-surfaceGlass/8 px-3 py-1 text-[11px] font-black text-textPrimary">
                  {item.service.name}
                </span>

                {item.service.category ? (
                  <span className="rounded-full border border-surfaceGlass/12 bg-surfaceGlass/8 px-3 py-1 text-[11px] font-black text-textPrimary">
                    {item.service.category.name}
                  </span>
                ) : null}
              </div>
            ) : null}

            {item.caption ? (
              <div className="text-sm text-textPrimary/90">{item.caption}</div>
            ) : null}

            <div className="flex flex-wrap gap-3 text-[12px] text-textSecondary">
              <span>
                <span className="font-black text-textPrimary">Likes:</span>{' '}
                {item._count.likes}
              </span>
              <span>
                <span className="font-black text-textPrimary">Comments:</span>{' '}
                {item._count.comments}
              </span>
              <span>
                <span className="font-black text-textPrimary">Saves:</span>{' '}
                {item._count.saves}
              </span>
              <span>
                <span className="font-black text-textPrimary">Shares:</span>{' '}
                {item._count.shares}
              </span>
            </div>

            {review ? (
              <div className="mt-1 grid gap-2 border-t border-surfaceGlass/10 pt-3">
                {reviewStars ? (
                  <div className="text-xs font-black text-accentPrimary">
                    {reviewStars}
                  </div>
                ) : null}

                {review.headline ? (
                  <div className="text-sm font-extrabold">{review.headline}</div>
                ) : null}

                <div className="text-xs text-textSecondary">
                  Helpful: {review.helpfulCount}
                </div>
              </div>
            ) : null}

            {secondaryAssets.length > 0 ? (
              <div className="grid gap-2 border-t border-surfaceGlass/10 pt-3">
                <div className="text-[12px] font-black text-textSecondary">
                  More from this post
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {secondaryAssets.map((asset) => {
                    const previewSrc = asset.media.thumbUrl ?? asset.media.url

                    return (
                      <div
                        key={asset.id}
                        className="overflow-hidden rounded-card border border-surfaceGlass/10 bg-bgPrimary"
                      >
                        {asset.media.mediaType === 'VIDEO' ? (
                          <video
                            src={asset.media.url}
                            muted
                            playsInline
                            preload="metadata"
                            className="h-24 w-full object-cover"
                          />
                        ) : (
                          <RemoteImage
                            src={previewSrc}
                            alt={asset.media.caption || 'Look asset'}
                            width={400}
                            height={400}
                            className="h-24 w-full object-cover"
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {item.admin ? (
              <div className="mt-1 grid gap-2 border-t border-surfaceGlass/10 pt-3">
                <div className="text-[12px] font-black text-textSecondary">
                  Admin detail
                </div>
                <div className="text-[12px] text-textSecondary">
                  Primary media asset:{' '}
                  <span className="font-black text-textPrimary">
                    {item.admin.primaryMediaAssetId}
                  </span>
                </div>
                <div className="text-[12px] text-textSecondary">
                  Media visibility:{' '}
                  <span className="font-black text-textPrimary">
                    {item.admin.primaryMedia.visibility}
                  </span>
                </div>
                <div className="text-[12px] text-textSecondary">
                  Eligible for Looks:{' '}
                  <span className="font-black text-textPrimary">
                    {item.admin.primaryMedia.isEligibleForLooks ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="text-[12px] text-textSecondary">
                  Featured in portfolio:{' '}
                  <span className="font-black text-textPrimary">
                    {item.admin.primaryMedia.isFeaturedInPortfolio ? 'Yes' : 'No'}
                  </span>
                </div>
                {item.admin.primaryMedia.reviewBody ? (
                  <div className="text-[12px] text-textSecondary">
                    Review body:{' '}
                    <span className="text-textPrimary">
                      {item.admin.primaryMedia.reviewBody}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-1 flex flex-wrap gap-2">
              <Link
                href={`/professionals/${item.professional.id}`}
                className="inline-flex items-center rounded-full border border-surfaceGlass/18 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass/6"
              >
                View profile
              </Link>
            </div>
          </div>
        </section>
      </main>

      {drawerCtx ? (
        <AvailabilityDrawer
          open={availabilityOpen}
          onClose={closeAvailability}
          context={drawerCtx}
        />
      ) : null}

      <CommentsDrawer
        lookPostId={commentsOpen ? item.id : null}
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        onCountChange={handleCommentCountChange}
        onRequireAuth={redirectToLogin}
      />
    </>
  )
}