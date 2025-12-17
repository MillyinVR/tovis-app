// app/professionals/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ReviewsPanel from '@/app/pro/profile/ReviewsPanel'
import FavoriteButton from './FavoriteButton'
import ShareButton from './ShareButton'
import { moneyToString } from '@/lib/money'

export const dynamic = 'force-dynamic'

type SearchParams = { [key: string]: string | string[] | undefined }

function getActiveTab(tabRaw: unknown): 'portfolio' | 'services' | 'reviews' {
  const tab =
    typeof tabRaw === 'string' ? tabRaw : Array.isArray(tabRaw) ? tabRaw[0] : undefined
  return tab === 'services' || tab === 'reviews' ? tab : 'portfolio'
}

function buildLoginHref(fromPath: string) {
  return `/login?from=${encodeURIComponent(fromPath)}`
}

function pickOfferingImage(off: {
  customImageUrl?: string | null
  service?: { defaultImageUrl?: string | null }
}) {
  const src = (off.customImageUrl || off.service?.defaultImageUrl || '').trim()
  return src || null
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
      businessName: true,
      bio: true,
      avatarUrl: true,
      professionType: true,
      location: true,
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

  const reviewStats = await prisma.review.aggregate({
    where: { professionalId: pro.id },
    _count: { _all: true },
    _avg: { rating: true },
  })

  const reviewCount: number = reviewStats?._count?._all ?? 0
  const averageRating =
    typeof reviewStats?._avg?.rating === 'number' ? reviewStats._avg.rating.toFixed(1) : null

  const favoritesCount = await prisma.professionalFavorite.count({
    where: { professionalId: pro.id },
  })

  const isClientViewer = viewer?.role === 'CLIENT' && !!viewer?.id
  const isFavoritedByMe = isClientViewer
    ? !!(await prisma.professionalFavorite.findUnique({
        where: {
          professionalId_userId: { professionalId: pro.id, userId: viewer!.id },
        },
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

  const tabItems = [
    { id: 'portfolio', label: 'Portfolio' },
    { id: 'services', label: 'Services' },
    { id: 'reviews', label: 'Reviews' },
  ] as const

  const displayName = pro.businessName || 'Beauty professional'
  const avatar = pro.avatarUrl as string | null | undefined

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

  const isOwner = viewer?.role === 'PRO' && viewer?.professionalProfile?.id === pro.id

  const tabQS = activeTab === 'portfolio' ? '' : `?tab=${activeTab}`
  const fromPath = `/professionals/${pro.id}${tabQS}`
  const loginHref = buildLoginHref(fromPath)

  const mustLogin = !viewer

  const bookHref = mustLogin ? loginHref : `/offerings/book?professionalId=${pro.id}`
  const messageHref = mustLogin ? loginHref : `/messages?to=${pro.id}`

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '24px auto 90px',
        padding: '0 16px',
        fontFamily: 'system-ui',
      }}
    >
      <Link
        href="/looks"
        style={{
          fontSize: 12,
          textDecoration: 'none',
          color: '#111',
          display: 'inline-block',
          marginBottom: 10,
        }}
      >
        ← Back to Looks
      </Link>

      {/* HEADER */}
      <section
        style={{
          borderRadius: 16,
          border: '1px solid #eee',
          overflow: 'hidden',
          background: '#fff',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            height: 80,
            background: 'linear-gradient(135deg, #0f172a 0%, #4b5563 50%, #020617 100%)',
          }}
        />

        <div style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'flex-end' }}>
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              marginTop: -40,
              border: '3px solid #fff',
              background: '#111',
              overflow: 'hidden',
              display: 'grid',
              placeItems: 'center',
              color: '#f9fafb',
              fontSize: 28,
              fontWeight: 700,
            }}
            title={displayName}
          >
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
                alt={displayName}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              displayName.charAt(0).toUpperCase()
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 2 }}>{displayName}</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              {pro.professionType || 'Beauty professional'}
              {pro.location ? ` • ${pro.location}` : ''}
            </div>
            {pro.bio && (
              <div style={{ fontSize: 13, color: '#4b5563', marginTop: 6, maxWidth: 520 }}>
                {pro.bio}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gap: 10, justifyItems: 'end' }}>
            <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#4b5563' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>{reviewCount > 0 ? averageRating : '–'}</div>
                <div style={{ fontSize: 11 }}>Rating</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>{reviewCount}</div>
                <div style={{ fontSize: 11 }}>Reviews</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>{favoritesCount}</div>
                <div style={{ fontSize: 11 }}>Favorites</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {isClientViewer ? (
                <FavoriteButton
                  professionalId={pro.id}
                  initialFavorited={isFavoritedByMe}
                  initialCount={favoritesCount}
                />
              ) : (
                <Link
                  href={loginHref}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 999,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    textDecoration: 'none',
                    color: '#111',
                    fontSize: 18,
                  }}
                  title="Log in to favorite"
                >
                  ♡
                </Link>
              )}

              <ShareButton />

              {isOwner ? (
                <Link
                  href="/pro/profile"
                  style={{
                    fontSize: 12,
                    textDecoration: 'none',
                    padding: '6px 10px',
                    borderRadius: 999,
                    border: '1px solid #111',
                    color: '#111',
                    background: '#fff',
                  }}
                >
                  Edit
                </Link>
              ) : (
                <Link
                  href={messageHref}
                  style={{
                    fontSize: 12,
                    textDecoration: 'none',
                    padding: '6px 10px',
                    borderRadius: 999,
                    border: '1px solid #e5e7eb',
                    color: '#111',
                    background: '#fff',
                  }}
                  title={mustLogin ? 'Log in to message' : 'Message'}
                >
                  Message
                </Link>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          <Link
            href={bookHref}
            style={{
              display: 'inline-block',
              padding: '10px 14px',
              borderRadius: 999,
              background: '#111',
              color: '#fff',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 700,
            }}
            title={mustLogin ? 'Log in to book' : `Book with ${displayName}`}
          >
            Book with {displayName}
          </Link>

          {mustLogin && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
              Log in to book, favorite, or message.
            </div>
          )}
        </div>
      </section>

      {/* TABS */}
      <nav
        style={{
          display: 'flex',
          borderBottom: '1px solid #e5e7eb',
          marginBottom: 12,
          gap: 12,
        }}
      >
        {tabItems.map((tab) => {
          const isActive = activeTab === tab.id
          const href =
            tab.id === 'portfolio'
              ? `/professionals/${pro.id}`
              : `/professionals/${pro.id}?tab=${tab.id}`

          return (
            <Link
              key={tab.id}
              href={href}
              style={{
                padding: '6px 10px',
                borderRadius: 999,
                fontSize: 13,
                textDecoration: 'none',
                border: isActive ? '1px solid #111' : '1px solid transparent',
                background: isActive ? '#111' : 'transparent',
                color: isActive ? '#fff' : '#111',
              }}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>

      {/* PORTFOLIO */}
      {activeTab === 'portfolio' && (
        <section>
          <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Portfolio</h2>

          <div style={{ borderRadius: 12, border: '1px solid #eee', background: '#fff', padding: 12 }}>
            {portfolioMedia.length === 0 ? (
              <div style={{ fontSize: 12, color: '#6b7280' }}>No portfolio posts yet.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 }}>
                {portfolioMedia.map((m: any) => {
                  const src = m.thumbUrl || m.url
                  const isVideo = m.mediaType === 'VIDEO'
                  return (
                    <Link
                      key={m.id}
                      href={`/looks/${m.id}`}
                      style={{
                        position: 'relative',
                        display: 'block',
                        aspectRatio: '1 / 1',
                        borderRadius: 6,
                        overflow: 'hidden',
                        background: '#f3f4f6',
                        textDecoration: 'none',
                      }}
                      title={m.caption || 'View'}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt={m.caption || 'Portfolio media'}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                      {isVideo && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            background: 'rgba(0,0,0,0.65)',
                            color: '#fff',
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 999,
                          }}
                        >
                          VIDEO
                        </div>
                      )}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* SERVICES */}
      {activeTab === 'services' && (
  <section>
    <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Services</h2>

    <div
      style={{
        borderRadius: 12,
        border: '1px solid #eee',
        background: '#fff',
        padding: 12,
        display: 'grid',
        gap: 8,
      }}
    >
      {pro.offerings.length === 0 ? (
        <div style={{ fontSize: 12, color: '#6b7280' }}>No services listed yet.</div>
      ) : (
        pro.offerings.map((off: any) => {
          const imgSrc = (off.customImageUrl || off.service?.defaultImageUrl || '').trim()

          return (
            <div
              key={off.id}
              style={{
                borderRadius: 12,
                border: '1px solid #f3f4f6',
                padding: 10,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'center',
                fontSize: 13,
              }}
            >
              <div style={{ display: 'flex', gap: 12, flex: 1, minWidth: 0, alignItems: 'center' }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 12,
                    border: '1px solid #eee',
                    overflow: 'hidden',
                    background: '#f7f7f7',
                    flexShrink: 0,
                  }}
                >
                  {imgSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imgSrc}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : null}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {off.title || off.service?.name}
                  </div>

                  {off.description ? (
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                      {off.description}
                    </div>
                  ) : null}
                </div>
              </div>

              <div style={{ textAlign: 'right', fontSize: 12, color: '#4b5563' }}>
                <div>${moneyToString(off.price) ?? '0.00'}</div>
                <div>{off.durationMinutes} min</div>
              </div>
            </div>
          )
        })
      )}
    </div>
  </section>
)}


      {/* REVIEWS */}
      {activeTab === 'reviews' && (
        <section>
          <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Reviews</h2>
          <ReviewsPanel reviews={reviewsForUI} />
        </section>
      )}
    </main>
  )
}
