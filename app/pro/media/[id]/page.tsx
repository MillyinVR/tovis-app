import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function ProMediaDetailPage({ params }: PageProps) {
  const { id } = await params
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/profile')
  }

  const db: any = prisma

  const media = await db.mediaAsset.findUnique({
    where: { id },
    include: {
      services: { include: { service: true } },
      likes: true,
      comments: true,
    },
  })

  if (!media || media.professionalId !== user.professionalProfile.id) {
    redirect('/pro/profile')
  }

  const src = media.url
  const isVideo = media.mediaType === 'VIDEO'

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '80px auto 80px',
        padding: '0 16px',
        fontFamily: 'system-ui',
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <Link href="/pro/profile" style={{ fontSize: 12, textDecoration: 'none' }}>
          ← Back to profile
        </Link>
      </div>

      <div
        style={{
          borderRadius: 16,
          border: '1px solid #eee',
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        <div style={{ background: '#111' }}>
          {isVideo ? (
            <video
              src={src}
              controls
              style={{ width: '100%', maxHeight: 520, display: 'block' }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={media.caption || 'Media'}
              style={{ width: '100%', maxHeight: 520, objectFit: 'contain', display: 'block' }}
            />
          )}
        </div>

        <div style={{ padding: 14, display: 'grid', gap: 10 }}>
          {media.caption && (
            <div style={{ fontSize: 13, color: '#111' }}>{media.caption}</div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {media.services?.map((t: any) => (
              <span
                key={t.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 999,
                  padding: '4px 8px',
                  fontSize: 12,
                  color: '#111',
                  background: '#fafafa',
                }}
              >
                {t.service?.name || 'Service'}
              </span>
            ))}
          </div>

          <div style={{ fontSize: 12, color: '#6b7280' }}>
            {media.likes?.length ?? 0} likes • {media.comments?.length ?? 0} comments
          </div>
        </div>
      </div>
    </main>
  )
}
