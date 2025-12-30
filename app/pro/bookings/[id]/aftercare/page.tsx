// app/pro/bookings/[id]/aftercare/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import AftercareForm from './AftercareForm'

export const dynamic = 'force-dynamic'

type RebookMode = 'NONE' | 'BOOKED_NEXT_APPOINTMENT' | 'RECOMMENDED_WINDOW'

function isRebookMode(x: unknown): x is RebookMode {
  return x === 'NONE' || x === 'BOOKED_NEXT_APPOINTMENT' || x === 'RECOMMENDED_WINDOW'
}

export default async function ProAftercarePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()
  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
    redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/aftercare`)
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      service: true,
      client: { include: { user: true } },
      aftercareSummary: true,
      mediaAssets: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          url: true,
          thumbUrl: true,
          mediaType: true,
          visibility: true,
          uploadedByRole: true,
          reviewId: true,
          createdAt: true,
        },
      },
    },
  })

  if (!booking) notFound()
  if (booking.professionalId !== user.professionalProfile.id) redirect('/pro')

  const aftercare = booking.aftercareSummary

  const existingRebookModeRaw = (aftercare as any)?.rebookMode
  const existingRebookMode = isRebookMode(existingRebookModeRaw) ? (existingRebookModeRaw as RebookMode) : null

  const existingRebookedFor =
    aftercare?.rebookedFor instanceof Date ? aftercare.rebookedFor.toISOString() : null

  const existingRebookWindowStart =
    (aftercare as any)?.rebookWindowStart instanceof Date
      ? (aftercare as any).rebookWindowStart.toISOString()
      : null

  const existingRebookWindowEnd =
    (aftercare as any)?.rebookWindowEnd instanceof Date
      ? (aftercare as any).rebookWindowEnd.toISOString()
      : null

  const mediaForUI = (booking.mediaAssets || []).map((m) => ({
    id: m.id,
    url: m.url,
    thumbUrl: m.thumbUrl ?? null,
    mediaType: m.mediaType,
    visibility: m.visibility,
    uploadedByRole: m.uploadedByRole ?? null,
    reviewId: m.reviewId ?? null,
    createdAt: m.createdAt.toISOString(),
  }))

  const serviceName = booking.service?.name ?? 'Service'
  const clientName =
    `${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim() || 'Client'

  return (
    <main style={{ maxWidth: 860, margin: '24px auto 90px', padding: '0 16px', fontFamily: 'system-ui' }}>
      <a
        href={`/pro/bookings/${encodeURIComponent(bookingId)}/session`}
        style={{ fontSize: 12, color: '#555', textDecoration: 'none' }}
      >
        ← Back to session
      </a>

      <h1 style={{ fontSize: 20, fontWeight: 900, marginTop: 10 }}>
        Aftercare: {serviceName}
      </h1>
      <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>
        Client: {clientName}
      </div>

      <div style={{ marginTop: 14, border: '1px solid #eee', background: '#fff', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 13, color: '#374151' }}>
          Write clear instructions, set rebook guidance, save. Client gets notified (deduped) via your API route.
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <AftercareForm
          bookingId={bookingId}
          existingNotes={aftercare?.notes ?? ''}
          existingRebookMode={existingRebookMode}
          existingRebookedFor={existingRebookedFor}
          existingRebookWindowStart={existingRebookWindowStart}
          existingRebookWindowEnd={existingRebookWindowEnd}
          existingMedia={mediaForUI}
        />
      </div>
    </main>
  )
}
