// app/media/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  MediaType,
  MediaVisibility,
  type Prisma,
} from '@prisma/client'

import ClientMediaExportButton from '@/app/_components/media/ClientMediaExportButton'
import MediaFullscreenViewer from '@/app/_components/media/MediaFullscreenViewer'
import OwnerMediaMenu from '@/app/_components/media/OwnerMediaMenu'
import { UI_SIZES } from '@/app/(main)/ui/layoutConstants'
import { getCurrentUser } from '@/lib/currentUser'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { resolveCropRect } from '@/lib/media/cropRect'
import {
  cropConsentBound,
  isCropUndoWindowOpen,
} from '@/lib/media/cropUndoWindow'
import { resolveFocalPoint } from '@/lib/media/focalPoint'
import { loadServiceTagOptions } from '@/lib/media/serviceTagOptions'
import { pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { pickServiceTagNames } from '@/lib/profiles/publicProfileMappers'
import { isPubliclyViewableMediaAsset } from '@/lib/media/mediaVisibility'
import { canViewerSeePublicMediaSurface } from '@/lib/proTrustState'
import { cn } from '@/lib/utils'

type PageProps = {
  params: Promise<{ id: string }>
}

const mediaPageSelect = {
  id: true,
  caption: true,
  mediaType: true,
  visibility: true,
  professionalId: true,
  reviewId: true,
  isEligibleForLooks: true,
  isFeaturedInPortfolio: true,
  beforeAssetId: true,
  // Re-framing (capture chain item 4). The rect as stored, plus everything
  // `cropConsentBound` needs to say how far a re-frame may reach — the undo
  // window's own columns and the view totals that close it.
  cropX: true,
  cropY: true,
  cropW: true,
  cropH: true,
  cropUndoBoundX: true,
  cropUndoBoundY: true,
  cropUndoBoundW: true,
  cropUndoBoundH: true,
  cropUndoExpiresAt: true,
  cropUndoViewBaseline: true,
  focalX: true,
  focalY: true,
  lookPostPrimaryFor: { select: { viewCount: true } },
  lookPostAssets: { select: { lookPost: { select: { viewCount: true } } } },
  storageBucket: true,
  storagePath: true,
  thumbBucket: true,
  thumbPath: true,
  url: true,
  thumbUrl: true,
  professional: {
    select: {
      verificationStatus: true,
    },
  },
  services: {
    select: {
      serviceId: true,
      service: {
        select: {
          name: true,
        },
      },
    },
  },
} satisfies Prisma.MediaAssetSelect

type MediaPageRecord = Prisma.MediaAssetGetPayload<{
  select: typeof mediaPageSelect
}>

async function getMediaPageRecord(id: string): Promise<MediaPageRecord | null> {
  return prisma.mediaAsset.findUnique({
    where: { id },
    select: mediaPageSelect,
  })
}

function MetaBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-full border border-surfaceGlass/10 bg-bgPrimary/20',
        'px-3 py-1 text-[11px] font-extrabold text-textPrimary',
        'backdrop-blur-xl',
      )}
    >
      {children}
    </span>
  )
}

