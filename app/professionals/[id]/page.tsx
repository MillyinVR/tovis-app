// app/professionals/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ReviewsPanel from '@/app/pro/profile/ReviewsPanel'
import FavoriteButton from './FavoriteButton'
import ShareButton from './ShareButton'
import { moneyToString } from '@/lib/money'
import { messageStartHref } from '@/lib/messages'
import ServicesBookingOverlay from './ServicesBookingOverlay'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { MediaType, MediaVisibility } from '@prisma/client'
import { pickString } from '@/lib/pick'

function hasStoragePointers<T extends { storageBucket: unknown; storagePath: unknown }>(
  m: T,
): m is T & { storageBucket: string; storagePath: string } {
  const b = pickString(m.storageBucket)
  const p = pickString(m.storagePath)
  return Boolean(b && p)
}
export const dynamic = 'force-dynamic'

type SearchParams = { [key: string]: string | string[] | undefined }

function getActiveTab(tabRaw: unknown): 'portfolio' | 'services' | 'reviews' {
  const tab = typeof tabRaw === 'string' ? tabRaw : Array.isArray(tabRaw) ? tabRaw[0] : undefined
  return tab === 'services' || tab === 'reviews' ? tab : 'portfolio'
}

function buildLoginHref(fromPath: string) {
  return `/login?from=${encodeURIComponent(fromPath)}`
}

function pickOfferingImage(off: { customImageUrl?: string | null; service?: { defaultImageUrl?: string | null } }) {
  const src = (off.customImageUrl || off.service?.defaultImageUrl || '').trim()
  return src || null
}

function formatOfferingPricing(off: any) {
  const lines: string[] = []

  const salonPrice = off.salonPriceStartingAt ? moneyToString(off.salonPriceStartingAt) : null
  const salonMin = off.salonDurationMinutes ?? null

  const mobilePrice = off.mobilePriceStartingAt ? moneyToString(off.mobilePriceStartingAt) : null
  const mobileMin = off.mobileDurationMinutes ?? null

  if (off.offersInSalon && salonPrice && salonMin) lines.push(`Salon: $${salonPrice} • ${salonMin} min`)
  if (off.offersMobile && mobilePrice && mobileMin) lines.push(`Mobile: $${mobilePrice} • ${mobileMin} min`)

  return lines
}

function displayTimeZoneOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const tz = raw.trim()
  if (!tz) return null
  return isValidIanaTimeZone(tz) ? tz : null
}

