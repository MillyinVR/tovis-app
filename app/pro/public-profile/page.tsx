// app/pro/public-profile/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ReviewsPanel from '../profile/ReviewsPanel'
import EditProfileButton from './EditProfileButton'
import ShareButton from './ShareButton'
import { moneyToString } from '@/lib/money'

export const dynamic = 'force-dynamic'

type SearchParams = { [key: string]: string | string[] | undefined }

function pickOfferingImage(off: {
  customImageUrl?: string | null
  service?: { defaultImageUrl?: string | null }
}) {
  const src = (off.customImageUrl || off.service?.defaultImageUrl || '').trim()
  return src || null
}

export default async function ProPublicProfilePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/public-profile')
  }

  const resolved = await searchParams
  const rawTab =
    typeof resolved?.tab === 'string'
      ? resolved.tab
      : Array.isArray(resolved?.tab)
        ? resolved?.tab?.[0]
        : undefined

  const tab = rawTab === 'services' || rawTab === 'reviews' ? rawTab : 'portfolio'
  const proId = user.professionalProfile.id

  const pro = await prisma.professionalProfile.findUnique({
    where: { id: proId },
    include: {
      offerings: {
      where: { isActive: true },
      include: { service: true },
      orderBy: { createdAt: 'desc' },
      },
      reviews: {
        orderBy: { createdAt: 'desc' },
        include: { mediaAssets: true, client: { include: { user: true } } },
      },
    },
  })
  if (!pro) redirect('/pro')

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

  const favoritesCount = await prisma.professionalFavorite.count({
    where: { professionalId: pro.id },
  })

  const reviewCount = pro.reviews.length
  const averageRating =
    reviewCount > 0
      ? (
          pro.reviews.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) / reviewCount
        ).toFixed(1)
      : null

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

  const publicUrl = `/professionals/${pro.id}`

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '70px auto 90px',
        padding: '0 16px',
        fontFamily: 'system-ui',
      }}
    >
      {/* Header */}
      <section style={{ textAlign: 'center', marginBottom: 14 }}>
        {/* Avatar */}
        <div
          style={{
            width: 92,
            height: 92,
            borderRadius: '50%',
            background: '#111',
            margin: '0 auto',
            overflow: 'hidden',
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            fontSize: 30,
            fontWeight: 900,
          }}
        >
          {pro.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pro.avatarUrl}
              alt={pro.businessName || 'Profile'}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            (pro.businessName || user.email || 'P').charAt(0).toUpperCase()
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 20, fontWeight: 800 }}>
          {pro.businessName || 'Your business name'}
        </div>

        <div style={{ marginTop: 4, fontSize: 13, color: '#6b7280' }}>
          {pro.professionType || 'Beauty professional'}
        </div>

        {pro.location ? (
          <div style={{ marginTop: 6, fontSize: 13, color: '#6b7280' }}>📍 {pro.location}</div>
        ) : null}

        {/* Stats */}
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            justifyContent: 'center',
            gap: 28,
            fontSize: 12,
            color: '#6b7280',
          }}
        >
          <Stat label="Rating" value={reviewCount ? averageRating || '–' : '–'} />
          <Stat label="Reviews" value={String(reviewCount)} />
          <Stat label="Favorites" value={String(favoritesCount)} />
        </div>

        {/* CTAs */}
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Link
            href={`/offerings/book?professionalId=${pro.id}`}
            style={{
              padding: '10px 18px',
              borderRadius: 999,
              background: '#111',
              color: '#fff',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 800,
              minWidth: 140,
              textAlign: 'center',
            }}
          >
            Book Now
          </Link>

          <Link
            href={`/messages/new?professionalId=${pro.id}`}
            style={{
              padding: '10px 18px',
              borderRadius: 999,
              background: '#111',
              color: '#fff',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 800,
              minWidth: 140,
              textAlign: 'center',
            }}
          >
            Message
          </Link>

          <ShareButton url={publicUrl} />

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

        {pro.bio ? (
          <div style={{ margin: '14px auto 0', maxWidth: 560, fontSize: 13, color: '#374151' }}>
            {pro.bio}
          </div>
        ) : null}

        <div style={{ marginTop: 10 }}>
          <Link href={publicUrl} style={{ fontSize: 12, color: '#111', textDecoration: 'none' }}>
            View as client →
          </Link>
        </div>
      </section>

      {/* Tabs */}
      <nav
        style={{
          marginTop: 18,
          display: 'flex',
          justifyContent: 'space-around',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <TabLink active={tab === 'portfolio'} href="/pro/public-profile">
          Portfolio
        </TabLink>
        <TabLink active={tab === 'services'} href="/pro/public-profile?tab=services">
          Services
        </TabLink>
        <TabLink active={tab === 'reviews'} href="/pro/public-profile?tab=reviews">
          Reviews
        </TabLink>
      </nav>

      {/* Content */}
      {tab === 'portfolio' ? (
        <section style={{ paddingTop: 12 }}>
          {portfolioMedia.length === 0 ? (
            <div style={emptyBoxStyle}>No portfolio posts yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
              {portfolioMedia.map((m: any) => {
                const src = m.thumbUrl || m.url
                return (
                  <Link
                    key={m.id}
                    href={`/pro/media/${m.id}`}
                    style={{
                      display: 'block',
                      aspectRatio: '1 / 1',
                      borderRadius: 10,
                      overflow: 'hidden',
                      background: '#f3f4f6',
                      border: '1px solid #eee',
                    }}
                    title="Open"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={m.caption || 'Portfolio'}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      ) : null}

      {tab === 'services' ? (
        <section style={{ paddingTop: 12 }}>
          {pro.offerings.length === 0 ? (
            <div style={emptyBoxStyle}>No services yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {pro.offerings.map((off: any) => {
                const imgSrc = pickOfferingImage(off)

                return (
                  <div
                    key={off.id}
                    style={{
                      border: '1px solid #eee',
                      borderRadius: 14,
                      background: '#fff',
                      padding: 12,
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      alignItems: 'center',
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
                        <div style={{ fontWeight: 800, fontSize: 13 }}>
                          {off.title || off.service?.name || 'Service'}
                        </div>
                        {off.description ? (
                          <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
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
              })}
            </div>
          )}
        </section>
      ) : null}

      {tab === 'reviews' ? (
        <section style={{ paddingTop: 12 }}>
          {reviewCount === 0 ? (
            <div style={emptyBoxStyle}>No reviews yet.</div>
          ) : (
            <ReviewsPanel reviews={reviewsForUI} />
          )}
        </section>
      ) : null}
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: '#111' }}>{value}</div>
      <div>{label}</div>
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
      style={{
        padding: '12px 10px',
        textDecoration: 'none',
        color: active ? '#111' : '#6b7280',
        fontWeight: active ? 900 : 700,
        borderBottom: active ? '2px solid #111' : '2px solid transparent',
        fontSize: 13,
      }}
    >
      {children}
    </Link>
  )
}

const emptyBoxStyle: React.CSSProperties = {
  border: '1px solid #eee',
  borderRadius: 14,
  background: '#fff',
  padding: 12,
  fontSize: 13,
  color: '#6b7280',
}
