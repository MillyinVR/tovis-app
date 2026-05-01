// app/pro/bookings/[id]/session/page.tsx
import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  BookingServiceItemType,
  BookingStatus,
  ConsultationApprovalStatus,
  ConsultationDecision,
  MediaPhase,
  Role,
  SessionStep,
} from '@prisma/client'

import ConsultationForm, {
  type ConsultationInitialItem,
} from '../ConsultationForm'

import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import {
  recordInPersonConsultationDecision,
  transitionSessionStep,
} from '@/lib/booking/writeBoundary'
import {
  afterPhotosHref,
  aftercareHref,
  beforePhotosHref,
  buildSessionStepItems,
  getSessionScreenKey,
  isConsultationApproved,
  isConsultationPending,
  isConsultationRejected,
  isTerminalBooking,
  labelForConsultationDecision,
  labelForConsultationStatus,
  labelForProofMethod,
  labelForSessionStep,
  resolveEffectiveSessionStep,
  sessionHubHref,
} from '@/lib/proSession/sessionFlow'
import { moneyToFixed2String, type MoneyInput } from '@/lib/money'

export const dynamic = 'force-dynamic'

type ServerAction = () => Promise<void>

type PageProps = {
  params: Promise<{ id: string }>
}

type ButtonVariant = 'primary' | 'ghost' | 'danger'

type HeaderPill = {
  label: string
  state?: 'active' | 'done'
  tone?: 'success' | 'pending' | 'danger'
}

type BookingServiceItemForInitial = {
  id: string
  serviceId: string
  offeringId: string | null
  itemType: BookingServiceItemType | null
  priceSnapshot: MoneyInput
  durationMinutesSnapshot: number
  notes: string | null
  sortOrder: number
  service: {
    name: string | null
  } | null
}

function loginHref(bookingId: string): string {
  return `/login?from=${encodeURIComponent(sessionHubHref(bookingId))}`
}

function fullName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim()
}

function moneyText(value: MoneyInput | null | undefined): string {
  return moneyToFixed2String(value) ?? ''
}

function moneyLabel(value: MoneyInput | null | undefined): string {
  const text = moneyText(value)
  return text ? `$${text}` : ''
}

function firstMoneyText(
  ...values: Array<MoneyInput | null | undefined>
): string {
  for (const value of values) {
    const text = moneyText(value)
    if (text) return text
  }

  return ''
}

function firstMoneyLabel(
  ...values: Array<MoneyInput | null | undefined>
): string {
  const text = firstMoneyText(...values)
  return text ? `$${text}` : ''
}

function formatDateTime(value: Date | null | undefined): string | null {
  if (!value) return null

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value)
}

function formatTimeOnly(value: Date | null | undefined): string {
  if (!value) return '—'

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(value)
}

function formatAppointmentLine(args: {
  clientName: string
  scheduledFor: Date | null
  durationLabel: string
}): string {
  const when = args.scheduledFor ? formatDateTime(args.scheduledFor) : 'Time TBD'
  return `${args.clientName} · ${when ?? 'Time TBD'} · ${args.durationLabel}`
}

function formatElapsed(startedAt: Date | null | undefined): string {
  if (!startedAt) return '0:00:00'

  const elapsedMs = Math.max(0, Date.now() - startedAt.getTime())
  const totalSeconds = Math.floor(elapsedMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [
    String(hours),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':')
}

function sumDurations(
  items: BookingServiceItemForInitial[] | null | undefined,
) {
  const rows = Array.isArray(items) ? items : []

  return rows.reduce((total, item) => {
    const duration = Number(item.durationMinutesSnapshot)
    return Number.isFinite(duration) && duration > 0
      ? total + duration
      : total
  }, 0)
}

function buildInitialConsultationItems(
  items: BookingServiceItemForInitial[] | null | undefined,
): ConsultationInitialItem[] {
  const rows = Array.isArray(items) ? items : []

  return rows.map((item, index) => ({
    key: item.id,
    bookingServiceItemId: item.id,
    serviceId: item.serviceId,
    offeringId: item.offeringId,
    itemType:
      item.itemType ??
      (index === 0
        ? BookingServiceItemType.BASE
        : BookingServiceItemType.ADD_ON),
    label: item.service?.name?.trim() || 'Service',
    categoryName: null,
    price: moneyText(item.priceSnapshot),
    durationMinutes:
      item.durationMinutesSnapshot > 0
        ? String(item.durationMinutesSnapshot)
        : '',
    notes: item.notes ?? '',
    sortOrder: item.sortOrder,
    source: 'BOOKING',
  }))
}

async function transitionAction(bookingId: string, next: SessionStep) {
  'use server'

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
      finishedAt: true,
    },
  })

  if (!booking) notFound()
  if (booking.professionalId !== professionalId) redirect('/pro')

  if (isTerminalBooking(booking.status, booking.finishedAt)) {
    redirect(sessionHubHref(bookingId))
  }

  await transitionSessionStep({
    bookingId,
    professionalId,
    nextStep: next,
  })

  redirect(sessionHubHref(bookingId))
}

