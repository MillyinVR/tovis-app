// app/pro/bookings/[id]/session/before-photos/page.tsx
import type { ReactNode } from 'react'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import {
  BookingStatus,
  ConsultationApprovalStatus,
  SessionStep,
} from '@prisma/client'

import MediaPreviewGrid from '../_components/MediaPreviewGrid'
import MediaUploader from '../MediaUploader'

import { transitionSessionStep } from '@/lib/booking/writeBoundary'
import { getCurrentUser } from '@/lib/currentUser'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import {
  beforePhotosHref,
  isTerminalBooking,
  labelForConsultationStatus,
  sessionHubHref,
} from '@/lib/proSession/sessionFlow'
import { getServerOrigin } from '@/lib/serverOrigin'

export const dynamic = 'force-dynamic'

type ServerAction = () => Promise<void>

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
  return `/login?from=${encodeURIComponent(beforePhotosHref(bookingId))}`
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

async function fetchBeforeMedia(bookingId: string): Promise<ApiMediaItem[]> {
  const origin = (await getServerOrigin()) || ''
  const url = origin
    ? `${origin}/api/pro/bookings/${encodeURIComponent(
        bookingId,
      )}/media?phase=BEFORE`
    : `/api/pro/bookings/${encodeURIComponent(bookingId)}/media?phase=BEFORE`

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

function SessionHeader({
  bookingId,
  serviceName,
  clientName,
  approved,
  photoCount,
}: {
  bookingId: string
  serviceName: string
  clientName: string
  approved: boolean
  photoCount: number
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

      <div
        className="brand-cap brand-pro-session-kicker"
        data-tone={approved ? 'success' : 'pending'}
      >
        {approved ? '◆ CONSULTATION APPROVED' : '⏳ WAITING ON APPROVAL'}
      </div>

      <h1 className="brand-pro-session-title" data-size="sm">
        Before photos
      </h1>

      <div className="brand-pro-session-subtitle">
        {clientName} · {serviceName}
      </div>

      <div className="brand-pro-session-header-pills">
        <span
          className="brand-pro-session-pill"
          data-tone={approved ? 'success' : 'pending'}
        >
          {approved ? 'APPROVED' : 'LOCKED'}
        </span>

        <span
          className="brand-pro-session-pill"
          data-state={photoCount > 0 ? 'done' : undefined}
        >
          {photoCount} PHOTO{photoCount === 1 ? '' : 'S'}
        </span>
      </div>
    </header>
  )
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
          <span className="brand-pro-session-photo-label">BEFORE</span>
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
  hasBefore,
  consultApproved,
  approvalStatus,
  canContinue,
  continueToService,
}: {
  hasBefore: boolean
  consultApproved: boolean
  approvalStatus: ConsultationApprovalStatus | null
  canContinue: boolean
  continueToService: ServerAction
}) {
  if (!hasBefore) {
    return (
      <Card accent>
        <div className="brand-pro-session-card-heading">
          <span className="brand-pro-session-card-dot" />
          Add at least one before photo
        </div>

        <div className="brand-pro-session-card-body">
          These are saved <strong>privately</strong> for you and the client.
          They will be used for after-photo comparison later.
        </div>
      </Card>
    )
  }

  if (!consultApproved) {
    return (
      <Card>
        <div className="brand-pro-session-card-heading">
          <span className="brand-pro-session-card-dot" />
          Before photos saved
        </div>

        <div className="brand-pro-session-card-body">
          Client still needs to approve the consultation. You can keep uploading
          before photos, but service stays locked.
        </div>

        <div className="brand-pro-session-chip-row mt-3">
          <span className="brand-pro-session-pill" data-tone="pending">
            Waiting: {labelForConsultationStatus(approvalStatus)}
          </span>
        </div>
      </Card>
    )
  }

  return (
    <Card tone="success">
      <div className="brand-pro-session-card-heading">
        <span className="brand-pro-session-card-dot" />
        Before photos saved
      </div>

      <div className="brand-pro-session-card-body">
        Consultation is approved and before photos are ready. You can start the
        service.
      </div>

      <form action={continueToService} className="mt-3">
        <button
          type="submit"
          disabled={!canContinue}
          aria-disabled={!canContinue}
          className="brand-pro-session-button brand-focus"
          data-full="true"
        >
          Continue to service <ArrowRightIcon />
        </button>
      </form>
    </Card>
  )
}

export default async function ProBeforePhotosPage(props: PageProps) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()

  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  const professionalId =
    user?.role === 'PRO' ? user.professionalProfile?.id ?? null : null

  if (!professionalId) {
    redirect(loginHref(bookingId))
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
      consultationApproval: {
        select: {
          status: true,
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
  const alreadyPastBefore =
    step === SessionStep.SERVICE_IN_PROGRESS ||
    step === SessionStep.FINISH_REVIEW ||
    step === SessionStep.AFTER_PHOTOS ||
    step === SessionStep.DONE

  if (alreadyPastBefore) {
    redirect(sessionHubHref(bookingId))
  }

  const approvalStatus = booking.consultationApproval?.status ?? null
  const consultApproved =
    approvalStatus === ConsultationApprovalStatus.APPROVED

  const items = await fetchBeforeMedia(bookingId)
  const hasBefore = items.length > 0
  const canContinue = consultApproved && hasBefore

  async function continueToService() {
    'use server'

    const currentUser = await getCurrentUser().catch(() => null)
    const currentProfessionalId =
      currentUser?.role === 'PRO'
        ? currentUser.professionalProfile?.id ?? null
        : null

    if (!currentProfessionalId) {
      redirect(loginHref(bookingId))
    }

    const result = await transitionSessionStep({
      bookingId,
      professionalId: currentProfessionalId,
      nextStep: SessionStep.SERVICE_IN_PROGRESS,
    })

    if (!result.ok) {
      redirect(beforePhotosHref(bookingId))
    }

    redirect(sessionHubHref(bookingId))
  }

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
        approved={consultApproved}
        photoCount={items.length}
      />

      <div className="brand-pro-session-scroll no-scroll">
        <StatusCard
          hasBefore={hasBefore}
          consultApproved={consultApproved}
          approvalStatus={approvalStatus}
          canContinue={canContinue}
          continueToService={continueToService}
        />

        <section className="mt-4">
          <div className="brand-pro-session-photo-header">
            <div className="brand-pro-session-section-title">
              Before photo set
            </div>

            <div className="brand-pro-session-photo-count">
              <CheckIcon size={10} />
              {items.length} captured
            </div>
          </div>

          <PhotoPlaceholderGrid count={items.length} />
        </section>

        <section className="mt-4">
          <Card>
            <div className="brand-pro-session-card-heading">
              <CameraIcon />
              Upload before photos
            </div>

            <MediaUploader bookingId={bookingId} phase="BEFORE" />
          </Card>
        </section>

        <section className="mt-4 pb-4">
          <Card>
            <MediaPreviewGrid items={items} title="Uploaded before media" />
          </Card>
        </section>

        <div className="brand-pro-session-help-text pb-4">
          Continue locked: <strong>{String(!canContinue)}</strong>
        </div>
      </div>
    </PageShell>
  )
}