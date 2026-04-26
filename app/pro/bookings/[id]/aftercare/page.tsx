// app/pro/bookings/[id]/aftercare/page.tsx
import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  AftercareRebookMode,
  MediaPhase,
  SessionStep,
} from '@prisma/client'

import AftercareForm from './AftercareForm'

import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import {
  aftercareHref,
  isTerminalBooking,
  sessionHubHref,
} from '@/lib/proSession/sessionFlow'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

type PublicAccessSummary = {
  label: string
  help: string
  tone: 'success' | 'pending' | 'danger'
}

const SIGNED_URL_TTL_SECONDS = 60 * 10

function loginHref(bookingId: string): string {
  return `/login?from=${encodeURIComponent(aftercareHref(bookingId))}`
}

function fullName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim()
}

function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false

  const trimmed = value.trim()
  if (!trimmed) return false

  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function dateToIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function toDisplayDateTime(value: Date | null | undefined): string | null {
  if (!value) return null

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value)
}

function buildPublicAccessSummary(args: {
  hasDraft: boolean
  isFinalized: boolean
}): PublicAccessSummary {
  if (args.isFinalized) {
    return {
      label: 'Secure client access ready',
      help: 'Client-facing aftercare access is available through the secure aftercare link flow.',
      tone: 'success',
    }
  }

  if (args.hasDraft) {
    return {
      label: 'Draft only',
      help: 'The aftercare draft exists, but client access is not live until you send/finalize it.',
      tone: 'pending',
    }
  }

  return {
    label: 'Not ready',
    help: 'No client-facing aftercare access exists yet.',
    tone: 'danger',
  }
}

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

