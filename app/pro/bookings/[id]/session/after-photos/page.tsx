// app/pro/bookings/[id]/session/after-photos/page.tsx
import type { ReactNode } from 'react'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import {
  BookingStatus,
  MediaPhase,
  Role,
  SessionStep,
} from '@prisma/client'

import MediaPreviewGrid from '../_components/MediaPreviewGrid'
import MediaUploader from '../MediaUploader'

import { getCurrentUser } from '@/lib/currentUser'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import {
  afterPhotosHref,
  aftercareHref,
  isTerminalBooking,
  sessionHubHref,
} from '@/lib/proSession/sessionFlow'
import { getServerOrigin } from '@/lib/serverOrigin'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

type ApiMediaItem = {
  id: string
  mediaType: 'IMAGE' | 'VIDEO'
  caption: string | null
  createdAt: string | Date
  reviewId: string | null
  renderUrl: string | null
  renderThumbUrl: string | null
}

function loginHref(bookingId: string): string {
  return `/login?from=${encodeURIComponent(afterPhotosHref(bookingId))}`
}

function fullName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim()
}

function pickMediaType(value: unknown): ApiMediaItem['mediaType'] {
  return value === 'VIDEO' ? 'VIDEO' : 'IMAGE'
}

function parseApiMediaItem(value: unknown): ApiMediaItem | null {
  if (!isRecord(value)) return null

  const id = pickString(value.id) ?? ''
  if (!id) return null

  const renderUrl =
    pickString(value.renderUrl) ??
    pickString(value.url) ??
    pickString(value.signedUrl) ??
    null

  const renderThumbUrl =
    pickString(value.renderThumbUrl) ??
    pickString(value.thumbUrl) ??
    pickString(value.signedThumbUrl) ??
    null

  return {
    id,
    mediaType: pickMediaType(value.mediaType),
    caption: pickString(value.caption) ?? null,
    createdAt: pickString(value.createdAt) ?? new Date().toISOString(),
    reviewId: pickString(value.reviewId) ?? null,
    renderUrl,
    renderThumbUrl,
  }
}

async function fetchAfterMedia(bookingId: string): Promise<ApiMediaItem[]> {
  const origin = (await getServerOrigin()) || ''
  const url = origin
    ? `${origin}/api/pro/bookings/${encodeURIComponent(
        bookingId,
      )}/media?phase=AFTER`
    : `/api/pro/bookings/${encodeURIComponent(bookingId)}/media?phase=AFTER`

  const requestHeaders = await headers()
  const cookie = requestHeaders.get('cookie') ?? ''

  const response = await fetch(url, {
    cache: 'no-store',
    headers: cookie ? { cookie } : undefined,
  }).catch(() => null)

  if (!response?.ok) return []

  const data: unknown = await response.json().catch(() => ({}))

  if (!isRecord(data) || !Array.isArray(data.items)) return []

  return data.items
    .map(parseApiMediaItem)
    .filter((item): item is ApiMediaItem => Boolean(item))
}

function ChevronLeftIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function CheckIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ArrowRightIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

function CameraIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function PageShell({ children }: { children: ReactNode }) {
  return <main className="brand-pro-session-page">{children}</main>
}

function Card({
  children,
  accent = false,
  tone,
}: {
  children: ReactNode
  accent?: boolean
  tone?: 'success' | 'danger'
}) {
  return (
    <section
      className="brand-pro-session-card"
      data-accent={accent}
      data-tone={tone}
    >
      {children}
    </section>
  )
}

function SessionHeader({
  bookingId,
  serviceName,
  clientName,
  afterCount,
}: {
  bookingId: string
  serviceName: string
  clientName: string
  afterCount: number
}) {
  return (
    <header className="brand-pro-session-header" data-border="true">
      <Link
        href={sessionHubHref(bookingId)}
        className="brand-pro-session-back brand-focus"
      >
        <ChevronLeftIcon />
        Session hub
      </Link>

      <div className="brand-cap brand-pro-session-kicker" data-tone="muted">
        WRAP-UP · AFTER PHOTOS
      </div>

      <h1 className="brand-pro-session-title" data-size="sm">
        After photos
      </h1>

      <div className="brand-pro-session-subtitle">
        {clientName} · {serviceName}
      </div>

      <div className="brand-pro-session-header-pills">
        <span
          className="brand-pro-session-pill"
          data-state={afterCount > 0 ? 'done' : undefined}
        >
          {afterCount} PHOTO{afterCount === 1 ? '' : 'S'}
        </span>

        <span className="brand-pro-session-pill" data-tone="pending">
          AFTERCARE NEXT
        </span>
      </div>
    </header>
  )
}

