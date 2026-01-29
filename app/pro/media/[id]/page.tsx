// app/media/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import MediaFullscreenViewer from '@/app/_components/media/MediaFullscreenViewer'
import OwnerMediaMenu from '@/app/_components/media/OwnerMediaMenu'
import { UI_SIZES } from '@/app/(main)/ui/layoutConstants'

type PageProps = {
  params: Promise<{ id: string }>
}

type Visibility = 'PUBLIC' | 'PRIVATE'

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function formatCount(n: number) {
  const v = Number.isFinite(n) ? Math.max(0, n) : 0
  if (v >= 1_000_000) return `${Math.round(v / 100_000) / 10}M`
  if (v >= 100_000) return `${Math.round(v / 1000)}K`
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}K`
  return String(v)
}

export default async function PublicMediaDetailPage({ params }: PageProps) {
  const { id: rawId } = await params
  const id = pickString(rawId)
  if (!id) notFound()

  const media = await prisma.mediaAsset.findUnique({
    where: { id },
    select: {
      id: true,
      url: true,
      caption: true,
      mediaType: true,
      visibility: true,
      professionalId: true,
      isEligibleForLooks: true,
      isFeaturedInPortfolio: true,
      services: { select: { serviceId: true, service: { select: { name: true } } } },
      _count: { select: { likes: true, comments: true } },
    },
  })

  // Only PUBLIC media is viewable on this route
  if (!media || (media.visibility as Visibility) !== 'PUBLIC') notFound()

  const viewer = await getCurrentUser().catch(() => null)
  const isOwner =
    viewer?.role === 'PRO' &&
    viewer?.professionalProfile?.id &&
    viewer.professionalProfile.id === media.professionalId

  const backHref = `/professionals/${media.professionalId}`
  const isVideo = media.mediaType === 'VIDEO'

  const tags = (media.services || [])
    .map((t) => (t.service?.name || '').trim())
    .filter(Boolean)
    .slice(0, 6)

  const serviceOptions = isOwner
    ? await prisma.service.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        take: 500,
        select: { id: true, name: true },
      })
    : []

  const likeCount = Number(media._count.likes) || 0
  const commentCount = Number(media._count.comments) || 0
  const footerOffsetPx = UI_SIZES.footerHeight ?? 0

  const hasLowerThird = Boolean(media.caption?.trim() || tags.length)

  return (
    <MediaFullscreenViewer
      src={media.url}
      mediaType={isVideo ? 'VIDEO' : 'IMAGE'}
      alt={media.caption || 'Media'}
      fit="contain"
      showGradients
      footerOffsetPx={footerOffsetPx}
      topLeft={
        <Link
          href={backHref}
          className={cx(
            'inline-flex items-center gap-2 rounded-full',
            'border border-white/12 bg-bgPrimary/18 px-4 py-2',
            'text-[12px] font-black text-textPrimary backdrop-blur-xl',
            'shadow-[0_14px_40px_rgba(0,0,0,0.50)]',
            'hover:bg-white/10 active:scale-[0.99] transition',
          )}
          aria-label="Back to profile"
        >
          <span aria-hidden>←</span>
          <span>Back to profile</span>
        </Link>
      }
      topRight={
        <div className="flex items-start gap-2">
          {/* engagement pill (TikTok-y, but quiet-luxury) */}
          <div
            className={cx(
              'select-none rounded-full',
              'border border-white/12 bg-bgPrimary/18 px-3 py-2',
              'backdrop-blur-xl',
              'shadow-[0_14px_40px_rgba(0,0,0,0.50)]',
            )}
            aria-label="Engagement"
          >
            <div className="flex items-center gap-2 text-[12px] font-black text-textPrimary">
              <span>{formatCount(likeCount)} likes</span>
              <span className="text-white/45">•</span>
              <span>{formatCount(commentCount)} comments</span>
            </div>
          </div>

          {/* owner menu */}
          {isOwner ? (
            <OwnerMediaMenu
              mediaId={media.id}
              serviceOptions={serviceOptions}
              initial={{
                caption: media.caption ?? null,
                visibility: media.visibility as Visibility,
                isEligibleForLooks: Boolean(media.isEligibleForLooks),
                isFeaturedInPortfolio: Boolean(media.isFeaturedInPortfolio),
                serviceIds: (media.services || []).map((s) => s.serviceId).filter(Boolean),
              }}
            />
          ) : null}
        </div>
      }
      bottom={
        hasLowerThird ? (
          // ✅ TRUE TikTok behavior:
          // bottom overlay is a floating “lower third” that sits ABOVE footerOffsetPx (handled in MediaFullscreenViewer)
          <div className="pointer-events-none">
            <div className="pointer-events-auto mx-auto w-full max-w-[560px]">
              <div
                className={cx(
                  'rounded-[20px] border border-white/12',
                  'bg-bgPrimary/18 backdrop-blur-xl',
                  'px-4 py-3',
                  'shadow-[0_22px_70px_rgba(0,0,0,0.70)]',
                )}
              >
                {/* Caption */}
                {media.caption?.trim() ? (
                  <div className="text-[14px] font-black leading-snug text-textPrimary">
                    {media.caption.trim()}
                  </div>
                ) : null}

                {/* Tags */}
                {tags.length ? (
                  <div className={cx('mt-2 flex flex-wrap gap-2', media.caption?.trim() ? '' : 'mt-0')}>
                    {tags.map((name, idx) => (
                      <span
                        key={`${name}_${idx}`}
                        className={cx(
                          'rounded-full px-3 py-1',
                          'border border-white/12 bg-bgPrimary/14',
                          'text-[12px] font-extrabold text-textPrimary',
                          'backdrop-blur-xl',
                        )}
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                ) : null}

                {/* Micro-hint (only for owners, ultra subtle) */}
                {isOwner ? (
                  <div className="mt-2 text-[11px] font-semibold text-white/45">
                    Manage with ⋯
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null
      }
    />
  )
}
