// app/pro/bookings/[id]/session/after-photos/page.tsx
import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  MediaPhase,
  Role,
  SessionStep,
} from '@prisma/client'

import MediaUploader from '../MediaUploader'
import FeaturedPairPicker from './FeaturedPairPicker'

import {
  FEATURED_AFTER_PARAM,
  FEATURED_BEFORE_PARAM,
  normalizeSeedParam,
} from '@/lib/aftercare/featuredPairParams'
import { resolveFeaturedPairSeed } from '@/lib/aftercare/featuredPairSeed'
import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import { listProBookingMedia } from '@/lib/proBookingMedia'
import {
  afterPhotosHref,
  aftercareHref,
  isTerminalBooking,
  sessionHubHref,
} from '@/lib/proSession/sessionFlow'
import { DEFAULT_TIME_ZONE, friendlyTimeZoneLabel, sanitizeTimeZone } from '@/lib/timeZone'
import { fullName } from '@/lib/names'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

function loginHref(bookingId: string): string {
  return `/login?from=${encodeURIComponent(afterPhotosHref(bookingId))}`
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

function LockIcon({ size = 17 }: { size?: number }) {
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
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
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

// Shown while no after photo has been captured yet — aftercare stays locked
// until there is at least one. Once an after photo exists the page swaps this
// for the FeaturedPairPicker, which carries the pro's featured pick into the
// aftercare step via its own "Continue to aftercare" action.
function LockedStatusCard({ timeZone }: { timeZone: string }) {
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
        Times shown in <strong>{friendlyTimeZoneLabel(timeZone) ?? timeZone}</strong>
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
      // Field-keyed read (never branches on row existence) so a bare summary
      // could not exist here anyway — seeds the featured-pair picker with any
      // already-saved choice.
      aftercareSummary: {
        select: {
          featuredBeforeAssetId: true,
          featuredAfterAssetId: true,
        },
      },
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

  // After photos are captured once the service is finished. FINISH_REVIEW is a
  // transient internal step we now pass through on the way to AFTER_PHOTOS, so
  // accept both rather than bouncing the pro back to the hub.
  if (
    step !== SessionStep.AFTER_PHOTOS &&
    step !== SessionStep.FINISH_REVIEW
  ) {
    redirect(sessionHubHref(bookingId))
  }
  const [beforeOutcome, afterOutcome, afterCount, searchParams] =
    await Promise.all([
      listProBookingMedia({
        bookingId,
        professionalId,
        phase: MediaPhase.BEFORE,
      }),
      listProBookingMedia({
        bookingId,
        professionalId,
        phase: MediaPhase.AFTER,
      }),
      prisma.mediaAsset.count({
        where: {
          bookingId,
          phase: MediaPhase.AFTER,
          uploadedByRole: Role.PRO,
        },
      }),
      props.searchParams,
    ])

  const beforeItems = beforeOutcome.ok ? beforeOutcome.items : []
  const afterItems = afterOutcome.ok ? afterOutcome.items : []

  // Seed the featured pick from an in-session `?fb=`/`?fa=` pre-selection (the
  // pro may have picked here and refreshed) or, absent that, any already-saved
  // aftercare featured pair. Same resolver the aftercare form uses downstream,
  // so the two surfaces stay in agreement.
  const featuredSeed = resolveFeaturedPairSeed({
    savedBeforeAssetId: booking.aftercareSummary?.featuredBeforeAssetId ?? null,
    savedAfterAssetId: booking.aftercareSummary?.featuredAfterAssetId ?? null,
    paramBeforeAssetId: normalizeSeedParam(searchParams[FEATURED_BEFORE_PARAM]),
    paramAfterAssetId: normalizeSeedParam(searchParams[FEATURED_AFTER_PARAM]),
    media: [...beforeItems, ...afterItems].map((m) => ({
      id: m.id,
      phase: m.phase,
      mediaType: m.mediaType,
    })),
  })

  const canContinue = afterCount > 0
  const serviceName = booking.service?.name?.trim() || 'Service'
  const clientName =
    fullName(booking.client?.firstName, booking.client?.lastName) ||
    booking.client?.user?.email ||
    'Client'
  const clientFirst = clientName.split(' ')[0] || clientName

  return (
    <PageShell>
      <SessionHeader
        bookingId={bookingId}
        serviceName={serviceName}
        clientName={clientName}
        afterCount={afterCount}
      />

      <div className="brand-pro-session-scroll no-scroll">
        <div className="brand-pro-session-privacy">
          <span className="brand-pro-session-privacy-icon">
            <LockIcon />
          </span>
          <div>
            Saved <strong>privately</strong> for you and {clientFirst}. They
            become the after of your before/after comparison.
          </div>
        </div>

        <section className="mt-4">
          <div className="brand-pro-session-capture">
            <span className="brand-pro-session-capture-icon">
              <CameraIcon size={26} />
            </span>

            <div className="brand-pro-session-capture-title">
              Take or upload after photos
            </div>

            <div className="brand-pro-session-capture-sub">
              Tap to capture or choose a file. It uploads automatically and
              compresses for you.
            </div>

            <div className="w-full">
              <MediaUploader bookingId={bookingId} phase="AFTER" />
            </div>

            <div className="brand-cap brand-pro-session-capture-formats">
              JPG · PNG · MP4 up to 30MB · auto-compressed
            </div>
          </div>
        </section>

        <section className="mt-4">
          {canContinue ? (
            <FeaturedPairPicker
              aftercareHref={aftercareHref(bookingId)}
              beforeItems={beforeItems}
              afterItems={afterItems}
              initialBeforeId={featuredSeed.featuredBeforeAssetId}
              initialAfterId={featuredSeed.featuredAfterAssetId}
            />
          ) : (
            <LockedStatusCard timeZone={proTimeZone} />
          )}
        </section>
      </div>
    </PageShell>
  )
}