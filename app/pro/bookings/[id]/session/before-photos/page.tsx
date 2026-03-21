// app/pro/bookings/[id]/session/before-photos/page.tsx
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { headers } from 'next/headers'

import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { getServerOrigin } from '@/lib/serverOrigin'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'

import MediaUploader from '../MediaUploader'
import MediaPreviewGrid from '../_components/MediaPreviewGrid'
import { cn } from '@/lib/utils'
import { transitionSessionStep } from '@/lib/booking/writeBoundary'
import {
  BookingStatus,
  ConsultationApprovalStatus,
  SessionStep,
} from '@prisma/client'

export const dynamic = 'force-dynamic'

type ApiMediaItem = {
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

function beforePhotosHref(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/session/before-photos`
}

function pickMediaType(value: unknown): 'IMAGE' | 'VIDEO' {
  return value === 'VIDEO' ? 'VIDEO' : 'IMAGE'
}

function parseApiMediaItem(value: unknown): ApiMediaItem | null {
  if (!isRecord(value)) return null

  const row = value

  const id = pickString(row.id) ?? ''
  if (!id) return null

  const renderUrl =
    pickString(row.renderUrl) ??
    pickString(row.url) ??
    pickString(row.signedUrl) ??
    null

  const renderThumbUrl =
    pickString(row.renderThumbUrl) ??
    pickString(row.thumbUrl) ??
    pickString(row.signedThumbUrl) ??
    null

  return {
    id,
    mediaType: pickMediaType(row.mediaType),
    caption: pickString(row.caption) ?? null,
    createdAt: pickString(row.createdAt) ?? new Date().toISOString(),
    reviewId: pickString(row.reviewId) ?? null,
    renderUrl,
    renderThumbUrl,
  }
}

async function fetchBeforeMedia(bookingId: string): Promise<ApiMediaItem[]> {
  const origin = (await getServerOrigin()) || ''
  const url = origin
    ? `${origin}/api/pro/bookings/${encodeURIComponent(bookingId)}/media?phase=BEFORE`
    : `/api/pro/bookings/${encodeURIComponent(bookingId)}/media?phase=BEFORE`

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
    .map(parseApiMediaItem)
    .filter((item): item is ApiMediaItem => Boolean(item))
}

type PageProps = { params: Promise<{ id: string }> }

export default async function ProBeforePhotosPage(props: PageProps) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()
  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  const maybeProId =
    user?.role === 'PRO' ? user.professionalProfile?.id ?? null : null

  if (!maybeProId) {
    redirect(`/login?from=${encodeURIComponent(beforePhotosHref(bookingId))}`)
  }

  const proId = maybeProId

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      professionalId: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      sessionStep: true,
      service: { select: { name: true } },
      client: {
        select: {
          firstName: true,
          lastName: true,
          user: { select: { email: true } },
        },
      },
      consultationApproval: { select: { status: true } },
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
  const alreadyPastBefore =
    step === SessionStep.SERVICE_IN_PROGRESS ||
    step === SessionStep.FINISH_REVIEW ||
    step === SessionStep.AFTER_PHOTOS ||
    step === SessionStep.DONE

  if (alreadyPastBefore) {
    redirect(bookingHubHref(bookingId))
  }

  const approvalStatus = booking.consultationApproval?.status ?? null
  const consultApproved =
    approvalStatus === ConsultationApprovalStatus.APPROVED

  const items = await fetchBeforeMedia(bookingId)
  const hasBefore = items.length > 0
  const canContinue = consultApproved && hasBefore

  async function continueToService() {
    'use server'

    const u = await getCurrentUser().catch(() => null)
    const maybeUserProId =
      u?.role === 'PRO' ? u.professionalProfile?.id ?? null : null

    if (!maybeUserProId) {
      redirect(`/login?from=${encodeURIComponent(beforePhotosHref(bookingId))}`)
    }

    const result = await transitionSessionStep({
      bookingId,
      professionalId: maybeUserProId,
      nextStep: SessionStep.SERVICE_IN_PROGRESS,
    })

    if (!result.ok) redirect(beforePhotosHref(bookingId))
    redirect(bookingHubHref(bookingId))
  }

  const serviceName = booking.service?.name ?? 'Service'
  const clientName =
    `${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim() ||
    booking.client?.user?.email ||
    'Client'

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 text-textPrimary">
      <Link
        href={bookingHubHref(bookingId)}
        className="text-xs font-black text-textSecondary hover:opacity-80"
      >
        ← Back to session
      </Link>

      <h1 className="mt-3 text-lg font-black">Before photos: {serviceName}</h1>
      <div className="mt-1 text-sm font-semibold text-textSecondary">
        Client: {clientName}
      </div>

      <Card>
        {!hasBefore ? (
          <>
            <div className="text-sm font-black text-textPrimary">
              Add at least one before photo
            </div>
            <div className="mt-1 text-sm text-textSecondary">
              These are saved{' '}
              <span className="font-black text-textPrimary">privately</span> for
              the client + you.
            </div>
          </>
        ) : consultApproved ? (
          <>
            <div className="text-sm font-black text-textPrimary">
              Before photos saved ✅
            </div>
            <div className="mt-1 text-sm text-textSecondary">
              Consultation is approved — you can continue.
            </div>

            <form action={continueToService} className="mt-3">
              <button
                type="submit"
                disabled={!canContinue}
                className={[
                  'rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover',
                  !canContinue ? 'cursor-not-allowed opacity-60' : '',
                ].join(' ')}
              >
                Continue to service
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="text-sm font-black text-textPrimary">
              Before photos saved (private) ✅
            </div>
            <div className="mt-1 text-sm text-textSecondary">
              Client still needs to approve the consultation. You can keep
              uploading before photos, but service stays locked.
            </div>

            <div className="mt-3 inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textSecondary">
              Waiting on approval:{' '}
              {approvalStatus ?? ConsultationApprovalStatus.PENDING}
            </div>
          </>
        )}
      </Card>

      <section className="mt-4">
        <MediaUploader bookingId={bookingId} phase="BEFORE" />
      </section>

      <section className="mt-5">
        <MediaPreviewGrid items={items} title="Uploaded before media" />
      </section>

      <div className="mt-6 text-xs font-semibold text-textSecondary">
        Continue locked:{' '}
        <span className="font-black text-textPrimary">
          {String(!canContinue)}
        </span>
      </div>
    </main>
  )
}