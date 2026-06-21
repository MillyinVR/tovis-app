// app/pro/clients/[id]/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import type { ReactNode } from 'react'

import ClientNameLink from '@/app/_components/ClientNameLink'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToString } from '@/lib/money'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { formatProfessionalPublicSearchText } from '@/lib/privacy/professionalDisplayName'
import { formatPublicProfileDisplayName } from '@/lib/profiles/publicProfileFormatting'

import EditAlertBannerForm from './EditAlertBannerForm'
import NewAllergyForm from './NewAllergyForm'
import NewNoteForm from './NewNoteForm'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

type BookingFilter =
  | 'ALL'
  | 'WITH_ME'
  | 'MATCHES_MY_SERVICES'
  | 'UPCOMING'
  | 'PAST'
  | 'COMPLETED'
  | 'CANCELLED'

const BOOKING_FILTERS: readonly BookingFilter[] = [
  'ALL',
  'WITH_ME',
  'MATCHES_MY_SERVICES',
  'UPCOMING',
  'PAST',
  'COMPLETED',
  'CANCELLED',
]

const CLIENT_DETAIL_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  alertBanner: true,
  user: { select: { email: true } },
  notes: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      body: true,
      createdAt: true,
    },
  },
  allergies: {
    orderBy: { createdAt: 'desc' },
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
} satisfies Prisma.ClientProfileSelect

const BOOKING_ROW_SELECT = {
  id: true,
  status: true,
  scheduledFor: true,
  totalDurationMinutes: true,
  totalAmount: true,
  subtotalSnapshot: true,
  professionalId: true,
  serviceId: true,
  service: {
    select: {
      name: true,
      category: {
        select: {
          name: true,
        },
      },
    },
  },
  professional: {
    select: {
      businessName: true,
      firstName: true,
      lastName: true,
    },
  },
  aftercareSummary: {
    select: {
      notes: true,
    },
  },
} satisfies Prisma.BookingSelect

const PRODUCT_REC_SELECT = {
  id: true,
  note: true,
  product: {
    select: {
      name: true,
      brand: true,
    },
  },
  aftercareSummary: {
    select: {
      booking: {
        select: {
          scheduledFor: true,
        },
      },
    },
  },
} satisfies Prisma.ProductRecommendationSelect

