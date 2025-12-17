// app/pro/media/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import MediaTile from './MediaTile'

export default async function ProMediaPage() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/media')
  }

  const media = await prisma.mediaAsset.findMany({
    where: { professionalId: user.professionalProfile.id },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: {
      id: true,
      url: true,
      thumbUrl: true,
      caption: true,
      isFeaturedInPortfolio: true,
    },
  })

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '80px auto',
        padding: '0 16px',
        fontFamily: 'system-ui',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>
        My media
      </h1>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
        Toggle what appears in your portfolio. Beauty is pain, but this part should be easy.
      </div>

      {media.length === 0 ? (
        <div
          style={{
            borderRadius: 12,
            border: '1px solid #eee',
            background: '#fff',
            padding: 12,
            fontSize: 13,
            color: '#6b7280',
          }}
        >
          No media yet.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 8,
          }}
        >
          {media.map((m) => (
            <MediaTile
              key={m.id}
              id={m.id}
              src={m.thumbUrl || m.url}
              caption={m.caption}
              isFeaturedInPortfolio={Boolean(m.isFeaturedInPortfolio)}
            />
          ))}
        </div>
      )}
    </main>
  )
}
