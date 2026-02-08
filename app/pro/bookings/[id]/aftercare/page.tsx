// app/pro/bookings/[id]/aftercare/page.tsx
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import AftercareForm from './AftercareForm'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'

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

  const proId = user.professionalProfile.id

  const proProfile = await prisma.professionalProfile.findUnique({
    where: { id: proId },
    select: { timeZone: true },
  })

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
          phase: true,
        },
      },
    },
  })

  if (!booking) notFound()
  if (booking.professionalId !== proId) redirect('/pro')

  // ✅ Timezone truth (booking.locationTimeZone > proProfile.timeZone > UTC)
  const tzRes = await resolveApptTimeZone({
    bookingLocationTimeZone: booking.locationTimeZone,
    professionalTimeZone: proProfile?.timeZone,
    fallback: 'UTC',
    requireValid: false,
  })

  const timeZone = tzRes.ok ? tzRes.timeZone : 'UTC'

  const aftercare = booking.aftercareSummary

  const existingRebookModeRaw = (aftercare as any)?.rebookMode
  const existingRebookMode = isRebookMode(existingRebookModeRaw) ? existingRebookModeRaw : null

  const existingRebookedFor = aftercare?.rebookedFor instanceof Date ? aftercare.rebookedFor.toISOString() : null
  const existingRebookWindowStart =
    (aftercare as any)?.rebookWindowStart instanceof Date ? (aftercare as any).rebookWindowStart.toISOString() : null
  const existingRebookWindowEnd =
    (aftercare as any)?.rebookWindowEnd instanceof Date ? (aftercare as any).rebookWindowEnd.toISOString() : null

  const existingMedia = (booking.mediaAssets || []).map((m) => ({
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
    <main className="mx-auto mt-20 w-full max-w-3xl px-4 pb-10 text-textPrimary">
      <Link
        href={`/pro/bookings/${encodeURIComponent(bookingId)}/session`}
        prefetch
        className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
      >
        ← Back to session
      </Link>

      <h1 className="mt-4 text-xl font-black">Aftercare: {serviceName}</h1>
      <div className="mt-1 text-sm font-semibold text-textSecondary">Client: {clientName}</div>

      <div className="mt-4 rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="text-sm font-semibold text-textSecondary">
          Aftercare and after-photos are a wrap-up pair. Do either first — then send when you’re ready.
        </div>
      </div>

      <div className="mt-4">
        <AftercareForm
          bookingId={bookingId}
          timeZone={timeZone}
          existingNotes={aftercare?.notes ?? ''}
          existingRebookMode={existingRebookMode}
          existingRebookedFor={existingRebookedFor}
          existingRebookWindowStart={existingRebookWindowStart}
          existingRebookWindowEnd={existingRebookWindowEnd}
          existingMedia={existingMedia}
          existingRecommendedProducts={existingRecommendedProducts}
        />
      </div>
    </main>
  )
}