function DraftIcon({ size = 12 }: { size?: number }) {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function LinkIcon({ size = 12 }: { size?: number }) {
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
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
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

function StatusPill({
  label,
  tone,
}: {
  label: string
  tone?: 'success' | 'pending' | 'danger'
}) {
  return (
    <span className="brand-pro-session-pill" data-tone={tone}>
      {label}
    </span>
  )
}

function Header({
  bookingId,
  serviceName,
  clientName,
  hasDraft,
  isFinalized,
}: {
  bookingId: string
  serviceName: string
  clientName: string
  hasDraft: boolean
  isFinalized: boolean
}) {
  return (
    <header className="brand-pro-session-header" data-border="true">
      <Link
        href={sessionHubHref(bookingId)}
        prefetch
        className="brand-pro-session-back brand-focus"
      >
        <ChevronLeftIcon />
        Session hub
      </Link>

      <div
        className="brand-cap brand-pro-session-kicker"
        data-tone={isFinalized ? 'success' : 'muted'}
      >
        WRAP-UP · AFTERCARE
      </div>

      <h1 className="brand-pro-session-title" data-size="sm">
        Aftercare
      </h1>

      <div className="brand-pro-session-subtitle">
        {clientName} · {serviceName}
      </div>

      <div className="brand-pro-session-header-pills">
        <StatusPill
          label={
            isFinalized
              ? 'FINALIZED'
              : hasDraft
                ? 'DRAFT SAVED'
                : 'NOT STARTED'
          }
          tone={isFinalized ? 'success' : hasDraft ? 'pending' : 'danger'}
        />

        <StatusPill label="CLIENT-FACING" tone="pending" />
      </div>
    </header>
  )
}

function SummaryCard({
  publicAccess,
  hasDraft,
  isFinalized,
  lastEditedAt,
  draftSavedAt,
  sentToClientAt,
  version,
}: {
  publicAccess: PublicAccessSummary
  hasDraft: boolean
  isFinalized: boolean
  lastEditedAt: Date | null | undefined
  draftSavedAt: Date | null | undefined
  sentToClientAt: Date | null | undefined
  version: number | null | undefined
}) {
  const lastEditedLabel = toDisplayDateTime(lastEditedAt)
  const draftSavedLabel = toDisplayDateTime(draftSavedAt)
  const sentToClientLabel = toDisplayDateTime(sentToClientAt)

  return (
    <Card accent>
      <div className="brand-pro-session-card-heading">
        <span className="brand-pro-session-card-dot" />
        Aftercare + after photos are a wrap-up pair
      </div>

      <div className="brand-pro-session-card-body">
        Do either first, then complete the session from the session hub once
        after photos and finalized aftercare are both ready.
      </div>

      <div className="brand-pro-session-check-row">
        <div className="brand-pro-session-check-icon">
          {isFinalized ? <CheckIcon /> : <DraftIcon />}
        </div>

        <div className="brand-pro-session-check-main">
          <div className="brand-pro-session-check-title">
            Aftercare status
          </div>
          <div className="brand-pro-session-check-sub">
            {isFinalized
              ? 'Finalized + sent'
              : hasDraft
                ? 'Draft saved'
                : 'Not started'}
          </div>
        </div>

        <StatusPill
          label={isFinalized ? 'DONE' : hasDraft ? 'DRAFT' : 'TODO'}
          tone={isFinalized ? 'success' : hasDraft ? 'pending' : 'danger'}
        />
      </div>

      <div className="brand-pro-session-check-row">
        <div className="brand-pro-session-check-icon">
          <LinkIcon />
        </div>

        <div className="brand-pro-session-check-main">
          <div className="brand-pro-session-check-title">Client access</div>
          <div className="brand-pro-session-check-sub">
            {publicAccess.label}
          </div>
        </div>

        <StatusPill label={publicAccess.tone.toUpperCase()} tone={publicAccess.tone} />
      </div>

      <div className="brand-pro-session-card-body mt-3">
        {publicAccess.help}
      </div>

      <div className="brand-pro-session-stat-grid">
        {lastEditedLabel ? (
          <div className="brand-pro-session-stat-card">
            <div className="brand-cap brand-pro-session-stat-label">
              LAST EDITED
            </div>
            <div className="brand-pro-session-stat-value">
              {lastEditedLabel}
            </div>
          </div>
        ) : null}

        {draftSavedLabel && !isFinalized ? (
          <div className="brand-pro-session-stat-card">
            <div className="brand-cap brand-pro-session-stat-label">
              DRAFT SAVED
            </div>
            <div className="brand-pro-session-stat-value">
              {draftSavedLabel}
            </div>
          </div>
        ) : null}

        {sentToClientLabel ? (
          <div className="brand-pro-session-stat-card">
            <div className="brand-cap brand-pro-session-stat-label">
              SENT
            </div>
            <div className="brand-pro-session-stat-value">
              {sentToClientLabel}
            </div>
          </div>
        ) : null}

        {version !== null && version !== undefined ? (
          <div className="brand-pro-session-stat-card">
            <div className="brand-cap brand-pro-session-stat-label">
              VERSION
            </div>
            <div className="brand-pro-session-stat-value">{version}</div>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

export default async function ProAftercarePage({ params }: PageProps) {
  const { id } = await params
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
      locationTimeZone: true,

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

      aftercareSummary: {
        select: {
          id: true,
          notes: true,
          rebookedFor: true,
          rebookMode: true,
          rebookWindowStart: true,
          rebookWindowEnd: true,
          draftSavedAt: true,
          sentToClientAt: true,
          lastEditedAt: true,
          version: true,
          recommendedProducts: {
            orderBy: {
              id: 'asc',
            },
            select: {
              id: true,
              note: true,
              product: {
                select: {
                  name: true,
                },
              },
              externalName: true,
              externalUrl: true,
            },
          },
        },
      },

      mediaAssets: {
        orderBy: {
          createdAt: 'desc',
        },
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
  if (booking.professionalId !== professionalId) redirect('/pro')

  if (
    !booking.startedAt ||
    isTerminalBooking(booking.status, booking.finishedAt)
  ) {
    redirect(sessionHubHref(bookingId))
  }

  const step = booking.sessionStep ?? SessionStep.NONE
  const allowedHere =
    step === SessionStep.AFTER_PHOTOS || step === SessionStep.DONE

  if (!allowedHere) {
    redirect(sessionHubHref(bookingId))
  }

  const timeZoneResult = await resolveApptTimeZone({
    bookingLocationTimeZone: booking.locationTimeZone,
    professionalTimeZone: user?.professionalProfile?.timeZone,
    fallback: 'UTC',
    requireValid: false,
  })

  const timeZone = timeZoneResult.ok ? timeZoneResult.timeZone : 'UTC'
  const aftercare = booking.aftercareSummary

  const existingMedia = await Promise.all(
    booking.mediaAssets.map(async (media) => {
      const httpUrl = isHttpUrl(media.url) ? media.url : null
      const httpThumbUrl = isHttpUrl(media.thumbUrl) ? media.thumbUrl : null

      const renderUrl =
        httpUrl ?? (await signObjectUrl(media.storageBucket, media.storagePath))
      const renderThumbUrl =
        httpThumbUrl ??
        (await signObjectUrl(media.thumbBucket, media.thumbPath))

      return {
        id: media.id,
        url: media.url ?? null,
        thumbUrl: media.thumbUrl ?? null,
        renderUrl,
        renderThumbUrl,
        mediaType: media.mediaType,
        visibility: media.visibility,
        uploadedByRole: media.uploadedByRole ?? null,
        reviewId: media.reviewId ?? null,
        createdAt: media.createdAt.toISOString(),
        phase: media.phase ?? MediaPhase.OTHER,
      }
    }),
  )

  const existingRecommendedProducts =
    aftercare?.recommendedProducts.map((recommendation) => ({
      id: recommendation.id,
      name:
        recommendation.product?.name ??
        recommendation.externalName?.trim() ??
        '',
      url: recommendation.externalUrl?.trim() ?? '',
      note: recommendation.note ?? '',
    })) ?? []

  const serviceName = booking.service?.name?.trim() || 'Service'
  const clientName =
    fullName(booking.client?.firstName, booking.client?.lastName) ||
    booking.client?.user?.email ||
    'Client'

  const hasAftercareDraft = Boolean(aftercare?.id)
  const hasFinalizedAftercare = Boolean(aftercare?.sentToClientAt)

  const publicAccess = buildPublicAccessSummary({
    hasDraft: hasAftercareDraft,
    isFinalized: hasFinalizedAftercare,
  })

  return (
    <PageShell>
      <Header
        bookingId={bookingId}
        serviceName={serviceName}
        clientName={clientName}
        hasDraft={hasAftercareDraft}
        isFinalized={hasFinalizedAftercare}
      />

      <div className="brand-pro-session-scroll no-scroll">
        <SummaryCard
          publicAccess={publicAccess}
          hasDraft={hasAftercareDraft}
          isFinalized={hasFinalizedAftercare}
          lastEditedAt={aftercare?.lastEditedAt}
          draftSavedAt={aftercare?.draftSavedAt}
          sentToClientAt={aftercare?.sentToClientAt}
          version={aftercare?.version}
        />

        <div className="mt-4 pb-4">
          <AftercareForm
            bookingId={bookingId}
            timeZone={timeZone}
            existingNotes={aftercare?.notes ?? ''}
            existingRebookMode={aftercare?.rebookMode ?? AftercareRebookMode.NONE}
            existingRebookedFor={dateToIso(aftercare?.rebookedFor)}
            existingRebookWindowStart={dateToIso(
              aftercare?.rebookWindowStart,
            )}
            existingRebookWindowEnd={dateToIso(aftercare?.rebookWindowEnd)}
            existingMedia={existingMedia}
            existingRecommendedProducts={existingRecommendedProducts}
            existingDraftSavedAt={dateToIso(aftercare?.draftSavedAt)}
            existingSentToClientAt={dateToIso(aftercare?.sentToClientAt)}
            existingLastEditedAt={dateToIso(aftercare?.lastEditedAt)}
            existingVersion={aftercare?.version ?? null}
            existingIsFinalized={hasFinalizedAftercare}
          />
        </div>
      </div>
    </PageShell>
  )
}