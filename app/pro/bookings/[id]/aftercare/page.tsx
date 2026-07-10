// app/pro/bookings/[id]/aftercare/page.tsx
import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  AftercareRebookMode,
  BookingStatus,
  MediaPhase,
  SessionStep,
} from '@prisma/client'

import AftercareForm from './AftercareForm'
import { computeSuggestedRebookWindow } from './aftercareDates'
import ClientProfilePanel from './ClientProfilePanel'
import ServicesReceivedCard from './ServicesReceivedCard'

import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import { formatInTimeZone } from '@/lib/time'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToFixed2String } from '@/lib/money'
import { fullName } from '@/lib/names'
import { prisma } from '@/lib/prisma'
import { formatPublicProfileDisplayName } from '@/lib/profiles/publicProfileFormatting'
import {
  aftercareHref,
  sessionHubHref,
} from '@/lib/proSession/sessionFlow'
import { renderMediaUrlsBatch } from '@/lib/media/renderUrls'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

type PublicAccessSummary = {
  label: string
  help: string
  tone: 'success' | 'pending' | 'danger'
}

function loginHref(bookingId: string): string {
  return `/login?from=${encodeURIComponent(aftercareHref(bookingId))}`
}

function dateToIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function toDisplayDateTime(
  value: Date | null | undefined,
  timeZone: string,
): string | null {
  if (!value) return null

  return formatInTimeZone(value, timeZone, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
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

function AlertTriangleIcon({ size = 19 }: { size?: number }) {
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
      <path d="M12 3.5L22 20H2z" />
      <path d="M12 9.5v5" />
      <path d="M12 17.1v.1" />
    </svg>
  )
}

type AftercareAllergy = {
  id: string
  label: string
  severity: string
  description: string | null
}

const ALLERGY_SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MODERATE: 2,
  LOW: 1,
}

function severityLabel(severity: string): string {
  const value = severity.toUpperCase()
  if (!value) return ''
  return value.charAt(0) + value.slice(1).toLowerCase()
}

function PageShell({ children }: { children: ReactNode }) {
  // Opt this page into the wider desktop shell so the aftercare editor can
  // reflow into two columns at >=1024px. Every other session screen keeps the
  // default narrow mobile shell (no data-wide), so the flow stays consistent.
  return (
    <main className="brand-pro-session-page" data-wide="true">
      {children}
    </main>
  )
}