async function inPersonDecisionAction(
  bookingId: string,
  decision: ConsultationDecision,
) {
  'use server'

  const user = await getCurrentUser().catch(() => null)
  const professionalId =
    user?.role === 'PRO' ? user.professionalProfile?.id ?? null : null
  const recordedByUserId = user?.id ?? null

  if (!professionalId || !recordedByUserId) {
    redirect(loginHref(bookingId))
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      professionalId: true,
      status: true,
      finishedAt: true,
    },
  })

  if (!booking) notFound()
  if (booking.professionalId !== professionalId) redirect('/pro')

  if (isTerminalBooking(booking.status, booking.finishedAt)) {
    redirect(sessionHubHref(bookingId))
  }

  await recordInPersonConsultationDecision({
    bookingId,
    professionalId,
    recordedByUserId,
    decision,
    userAgent: 'pro_session_server_action',
  })

  redirect(sessionHubHref(bookingId))
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

function ClockIcon({ size = 12 }: { size?: number }) {
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
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function PlusIcon({ size = 24 }: { size?: number }) {
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
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

function SessionHeader({
  backHref,
  backLabel,
  kicker,
  kickerTone,
  title,
  subtitle,
  pills = [],
  border = false,
  titleSize = 'lg',
}: {
  backHref: string
  backLabel: string
  kicker: string
  kickerTone?: 'muted' | 'success' | 'pending'
  title: string
  subtitle?: string
  pills?: HeaderPill[]
  border?: boolean
  titleSize?: 'sm' | 'lg'
}) {
  return (
    <header className="brand-pro-session-header" data-border={border}>
      <Link href={backHref} className="brand-pro-session-back brand-focus">
        <ChevronLeftIcon />
        {backLabel}
      </Link>

      <div className="brand-cap brand-pro-session-kicker" data-tone={kickerTone}>
        {kicker}
      </div>

      <h1 className="brand-pro-session-title" data-size={titleSize}>
        {title}
      </h1>

      {subtitle ? (
        <div className="brand-pro-session-subtitle">{subtitle}</div>
      ) : null}

      {pills.length > 0 ? (
        <div className="brand-pro-session-header-pills">
          {pills.map((pill) => (
            <Pill
              key={pill.label}
              label={pill.label}
              state={pill.state}
              tone={pill.tone}
            />
          ))}
        </div>
      ) : null}
    </header>
  )
}

function Pill({
  label,
  state,
  tone,
}: {
  label: string
  state?: 'active' | 'done'
  tone?: 'success' | 'pending' | 'danger'
}) {
  return (
    <span
      className="brand-pro-session-pill"
      data-state={state}
      data-tone={tone}
    >
      {label}
    </span>
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

function ActionLink({
  href,
  children,
  variant = 'primary',
  full = true,
  grow,
}: {
  href: string
  children: ReactNode
  variant?: ButtonVariant
  full?: boolean
  grow?: 1 | 2
}) {
  return (
    <Link
      href={href}
      className="brand-pro-session-button brand-focus"
      data-variant={variant}
      data-full={full}
      data-grow={grow}
    >
      {children}
    </Link>
  )
}

function ActionButton({
  children,
  variant = 'primary',
  full = true,
  disabled = false,
  grow,
}: {
  children: ReactNode
  variant?: ButtonVariant
  full?: boolean
  disabled?: boolean
  grow?: 1 | 2
}) {
  return (
    <button
      type="submit"
      className="brand-pro-session-button brand-focus"
      data-variant={variant}
      data-full={full}
      data-grow={grow}
      disabled={disabled}
      aria-disabled={disabled}
    >
      {children}
    </button>
  )
}

function StepRows({ effectiveStep }: { effectiveStep: SessionStep }) {
  const steps = buildSessionStepItems(effectiveStep)

  return (
    <div className="brand-pro-session-step-list">
      {steps.map((step) => (
        <div
          key={step.key}
          className="brand-pro-session-step-row"
          data-state={step.state}
        >
          <div className="brand-pro-session-step-dot">
            {step.state === 'done' ? <CheckIcon size={10} /> : step.number}
          </div>

          <span className="brand-pro-session-step-label">{step.label}</span>

          {step.state === 'active' ? (
            <span className="brand-pro-session-step-active-dot" />
          ) : null}
        </div>
      ))}
    </div>
  )
}

function PhotoGrid({
  count,
  addHref,
}: {
  count: number
  addHref: string
}) {
  const capturedCount = Math.min(Math.max(count, 0), 3)
  const emptyCount = Math.max(0, 3 - capturedCount)

  return (
    <div className="brand-pro-session-photo-grid">
      {Array.from({ length: capturedCount }, (_, index) => (
        <div key={`captured-${index}`} className="brand-pro-session-photo-tile">
          <div className="brand-pro-session-photo-check">
            <CheckIcon size={10} />
          </div>
        </div>
      ))}

      {Array.from({ length: emptyCount }, (_, index) => (
        <Link
          key={`empty-${index}`}
          href={addHref}
          className="brand-pro-session-photo-add brand-focus"
          aria-label="Add photo"
        >
          <PlusIcon />
        </Link>
      ))}
    </div>
  )
}

function WaitingForClientBanner() {
  return (
    <section className="brand-pro-session-wait-banner">
      <div className="brand-pro-session-wait-icon">
        <CameraIcon />
      </div>

      <div className="brand-pro-session-wait-body">
        <div className="brand-pro-session-wait-title">While you wait…</div>

        <div className="brand-pro-session-card-body">
          Tap the <strong>camera</strong> in the footer and take{' '}
          <strong>BEFORE</strong> photos now. Keeps the flow clean once the
          client approves.
        </div>
      </div>
    </section>
  )
}

function ProofCard({
  decisionLabel,
  methodLabel,
  actedAtLabel,
  destination,
  recordedByUserId,
}: {
  decisionLabel: string | null
  methodLabel: string | null
  actedAtLabel: string | null
  destination: string | null
  recordedByUserId: string | null
}) {
  return (
    <Card>
      <div className="brand-pro-session-section-title">
        Consultation proof recorded
      </div>

      <div className="brand-pro-session-card-body">
        {decisionLabel ? (
          <div>
            Decision: <strong>{decisionLabel}</strong>
          </div>
        ) : null}

        {methodLabel ? (
          <div>
            Method: <strong>{methodLabel}</strong>
          </div>
        ) : null}

        {actedAtLabel ? (
          <div>
            Recorded: <strong>{actedAtLabel}</strong>
          </div>
        ) : null}

        {destination ? (
          <div>
            Destination: <strong>{destination}</strong>
          </div>
        ) : null}

        {recordedByUserId ? (
          <div>
            Recorded by user: <strong>{recordedByUserId}</strong>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

function ConsultationView({
  bookingId,
  serviceName,
  subtitle,
  bookingStatus,
  approvalStatus,
  effectiveStep,
  initialNotes,
  initialPrice,
  initialItems,
  totalLabel,
  durationLabel,
  consultRejected,
  proofMethodLabel,
  toBefore,
}: {
  bookingId: string
  serviceName: string
  subtitle: string
  bookingStatus: BookingStatus
  approvalStatus: ConsultationApprovalStatus | null
  effectiveStep: SessionStep
  initialNotes: string
  initialPrice: string
  initialItems: ConsultationInitialItem[]
  totalLabel: string
  durationLabel: string
  consultRejected: boolean
  proofMethodLabel: string | null
  toBefore: ServerAction
}) {
  const canProceedToBefore =
    (bookingStatus === BookingStatus.ACCEPTED ||
      bookingStatus === BookingStatus.IN_PROGRESS) &&
    isConsultationApproved(approvalStatus)

  return (
    <PageShell>
      <SessionHeader
        backHref="/pro/bookings"
        backLabel="All bookings"
        kicker="◆ SESSION ACTIVE"
        title={serviceName}
        subtitle={subtitle}
        pills={[
          { label: String(bookingStatus), state: 'done' },
          { label: 'STEP 1 OF 4', state: 'active' },
        ]}
      />

      <div className="brand-pro-session-divider" />

      <div className="brand-pro-session-scroll no-scroll">
        <StepRows effectiveStep={effectiveStep} />

        <div className="mt-4">
          <Card accent>
            <div className="brand-pro-session-card-heading">
              <span className="brand-pro-session-card-dot" />
              Step 1 · Consultation
            </div>

            <div className="brand-pro-session-card-body">
              Review services, set price, and send to the client for approval
              before you begin.
            </div>

            <div className="mt-3">
              <ActionLink href="#consultation-form">
                Open Consultation Form <ArrowRightIcon />
              </ActionLink>
            </div>
          </Card>
        </div>

        <div className="brand-pro-session-stat-grid">
          <div className="brand-pro-session-stat-card">
            <div className="brand-cap brand-pro-session-stat-label">TOTAL</div>
            <div className="brand-pro-session-stat-value">{totalLabel}</div>
          </div>

          <div className="brand-pro-session-stat-card">
            <div className="brand-cap brand-pro-session-stat-label">
              DURATION
            </div>
            <div className="brand-pro-session-stat-value">{durationLabel}</div>
          </div>
        </div>

        <section id="consultation-form" className="pb-4">
          {consultRejected ? (
            <div className="mb-3">
              <Card tone="danger">
                <div className="brand-pro-session-section-title">
                  Consultation needs changes
                </div>

                <div className="brand-pro-session-card-body">
                  The last decision was <strong>rejected</strong>
                  {proofMethodLabel ? (
                    <>
                      {' '}
                      via <strong>{proofMethodLabel}</strong>
                    </>
                  ) : null}
                  . Update the proposal and resend it when ready.
                </div>
              </Card>
            </div>
          ) : null}

          <ConsultationForm
            bookingId={bookingId}
            initialNotes={initialNotes}
            initialPrice={initialPrice}
            initialItems={initialItems}
          />

          <div className="brand-pro-session-help-text">
            After you submit, it moves to Waiting on client.
          </div>

          {canProceedToBefore ? (
            <form action={toBefore} className="mt-4">
              <ActionButton>Proceed to before photos</ActionButton>
            </form>
          ) : null}

          {bookingStatus === BookingStatus.PENDING ? (
            <div className="brand-pro-session-help-text">
              This booking is pending. Accept it before starting the session.
            </div>
          ) : null}
        </section>
      </div>
    </PageShell>
  )
}

function WaitingView({
  serviceName,
  subtitle,
  totalLabel,
  approvalStatus,
  showWaitingBanner,
  canUseInPersonFallback,
  approveInPerson,
  rejectInPerson,
  toConsult,
}: {
  serviceName: string
  subtitle: string
  totalLabel: string
  approvalStatus: ConsultationApprovalStatus | null
  showWaitingBanner: boolean
  canUseInPersonFallback: boolean
  approveInPerson: ServerAction
  rejectInPerson: ServerAction
  toConsult: ServerAction
}) {
  return (
    <PageShell>
      <SessionHeader
        backHref="/pro/bookings"
        backLabel="Session hub"
        kicker="⏳ AWAITING APPROVAL"
        kickerTone="pending"
        title={serviceName}
        titleSize="sm"
        subtitle={`Consultation sent · ${totalLabel} proposed`}
        border
      />

      <div className="brand-pro-session-scroll no-scroll">
        <Card>
          <div className="brand-pro-session-chip-row mb-2">
            <Pill label={labelForConsultationStatus(approvalStatus)} tone="pending" />
            <span className="brand-pro-session-muted text-[10px] font-bold">
              Waiting on client
            </span>
          </div>

          <div className="brand-pro-session-card-body">
            Secure approval is required before the session can move forward.
          </div>
        </Card>

        {showWaitingBanner ? <WaitingForClientBanner /> : null}

        <Card>
          <div className="brand-pro-session-section-title">
            In-person fallback
          </div>

          <div className="brand-pro-session-card-body mt-1">
            Only use this if the client is physically present and cannot access
            their secure link. It will be logged honestly as{' '}
            <strong>in-person on pro device</strong>.
          </div>

          {canUseInPersonFallback ? (
            <div className="brand-pro-session-fallback-actions">
              <form action={approveInPerson}>
                <ActionButton variant="ghost">
                  <CheckIcon size={10} />
                  Record approval
                </ActionButton>
              </form>

              <form action={rejectInPerson}>
                <ActionButton variant="danger">Record decline</ActionButton>
              </form>
            </div>
          ) : null}
        </Card>

        <form action={toConsult} className="pt-3 pb-4">
          <ActionButton variant="ghost">← Back to consultation</ActionButton>
        </form>

        <div className="brand-pro-session-help-text">{subtitle}</div>
      </div>
    </PageShell>
  )
}

function BeforePhotosView({
  serviceName,
  clientName,
  totalLabel,
  beforeCount,
  toService,
  bookingId,
}: {
  serviceName: string
  clientName: string
  totalLabel: string
  beforeCount: number
  toService: ServerAction
  bookingId: string
}) {
  return (
    <PageShell>
      <SessionHeader
        backHref={sessionHubHref(bookingId)}
        backLabel="Session hub"
        kicker="◆ CONSULTATION APPROVED"
        kickerTone="success"
        title="Before photos"
        titleSize="sm"
        subtitle={`${clientName} · ${serviceName}`}
        border
      />

      <div className="brand-pro-session-scroll no-scroll">
        <div className="brand-pro-session-chip-row mb-4">
          <Pill label="CONSULTATION APPROVED" state="done" />
          <Pill label={`${totalLabel} AGREED`} state="done" />
        </div>

        <section className="mb-4">
          <div className="brand-pro-session-photo-header">
            <div className="brand-pro-session-section-title">
              Before photos
            </div>

            <div className="brand-pro-session-photo-count">
              <CheckIcon size={10} />
              {beforeCount} captured
            </div>
          </div>

          <PhotoGrid
            count={beforeCount}
            addHref={beforePhotosHref(bookingId)}
          />
        </section>

        <form action={toService}>
          <ActionButton>
            Start service <ArrowRightIcon />
          </ActionButton>
        </form>

        <div className="brand-pro-session-help-text">
          Or add more before photos first
        </div>

        <div className="mt-3 pb-4">
          <ActionLink href={beforePhotosHref(bookingId)} variant="ghost">
            + Add photo via camera
          </ActionLink>
        </div>
      </div>
    </PageShell>
  )
}

function ServiceInProgressView({
  serviceName,
  clientName,
  startedAt,
  durationLabel,
  beforeCount,
  toFinishReview,
}: {
  serviceName: string
  clientName: string
  startedAt: Date | null
  durationLabel: string
  beforeCount: number
  toFinishReview: ServerAction
}) {
  return (
    <PageShell>
      <SessionHeader
        backHref="/pro/bookings"
        backLabel="All bookings"
        kicker="◆ IN PROGRESS"
        title="Service"
        subtitle={`${clientName} · ${serviceName}`}
        pills={[
          { label: 'CONSULT', state: 'done' },
          { label: 'BEFORE PHOTOS', state: 'done' },
          { label: 'SERVICE', state: 'active' },
        ]}
      />

      <div className="brand-pro-session-divider" />

      <div className="brand-pro-session-scroll no-scroll" data-roomy="true">
        <section className="brand-pro-session-timer-card">
          <div className="brand-cap brand-pro-session-muted mb-2">
            ELAPSED
          </div>

          <div className="brand-pro-session-timer-value">
            {formatElapsed(startedAt)}
          </div>

          <div className="brand-pro-session-timer-sub">
            <ClockIcon />
            Started at {formatTimeOnly(startedAt)} · {durationLabel} booked
          </div>
        </section>

        <Card>
          <div className="brand-pro-session-mini-media-row">
            <div className="brand-pro-session-mini-grid">
              <div className="brand-pro-session-mini-photo" />
              <div className="brand-pro-session-mini-photo" />
            </div>

            <div>
              <div className="brand-pro-session-section-title">
                {beforeCount} before photos saved
              </div>
              <div className="brand-pro-session-card-body">
                Ready for comparison at wrap-up
              </div>
            </div>

            <span className="ml-auto">
              <Pill label="SAVED" tone="success" />
            </span>
          </div>
        </Card>

        <form action={toFinishReview}>
          <ActionButton>
            Finish service <ArrowRightIcon />
          </ActionButton>
        </form>

        <div className="brand-pro-session-help-text pb-4">
          Moves to wrap-up: after photos + aftercare
        </div>
      </div>
    </PageShell>
  )
}

function FinishReviewView({
  bookingId,
  serviceName,
  clientName,
  toWrapUp,
}: {
  bookingId: string
  serviceName: string
  clientName: string
  toWrapUp: ServerAction
}) {
  return (
    <PageShell>
      <SessionHeader
        backHref={sessionHubHref(bookingId)}
        backLabel="Session hub"
        kicker="WRAP-UP"
        kickerTone="muted"
        title="Finish review"
        titleSize="sm"
        subtitle={`${clientName} · ${serviceName}`}
        border
      />

      <div className="brand-pro-session-scroll no-scroll">
        <Card accent>
          <div className="brand-pro-session-card-heading">
            <span className="brand-pro-session-card-dot" />
            Ready for wrap-up
          </div>

          <div className="brand-pro-session-card-body">
            Next you’ll capture after photos and finalize aftercare. Order
            does not matter, but both need to be done before completion.
          </div>

          <form action={toWrapUp} className="mt-3">
            <ActionButton>
              Go to wrap-up <ArrowRightIcon />
            </ActionButton>
          </form>
        </Card>
      </div>
    </PageShell>
  )
}

function WrapUpView({
  bookingId,
  serviceName,
  clientName,
  afterCount,
  hasAfterPhoto,
  hasAftercareDraft,
  hasFinalizedAftercare,
  aftercareLastEditedAt,
  completeSession,
}: {
  bookingId: string
  serviceName: string
  clientName: string
  afterCount: number
  hasAfterPhoto: boolean
  hasAftercareDraft: boolean
  hasFinalizedAftercare: boolean
  aftercareLastEditedAt: Date | null
  completeSession: ServerAction
}) {
  const canComplete = hasAfterPhoto && hasFinalizedAftercare
  const aftercareStatus = hasFinalizedAftercare
    ? 'finalized + sent'
    : hasAftercareDraft
      ? 'draft saved'
      : 'missing'

  return (
    <PageShell>
      <SessionHeader
        backHref={sessionHubHref(bookingId)}
        backLabel="Session hub"
        kicker="WRAP-UP · AFTERCARE"
        kickerTone="muted"
        title="Wrap-up"
        titleSize="sm"
        subtitle={`${clientName} · ${serviceName}`}
        border
      />

      <div className="brand-pro-session-scroll no-scroll">
        <Card>
          <div className="brand-pro-session-section-title mb-3">
            Wrap-up checklist
          </div>

          <div className="brand-pro-session-check-row">
            <div className="brand-pro-session-check-icon">
              {hasAfterPhoto ? <CheckIcon /> : <PlusIcon size={14} />}
            </div>

            <div className="brand-pro-session-check-main">
              <div className="brand-pro-session-check-title">
                After photos
              </div>
              <div className="brand-pro-session-check-sub">
                {hasAfterPhoto ? `${afterCount} photos captured` : 'Missing'}
              </div>
            </div>

            <Pill
              label={hasAfterPhoto ? 'DONE' : 'TODO'}
              tone={hasAfterPhoto ? 'success' : 'pending'}
            />
          </div>

          <div className="brand-pro-session-check-row">
            <div className="brand-pro-session-check-icon">
              {hasFinalizedAftercare ? <CheckIcon /> : <LinkIcon />}
            </div>

            <div className="brand-pro-session-check-main">
              <div className="brand-pro-session-check-title">
                Aftercare sent to client
              </div>
              <div className="brand-pro-session-check-sub">
                {aftercareStatus}
                {aftercareLastEditedAt && !hasFinalizedAftercare
                  ? ` · last edited ${formatDateTime(aftercareLastEditedAt)}`
                  : ''}
              </div>
            </div>

            <Pill
              label={hasFinalizedAftercare ? 'DONE' : 'TODO'}
              tone={hasFinalizedAftercare ? 'success' : 'pending'}
            />
          </div>
        </Card>

        <div className="mt-3 brand-pro-session-photo-grid">
          <div className="brand-pro-session-photo-tile">
            <div className="brand-pro-session-photo-check">
              <CheckIcon size={9} />
            </div>
          </div>
          <div className="brand-pro-session-photo-tile">
            <div className="brand-pro-session-photo-check">
              <CheckIcon size={9} />
            </div>
          </div>
          <div className="brand-pro-session-photo-tile">
            <div className="brand-pro-session-photo-check">
              <CheckIcon size={9} />
            </div>
          </div>
        </div>

        <div className="brand-pro-session-action-row mt-3">
          <ActionLink
            href={afterPhotosHref(bookingId)}
            variant="ghost"
            grow={1}
          >
            After photos
          </ActionLink>

          <ActionLink href={aftercareHref(bookingId)} grow={2}>
            Aftercare
          </ActionLink>
        </div>

        <form action={completeSession}>
          <ActionButton disabled={!canComplete}>
            Complete session <ArrowRightIcon size={13} />
          </ActionButton>
        </form>

        <div className="brand-pro-session-help-text pb-4">
          Requires finalized aftercare and at least one after photo.
        </div>
      </div>
    </PageShell>
  )
}

function DoneView({
  bookingId,
  serviceName,
  clientName,
}: {
  bookingId: string
  serviceName: string
  clientName: string
}) {
  return (
    <PageShell>
      <SessionHeader
        backHref="/pro/bookings"
        backLabel="All bookings"
        kicker="◆ DONE"
        kickerTone="success"
        title="Session complete"
        titleSize="sm"
        subtitle={`${clientName} · ${serviceName}`}
        border
      />

      <div className="brand-pro-session-scroll no-scroll">
        <Card tone="success">
          <div className="brand-pro-session-card-heading">
            <span className="brand-pro-session-card-dot" />
            All set
          </div>

          <div className="brand-pro-session-card-body">
            This session is complete. The client can keep their aftercare
            summary.
          </div>

          <div className="mt-3">
            <ActionLink href={aftercareHref(bookingId)}>
              Open aftercare
            </ActionLink>
          </div>
        </Card>
      </div>
    </PageShell>
  )
}

function TerminalView({
  bookingId,
  serviceName,
  clientName,
  isCancelled,
}: {
  bookingId: string
  serviceName: string
  clientName: string
  isCancelled: boolean
}) {
  return (
    <PageShell>
      <SessionHeader
        backHref="/pro/bookings"
        backLabel="All bookings"
        kicker={isCancelled ? 'CANCELLED' : 'COMPLETED'}
        kickerTone={isCancelled ? 'muted' : 'success'}
        title={serviceName}
        subtitle={clientName}
        border
      />

      <div className="brand-pro-session-scroll no-scroll">
        <Card tone={isCancelled ? 'danger' : 'success'}>
          <div className="brand-pro-session-section-title">
            {isCancelled ? 'This booking is cancelled.' : 'This booking is completed.'}
          </div>

          <div className="brand-pro-session-card-body mt-1">
            {isCancelled
              ? 'Nothing to do here.'
              : 'The session has already been finalized.'}
          </div>

          {!isCancelled ? (
            <div className="mt-3">
              <ActionLink href={aftercareHref(bookingId)}>
                View aftercare
              </ActionLink>
            </div>
          ) : null}
        </Card>
      </div>
    </PageShell>
  )
}

function UnmappedStateView({
  bookingId,
  rawStep,
  toConsult,
}: {
  bookingId: string
  rawStep: SessionStep
  toConsult: ServerAction
}) {
  return (
    <PageShell>
      <SessionHeader
        backHref="/pro/bookings"
        backLabel="All bookings"
        kicker="SESSION STATE"
        kickerTone="muted"
        title="Needs review"
        border
      />

      <div className="brand-pro-session-scroll no-scroll">
        <Card tone="danger">
          <div className="brand-pro-session-section-title">
            We couldn’t map this session state cleanly.
          </div>

          <div className="brand-pro-session-card-body mt-1">
            Step: <strong>{String(rawStep)}</strong>
          </div>

          <form action={toConsult} className="mt-3">
            <ActionButton>Back to consult</ActionButton>
          </form>
        </Card>

        <div className="brand-pro-session-help-text">
          Booking: {bookingId}
        </div>
      </div>
    </PageShell>
  )
}

export default async function ProBookingSessionPage(props: PageProps) {
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
      scheduledFor: true,
      startedAt: true,
      finishedAt: true,
      sessionStep: true,
      totalDurationMinutes: true,
      subtotalSnapshot: true,
      totalAmount: true,
      consultationNotes: true,

      service: {
        select: {
          name: true,
        },
      },

      serviceItems: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          serviceId: true,
          offeringId: true,
          itemType: true,
          priceSnapshot: true,
          durationMinutesSnapshot: true,
          notes: true,
          sortOrder: true,
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
        },
      },

      consultationApproval: {
        select: {
          status: true,
          proposedTotal: true,
          notes: true,
          approvedAt: true,
          rejectedAt: true,
          proof: {
            select: {
              id: true,
              decision: true,
              method: true,
              actedAt: true,
              recordedByUserId: true,
              clientActionTokenId: true,
              contactMethod: true,
              destinationSnapshot: true,
            },
          },
        },
      },
    },
  })

  if (!booking) notFound()
  if (booking.professionalId !== professionalId) redirect('/pro')

  const bookingStatus = booking.status
  const rawStep = booking.sessionStep ?? SessionStep.NONE
  const approvalStatus = booking.consultationApproval?.status ?? null

  const terminal = isTerminalBooking(bookingStatus, booking.finishedAt)
  const isCancelled = bookingStatus === BookingStatus.CANCELLED

  const serviceName = booking.service?.name?.trim() || 'Service'
  const clientName =
    fullName(booking.client?.firstName, booking.client?.lastName) ||
    booking.client?.user?.email ||
    'Client'

  const durationMinutes =
    booking.totalDurationMinutes ?? sumDurations(booking.serviceItems)
  const durationLabel =
    durationMinutes > 0 ? `${durationMinutes} min` : 'Duration TBD'

  const totalLabel =
    firstMoneyLabel(
      booking.consultationApproval?.proposedTotal,
      booking.totalAmount,
      booking.subtotalSnapshot,
    ) || '—'

  const initialPrice = firstMoneyText(
    booking.consultationApproval?.proposedTotal,
    booking.totalAmount,
    booking.subtotalSnapshot,
  )

  const initialNotes =
    booking.consultationApproval?.notes ?? booking.consultationNotes ?? ''

  const initialItems = buildInitialConsultationItems(booking.serviceItems)

  const consultationProof = booking.consultationApproval?.proof ?? null
  const hasConsultationProof = Boolean(consultationProof?.id)

  const proofMethodLabel = consultationProof
    ? labelForProofMethod(consultationProof.method)
    : null
  const proofDecisionLabel = consultationProof
    ? labelForConsultationDecision(consultationProof.decision)
    : null
  const proofActedAtLabel = formatDateTime(consultationProof?.actedAt)
  const proofDestination =
    consultationProof?.destinationSnapshot?.trim() || null

  const consultRejected = isConsultationRejected(approvalStatus)

  const [beforeCount, afterCount, aftercare] = await Promise.all([
    prisma.mediaAsset.count({
      where: {
        bookingId: booking.id,
        phase: MediaPhase.BEFORE,
        uploadedByRole: Role.PRO,
      },
    }),
    prisma.mediaAsset.count({
      where: {
        bookingId: booking.id,
        phase: MediaPhase.AFTER,
        uploadedByRole: Role.PRO,
      },
    }),
    prisma.aftercareSummary.findFirst({
      where: {
        bookingId: booking.id,
      },
      select: {
        id: true,
        publicToken: true,
        draftSavedAt: true,
        sentToClientAt: true,
        lastEditedAt: true,
        version: true,
      },
    }),
  ])

  const hasBeforePhoto = beforeCount > 0
  const hasAfterPhoto = afterCount > 0
  const hasAftercareDraft = Boolean(aftercare?.id)
  const hasFinalizedAftercare = Boolean(aftercare?.sentToClientAt)

  const effectiveStep = resolveEffectiveSessionStep({
    bookingStatus,
    rawStep,
    consultationStatus: approvalStatus,
  })

  const screenKey = getSessionScreenKey({ effectiveStep })

  const subtitle = formatAppointmentLine({
    clientName,
    scheduledFor: booking.scheduledFor,
    durationLabel,
  })

  const toConsult = transitionAction.bind(
    null,
    bookingId,
    SessionStep.CONSULTATION,
  )
  const toBefore = transitionAction.bind(
    null,
    bookingId,
    SessionStep.BEFORE_PHOTOS,
  )
  const toService = transitionAction.bind(
    null,
    bookingId,
    SessionStep.SERVICE_IN_PROGRESS,
  )
  const toFinishReview = transitionAction.bind(
    null,
    bookingId,
    SessionStep.FINISH_REVIEW,
  )
  const toWrapUp = transitionAction.bind(
    null,
    bookingId,
    SessionStep.AFTER_PHOTOS,
  )
  const approveInPerson = inPersonDecisionAction.bind(
    null,
    bookingId,
    ConsultationDecision.APPROVED,
  )
  const rejectInPerson = inPersonDecisionAction.bind(
    null,
    bookingId,
    ConsultationDecision.REJECTED,
  )

  async function completeSession() {
    'use server'

    const currentUser = await getCurrentUser().catch(() => null)
    const currentProfessionalId =
      currentUser?.role === 'PRO'
        ? currentUser.professionalProfile?.id ?? null
        : null

    if (!currentProfessionalId) {
      redirect(loginHref(bookingId))
    }

    const freshBooking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        status: true,
        finishedAt: true,
      },
    })

    if (!freshBooking) notFound()
    if (freshBooking.professionalId !== currentProfessionalId) redirect('/pro')

    if (isTerminalBooking(freshBooking.status, freshBooking.finishedAt)) {
      redirect(sessionHubHref(bookingId))
    }

    const done = await transitionSessionStep({
      bookingId,
      professionalId: currentProfessionalId,
      nextStep: SessionStep.DONE,
    })

    if (done.ok) {
      redirect(aftercareHref(bookingId))
    }

    await transitionSessionStep({
      bookingId,
      professionalId: currentProfessionalId,
      nextStep: SessionStep.AFTER_PHOTOS,
    }).catch(() => null)

    redirect(sessionHubHref(bookingId))
  }

  if (terminal) {
    return (
      <TerminalView
        bookingId={booking.id}
        serviceName={serviceName}
        clientName={clientName}
        isCancelled={isCancelled}
      />
    )
  }

  const proofCard = consultationProof ? (
    <ProofCard
      decisionLabel={proofDecisionLabel}
      methodLabel={proofMethodLabel}
      actedAtLabel={proofActedAtLabel}
      destination={proofDestination}
      recordedByUserId={consultationProof.recordedByUserId}
    />
  ) : null

  if (screenKey === 'CONSULTATION') {
    return (
      <>
        <ConsultationView
          bookingId={booking.id}
          serviceName={serviceName}
          subtitle={subtitle}
          bookingStatus={bookingStatus}
          approvalStatus={approvalStatus}
          effectiveStep={effectiveStep}
          initialNotes={initialNotes}
          initialPrice={initialPrice}
          initialItems={initialItems}
          totalLabel={totalLabel}
          durationLabel={durationLabel}
          consultRejected={consultRejected}
          proofMethodLabel={proofMethodLabel}
          toBefore={toBefore}
        />
        {proofCard}
      </>
    )
  }

  if (screenKey === 'WAITING_ON_CLIENT') {
    return (
      <>
        <WaitingView
          serviceName={serviceName}
          subtitle={subtitle}
          totalLabel={totalLabel}
          approvalStatus={approvalStatus}
          showWaitingBanner={
            isConsultationPending(approvalStatus) && !hasBeforePhoto
          }
          canUseInPersonFallback={
            isConsultationPending(approvalStatus) && !hasConsultationProof
          }
          approveInPerson={approveInPerson}
          rejectInPerson={rejectInPerson}
          toConsult={toConsult}
        />
        {proofCard}
      </>
    )
  }

  if (screenKey === 'BEFORE_PHOTOS') {
    return (
      <BeforePhotosView
        serviceName={serviceName}
        clientName={clientName}
        totalLabel={totalLabel}
        beforeCount={beforeCount}
        toService={toService}
        bookingId={booking.id}
      />
    )
  }

  if (screenKey === 'SERVICE_IN_PROGRESS') {
    return (
      <ServiceInProgressView
        serviceName={serviceName}
        clientName={clientName}
        startedAt={booking.startedAt}
        durationLabel={durationLabel}
        beforeCount={beforeCount}
        toFinishReview={toFinishReview}
      />
    )
  }

  if (screenKey === 'FINISH_REVIEW') {
    return (
      <FinishReviewView
        bookingId={booking.id}
        serviceName={serviceName}
        clientName={clientName}
        toWrapUp={toWrapUp}
      />
    )
  }

  if (screenKey === 'WRAP_UP') {
    return (
      <WrapUpView
        bookingId={booking.id}
        serviceName={serviceName}
        clientName={clientName}
        afterCount={afterCount}
        hasAfterPhoto={hasAfterPhoto}
        hasAftercareDraft={hasAftercareDraft}
        hasFinalizedAftercare={hasFinalizedAftercare}
        aftercareLastEditedAt={aftercare?.lastEditedAt ?? null}
        completeSession={completeSession}
      />
    )
  }

  if (screenKey === 'DONE') {
    return (
      <DoneView
        bookingId={booking.id}
        serviceName={serviceName}
        clientName={clientName}
      />
    )
  }

  return (
    <UnmappedStateView
      bookingId={booking.id}
      rawStep={rawStep}
      toConsult={toConsult}
    />
  )
}