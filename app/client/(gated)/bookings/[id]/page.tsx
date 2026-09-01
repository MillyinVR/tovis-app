// app/client/bookings/[id]/page.tsx 

import type { ReactNode } from 'react'
import { formatMoneyFromUnknown } from '@/lib/money'
import { notFound, redirect } from 'next/navigation'

import { COPY } from '@/lib/copy'
import { buildClientBookingDTO } from '@/lib/dto/clientBooking'
import { mapsHrefFromLocation } from '@/lib/maps'
import { buildClientAcceptedMethods } from '@/lib/payments/clientPaymentOptions'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { prisma } from '@/lib/prisma'
import { friendlyTimeZoneLabel, sanitizeTimeZone } from '@/lib/timeZone'
import { formatInTimeZone } from '@/lib/time'
import { cn } from '@/lib/utils'
import { canBookingAcceptClientReview } from '@/lib/booking/writeBoundary'
import { buildPrepCountdown } from '@/lib/booking/prepCountdown'
import { isPrepWritableStatus } from '@/lib/booking/prep'
import { NotificationEventKey } from '@prisma/client'
import ProProfileLink from '@/app/_components/ProProfileLink'
import ClientPage from '../../_components/ClientPage'
import SectionCard from '@/app/client/_components/SectionCard'
import ClickableMedia from '@/app/_components/media/ClickableMedia'
import AftercareBeforeAfter from '@/app/_components/aftercare/AftercareBeforeAfter'
import { orderMediaByFeatured } from '@/lib/media/bookingBeforeAfter'

import {
  AI_CONSULT_ELIGIBILITY_BOOKING_SELECT,
  evaluateAiConsultBookingEligibility,
} from '@/lib/consult/eligibility'

import AftercareProductRecommendationsCard from './AftercareProductRecommendationsCard'
import AiConsultCard from './AiConsultCard'
import AftercareNextAppointmentCard from './AftercareNextAppointmentCard'
import MediaConsentCard from './MediaConsentCard'
import AftercareRebookButton from './AftercareRebookButton'
import AppointmentPrepSection from './AppointmentPrepSection'
import ClientBookingActionsCard from './ClientBookingActionsCard'
import ClientConfirmationCard from './ClientConfirmationCard'
import ConsultationDecisionCard from './ConsultationDecisionCard'
import { loadConsultRevisionForClient } from '@/lib/consult/inChairRevision'
import ReviewSection from './ReviewSection'
import { loadClientBookingPage } from './_data/loadClientBookingPage'
import { buildBookingViewModel } from './_view/buildBookingViewModel'
import {
  clientStatusMessage,
  clientStatusPillLabel,
  clientStatusPillVariant,
} from './_view/statusPresentation'
import ClientCheckoutCard from './ClientCheckoutCard'
import ClientDepositCard from './ClientDepositCard'
import {
  depositWouldCoverTotal,
  deriveNetDepositHeldCents,
} from '@/lib/booking/depositCredit'

export const dynamic = 'force-dynamic'

type StepKey = 'overview' | 'consult' | 'aftercare'
type StatusVariant = 'danger' | 'success' | 'warn' | 'info' | 'neutral'

type PageParams = { id: string }
type PageSearchParams = Record<string, string | string[] | undefined>

type LoadedClientBookingPage = Awaited<ReturnType<typeof loadClientBookingPage>>
type LoadedAftercare = LoadedClientBookingPage['aftercare']
type LoadedExistingReview = LoadedClientBookingPage['existingReview']
type LoadedMedia = LoadedClientBookingPage['media'][number]
type LoadedCheckoutProductItem =
  LoadedClientBookingPage['checkoutProductItems'][number]
type LoadedReviewMedia =
  NonNullable<LoadedExistingReview>['mediaAssets'][number]

type SafeExistingReview = {
  id: string
  rating: number
  headline: string | null
  body: string | null
  mediaAssets: Array<{
    id: string
    url: string
    thumbUrl: string | null
    mediaType: LoadedReviewMedia['mediaType']
    createdAt: string
    isFeaturedInPortfolio: boolean
    isEligibleForLooks: boolean
  }>
} | null

type AftercareRebookInfo =
  | { mode: 'BOOKED_NEXT_APPOINTMENT'; label: string }
  | { mode: 'RECOMMENDED_WINDOW'; label: string }
  | { mode: 'RECOMMENDED_DATE'; label: string }
  | { mode: 'NONE'; label: null }

const NO_REBOOK_INFO: AftercareRebookInfo = { mode: 'NONE', label: null }

function normalizeStep(raw: unknown): StepKey {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (normalized === 'consult' || normalized === 'consultation') return 'consult'
  if (normalized === 'aftercare') return 'aftercare'
  return 'overview'
}

type CheckoutBanner = 'success' | 'cancelled' | null

function normalizeCheckoutBanner(raw: unknown): CheckoutBanner {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (normalized === 'success') return 'success'
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled'
  return null
}

function firstSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0]
  return undefined
}

async function resolvePageValue<T>(
  value: T | Promise<T> | undefined,
  fallback: T,
): Promise<T> {
  try {
    return value == null ? fallback : await Promise.resolve(value)
  } catch {
    return fallback
  }
}

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}


