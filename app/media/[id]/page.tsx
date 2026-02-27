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

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
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
  if (!media || media.visibility !== 'PUBLIC') notFound()

  // ✅ FIX: url can be null (schema allows it), but this page requires a renderable URL
  if (!media.url) notFound()

  const viewer = await getCurrentUser().catch(() => null)
  const isOwner =
    viewer?.role === 'PRO' &&
    viewer?.professionalProfile?.id &&
    viewer.professionalProfile.id === media.professionalId

  const backHref = `/professionals/${media.professionalId}`
  const isVideo = media.mediaType === 'VIDEO'
  const tags = (media.services || []).map((t) => t.service?.name || '').filter(Boolean)

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
              isEligibleForLooks: Boolean(media.isEligibleForLooks),
              isFeaturedInPortfolio: Boolean(media.isFeaturedInPortfolio),
              serviceIds: (media.services || []).map((s) => s.serviceId).filter(Boolean),
            }}
          />
        ) : null
      }
      bottom={
        <div className="pointer-events-none">
          <div className="pointer-events-auto w-full max-w-[520px]">
            <div
              className={cx(
                'rounded-[18px] border border-white/10 bg-bgPrimary/25 backdrop-blur-xl',
                'px-4 py-3',
                'shadow-[0_18px_60px_rgba(0,0,0,0.65)]',
              )}
            >
              <div className="text-[12px] font-extrabold text-textSecondary">
                {media._count.likes} likes • {media._count.comments} comments
              </div>

              {media.caption ? (
                <div className="mt-1 text-[14px] font-black leading-snug text-textPrimary">{media.caption}</div>
              ) : null}

              {tags.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {tags.slice(0, 6).map((name, idx) => (
                    <span
                      key={`${name}_${idx}`}
                      className={cx(
                        'rounded-full border border-white/10 bg-bgPrimary/20',
                        'px-3 py-1 text-[12px] font-extrabold text-textPrimary',
                        'backdrop-blur-xl',
                      )}
                    >
                      {name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      }
    />
  )
}