// app/pro/profile/public-profile/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

import ReviewsPanel from '../ReviewsPanel'
import EditProfileButton from './EditProfileButton'
import ShareButton from './ShareButton'
import OwnerMediaMenu from '@/app/_components/media/OwnerMediaMenu'
import ProAccountMenu from './ProAccountMenu'
import ServicesManagerSection from '../_sections/ServicesManagerSection'

export const dynamic = 'force-dynamic'

type SearchParams = { [key: string]: string | string[] | undefined }
type TabKey = 'portfolio' | 'services' | 'reviews'

const ROUTES = {
  proHome: '/pro/dashboard',
  messages: '/messages',
  proMediaNew: '/pro/media/new',
  proPublicProfile: '/pro/profile/public-profile',
  looks: '/looks',
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

function formatClientName(input: { userEmail?: string | null; firstName?: string | null; lastName?: string | null }) {
  const email = (input.userEmail || '').trim()
  if (email) return email

  const first = (input.firstName || '').trim()
  const last = (input.lastName || '').trim()
  const full = [first, last].filter(Boolean).join(' ').trim()
  return full || 'Client'
}

function pickNonEmptyString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export default async function ProPublicProfilePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect(`/login?from=${encodeURIComponent(ROUTES.proPublicProfile)}`)
  }

  const resolved = await searchParams
  const tab = pickTab(resolved)
  const proId = user.professionalProfile.id

  const pro = await prisma.professionalProfile.findUnique({
    where: { id: proId },
    select: {
      id: true,
      handle: true,
      isPremium: true,
      businessName: true,
      bio: true,
      location: true,
      avatarUrl: true,
      professionType: true,
      reviews: {
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          rating: true,
          headline: true,
          body: true,
          createdAt: true,
          // ✅ keep the DB-level filter (good), but TS still needs a runtime guard later
          mediaAssets: {
            where: { url: { not: null } },
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

  const [portfolioMedia, favoritesCount, serviceOptions] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: { professionalId: pro.id },
      orderBy: { createdAt: 'desc' },
      take: 120,
      select: {
        id: true,
        url: true,
        thumbUrl: true,
        caption: true,
        mediaType: true,
        visibility: true,
        isEligibleForLooks: true,
        isFeaturedInPortfolio: true,
        services: { select: { serviceId: true } },
      },
    }),
    prisma.professionalFavorite.count({ where: { professionalId: pro.id } }),
    prisma.service.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true },
    }),
  ])

  const reviewCount = pro.reviews.length
  const averageRating =
    reviewCount > 0
      ? (pro.reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / reviewCount).toFixed(1)
      : null

  // ✅ IMPORTANT: ReviewsPanel expects mediaAssets[].url to be string (non-null)
  // Prisma types may still say `string | null`, so we guard + narrow here.
  const reviewsForUI = pro.reviews.map((rev) => {
    const clientName = formatClientName({
      userEmail: rev.client?.user?.email ?? null,
      firstName: rev.client?.firstName ?? null,
      lastName: rev.client?.lastName ?? null,
    })

    const mediaAssetsForUI = (rev.mediaAssets || [])
      .map((m) => ({
        id: m.id,
        url: typeof m.url === 'string' ? m.url.trim() : '',
        thumbUrl: m.thumbUrl ?? null,
        mediaType: m.mediaType,
        isFeaturedInPortfolio: Boolean(m.isFeaturedInPortfolio),
      }))
      .filter((m) => m.url.length > 0)

    return {
      id: rev.id,
      rating: rev.rating,
      headline: rev.headline ?? null,
      body: rev.body ?? null,
      createdAt: new Date(rev.createdAt).toISOString(),
      clientName,
      mediaAssets: mediaAssetsForUI,
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

            <ShareButton url={publicUrl} />

            <ProAccountMenu
              publicUrl={publicUrl}
              looksHref={ROUTES.looks}
              proServicesHref={`${ROUTES.proPublicProfile}?tab=services`}
              uploadHref={ROUTES.proMediaNew}
              messagesHref={ROUTES.messages}
            />
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
                handle: pro.handle ?? null,
                isPremium: Boolean(pro.isPremium),
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
            href="/pro/profile/public-profile?tab=services&add=1"
            className="rounded-[18px] border border-white/10 bg-accentPrimary/15 px-4 py-2 text-[13px] font-black text-textPrimary hover:border-white/20"
            title="Add services to your menu"
          >
            Add services
          </Link>

          <Link
            href={ROUTES.messages}
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
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Link
              href={ROUTES.proMediaNew}
              className="group relative grid aspect-square place-items-center overflow-hidden rounded-[18px] border border-white/10 bg-bgSecondary hover:border-white/20"
              title="Upload"
            >
              <div className="grid place-items-center gap-2 text-textPrimary">
                <div className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-bgPrimary/40 text-[22px] font-black">
                  +
                </div>
                <div className="text-[12px] font-extrabold text-textSecondary">Upload</div>
              </div>
            </Link>

            {portfolioMedia.map((m) => {
              // ✅ img src must be string | undefined (NOT null)
              const src = pickNonEmptyString(m.thumbUrl) || pickNonEmptyString(m.url) || undefined

              const isVideo = m.mediaType === 'VIDEO'
              const isPrivate = m.visibility === 'PRO_CLIENT'

              const serviceIds = (m.services ?? [])
                .map((s) => pickNonEmptyString(s.serviceId))
                .filter((id): id is string => id.length > 0)

              return (
                <div
                  key={m.id}
                  className="group relative aspect-square overflow-hidden rounded-[18px] border border-white/10 bg-bgSecondary"
                  title={m.caption || 'Open'}
                >
                  <Link href={`/media/${m.id}`} className="absolute inset-0">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt={m.caption || 'Portfolio'} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-bgPrimary/30 text-[12px] font-black text-textSecondary">
                        Missing media URL
                      </div>
                    )}
                  </Link>

                  <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-1.5">
                    {isPrivate ? (
                      <span className="rounded-full bg-black/60 px-2 py-1 text-[10px] font-black text-white">ONLY YOU</span>
                    ) : null}
                    {m.isEligibleForLooks ? (
                      <span className="rounded-full bg-black/60 px-2 py-1 text-[10px] font-black text-white">LOOKS</span>
                    ) : null}
                    {m.isFeaturedInPortfolio ? (
                      <span className="rounded-full bg-black/60 px-2 py-1 text-[10px] font-black text-white">PORTFOLIO</span>
                    ) : null}
                  </div>

                  {isVideo ? (
                    <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[10px] font-black text-white">
                      VIDEO
                    </div>
                  ) : null}

                  <div className="absolute left-2 top-2 z-10 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                    <OwnerMediaMenu
                      mediaId={m.id}
                      serviceOptions={serviceOptions}
                      initial={{
                        caption: m.caption ?? null,
                        visibility: m.visibility,
                        isEligibleForLooks: Boolean(m.isEligibleForLooks),
                        isFeaturedInPortfolio: Boolean(m.isFeaturedInPortfolio),
                        serviceIds,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {portfolioMedia.length === 0 ? (
            <div className="mt-3 text-[12px] text-textSecondary">No posts yet. Go ahead—feed the algorithm.</div>
          ) : null}
        </section>
      ) : null}

      {tab === 'services' ? (
        <section className="pt-4">
          <ServicesManagerSection variant="section" title={null} subtitle={null} />
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
  return (
    <div className="rounded-[18px] border border-white/10 bg-bgSecondary p-4 text-[13px] text-textSecondary">
      {children}
    </div>
  )
}