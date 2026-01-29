// app/professionals/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ReviewsPanel from '@/app/pro/profile/ReviewsPanel'
import FavoriteButton from './FavoriteButton'
import ShareButton from './ShareButton'
import { moneyToString } from '@/lib/money'
import { sanitizeTimeZone } from '@/lib/timeZone'
import { messageStartHref } from '@/lib/messages'
// If you want the pro footer to show when a pro "views as client"
import ProSessionFooter from '@/app/_components/ProSessionFooter/ProSessionFooter'

// NEW: client overlay for Services tab booking
import ServicesBookingOverlay from './ServicesBookingOverlay'

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
      reviews: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          mediaAssets: true,
          client: { include: { user: true } },
        },
      },
    },
  })

  if (!pro) notFound()

  // ✅ Visibility gate: pending/unapproved pros are only viewable by themselves
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

        {viewer?.role === 'PRO' ? <ProSessionFooter /> : null}
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

  const portfolioMedia = await prisma.mediaAsset.findMany({
    where: {
      professionalId: pro.id,
      visibility: 'PUBLIC',
      isFeaturedInPortfolio: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: { services: { include: { service: true } } },
  })

  const displayName = pro.businessName || 'Beauty professional'
  const avatar = (pro.avatarUrl as string | null | undefined) || null

  const reviewsForUI = (pro.reviews || []).map((rev: any) => {
    const u = rev.client?.user
    const clientName =
      u?.name?.trim()
        ? u.name.trim()
        : u?.email?.trim()
          ? u.email.trim()
          : rev.client?.firstName
            ? `${rev.client.firstName}${rev.client.lastName ? ` ${rev.client.lastName}` : ''}`
            : 'Client'

    return {
      id: rev.id,
      rating: rev.rating,
      headline: rev.headline ?? null,
      body: rev.body ?? null,
      createdAt: new Date(rev.createdAt).toISOString(),
      clientName,
      mediaAssets: (rev.mediaAssets || []).map((m: any) => ({
        id: m.id,
        url: m.url,
        thumbUrl: m.thumbUrl ?? null,
        mediaType: m.mediaType,
        isFeaturedInPortfolio: Boolean(m.isFeaturedInPortfolio),
      })),
    }
  })

  const tabQS = activeTab === 'portfolio' ? '' : `?tab=${activeTab}`
  const fromPath = `/professionals/${pro.id}${tabQS}`
  const loginHref = buildLoginHref(fromPath)

  const mustLogin = !viewer
  const messageHref = mustLogin
  ? loginHref
  : messageStartHref({ kind: 'PRO_PROFILE', professionalId: pro.id })


  // sanitize, always (kept here only if your UI wants to display it)
  const proTimeZone = sanitizeTimeZone(pro.timeZone, 'America/Los_Angeles')

  const tabs = [
    { id: 'portfolio' as const, label: 'Portfolio', href: `/professionals/${pro.id}` },
    { id: 'services' as const, label: 'Services', href: `/professionals/${pro.id}?tab=services` },
    { id: 'reviews' as const, label: 'Reviews', href: `/professionals/${pro.id}?tab=reviews` },
  ]

  return (
    <main className="mx-auto max-w-240 px-4 pb-28 pt-6">
      {/* Header / actions / whatever you already had above... */}

      {/* Example top actions (keep your existing UI) */}
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

      {/* Tabs */}
      <nav className="mt-6 flex gap-2 border-b border-white/10">
        {tabs.map((t) => (
          <TabLink key={t.id} active={activeTab === t.id} href={t.href}>
            {t.label}
          </TabLink>
        ))}
      </nav>

      {/* Portfolio */}
      {activeTab === 'portfolio' ? (
        <section className="pt-4">
          {portfolioMedia.length === 0 ? (
            <EmptyBox>No portfolio posts yet.</EmptyBox>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {portfolioMedia.map((m: any) => {
                const src = m.thumbUrl || m.url
                const isVideo = m.mediaType === 'VIDEO'
                return (
                  <Link
                    key={m.id}
                    href={`/media/${m.id}`}
                    className="group relative block aspect-square overflow-hidden rounded-[18px] border border-white/10 bg-bgSecondary"
                    title={m.caption || 'Open'}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={m.caption || 'Portfolio'} className="h-full w-full object-cover" />
                    {isVideo ? (
                      <div className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[10px] font-black text-white">
                        VIDEO
                      </div>
                    ) : null}
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      ) : null}

      {/* SERVICES (now uses overlay, no /offerings links, no proTimeZone query param) */}
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

      {/* REVIEWS */}
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

      {viewer?.role === 'PRO' ? <ProSessionFooter /> : null}
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
