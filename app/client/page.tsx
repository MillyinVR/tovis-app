// app/client/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { getBrandConfig } from '@/lib/brand'

import ClientViralRequestsPanel from './components/ClientViralRequestsPanel'
import LogoutButton from './components/LogoutButton'
import LastMinuteOpenings from './components/LastMinuteOpenings'
import PendingConsultApprovalBanner from './components/PendingConsultApprovalBanner'
import SavedServicesWithProviders from './components/SavedServicesWithProviders'

export const dynamic = 'force-dynamic'

type MaybeCurrentUser = Awaited<ReturnType<typeof getCurrentUser>>
type CurrentUser = NonNullable<MaybeCurrentUser>

type ClientPageUser = CurrentUser & {
  role: 'CLIENT'
  clientProfile: NonNullable<CurrentUser['clientProfile']>
}

function isClientPageUser(user: MaybeCurrentUser): user is ClientPageUser {
  return Boolean(user && user.role === Role.CLIENT && user.clientProfile?.id)
}

function pickDisplayName(user: ClientPageUser): string {
  const firstName = (user.clientProfile.firstName ?? '').trim()
  const email = (user.email ?? '').trim()
  return firstName || email || 'there'
}

async function requireClientOrRedirect(): Promise<ClientPageUser> {
  const user = await getCurrentUser().catch(() => null)

  if (!isClientPageUser(user)) {
    redirect('/login?from=/client')
  }

  return user
}

async function removeProFavoriteAction(formData: FormData) {
  'use server'

  const user = await requireClientOrRedirect()

  const professionalId = String(formData.get('professionalId') ?? '').trim()
  if (!professionalId) {
    redirect('/client')
  }

  await prisma.professionalFavorite.deleteMany({
    where: {
      professionalId,
      userId: user.id,
    },
  })

  redirect('/client')
}

