// app/pro/bookings/[id]/session/after-photos/page.tsx
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { headers } from 'next/headers'

import { getCurrentUser } from '@/lib/currentUser'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'
import { getServerOrigin } from '@/lib/serverOrigin'
import { prisma } from '@/lib/prisma'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'

import MediaUploader from '../MediaUploader'
import MediaPreviewGrid from '../_components/MediaPreviewGrid'
import { cn } from '@/lib/utils'
import { BookingStatus, MediaPhase, SessionStep, Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

type ApiItem = {
  id: string
  mediaType: 'IMAGE' | 'VIDEO'
  caption: string | null
  createdAt: string | Date
  reviewId: string | null
  renderUrl: string | null
  renderThumbUrl: string | null
}

function Card(props: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'tovis-glass mt-3 rounded-card border border-white/10 bg-bgSecondary p-4',
        props.className,
      )}
    >
      {props.children}
    </div>
  )
}

function bookingHubHref(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/session`
}

function afterPhotosHref(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/session/after-photos`
}

function aftercareHref(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/aftercare`
}

function pickMediaType(value: unknown): 'IMAGE' | 'VIDEO' {
  return value === 'VIDEO' ? 'VIDEO' : 'IMAGE'
}

function parseApiItem(value: unknown): ApiItem | null {
  if (!isRecord(value)) return null

  const row: Record<string, unknown> = value

  const id = pickString(row.id) ?? ''
  if (!id) return null

  const renderUrl =
    pickString(row.renderUrl) ||
    pickString(row.url) ||
    pickString(row.signedUrl) ||
    null

  const renderThumbUrl =
    pickString(row.renderThumbUrl) ||
    pickString(row.thumbUrl) ||
    pickString(row.signedThumbUrl) ||
    null

  return {
    id,
    mediaType: pickMediaType(row.mediaType),
    caption: pickString(row.caption) || null,
    createdAt: pickString(row.createdAt) || new Date().toISOString(),
    reviewId: pickString(row.reviewId) || null,
    renderUrl,
    renderThumbUrl,
  }
}

async function fetchAfterMedia(bookingId: string): Promise<ApiItem[]> {
  const origin = (await getServerOrigin()) || ''
  const url = origin
    ? `${origin}/api/pro/bookings/${encodeURIComponent(bookingId)}/media?phase=AFTER`
    : `/api/pro/bookings/${encodeURIComponent(bookingId)}/media?phase=AFTER`

  const h = await headers()
  const cookie = h.get('cookie') ?? ''

  const res = await fetch(url, {
    cache: 'no-store',
    headers: cookie ? { cookie } : undefined,
  }).catch(() => null)

  if (!res?.ok) return []

  const data: unknown = await res.json().catch(() => ({}))
  if (!isRecord(data) || !Array.isArray(data.items)) return []

  return data.items
    .map(parseApiItem)
    .filter((item): item is ApiItem => Boolean(item))
}

type PageProps = { params: Promise<{ id: string }> }

export default async function ProAfterPhotosPage(props: PageProps) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()
  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  const maybeProId =
    user?.role === 'PRO' ? user.professionalProfile?.id ?? null : null

  if (!maybeProId) {
    redirect(`/login?from=${encodeURIComponent(afterPhotosHref(bookingId))}`)
  }

  const proId = maybeProId

  const proTz = sanitizeTimeZone(
    user?.professionalProfile?.timeZone,
    DEFAULT_TIME_ZONE,
  )

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      professionalId: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      sessionStep: true,
    },
  })

  if (!booking) notFound()
  if (booking.professionalId !== proId) redirect('/pro')

  const isCancelled = booking.status === BookingStatus.CANCELLED
  const isCompleted =
    booking.status === BookingStatus.COMPLETED || Boolean(booking.finishedAt)

  if (!booking.startedAt || isCancelled || isCompleted) {
    redirect(bookingHubHref(bookingId))
  }

  const step = booking.sessionStep ?? SessionStep.NONE
  if (step === SessionStep.DONE) {
    redirect(aftercareHref(bookingId))
  }

  const allowedHere =
    step === SessionStep.AFTER_PHOTOS || step === SessionStep.FINISH_REVIEW

  if (!allowedHere) {
    redirect(bookingHubHref(bookingId))
  }

  const items = await fetchAfterMedia(bookingId)
  const canContinue = items.length > 0

  const afterCount = await prisma.mediaAsset.count({
    where: {
      bookingId,
      phase: MediaPhase.AFTER,
      uploadedByRole: Role.PRO,
    },
  })

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 text-textPrimary">
      <Link
        href={bookingHubHref(bookingId)}
        className="text-xs font-black text-textSecondary hover:opacity-80"
      >
        ← Back to session
      </Link>

      <h1 className="mt-3 text-lg font-black">After photos</h1>

      <Card>
        <div className="text-sm text-textSecondary">
          Add at least one after photo for wrap-up. Saved{' '}
          <span className="font-black text-textPrimary">privately</span>.
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link
            href={canContinue ? aftercareHref(bookingId) : '#'}
            aria-disabled={!canContinue}
            className={[
              'rounded-full px-4 py-2 text-xs font-black transition',
              canContinue
                ? 'border border-white/10 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'
                : 'cursor-not-allowed pointer-events-none border border-white/10 bg-bgPrimary text-textSecondary opacity-70',
            ].join(' ')}
          >
            Continue to aftercare
          </Link>

          {!canContinue ? (
            <span className="text-xs font-semibold text-textSecondary">
              No after media yet. Add one to continue.
            </span>
          ) : (
            <span className="text-xs font-black text-textPrimary">
              Unlocked · {afterCount} uploaded
            </span>
          )}
        </div>

        <div className="mt-3 text-[11px] font-semibold text-textSecondary">
          Times shown in <span className="font-black text-textPrimary">{proTz}</span>
        </div>
      </Card>

      <section className="mt-4">
        <MediaUploader bookingId={bookingId} phase="AFTER" />
      </section>

      <section className="mt-5">
        <MediaPreviewGrid items={items} title="Uploaded after media" />
      </section>
    </main>
  )
}