// Safety-first allergy alert. The client's allergies are also managed lower in
// ClientProfilePanel; this surfaces them prominently at the very top so the pro
// can't miss a contraindication before writing aftercare. Pros-only — never
// shown to the client. Most-severe first.
function AllergyAlert({ allergies }: { allergies: AftercareAllergy[] }) {
  const sorted = [...allergies].sort(
    (a, b) =>
      (ALLERGY_SEVERITY_RANK[b.severity.toUpperCase()] ?? 0) -
      (ALLERGY_SEVERITY_RANK[a.severity.toUpperCase()] ?? 0),
  )

  return (
    <section className="brand-pro-session-card" data-tone="danger">
      <div className="brand-pro-session-allergy-head">
        <span className="brand-pro-session-allergy-icon">
          <AlertTriangleIcon />
        </span>
        <div>
          <div className="brand-pro-session-allergy-title">
            Allergy on file — check before any product or color
          </div>
          <div className="brand-pro-session-allergy-note">
            Private to pros only — never shown to the client.
          </div>
        </div>
      </div>

      <div className="brand-pro-session-allergy-list">
        {sorted.map((allergy) => (
          <div key={allergy.id} className="brand-pro-session-allergy-item">
            <div className="brand-pro-session-allergy-label">
              {allergy.label}{' '}
              <span
                className="brand-pro-session-allergy-sev"
                data-severity={allergy.severity.toLowerCase()}
              >
                · {severityLabel(allergy.severity)}
              </span>
            </div>
            {allergy.description ? (
              <div className="brand-pro-session-allergy-desc">
                {allergy.description}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
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

        <StatusPill
          label={isFinalized ? 'CLIENT ACCESS LIVE' : 'CLIENT ACCESS LOCKED'}
          tone={isFinalized ? 'success' : 'pending'}
        />
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
  timeZone,
}: {
  publicAccess: PublicAccessSummary
  hasDraft: boolean
  isFinalized: boolean
  lastEditedAt: Date | null | undefined
  draftSavedAt: Date | null | undefined
  sentToClientAt: Date | null | undefined
  version: number | null | undefined
  timeZone: string
}) {
  const lastEditedLabel = toDisplayDateTime(lastEditedAt, timeZone)
  const draftSavedLabel = toDisplayDateTime(draftSavedAt, timeZone)
  const sentToClientLabel = toDisplayDateTime(sentToClientAt, timeZone)

  return (
    <Card accent>
      <div className="brand-pro-session-card-heading">
        <span className="brand-pro-session-card-dot" />
        Aftercare + after photos are a wrap-up pair
      </div>

      <div className="brand-pro-session-card-body">
        Do either first. Once after photos, finalized aftercare, payment,
        checkout, and consultation are all complete, closeout will finalize the
        booking.
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
          label={isFinalized ? 'Done' : hasDraft ? 'Draft' : 'To do'}
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
      clientId: true,
      serviceId: true,
      offeringId: true,
      locationType: true,
      locationId: true,
      clientAddressId: true,
      status: true,
      scheduledFor: true,
      startedAt: true,
      finishedAt: true,
      sessionStep: true,
      locationTimeZone: true,

      serviceSubtotalSnapshot: true,
      discountAmount: true,
      taxAmount: true,
      tipAmount: true,
      totalAmount: true,

      service: {
        select: {
          name: true,
        },
      },

      // The booking's primary offering drives the auto-suggested rebook window
      // (service date + the offering's typical rebook interval).
      offering: {
        select: {
          rebookIntervalDays: true,
        },
      },

      serviceItems: {
        orderBy: {
          sortOrder: 'asc',
        },
        select: {
          id: true,
          itemType: true,
          priceSnapshot: true,
          durationMinutesSnapshot: true,
          service: {
            select: {
              name: true,
            },
          },
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
          allergies: {
            orderBy: {
              createdAt: 'desc',
            },
            select: {
              id: true,
              label: true,
              severity: true,
              description: true,
              createdAt: true,
              recordedBy: {
                select: {
                  businessName: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
          notes: {
            where: {
              professionalId,
            },
            orderBy: {
              createdAt: 'desc',
            },
            select: {
              id: true,
              title: true,
              body: true,
              createdAt: true,
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
          rebookDeclinedAt: true,
          featuredBeforeAssetId: true,
          featuredAfterAssetId: true,
          rebookSlot: {
            select: {
              offeringId: true,
              locationId: true,
              locationType: true,
              startsAt: true,
              endsAt: true,
            },
          },
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

  const isCancelled = booking.status === BookingStatus.CANCELLED

  // A completed booking has no live session to act on, but the pro still wants
  // to *review* the aftercare they just finished. Serve it as a locked,
  // read-only summary instead of bouncing back to the session hub. We key on
  // status === COMPLETED (not finishedAt) to match the write boundary exactly:
  // a live session can carry a finishedAt while still being IN_PROGRESS, and
  // its aftercare must stay editable.
  const readOnly = booking.status === BookingStatus.COMPLETED

  // Nothing to view for cancelled or never-started bookings.
  if (isCancelled || !booking.startedAt) {
    redirect(sessionHubHref(bookingId))
  }

  if (!readOnly) {
    const step = booking.sessionStep ?? SessionStep.NONE
    const allowedHere =
      step === SessionStep.AFTER_PHOTOS || step === SessionStep.DONE

    if (!allowedHere) {
      redirect(sessionHubHref(bookingId))
    }
  }

  const timeZoneResult = await resolveApptTimeZone({
    bookingLocationTimeZone: booking.locationTimeZone,
    professionalTimeZone: user?.professionalProfile?.timeZone,
    fallback: 'UTC',
    requireValid: false,
  })

  const timeZone = timeZoneResult.ok ? timeZoneResult.timeZone : 'UTC'
  const aftercare = booking.aftercareSummary

  // Auto-suggested recommended-window rebook dates for a fresh wrap-up. Only
  // offered when no aftercare has been saved yet, so a pro's saved choice (even
  // an explicit "None") is never overwritten. Null when the offering has no
  // rebook interval set — the recommendation then stays "None" as before.
  const rebookSuggestion = aftercare
    ? null
    : computeSuggestedRebookWindow({
        intervalDays: booking.offering?.rebookIntervalDays ?? null,
        anchorIso: booking.scheduledFor.toISOString(),
        timeZone,
      })

  // Sign every asset's full + thumb in one batched pass (one round-trip per
  // private bucket) rather than 2×N sequential signed-URL calls — the latter is
  // what made this force-dynamic page slow and made full vs. thumb resolve
  // independently (a thumb-only asset used to render as a non-clickable tile).
  const renderedMedia = await renderMediaUrlsBatch(booking.mediaAssets)
  const existingMedia = booking.mediaAssets.map((media, index) => ({
    id: media.id,
    url: media.url ?? null,
    thumbUrl: media.thumbUrl ?? null,
    renderUrl: renderedMedia[index]?.renderUrl ?? null,
    renderThumbUrl: renderedMedia[index]?.renderThumbUrl ?? null,
    mediaType: media.mediaType,
    visibility: media.visibility,
    uploadedByRole: media.uploadedByRole ?? null,
    reviewId: media.reviewId ?? null,
    createdAt: media.createdAt.toISOString(),
    phase: media.phase ?? MediaPhase.OTHER,
  }))

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

  const serviceLines = booking.serviceItems.map((item) => ({
    id: item.id,
    name: item.service?.name?.trim() || 'Service',
    isAddOn: item.itemType === 'ADD_ON',
    price: moneyToFixed2String(item.priceSnapshot),
    durationMinutes: item.durationMinutesSnapshot ?? null,
  }))

  const pricing = {
    serviceSubtotal: moneyToFixed2String(booking.serviceSubtotalSnapshot),
    discount: moneyToFixed2String(booking.discountAmount),
    tax: moneyToFixed2String(booking.taxAmount),
    tip: moneyToFixed2String(booking.tipAmount),
    total: moneyToFixed2String(booking.totalAmount),
  }

  const clientAllergies = (booking.client?.allergies ?? []).map((allergy) => ({
    id: allergy.id,
    label: allergy.label,
    severity: String(allergy.severity),
    description: allergy.description ?? null,
    createdAt: allergy.createdAt.toISOString(),
    recordedByName: allergy.recordedBy
      ? formatPublicProfileDisplayName({
          businessName: allergy.recordedBy.businessName,
          firstName: allergy.recordedBy.firstName,
          lastName: allergy.recordedBy.lastName,
          fallback: 'Professional',
        })
      : null,
  }))

  const clientNotes = (booking.client?.notes ?? []).map((note) => ({
    id: note.id,
    title: note.title ?? null,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
  }))

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
        {clientAllergies.length > 0 ? (
          <div className="mb-4">
            <AllergyAlert allergies={clientAllergies} />
          </div>
        ) : null}

        {readOnly ? (
          <Card tone="success">
            <div className="brand-pro-session-section-title">
              This booking is completed.
            </div>
            <div className="brand-pro-session-card-body mt-1">
              You’re viewing the finished aftercare. It’s read-only now that the
              session is closed out.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/pro/calendar"
                prefetch
                className="brand-pro-session-button brand-focus"
                data-variant="ghost"
                data-full={false}
              >
                Calendar
              </Link>
              <Link
                href="/pro/bookings"
                prefetch
                className="brand-pro-session-button brand-focus"
                data-variant="ghost"
                data-full={false}
              >
                All bookings
              </Link>
              <Link
                href="/pro/aftercare"
                prefetch
                className="brand-pro-session-button brand-focus"
                data-variant="ghost"
                data-full={false}
              >
                Aftercare tab
              </Link>
            </div>
          </Card>
        ) : null}

        <div className={readOnly ? 'mt-4' : undefined}>
          <SummaryCard
            publicAccess={publicAccess}
            hasDraft={hasAftercareDraft}
            isFinalized={hasFinalizedAftercare}
            lastEditedAt={aftercare?.lastEditedAt}
            draftSavedAt={aftercare?.draftSavedAt}
            sentToClientAt={aftercare?.sentToClientAt}
            version={aftercare?.version}
            timeZone={timeZone}
          />
        </div>

        <div className="mt-4">
          <ServicesReceivedCard services={serviceLines} pricing={pricing} />
        </div>

        <div className="mt-4">
          <ClientProfilePanel
            clientId={booking.clientId}
            allergies={clientAllergies}
            notes={clientNotes}
          />
        </div>

        <div className="mt-4 pb-4">
          <AftercareForm
            bookingId={bookingId}
            timeZone={timeZone}
            rebookProfessionalId={booking.professionalId}
            rebookServiceId={booking.serviceId}
            rebookOfferingId={booking.offeringId}
            rebookLocationType={booking.locationType}
            rebookLocationId={booking.locationId}
            rebookClientAddressId={booking.clientAddressId}
            existingNotes={aftercare?.notes ?? ''}
            existingRebookMode={aftercare?.rebookMode ?? AftercareRebookMode.NONE}
            existingRebookedFor={dateToIso(aftercare?.rebookedFor)}
            existingRebookWindowStart={dateToIso(
              aftercare?.rebookWindowStart,
            )}
            existingRebookWindowEnd={dateToIso(aftercare?.rebookWindowEnd)}
            existingRebookDeclinedAt={dateToIso(aftercare?.rebookDeclinedAt)}
            suggestedRebookWindowStart={rebookSuggestion?.windowStartIso ?? null}
            suggestedRebookWindowEnd={rebookSuggestion?.windowEndIso ?? null}
            existingRebookSlot={
              aftercare?.rebookSlot
                ? {
                    offeringId: aftercare.rebookSlot.offeringId,
                    locationId: aftercare.rebookSlot.locationId,
                    locationType: aftercare.rebookSlot.locationType,
                    startsAt: aftercare.rebookSlot.startsAt.toISOString(),
                    endsAt: aftercare.rebookSlot.endsAt.toISOString(),
                  }
                : null
            }
            existingMedia={existingMedia}
            existingFeaturedBeforeAssetId={aftercare?.featuredBeforeAssetId ?? null}
            existingFeaturedAfterAssetId={aftercare?.featuredAfterAssetId ?? null}
            existingRecommendedProducts={existingRecommendedProducts}
            existingDraftSavedAt={dateToIso(aftercare?.draftSavedAt)}
            existingSentToClientAt={dateToIso(aftercare?.sentToClientAt)}
            existingLastEditedAt={dateToIso(aftercare?.lastEditedAt)}
            existingVersion={aftercare?.version ?? null}
            existingIsFinalized={hasFinalizedAftercare}
            readOnly={readOnly}
          />
        </div>
      </div>
    </PageShell>
  )
}