export default async function ClientHomePage() {
  const brand = getBrandConfig()
  const user = await requireClientOrRedirect()

  const userId = user.id
  const clientId = user.clientProfile.id
  const displayName = pickDisplayName(user)

  const [favoritePros, favoriteServices, myReviews] = await Promise.all([
    prisma.professionalFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        professional: {
          select: {
            id: true,
            businessName: true,
            handle: true,
            avatarUrl: true,
            professionType: true,
            location: true,
          },
        },
      },
    }),

    prisma.serviceFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        service: {
          select: {
            id: true,
            name: true,
            description: true,
            defaultImageUrl: true,
            category: {
              select: {
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    }),

    prisma.review.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        rating: true,
        headline: true,
        createdAt: true,
        professional: {
          select: {
            id: true,
            businessName: true,
            handle: true,
            avatarUrl: true,
          },
        },
      },
    }),
  ])

  return (
    <main
      className="mx-auto w-full max-w-6xl px-4 pb-14 text-textPrimary"
      style={{
        paddingTop: 'max(48px, env(safe-area-inset-top, 0px) + 24px)',
      }}
    >
      <header className="mb-8 flex items-end justify-between gap-4 border-b border-textPrimary/8 pb-6">
        <div>
          <div className="text-[10px] font-black tracking-[0.22em] text-textSecondary/50">
            {brand.assets.wordmark.text}
          </div>
          <h1 className="mt-1.5 font-display text-3xl font-bold leading-tight">
            {displayName}
          </h1>
        </div>

        <div className="flex items-center gap-2 pb-0.5">
          <Link
            href="/client/settings"
            className="rounded-inner border border-textPrimary/10 bg-bgSecondary px-3 py-1.5 text-[11px] font-bold text-textSecondary transition hover:border-textPrimary/14 hover:text-textPrimary"
          >
            Settings
          </Link>
          <LogoutButton />
        </div>
      </header>

      <div className="grid gap-8">
        <PendingConsultApprovalBanner />

        <section>
          <div className="tovis-section-label mb-4">
            Saved pros
            {favoritePros.length > 0 ? (
              <span className="ml-auto font-semibold tracking-normal normal-case text-textSecondary/50">
                {favoritePros.length} saved
              </span>
            ) : null}
          </div>

          {favoritePros.length === 0 ? (
            <p className="text-sm text-textSecondary">
              No saved pros yet. Browse{' '}
              <Link
                className="font-bold text-textPrimary underline underline-offset-2"
                href="/looks"
              >
                Looks
              </Link>{' '}
              and favorite the pros you like.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {favoritePros.map((favorite) => {
                const professional = favorite.professional
                const name = (
                  professional.businessName ??
                  professional.handle ??
                  'Professional'
                ).trim()
                const subtitle =
                  (professional.professionType ?? 'Pro') +
                  (professional.location ? ` · ${professional.location}` : '')

                return (
                  <div
                    key={professional.id}
                    className="flex items-center justify-between gap-3 rounded-card border border-textPrimary/8 bg-bgSecondary px-3 py-3"
                  >
                    <Link
                      href={`/professionals/${encodeURIComponent(professional.id)}`}
                      className="flex min-w-0 items-center gap-3 hover:opacity-90"
                    >
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-textPrimary/10 bg-bgPrimary/40">
                        {professional.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={professional.avatarUrl}
                            alt={name}
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>

                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{name}</div>
                        <div className="truncate text-[11px] text-textSecondary">
                          {subtitle}
                        </div>
                      </div>
                    </Link>

                    <form action={removeProFavoriteAction}>
                      <input
                        type="hidden"
                        name="professionalId"
                        value={professional.id}
                      />
                      <button
                        type="submit"
                        className="shrink-0 rounded-inner border border-textPrimary/8 px-2.5 py-1.5 text-[11px] font-bold text-textSecondary/70 transition hover:border-textPrimary/14 hover:text-textPrimary"
                        title="Remove from saved pros"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section>
          <div className="tovis-section-label mb-4">Saved services</div>
          <SavedServicesWithProviders
            services={favoriteServices.map((favorite) => ({
              id: favorite.service.id,
              name: favorite.service.name,
              description: favorite.service.description ?? null,
              defaultImageUrl: favorite.service.defaultImageUrl ?? null,
              categoryName: favorite.service.category?.name ?? null,
              categorySlug: favorite.service.category?.slug ?? null,
            }))}
          />
        </section>

        <section>
          <div className="tovis-section-label mb-4">Viral requests</div>
          <ClientViralRequestsPanel />
        </section>

        <section>
          <div className="tovis-section-label mb-4">
            Your reviews
            {myReviews.length > 0 ? (
              <span className="ml-auto font-semibold tracking-normal normal-case text-textSecondary/50">
                {myReviews.length} recent
              </span>
            ) : null}
          </div>

          {myReviews.length === 0 ? (
            <p className="text-sm text-textSecondary/60">
              Reviews you leave will appear here.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {myReviews.map((review) => {
                const professional = review.professional
                const professionalName = (
                  professional.businessName ??
                  professional.handle ??
                  'Professional'
                ).trim()

                return (
                  <Link
                    key={review.id}
                    href={`/professionals/${encodeURIComponent(professional.id)}?tab=reviews`}
                    className="flex items-start justify-between gap-3 rounded-card border border-textPrimary/8 bg-bgSecondary px-4 py-3 transition hover:border-white/14"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">
                        {professionalName}
                      </div>
                      <div className="mt-0.5 text-[11px] text-textSecondary">
                        {new Date(review.createdAt).toLocaleDateString()}
                      </div>
                      {review.headline ? (
                        <div className="mt-2 text-[11px] italic text-textSecondary/80">
                          "{review.headline}"
                        </div>
                      ) : null}
                    </div>

                    <div className="shrink-0 text-sm font-black text-accentPrimary">
                      ★ {review.rating}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        <section>
          <div className="tovis-section-label mb-4">Open now</div>
          <LastMinuteOpenings />
        </section>
      </div>
    </main>
  )
}