function PhotoPlaceholderGrid({ count }: { count: number }) {
  const capturedCount = Math.min(Math.max(count, 0), 3)
  const emptyCount = Math.max(0, 3 - capturedCount)

  return (
    <div className="brand-pro-session-photo-grid">
      {Array.from({ length: capturedCount }, (_, index) => (
        <div key={`captured-${index}`} className="brand-pro-session-photo-tile">
          <div className="brand-pro-session-photo-check">
            <CheckIcon size={10} />
          </div>
          <span className="brand-pro-session-photo-label" data-tone="after">
            AFTER
          </span>
        </div>
      ))}

      {Array.from({ length: emptyCount }, (_, index) => (
        <div key={`empty-${index}`} className="brand-pro-session-photo-add">
          <CameraIcon />
        </div>
      ))}
    </div>
  )
}

function StatusCard({
  afterCount,
  canContinue,
  bookingId,
  timeZone,
}: {
  afterCount: number
  canContinue: boolean
  bookingId: string
  timeZone: string
}) {
  if (!canContinue) {
    return (
      <Card accent>
        <div className="brand-pro-session-card-heading">
          <span className="brand-pro-session-card-dot" />
          Add at least one after photo
        </div>

        <div className="brand-pro-session-card-body">
          Saved <strong>privately</strong> for the client and you. Add one
          after photo to unlock aftercare.
        </div>

        <div className="brand-pro-session-chip-row mt-3">
          <span className="brand-pro-session-pill" data-tone="pending">
            Aftercare locked
          </span>
        </div>

        <div className="brand-pro-session-help-text">
          Times shown in <strong>{timeZone}</strong>
        </div>
      </Card>
    )
  }

  return (
    <Card tone="success">
      <div className="brand-pro-session-card-heading">
        <span className="brand-pro-session-card-dot" />
        After photos saved
      </div>

      <div className="brand-pro-session-card-body">
        {afterCount} after photo{afterCount === 1 ? '' : 's'} uploaded.
        Aftercare is unlocked.
      </div>

      <div className="mt-3">
        <Link
          href={aftercareHref(bookingId)}
          className="brand-pro-session-button brand-focus"
          data-full="true"
        >
          Continue to aftercare <ArrowRightIcon />
        </Link>
      </div>

      <div className="brand-pro-session-help-text">
        Times shown in <strong>{timeZone}</strong>
      </div>
    </Card>
  )
}

export default async function ProAfterPhotosPage(props: PageProps) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()

  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  const professionalId =
    user?.role === 'PRO' ? user.professionalProfile?.id ?? null : null

  if (!professionalId) {
    redirect(loginHref(bookingId))
  }

  const proTimeZone = sanitizeTimeZone(
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
      service: {
        select: {
          name: true,
        },
      },
      client: {
        select: {
          firstName: true,
          lastName: true,
          user: {
            select: {
              email: true,
            },
          },
        },
      },
    },
  })

  if (!booking) notFound()
  if (booking.professionalId !== professionalId) redirect('/pro')

  if (
    !booking.startedAt ||
    isTerminalBooking(booking.status, booking.finishedAt)
  ) {
    redirect(sessionHubHref(bookingId))
  }

  const step = booking.sessionStep ?? SessionStep.NONE

  if (step === SessionStep.DONE) {
    redirect(aftercareHref(bookingId))
  }

  const allowedHere =
    step === SessionStep.AFTER_PHOTOS || step === SessionStep.FINISH_REVIEW

  if (!allowedHere) {
    redirect(sessionHubHref(bookingId))
  }

  const [items, afterCount] = await Promise.all([
    fetchAfterMedia(bookingId),
    prisma.mediaAsset.count({
      where: {
        bookingId,
        phase: MediaPhase.AFTER,
        uploadedByRole: Role.PRO,
      },
    }),
  ])

  const canContinue = afterCount > 0
  const serviceName = booking.service?.name?.trim() || 'Service'
  const clientName =
    fullName(booking.client?.firstName, booking.client?.lastName) ||
    booking.client?.user?.email ||
    'Client'

  return (
    <PageShell>
      <SessionHeader
        bookingId={bookingId}
        serviceName={serviceName}
        clientName={clientName}
        afterCount={afterCount}
      />

      <div className="brand-pro-session-scroll no-scroll">
        <StatusCard
          afterCount={afterCount}
          canContinue={canContinue}
          bookingId={bookingId}
          timeZone={proTimeZone}
        />

        <section className="mt-4">
          <div className="brand-pro-session-photo-header">
            <div className="brand-pro-session-section-title">
              After photo set
            </div>

            <div className="brand-pro-session-photo-count">
              <CheckIcon size={10} />
              {afterCount} captured
            </div>
          </div>

          <PhotoPlaceholderGrid count={afterCount} />
        </section>

        <section className="mt-4">
          <Card>
            <div className="brand-pro-session-card-heading">
              <CameraIcon />
              Upload after photos
            </div>

            <MediaUploader bookingId={bookingId} phase="AFTER" />
          </Card>
        </section>

        <section className="mt-4 pb-4">
          <Card>
            <MediaPreviewGrid items={items} title="Uploaded after media" />
          </Card>
        </section>
      </div>
    </PageShell>
  )
}