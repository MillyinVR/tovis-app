// app/client/bookings/[id]/page.tsx 

import type { ReactNode } from 'react'
import { notFound, redirect } from 'next/navigation'

import { COPY } from '@/lib/copy'
import { buildClientBookingDTO } from '@/lib/dto/clientBooking'
import { prisma } from '@/lib/prisma'
import { sanitizeTimeZone } from '@/lib/timeZone'
import { cn } from '@/lib/utils'
import { canBookingAcceptClientReview } from '@/lib/booking/writeBoundary'
import { NotificationEventKey } from '@prisma/client'
import ProProfileLink from '@/app/client/components/ProProfileLink'

import AftercareProductRecommendationsCard from './AftercareProductRecommendationsCard'
import ClientBookingActionsCard from './ClientBookingActionsCard'
import ConsultationDecisionCard from './ConsultationDecisionCard'
import ReviewSection from './ReviewSection'
import { loadClientBookingPage } from './_data/loadClientBookingPage'
import { buildBookingViewModel } from './_view/buildBookingViewModel'
import ClientCheckoutCard from './ClientCheckoutCard'

export const dynamic = 'force-dynamic'

type StepKey = 'overview' | 'consult' | 'aftercare'
type StatusVariant = 'danger' | 'success' | 'warn' | 'info' | 'neutral'

type PageParams = { id: string }
type PageSearchParams = Record<string, string | string[] | undefined>

type LoadedClientBookingPage = Awaited<ReturnType<typeof loadClientBookingPage>>
type LoadedAftercare = LoadedClientBookingPage['aftercare']
type LoadedExistingReview = LoadedClientBookingPage['existingReview']
type LoadedMedia = LoadedClientBookingPage['media'][number]
type LoadedPaymentSettings = LoadedClientBookingPage['paymentSettings']
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

type AcceptedMethod = {
  key: string
  label: string
  handle: string | null
}

const NO_REBOOK_INFO: AftercareRebookInfo = { mode: 'NONE', label: null }

function normalizeStep(raw: unknown): StepKey {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (normalized === 'consult' || normalized === 'consultation') return 'consult'
  if (normalized === 'aftercare') return 'aftercare'
  return 'overview'
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

function formatMoneyFromUnknown(value: unknown): string | null {
  if (value == null) return null

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `$${value.toFixed(2)}`
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) return `$${parsed.toFixed(2)}`
    return trimmed.startsWith('$') ? trimmed : `$${trimmed}`
  }

  if (typeof value === 'object' && value !== null) {
    const maybeToString = value.toString
    if (typeof maybeToString === 'function') {
      const result = maybeToString.call(value)
      if (typeof result === 'string') {
        return formatMoneyFromUnknown(result)
      }
    }
  }

  return null
}