export default async function MediaDetailPage({ params }: PageProps) {
  const { id: rawId } = await params
  const id = pickString(rawId)
  if (!id) notFound()

  const media = await getMediaPageRecord(id)
  // 🔴 Not `visibility === PUBLIC` alone. A pro's own upload in the public
  // bucket stays PUBLIC after they retract it (the bytes are world-readable
  // whatever the column says — see lib/media/mediaVisibility.ts); what takes it
  // off this page is the flags. Review media is PUBLIC with both flags false,
  // so `reviewId` is the third way in.
  if (
    !media ||
    !isPubliclyViewableMediaAsset({
      visibility: media.visibility,
      isFeaturedInPortfolio: media.isFeaturedInPortfolio,
      isEligibleForLooks: media.isEligibleForLooks,
      reviewId: media.reviewId,
    })
  ) {
    notFound()
  }

  const viewer = await getCurrentUser().catch(() => null)
  const isOwner =
    viewer?.role === 'PRO' &&
    viewer?.professionalProfile?.id === media.professionalId

  const canViewPublicMediaSurface = canViewerSeePublicMediaSurface({
    viewerRole: viewer?.role ?? null,
    viewerProfessionalId: viewer?.professionalProfile?.id ?? null,
    professionalId: media.professionalId,
    verificationStatus: media.professional.verificationStatus,
    visibility: media.visibility,
  })

  if (!canViewPublicMediaSurface) notFound()

  const { renderUrl } = await renderMediaUrls({
    storageBucket: media.storageBucket,
    storagePath: media.storagePath,
    thumbBucket: media.thumbBucket,
    thumbPath: media.thumbPath,
    url: media.url,
    thumbUrl: media.thumbUrl,
  })

  if (!renderUrl) notFound()

  const backHref = `/professionals/${media.professionalId}`
  const isVideo = media.mediaType === MediaType.VIDEO

  // ── Re-framing (item 4) ────────────────────────────────────────────────────
  //
  // The bound is computed HERE, from the same helper the write uses, so the
  // editor's handles stop exactly where PUT .../crop would refuse. It is still
  // only a courtesy: the route re-reads the row and re-checks inside the write,
  // and this page's answer can be stale by the time the pro presses save.
  const cropNow = new Date()
  const cropViewCountTotal =
    media.lookPostPrimaryFor.reduce((n, p) => n + p.viewCount, 0) +
    media.lookPostAssets.reduce((n, a) => n + a.lookPost.viewCount, 0)
  const cropUndoOpen = isCropUndoWindowOpen(media, {
    now: cropNow,
    viewCountTotal: cropViewCountTotal,
  })
  const reframe =
    isOwner && !isVideo
      ? {
          src: renderUrl,
          crop: resolveCropRect(media.cropX, media.cropY, media.cropW, media.cropH),
          bound: cropConsentBound(media, media, {
            now: cropNow,
            viewCountTotal: cropViewCountTotal,
          }),
          // The focal is a POINT; the planner anchors on a box, so it is widened
          // to a zero-size one centred on it rather than inventing a subject size
          // this row does not carry.
          subject: subjectBoxFromFocal(media.focalX, media.focalY),
          undoNotice: cropUndoOpen
            ? 'You can still widen this back for a day, or until someone views it. After that you can only tighten it.'
            : null,
        }
      : undefined
  const tagNames = pickServiceTagNames(media.services)

  const [serviceOptions, ownerProfile] = isOwner
    ? await Promise.all([
        loadServiceTagOptions(),
        // §18d — is this media the owner's current cover banner?
        prisma.professionalProfile.findUnique({
          where: { id: media.professionalId },
          select: { coverMediaAssetId: true },
        }),
      ])
    : [[], null]

  const isCover = ownerProfile?.coverMediaAssetId === media.id

  const footerOffsetPx = UI_SIZES.footerHeight ?? 0

  return (
    <MediaFullscreenViewer
      src={renderUrl}
      mediaType={isVideo ? 'VIDEO' : 'IMAGE'}
      alt={media.caption || 'Media asset'}
      fit="contain"
      showGradients
      footerOffsetPx={footerOffsetPx}
      topLeft={
        <Link
          href={backHref}
          className={cn(
            'tap-target inline-flex items-center gap-2 rounded-full border border-surfaceGlass/10',
            'bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary',
            'backdrop-blur-xl shadow-[0_14px_40px_rgb(var(--shadow-color)/0.55)]',
            'hover:bg-surfaceGlass/10',
          )}
        >
          ← Back to profile
        </Link>
      }
      topRight={
        isOwner ? (
          <OwnerMediaMenu
            mediaId={media.id}
            serviceOptions={serviceOptions}
            isVideo={isVideo}
            isCover={isCover}
            reframe={reframe}
            initial={{
              caption: media.caption ?? null,
              visibility: media.visibility,
              isEligibleForLooks: media.isEligibleForLooks,
              isFeaturedInPortfolio: media.isFeaturedInPortfolio,
              serviceIds: media.services.map((tag) => tag.serviceId),
              beforeAssetId: media.beforeAssetId ?? null,
            }}
          />
        ) : !isVideo ? (
          <ClientMediaExportButton
            professionalId={media.professionalId}
            className="border border-surfaceGlass/10 bg-bgPrimary/25 backdrop-blur-xl shadow-[0_14px_40px_rgb(var(--shadow-color)/0.55)] hover:bg-white/10"
            media={{ kind: 'single', url: renderUrl }}
          />
        ) : null
      }
      bottom={
        <div className="pointer-events-none">
          <div className="pointer-events-auto w-full max-w-[560px]">
            <div
              className={cn(
                'rounded-[18px] border border-surfaceGlass/10 bg-bgPrimary/25 backdrop-blur-xl',
                'px-4 py-3',
                'shadow-[0_18px_60px_rgb(var(--shadow-color)/0.65)]',
              )}
            >
              <div className="flex flex-wrap gap-2">
                <MetaBadge>{isVideo ? 'Video asset' : 'Image asset'}</MetaBadge>

                {isOwner ? (
                  <>
                    <MetaBadge>Owner media view</MetaBadge>
                    <MetaBadge>
                      {media.visibility === MediaVisibility.PUBLIC
                        ? 'Public media'
                        : 'Client + you'}
                    </MetaBadge>
                    <MetaBadge>
                      {media.isEligibleForLooks
                        ? 'Looks enabled'
                        : 'Looks off'}
                    </MetaBadge>
                    <MetaBadge>
                      {media.isFeaturedInPortfolio
                        ? 'Portfolio featured'
                        : 'Portfolio off'}
                    </MetaBadge>
                  </>
                ) : null}
              </div>

              {media.caption ? (
                <div className="mt-2 text-[14px] font-black leading-snug text-textPrimary">
                  {media.caption}
                </div>
              ) : null}

              {tagNames.length > 0 ? (
                <div className="mt-3">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-textSecondary">
                    Services
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {tagNames.slice(0, 6).map((name) => (
                      <MetaBadge key={name}>{name}</MetaBadge>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      }
    />
  )
}

/**
 * The planner's `subject` is a normalized BOX; a MediaAsset carries a focal
 * POINT. Widening it to a zero-size box centred on the point keeps the anchor
 * maths identical (the planner only ever reads the box's centre) without
 * inventing a subject size the row does not know.
 */
function subjectBoxFromFocal(
  focalX: number | null,
  focalY: number | null,
): { x: number; y: number; width: number; height: number } | null {
  const focal = resolveFocalPoint(focalX, focalY)
  if (!focal) return null
  return { x: focal.x, y: focal.y, width: 0, height: 0 }
}
