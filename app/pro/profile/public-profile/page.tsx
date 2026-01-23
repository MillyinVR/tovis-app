// app/pro/profile/public-profile/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ReviewsPanel from '../ReviewsPanel'
import EditProfileButton from './EditProfileButton'
import ShareButton from './ShareButton'
import { moneyToString } from '@/lib/money'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type SearchParams = { [key: string]: string | string[] | undefined }
type TabKey = 'portfolio' | 'services' | 'reviews'

const ROUTES = {
  proHome: '/pro',
  proServices: '/pro/services',
  proMessages: '/pro/messages',
  proMedia: '/pro/media',
  proMediaNew: '/pro/media/new',
  proPublicProfile: '/pro/profile/public-profile',
} as const

function pickTab(resolved: SearchParams | undefined): TabKey {
  const raw =
    typeof resolved?.tab === 'string'
      ? resolved.tab
      : Array.isArray(resolved?.tab)
        ? resolved.tab[0]
        : undefined

  return raw === 'services' || raw === 'reviews' ? raw : 'portfolio'
}

function pickOfferingImage(off: { customImageUrl?: string | null; service?: { defaultImageUrl?: string | null } | null }) {
  const src = (off.customImageUrl || off.service?.defaultImageUrl || '').trim()
  return src || null
}

type MoneyLike = string | number | Prisma.Decimal | null | undefined

function toMoneyLike(v: unknown): MoneyLike {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    const n = Number(s)
    return Number.isFinite(n) ? n : s
  }
  if (typeof v === 'object') {
    const anyObj = v as { toString?: () => string }
    if (typeof anyObj.toString === 'function') return anyObj.toString()
  }
  return null
}

function pickOfferingPrice(off: {
  salonPriceStartingAt?: unknown | null
  mobilePriceStartingAt?: unknown | null
  service?: { minPrice?: unknown | null } | null
}): MoneyLike {
  return toMoneyLike(off.salonPriceStartingAt ?? off.mobilePriceStartingAt ?? off.service?.minPrice ?? null)
}

function pickOfferingDuration(off: {
  salonDurationMinutes?: number | null
  mobileDurationMinutes?: number | null
  service?: { defaultDurationMinutes?: number | null } | null
}) {
  return (
    (typeof off.salonDurationMinutes === 'number' ? off.salonDurationMinutes : null) ??
    (typeof off.mobileDurationMinutes === 'number' ? off.mobileDurationMinutes : null) ??
    (typeof off.service?.defaultDurationMinutes === 'number' ? off.service.defaultDurationMinutes : null)
  )
}

function formatClientName(input: { userEmail?: string | null; firstName?: string | null; lastName?: string | null }) {
  const email = (input.userEmail || '').trim()
  if (email) return email

  const first = (input.firstName || '').trim()
  const last = (input.lastName || '').trim()
  const full = [first, last].filter(Boolean).join(' ').trim()
  return full || 'Client'
}

