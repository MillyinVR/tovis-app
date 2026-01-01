// app/pro/bookings/[id]/session/after-photos/page.tsx
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import MediaUploader from '../MediaUploader'

export const dynamic = 'force-dynamic'

function fmtDate(v: any) {
  try {
    const d = v instanceof Date ? v : new Date(String(v))
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString()
  } catch {
    return ''
  }
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

export default async function ProAfterPhotosPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()
  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
    redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session/after-photos`)
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { service: true, client: true },
  })
  if (!booking) notFound()
  if (booking.professionalId !== user.professionalProfile.id) redirect('/pro')

  // Long-term flow gate:
  // Only allow this page if the session is at AFTER_PHOTOS or DONE.
  const step = upper((booking as any).sessionStep || 'NONE')
  if (step !== 'AFTER_PHOTOS' && step !== 'DONE') {
    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
  }

  const items = await prisma.mediaAsset.findMany({
    where: { bookingId, phase: 'AFTER' as any },
    select: {
      id: true,
      url: true,
      thumbUrl: true,
      caption: true,
      mediaType: true,
      visibility: true,
      isEligibleForLooks: true,
      isFeaturedInPortfolio: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  const serviceName = booking.service?.name ?? 'Service'
  const clientName = `${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim() || 'Client'

  const canContinue = items.length > 0

  return (
    <main style={{ maxWidth: 960, margin: '24px auto 90px', padding: '0 16px', fontFamily: 'system-ui' }}>
      <Link
        href={`/pro/bookings/${encodeURIComponent(bookingId)}/session`}
        style={{ fontSize: 12, color: '#555', textDecoration: 'none' }}
      >
        ← Back to session
      </Link>

      <h1 style={{ fontSize: 20, fontWeight: 900, marginTop: 10 }}>After photos: {serviceName}</h1>
      <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>Client: {clientName}</div>

      <div style={{ marginTop: 12, border: '1px solid #eee', background: '#fff', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 13, color: '#374151' }}>
          Add at least one after photo to unlock aftercare. Your footer button should advance you once you’ve added one.
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link
            href={canContinue ? `/pro/bookings/${encodeURIComponent(bookingId)}/aftercare` : '#'}
            aria-disabled={!canContinue}
            style={{
              textDecoration: 'none',
              border: '1px solid #111',
              borderRadius: 999,
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 900,
              background: canContinue ? '#111' : '#374151',
              color: '#fff',
              pointerEvents: canContinue ? 'auto' : 'none',
              opacity: canContinue ? 1 : 0.8,
            }}
          >
            Continue to aftercare
          </Link>

          {!canContinue ? (
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              No after media yet. Add one to continue.
            </span>
          ) : (
            <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 900 }}>
              Unlocked.
            </span>
          )}
        </div>
      </div>

      <section style={{ marginTop: 16 }}>
        <MediaUploader bookingId={bookingId} phase="AFTER" />
      </section>

      <section style={{ marginTop: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 900 }}>Uploaded after media</div>

        {items.length === 0 ? (
          <div style={{ marginTop: 10, fontSize: 13, color: '#6b7280' }}>None yet.</div>
        ) : (
          <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
            {items.map((m) => (
              <div
                key={m.id}
                style={{
                  border: '1px solid #eee',
                  borderRadius: 12,
                  background: '#fff',
                  padding: 12,
                  display: 'grid',
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 900 }}>
                  {m.mediaType} · {m.visibility}
                  <span style={{ color: '#6b7280', fontWeight: 700 }}> · {fmtDate(m.createdAt)}</span>
                </div>

                {m.caption ? <div style={{ fontSize: 12, color: '#374151' }}>{m.caption}</div> : null}

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: '#6b7280' }}>
                  {m.isEligibleForLooks ? <span>Eligible for Looks</span> : null}
                  {m.isFeaturedInPortfolio ? <span>Featured</span> : null}
                </div>

                <a href={m.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb' }}>
                  Open media
                </a>

                {m.thumbUrl ? (
                  <a href={m.thumbUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb' }}>
                    Open thumb
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