function formatWhenInTimeZone(date: Date, timeZone: string): string {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatDateRangeInTimeZone(
  start: Date,
  end: Date,
  timeZone: string,
): string {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return `${formatter.format(start)} – ${formatter.format(end)}`
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

function buildAcceptedMethods(
  paymentSettings: LoadedPaymentSettings,
): AcceptedMethod[] {
  if (!paymentSettings) return []

  const methods: AcceptedMethod[] = []

  if (paymentSettings.acceptCash) {
    methods.push({ key: 'cash', label: 'Cash', handle: null })
  }

  if (paymentSettings.acceptCardOnFile) {
    methods.push({ key: 'card_on_file', label: 'Card on file', handle: null })
  }

  if (paymentSettings.acceptTapToPay) {
    methods.push({ key: 'tap_to_pay', label: 'Tap to pay', handle: null })
  }

  if (paymentSettings.acceptVenmo) {
    methods.push({
      key: 'venmo',
      label: 'Venmo',
      handle: paymentSettings.venmoHandle ?? null,
    })
  }

  if (paymentSettings.acceptZelle) {
    methods.push({
      key: 'zelle',
      label: 'Zelle',
      handle: paymentSettings.zelleHandle ?? null,
    })
  }

  if (paymentSettings.acceptAppleCash) {
    methods.push({
      key: 'apple_cash',
      label: 'Apple Cash',
      handle: paymentSettings.appleCashHandle ?? null,
    })
  }

  return methods
}

function statusPillVariant(
  statusRaw: unknown,
): Exclude<StatusVariant, 'neutral'> {
  const normalized = upper(statusRaw)
  if (normalized === 'CANCELLED') return 'danger'
  if (normalized === 'COMPLETED') return 'success'
  if (normalized === 'PENDING') return 'warn'
  return 'info'
}

function statusMessage(statusRaw: unknown): {
  title: string
  body: string
  variant: StatusVariant
} {
  const normalized = upper(statusRaw)
  const messages = COPY.bookings.status.messages

  if (normalized === 'PENDING') {
    return {
      title: messages.pending.title,
      body: messages.pending.body,
      variant: 'warn',
    }
  }

  if (normalized === 'ACCEPTED') {
    return {
      title: messages.accepted.title,
      body: messages.accepted.body,
      variant: 'info',
    }
  }

  if (normalized === 'COMPLETED') {
    return {
      title: messages.completed.title,
      body: messages.completed.body,
      variant: 'success',
    }
  }

  if (normalized === 'CANCELLED') {
    return {
      title: messages.cancelled.title,
      body: messages.cancelled.body,
      variant: 'danger',
    }
  }

  return {
    title: messages.fallback.title,
    body: messages.fallback.body,
    variant: 'neutral',
  }
}

function pillClassByVariant(
  _variant: Exclude<StatusVariant, 'neutral'>,
): string {
  return 'border border-white/10 bg-surfaceGlass text-textPrimary'
}

function alertClassByVariant(variant: StatusVariant): string {
  if (variant === 'neutral') return 'tovis-glass-soft border border-white/10'
  return 'tovis-glass border border-white/10'
}

function tabClass(active: boolean): string {
  return cn(
    'inline-flex items-center rounded-full px-4 py-2 text-xs font-black transition',
    'border border-white/10',
    active
      ? 'bg-accentPrimary text-bgPrimary shadow-sm'
      : 'bg-bgPrimary text-textPrimary hover:bg-surfaceGlass',
  )
}

function tabDisabledClass(): string {
  return cn(
    'inline-flex cursor-not-allowed select-none items-center rounded-full px-4 py-2 text-xs font-black opacity-50',
    'border border-white/10 bg-bgPrimary text-textSecondary',
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
          label: `Next appointment booked: ${formatWhenInTimeZone(bookedFor, timeZone)}`,
        }
      : {
          mode: 'BOOKED_NEXT_APPOINTMENT',
          label: 'Next appointment booked.',
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
      label: `Recommended next visit: ${formatWhenInTimeZone(legacyDate, timeZone)}`,
    }
  }

  return NO_REBOOK_INFO
}

function pickAftercareToken(aftercare: LoadedAftercare): string | null {
  if (!aftercare) return null
  const token = aftercare.publicToken
  return typeof token === 'string' && token.trim() ? token.trim() : null
}

function hasUsableMediaUrl(
  media: LoadedMedia | null | undefined,
): media is LoadedMedia & { url: string } {
  return typeof media?.url === 'string' && media.url.trim().length > 0
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

function SectionCard(props: {
  title: string
  subtitle?: string | null
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-card border border-white/10 p-4 shadow-[0_14px_48px_rgba(0,0,0,0.35)]',
        'tovis-glass',
        props.className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-black text-textPrimary">
            {props.title}
          </div>
          {props.subtitle ? (
            <div className="mt-0.5 text-[12px] font-semibold text-textSecondary">
              {props.subtitle}
            </div>
          ) : null}
        </div>

        {props.right ? <div className="shrink-0">{props.right}</div> : null}
      </div>

      <div className="mt-3">{props.children}</div>
    </section>
  )
}

function TinyMetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-2.5 py-1 text-[11px] font-black text-textPrimary">
      {children}
    </span>
  )
}

