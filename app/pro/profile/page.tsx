// app/pro/profile/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ReviewsPanel from './ReviewsPanel'
import { moneyToString } from '@/lib/money'

type SearchParams = { [key: string]: string | string[] | undefined }

export default async function ProProfilePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/profile')
  }

  const db: any = prisma

  const pro = await db.professionalProfile.findUnique({
    where: { id: user.professionalProfile.id },
    include: {
      offerings: {
        where: { isActive: true },
        include: { service: true },
      },
      reviews: {
        orderBy: { createdAt: 'desc' },
        include: {
          mediaAssets: true,
          client: { include: { user: true } },
        },
      },
      bookings: true,
    },
  })

  if (!pro) redirect('/pro')

  const portfolioMedia = await db.mediaAsset.findMany({
    where: {
      professionalId: pro.id,
      visibility: 'PUBLIC',
      isFeaturedInPortfolio: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: {
      services: { include: { service: true } },
      likes: true,
      comments: true,
    },
  })

  const reviewCount = pro.reviews.length
  const averageRating =
    reviewCount > 0
      ? (
          pro.reviews.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) /
          reviewCount
        ).toFixed(1)
      : null

  const resolvedSearchParams = await searchParams

  let tabParam: string | undefined
  if (resolvedSearchParams && typeof resolvedSearchParams === 'object') {
    const raw = resolvedSearchParams['tab']
    if (typeof raw === 'string') tabParam = raw
    else if (Array.isArray(raw) && typeof raw[0] === 'string') tabParam = raw[0]
  }

  const activeTab =
    tabParam === 'services' || tabParam === 'reviews' ? tabParam : 'portfolio'

  const tabItems = [
    { id: 'portfolio', label: 'Portfolio' },
    { id: 'services', label: 'Services' },
    { id: 'reviews', label: 'Reviews' },
  ] as const

  // Prep reviews for the client component (serialize Date)
  const reviewsForUI = pro.reviews.map((rev: any) => {
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

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '80px auto 80px',
        padding: '0 16px',
        fontFamily: 'system-ui',
      }}
    >
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
            background:
              'linear-gradient(135deg, #0f172a 0%, #4b5563 50%, #020617 100%)',
          }}
        />

        <div
          style={{
            padding: 16,
            display: 'flex',
            gap: 16,
            alignItems: 'flex-end',
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              marginTop: -40,
              border: '3px solid #fff',
              background: '#111',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
              color: '#f9fafb',
            }}
          >
            {(pro.businessName || user.email || 'P').charAt(0).toUpperCase()}
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 2 }}>
              {pro.businessName || 'Your business name'}
            </div>
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

          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#4b5563' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 600 }}>{reviewCount > 0 ? averageRating : '–'}</div>
              <div style={{ fontSize: 11 }}>Rating</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 600 }}>{reviewCount}</div>
              <div style={{ fontSize: 11 }}>Reviews</div>
            </div>
          </div>
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
          const href = tab.id === 'portfolio' ? '/pro/profile' : `/pro/profile?tab=${tab.id}`

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

          <div
            style={{
              borderRadius: 12,
              border: '1px solid #eee',
              background: '#fff',
              padding: 12,
            }}
          >
            {portfolioMedia.length === 0 ? (
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                No portfolio posts yet. Reviews can be added to portfolio, and you’ll also
                be able to upload posts directly.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 4,
                }}
              >
                {portfolioMedia.map((m: any) => {
                  const src = m.thumbUrl || m.url
                  const isVideo = m.mediaType === 'VIDEO'

                  return (
                    <Link
                      key={m.id}
                      href={`/pro/media/${m.id}`}
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
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
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

                      {m.services?.length ? (
                        <div
                          style={{
                            position: 'absolute',
                            left: 6,
                            bottom: 6,
                            right: 6,
                            display: 'flex',
                            gap: 6,
                            flexWrap: 'wrap',
                          }}
                        >
                          {m.services.slice(0, 2).map((t: any) => (
                            <span
                              key={t.id}
                              style={{
                                background: 'rgba(255,255,255,0.9)',
                                color: '#111',
                                fontSize: 10,
                                padding: '2px 6px',
                                borderRadius: 999,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '100%',
                              }}
                            >
                              {t.service?.name || 'Service'}
                            </span>
                          ))}
                        </div>
                      ) : null}
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
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                No services added yet. Services you configure in your pro dashboard will
                show here.
              </div>
            ) : (
              pro.offerings.map((off: any) => (
                <div
                  key={off.id}
                  style={{
                    borderRadius: 10,
                    border: '1px solid #f3f4f6',
                    padding: 10,
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: 13,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500, marginBottom: 2 }}>
                      {off.title || off.service.name}
                    </div>
                    {off.description && (
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{off.description}</div>
                    )}
                  </div>

                  <div style={{ textAlign: 'right', fontSize: 12, color: '#4b5563' }}>
                    {off.price != null && (
                    <div>${moneyToString(off.price) ?? '0.00'}</div>
                    )}
                    {off.durationMinutes != null && <div>{off.durationMinutes} min</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* REVIEWS */}
      {activeTab === 'reviews' && (
        <section>
          <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Reviews</h2>
          <ReviewsPanel reviews={reviewsForUI} editable />
        </section>
      )}
    </main>
  )
}
