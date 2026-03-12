// app/pro/bookings/[id]/aftercare/page.tsx
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { BookingStatus, SessionStep } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import AftercareForm from './AftercareForm'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'

export const dynamic = 'force-dynamic'

type RebookMode = 'NONE' | 'BOOKED_NEXT_APPOINTMENT' | 'RECOMMENDED_WINDOW'
type MediaPhase = 'BEFORE' | 'AFTER' | 'OTHER'

function isRebookMode(x: unknown): x is RebookMode {
  return (
    x === 'NONE' ||
    x === 'BOOKED_NEXT_APPOINTMENT' ||
    x === 'RECOMMENDED_WINDOW'
  )
}

function isMediaPhase(x: unknown): x is MediaPhase {
  return x === 'BEFORE' || x === 'AFTER' || x === 'OTHER'
}

function bookingHubHref(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/session`
}

function aftercareHref(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/aftercare`
}

function isTerminal(status: BookingStatus, finishedAt: Date | null) {
  return (
    status === BookingStatus.CANCELLED ||
    status === BookingStatus.COMPLETED ||
    Boolean(finishedAt)
  )
}

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const s = v.trim()
  if (!s) return false

  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function pickDateOrNull(value: unknown): Date | null {
  return value instanceof Date ? value : null
}

function pickRebookModeOrNull(value: unknown): RebookMode | null {
  return isRebookMode(value) ? value : null
}

function pickMediaPhaseOrOther(value: unknown): MediaPhase {
  return isMediaPhase(value) ? value : 'OTHER'
}

const SIGNED_URL_TTL_SECONDS = 60 * 10

async function signObjectUrl(
  bucket: string | null,
  path: string | null,
): Promise<string | null> {
  if (!bucket || !path) return null

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

  if (error) return null
  return data?.signedUrl ?? null
}

export default async function ProAftercarePage(props: {
  params: Promise<{ id: string }>
}) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()
  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  const proId = user?.role === 'PRO' ? user.professionalProfile?.id : null
  if (!proId) {
    redirect(`/login?from=${encodeURIComponent(aftercareHref(bookingId))}`)
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      professionalId: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      sessionStep: true,

      locationTimeZone: true,

      service: { select: { name: true } },
      client: {
        select: {
          firstName: true,
          lastName: true,
          user: { select: { email: true } },
        },
      },

      aftercareSummary: {
        select: {
          id: true,
          notes: true,
          rebookedFor: true,
          rebookMode: true,
          rebookWindowStart: true,
          rebookWindowEnd: true,
          recommendations: {
            orderBy: { id: 'asc' },
            select: {
              id: true,
              note: true,
              product: { select: { name: true } },
              externalName: true,
              externalUrl: true,
            },
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

          storageBucket: true,
          storagePath: true,
          thumbBucket: true,
          thumbPath: true,
        },
      },
    },
  })

  if (!booking) notFound()
  if (booking.professionalId !== proId) redirect('/pro')

  if (!booking.startedAt || isTerminal(booking.status, booking.finishedAt)) {
    redirect(bookingHubHref(bookingId))
  }

  const step = booking.sessionStep ?? SessionStep.NONE
  const allowedHere =
    step === SessionStep.AFTER_PHOTOS || step === SessionStep.DONE

  if (!allowedHere) {
    redirect(bookingHubHref(bookingId))
  }

  const proProfile = await prisma.professionalProfile.findUnique({
    where: { id: proId },
    select: { timeZone: true },
  })

  const tzRes = await resolveApptTimeZone({
    bookingLocationTimeZone: booking.locationTimeZone,
    professionalTimeZone: proProfile?.timeZone,
    fallback: 'UTC',
    requireValid: false,
  })

  const timeZone = tzRes.ok ? tzRes.timeZone : 'UTC'

  const aftercare = booking.aftercareSummary

  const existingRebookMode = pickRebookModeOrNull(aftercare?.rebookMode)
  const existingRebookedFor = pickDateOrNull(aftercare?.rebookedFor)?.toISOString() ?? null
  const existingRebookWindowStart =
    pickDateOrNull(aftercare?.rebookWindowStart)?.toISOString() ?? null
  const existingRebookWindowEnd =
    pickDateOrNull(aftercare?.rebookWindowEnd)?.toISOString() ?? null

  const existingMedia =
    (await Promise.all(
      (booking.mediaAssets ?? []).map(async (m) => {
        const httpUrl = isHttpUrl(m.url) ? m.url : null
        const httpThumbUrl = isHttpUrl(m.thumbUrl) ? m.thumbUrl : null

        const signedUrl =
          httpUrl ?? (await signObjectUrl(m.storageBucket, m.storagePath))
        const signedThumbUrl =
          httpThumbUrl ??
          (await signObjectUrl(m.thumbBucket ?? null, m.thumbPath ?? null))

        return {
          id: m.id,
          url: m.url ?? null,
          thumbUrl: m.thumbUrl ?? null,

          renderUrl: signedUrl,
          renderThumbUrl: signedThumbUrl,

          mediaType: m.mediaType,
          visibility: m.visibility,
          uploadedByRole: m.uploadedByRole ?? null,
          reviewId: m.reviewId ?? null,
          createdAt: m.createdAt.toISOString(),
          phase: pickMediaPhaseOrOther(m.phase),
        }
      }),
    )) ?? []

  const existingRecommendedProducts =
    aftercare?.recommendations?.map((r) => ({
      id: r.id,
      name:
        r.product?.name ??
        pickString(isRecord(r) ? r.externalName : null) ??
        '',
      url: pickString(isRecord(r) ? r.externalUrl : null) ?? '',
      note: r.note ?? '',
    })) ?? []

  const serviceName = booking.service?.name ?? 'Service'
  const clientName =
    `${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim() ||
    booking.client?.user?.email ||
    'Client'

  return (
    <main className="mx-auto mt-20 w-full max-w-3xl px-4 pb-10 text-textPrimary">
      <Link
        href={bookingHubHref(bookingId)}
        prefetch
        className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
      >
        ← Back to session
      </Link>

      <h1 className="mt-4 text-xl font-black">Aftercare: {serviceName}</h1>
      <div className="mt-1 text-sm font-semibold text-textSecondary">
        Client: {clientName}
      </div>

      <div className="mt-4 rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="text-sm font-semibold text-textSecondary">
          Aftercare and after-photos are a wrap-up pair. Do either first — then
          complete the session from the session hub.
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