const CLIENT_LEFT_REVIEW_SELECT = {
  id: true,
  rating: true,
  headline: true,
  body: true,
  createdAt: true,
  professional: {
    select: {
      businessName: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.ReviewSelect

const PRO_FEEDBACK_SELECT = {
  id: true,
  title: true,
  body: true,
  createdAt: true,
  professional: {
    select: {
      businessName: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.ClientProfessionalNoteSelect

type ClientDetailRecord = Prisma.ClientProfileGetPayload<{
  select: typeof CLIENT_DETAIL_SELECT
}>

type BookingRow = Prisma.BookingGetPayload<{
  select: typeof BOOKING_ROW_SELECT
}>

type ProductRecommendationRow = Prisma.ProductRecommendationGetPayload<{
  select: typeof PRODUCT_REC_SELECT
}>

type ClientLeftReviewRow = Prisma.ReviewGetPayload<{
  select: typeof CLIENT_LEFT_REVIEW_SELECT
}>

type ProFeedbackRow = Prisma.ClientProfessionalNoteGetPayload<{
  select: typeof PRO_FEEDBACK_SELECT
}>

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function formatDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function safeUpper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function buildProToClientMessageHref(args: {
  proId: string
  clientId: string
}): string {
  const { proId, clientId } = args

  return `/messages/start?contextType=PRO_PROFILE&contextId=${encodeURIComponent(
    proId,
  )}&clientId=${encodeURIComponent(clientId)}`
}

function statusTone(status: unknown): string {
  const normalizedStatus = safeUpper(status)

  if (normalizedStatus === 'COMPLETED') {
    return 'border-toneSuccess/30 text-toneSuccess'
  }

  if (normalizedStatus === 'CANCELLED') {
    return 'border-toneDanger/30 text-toneDanger'
  }

  if (normalizedStatus === 'ACCEPTED') {
    return 'border-accentPrimary/30 text-textPrimary'
  }

  if (normalizedStatus === 'PENDING') {
    return 'border-white/10 text-textPrimary'
  }

  return 'border-white/10 text-textSecondary'
}

function StatusPill({ status }: { status: unknown }) {
  const normalizedStatus = safeUpper(status) || 'UNKNOWN'

  return (
    <span
      className={[
        'inline-flex items-center rounded-full border bg-bgPrimary px-2 py-1 text-[11px] font-black',
        statusTone(normalizedStatus),
      ].join(' ')}
    >
      {normalizedStatus}
    </span>
  )
}

function SectionCard({
  id,
  title,
  subtitle,
  right,
  children,
}: {
  id: string
  title: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-black text-textPrimary">{title}</h2>

          {subtitle ? (
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              {subtitle}
            </div>
          ) : null}
        </div>

        {right ? <div className="shrink-0">{right}</div> : null}
      </div>

      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        {children}
      </div>
    </section>
  )
}

function normalizeBookingFilter(raw: unknown): BookingFilter {
  const normalized = String(raw || '').trim().toUpperCase()

  return BOOKING_FILTERS.includes(normalized as BookingFilter)
    ? (normalized as BookingFilter)
    : 'ALL'
}

function buildBookingSearchIndex(booking: BookingRow): string {
  const parts = [
    booking.service?.name,
    booking.service?.category?.name,
    formatProfessionalPublicSearchText(booking.professional),
    booking.status,
    booking.aftercareSummary?.notes,
    String(booking.totalDurationMinutes ?? ''),
    String(booking.totalAmount ?? booking.subtotalSnapshot ?? ''),
    booking.scheduledFor ? formatDate(booking.scheduledFor) : '',
  ]

  return parts
    .filter(Boolean)
    .map((part) => String(part).toLowerCase())
    .join(' ')
}

function bookingWhereForFilter(args: {
  clientId: string
  proId: string
  bookingFilter: BookingFilter
  myServiceIds: string[]
  now: Date
}): Prisma.BookingWhereInput {
  const { clientId, proId, bookingFilter, myServiceIds, now } = args

  const where: Prisma.BookingWhereInput = { clientId }

  if (bookingFilter === 'WITH_ME') {
    where.professionalId = proId
  }

  if (bookingFilter === 'UPCOMING') {
    where.scheduledFor = { gte: now }
  }

  if (bookingFilter === 'PAST') {
    where.scheduledFor = { lt: now }
  }

  if (bookingFilter === 'COMPLETED') {
    where.status = 'COMPLETED'
  }

  if (bookingFilter === 'CANCELLED') {
    where.status = 'CANCELLED'
  }

  if (bookingFilter === 'MATCHES_MY_SERVICES') {
    where.serviceId = { in: myServiceIds }
  }

  return where
}

function visibleClientIdSetFromRows(
  rows: Array<{ clientId: string }>,
): Set<string> {
  return new Set(rows.map((row) => row.clientId).filter(Boolean))
}

function upcomingBookingFromRows(rows: BookingRow[]): BookingRow | null {
  const nowMs = Date.now()

  return (
    rows
      .filter((booking) => booking.scheduledFor.getTime() > nowMs)
      .sort(
        (first, second) =>
          first.scheduledFor.getTime() - second.scheduledFor.getTime(),
      )[0] ?? null
  )
}

function filterBookingsBySearch(args: {
  rows: BookingRow[]
  query: string
}): BookingRow[] {
  const normalizedQuery = args.query.toLowerCase()

  if (!normalizedQuery) return args.rows

  return args.rows.filter((booking) =>
    buildBookingSearchIndex(booking).includes(normalizedQuery),
  )
}

function sortProductRecommendations(
  rows: ProductRecommendationRow[],
): ProductRecommendationRow[] {
  return [...rows].sort(
    (first, second) =>
      second.aftercareSummary.booking.scheduledFor.getTime() -
      first.aftercareSummary.booking.scheduledFor.getTime(),
  )
}

function ClientNotesList({ client }: { client: ClientDetailRecord }) {
  if (client.notes.length === 0) {
    return (
      <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
        No notes yet. Start the “professional memory” file.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {client.notes.map((note) => (
        <div
          key={note.id}
          className="rounded-card border border-white/10 bg-bgPrimary p-4"
        >
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0 truncate text-[13px] font-black text-textPrimary">
              {note.title || 'Note'}
            </div>

            <div className="shrink-0 text-[11px] font-semibold text-textSecondary">
              {formatDate(note.createdAt)}
            </div>
          </div>

          <div className="mt-2 whitespace-pre-wrap text-[13px] font-semibold text-textSecondary">
            {note.body}
          </div>
        </div>
      ))}
    </div>
  )
}

function ClientAllergiesList({ client }: { client: ClientDetailRecord }) {
  if (client.allergies.length === 0) {
    return (
      <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
        No allergies recorded yet.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {client.allergies.map((allergy) => (
        <div
          key={allergy.id}
          className="rounded-card border border-white/10 bg-bgPrimary p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 truncate text-[13px] font-black text-textPrimary">
              {allergy.label}
            </div>

            <span className="shrink-0 rounded-full border border-white/10 bg-bgSecondary px-3 py-1 text-[11px] font-black text-textSecondary">
              {String(allergy.severity || '').toUpperCase()}
            </span>
          </div>

          {allergy.description ? (
            <div className="mt-2 text-[12px] font-semibold text-textSecondary">
              {allergy.description}
            </div>
          ) : null}

          <div className="mt-2 text-[11px] font-semibold text-textSecondary/80">
            Recorded {formatDate(allergy.createdAt)}
            {allergy.recordedBy
              ? ` • by ${formatPublicProfileDisplayName({
                  businessName: allergy.recordedBy.businessName,
                  firstName: allergy.recordedBy.firstName,
                  lastName: allergy.recordedBy.lastName,
                  fallback: 'Professional',
                })}`
              : ''}
          </div>
        </div>
      ))}
    </div>
  )
}

function BookingFilterForm({
  clientId,
  bookingFilter,
  bookingQ,
}: {
  clientId: string
  bookingFilter: BookingFilter
  bookingQ: string
}) {
  return (
    <form
      className="flex flex-wrap items-center justify-end gap-2"
      method="GET"
      action=""
    >
      <div className="flex items-center gap-2">
        <label
          className="text-[11px] font-black text-textSecondary"
          htmlFor="bookingFilter"
        >
          View
        </label>

        <select
          id="bookingFilter"
          name="bookingFilter"
          defaultValue={bookingFilter}
          className="rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-[12px] font-black text-textPrimary"
        >
          <option value="ALL">All bookings</option>
          <option value="WITH_ME">Only bookings with me</option>
          <option value="MATCHES_MY_SERVICES">Only services I offer</option>
          <option value="UPCOMING">Upcoming</option>
          <option value="PAST">Past</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[11px] font-black text-textSecondary" htmlFor="q">
          Search
        </label>

        <input
          id="q"
          name="q"
          defaultValue={bookingQ}
          placeholder="Service, category, notes, status…"
          className="w-56 rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-[12px] font-semibold text-textPrimary placeholder:text-textSecondary/70"
        />
      </div>

      <button
        type="submit"
        className="inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
      >
        Apply
      </button>

      {bookingQ || bookingFilter !== 'ALL' ? (
        <Link
          href={`/pro/clients/${encodeURIComponent(clientId)}#history`}
          className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
        >
          Clear
        </Link>
      ) : null}
    </form>
  )
}

function ServiceHistoryList({
  bookingRowsFiltered,
  bookingRowsAll,
  proId,
}: {
  bookingRowsFiltered: BookingRow[]
  bookingRowsAll: BookingRow[]
  proId: string
}) {
  if (bookingRowsFiltered.length === 0) {
    return (
      <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
        No bookings match your search/filter.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="text-[11px] font-semibold text-textSecondary">
        Showing{' '}
        <span className="font-black text-textPrimary">
          {bookingRowsFiltered.length}
        </span>{' '}
        of{' '}
        <span className="font-black text-textPrimary">
          {bookingRowsAll.length}
        </span>
      </div>

      {bookingRowsFiltered.map((booking) => {
        const durationMinutes = Math.round(
          Number(booking.totalDurationMinutes ?? 0),
        )
        const total =
          moneyToString(booking.totalAmount ?? booking.subtotalSnapshot) ??
          '0.00'
        const when = formatDate(booking.scheduledFor)
        const proName = formatPublicProfileDisplayName({
          businessName: booking.professional?.businessName,
          firstName: booking.professional?.firstName,
          lastName: booking.professional?.lastName,
          fallback: 'Professional',
        })

        return (
          <Link
            key={booking.id}
            href={`/pro/bookings/${encodeURIComponent(booking.id)}`}
            className="block rounded-card border border-white/10 bg-bgPrimary p-4 hover:bg-surfaceGlass"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="truncate text-[13px] font-black text-textPrimary">
                    {booking.service?.name ?? 'Service'}
                  </div>

                  <StatusPill status={booking.status} />
                </div>

                <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                  {booking.service?.category?.name
                    ? `${booking.service.category.name} • `
                    : ''}
                  Pro:{' '}
                  <span className="font-black text-textPrimary">
                    {proName}
                  </span>
                  {booking.professionalId === proId ? (
                    <span className="ml-2 rounded-full border border-white/10 bg-bgSecondary px-2 py-0.5 text-[10px] font-black text-textSecondary">
                      Me
                    </span>
                  ) : null}
                </div>

                {booking.aftercareSummary?.notes ? (
                  <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                    <span className="font-black text-textPrimary">
                      Aftercare:
                    </span>{' '}
                    {booking.aftercareSummary.notes.slice(0, 120)}
                    {booking.aftercareSummary.notes.length > 120 ? '…' : ''}
                  </div>
                ) : null}
              </div>

              <div className="shrink-0 text-right">
                <div className="text-[12px] font-semibold text-textSecondary">
                  {when}
                </div>

                <div className="mt-1 text-[12px] font-black text-textPrimary">
                  {durationMinutes ? `${durationMinutes} min` : '—'} • ${total}
                </div>
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function ProductRecommendationsList({
  productRecs,
}: {
  productRecs: ProductRecommendationRow[]
}) {
  if (productRecs.length === 0) {
    return (
      <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
        No product recommendations recorded yet.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {sortProductRecommendations(productRecs).map((recommendation) => (
        <div
          key={recommendation.id}
          className="rounded-card border border-white/10 bg-bgPrimary p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-black text-textPrimary">
                {recommendation.product?.name ?? 'Product'}
              </div>

              {recommendation.product?.brand ? (
                <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                  {recommendation.product.brand}
                </div>
              ) : null}

              {recommendation.note ? (
                <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                  {recommendation.note}
                </div>
              ) : null}
            </div>

            <div className="shrink-0 text-[12px] font-semibold text-textSecondary">
              {formatDate(recommendation.aftercareSummary.booking.scheduledFor)}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function ClientLeftReviewsList({
  reviews,
}: {
  reviews: ClientLeftReviewRow[]
}) {
  if (reviews.length === 0) {
    return (
      <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
        This client hasn&apos;t left any reviews yet.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {reviews.map((review) => {
        const proName = formatPublicProfileDisplayName({
          businessName: review.professional?.businessName,
          firstName: review.professional?.firstName,
          lastName: review.professional?.lastName,
          fallback: 'Professional',
        })

        return (
          <div
            key={review.id}
            className="rounded-card border border-white/10 bg-bgPrimary p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-black text-textPrimary">
                  {review.headline || 'Review'}
                </div>

                <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                  Rating:{' '}
                  <span className="font-black text-textPrimary">
                    {review.rating}
                  </span>
                  /5 • For{' '}
                  <span className="font-black text-textPrimary">
                    {proName}
                  </span>
                </div>
              </div>

              <div className="shrink-0 text-[11px] font-semibold text-textSecondary">
                {formatDate(review.createdAt)}
              </div>
            </div>

            {review.body ? (
              <div className="mt-2 text-[13px] font-semibold text-textSecondary">
                {review.body}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function ProFeedbackList({ feedback }: { feedback: ProFeedbackRow[] }) {
  if (feedback.length === 0) {
    return (
      <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
        No pro feedback recorded yet.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {feedback.map((note) => {
        const proName = formatPublicProfileDisplayName({
          businessName: note.professional?.businessName,
          firstName: note.professional?.firstName,
          lastName: note.professional?.lastName,
          fallback: 'Professional',
        })

        return (
          <div
            key={note.id}
            className="rounded-card border border-white/10 bg-bgPrimary p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-black text-textPrimary">
                  {note.title || 'Feedback'}
                </div>

                <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                  By{' '}
                  <span className="font-black text-textPrimary">
                    {proName}
                  </span>
                </div>
              </div>

              <div className="shrink-0 text-[11px] font-semibold text-textSecondary">
                {formatDate(note.createdAt)}
              </div>
            </div>

            <div className="mt-2 whitespace-pre-wrap text-[13px] font-semibold text-textSecondary">
              {note.body}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default async function ClientDetailPage(props: {
  params: Promise<{ id: string }>
  searchParams?: Promise<SearchParams>
}) {
  const { id } = await props.params
  const clientId = id.trim()

  if (!clientId) redirect('/pro/clients')

  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/clients')
  }

  const proId = user.professionalProfile.id

  const gate = await assertProCanViewClient(proId, clientId)
  if (!gate.ok) redirect('/pro/clients')

  const messageHref = buildProToClientMessageHref({ proId, clientId })

  const searchParams =
    (await props.searchParams?.catch(() => ({} as SearchParams))) ??
    ({} as SearchParams)

  const bookingQ = firstParam(searchParams.q).trim()
  const bookingFilter = normalizeBookingFilter(
    firstParam(searchParams.bookingFilter),
  )

  const now = new Date()

  const myOfferings = await prisma.professionalServiceOffering.findMany({
    where: { professionalId: proId, isActive: true },
    select: { serviceId: true },
    take: 500,
  })

  const myServiceIds = myOfferings
    .map((offering) => offering.serviceId)
    .filter(Boolean)

  const bookingWhere = bookingWhereForFilter({
    clientId,
    proId,
    bookingFilter,
    myServiceIds,
    now,
  })

  const [client, bookingRowsAll, productRecs, clientLeftReviews, proFeedback] =
    await Promise.all([
      prisma.clientProfile.findUnique({
        where: { id: clientId },
        select: {
          ...CLIENT_DETAIL_SELECT,
          notes: {
            where: { professionalId: proId },
            orderBy: { createdAt: 'desc' },
            select: CLIENT_DETAIL_SELECT.notes.select,
          },
        },
      }),
      prisma.booking.findMany({
        where: bookingWhere,
        orderBy: { scheduledFor: 'desc' },
        take: 2000,
        select: BOOKING_ROW_SELECT,
      }),
      prisma.productRecommendation.findMany({
        where: {
          aftercareSummary: {
            booking: {
              clientId,
            },
          },
        },
        select: PRODUCT_REC_SELECT,
        take: 2000,
      }),
      prisma.review.findMany({
        where: { clientId },
        orderBy: { createdAt: 'desc' },
        take: 2000,
        select: CLIENT_LEFT_REVIEW_SELECT,
      }),
      prisma.clientProfessionalNote.findMany({
        where: {
          clientId,
          visibility: 'PROFESSIONALS_ONLY',
        },
        orderBy: { createdAt: 'desc' },
        take: 2000,
        select: PRO_FEEDBACK_SELECT,
      }),
    ])

  if (!client) redirect('/pro/clients')

  const visibleClientIdSet = visibleClientIdSetFromRows([{ clientId }])
  const canSeeClient = visibleClientIdSet.has(client.id)

  const totalVisits = bookingRowsAll.length
  const lastVisit = totalVisits ? bookingRowsAll[0] : null
  const upcoming = upcomingBookingFromRows(bookingRowsAll)

  const email = client.user?.email || ''
  const phone = client.phone || ''

  const bookingRowsFiltered = filterBookingsBySearch({
    rows: bookingRowsAll,
    query: bookingQ,
  })

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8 text-textPrimary">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/pro/clients"
          className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
        >
          ← Back to clients
        </Link>

        <div className="text-[11px] font-semibold text-textSecondary">
          Visibility:{' '}
          <span className="font-black text-textPrimary">Granted</span>
        </div>
      </div>

      <header className="tovis-glass mb-6 rounded-card border border-white/10 bg-bgSecondary p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-[22px] font-black text-textPrimary">
              <ClientNameLink canLink={canSeeClient} clientId={client.id}>
                {client.firstName} {client.lastName}
              </ClientNameLink>
            </h1>

            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              {email ? email : 'No email on file'}
              {phone ? ` • ${phone}` : ''}
            </div>

            {client.alertBanner ? (
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-toneWarning/30 bg-bgPrimary px-3 py-1 text-[11px] font-black text-toneWarning">
                <span aria-hidden>⚠</span>
                <span className="truncate">{client.alertBanner}</span>
              </div>
            ) : null}
          </div>

          <div className="grid gap-2 md:text-right">
            <div className="text-[12px] font-semibold text-textSecondary">
              <div>
                Total bookings:{' '}
                <span className="font-black text-textPrimary">
                  {totalVisits}
                </span>
              </div>

              {lastVisit ? (
                <div>
                  Last booking:{' '}
                  <span className="font-black text-textPrimary">
                    {formatDate(lastVisit.scheduledFor)}
                  </span>
                </div>
              ) : null}

              {upcoming ? (
                <div>
                  Next booking:{' '}
                  <span className="font-black text-textPrimary">
                    {formatDate(upcoming.scheduledFor)}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 md:justify-end">
              <Link
                href={messageHref}
                className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
              >
                Message
              </Link>

              <Link
                href={`/pro/bookings/new?clientId=${encodeURIComponent(
                  client.id,
                )}`}
                className="inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
              >
                + New booking
              </Link>

              <div className="rounded-full border border-white/10 bg-bgPrimary px-3 py-2">
                <EditAlertBannerForm
                  clientId={client.id}
                  initialAlertBanner={client.alertBanner ?? null}
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      <nav className="mb-6 flex flex-wrap gap-2">
        {[
          { id: 'notes', label: 'Notes' },
          { id: 'allergies', label: 'Allergies' },
          { id: 'history', label: 'Service history' },
          { id: 'products', label: 'Products' },
          { id: 'reviews-left', label: 'Reviews they left' },
          { id: 'pro-feedback', label: 'Pro feedback' },
        ].map((tab) => (
          <Link
            key={tab.id}
            href={`#${tab.id}`}
            className="rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="grid gap-6">
        <SectionCard
          id="notes"
          title="Pro notes"
          subtitle="Private notes visible to you (and admins). Preferences, patterns, and anything you don’t want to forget."
        >
          <div className="mb-4">
            <NewNoteForm clientId={client.id} />
          </div>

          <ClientNotesList client={client} />
        </SectionCard>

        <SectionCard
          id="allergies"
          title="Allergies & sensitivities"
          subtitle="Anything that could cause a reaction or needs extra care. The “do not fry their scalp” section."
        >
          <div className="mb-4">
            <NewAllergyForm clientId={client.id} />
          </div>

          <ClientAllergiesList client={client} />
        </SectionCard>

        <SectionCard
          id="history"
          title="Service history"
          subtitle="Search and filter all bookings for this client."
          right={
            <BookingFilterForm
              clientId={client.id}
              bookingFilter={bookingFilter}
              bookingQ={bookingQ}
            />
          }
        >
          <ServiceHistoryList
            bookingRowsFiltered={bookingRowsFiltered}
            bookingRowsAll={bookingRowsAll}
            proId={proId}
          />
        </SectionCard>

        <SectionCard
          id="products"
          title="Products recommended"
          subtitle="Recommendations tied to aftercare entries."
        >
          <ProductRecommendationsList productRecs={productRecs} />
        </SectionCard>

        <SectionCard
          id="reviews-left"
          title="Reviews they left"
          subtitle="All reviews this client has left (across any professional)."
        >
          <ClientLeftReviewsList reviews={clientLeftReviews} />
        </SectionCard>

        <SectionCard
          id="pro-feedback"
          title="Pro feedback"
          subtitle="Notes from professionals who serviced this client in the past (shared with pros)."
        >
          <ProFeedbackList feedback={proFeedback} />
        </SectionCard>
      </div>
    </main>
  )
}