export default async function ProPublicProfilePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect(`/login?from=${encodeURIComponent(ROUTES.proPublicProfile)}`)
  }

  const resolved = await searchParams
  const tab = pickTab(resolved)
  const proId = user.professionalProfile.id

  // ✅ Tight select: only what the page renders
  const pro = await prisma.professionalProfile.findUnique({
    where: { id: proId },
    select: {
      id: true,
      businessName: true,
      bio: true,
      location: true,
      avatarUrl: true,
      professionType: true,
      offerings: {
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          description: true,
          customImageUrl: true,
          salonPriceStartingAt: true,
          mobilePriceStartingAt: true,
          salonDurationMinutes: true,
          mobileDurationMinutes: true,
          service: {
            select: {
              name: true,
              defaultImageUrl: true,
              minPrice: true,
              defaultDurationMinutes: true,
            },
          },
        },
      },
      reviews: {
        orderBy: { createdAt: 'desc' },
        take: 200, // keep reasonable cap
        select: {
          id: true,
          rating: true,
          headline: true,
          body: true,
          createdAt: true,
          mediaAssets: {
            select: { id: true, url: true, thumbUrl: true, mediaType: true, isFeaturedInPortfolio: true },
          },
          client: {
            select: {
              firstName: true,
              lastName: true,
              user: { select: { email: true } },
            },
          },
        },
      },
    },
  })

  if (!pro) redirect(ROUTES.proHome)

  const [portfolioMedia, favoritesCount] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: {
        professionalId: pro.id,
        visibility: 'PUBLIC',
        isFeaturedInPortfolio: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { id: true, url: true, thumbUrl: true, caption: true, mediaType: true },
    }),
    prisma.professionalFavorite.count({ where: { professionalId: pro.id } }),
  ])

  const reviewCount = pro.reviews.length
  const averageRating =
    reviewCount > 0 ? (pro.reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / reviewCount).toFixed(1) : null

  const reviewsForUI = pro.reviews.map((rev) => {
    const clientName = formatClientName({
      userEmail: rev.client?.user?.email ?? null,
      firstName: rev.client?.firstName ?? null,
      lastName: rev.client?.lastName ?? null,
    })

    return {
      id: rev.id,
      rating: rev.rating,
      headline: rev.headline ?? null,
      body: rev.body ?? null,
      createdAt: new Date(rev.createdAt).toISOString(),
      clientName,
      mediaAssets: (rev.mediaAssets || []).map((m) => ({
        id: m.id,
        url: m.url,
        thumbUrl: m.thumbUrl ?? null,
        mediaType: m.mediaType,
        isFeaturedInPortfolio: Boolean(m.isFeaturedInPortfolio),
      })),
    }
  })

  const publicUrl = `/professionals/${pro.id}`
  const displayName = pro.businessName?.trim() || 'Your business name'
  const subtitle = pro.professionType || 'Beauty professional'
  const location = pro.location?.trim() || null

  return (
    <main className="mx-auto max-w-5xl pb-6 font-sans">
      <section className="tovis-glass rounded-[18px] border border-white/10 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <Link href={ROUTES.proHome} className="text-[12px] font-black text-textSecondary hover:text-textPrimary">
            ← Back
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href={ROUTES.proMediaNew}
              className="rounded-[18px] border border-accentPrimary/40 bg-accentPrimary px-3 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
              title="Upload a new portfolio/Looks post"
            >
              + Upload
            </Link>

            <Link
              href={ROUTES.proMedia}
              className="rounded-[18px] border border-white/10 bg-bgSecondary px-3 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
              title="View all your media and manage portfolio toggles"
            >
              Manage media
            </Link>

            <ShareButton url={publicUrl} />
          </div>
        </div>

        <div className="mt-4 flex items-end gap-4">
          <div className="grid h-18 w-18 place-items-center overflow-hidden rounded-full border border-white/10 bg-bgSecondary text-[26px] font-black text-textPrimary">
            {pro.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pro.avatarUrl} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              (displayName || user.email || 'P').charAt(0).toUpperCase()
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-[20px] font-black text-textPrimary">{displayName}</div>
            <div className="mt-1 text-[13px] text-textSecondary">
              {subtitle}
              {location ? ` • ${location}` : ''}
            </div>

            {pro.bio ? <div className="mt-3 max-w-160 text-[13px] text-textSecondary">{pro.bio}</div> : null}
          </div>

          <div className="flex items-center gap-3">
            <EditProfileButton
              initial={{
                businessName: pro.businessName ?? null,
                bio: pro.bio ?? null,
                location: pro.location ?? null,
                avatarUrl: pro.avatarUrl ?? null,
                professionType: pro.professionType ? String(pro.professionType) : null,
              }}
            />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat label="Rating" value={reviewCount ? averageRating || '–' : '–'} />
          <Stat label="Reviews" value={String(reviewCount)} />
          <Stat label="Favorites" value={String(favoritesCount)} />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href={ROUTES.proServices}
            className="rounded-[18px] border border-white/10 bg-accentPrimary/15 px-4 py-2 text-[13px] font-black text-textPrimary hover:border-white/20"
            title="Go to your services to manage and preview what clients can book"
          >
            Manage services
          </Link>

          <Link
            href={ROUTES.proMessages}
            className="rounded-[18px] border border-white/10 bg-bgSecondary px-4 py-2 text-[13px] font-black text-textPrimary hover:border-white/20"
            title="Open your messages"
          >
            Messages
          </Link>

          <Link
            href={publicUrl}
            className="ml-auto text-[12px] font-black text-textSecondary hover:text-textPrimary"
            title="Open your public profile as clients see it"
          >
            View as client →
          </Link>
        </div>
      </section>

      <nav className="mt-6 flex gap-2 border-b border-white/10">
        <TabLink active={tab === 'portfolio'} href={ROUTES.proPublicProfile}>
          Portfolio
        </TabLink>
        <TabLink active={tab === 'services'} href={`${ROUTES.proPublicProfile}?tab=services`}>
          Services
        </TabLink>
        <TabLink active={tab === 'reviews'} href={`${ROUTES.proPublicProfile}?tab=reviews`}>
          Reviews
        </TabLink>
      </nav>

      {tab === 'portfolio' ? (
        <section className="pt-4">
          {portfolioMedia.length === 0 ? (
            <div className="grid gap-3">
              <EmptyBox>No portfolio posts yet.</EmptyBox>
              <Link
                href={ROUTES.proMediaNew}
                className="inline-flex w-fit items-center gap-2 rounded-[18px] border border-accentPrimary/40 bg-accentPrimary px-4 py-2 text-[13px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
              >
                + Upload your first post
              </Link>
              <div className="text-[12px] text-textSecondary">
                Portfolio posts also show in Looks automatically. Because your work deserves attention and your code deserves fewer edge cases.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {portfolioMedia.map((m) => {
                const src = m.thumbUrl || m.url
                const isVideo = m.mediaType === 'VIDEO'
                return (
                  <Link
                    key={m.id}
                    href={`/pro/media/${m.id}`}
                    className="group relative block aspect-square overflow-hidden rounded-[18px] border border-white/10 bg-bgSecondary"
                    title={m.caption || 'Open'}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={m.caption || 'Portfolio'}
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                    />
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

      {tab === 'services' ? (
        <section className="pt-4">
          {pro.offerings.length === 0 ? (
            <EmptyBox>No services yet.</EmptyBox>
          ) : (
            <div className="grid gap-3">
              {pro.offerings.map((off) => {
                const imgSrc = pickOfferingImage(off)
                const price = pickOfferingPrice(off)
                const duration = pickOfferingDuration(off)

                return (
                  <div
                    key={off.id}
                    className="tovis-glass flex items-center justify-between gap-3 rounded-[18px] border border-white/10 p-3 sm:p-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[18px] border border-white/10 bg-bgSecondary">
                        {imgSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imgSrc} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </div>

                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-black text-textPrimary">
                          {off.title || off.service?.name || 'Service'}
                        </div>
                        {off.description ? <div className="mt-1 line-clamp-2 text-[12px] text-textSecondary">{off.description}</div> : null}
                      </div>
                    </div>

                    <div className="text-right text-[12px] text-textSecondary">
                      {price != null ? <div className="font-black text-textPrimary">${moneyToString(price)}</div> : <div className="font-black text-textPrimary">–</div>}
                      {duration != null ? <div>{duration} min</div> : <div>–</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      ) : null}

      {tab === 'reviews' ? (
        <section className="pt-4">
          {reviewCount === 0 ? (
            <EmptyBox>No reviews yet.</EmptyBox>
          ) : (
            <div className="tovis-glass rounded-[18px] border border-white/10 p-3 sm:p-4">
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
    <div className="rounded-[18px] border border-white/10 bg-bgSecondary p-3 text-center">
      <div className="text-[18px] font-black text-textPrimary">{value}</div>
      <div className="mt-1 text-[11px] font-extrabold text-textSecondary">{label}</div>
    </div>
  )
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
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
  return <div className="rounded-[18px] border border-white/10 bg-bgSecondary p-4 text-[13px] text-textSecondary">{children}</div>
}
