// app/client/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import LogoutButton from './components/LogoutButton'
import LastMinuteOpenings from './components/LastMinuteOpenings'
import PendingConsultApprovalBanner from './components/PendingConsultApprovalBanner'
import SavedServicesWithProviders from './components/SavedServicesWithProviders'
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
  if (s === 'APPROVED') return 'text-emerald-300'
  if (s === 'REJECTED') return 'text-rose-300'
  return 'text-yellow-300'
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
          description: true, // ✅ add this
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
    <main className="mx-auto mt-16 w-full max-w-6xl px-4 pb-14 text-textPrimary">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Your hub</h1>
          <p className="mt-1 text-sm font-semibold text-textSecondary">Welcome, {displayName}.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Link
            href="/client/settings"
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-bgSecondary px-3 py-1.5 text-[12px] font-black text-textPrimary transition hover:border-white/20"
          >
            Settings
          </Link>
          <LogoutButton />
        </div>
      </header>

      <div className="grid gap-4">
        <PendingConsultApprovalBanner />

        {/* feedback banner */}
        {ok ? (
          <section className="rounded-card border border-white/10 bg-bgSecondary p-3 text-sm font-semibold text-emerald-200">
            {ok === 'viral_submitted' ? 'Viral request submitted. Admin will review it.' : 'Saved.'}
          </section>
        ) : null}

        {err ? (
          <section className="rounded-card border border-white/10 bg-bgSecondary p-3 text-sm font-semibold text-rose-200">
            {err === 'viral_missing_name'
              ? 'Please enter a viral service name.'
              : err === 'viral_bad_url'
                ? 'That link looks invalid. Please paste a full http/https URL.'
                : 'Something went wrong.'}
          </section>
        ) : null}

        {/* Saved Pros */}
        <section className="rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <div className="text-sm font-black">Saved pros</div>
            <div className="text-xs font-semibold text-textSecondary">
              {favoritePros.length ? `${favoritePros.length} saved` : 'Save pros to find them fast.'}
            </div>
          </div>

          {favoritePros.length === 0 ? (
            <div className="text-sm text-textSecondary">
              You haven’t saved anyone yet. Browse{' '}
              <Link className="font-black text-textPrimary underline" href="/looks">
                Looks
              </Link>{' '}
              and hit Favorite on pros you like.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {favoritePros.map((f) => {
                const p = f.professional
                const name = (p.businessName ?? p.handle ?? 'Professional').trim()
                const subtitle = (p.professionType ?? 'Pro') + (p.location ? ` • ${p.location}` : '')

                return (
                  <div key={p.id} className="rounded-card border border-white/10 bg-bgPrimary/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={`/professionals/${encodeURIComponent(p.id)}`}
                        className="flex min-w-0 items-center gap-3 hover:opacity-95"
                      >
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/10 bg-bgPrimary/30">
                          {p.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.avatarUrl} alt={name} className="h-full w-full object-cover" />
                          ) : null}
                        </div>

                        <div className="min-w-0">
                          <div className="truncate text-sm font-black">{name}</div>
                          <div className="truncate text-xs font-semibold text-textSecondary">{subtitle}</div>
                        </div>
                      </Link>

                      <form action={removeProFavoriteAction}>
                        <input type="hidden" name="professionalId" value={p.id} />
                        <button
                          type="submit"
                          className="rounded-full border border-white/10 bg-bgPrimary/25 px-3 py-2 text-xs font-black text-textPrimary hover:bg-white/10"
                          title="Remove from saved pros"
                        >
                          Remove
                        </button>
                      </form>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Saved Services */}
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

        {/* Viral Requests */}
        <section className="rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <div className="text-sm font-black">Viral requests</div>
            <div className="text-xs font-semibold text-textSecondary">Drop the name + link. Admin approves/denies.</div>
          </div>

          <form action={createViralRequestAction} className="grid gap-2 sm:grid-cols-3">
            <input
              name="name"
              placeholder='Viral name (e.g. "Wolf Cut")'
              className="w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none placeholder:text-textSecondary"
            />
            <input
              name="sourceUrl"
              placeholder="Link (TikTok/IG/YouTube) — optional"
              className="w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none placeholder:text-textSecondary sm:col-span-2"
            />
            <div className="sm:col-span-3">
              <button
                type="submit"
                className="rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-sm font-black text-textPrimary hover:bg-white/10"
              >
                Request viral service
              </button>
            </div>
          </form>

          {viralRequests.length ? (
            <div className="mt-4 grid gap-2">
              {viralRequests.map((r) => {
                const s = r.status as ViralStatus
                return (
                  <div key={r.id} className="rounded-card border border-white/10 bg-bgPrimary/15 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black">{r.name}</div>
                        <div className="mt-0.5 text-xs font-semibold text-textSecondary">
                          {new Date(r.createdAt).toLocaleDateString()}
                          {r.sourceUrl ? (
                            <>
                              {' • '}
                              <a className="pointer-events-auto underline" href={r.sourceUrl} target="_blank" rel="noreferrer">
                                link
                              </a>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className={`shrink-0 text-xs font-black ${statusTone(s)}`}>{statusLabel(s)}</div>

                        <form action={deleteViralRequestAction}>
                          <input type="hidden" name="requestId" value={r.id} />
                          <button
                            type="submit"
                            className="rounded-full border border-white/10 bg-bgPrimary/25 px-3 py-2 text-xs font-black text-textPrimary hover:bg-white/10"
                            title="Delete request"
                          >
                            Delete
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="mt-3 text-sm text-textSecondary">No viral requests yet.</div>
          )}
        </section>

        {/* Your Reviews */}
        <section className="rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <div className="text-sm font-black">Your reviews</div>
            <div className="text-xs font-semibold text-textSecondary">
              {myReviews.length ? `${myReviews.length} recent` : 'Reviews you’ve left will show up here.'}
            </div>
          </div>

          {myReviews.length === 0 ? (
            <div className="text-sm text-textSecondary">No reviews yet.</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {myReviews.map((r) => {
                const pro = r.professional
                const proName = (pro.businessName ?? pro.handle ?? 'Professional').trim()
                return (
                  <Link
                    key={r.id}
                    href={`/professionals/${encodeURIComponent(pro.id)}?tab=reviews`}
                    className="rounded-card border border-white/10 bg-bgPrimary/15 p-3 hover:bg-white/5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black">{proName}</div>
                        <div className="mt-0.5 text-xs font-semibold text-textSecondary">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </div>
                        {r.headline ? <div className="mt-2 text-xs font-semibold text-textPrimary/90">“{r.headline}”</div> : null}
                      </div>
                      <div className="shrink-0 text-sm font-black text-amber-300">★ {r.rating}</div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        {/* Open now */}
        <section className="rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <div className="text-sm font-black">Open now</div>
            <div className="text-xs font-semibold text-textSecondary">Same-day openings near you.</div>
          </div>
          <LastMinuteOpenings />
        </section>
      </div>
    </main>
  )
}