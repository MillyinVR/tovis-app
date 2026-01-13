// app/explore/page.tsx  (or wherever your ExplorePage lives)
import Link from 'next/link'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  if (typeof (v as any)?.toNumber === 'function') {
    const n = (v as any).toNumber()
    return Number.isFinite(n) ? n : null
  }
  const n = Number(String(v))
  return Number.isFinite(n) ? n : null
}

function pickStartingAt(off: any): { price: number | null; duration: number | null } {
  // Prefer salon if available, else mobile. (Explore is just a teaser.)
  const salonPrice = toNumberOrNull(off.salonPriceStartingAt)
  const salonDur = typeof off.salonDurationMinutes === 'number' ? off.salonDurationMinutes : null

  const mobilePrice = toNumberOrNull(off.mobilePriceStartingAt)
  const mobileDur = typeof off.mobileDurationMinutes === 'number' ? off.mobileDurationMinutes : null

  if (off.offersInSalon) return { price: salonPrice, duration: salonDur }
  if (off.offersMobile) return { price: mobilePrice, duration: mobileDur }
  return { price: null, duration: null }
}

export default async function ExplorePage() {
  const offerings = await prisma.professionalServiceOffering.findMany({
    where: { isActive: true },
    select: {
      id: true,
      title: true,
      description: true,
      customImageUrl: true,

      offersInSalon: true,
      offersMobile: true,
      salonPriceStartingAt: true,
      salonDurationMinutes: true,
      mobilePriceStartingAt: true,
      mobileDurationMinutes: true,

      service: {
        select: {
          id: true,
          name: true,
          description: true,
          category: { select: { name: true } },
        },
      },
      professional: {
        select: {
          id: true,
          businessName: true,
          city: true,
          location: true,
          user: { select: { email: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })

  return (
    <main style={{ maxWidth: 1000, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>Explore services</h1>
      <p style={{ marginBottom: 24, color: '#555', fontSize: 14 }}>
        Browse offerings from professionals. Later this becomes your full “For You” feed with filters and location sorting.
      </p>

      {offerings.length === 0 ? (
        <p>No services are live yet. Once professionals add offerings, they&apos;ll appear here.</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {offerings.map((off: any) => {
            const prof = off.professional
            const svc = off.service
            const cat = svc?.category
            const { price, duration } = pickStartingAt(off)

            const proName = prof?.businessName || prof?.user?.email || 'Professional'
            const location = prof?.city || prof?.location || null
            const modeLabel = off.offersInSalon && off.offersMobile ? 'Salon + Mobile' : off.offersInSalon ? 'Salon' : off.offersMobile ? 'Mobile' : 'Unconfigured'

            // REQUESTED is default in offerings/[id]/page.tsx, so no need to add ?source=REQUESTED here.
            const href = `/offerings/${off.id}`

            return (
              <Link
                key={off.id}
                href={href}
                className="border border-surfaceGlass/10 bg-bgSecondary"
                style={{
                  borderRadius: 12,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div
                  style={{
                    background: '#f5f5f5',
                    borderRadius: 8,
                    height: 140,
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    color: '#777',
                  }}
                >
                  {off.customImageUrl ? 'Pro image here' : 'Default service image here'}
                </div>

                <div style={{ fontSize: 13, color: '#777' }}>{cat?.name || 'General'}</div>

                <div style={{ fontWeight: 800 }}>{off.title || svc?.name || 'Service'}</div>

                <div style={{ fontSize: 13, color: '#555' }}>{off.description ?? svc?.description ?? ''}</div>

                <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
                  <strong>{proName}</strong>
                  {location ? <span> · {location}</span> : null}
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 8,
                  }}
                >
                  <div style={{ fontWeight: 900 }}>
                    {typeof price === 'number' ? `Starting at $${price.toFixed(0)}` : 'Starting at —'}
                  </div>
                  <div style={{ fontSize: 12, color: '#777' }}>
                    {typeof duration === 'number' ? `${duration} min` : '—'} · {modeLabel}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </main>
  )
}