function SummaryRow(props: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/10 py-2 last:border-b-0 last:pb-0 first:pt-0">
      <div className="text-[12px] font-black text-textSecondary">
        {props.label}
      </div>
      <div className="text-right text-[13px] font-semibold text-textPrimary">
        {props.value}
      </div>
    </div>
  )
}

function MediaStrip(props: {
  title: string
  items: Array<LoadedMedia & { url: string }>
}) {
  if (props.items.length === 0) return null

  return (
    <div>
      <div className="mb-2 text-[11px] font-black text-textSecondary">
        {props.title}
      </div>
      <div className="looksNoScrollbar flex gap-2 overflow-x-auto pb-1">
        {props.items.map((mediaItem) => {
          const previewSrc =
            typeof mediaItem.thumbUrl === 'string' && mediaItem.thumbUrl.trim()
              ? mediaItem.thumbUrl
              : mediaItem.url

          return (
            <a
              key={mediaItem.id}
              href={mediaItem.url}
              className="block h-32 w-32 shrink-0 overflow-hidden rounded-card border border-white/10 bg-bgSecondary"
            >
              <img
                src={previewSrc}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </a>
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
            className="rounded-card border border-white/10 bg-bgPrimary px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-[14px] font-black text-textPrimary">
                    {itemName}
                  </div>
                  <span className="inline-flex items-center rounded-full border border-white/10 bg-bgSecondary px-2 py-0.5 text-[10px] font-black text-textPrimary">
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
          className="rounded-card border border-white/10 bg-bgPrimary px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
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

  const {
    user,
    raw,
    aftercare,
    existingReview,
    media,
    paymentSettings,
    checkoutProductItems,
  } = await loadClientBookingPage(bookingId)

  const clientId = user.clientProfile?.id
  if (!clientId) {
    redirect(
      `/login?from=${encodeURIComponent(`/client/bookings/${bookingId}`)}`,
    )
  }

  const validMedia = media.filter(hasUsableMediaUrl)
  const beforeMedia = validMedia.filter(
    (mediaItem) => upper(mediaItem.phase) === 'BEFORE',
  )
  const afterMedia = validMedia.filter(
    (mediaItem) => upper(mediaItem.phase) === 'AFTER',
  )

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

  const statusVariant = statusPillVariant(booking.status)
  const statusInfo = statusMessage(booking.status)
  const statusUpper = upper(booking.status)

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

  const productSubtotalLabel = formatMoneyFromUnknown(
    booking.checkout.productSubtotalSnapshot,
  )

  const discountLabel = formatMoneyFromUnknown(booking.checkout.discountAmount)
  const taxLabel = formatMoneyFromUnknown(booking.checkout.taxAmount)
  const tipLabel = formatMoneyFromUnknown(booking.checkout.tipAmount)

  const finalTotalLabel =
    formatMoneyFromUnknown(booking.checkout.totalAmount) ||
    serviceSubtotalLabel ||
    COPY.common.notProvided

  const checkoutStatusLabel = friendlyCheckoutStatus(
    booking.checkout.checkoutStatus,
  )
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
  const acceptedMethods = buildAcceptedMethods(paymentSettings)

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
  const aftercareToken = pickAftercareToken(aftercare)

  const reviewCloseoutEligible = canBookingAcceptClientReview({
    bookingStatus: raw.status,
    finishedAt: raw.finishedAt,
    aftercareSentAt: aftercare?.sentToClientAt,
    checkoutStatus: raw.checkoutStatus ?? null,
    paymentCollectedAt: raw.paymentCollectedAt ?? null,
  })

  const showRebookCTA =
    statusUpper === 'COMPLETED' && typeof aftercareToken === 'string'

  const professionalEmail =
    typeof raw.professional?.user?.email === 'string' &&
    raw.professional.user.email.trim()
      ? raw.professional.user.email
      : null

  const professionalLabel =
    booking.professional?.businessName ||
    professionalEmail ||
    COPY.common.professionalFallback

  const title = booking.display?.title || COPY.bookings.titleFallback
  const locationLine = booking.locationLabel || ''

  const showConsultationApproval = Boolean(viewModel.showConsultationApproval)
  const consultApprovalMode = step === 'consult' && showConsultationApproval
  const shouldShowReview = reviewCloseoutEligible && step === 'aftercare'

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
          <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
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
            {appointmentTimeZone}
          </TinyMetaPill>
        </div>

        {showDecisionCard && showConsultationApproval ? (
          <ConsultationDecisionCard
            bookingId={booking.id}
            appointmentTz={appointmentTimeZone}
            notes={consultationNotes}
            proposedTotalLabel={proposedTotalLabel}
            proposedServicesJson={booking.consultation?.proposedServicesJson ?? null}
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
    <main className="mx-auto mt-16 w-full max-w-2xl px-4 pb-12 text-textPrimary">
      <section
        className={cn(
          'rounded-card border border-white/10 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.45)]',
          'tovis-glass',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[18px] font-black leading-snug text-textPrimary">
              {title}
            </div>

            <div className="mt-2 text-[13px] font-semibold text-textSecondary">
              {COPY.bookings.withLabel}{' '}
              <ProProfileLink
                proId={booking.professional?.id ?? null}
                label={professionalLabel}
                className="font-black text-textPrimary hover:opacity-80"
              />
            </div>

            <div className="mt-2 text-[13px] text-textPrimary">
              <span className="font-black">{whenLabel}</span>
              <span className="text-textSecondary"> · {appointmentTimeZone}</span>
              {locationLine ? (
                <span className="text-textSecondary"> · {locationLine}</span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-3 py-1 text-xs font-black',
                pillClassByVariant(statusVariant),
              )}
            >
              {String(
                booking.status || COPY.bookings.status.pillUnknown,
              ).toUpperCase()}
            </span>

            <a
              href="/client/bookings"
              className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-[11px] font-black text-textPrimary hover:bg-surfaceGlass"
            >
              ← {COPY.bookings.backToBookings}
            </a>
          </div>
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
                className="ml-auto inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary"
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
                    <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
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
                title="Aftercare becomes available after your appointment is completed."
              >
                {COPY.bookings.tabs.aftercare}
              </span>
            )}

            {step === 'aftercare' && showUnreadAftercareBadge ? (
              <span className="ml-auto inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[10px] font-black text-textPrimary">
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
              {showConsultationApproval ? (
                <SectionCard
                  title={COPY.bookings.consultation.actionNeededTitle}
                  subtitle={COPY.bookings.consultation.actionNeededBody}
                  right={
                    <a
                      href={`${baseHref}?step=consult`}
                      className="inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover"
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
                  href={`/api/calendar?bookingId=${encodeURIComponent(booking.id)}`}
                  className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
                >
                  {COPY.bookings.addToCalendar}
                </a>
              </div>

              <ClientBookingActionsCard
                bookingId={booking.id}
                status={booking.status}
                scheduledFor={
                  scheduled ? scheduled.toISOString() : new Date().toISOString()
                }
                durationMinutesSnapshot={durationMinutes ?? null}
                appointmentTz={appointmentTimeZone}
                locationType={safeLocationType}
                drawerContext={{
                  professionalId: drawerProfessionalId,
                  serviceId: drawerServiceId,
                  offeringId: null,
                  source: safeSource,
                  mediaId: null,
                }}
              />
            </div>
          ) : null}

          {step === 'aftercare' ? (
            <section id="aftercare" className="mt-4 grid gap-4">
              <SectionCard
                title={COPY.bookings.aftercare.header}
                subtitle="Your TOVIS post-appointment summary."
                right={
                  showUnreadAftercareBadge ? (
                    <TinyMetaPill>{COPY.bookings.badges.new}</TinyMetaPill>
                  ) : null
                }
              >
                <div className="grid gap-4">
                  <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                    <div className="text-[12px] font-black text-textPrimary">
                      Appointment summary
                    </div>

                    <div className="mt-3 grid gap-1">
                      <SummaryRow label="Provider" value={professionalLabel} />
                      <SummaryRow label="Appointment" value={whenLabel} />
                      <SummaryRow label="Time zone" value={appointmentTimeZone} />
                      <SummaryRow
                        label="Status"
                        value={String(
                          booking.status || COPY.bookings.status.pillUnknown,
                        ).toUpperCase()}
                      />
                      {locationLine ? (
                        <SummaryRow label="Location" value={locationLine} />
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="text-[12px] font-black text-textPrimary">
                        Before &amp; After
                      </div>
                      <div className="text-[11px] font-semibold text-textSecondary">
                        {beforeMedia.length || afterMedia.length
                          ? 'Swipe to view'
                          : 'No photos attached'}
                      </div>
                    </div>

                    {beforeMedia.length || afterMedia.length ? (
                      <div className="mt-3 grid gap-3">
                        <MediaStrip title="Before" items={beforeMedia} />
                        <MediaStrip title="After" items={afterMedia} />
                      </div>
                    ) : (
                      <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                        Your pro will attach photos during your appointment flow.
                      </div>
                    )}
                  </div>

                  <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                    <div className="text-[12px] font-black text-textPrimary">
                      Final service breakdown
                    </div>
                    <div className="mt-3">
                      <ServiceBreakdownCard
                        items={booking.items}
                        addOnCount={booking.display?.addOnCount ?? 0}
                      />
                    </div>
                  </div>

                  {booking.productSales.length > 0 ? (
                    <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                      <div className="text-[12px] font-black text-textPrimary">
                        Purchased products
                      </div>
                      <div className="mt-3">
                        <PurchasedProductsCard productSales={booking.productSales} />
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                    <div className="text-[12px] font-black text-textPrimary">
                      Final cost recap
                    </div>

                    <div className="mt-3 grid gap-1">
                      <SummaryRow
                        label="Services subtotal"
                        value={serviceSubtotalLabel || COPY.common.notProvided}
                      />
                      {productSubtotalLabel ? (
                        <SummaryRow
                          label="Products subtotal"
                          value={productSubtotalLabel}
                        />
                      ) : null}
                      {discountLabel ? (
                        <SummaryRow label="Discount" value={discountLabel} />
                      ) : null}
                      {taxLabel ? <SummaryRow label="Tax" value={taxLabel} /> : null}
                      {tipLabel ? <SummaryRow label="Tip" value={tipLabel} /> : null}
                      <SummaryRow label="Final total" value={finalTotalLabel} />
                    </div>
                  </div>

                  <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                    <div className="text-[12px] font-black text-textPrimary">
                      Care notes
                    </div>

                    {aftercare?.notes ? (
                      <div className="mt-2 whitespace-pre-wrap text-[13px] leading-snug text-textPrimary">
                        {aftercare.notes}
                      </div>
                    ) : (
                      <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                        {statusUpper === 'COMPLETED'
                          ? COPY.bookings.aftercare.noAftercareNotesCompleted
                          : COPY.bookings.aftercare.noAftercareNotesPending}
                      </div>
                    )}
                  </div>

                  <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                    <div className="text-[12px] font-black text-textPrimary">
                      Recommended products
                    </div>
                    <div className="mt-3">
                      <AftercareProductRecommendationsCard
                        bookingId={booking.id}
                        checkoutStatus={booking.checkout.checkoutStatus}
                        paymentCollectedAt={booking.checkout.paymentCollectedAt}
                        recommendedProducts={aftercare?.recommendedProducts ?? []}
                        purchasedProducts={booking.productSales}
                        selectedCheckoutProducts={selectedCheckoutProducts}
                      />
                    </div>
                  </div>

                  <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
  <div className="text-[12px] font-black text-textPrimary">
    Payment &amp; checkout
  </div>

  <div className="mt-3 grid gap-1">
    <SummaryRow
      label="Checkout status"
      value={checkoutStatusLabel || COPY.common.notProvided}
    />
    {selectedPaymentMethodLabel ? (
      <SummaryRow
        label="Payment method"
        value={selectedPaymentMethodLabel}
      />
    ) : null}
    {collectionTimingLabel ? (
      <SummaryRow
        label="Collection timing"
        value={collectionTimingLabel}
      />
    ) : null}
    <SummaryRow
      label="Services subtotal"
      value={serviceSubtotalLabel || COPY.common.notProvided}
    />
    {productSubtotalLabel ? (
      <SummaryRow
        label="Products subtotal"
        value={productSubtotalLabel}
      />
    ) : null}
    {discountLabel ? (
      <SummaryRow label="Discount" value={discountLabel} />
    ) : null}
    {taxLabel ? <SummaryRow label="Tax" value={taxLabel} /> : null}
    {tipLabel ? <SummaryRow label="Tip" value={tipLabel} /> : null}
    <SummaryRow label="Final total" value={finalTotalLabel} />
    {paymentAuthorizedLabel ? (
      <SummaryRow
        label="Authorized"
        value={paymentAuthorizedLabel}
      />
    ) : null}
    {paymentCollectedLabel ? (
      <SummaryRow
        label="Collected"
        value={paymentCollectedLabel}
      />
    ) : null}
  </div>

  {paymentSettings?.paymentNote ? (
    <div className="mt-3 text-[12px] font-semibold text-textSecondary">
      {paymentSettings.paymentNote}
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
      acceptedMethods={acceptedMethods}
      tipsEnabled={paymentSettings?.tipsEnabled ?? true}
      allowCustomTip={paymentSettings?.allowCustomTip ?? true}
      tipSuggestions={paymentSettings?.tipSuggestions ?? true}
    />
  </div>
</div>

                  {!reviewCloseoutEligible ? (
                    <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                      <div className="text-[12px] font-black text-textPrimary">
                        Review
                      </div>
                      <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                        Your review will unlock after the booking is fully closed out:
                        payment must be collected, checkout must be paid or waived,
                        and aftercare must be finalized.
                      </div>
                    </div>
                  ) : null}

                  {aftercare && (rebookInfo.label || showRebookCTA) ? (
                    <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                      <div className="text-[12px] font-black text-textPrimary">
                        {COPY.bookings.aftercare.rebookHeader}
                      </div>

                      {rebookInfo.label ? (
                        <div className="mt-2 text-[13px] text-textPrimary">
                          {rebookInfo.label}
                          <span className="text-textSecondary">
                            {' '}
                            · {appointmentTimeZone}
                          </span>
                        </div>
                      ) : (
                        <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                          {COPY.bookings.aftercare.noRebookRecommendation}
                        </div>
                      )}

                      {showRebookCTA && aftercareToken ? (
                        <a
                          href={`/client/rebook/${encodeURIComponent(aftercareToken)}`}
                          className="mt-3 inline-flex items-center rounded-full bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
                        >
                          {rebookInfo.mode === 'BOOKED_NEXT_APPOINTMENT'
                            ? COPY.bookings.aftercare.rebookCtaViewDetails
                            : COPY.bookings.aftercare.rebookCtaNow}
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </SectionCard>
            </section>
          ) : null}

          {shouldShowReview ? (
            <div id="review" className="mt-6">
              <ReviewSection
                bookingId={booking.id}
                existingReview={safeExistingReview}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  )
}