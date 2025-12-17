import { prisma } from '@/lib/prisma'

export default async function ExplorePage() {
  const db: any = prisma

  const offerings = await db.professionalServiceOffering.findMany({
    where: {
      isActive: true,
    },
    include: {
      service: {
        include: {
          category: true,
        },
      },
      professional: {
        include: {
          user: true,
        },
      },
    },
    take: 30,
  })

  return (
    <main style={{ maxWidth: 1000, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>Explore services</h1>
      <p style={{ marginBottom: 24, color: '#555', fontSize: 14 }}>
        Browse offerings from professionals. Later this becomes your full “For You” feed with
        filters and location sorting.
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
            const cat = svc.category

            return (
              <a
                key={off.id}
                href={`/offerings/${off.id}`}
                style={{
                  border: '1px solid #eee',
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

                <div style={{ fontSize: 13, color: '#777' }}>
                  {cat ? cat.name : 'General'}
                </div>

                <div style={{ fontWeight: 600 }}>{svc.name}</div>

                <div style={{ fontSize: 13, color: '#555' }}>
                  {off.description ?? svc.description}
                </div>

                <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
                  <strong>
                    {prof.businessName || prof.user?.email || 'Professional'}
                  </strong>
                  {prof.city || prof.location ? (
                    <span>
                      {' '}
                      · {prof.city || prof.location}
                    </span>
                  ) : null}
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 8,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>${off.price}</div>
                  <div style={{ fontSize: 12, color: '#777' }}>
                    {off.durationMinutes} min
                  </div>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </main>
  )
}
