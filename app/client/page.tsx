// app/client/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import LogoutButton from './components/LogoutButton'
import LastMinuteOpenings from './components/LastMinuteOpenings'
import PendingConsultApprovalBanner from './components/PendingConsultApprovalBanner'
import SavedServicesWithProviders from './components/SavedServicesWithProviders'
import { getBrandConfig } from '@/lib/brand'
export const dynamic = 'force-dynamic'

type ViralStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
type PageSearchParams = { [key: string]: string | string[] | undefined }

type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>

function pickFirst(sp: PageSearchParams | undefined, key: string): string | null {
  const raw = sp?.[key]
  const v = Array.isArray(raw) ? raw[0] : raw
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

function statusLabel(s: ViralStatus) {
  if (s === 'APPROVED') return 'Approved'
  if (s === 'REJECTED') return 'Denied'
  return 'Pending'
}

function statusTone(s: ViralStatus) {
  if (s === 'APPROVED') return 'text-toneSuccess'
  if (s === 'REJECTED') return 'text-toneDanger'
  return 'text-toneWarn'
}

function pickDisplayName(user: CurrentUser) {
  const firstName = (user.clientProfile?.firstName ?? '').trim()
  const email = (user.email ?? '').trim()
  return firstName || email || 'there'
}

async function requireClientOrRedirect() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect('/login?from=/client')
  }
  return user
}

async function createViralRequestAction(formData: FormData) {
  'use server'

  const user = await requireClientOrRedirect()

  const name = String(formData.get('name') ?? '').trim()
  const sourceUrlRaw = String(formData.get('sourceUrl') ?? '').trim()

  if (!name) redirect('/client?err=viral_missing_name')

  let sourceUrl: string | null = null
  if (sourceUrlRaw) {
    try {
      const u = new URL(sourceUrlRaw)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol')
      sourceUrl = u.toString()
    } catch {
      redirect('/client?err=viral_bad_url')
    }
  }

  await prisma.viralServiceRequest.create({
    data: {
      clientId: user.clientProfile!.id,
      name,
      sourceUrl,
      status: 'PENDING',
    },
    select: { id: true },
  })

  redirect('/client?ok=viral_submitted')
}

async function removeProFavoriteAction(formData: FormData) {
  'use server'
  const user = await requireClientOrRedirect()

  const professionalId = String(formData.get('professionalId') ?? '').trim()
  if (!professionalId) redirect('/client')

  await prisma.professionalFavorite.deleteMany({
    where: { professionalId, userId: user.id },
  })

  redirect('/client')
}

async function removeServiceFavoriteAction(formData: FormData) {
  'use server'
  const user = await requireClientOrRedirect()

  const serviceId = String(formData.get('serviceId') ?? '').trim()
  if (!serviceId) redirect('/client')

  await prisma.serviceFavorite.deleteMany({
    where: { serviceId, userId: user.id },
  })

  redirect('/client')
}

async function deleteViralRequestAction(formData: FormData) {
  'use server'
  const user = await requireClientOrRedirect()

  const requestId = String(formData.get('requestId') ?? '').trim()
  if (!requestId) redirect('/client')

  await prisma.viralServiceRequest.deleteMany({
    where: { id: requestId, clientId: user.clientProfile!.id },
  })

  redirect('/client')
}