export default async function PublicProfessionalProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<SearchParams>
}) {
  const { id } = await params
  if (!id) notFound()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const activeTab = getActiveTab(resolvedSearchParams?.tab)

  const viewer = await getCurrentUser().catch(() => null)

  const pro = await prisma.professionalProfile.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      verificationStatus: true,
      businessName: true,
      bio: true,
      avatarUrl: true,
      professionType: true,
      location: true,
      timeZone: true,
      offerings: {
        where: { isActive: true },
        include: {
          service: { select: { id: true, name: true, defaultImageUrl: true } },
        },
        orderBy: { createdAt: 'asc' },
      },

      // ✅ Select helpfulCount explicitly + only fields we use
      reviews: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          rating: true,
          headline: true,
          body: true,
          createdAt: true,
          helpfulCount: true,

          client: {
            select: {
              firstName: true,
              lastName: true,
              user: { select: { email: true } },
            },
          },

          mediaAssets: {
            select: {
              id: true,
              mediaType: true,
              isFeaturedInPortfolio: true,
              url: true,
              thumbUrl: true,
              storageBucket: true,
              storagePath: true,
              thumbBucket: true,
              thumbPath: true,
            },
          },
        },
      },
    },
  })

  if (!pro) notFound()

  // Visibility gate: pending/unapproved pros are only viewable by themselves
  const isOwner = viewer?.role === 'PRO' && viewer?.professionalProfile?.id === pro.id
  const isApproved = pro.verificationStatus === 'APPROVED'

  if (!isOwner && !isApproved) {
    return (
      <main className="mx-auto max-w-180 px-4 pb-24 pt-10">
        <Link href="/looks" className="text-[12px] font-black text-textPrimary hover:opacity-80">
          ← Back to Looks
        </Link>

        <div className="tovis-glass mt-4 rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="text-[16px] font-black text-textPrimary">This profile is pending verification</div>
          <div className="mt-2 text-[13px] text-textSecondary">
            We’re verifying the professional’s license and details. Check back soon.
          </div>
        </div>
      </main>
    )
  }

  const reviewStats = await prisma.review.aggregate({
    where: { professionalId: pro.id },
    _count: { _all: true },
    _avg: { rating: true },
  })

  const reviewCount: number = reviewStats?._count?._all ?? 0
  const averageRating = typeof reviewStats?._avg?.rating === 'number' ? reviewStats._avg.rating.toFixed(1) : null

  const favoritesCount = await prisma.professionalFavorite.count({
    where: { professionalId: pro.id },
  })

  const isClientViewer = viewer?.role === 'CLIENT' && !!viewer?.id

  const isFavoritedByMe = isClientViewer
    ? !!(await prisma.professionalFavorite.findUnique({
        where: { professionalId_userId: { professionalId: pro.id, userId: viewer!.id } },
        select: { id: true },
      }))
    : false

  // Client-facing portfolio: PUBLIC + featured only
  const portfolioMedia = await prisma.mediaAsset.findMany({
    where: {
      professionalId: pro.id,
      visibility: MediaVisibility.PUBLIC,
      isFeaturedInPortfolio: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: {
      id: true,
      caption: true,
      mediaType: true,
      storageBucket: true,
      storagePath: true,
      thumbBucket: true,
      thumbPath: true,
      url: true,
      thumbUrl: true,
    },
  })

  // Build render-safe tiles (filter out any broken legacy rows)
  const portfolioTiles = (
    await Promise.all(
      portfolioMedia.map(async (m) => {
        if (!hasStoragePointers(m)) return null

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

        return {
          id: m.id,
          caption: m.caption ?? null,
          mediaType: m.mediaType,
          isVideo: m.mediaType === MediaType.VIDEO,
          src,
        }
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => Boolean(x))

  const displayName = pro.businessName || 'Beauty professional'
  const avatar = (pro.avatarUrl as string | null | undefined) || null

  // ✅ Spotlight support: which reviews has this viewer marked helpful?
  const viewerHelpfulSet = new Set<string>()
  if (isClientViewer && pro.reviews.length) {
    const reviewIds = pro.reviews.map((r) => r.id)
    const helpfulRows = await prisma.reviewHelpful.findMany({
      where: { userId: viewer!.id, reviewId: { in: reviewIds } },
      select: { reviewId: true },
    })
    for (const row of helpfulRows) viewerHelpfulSet.add(row.reviewId)
  }

  // ReviewsPanel expects mediaAssets[].url as renderable string
  const reviewsForUI = await Promise.all(
    pro.reviews.map(async (rev) => {
      const first = (rev.client?.firstName ?? '').trim()
      const last = (rev.client?.lastName ?? '').trim()
      const fullName = [first, last].filter(Boolean).join(' ')
      const email = (rev.client?.user?.email ?? '').trim()

      const clientName = fullName || email || 'Client'

      const mediaAssets = (
        await Promise.all(
          (rev.mediaAssets || []).map(async (m) => {
            if (!hasStoragePointers(m)) return null

            const { renderUrl, renderThumbUrl } = await renderMediaUrls({
              storageBucket: m.storageBucket,
              storagePath: m.storagePath,
              thumbBucket: m.thumbBucket ?? null,
              thumbPath: m.thumbPath ?? null,
              url: m.url ?? null,
              thumbUrl: m.thumbUrl ?? null,
            })

            const url = (renderUrl ?? '').trim()
            if (!url) return null

            return {
              id: m.id,
              url,
              thumbUrl: renderThumbUrl ?? null,
              mediaType: m.mediaType,
              isFeaturedInPortfolio: Boolean(m.isFeaturedInPortfolio),
            }
          }),
        )
      ).filter((x): x is NonNullable<typeof x> => Boolean(x))

      return {
        id: rev.id,
        rating: rev.rating,
        headline: rev.headline ?? null,
        body: rev.body ?? null,
        createdAt: new Date(rev.createdAt).toISOString(),
        clientName,
        mediaAssets,

        // ✅ Spotlight fuel fields
        helpfulCount: rev.helpfulCount ?? 0,
        viewerHelpful: viewerHelpfulSet.has(rev.id),
      }
    }),
  )

  const tabQS = activeTab === 'portfolio' ? '' : `?tab=${activeTab}`
  const fromPath = `/professionals/${pro.id}${tabQS}`
  const loginHref = buildLoginHref(fromPath)

  const mustLogin = !viewer
  const messageHref = mustLogin ? loginHref : messageStartHref({ kind: 'PRO_PROFILE', professionalId: pro.id })

  const proTimeZone = displayTimeZoneOrNull(pro.timeZone)

  const tabs = [
    { id: 'portfolio' as const, label: 'Portfolio', href: `/professionals/${pro.id}` },
    { id: 'services' as const, label: 'Services', href: `/professionals/${pro.id}?tab=services` },
    { id: 'reviews' as const, label: 'Reviews', href: `/professionals/${pro.id}?tab=reviews` },
  ]

  return (
    <main className="mx-auto max-w-240 px-4 pb-28 pt-6">
      <section className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="flex items-start justify-between gap-3">
          <Link href="/looks" className="text-[12px] font-black text-textSecondary hover:text-textPrimary">
            ← Back to Looks
          </Link>

          <div className="flex items-center gap-2">
            <ShareButton url={`/professionals/${pro.id}`} />
            {isClientViewer ? <FavoriteButton professionalId={pro.id} initialFavorited={isFavoritedByMe} /> : null}
          </div>
        </div>

        <div className="mt-4 flex items-start gap-4">
          <div className="h-16 w-16 overflow-hidden rounded-full border border-white/10 bg-bgPrimary/25">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt={displayName} className="h-full w-full object-cover" />
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-[20px] font-black text-textPrimary">{displayName}</div>
            <div className="mt-1 text-[13px] text-textSecondary">
              {(pro.professionType || 'Beauty professional') + (pro.location ? ` • ${pro.location}` : '')}
            </div>

            {pro.bio ? <div className="mt-3 text-[13px] text-textSecondary">{pro.bio}</div> : null}

            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={messageHref}
                className="rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-[13px] font-black text-textPrimary hover:bg-white/10"
              >
                Message
              </Link>

              {proTimeZone ? (
                <div className="rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textSecondary">
                  Time zone: <span className="text-textPrimary">{proTimeZone}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat label="Rating" value={reviewCount ? averageRating || '–' : '–'} />
          <Stat label="Reviews" value={String(reviewCount)} />
          <Stat label="Favorites" value={String(favoritesCount)} />
        </div>
      </section>

      <nav className="mt-6 flex gap-2 border-b border-white/10">
        {tabs.map((t) => (
          <TabLink key={t.id} active={activeTab === t.id} href={t.href}>
            {t.label}
          </TabLink>
        ))}
      </nav>

      {activeTab === 'portfolio' ? (
        <section className="pt-4">
          {portfolioTiles.length === 0 ? (
            <EmptyBox>No portfolio posts yet.</EmptyBox>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {portfolioTiles.map((m) => (
                <Link
                  key={m.id}
                  href={`/media/${m.id}`}
                  className="group relative block aspect-square overflow-hidden rounded-[18px] border border-white/10 bg-bgSecondary"
                  title={m.caption || 'Open'}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.src} alt={m.caption || 'Portfolio'} className="h-full w-full object-cover" />
                  {m.isVideo ? (
                    <div className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[10px] font-black text-white">
                      VIDEO
                    </div>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'services' ? (
        <section className="mt-4">
          <div className="mb-2 text-[13px] font-black text-textPrimary">Services</div>

          {pro.offerings.length === 0 ? (
            <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-3 text-[12px] text-textSecondary">
              No services listed yet.
            </div>
          ) : (
            <ServicesBookingOverlay
              professionalId={pro.id}
              offerings={pro.offerings.map((off: any) => ({
                id: String(off.id),
                serviceId: String(off.serviceId),
                name: String(off.title || off.service?.name || 'Service'),
                description: off.description ?? null,
                imageUrl: pickOfferingImage(off),
                pricingLines: formatOfferingPricing(off),
              }))}
            />
          )}
        </section>
      ) : null}

      {activeTab === 'reviews' ? (
        <section className="pt-4">
          {reviewCount === 0 ? (
            <EmptyBox>No reviews yet.</EmptyBox>
          ) : (
            <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-3 sm:p-4">
              <ReviewsPanel reviews={reviewsForUI} />
            </div>
          )}
        </section>
      ) : null}
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-white/10 bg-bgSecondary p-3 text-center">
      <div className="text-[18px] font-black text-textPrimary">{value}</div>
      <div className="mt-1 text-[11px] font-extrabold text-textSecondary">{label}</div>
    </div>
  )
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={[
        'border-b-2 px-3 py-3 text-[13px] font-black transition-colors',
        active ? 'border-accentPrimary text-textPrimary' : 'border-transparent text-textSecondary hover:text-textPrimary',
      ].join(' ')}
    >
      {children}
    </Link>
  )
}

function EmptyBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[13px] text-textSecondary">{children}</div>
  )
}