function formatWhenInTimeZone(date: Date, timeZone: string): string {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  return formatInTimeZone(date, tz, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatDateRangeInTimeZone(
  start: Date,
  end: Date,
  timeZone: string,
): string {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const opts = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  } as const

  return `${formatInTimeZone(start, tz, opts)} – ${formatInTimeZone(end, tz, opts)}`
}

function friendlyLocationType(value: unknown): string | null {
  const normalized = upper(value)
  if (normalized === 'SALON') return 'In salon'
  if (normalized === 'MOBILE') return 'Mobile'
  return null
}

function friendlySource(value: unknown): string | null {
  const normalized = upper(value)
  if (normalized === 'DISCOVERY') return 'Looks'
  if (normalized === 'REQUESTED') return 'Requested'
  if (normalized === 'AFTERCARE') return 'Aftercare rebook'
  return null
}

function friendlyCheckoutStatus(value: unknown): string | null {
  const normalized = upper(value)
  if (!normalized) return null

  if (normalized === 'NOT_READY') return 'Not ready'
  if (normalized === 'READY') return 'Ready'
  if (normalized === 'PARTIALLY_PAID') return 'Partially paid'
  if (normalized === 'PAID') return 'Paid'
  if (normalized === 'WAIVED') return 'Waived'

  return normalized
    .toLowerCase()
    .split('_')
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ')
}

function friendlyPaymentMethod(value: unknown): string | null {
  const normalized = upper(value)
  if (!normalized) return null

  if (normalized === 'CASH') return 'Cash'
  if (normalized === 'CARD_ON_FILE') return 'Card on file'
  if (normalized === 'TAP_TO_PAY') return 'Tap to pay'
  if (normalized === 'VENMO') return 'Venmo'
  if (normalized === 'ZELLE') return 'Zelle'
  if (normalized === 'APPLE_CASH') return 'Apple Cash'
  if (normalized === 'STRIPE_CARD') return 'Credit/debit card'

  return normalized
    .toLowerCase()
    .split('_')
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ')
}

function friendlyCollectionTiming(value: unknown): string | null {
  const normalized = upper(value)
  if (!normalized) return null
  if (normalized === 'AT_BOOKING') return 'At booking'
  if (normalized === 'AFTER_SERVICE') return 'After service'
  return normalized
    .toLowerCase()
    .split('_')
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ')
}

function pillClassByVariant(
  _variant: Exclude<StatusVariant, 'neutral'>,
): string {
  return 'border border-textPrimary/10 bg-surfaceGlass/10 text-textPrimary'
}

function alertClassByVariant(variant: StatusVariant): string {
  if (variant === 'neutral') return 'tovis-glass-soft border border-textPrimary/10'
  return 'tovis-glass border border-textPrimary/10'
}

function tabClass(active: boolean): string {
  return cn(
    'inline-flex items-center rounded-full px-4 py-2 text-xs font-black transition',
    'border border-textPrimary/10',
    active
      ? 'bg-accentPrimary text-bgPrimary shadow-sm'
      : 'bg-bgPrimary text-textPrimary hover:bg-surfaceGlass/10',
  )
}

function tabDisabledClass(): string {
  return cn(
    'inline-flex cursor-not-allowed select-none items-center rounded-full px-4 py-2 text-xs font-black opacity-50',
    'border border-textPrimary/10 bg-bgPrimary text-textSecondary',
  )
}

async function markClientBookingStepNotificationsRead(args: {
  clientId: string
  bookingId: string
  step: StepKey
  aftercareId?: string | null
}): Promise<{ hadUnreadAftercare: boolean }> {
  const now = new Date()

  if (args.step === 'consult') {
    await prisma.clientNotification.updateMany({
      where: {
        clientId: args.clientId,
        bookingId: args.bookingId,
        eventKey: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
        readAt: null,
      },
      data: { readAt: now },
    })

    return { hadUnreadAftercare: false }
  }

  if (args.step === 'aftercare' && args.aftercareId) {
    const unreadAftercare = await prisma.clientNotification.findFirst({
      where: {
        clientId: args.clientId,
        bookingId: args.bookingId,
        aftercareId: args.aftercareId,
        eventKey: NotificationEventKey.AFTERCARE_READY,
        readAt: null,
      },
      select: { id: true },
    })

    await prisma.clientNotification.updateMany({
      where: {
        clientId: args.clientId,
        bookingId: args.bookingId,
        aftercareId: args.aftercareId,
        eventKey: NotificationEventKey.AFTERCARE_READY,
        readAt: null,
      },
      data: { readAt: now },
    })

    return { hadUnreadAftercare: Boolean(unreadAftercare) }
  }

  if (args.step === 'overview') {
    await prisma.clientNotification.updateMany({
      where: {
        clientId: args.clientId,
        bookingId: args.bookingId,
        eventKey: {
          in: [
            NotificationEventKey.BOOKING_CONFIRMED,
            NotificationEventKey.BOOKING_RESCHEDULED,
            NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
            NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
            NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN,
            NotificationEventKey.APPOINTMENT_REMINDER,
          ],
        },
        readAt: null,
      },
      data: { readAt: now },
    })
  }

  return { hadUnreadAftercare: false }
}

function getAftercareRebookInfo(
  aftercare: LoadedAftercare,
  timeZone: string,
): AftercareRebookInfo {
  if (!aftercare) return NO_REBOOK_INFO

  const mode = upper(aftercare.rebookMode)

  if (mode === 'BOOKED_NEXT_APPOINTMENT') {
    const bookedFor = toDate(aftercare.rebookedFor)
    return bookedFor
      ? {
          mode: 'BOOKED_NEXT_APPOINTMENT',
          label: `Next booking confirmed: ${formatWhenInTimeZone(bookedFor, timeZone)}`,
        }
      : {
          mode: 'BOOKED_NEXT_APPOINTMENT',
          label: 'Next booking confirmed.',
        }
  }

  if (mode === 'RECOMMENDED_WINDOW') {
    const start = toDate(aftercare.rebookWindowStart)
    const end = toDate(aftercare.rebookWindowEnd)

    if (start && end) {
      return {
        mode: 'RECOMMENDED_WINDOW',
        label: `Recommended rebook window: ${formatDateRangeInTimeZone(start, end, timeZone)}`,
      }
    }

    return {
      mode: 'RECOMMENDED_WINDOW',
      label: 'Recommended rebook window.',
    }
  }

  if (mode === 'NONE') return NO_REBOOK_INFO

  const legacyDate = toDate(aftercare.rebookedFor)
  if (legacyDate) {
    return {
      mode: 'RECOMMENDED_DATE',
      label: `Recommended next booking: ${formatWhenInTimeZone(legacyDate, timeZone)}`,
    }
  }

  return NO_REBOOK_INFO
}

function hasFinalizedAftercare(aftercare: LoadedAftercare): boolean {
  return Boolean(aftercare?.id && aftercare.sentToClientAt)
}

type LoadedRenderableMedia = LoadedMedia & {
  url: string | null
  thumbUrl: string | null
}

function hasUsableMediaUrl(
  media: LoadedMedia | null | undefined,
): media is LoadedRenderableMedia {
  const url = typeof media?.url === 'string' ? media.url.trim() : ''
  const thumbUrl = typeof media?.thumbUrl === 'string' ? media.thumbUrl.trim() : ''

  return Boolean(url || thumbUrl)
}

function hasUsableReviewMediaUrl(
  media: LoadedReviewMedia | null | undefined,
): media is LoadedReviewMedia & { url: string } {
  return typeof media?.url === 'string' && media.url.trim().length > 0
}

function toSafeExistingReview(
  existingReview: LoadedExistingReview,
): SafeExistingReview {
  if (!existingReview?.id) return null

  return {
    id: existingReview.id,
    rating: existingReview.rating,
    headline: existingReview.headline,
    body: existingReview.body,
    mediaAssets: existingReview.mediaAssets
      .filter(hasUsableReviewMediaUrl)
      .map((mediaItem) => ({
        id: mediaItem.id,
        url: mediaItem.url,
        thumbUrl: mediaItem.thumbUrl,
        mediaType: mediaItem.mediaType,
        createdAt: mediaItem.createdAt.toISOString(),
        isFeaturedInPortfolio: mediaItem.isFeaturedInPortfolio,
        isEligibleForLooks: mediaItem.isEligibleForLooks,
      })),
  }
}

function TinyMetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-textPrimary/10 bg-bgPrimary px-2.5 py-1 text-[11px] font-black text-textPrimary">
      {children}
    </span>
  )
}

function SummaryRow(props: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-textPrimary/10 py-2 last:border-b-0 last:pb-0 first:pt-0">
      <div className="text-[12px] font-black text-textSecondary">
        {props.label}
      </div>
      <div className="text-right text-[13px] font-semibold text-textPrimary">
        {props.value}
      </div>
    </div>
  )
}

// Descriptive alt text for before/after session photos. Falls back to a plain
// label when the booking has no resolved service name.
function sessionPhotoAlt(
  label: 'Before' | 'After',
  serviceName: string | null,
): string {
  return serviceName ? `${label} photo — ${serviceName}` : `${label} photo`
}