export default async function ClientHomePage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>
}) {
  const brand = getBrandConfig()
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect('/login?from=/client')
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const ok = pickFirst(resolvedSearchParams, 'ok')
  const err = pickFirst(resolvedSearchParams, 'err')

  const userId = user.id
  const clientId = user.clientProfile.id
  const displayName = pickDisplayName(user)

  const [favoritePros, favoriteServices, viralRequests, myReviews] = await Promise.all([
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
          category: { select: { name: true, slug: true } },
        },
      },
    },
  }),

    prisma.viralServiceRequest.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        name: true,
        sourceUrl: true,
        status: true,
        createdAt: true,
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
    <main className="mx-auto w-full max-w-6xl px-4 pb-14 text-textPrimary" style={{ paddingTop: 'max(48px, env(safe-area-inset-top, 0px) + 24px)' }}>

      {/* Page header */}
      <header className="mb-8 flex items-end justify-between gap-4 border-b border-textPrimary/8 pb-6">
        <div>
          <div className="text-[10px] font-black tracking-[0.22em] text-textSecondary/50">{brand.assets.wordmark.text}</div>
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

        {ok ? (
          <div className="rounded-inner border border-toneSuccess/25 bg-toneSuccess/8 px-4 py-3 text-sm font-semibold text-toneSuccess">
            {ok === 'viral_submitted' ? 'Viral request submitted — admin will review it.' : 'Saved.'}
          </div>
        ) : null}

        {err ? (
          <div className="rounded-inner border border-toneDanger/25 bg-toneDanger/8 px-4 py-3 text-sm font-semibold text-toneDanger">
            {err === 'viral_missing_name'
              ? 'Please enter a viral service name.'
              : err === 'viral_bad_url'
                ? 'That link looks invalid. Please paste a full http/https URL.'
                : 'Something went wrong.'}
          </div>
        ) : null}

        {/* Saved Pros */}
        <section>
          <div className="tovis-section-label mb-4">
            Saved pros
            {favoritePros.length > 0 && (
              <span className="ml-auto font-semibold tracking-normal normal-case text-textSecondary/50">
                {favoritePros.length} saved
              </span>
            )}
          </div>

          {favoritePros.length === 0 ? (
            <p className="text-sm text-textSecondary">
              No saved pros yet. Browse{' '}
              <Link className="font-bold text-textPrimary underline underline-offset-2" href="/looks">
                Looks
              </Link>{' '}
              and favorite the pros you like.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {favoritePros.map((f) => {
                const p = f.professional
                const name = (p.businessName ?? p.handle ?? 'Professional').trim()
                const subtitle = (p.professionType ?? 'Pro') + (p.location ? ` · ${p.location}` : '')

                return (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-card border border-textPrimary/8 bg-bgSecondary px-3 py-3">
                    <Link
                      href={`/professionals/${encodeURIComponent(p.id)}`}
                      className="flex min-w-0 items-center gap-3 hover:opacity-90"
                    >
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-textPrimary/10 bg-bgPrimary/40">
                        {p.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.avatarUrl} alt={name} className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{name}</div>
                        <div className="truncate text-[11px] text-textSecondary">{subtitle}</div>
                      </div>
                    </Link>

                    <form action={removeProFavoriteAction}>
                      <input type="hidden" name="professionalId" value={p.id} />
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

        {/* Saved Services */}
        <section>
          <div className="tovis-section-label mb-4">Saved services</div>
          <SavedServicesWithProviders
            services={favoriteServices.map((f) => ({
              id: f.service.id,
              name: f.service.name,
              description: f.service.description ?? null,
              defaultImageUrl: f.service.defaultImageUrl ?? null,
              categoryName: f.service.category?.name ?? null,
              categorySlug: f.service.category?.slug ?? null,
            }))}
          />
        </section>

        {/* Viral Requests */}
        <section>
          <div className="tovis-section-label mb-4">Viral requests</div>

          <form action={createViralRequestAction} className="mb-4 grid gap-2 sm:grid-cols-3">
            <input
              name="name"
              placeholder='Service name (e.g. "Wolf Cut")'
              className="w-full rounded-inner border border-textPrimary/10 bg-bgSecondary px-3 py-2.5 text-sm text-textPrimary outline-none placeholder:text-textSecondary/50 focus:border-accentPrimary/30 focus:ring-1 focus:ring-accentPrimary/20 transition"
            />
            <input
              name="sourceUrl"
              placeholder="TikTok / IG / YouTube link — optional"
              className="w-full rounded-inner border border-textPrimary/10 bg-bgSecondary px-3 py-2.5 text-sm text-textPrimary outline-none placeholder:text-textSecondary/50 focus:border-accentPrimary/30 focus:ring-1 focus:ring-accentPrimary/20 transition sm:col-span-2"
            />
            <div className="sm:col-span-3">
              <button
                type="submit"
                className="rounded-inner border border-textPrimary/10 bg-bgSecondary px-4 py-2 text-sm font-bold text-textPrimary transition hover:border-white/20 hover:bg-white/5"
              >
                Submit request
              </button>
            </div>
          </form>

          {viralRequests.length > 0 ? (
            <div className="grid gap-2">
              {viralRequests.map((r) => {
                const s = r.status as ViralStatus
                return (
                  <div key={r.id} className="flex items-center justify-between gap-3 rounded-inner border border-textPrimary/8 bg-bgSecondary px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{r.name}</div>
                      <div className="mt-0.5 text-[11px] text-textSecondary">
                        {new Date(r.createdAt).toLocaleDateString()}
                        {r.sourceUrl ? (
                          <>
                            {' · '}
                            <a className="underline underline-offset-2" href={r.sourceUrl} target="_blank" rel="noreferrer">
                              link
                            </a>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <span className={`text-[11px] font-black ${statusTone(s)}`}>{statusLabel(s)}</span>
                      <form action={deleteViralRequestAction}>
                        <input type="hidden" name="requestId" value={r.id} />
                        <button
                          type="submit"
                          className="rounded-inner border border-textPrimary/8 px-2.5 py-1.5 text-[11px] font-bold text-textSecondary/70 transition hover:text-toneDanger/80"
                          title="Delete request"
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-textSecondary/60">No requests yet.</p>
          )}
        </section>

        {/* Your Reviews */}
        <section>
          <div className="tovis-section-label mb-4">
            Your reviews
            {myReviews.length > 0 && (
              <span className="ml-auto font-semibold tracking-normal normal-case text-textSecondary/50">
                {myReviews.length} recent
              </span>
            )}
          </div>

          {myReviews.length === 0 ? (
            <p className="text-sm text-textSecondary/60">Reviews you leave will appear here.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {myReviews.map((r) => {
                const pro = r.professional
                const proName = (pro.businessName ?? pro.handle ?? 'Professional').trim()
                return (
                  <Link
                    key={r.id}
                    href={`/professionals/${encodeURIComponent(pro.id)}?tab=reviews`}
                    className="flex items-start justify-between gap-3 rounded-card border border-textPrimary/8 bg-bgSecondary px-4 py-3 transition hover:border-white/14"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{proName}</div>
                      <div className="mt-0.5 text-[11px] text-textSecondary">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </div>
                      {r.headline ? (
                        <div className="mt-2 text-[11px] italic text-textSecondary/80">"{r.headline}"</div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-sm font-black text-accentPrimary">★ {r.rating}</div>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        {/* Open Now */}
        <section>
          <div className="tovis-section-label mb-4">Open now</div>
          <LastMinuteOpenings />
        </section>
      </div>
    </main>
  )
}
