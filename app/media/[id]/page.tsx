// app/media/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  MediaType,
  MediaVisibility,
  type Prisma,
} from '@prisma/client'

import MediaFullscreenViewer from '@/app/_components/media/MediaFullscreenViewer'
import OwnerMediaMenu from '@/app/_components/media/OwnerMediaMenu'
import { UI_SIZES } from '@/app/(main)/ui/layoutConstants'
import { getCurrentUser } from '@/lib/currentUser'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { isPubliclyApprovedProStatus } from '@/lib/proTrustState'
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
  isEligibleForLooks: true,
  isFeaturedInPortfolio: true,
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
        'rounded-full border border-white/10 bg-bgPrimary/20',
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
  if (!media || media.visibility !== MediaVisibility.PUBLIC) notFound()

  const viewer = await getCurrentUser().catch(() => null)
  const isOwner =
    viewer?.role === 'PRO' &&
    viewer?.professionalProfile?.id === media.professionalId

  const isApproved = isPubliclyApprovedProStatus(
    media.professional.verificationStatus,
  )

  if (!isOwner && !isApproved) notFound()

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
  const tagNames = media.services
    .map((tag) => tag.service.name.trim())
    .filter((name) => name.length > 0)

  const serviceOptions = isOwner
    ? await prisma.service.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        take: 500,
        select: { id: true, name: true },
      })
    : []

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
            'inline-flex items-center gap-2 rounded-full border border-white/10',
            'bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary',
            'backdrop-blur-xl shadow-[0_14px_40px_rgba(0,0,0,0.55)]',
            'hover:bg-white/10',
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
            initial={{
              caption: media.caption ?? null,
              visibility: media.visibility,
              isEligibleForLooks: media.isEligibleForLooks,
              isFeaturedInPortfolio: media.isFeaturedInPortfolio,
              serviceIds: media.services.map((tag) => tag.serviceId),
            }}
          />
        ) : null
      }
      bottom={
        <div className="pointer-events-none">
          <div className="pointer-events-auto w-full max-w-[560px]">
            <div
              className={cn(
                'rounded-[18px] border border-white/10 bg-bgPrimary/25 backdrop-blur-xl',
                'px-4 py-3',
                'shadow-[0_18px_60px_rgba(0,0,0,0.65)]',
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