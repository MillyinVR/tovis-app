// app/professionals/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ReviewsPanel from '@/app/pro/profile/ReviewsPanel'
import FavoriteButton from './FavoriteButton'
import ShareButton from './ShareButton'
import { moneyToString } from '@/lib/money'

// If you want the pro footer to show when a pro "views as client"
import ProSessionFooter from '@/app/pro/_components/ProSessionFooter/ProSessionFooter'

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

        {/* show pro footer if they’re the pro and ended up here */}
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
  const servicesHref = `/professionals/${pro.id}?tab=services`
  const messageHref = mustLogin ? loginHref : `/messages?to=${pro.id}`

  const proTimeZone = typeof pro.timeZone === 'string' && pro.timeZone.trim() ? pro.timeZone.trim() : null

  const tabs = [
    { id: 'portfolio' as const, label: 'Portfolio', href: `/professionals/${pro.id}` },
    { id: 'services' as const, label: 'Services', href: `/professionals/${pro.id}?tab=services` },
    { id: 'reviews' as const, label: 'Reviews', href: `/professionals/${pro.id}?tab=reviews` },
  ]

  return (
    <main className="mx-auto max-w-240 px-4 pb-28 pt-6">
      <Link href="/looks" className="inline-block text-[12px] font-black text-textPrimary hover:opacity-80">
        ← Back to Looks
      </Link>

      {/* HEADER CARD */}
      <section className="tovis-glass mt-3 overflow-hidden rounded-card border border-white/10 bg-bgSecondary">
        <div className="h-24 w-full bg-[linear-gradient(135deg,#0f172a_0%,#4b5563_50%,#020617_100%)]" />

        <div className="relative -mt-10 flex gap-4 p-4">
          {/* avatar */}
          <div className="h-20 w-20 overflow-hidden rounded-full border-[3px] border-bgSecondary bg-bgPrimary">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center text-[26px] font-black text-textPrimary">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          {/* name + meta */}
          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-black text-textPrimary">{displayName}</div>
            <div className="mt-0.5 text-[12px] font-black text-textSecondary">
              {pro.professionType || 'Beauty professional'}
              {pro.location ? ` • ${pro.location}` : ''}
            </div>
            {pro.bio ? <div className="mt-2 max-w-130 text-[13px] text-textSecondary">{pro.bio}</div> : null}
          </div>

          {/* right controls */}
          <div className="relative z-10 grid shrink-0 justify-items-end gap-2">
            <div className="flex gap-4 text-right text-[11px] text-textSecondary">
              <div>
                <div className="text-[12px] font-black text-textPrimary">{reviewCount > 0 ? averageRating : '–'}</div>
                <div>Rating</div>
              </div>
              <div>
                <div className="text-[12px] font-black text-textPrimary">{reviewCount}</div>
                <div>Reviews</div>
              </div>
              <div>
                <div className="text-[12px] font-black text-textPrimary">{favoritesCount}</div>
                <div>Favorites</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isClientViewer ? (
                <FavoriteButton professionalId={pro.id} initialFavorited={isFavoritedByMe} initialCount={favoritesCount} />
              ) : (
                <Link
                  href={loginHref}
                  className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-bgPrimary text-[18px] text-textPrimary hover:border-white/20"
                  title="Log in to favorite"
                >
                  ♡
                </Link>
              )}

              <ShareButton />

              {isOwner ? (
                <Link
                  href="/pro/profile"
                  className="rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
                >
                  Edit
                </Link>
              ) : (
                <Link
                  href={messageHref}
                  className="rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
                  title={mustLogin ? 'Log in to message' : 'Message'}
                >
                  Message
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 pb-4">
          <Link
            href={servicesHref}
            className="inline-block rounded-full bg-accentPrimary px-4 py-3 text-[13px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
            title={mustLogin ? 'Log in to book' : `View services for ${displayName}`}
          >
            View services
          </Link>

          {mustLogin ? <div className="mt-2 text-[12px] text-textSecondary">Log in to book, favorite, or message.</div> : null}
        </div>
      </section>

      {/* TABS */}
      <nav className="mt-4 flex gap-2 border-b border-white/10 pb-3">
        {tabs.map((t) => {
          const isActive = activeTab === t.id
          return (
            <Link
              key={t.id}
              href={t.href}
              className={[
                'rounded-full border px-3 py-2 text-[13px] font-black transition',
                isActive
                  ? 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary'
                  : 'border-white/10 bg-bgSecondary text-textPrimary hover:border-white/20',
              ].join(' ')}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>

      {/* PORTFOLIO */}
      {activeTab === 'portfolio' ? (
        <section className="mt-4">
          <div className="mb-2 text-[13px] font-black text-textPrimary">Portfolio</div>

          <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-3">
            {portfolioMedia.length === 0 ? (
              <div className="text-[12px] text-textSecondary">No portfolio posts yet.</div>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {portfolioMedia.map((m: any) => {
                  const src = m.thumbUrl || m.url
                  const isVideo = m.mediaType === 'VIDEO'
                  return (
                    <Link
                      key={m.id}
                      href={`/looks/${m.id}`}
                      className="relative block aspect-square overflow-hidden rounded-xl border border-white/10 bg-bgPrimary"
                      title={m.caption || 'View'}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={m.caption || 'Portfolio media'} className="h-full w-full object-cover" />
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
          </div>
        </section>
      ) : null}

      {/* SERVICES */}
      {activeTab === 'services' ? (
        <section className="mt-4">
          <div className="mb-2 text-[13px] font-black text-textPrimary">Services</div>

          <div className="tovis-glass grid gap-2 rounded-card border border-white/10 bg-bgSecondary p-3">
            {pro.offerings.length === 0 ? (
              <div className="text-[12px] text-textSecondary">No services listed yet.</div>
            ) : (
              pro.offerings.map((off: any) => {
                const imgSrc = pickOfferingImage(off)
                const pricingLines = formatOfferingPricing(off)

                const qs = new URLSearchParams()
                qs.set('source', 'REQUESTED')
                if (proTimeZone) qs.set('proTimeZone', proTimeZone)

                const offeringHref = `/offerings/${off.id}?${qs.toString()}`

                return (
                  <Link
                    key={off.id}
                    href={offeringHref}
                    className="flex items-start justify-between gap-3 rounded-card border border-white/10 bg-bgPrimary p-3 text-textPrimary hover:border-white/20"
                    title="Book this service"
                  >
                    <div className="flex min-w-0 flex-1 gap-3">
                      <div className="h-13 w-13 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-bgSecondary">
                        {imgSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imgSrc} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </div>

                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-black">
                          {off.title || off.service?.name}
                        </div>

                        {off.description ? (
                          <div className="mt-1 text-[12px] text-textSecondary">{off.description}</div>
                        ) : null}

                        {pricingLines.length ? (
                          <div className="mt-2 grid gap-1 text-[12px] text-textPrimary">
                            {pricingLines.map((line: string) => (
                              <div key={line} className="text-textSecondary">
                                {line}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 text-[12px] text-textSecondary opacity-80">Pricing not set</div>
                        )}
                      </div>
                    </div>

                    <div className="grid justify-items-end gap-2">
                      <div className="rounded-full bg-accentPrimary px-3 py-2 text-[12px] font-black text-bgPrimary">
                        Book
                      </div>
                      <div className="text-[12px] text-textSecondary">→</div>
                    </div>
                  </Link>
                )
              })
            )}
          </div>
        </section>
      ) : null}

      {/* REVIEWS */}
      {activeTab === 'reviews' ? (
        <section className="mt-4">
          <div className="mb-2 text-[13px] font-black text-textPrimary">Reviews</div>
          <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-3">
            <ReviewsPanel reviews={reviewsForUI} />
          </div>
        </section>
      ) : null}

      {/* ✅ If a pro is viewing this page (ex: "view as client"), show the pro footer */}
      {viewer?.role === 'PRO' ? <ProSessionFooter /> : null}
    </main>
  )
}
