// app/(main)/looks/[id]/LookDetailClient.tsx
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useBrand } from '@/lib/brand/BrandProvider'
import { safeJson } from '@/lib/http'
import { parseLooksCommentsResponse } from '@/lib/looks/parsers'
import type {
  LooksCommentDto,
  LooksDetailItemDto,
} from '@/lib/looks/types'
import {
  loadViewerLocation,
  subscribeViewerLocation,
  viewerLocationToDrawerContextFields,
  type ViewerLocation,
} from '@/lib/viewerLocation'

import AvailabilityDrawer from '../../booking/AvailabilityDrawer'
import type { DrawerContext as AvailabilityDrawerContext } from '../../booking/AvailabilityDrawer/types'
import CommentsDrawer from '../_components/CommentsDrawer'
import RightActionRail from '../_components/RightActionRail'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function currentLooksDetailPath(lookPostId: string): string {
  return `/looks/${encodeURIComponent(lookPostId)}`
}

function readErrorMessage(raw: unknown, fallback: string): string {
  if (isRecord(raw)) {
    const error = pickString(raw.error)
    if (error) return error
  }

  return fallback
}

function isGuestBlocked(status: number): boolean {
  return status === 401
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
  const [comments, setComments] = useState<LooksCommentDto[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [commentText, setCommentText] = useState('')
  const [posting, setPosting] = useState(false)

  const [viewerLoc, setViewerLoc] = useState<ViewerLocation | null>(null)
  const [availabilityOpen, setAvailabilityOpen] = useState(false)
  const [drawerCtx, setDrawerCtx] = useState<AvailabilityDrawerContext | null>(null)

  useEffect(() => {
    setViewerLoc(loadViewerLocation())
    return subscribeViewerLocation(setViewerLoc)
  }, [])

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

  const closeAvailability = useCallback(() => {
    setAvailabilityOpen(false)
    window.setTimeout(() => setDrawerCtx(null), 150)
  }, [])

  const openAvailability = useCallback(() => {
    if (!item.professional?.id) return

    setDrawerCtx({
      mediaId: null,
      professionalId: item.professional.id,
      serviceId: item.service?.id ?? null,
      source: 'DISCOVERY',
      ...viewerLocationToDrawerContextFields(viewerLoc),
    })
    setAvailabilityOpen(true)
  }, [item.professional?.id, item.service?.id, viewerLoc])

  const loadComments = useCallback(async () => {
    setCommentsLoading(true)
    setCommentError(null)

    try {
      const res = await fetch(`/api/looks/${encodeURIComponent(item.id)}/comments`, {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      })

      const raw = await safeJson(res)

      if (isGuestBlocked(res.status)) {
        setCommentsOpen(false)
        redirectToLogin('comment')
        return
      }

      if (!res.ok) {
        throw new Error(readErrorMessage(raw, 'Failed to load comments'))
      }

      setComments(parseLooksCommentsResponse(raw))
    } catch (error) {
      setCommentError(
        error instanceof Error ? error.message : 'Failed to load comments',
      )
    } finally {
      setCommentsLoading(false)
    }
  }, [item.id, redirectToLogin])

  const openComments = useCallback(async () => {
    setCommentsOpen(true)
    setCommentText('')
    await loadComments()
  }, [loadComments])

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
      const res = await fetch(`/api/looks/${encodeURIComponent(lookPostId)}/like`, {
        method: beforeLiked ? 'DELETE' : 'POST',
      })

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

  const postComment = useCallback(async () => {
    if (posting) return

    const body = commentText.trim()
    if (!body) return

    setPosting(true)
    setCommentError(null)

    const tempId = `temp_${Date.now()}`

    const optimistic: LooksCommentDto = {
      id: tempId,
      body,
      createdAt: new Date().toISOString(),
      user: {
        id: 'viewer',
        displayName: 'You',
        avatarUrl: null,
      },
    }

    setComments((prev) => [optimistic, ...prev])
    setCommentText('')
    setItem((prev) => ({
      ...prev,
      _count: {
        ...prev._count,
        comments: prev._count.comments + 1,
      },
    }))

    try {
      const res = await fetch(`/api/looks/${encodeURIComponent(item.id)}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ body }),
      })

      const raw = await safeJson(res)

      if (isGuestBlocked(res.status)) {
        setComments((prev) => prev.filter((comment) => comment.id !== tempId))
        setItem((prev) => ({
          ...prev,
          _count: {
            ...prev._count,
            comments: Math.max(0, prev._count.comments - 1),
          },
        }))
        redirectToLogin('comment')
        return
      }

      if (!res.ok) {
        setComments((prev) => prev.filter((comment) => comment.id !== tempId))
        setItem((prev) => ({
          ...prev,
          _count: {
            ...prev._count,
            comments: Math.max(0, prev._count.comments - 1),
          },
        }))
        setCommentError(readErrorMessage(raw, 'Failed to post comment'))
        return
      }

      await loadComments()
    } catch (error) {
      setComments((prev) => prev.filter((comment) => comment.id !== tempId))
      setItem((prev) => ({
        ...prev,
        _count: {
          ...prev._count,
          comments: Math.max(0, prev._count.comments - 1),
        },
      }))
      setCommentError(
        error instanceof Error ? error.message : 'Failed to post comment',
      )
    } finally {
      setPosting(false)
    }
  }, [commentText, item.id, loadComments, posting, redirectToLogin])

  const shareLook = useCallback(async () => {
    if (typeof window === 'undefined') return

    const url = `${window.location.origin}${currentLooksDetailPath(item.id)}`

    try {
      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>
      }

      if (typeof nav.share === 'function') {
        await nav.share({
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
    () =>
      item.assets.filter(
        (asset) => asset.media.id !== item.primaryMedia.id,
      ),
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
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.primaryMedia.url}
                alt={item.caption || 'Look'}
                className="block h-auto w-full"
                loading="lazy"
                decoding="async"
              />
            )}
          </div>

          <RightActionRail
            pro={{
              id: item.professional.id,
              businessName: item.professional.businessName,
              avatarUrl: item.professional.avatarUrl,
            }}
            viewerLiked={item.viewerContext.viewerLiked}
            likeCount={item._count.likes}
            commentCount={item._count.comments}
            bottom={16}
            right={12}
            onOpenAvailability={openAvailability}
            onToggleLike={() => void toggleLike()}
            onOpenComments={() => void openComments()}
            onShare={() => void shareLook()}
          />

          <div className="grid gap-3 p-4">
            <div className="grid gap-1">
              <div className="text-base font-extrabold">
                {item.professional.businessName || 'Beauty professional'}
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
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={previewSrc}
                            alt={asset.media.caption || 'Look asset'}
                            className="h-24 w-full object-cover"
                            loading="lazy"
                            decoding="async"
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
                  Primary media asset:{" "}
                  <span className="font-black text-textPrimary">
                    {item.admin.primaryMediaAssetId}
                  </span>
                </div>
                <div className="text-[12px] text-textSecondary">
                  Media visibility:{" "}
                  <span className="font-black text-textPrimary">
                    {item.admin.primaryMedia.visibility}
                  </span>
                </div>
                <div className="text-[12px] text-textSecondary">
                  Eligible for Looks:{" "}
                  <span className="font-black text-textPrimary">
                    {item.admin.primaryMedia.isEligibleForLooks ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="text-[12px] text-textSecondary">
                  Featured in portfolio:{" "}
                  <span className="font-black text-textPrimary">
                    {item.admin.primaryMedia.isFeaturedInPortfolio ? 'Yes' : 'No'}
                  </span>
                </div>
                {item.admin.primaryMedia.reviewBody ? (
                  <div className="text-[12px] text-textSecondary">
                    Review body:{" "}
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
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        loading={commentsLoading}
        error={commentError}
        comments={comments}
        commentText={commentText}
        setCommentText={setCommentText}
        posting={posting}
        onPost={() => void postComment()}
      />
    </>
  )
}