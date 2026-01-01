// app/pro/bookings/[id]/aftercare/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import AftercareForm from './AftercareForm'

export const dynamic = 'force-dynamic'

type RebookMode = 'NONE' | 'BOOKED_NEXT_APPOINTMENT' | 'RECOMMENDED_WINDOW'
type MediaPhase = 'BEFORE' | 'AFTER' | 'OTHER'

function isRebookMode(x: unknown): x is RebookMode {
  return x === 'NONE' || x === 'BOOKED_NEXT_APPOINTMENT' || x === 'RECOMMENDED_WINDOW'
}

function isMediaPhase(x: unknown): x is MediaPhase {
  return x === 'BEFORE' || x === 'AFTER' || x === 'OTHER'
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
      aftercareSummary: {
        include: {
          recommendations: {
            include: { product: true },
            orderBy: { id: 'asc' },
          },
        },
      },
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
          phase: true, // ✅ PASS PHASE DOWN
        },
      },
    },
  })

  if (!booking) notFound()
  if (booking.professionalId !== user.professionalProfile.id) redirect('/pro')

  const aftercare = booking.aftercareSummary

  const existingRebookModeRaw = (aftercare as any)?.rebookMode
  const existingRebookMode = isRebookMode(existingRebookModeRaw) ? (existingRebookModeRaw as RebookMode) : null

  const existingRebookedFor = aftercare?.rebookedFor instanceof Date ? aftercare.rebookedFor.toISOString() : null

  const existingRebookWindowStart =
    (aftercare as any)?.rebookWindowStart instanceof Date ? (aftercare as any).rebookWindowStart.toISOString() : null

  const existingRebookWindowEnd =
    (aftercare as any)?.rebookWindowEnd instanceof Date ? (aftercare as any).rebookWindowEnd.toISOString() : null

  const mediaForUI = (booking.mediaAssets || []).map((m) => ({
    id: m.id,
    url: m.url,
    thumbUrl: m.thumbUrl ?? null,
    mediaType: m.mediaType,
    visibility: m.visibility,
    uploadedByRole: m.uploadedByRole ?? null,
    reviewId: m.reviewId ?? null,
    createdAt: m.createdAt.toISOString(),
    phase: isMediaPhase((m as any).phase) ? ((m as any).phase as MediaPhase) : ('OTHER' as MediaPhase),
  }))

  const existingRecommendedProducts =
    aftercare?.recommendations?.map((r) => ({
      id: r.id,
      name: r.product?.name ?? (r as any).externalName ?? '',
      url: (r as any).externalUrl ?? '',
      note: r.note ?? '',
    })) ?? []

  const serviceName = booking.service?.name ?? 'Service'
  const clientName = `${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim() || 'Client'

  return (
    <main style={{ maxWidth: 860, margin: '24px auto 90px', padding: '0 16px', fontFamily: 'system-ui' }}>
      <a
        href={`/pro/bookings/${encodeURIComponent(bookingId)}/session`}
        style={{ fontSize: 12, color: '#555', textDecoration: 'none' }}
      >
        ← Back to session
      </a>

      <h1 style={{ fontSize: 20, fontWeight: 900, marginTop: 10 }}>Aftercare: {serviceName}</h1>
      <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>Client: {clientName}</div>

      <div style={{ marginTop: 14, border: '1px solid #eee', background: '#fff', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 13, color: '#374151' }}>
          Write clear instructions, add product links, set rebook guidance, then send.
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
          existingRecommendedProducts={existingRecommendedProducts}
        />
      </div>
    </main>
  )
}
