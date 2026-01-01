// app/pro/bookings/[id]/session/before-photos/page.tsx
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

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 12,
        border: '1px solid #eee',
        background: '#fff',
        borderRadius: 12,
        padding: 14,
      }}
    >
      {children}
    </div>
  )
}

export default async function ProBeforePhotosPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()
  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
    redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session/before-photos`)
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { service: true, client: true, consultationApproval: true },
  })
  if (!booking) notFound()
  if (booking.professionalId !== user.professionalProfile.id) redirect('/pro')

  const bookingStatus = upper(booking.status)
  const approvalStatus = upper((booking as any).consultationApproval?.status || 'NONE')
  const consultationApproved = approvalStatus === 'APPROVED'

  // This page is part of the ACTIVE session flow.
  // If they haven't started the appointment, go back to the session page (footer Start handles starting).
  if (!booking.startedAt || booking.finishedAt || bookingStatus === 'CANCELLED' || bookingStatus === 'COMPLETED') {
    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
  }

  // Before photos should only happen after consult approval in your backbone flow.
  if (!consultationApproved) {
    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
  }

  const items = await prisma.mediaAsset.findMany({
    where: { bookingId, phase: 'BEFORE' as any },
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

  const hasBefore = items.length > 0

  async function continueToService() {
    'use server'

    const u = await getCurrentUser().catch(() => null)
    if (!u || u.role !== 'PRO' || !u.professionalProfile?.id) {
      redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session/before-photos`)
    }

    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
        consultationApproval: { select: { status: true } },
      },
    })

    if (!b) notFound()
    if (b.professionalId !== u.professionalProfile.id) redirect('/pro')

    const st = upper(b.status)
    const appr = upper(b.consultationApproval?.status || 'NONE')

    if (st === 'CANCELLED' || st === 'COMPLETED' || b.finishedAt) {
      redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    }
    if (!b.startedAt) {
      redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    }
    if (appr !== 'APPROVED') {
      redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    }

    const count = await prisma.mediaAsset.count({
      where: { bookingId, phase: 'BEFORE' as any },
    })

    if (count <= 0) {
      redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session/before-photos`)
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data: { sessionStep: 'SERVICE_IN_PROGRESS' as any },
    })

    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session/service`)
  }

  const serviceName = booking.service?.name ?? 'Service'
  const clientName = `${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim() || 'Client'

  return (
    <main style={{ maxWidth: 960, margin: '24px auto 90px', padding: '0 16px', fontFamily: 'system-ui' }}>
      <a
        href={`/pro/bookings/${encodeURIComponent(bookingId)}/session`}
        style={{ fontSize: 12, color: '#555', textDecoration: 'none' }}
      >
        ← Back to session
      </a>

      <h1 style={{ fontSize: 20, fontWeight: 900, marginTop: 10 }}>Before photos: {serviceName}</h1>
      <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>Client: {clientName}</div>

      {hasBefore ? (
        <Card>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Before photos saved ✅</div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            Continue to the service hub page where you can keep notes during the appointment.
          </div>

          <form action={continueToService} style={{ marginTop: 12 }}>
            <button
              type="submit"
              style={{
                border: '1px solid #111',
                background: '#111',
                color: '#fff',
                borderRadius: 999,
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Continue to service
            </button>
          </form>
        </Card>
      ) : (
        <Card>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Take at least one before photo</div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            Once you upload at least one image, a Continue button will appear.
          </div>
        </Card>
      )}

      <section style={{ marginTop: 16 }}>
        <MediaUploader bookingId={bookingId} phase="BEFORE" />
      </section>

      <section style={{ marginTop: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 900 }}>Uploaded before media</div>

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