function MediaStrip(props: {
  title: string
  label: 'Before' | 'After'
  serviceName: string | null
  items: LoadedRenderableMedia[]
}) {
  if (props.items.length === 0) return null

  return (
    <div>
      <div className="mb-2 text-[11px] font-black text-textSecondary">
        {props.title}
      </div>
      <div className="looksNoScrollbar flex gap-2 overflow-x-auto pb-1">
        {props.items.map((mediaItem) => {
            const previewSrc = mediaPreviewSrc(mediaItem)
            const fullSrc = mediaFullSrc(mediaItem)

            if (!previewSrc || !fullSrc) return null

            return (
              <ClickableMedia
                key={mediaItem.id}
                thumbSrc={previewSrc}
                fullSrc={fullSrc}
                mediaType={mediaItem.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE'}
                alt={sessionPhotoAlt(props.label, props.serviceName)}
                caption={sessionPhotoAlt(props.label, props.serviceName)}
                className="h-32 w-32 shrink-0 rounded-card border border-textPrimary/10 bg-bgSecondary"
              />
            )
          })}
      </div>
    </div>
  )
}

function ServiceBreakdownCard(props: {
  items: Awaited<ReturnType<typeof buildClientBookingDTO>>['items']
  addOnCount: number
}) {
  if (props.items.length === 0) return null

  return (
    <div className="grid gap-2">
      {props.items.map((item) => {
        const itemName =
          item.name || (item.type === 'ADD_ON' ? 'Add-on' : 'Service')
        const priceLabel = formatMoneyFromUnknown(item.price)
        const durationLabel =
          item.durationMinutes > 0 ? `${item.durationMinutes} min` : null

        return (
          <div
            key={item.id}
            className="rounded-card border border-textPrimary/10 bg-bgPrimary px-4 py-3 shadow-[0_10px_30px_rgb(var(--shadow-color)/0.14)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-[14px] font-black text-textPrimary">
                    {itemName}
                  </div>
                  <span className="inline-flex items-center rounded-full border border-textPrimary/10 bg-bgSecondary px-2 py-0.5 text-[10px] font-black text-textPrimary">
                    {item.type === 'ADD_ON' ? 'Add-on' : 'Base'}
                  </span>
                  {durationLabel ? (
                    <span className="text-[11px] font-semibold text-textSecondary">
                      · {durationLabel}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="shrink-0 text-[13px] font-black text-textPrimary">
                {priceLabel || COPY.common.emDash}
              </div>
            </div>
          </div>
        )
      })}

      {props.addOnCount > 0 ? (
        <div className="pt-1 text-[11px] font-semibold text-textSecondary">
          Includes base service plus {props.addOnCount} add-on
          {props.addOnCount === 1 ? '' : 's'}.
        </div>
      ) : null}
    </div>
  )
}

function PurchasedProductsCard(props: {
  productSales: Awaited<ReturnType<typeof buildClientBookingDTO>>['productSales']
}) {
  if (props.productSales.length === 0) return null

  return (
    <div className="grid gap-2">
      {props.productSales.map((sale) => (
        <div
          key={sale.id}
          className="rounded-card border border-textPrimary/10 bg-bgPrimary px-4 py-3 shadow-[0_10px_30px_rgb(var(--shadow-color)/0.14)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[14px] font-black text-textPrimary">
                {sale.name || 'Product'}
              </div>
              <div className="mt-0.5 text-[12px] font-semibold text-textSecondary">
                Qty {sale.quantity}
              </div>
            </div>

            <div className="shrink-0 text-right">
              <div className="text-[12px] font-semibold text-textSecondary">
                {formatMoneyFromUnknown(sale.unitPrice) || COPY.common.emDash} each
              </div>
              <div className="text-[13px] font-black text-textPrimary">
                {formatMoneyFromUnknown(sale.lineTotal) || COPY.common.emDash}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
function ClientAftercarePill(props: {
  children: ReactNode
  tone?: 'success' | 'pending' | 'danger'
}) {
  return (
    <span className="brand-pro-session-pill" data-tone={props.tone}>
      {props.children}
    </span>
  )
}

function ClientAftercareCard(props: {
  children: ReactNode
  accent?: boolean
  tone?: 'success' | 'danger'
}) {
  return (
    <section
      className="brand-pro-session-card"
      data-accent={props.accent}
      data-tone={props.tone}
    >
      {props.children}
    </section>
  )
}

function ClientAftercareSectionTitle(props: {
  title: string
  subtitle?: string | null
  right?: ReactNode
}) {
  return (
    <div className="brand-pro-session-section-row">
      <div>
        <div className="brand-pro-session-section-title">{props.title}</div>
        {props.subtitle ? (
          <div className="brand-pro-session-card-body mt-1">
            {props.subtitle}
          </div>
        ) : null}
      </div>

      {props.right ? <div>{props.right}</div> : null}
    </div>
  )
}

// Thumb-preferred render URL for a loaded media item — feeds the shared
// before/after split (which renders the visit's primary pair).
function mediaPreviewSrc(media: LoadedRenderableMedia | null): string | null {
  if (!media) return null
  const thumb = typeof media.thumbUrl === 'string' ? media.thumbUrl.trim() : ''
  if (thumb) return media.thumbUrl
  const url = typeof media.url === 'string' ? media.url.trim() : ''
  return url ? media.url : null
}

// Full-size render URL for tap-to-open (falls back to the thumb).
function mediaFullSrc(media: LoadedRenderableMedia | null): string | null {
  if (!media) return null
  const url = typeof media.url === 'string' ? media.url.trim() : ''
  if (url) return media.url
  const thumb = typeof media.thumbUrl === 'string' ? media.thumbUrl.trim() : ''
  return thumb ? media.thumbUrl : null
}

function AftercarePrivacyNote() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-textPrimary/10 bg-bgSecondary px-3 py-2 text-[12px] font-semibold text-textSecondary">
      <span aria-hidden className="leading-none">
        🔒
      </span>
      <span>
        These photos are private — only you and your pro can see them. They’re
        never made public unless{' '}
        <span className="text-textPrimary">you add them to a review</span>.
      </span>
    </div>
  )
}

function ClientAftercareBeforeAfter(props: {
  beforeMedia: LoadedRenderableMedia[]
  afterMedia: LoadedRenderableMedia[]
  serviceName: string | null
  professionalId: string | null
}) {
  const primaryBefore = props.beforeMedia[0] ?? null
  const primaryAfter = props.afterMedia[0] ?? null
  const hasMedia = Boolean(primaryBefore || primaryAfter)

  if (!hasMedia) {
    return (
      <div className="grid gap-3">
        <div className="brand-pro-session-card-body">
          Your pro will attach photos during your booking flow.
        </div>
        <AftercarePrivacyNote />
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <AftercarePrivacyNote />

      <AftercareBeforeAfter
        media={{
          beforeUrl: mediaPreviewSrc(primaryBefore),
          afterUrl: mediaPreviewSrc(primaryAfter),
          beforeFullUrl: mediaFullSrc(primaryBefore),
          afterFullUrl: mediaFullSrc(primaryAfter),
        }}
        serviceName={props.serviceName}
        clientExportProfessionalId={props.professionalId}
      />

      {props.beforeMedia.length > 1 ? (
        <MediaStrip
          title="More before photos"
          label="Before"
          serviceName={props.serviceName}
          items={props.beforeMedia.slice(1)}
        />
      ) : null}

      {props.afterMedia.length > 1 ? (
        <MediaStrip
          title="More after photos"
          label="After"
          serviceName={props.serviceName}
          items={props.afterMedia.slice(1)}
        />
      ) : null}
    </div>
  )
}

export default async function ClientBookingPage(props: {
  params: Promise<PageParams> | PageParams
  searchParams?: Promise<PageSearchParams> | PageSearchParams
}) {
  const resolvedParams = await resolvePageValue<PageParams>(props.params, {
    id: '',
  })
  const bookingId = resolvedParams.id.trim()
  if (!bookingId) notFound()

  const resolvedSearchParams = await resolvePageValue<PageSearchParams>(
    props.searchParams,
    {},
  )
  const step = normalizeStep(firstSearchParam(resolvedSearchParams.step))
  const checkoutBanner = normalizeCheckoutBanner(
    firstSearchParam(resolvedSearchParams.checkout),
  )
  // Discovery-deposit checkout returns to `?deposit=success|cancelled`
  // (lib/checkout/nativeReturn.ts). Same success/cancelled shape as the
  // final-bill checkout banner, so reuse its normalizer.
  const depositBanner = normalizeCheckoutBanner(
    firstSearchParam(resolvedSearchParams.deposit),
  )

  const {
    user,
    raw,
    aftercare,
    existingReview,
    media,
    paymentSettings,
    rebookedNextBooking,
    depositCredit,
    creatorCreditBalanceCents,
    checkoutProductItems,
    prep,
    boards,
  } = await loadClientBookingPage(bookingId)

  const clientId = user.clientProfile?.id
  if (!clientId) {
    redirect(
      `/login?from=${encodeURIComponent(`/client/bookings/${bookingId}`)}`,
    )
  }

  // AI beauty consult (2026-08-26 full-analysis launch): founder-gated,
  // booking-attached. Hidden reasons render nothing (no-leak).
  const aiConsultBooking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: AI_CONSULT_ELIGIBILITY_BOOKING_SELECT,
  })
  const aiConsultEligibility = aiConsultBooking
    ? evaluateAiConsultBookingEligibility(aiConsultBooking)
    : null
  const aiConsultSession = await prisma.consultSession.findUnique({
    where: { bookingId },
    select: { id: true, status: true, clientId: true },
  })
  // Results are served through the same eligibility window (C7 loader), so the
  // card renders only while the booking itself is consult-eligible.
  const showAiConsultCard = Boolean(
    aiConsultEligibility?.eligible &&
      (!aiConsultSession || aiConsultSession.clientId === clientId),
  )

  const validMedia = media.filter(hasUsableMediaUrl)
  // Order the pro-chosen featured pair first so it renders as the primary
  // before/after comparison; the rest trail as flat thumbnails. Falls back to
  // earliest-first (the prior behavior) when nothing is featured.
  const beforeMedia = orderMediaByFeatured(
    validMedia.filter((mediaItem) => upper(mediaItem.phase) === 'BEFORE'),
    aftercare?.featuredBeforeAssetId ?? null,
  )
  const afterMedia = orderMediaByFeatured(
    validMedia.filter((mediaItem) => upper(mediaItem.phase) === 'AFTER'),
    aftercare?.featuredAfterAssetId ?? null,
  )

  // Primary service name for descriptive session-photo alt text; null when the
  // booking has no resolved service so callers fall back to a plain label.
  const photoServiceName = raw.service?.name?.trim() || null

  const hasPendingConsultationApproval =
    upper(raw.status) !== 'CANCELLED' &&
    upper(raw.status) !== 'COMPLETED' &&
    !raw.finishedAt &&
    (upper(raw.sessionStep) === 'CONSULTATION_PENDING_CLIENT' ||
      upper(raw.consultationApproval?.status) === 'PENDING')

  const booking = await buildClientBookingDTO({
    booking: raw,
    unreadAftercare: false,
    hasPendingConsultationApproval,
  })

  const viewModel = buildBookingViewModel({
    step,
    booking,
    raw,
    aftercare,
  })

  const baseHref = `/client/bookings/${encodeURIComponent(booking.id)}`

  if (step === 'consult' && !viewModel.canShowConsultTab) {
    redirect(`${baseHref}?step=overview`)
  }

  if (step === 'aftercare' && !viewModel.canShowAftercareTab) {
    redirect(`${baseHref}?step=overview`)
  }

  const { hadUnreadAftercare } = await markClientBookingStepNotificationsRead({
    clientId,
    bookingId: raw.id,
    step,
    aftercareId: aftercare?.id ?? null,
  })

  const showUnreadAftercareBadge =
    step === 'aftercare' && hadUnreadAftercare

  const appointmentTimeZone = sanitizeTimeZone(booking.timeZone, 'UTC')
  const scheduled = toDate(booking.scheduledFor)
  const whenLabel = scheduled
    ? formatWhenInTimeZone(scheduled, appointmentTimeZone)
    : COPY.common.unknownTime

  // Appointment prep — the "Before you go" layer. Shown while the appointment
  // is still ahead of the client; once it is done the care plan is the screen
  // that matters and the prep blocks would be noise.
  const prepCountdown = scheduled
    ? buildPrepCountdown(scheduled, appointmentTimeZone)
    : null
  const prepWritable = isPrepWritableStatus(raw.status)
  const showPrep =
    prepCountdown != null &&
    prepCountdown.tone !== 'past' &&
    prepWritable &&
    (prep.items.length > 0 || prep.note != null || boards.mine.length > 0)

  const statusVariant = clientStatusPillVariant(booking.status)
  const statusInfo = clientStatusMessage(booking.status)
  const statusUpper = upper(booking.status)
  // The client's own booking page used to print the DB enum in all three of the
  // places below — "ACCEPTED", and for the two newest states "IN_PROGRESS" and
  // "NO_SHOW". One canonical label now, same word as every other surface (B10).
  const statusPillLabel = clientStatusPillLabel(booking.status)

  // Show the media-use consent toggle once the session has happened — i.e. there
  // are (or will be) before/after photos to share: completed, finished, or any
  // session media already attached.
  const showMediaConsent =
    statusUpper === 'COMPLETED' ||
    Boolean(raw.finishedAt) ||
    beforeMedia.length > 0 ||
    afterMedia.length > 0

  const durationMinutes =
    booking.totalDurationMinutes > 0 ? booking.totalDurationMinutes : null

  const itemSubtotal = booking.items.reduce((sum, item) => {
    const numericPrice = Number(item.price)
    return Number.isFinite(numericPrice) ? sum + numericPrice : sum
  }, 0)

  const hasItemPrices = booking.items.some((item) => {
    const numericPrice = Number(item.price)
    return Number.isFinite(numericPrice)
  })

  const subtotalLabel = hasItemPrices
    ? `$${itemSubtotal.toFixed(2)}`
    : formatMoneyFromUnknown(booking.subtotalSnapshot)

  const serviceSubtotalLabel =
    formatMoneyFromUnknown(booking.checkout.serviceSubtotalSnapshot) ||
    subtotalLabel ||
    COPY.common.notProvided

  // Products / discount / tax / tip / final-total labels used to be built here
  // for a "Final cost recap" card that sat immediately above ClientCheckoutCard
  // and repeated every row it renders — from a SNAPSHOT, while the card's are
  // live, so the two disagreed as soon as a tip was typed. The checkout card is
  // the single place a client is quoted a number now.

  // A refunded/disputed final bill must not keep reading "Paid" — checkoutStatus
  // is monotonic and never reverses on a refund/dispute, so consult the DB's
  // refund/dispute truth first (M11 display-truth).
  const checkoutStatusLabel = booking.checkout.paymentDisputed
    ? 'Disputed'
    : booking.checkout.paymentFullyRefunded
      ? 'Refunded'
      : booking.checkout.paymentRefundedCents > 0
        ? 'Partially refunded'
        : friendlyCheckoutStatus(booking.checkout.checkoutStatus)
  const selectedPaymentMethodLabel = friendlyPaymentMethod(
    booking.checkout.selectedPaymentMethod,
  )

  const paymentAuthorizedAt = toDate(booking.checkout.paymentAuthorizedAt)
  const paymentCollectedAt = toDate(booking.checkout.paymentCollectedAt)

  const paymentAuthorizedLabel = paymentAuthorizedAt
    ? formatWhenInTimeZone(paymentAuthorizedAt, appointmentTimeZone)
    : null

  const paymentCollectedLabel = paymentCollectedAt
    ? formatWhenInTimeZone(paymentCollectedAt, appointmentTimeZone)
    : null

  const collectionTimingLabel = friendlyCollectionTiming(
    paymentSettings?.collectPaymentAt,
  )
  const acceptedMethods = buildClientAcceptedMethods(paymentSettings)

  const modeLabel = friendlyLocationType(booking.locationType)
  const sourceLabel = friendlySource(booking.source)

  const consultationNotes = String(
    booking.consultation?.approvalNotes ||
      booking.consultation?.consultationNotes ||
      '',
  )

  const proposedTotalLabel =
    formatMoneyFromUnknown(booking.consultation?.proposedTotal) ||
    formatMoneyFromUnknown(booking.subtotalSnapshot) ||
    null

  const rebookInfo = getAftercareRebookInfo(aftercare, appointmentTimeZone)
  const finalizedAftercare = hasFinalizedAftercare(aftercare)

  const reviewCloseoutEligible = canBookingAcceptClientReview({
    bookingStatus: raw.status,
    finishedAt: raw.finishedAt,
    aftercareSentAt: aftercare?.sentToClientAt,
    checkoutStatus: raw.checkoutStatus ?? null,
    paymentCollectedAt: raw.paymentCollectedAt ?? null,
  })

  // Off-platform payment the client marked sent, now waiting on the pro to
  // confirm receipt. The booking can't reach COMPLETED yet (closeout needs the
  // collected payment), so the rebook CTA below is un-gated for this state when
  // the pro actually sent a recommendation — otherwise the client is stranded on
  // "waiting on your pro" with no way to act on the suggested window (PF6).
  const awaitingPaymentConfirmation =
    upper(booking.checkout.checkoutStatus) === 'AWAITING_CONFIRMATION'

  const hasRebookRecommendation =
    rebookInfo.mode === 'RECOMMENDED_WINDOW' ||
    rebookInfo.mode === 'RECOMMENDED_DATE'

  const showRebookCTA =
    finalizedAftercare &&
    (statusUpper === 'COMPLETED' ||
      (awaitingPaymentConfirmation && hasRebookRecommendation))

  // The rebook "What's next" section has something to render — a recommendation
  // label or the actionable CTA. Single source for the step gate, the section
  // gate, the checkout banner copy, and the auto-advance target. A truthy
  // rebookInfo.label / showRebookCTA already implies a loaded aftercare, so this
  // stays equivalent to the old `aftercare && (label || cta)` guard.
  const hasRebookSection = Boolean(rebookInfo.label) || showRebookCTA

  // Resolve through the canonical helper (businessName → real name → fallback);
  // never expose the pro's email address as a display name to the client.
  const professionalLabel = formatProfessionalPublicDisplayName(
    booking.professional,
    COPY.common.professionalFallback,
  )

  const title = booking.display?.title || COPY.bookings.titleFallback
  const locationLine = booking.locationLabel || ''

  // Tori's standing rule: every address on a client surface opens the device's
  // maps app. The href is built from the DTO's `locationAddress` + coordinates,
  // never from `locationLabel` — the label can be a salon NAME or a bare city,
  // which a maps app cannot find.
  const locationMapsHref = booking.locationAddress
    ? mapsHrefFromLocation({
        lat: booking.locationLat,
        lng: booking.locationLng,
        formattedAddress: booking.locationAddress,
      })
    : null

  const proOverrideNote =
    typeof raw.clientVisibleOverrideNote === 'string' &&
    raw.clientVisibleOverrideNote.trim()
      ? raw.clientVisibleOverrideNote.trim()
      : null

  const showConsultationApproval = Boolean(viewModel.showConsultationApproval)

  // B6 — has the pro's proposal moved past the revision threshold? Loaded only
  // when there is actually a proposal awaiting her answer, so an ordinary
  // booking's page runs the query it always ran. Null on every non-consult
  // booking, and a `bigChange: false` notice renders nothing.
  const consultRevision = showConsultationApproval
    ? await loadConsultRevisionForClient({
        bookingId: booking.id,
        clientId,
      })
    : null
  const consultApprovalMode = step === 'consult' && showConsultationApproval
  const shouldShowReview = reviewCloseoutEligible && step === 'aftercare'

  // PF6's auto-advance-to-"What's next" is gone with the stepper it existed
  // for: the client who had just confirmed an off-platform payment was stranded
  // on a checkout STEP that said "waiting on your pro", with the rebook CTA
  // hidden in a tab they had no reason to open. In one scroll the rebook card
  // sits directly under settle-up and there is nothing to advance them to.

  const safeExistingReview = toSafeExistingReview(existingReview)

  const selectedCheckoutProducts = checkoutProductItems.map(
    (item: LoadedCheckoutProductItem) => ({
      recommendationId: item.recommendationId,
      productId: item.productId,
      quantity: item.quantity,
    }),
  )

  const drawerProfessionalId = booking.professional?.id
  if (!drawerProfessionalId) notFound()

  const drawerServiceId = booking.items[0]?.serviceId ?? raw.service?.id ?? null

  const safeLocationType =
    booking.locationType === 'SALON' || booking.locationType === 'MOBILE'
      ? booking.locationType
      : null

  const safeSource =
    booking.source === 'DISCOVERY' ||
    booking.source === 'REQUESTED' ||
    booking.source === 'AFTERCARE'
      ? booking.source
      : undefined

  const renderConsultationSection = (showDecisionCard: boolean) => (
    <SectionCard
      title={COPY.bookings.consultation.header}
      subtitle="Notes and consultation details"
      right={
        showConsultationApproval ? (
          <span className="inline-flex items-center rounded-full border border-textPrimary/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
            {COPY.bookings.consultation.approvalNeeded}
          </span>
        ) : null
      }
    >
      <div className="grid gap-3">
        <div>
          <div className="text-[11px] font-black text-textSecondary">
            {COPY.bookings.consultation.notesLabel}
          </div>
          <div className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-textPrimary">
            {consultationNotes.trim()
              ? consultationNotes
              : COPY.bookings.consultation.noNotes}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TinyMetaPill>
            <span className="text-textSecondary">
              {COPY.bookings.consultation.proposedTotalLabel}{' '}
            </span>
            {proposedTotalLabel || COPY.common.notProvided}
          </TinyMetaPill>

          <TinyMetaPill>
            <span className="text-textSecondary">
              {COPY.bookings.consultation.timesShownIn}{' '}
            </span>
            {friendlyTimeZoneLabel(appointmentTimeZone) ?? appointmentTimeZone}
          </TinyMetaPill>
        </div>

        {showDecisionCard && showConsultationApproval ? (
          <ConsultationDecisionCard
            bookingId={booking.id}
            appointmentTz={appointmentTimeZone}
            notes={consultationNotes}
            proposedTotalLabel={proposedTotalLabel}
            proposedServicesJson={booking.consultation?.proposedServicesJson ?? null}
            revision={consultRevision?.notice ?? null}
          />
        ) : (
          <div className="text-[12px] font-semibold text-textSecondary">
            {COPY.bookings.consultation.noApprovalNeeded}
          </div>
        )}
      </div>
    </SectionCard>
  )

  return (
    // The service name, the status pill and the route back used to live inside
    // the hero card, where the pill and an absolutely-placed back button sat on
    // top of the title and squeezed the date into a ~60%-width column. They are
    // page identity, so they belong in the page header.
    <ClientPage
      eyebrow="Booking"
      title={title}
      back={{ href: '/client/bookings', label: 'Bookings' }}
      action={
        <span
          className={cn(
            'inline-flex items-center rounded-full px-3 py-1 text-xs font-black',
            pillClassByVariant(statusVariant),
          )}
        >
          {statusPillLabel}
        </span>
      }
    >
      <section
        className={cn(
          'rounded-card border border-textPrimary/10 p-5 shadow-[0_18px_60px_rgb(var(--shadow-color)/0.22)]',
          'tovis-glass',
        )}
      >
        {/*
          Full-width now that the status pill and the back link have moved to
          the page header — the date no longer wraps four times beside them.
        */}
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-textSecondary">
            {COPY.bookings.withLabel}{' '}
            <ProProfileLink
              proId={booking.professional?.id ?? null}
              label={professionalLabel}
              className="font-black text-textPrimary hover:opacity-80"
            />
          </div>

          <div className="mt-2 text-[13px] text-textPrimary">
            <span className="font-black">{whenLabel}</span>
            <span className="text-textSecondary"> · {friendlyTimeZoneLabel(appointmentTimeZone) ?? appointmentTimeZone}</span>
            {locationLine ? (
              <span className="text-textSecondary">
                {' · '}
                {locationMapsHref ? (
                  <a
                    href={locationMapsHref}
                    target="_blank"
                    rel="noreferrer"
                    className="brand-focus underline underline-offset-2 hover:opacity-80"
                  >
                    {locationLine}
                  </a>
                ) : (
                  locationLine
                )}
              </span>
            ) : null}
          </div>

          {proOverrideNote ? (
            <div className="mt-2 whitespace-pre-wrap text-[13px] font-semibold text-textSecondary">
              <span className="font-black text-textPrimary">
                Note from your pro:
              </span>{' '}
              {proOverrideNote}
            </div>
          ) : null}
        </div>

        {(durationMinutes || subtotalLabel || modeLabel || sourceLabel) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {durationMinutes ? <TinyMetaPill>{durationMinutes} min</TinyMetaPill> : null}
            {serviceSubtotalLabel ? (
              <TinyMetaPill>{serviceSubtotalLabel}</TinyMetaPill>
            ) : null}
            {modeLabel ? <TinyMetaPill>{modeLabel}</TinyMetaPill> : null}
            {sourceLabel ? <TinyMetaPill>Source: {sourceLabel}</TinyMetaPill> : null}

            {showConsultationApproval ? (
              <span
                className="ml-auto inline-flex items-center rounded-full border border-textPrimary/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary"
                title={COPY.bookings.badges.actionRequired}
              >
                {COPY.bookings.badges.actionRequired}
              </span>
            ) : null}
          </div>
        )}
      </section>

      {consultApprovalMode ? (
        <div className="mt-4">{renderConsultationSection(true)}</div>
      ) : null}

      {!consultApprovalMode ? (
        <>
          {/*
            K13: the in-app answer to K12's reminder ask. Rendered on every tab
            of the booking, not just Overview — a pro waiting on "can you make
            it?" should not depend on which tab the client happened to open —
            and only when the DTO actually carries the state, which it does only
            once the ask went out.
          */}
          {booking.clientConfirmation ? (
            <div className="mt-4">
              <SectionCard
                title={booking.clientConfirmation.label}
                subtitle={booking.clientConfirmation.description}
              >
                <ClientConfirmationCard
                  bookingId={booking.id}
                  state={booking.clientConfirmation.kind}
                  professionalLabel={professionalLabel}
                  whenLabel={whenLabel}
                />
              </SectionCard>
            </div>
          ) : null}

          {step !== 'aftercare' && booking.items.length > 0 ? (
            <div className="mt-4">
              <SectionCard
                title="What’s included"
                subtitle={
                  booking.display?.addOnCount
                    ? 'Includes base service + add-ons'
                    : 'Service breakdown'
                }
                right={
                  booking.display?.addOnCount ? (
                    <span className="inline-flex items-center rounded-full border border-textPrimary/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
                      {booking.display.addOnCount} add-on
                      {booking.display.addOnCount === 1 ? '' : 's'}
                    </span>
                  ) : null
                }
              >
                <ServiceBreakdownCard
                  items={booking.items}
                  addOnCount={booking.display?.addOnCount ?? 0}
                />
              </SectionCard>
            </div>
          ) : null}

          <nav className="mt-4 flex flex-wrap items-center gap-2">
            <a
              href={`${baseHref}?step=overview`}
              className={tabClass(step === 'overview')}
            >
              {COPY.bookings.tabs.overview}
            </a>

            {viewModel.canShowConsultTab ? (
              <a
                href={`${baseHref}?step=consult`}
                className={tabClass(step === 'consult')}
              >
                {COPY.bookings.tabs.consultation}
              </a>
            ) : (
              <span
                className={tabDisabledClass()}
                title="Consultation becomes available after your booking is confirmed and started by your pro."
              >
                {COPY.bookings.tabs.consultation}
              </span>
            )}

            {viewModel.canShowAftercareTab ? (
              <a
                href={`${baseHref}?step=aftercare`}
                className={tabClass(step === 'aftercare')}
              >
                {COPY.bookings.tabs.aftercare}
              </a>
            ) : (
              <span
                className={tabDisabledClass()}
                title="Aftercare becomes available after your booking is completed."
              >
                {COPY.bookings.tabs.aftercare}
              </span>
            )}

            {step === 'aftercare' && showUnreadAftercareBadge ? (
              <span className="ml-auto inline-flex items-center rounded-full border border-textPrimary/10 bg-bgPrimary px-3 py-1 text-[10px] font-black text-textPrimary">
                {COPY.bookings.badges.new}
              </span>
            ) : null}
          </nav>

          <section
            className={cn(
              'mt-4 rounded-card p-4',
              alertClassByVariant(statusInfo.variant),
            )}
          >
            <div className="text-[13px] font-black text-textPrimary">
              {statusInfo.title}
            </div>
            <div className="mt-1 text-[13px] font-semibold leading-snug text-textSecondary">
              {statusInfo.body}
            </div>
          </section>

          {step === 'consult' ? (
            <div className="mt-4">
              {renderConsultationSection(showConsultationApproval)}
            </div>
          ) : null}

          {step === 'overview' ? (
            <div className="mt-4 grid gap-4">
              {showPrep && prepCountdown ? (
                <AppointmentPrepSection
                  bookingId={booking.id}
                  proDisplayName={professionalLabel}
                  countdown={prepCountdown}
                  whenLabel={whenLabel}
                  items={prep.items.map((item) => ({
                    id: item.id,
                    text: item.text,
                  }))}
                  checkedItemIds={prep.checkedItemIds}
                  note={prep.note}
                  boards={boards.mine.map((board) => ({
                    id: board.id,
                    name: board.name,
                    itemCount: board.itemCount,
                    visibility: board.visibility,
                    tileImageUrls: board.tileImageUrls,
                  }))}
                  sharedBoardIds={boards.sharedBoardIds}
                  writable={prepWritable}
                />
              ) : null}

              {showAiConsultCard ? (
                <AiConsultCard
                  bookingId={booking.id}
                  consultId={aiConsultSession?.id ?? null}
                  consultStatus={aiConsultSession?.status ?? null}
                />
              ) : null}

              {String(raw.depositStatus ?? '').toUpperCase() === 'PENDING' &&
              depositBanner === 'cancelled' ? (
                <div
                  role="status"
                  className="rounded-card border border-toneWarn/30 bg-bgPrimary p-3 text-[12px] font-semibold text-textPrimary"
                >
                  Deposit checkout wasn&apos;t completed. Your booking isn&apos;t
                  secured until the deposit is paid — complete it below to hold
                  your appointment.
                </div>
              ) : null}

              {String(raw.depositStatus ?? '').toUpperCase() === 'PENDING' &&
              depositBanner === 'success' ? (
                <div
                  role="status"
                  className="rounded-card border border-textPrimary/10 bg-bgPrimary p-3 text-[12px] font-semibold text-textPrimary"
                >
                  Deposit payment received. We&apos;re confirming it — this page
                  will show your deposit as paid as soon as it finishes
                  processing.
                </div>
              ) : null}

              <ClientDepositCard
                bookingId={booking.id}
                bookingStatus={booking.status}
                depositStatus={raw.depositStatus}
                depositDisputed={raw.depositDisputedAt != null}
                depositAmount={raw.depositAmount?.toString() ?? null}
                discoveryFeeCents={raw.discoveryFeeAmount}
                prepaysInFull={depositWouldCoverTotal(raw)}
                netDepositHeldCents={deriveNetDepositHeldCents(raw)}
              />

              {booking.cancellationPolicy ? (
                <SectionCard title="Cancellation policy">
                  <p className="text-[12px] font-semibold text-textSecondary">
                    {booking.cancellationPolicy}
                  </p>
                </SectionCard>
              ) : null}

              {showConsultationApproval ? (
                <SectionCard
                  title={COPY.bookings.consultation.actionNeededTitle}
                  subtitle={COPY.bookings.consultation.actionNeededBody}
                  right={
                    <a
                      href={`${baseHref}?step=consult`}
                      className="inline-flex items-center rounded-full border border-textPrimary/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover"
                    >
                      {COPY.bookings.consultation.actionNeededCta}
                    </a>
                  }
                >
                  <div className="text-[12px] font-semibold text-textSecondary">
                    One quick decision and you’re done.
                  </div>
                </SectionCard>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/v1/calendar?bookingId=${encodeURIComponent(booking.id)}`}
                  className="inline-flex items-center rounded-full border border-textPrimary/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass/10"
                >
                  {COPY.bookings.addToCalendar}
                </a>
              </div>

              <ClientBookingActionsCard
                bookingId={booking.id}
                status={booking.status}
                sessionStep={booking.sessionStep ?? null}
                scheduledFor={
                  scheduled ? scheduled.toISOString() : new Date().toISOString()
                }
                durationMinutesSnapshot={durationMinutes ?? null}
                appointmentTz={appointmentTimeZone}
                locationType={safeLocationType}
                hasAftercareLink={Boolean(booking.hasUnreadAftercare)}
                drawerContext={{
                  professionalId: drawerProfessionalId,
                  serviceId: drawerServiceId,
                  offeringId: null,
                  source: safeSource,
                  mediaId: null,
                  // This drawer only ever picks a new time for THIS booking, so
                  // the hold must reserve the width the reschedule will commit
                  // (`booking.totalDurationMinutes`), not the offering's current
                  // base — they drift whenever a duration is edited (B3).
                  rescheduleBookingId: booking.id,
                }}
              />
            </div>
          ) : null}

          {step === 'aftercare' ? (
            /*
             * ONE SCROLL, in the order the client actually wants it (Tori,
             * 2026-08-14): results → the plan → the pro's note → settle up →
             * rebook. This used to be a three-step wizard ("Your booking →
             * Checkout → What's next") and the pro's advice — the reason the
             * client opened the page — was two taps deep behind a checkout.
             *
             * ⚠️ Nothing here is gated on anything above it. A pro may collect
             * in person and a client may rebook before paying, so payment sits
             * where it reads best, not where it blocks.
             */
            <section id="aftercare" className="mt-4 grid gap-4">
              {/*
                The frame's identification line ("Full Balayage · Jun 15"), with
                the rows that used to live in a separate "Booking summary" card
                a step away. Folded in so the FIRST thing under the header is
                the result, not another summary.
              */}
              <ClientAftercareCard accent>
                <ClientAftercareSectionTitle
                  title={title}
                  subtitle={COPY.bookings.aftercare.header}
                  right={
                    showUnreadAftercareBadge ? (
                      <ClientAftercarePill tone="success">
                        {COPY.bookings.badges.new}
                      </ClientAftercarePill>
                    ) : null
                  }
                />

                <div className="brand-client-aftercare-pro-row">
                  <ClientAftercarePill tone="success">
                    {statusPillLabel}
                  </ClientAftercarePill>

                  <span className="brand-pro-session-muted text-[11px] font-bold">
                    {friendlyTimeZoneLabel(appointmentTimeZone) ?? appointmentTimeZone}
                  </span>
                </div>

                <div className="mt-3 grid gap-1">
                  <SummaryRow label="Provider" value={professionalLabel} />
                  <SummaryRow label="Booking" value={whenLabel} />
                  {locationLine ? (
                    <SummaryRow
                      label="Location"
                      value={
                        /* Tori's standing rule: every address opens maps. */
                        locationMapsHref ? (
                          <a
                            href={locationMapsHref}
                            target="_blank"
                            rel="noreferrer"
                            className="brand-focus underline underline-offset-2 hover:opacity-80"
                          >
                            {locationLine}
                          </a>
                        ) : (
                          locationLine
                        )
                      }
                    />
                  ) : null}
                </div>
              </ClientAftercareCard>

              {/* ── 1 · RESULTS ─────────────────────────────────────────── */}
              <ClientAftercareCard>
                <ClientAftercareSectionTitle
                  title="Before & after"
                  subtitle={
                    beforeMedia.length || afterMedia.length
                      ? 'Compare your booking photos.'
                      : 'No photos attached yet.'
                  }
                  right={
                    beforeMedia.length || afterMedia.length ? (
                      <ClientAftercarePill tone="success">
                        {beforeMedia.length + afterMedia.length} photo
                        {beforeMedia.length + afterMedia.length === 1 ? '' : 's'}
                      </ClientAftercarePill>
                    ) : null
                  }
                />

                <ClientAftercareBeforeAfter
                  beforeMedia={beforeMedia}
                  afterMedia={afterMedia}
                  serviceName={photoServiceName}
                  professionalId={booking.professional?.id ?? null}
                />
              </ClientAftercareCard>

              {showMediaConsent ? (
                <MediaConsentCard
                  bookingId={booking.id}
                  granted={booking.mediaUseConsent}
                />
              ) : null}

              {/* ── 2 · THE PLAN ────────────────────────────────────────── */}
              {/*
                The pro's own labelled blocks, in THEIR vocabulary — a colourist
                writes "Wash", a nail tech "Cuticle oil". The label is text they
                wrote, never an enum, so it renders verbatim.
              */}
              {(aftercare?.careSections ?? []).length > 0 ? (
                <ClientAftercareCard>
                  <ClientAftercareSectionTitle
                    title={`${professionalLabel}'s plan for you`}
                  />
                  <div className="mt-2 flex flex-col gap-4">
                    {(aftercare?.careSections ?? []).map((section) => (
                      <div key={section.id}>
                        <div className="text-[14px] font-black text-textPrimary">
                          {section.label}
                        </div>
                        <div className="brand-pro-session-card-body mt-1 whitespace-pre-wrap">
                          {section.body}
                        </div>
                      </div>
                    ))}
                  </div>
                </ClientAftercareCard>
              ) : null}

              {/* ── 3 · THE PRO'S NOTE ──────────────────────────────────── */}
              <ClientAftercareCard>
                <ClientAftercareSectionTitle
                  title={`Note from ${professionalLabel}`}
                />

                {aftercare?.notes ? (
                  <div className="brand-pro-session-card-body whitespace-pre-wrap">
                    {aftercare.notes}
                  </div>
                ) : (
                  <div className="brand-pro-session-card-body">
                    {statusUpper === 'COMPLETED'
                      ? COPY.bookings.aftercare.noAftercareNotesCompleted
                      : COPY.bookings.aftercare.noAftercareNotesPending}
                  </div>
                )}
              </ClientAftercareCard>

              {/* ── 4 · SETTLE UP ───────────────────────────────────────── */}
              <ClientAftercareCard>
                <ClientAftercareSectionTitle
                  title="Take home"
                  subtitle={`What ${professionalLabel} recommends, and what you're buying today.`}
                />

                <AftercareProductRecommendationsCard
                  bookingId={booking.id}
                  checkoutStatus={booking.checkout.checkoutStatus}
                  paymentCollectedAt={booking.checkout.paymentCollectedAt}
                  recommendedProducts={aftercare?.recommendedProducts ?? []}
                  purchasedProducts={booking.productSales}
                  selectedCheckoutProducts={selectedCheckoutProducts}
                />
              </ClientAftercareCard>

              {/*
                Guarded on `items` like the Overview tab's copy of this card.
                `ServiceBreakdownCard` renders null when there is nothing to
                break down, so without the guard a booking with no line items —
                every booking predating BookingServiceItem, and any row written
                outside the finalize path — drew the heading "Final service
                breakdown" over empty space.
              */}
              {booking.items.length > 0 ? (
                <ClientAftercareCard>
                  <ClientAftercareSectionTitle title="Final service breakdown" />

                  <ServiceBreakdownCard
                    items={booking.items}
                    addOnCount={booking.display?.addOnCount ?? 0}
                  />
                </ClientAftercareCard>
              ) : null}

              {booking.productSales.length > 0 ? (
                <ClientAftercareCard>
                  <ClientAftercareSectionTitle title="Purchased products" />

                  <PurchasedProductsCard productSales={booking.productSales} />
                </ClientAftercareCard>
              ) : null}

              <ClientAftercareCard>
                <ClientAftercareSectionTitle
                  title="Settle up"
                  subtitle={collectionTimingLabel}
                />

                {/*
                  Only what `ClientCheckoutCard` does NOT already show. It
                  renders every subtotal, the tip and the total itself — and it
                  renders them LIVE, so a second snapshot recap directly above
                  disagreed with it the moment a tip was typed. Two totals, one
                  bill: the checkout card owns the money, this owns the record
                  of what happened to it.
                */}
                <div className="grid gap-1">
                  <SummaryRow
                    label="Checkout status"
                    value={checkoutStatusLabel || COPY.common.notProvided}
                  />

                  {selectedPaymentMethodLabel ? (
                    <SummaryRow label="Payment method" value={selectedPaymentMethodLabel} />
                  ) : null}

                  {paymentAuthorizedLabel ? (
                    <SummaryRow label="Authorized" value={paymentAuthorizedLabel} />
                  ) : null}

                  {paymentCollectedLabel ? (
                    <SummaryRow label="Collected" value={paymentCollectedLabel} />
                  ) : null}
                </div>

                {paymentSettings?.paymentNote ? (
                  <div className="brand-pro-session-card-body mt-3">
                    {paymentSettings.paymentNote}
                  </div>
                ) : null}

                {checkoutBanner === 'success' ? (
                  <div
                    role="status"
                    className="mt-4 rounded-card border border-textPrimary/10 bg-bgPrimary p-3 text-[12px] font-semibold text-textPrimary"
                  >
                    Card payment received. We&apos;re finalizing your booking — this
                    page will reflect the paid status as soon as the
                    confirmation finishes processing.
                  </div>
                ) : null}

                {checkoutBanner === 'cancelled' ? (
                  <div
                    role="status"
                    className="mt-4 rounded-card border border-textPrimary/10 bg-bgPrimary p-3 text-[12px] font-semibold text-textPrimary"
                  >
                    Card checkout was cancelled. You can try again or pick a
                    different payment method below.
                  </div>
                ) : null}

                <div className="mt-4">
                  <ClientCheckoutCard
                    bookingId={booking.id}
                    checkoutStatus={booking.checkout.checkoutStatus}
                    paymentCollectedAt={booking.checkout.paymentCollectedAt}
                    selectedPaymentMethod={booking.checkout.selectedPaymentMethod}
                    serviceSubtotalSnapshot={booking.checkout.serviceSubtotalSnapshot}
                    productSubtotalSnapshot={booking.checkout.productSubtotalSnapshot}
                    tipAmount={booking.checkout.tipAmount}
                    taxAmount={booking.checkout.taxAmount}
                    discountAmount={booking.checkout.discountAmount}
                    totalAmount={booking.checkout.totalAmount}
                    depositCreditCents={depositCredit.creditCents}
                    creatorCreditBalanceCents={creatorCreditBalanceCents}
                    acceptedMethods={acceptedMethods}
                    tipsEnabled={paymentSettings?.tipsEnabled ?? true}
                    allowCustomTip={paymentSettings?.allowCustomTip ?? true}
                    tipSuggestions={paymentSettings?.tipSuggestions ?? true}
                    rebookOptionAvailable={hasRebookSection}
                  />
                </div>
              </ClientAftercareCard>

              {/* ── 5 · REBOOK ─────────────────────────────────────────── */}
              {aftercare && hasRebookSection ? (
                <section id="rebook" className="brand-client-aftercare-rebook">
                  <ClientAftercareSectionTitle
                    title={
                      rebookInfo.mode === 'BOOKED_NEXT_APPOINTMENT'
                        ? COPY.bookings.aftercare.nextAppointmentHeader
                        : COPY.bookings.aftercare.rebookHeader
                    }
                    subtitle={
                      rebookInfo.mode === 'BOOKED_NEXT_APPOINTMENT'
                        ? COPY.bookings.aftercare.nextAppointmentProposedSubtitle
                        : rebookInfo.label
                          ? `${rebookInfo.label} · ${friendlyTimeZoneLabel(appointmentTimeZone) ?? appointmentTimeZone}`
                          : COPY.bookings.aftercare.noRebookRecommendation
                    }
                  />

                  {rebookInfo.mode === 'BOOKED_NEXT_APPOINTMENT' &&
                  aftercare.rebookedFor ? (
                    <AftercareNextAppointmentCard
                      bookingId={booking.id}
                      scheduledForIso={
                        toDate(aftercare.rebookedFor)?.toISOString() ?? ''
                      }
                      timeZone={appointmentTimeZone}
                      professionalId={drawerProfessionalId}
                      serviceId={drawerServiceId}
                      confirmedBookingId={
                        rebookedNextBooking &&
                        upper(rebookedNextBooking.status) !== 'CANCELLED'
                          ? rebookedNextBooking.id
                          : null
                      }
                      declined={Boolean(aftercare.rebookDeclinedAt)}
                      pendingPaymentConfirmation={
                        upper(booking.checkout.checkoutStatus) ===
                          'AWAITING_CONFIRMATION' &&
                        rebookedNextBooking != null &&
                        upper(rebookedNextBooking.status) === 'PENDING'
                      }
                    />
                  ) : showRebookCTA ? (
                    /*
                     * ✅ `anchorStartIso` is what opens the picker ON the pro's
                     * recommended window. The day scroller only spans a week
                     * from wherever it starts, so a window eight weeks out is
                     * unreachable without it — not merely mis-anchored.
                     */
                    <AftercareRebookButton
                      professionalId={drawerProfessionalId}
                      serviceId={drawerServiceId}
                      anchorStartIso={
                        rebookInfo.mode === 'RECOMMENDED_WINDOW'
                          ? (toDate(aftercare.rebookWindowStart)?.toISOString() ??
                            null)
                          : null
                      }
                      timeZone={appointmentTimeZone}
                    />
                  ) : null}
                </section>
              ) : null}

              {/* ── AND THEN, THE REVIEW ───────────────────────────────── */}
              {!reviewCloseoutEligible ? (
                <ClientAftercareCard>
                  <ClientAftercareSectionTitle title="Review" />

                  <div className="brand-pro-session-card-body">
                    Your review will unlock after the booking is fully closed out:
                    payment must be collected, checkout must be paid or waived, and
                    aftercare must be finalized.
                  </div>
                </ClientAftercareCard>
              ) : null}

              {shouldShowReview ? (
                <div id="review">
                  <ReviewSection
                    bookingId={booking.id}
                    existingReview={safeExistingReview}
                  />
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </ClientPage>
  )
}
