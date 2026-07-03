// Shared loader for the pro reviews list — the single source of truth for BOTH
// the server-rendered page (app/pro/reviews/page.tsx) and the native read API
// (GET /api/v1/pro/reviews). Runs the review query and resolves render-safe media
// URLs server-side, so the two surfaces never drift.
import type { CurrentUser } from '@/lib/currentUser'

import { MediaType } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { mapPairedBeforeToDto, type PairedBeforeDto } from '@/lib/media/pairedBefore'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { pairedBeforeAssetSelect } from '@/lib/profiles/publicProfileSelects'
import { loadClientLinkViewer } from '@/lib/clientVisibility'

type ClientLinkViewer = Awaited<ReturnType<typeof loadClientLinkViewer>>
import { resolveClientProfileHref } from '@/lib/profiles/profileHrefs'
import { formatInTimeZone } from '@/lib/time'

export type ProReviewMediaTile = {
  id: string
  caption: string | null
  isVideo: boolean
  isFeaturedInPortfolio: boolean
  services: { id: string; serviceName: string }[]
  src: string
  /** Opt-in before/after pairing → render the comparison slider when present. */
  before: PairedBeforeDto | null
}

export type ProReviewListItem = {
  id: string
  rating: number
  headline: string | null
  body: string | null
  bookingId: string | null
  createdAtISO: string
  date: string
  clientName: string
  clientHref: string | null
  reviewAnchor: string
  mediaTiles: ProReviewMediaTile[]
  /** The pro's own public response (null until they reply). */
  proReply: { body: string; repliedAtISO: string } | null
}

function pickNonEmptyString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export async function loadProReviewsList(args: {
  professionalId: string
  viewer: CurrentUser
  clientLinkViewer?: ClientLinkViewer
}): Promise<ProReviewListItem[]> {
  const { professionalId, viewer } = args
  const clientLinkViewer =
    args.clientLinkViewer ?? (await loadClientLinkViewer(viewer))

  const reviews = await prisma.review.findMany({
    where: { professionalId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      client: true,
      mediaAssets: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          caption: true,
          mediaType: true,
          isFeaturedInPortfolio: true,
          storageBucket: true,
          storagePath: true,
          thumbBucket: true,
          thumbPath: true,
          url: true,
          thumbUrl: true,
          // Opt-in before/after pairing → render the comparison slider when present.
          beforeAsset: {
            select: pairedBeforeAssetSelect,
          },
          services: {
            include: { service: true },
          },
        },
      },
    },
  })

  return Promise.all(
    reviews.map(async (rev) => {
      const first = pickNonEmptyString(rev.client?.firstName)
      const last = pickNonEmptyString(rev.client?.lastName)
      const clientName = `${first} ${last}`.trim() || 'Client'
      const clientHref = rev.client
        ? resolveClientProfileHref(
            {
              clientProfileId: rev.client.id,
              handle: rev.client.handle,
              isPublicProfile: rev.client.isPublicProfile,
            },
            clientLinkViewer,
          )
        : null
      const date = formatInTimeZone(rev.createdAt, 'UTC', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })

      const mediaTiles = (
        await Promise.all(
          (rev.mediaAssets || []).map(async (m) => {
            if (!m.storageBucket || !m.storagePath) return null

            const { renderUrl, renderThumbUrl } = await renderMediaUrls({
              storageBucket: m.storageBucket,
              storagePath: m.storagePath,
              thumbBucket: m.thumbBucket ?? null,
              thumbPath: m.thumbPath ?? null,
              url: m.url ?? null,
              thumbUrl: m.thumbUrl ?? null,
            })

            const src = (renderThumbUrl ?? renderUrl ?? '').trim()
            if (!src) return null

            // Only an image "after" carries a pairing (parity with the other mappers).
            const before =
              m.mediaType === MediaType.IMAGE
                ? await mapPairedBeforeToDto(m.beforeAsset)
                : null

            const tile: ProReviewMediaTile = {
              id: m.id,
              caption: m.caption ?? null,
              isVideo: m.mediaType === 'VIDEO',
              isFeaturedInPortfolio: Boolean(m.isFeaturedInPortfolio),
              services: (m.services ?? []).map((s) => ({
                id: s.id,
                serviceName: s.service?.name ?? 'Service',
              })),
              src,
              before,
            }
            return tile
          }),
        )
      ).filter((x): x is ProReviewMediaTile => Boolean(x))

      const item: ProReviewListItem = {
        id: rev.id,
        rating: rev.rating,
        headline: rev.headline ?? null,
        body: rev.body ?? null,
        bookingId: rev.bookingId ?? null,
        createdAtISO: new Date(rev.createdAt).toISOString(),
        date,
        clientName,
        clientHref,
        reviewAnchor: `review-${rev.id}`,
        mediaTiles,
        proReply:
          rev.proReplyBody && rev.proReplyAt
            ? {
                body: rev.proReplyBody,
                repliedAtISO: new Date(rev.proReplyAt).toISOString(),
              }
            : null,
      }
      return item
    }),
  )
}
