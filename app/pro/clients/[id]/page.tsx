// app/pro/clients/[id]/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import type { PhotoReleaseStatus } from '@prisma/client'
import type { ReactNode } from 'react'

import ClientNameLink from '@/app/_components/ClientNameLink'
import RemoteImage from '@/app/_components/media/RemoteImage'
import { prisma } from '@/lib/prisma'
import { visibleReviewsWhere } from '@/lib/reviews/visibility'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToString } from '@/lib/money'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import {
  computeRelationshipIntelligence,
  daysLeftInWindow,
  formatCadence,
  type IntelBooking,
  type RelationshipIntelligence,
} from '@/lib/clients/relationshipIntelligence'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { readEncryptedNoteOrFallback } from '@/lib/security/notesPrivacy'
import { partitionNotesByKind } from '@/lib/clients/clientNoteKinds'
import {
  isClientTechnicalRecordEnabled,
  isPatchTestCurrent,
} from '@/lib/clients/technicalRecord'
import {
  loadTechnicalRecord,
  type FormulaView,
  type ConsentView,
  type TechnicalRecordData,
} from '@/lib/clients/technicalRecordLoader'
import { formatInTimeZone } from '@/lib/time'
import { resolveProScheduleTimeZone } from '@/lib/proLocations/resolveProScheduleTimeZone'
import { resolveAppointmentDisplayTimeZone } from '@/lib/booking/appointmentDisplayTimeZone'
import { formatProfessionalPublicSearchText } from '@/lib/privacy/professionalDisplayName'
import { formatPublicProfileDisplayName } from '@/lib/profiles/publicProfileFormatting'
import { loadPublicClientProfileByClientId } from '@/app/u/[handle]/_data/loadPublicClientProfile'
import PublicProfileView from '@/app/u/[handle]/_components/PublicProfileView'

import EditAlertBannerForm from './EditAlertBannerForm'
import EditDoNotRebookForm from './EditDoNotRebookForm'
import EditPhotoReleaseForm from './EditPhotoReleaseForm'
import EditProfileContextForm from './EditProfileContextForm'
import NewAllergyForm from './NewAllergyForm'
import NewConsentForm from './NewConsentForm'
import NewFormulaForm from './NewFormulaForm'
import NewNoteForm from './NewNoteForm'
import { Badge, Button, Card, buttonClassName } from '@/app/_components/ui'
import type { BadgeTone } from '@/app/_components/ui'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

type ChartView = 'chart' | 'public'

const CHART_TABS = [
  { id: 'notes', label: 'Notes' },
  { id: 'allergies', label: 'Allergies' },
  { id: 'history', label: 'History' },
  { id: 'products', label: 'Products' },
  { id: 'reviews-left', label: 'Reviews' },
  { id: 'pro-feedback', label: 'Pro feedback' },
  { id: 'photos', label: 'Photos' },
  // Flag-gated (ENABLE_CLIENT_TECHNICAL_RECORD); only shown/queried when on.
  { id: 'technical', label: 'Technical record' },
] as const

type ChartTab = (typeof CHART_TABS)[number]['id']

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
  // pii-plaintext-read-ok: birthday surfaced on the authorized pro client chart; dateOfBirth is plaintext-by-schema (no encrypted column).
  dateOfBirth: true,
  preferredContactMethod: true,
  handle: true,
  isPublicProfile: true,
  occupationEncrypted: true,
  proCapturedSocialHandle: true,
  user: { select: { email: true } },
  notes: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      body: true,
      kind: true,
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
  locationTimeZone: true,
  createdAt: true,
  finishedAt: true,
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
          locationTimeZone: true,
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

// Before/after timeline. Own craft (professionalId === pro) is always visible to
// the authoring pro; another pro's craft photos stay private to their author and
// only surface here once the CLIENT promotes them via a review (reviewId set →
// PUBLIC), which is world-public anyway. See design doc access matrix +
// lib/media/publicShareGuard.ts.
const TIMELINE_MEDIA_SELECT = {
  id: true,
  bookingId: true,
  professionalId: true,
  phase: true,
  caption: true,
  createdAt: true,
  visibility: true,
  reviewId: true,
  storageBucket: true,
  storagePath: true,
  thumbBucket: true,
  thumbPath: true,
  url: true,
  thumbUrl: true,
  booking: {
    select: {
      scheduledFor: true,
      locationTimeZone: true,
      service: { select: { name: true } },
    },
  },
} satisfies Prisma.MediaAssetSelect

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

const PHASE_ORDER: Record<string, number> = { BEFORE: 0, AFTER: 1, OTHER: 2 }

type TimelinePhoto = {
  id: string
  phase: string
  caption: string | null
  imageUrl: string | null
}

type TimelineVisit = {
  bookingId: string
  when: Date | null
  whenLocationTimeZone: string | null
  serviceName: string | null
  isMine: boolean
  photos: TimelinePhoto[]
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function normalizeView(raw: unknown): ChartView {
  return String(raw || '').trim().toLowerCase() === 'public' ? 'public' : 'chart'
}

function normalizeTab(raw: unknown): ChartTab {
  const normalized = String(raw || '').trim().toLowerCase()
  return CHART_TABS.some((tab) => tab.id === normalized)
    ? (normalized as ChartTab)
    : 'notes'
}

function chartHref(args: {
  clientId: string
  view?: ChartView
  tab?: ChartTab
}): string {
  const params = new URLSearchParams()
  params.set('view', args.view ?? 'chart')
  if (args.tab) params.set('tab', args.tab)
  return `/pro/clients/${encodeURIComponent(args.clientId)}?${params.toString()}`
}

function decimalToNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value)
}

function formatDate(value: Date | string, tz: string): string {
  const date = typeof value === 'string' ? new Date(value) : value

  return formatInTimeZone(date, tz, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatShortDate(value: Date, tz: string): string {
  return formatInTimeZone(value, tz, { month: 'short', day: 'numeric' })
}

function safeUpper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function moneyLabel(amount: number): string {
  return `$${moneyToString(amount) ?? '0.00'}`
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

function statusBadgeTone(status: string): BadgeTone {
  switch (status) {
    case 'COMPLETED':
      return 'success'
    case 'CANCELLED':
      return 'danger'
    case 'ACCEPTED':
      return 'accent'
    default:
      return 'neutral'
  }
}

function allergyTone(severity: unknown): BadgeTone {
  const value = safeUpper(severity)
  return value === 'CRITICAL' || value === 'HIGH' ? 'danger' : 'warn'
}

function StatusPill({ status }: { status: unknown }) {
  const normalizedStatus = safeUpper(status) || 'UNKNOWN'

  return <Badge tone={statusBadgeTone(normalizedStatus)}>{normalizedStatus}</Badge>
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

      <Card variant="glass" padding="md">{children}</Card>
    </section>
  )
}

function normalizeBookingFilter(raw: unknown): BookingFilter {
  const normalized = String(raw || '').trim().toUpperCase()

  return BOOKING_FILTERS.includes(normalized as BookingFilter)
    ? (normalized as BookingFilter)
    : 'ALL'
}

function buildBookingSearchIndex(booking: BookingRow, tz: string): string {
  const parts = [
    booking.service?.name,
    booking.service?.category?.name,
    formatProfessionalPublicSearchText(booking.professional),
    booking.status,
    booking.aftercareSummary?.notes,
    String(booking.totalDurationMinutes ?? ''),
    String(booking.totalAmount ?? booking.subtotalSnapshot ?? ''),
    booking.scheduledFor
      ? formatDate(
          booking.scheduledFor,
          resolveAppointmentDisplayTimeZone(booking.locationTimeZone, tz),
        )
      : '',
  ]

  return parts
    .filter(Boolean)
    .map((part) => String(part).toLowerCase())
    .join(' ')
}

// JS mirror of the old bookingWhereForFilter. We load the full client booking set
// ONCE (it powers the header + relationship intelligence + history), so the
// history tab filters that in-memory set rather than firing a second query.
function bookingMatchesFilter(
  booking: BookingRow,
  args: {
    bookingFilter: BookingFilter
    proId: string
    myServiceIds: string[]
    now: Date
  },
): boolean {
  const { bookingFilter, proId, myServiceIds, now } = args

  switch (bookingFilter) {
    case 'WITH_ME':
      return booking.professionalId === proId
    case 'MATCHES_MY_SERVICES':
      return myServiceIds.includes(booking.serviceId)
    case 'UPCOMING':
      return booking.scheduledFor.getTime() >= now.getTime()
    case 'PAST':
      return booking.scheduledFor.getTime() < now.getTime()
    case 'COMPLETED':
      return booking.status === 'COMPLETED'
    case 'CANCELLED':
      return booking.status === 'CANCELLED'
    default:
      return true
  }
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
  tz: string
}): BookingRow[] {
  const normalizedQuery = args.query.toLowerCase()

  if (!normalizedQuery) return args.rows

  return args.rows.filter((booking) =>
    buildBookingSearchIndex(booking, args.tz).includes(normalizedQuery),
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

function toIntelBookings(
  rows: BookingRow[],
  fallbackTimeZone: string,
): IntelBooking[] {
  return rows.map((row) => ({
    status: row.status,
    scheduledFor: row.scheduledFor,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    professionalId: row.professionalId,
    amount:
      decimalToNumber(row.totalAmount) ??
      decimalToNumber(row.subtotalSnapshot),
    // Bucket preferred day / time-of-day in the zone the visit happened in.
    timeZone: resolveAppointmentDisplayTimeZone(
      row.locationTimeZone,
      fallbackTimeZone,
    ),
  }))
}

// Read-only before/after timeline assembled from MediaAsset.bookingId, gated by
// the design doc access matrix (own craft always; others only when client-promoted).
async function loadPhotoTimeline(
  clientId: string,
  proId: string,
): Promise<TimelineVisit[]> {
  const rows = await prisma.mediaAsset.findMany({
    where: {
      mediaType: 'IMAGE',
      booking: { clientId },
      OR: [
        { professionalId: proId },
        { visibility: 'PUBLIC', reviewId: { not: null } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: TIMELINE_MEDIA_SELECT,
  })

  // Resolve every (signed/public) URL up front in parallel — private images each
  // need a network round-trip, so a sequential loop would serialize them.
  const rendered = await Promise.all(
    rows.map(async (row) => ({
      row,
      urls: await renderMediaUrls(row),
    })),
  )

  const byBooking = new Map<string, TimelineVisit>()

  for (const { row, urls } of rendered) {
    const bookingId = row.bookingId
    if (!bookingId) continue

    let visit = byBooking.get(bookingId)
    if (!visit) {
      visit = {
        bookingId,
        when: row.booking?.scheduledFor ?? null,
        whenLocationTimeZone: row.booking?.locationTimeZone ?? null,
        serviceName: row.booking?.service?.name ?? null,
        isMine: row.professionalId === proId,
        photos: [],
      }
      byBooking.set(bookingId, visit)
    }

    visit.photos.push({
      id: row.id,
      phase: row.phase,
      caption: row.caption,
      imageUrl: urls.renderThumbUrl ?? urls.renderUrl,
    })
  }

  const visits = [...byBooking.values()]
  for (const visit of visits) {
    visit.photos.sort(
      (a, b) => (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9),
    )
  }
  visits.sort(
    (a, b) => (b.when?.getTime() ?? 0) - (a.when?.getTime() ?? 0),
  )

  return visits
}

type ClientNoteRow = ClientDetailRecord['notes'][number]

function NoteCard({ note, tz }: { note: ClientNoteRow; tz: string }) {
  return (
    <div className="rounded-card border border-white/10 bg-bgPrimary p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 truncate text-[13px] font-black text-textPrimary">
          {note.title || 'Note'}
        </div>

        <div className="shrink-0 text-[11px] font-semibold text-textSecondary">
          {formatDate(note.createdAt, tz)}
        </div>
      </div>

      <div className="mt-2 whitespace-pre-wrap text-[13px] font-semibold text-textSecondary">
        {note.body}
      </div>
    </div>
  )
}

// Groups the pro's own notes by kind (General / Consultation / Communication
// style). DO_NOT_REBOOK notes are excluded here — they surface in their own
// author-only banner near the pinned zone.
function ClientNotesList({
  client,
  tz,
}: {
  client: ClientDetailRecord
  tz: string
}) {
  const { groups } = partitionNotesByKind(client.notes)

  if (groups.length === 0) {
    return (
      <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
        No notes yet. Start the “professional memory” file.
      </div>
    )
  }

  return (
    <div className="grid gap-5">
      {groups.map((group) => (
        <div key={group.kind} className="grid gap-3">
          <div className="text-[11px] font-black uppercase tracking-[0.08em] text-textSecondary">
            {group.label}
          </div>
          {group.notes.map((note) => (
            <NoteCard key={note.id} note={note} tz={tz} />
          ))}
        </div>
      ))}
    </div>
  )
}

function ClientAllergiesList({
  client,
  tz,
}: {
  client: ClientDetailRecord
  tz: string
}) {
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

            <Badge tone={allergyTone(allergy.severity)} className="shrink-0">
              {String(allergy.severity || '').toUpperCase()}
            </Badge>
          </div>

          {allergy.description ? (
            <div className="mt-2 text-[12px] font-semibold text-textSecondary">
              {allergy.description}
            </div>
          ) : null}

          <div className="mt-2 text-[11px] font-semibold text-textSecondary/80">
            Recorded {formatDate(allergy.createdAt, tz)}
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
      {/* Keep the chart/public mode + active tab when applying a filter. */}
      <input type="hidden" name="view" value="chart" />
      <input type="hidden" name="tab" value="history" />

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

      <Button type="submit" variant="primary" size="sm">
        Apply
      </Button>

      {bookingQ || bookingFilter !== 'ALL' ? (
        <Link
          href={chartHref({ clientId, tab: 'history' })}
          className={buttonClassName({ variant: 'ghost', size: 'sm' })}
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
  tz,
}: {
  bookingRowsFiltered: BookingRow[]
  bookingRowsAll: BookingRow[]
  proId: string
  tz: string
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
        const when = formatDate(
          booking.scheduledFor,
          resolveAppointmentDisplayTimeZone(booking.locationTimeZone, tz),
        )
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
                    <Badge tone="neutral" size="sm" className="ml-2">
                      Me
                    </Badge>
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
  tz,
}: {
  productRecs: ProductRecommendationRow[]
  tz: string
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
              {formatDate(
                recommendation.aftercareSummary.booking.scheduledFor,
                resolveAppointmentDisplayTimeZone(
                  recommendation.aftercareSummary.booking.locationTimeZone,
                  tz,
                ),
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function ClientLeftReviewsList({
  reviews,
  tz,
}: {
  reviews: ClientLeftReviewRow[]
  tz: string
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
                {formatDate(review.createdAt, tz)}
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

function ProFeedbackList({
  feedback,
  tz,
}: {
  feedback: ProFeedbackRow[]
  tz: string
}) {
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
                {formatDate(note.createdAt, tz)}
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

function PhotoTimeline({
  visits,
  tz,
}: {
  visits: TimelineVisit[]
  tz: string
}) {
  if (visits.length === 0) {
    return (
      <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
        No before/after photos for this client yet.
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      {visits.map((visit) => (
        <div
          key={visit.bookingId}
          className="rounded-card border border-white/10 bg-bgPrimary p-4"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0 truncate text-[13px] font-black text-textPrimary">
              {visit.serviceName ?? 'Visit'}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {visit.isMine ? (
                <Badge tone="neutral" size="sm">
                  Me
                </Badge>
              ) : (
                <Badge tone="info" size="sm">
                  Client-shared
                </Badge>
              )}
              <span className="text-[11px] font-semibold text-textSecondary">
                {visit.when
                  ? formatDate(
                      visit.when,
                      resolveAppointmentDisplayTimeZone(
                        visit.whenLocationTimeZone,
                        tz,
                      ),
                    )
                  : '—'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {visit.photos.map((photo) => (
              <div key={photo.id} className="grid gap-1">
                <div className="relative aspect-square overflow-hidden rounded-card border border-white/10 bg-bgSecondary">
                  {photo.imageUrl ? (
                    <RemoteImage
                      src={photo.imageUrl}
                      alt={photo.caption ?? `${photo.phase} photo`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      width={240}
                      height={240}
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-[11px] font-semibold text-textSecondary">
                      No preview
                    </div>
                  )}
                  <span className="absolute left-1 top-1">
                    <Badge tone="neutral" size="sm">
                      {photo.phase}
                    </Badge>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function patchResultTone(result: string | null): BadgeTone {
  switch (result) {
    case 'PASS':
      return 'success'
    case 'FAIL':
      return 'danger'
    case 'INCONCLUSIVE':
      return 'warn'
    default:
      return 'neutral'
  }
}

function photoReleaseTone(status: PhotoReleaseStatus): BadgeTone {
  switch (status) {
    case 'GRANTED':
      return 'success'
    case 'DECLINED':
      return 'danger'
    default:
      return 'neutral'
  }
}

function FormulaList({
  formula,
  tz,
}: {
  formula: FormulaView[]
  tz: string
}) {
  if (formula.length === 0) {
    return (
      <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
        No formula history yet.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {formula.map((entry) => {
        const specs = [
          entry.brand,
          entry.developer,
          entry.ratio,
          entry.processingTimeMinutes
            ? `${entry.processingTimeMinutes} min`
            : null,
        ].filter(Boolean)

        return (
          <div
            key={entry.id}
            className="rounded-card border border-white/10 bg-bgPrimary p-4"
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0 truncate text-[13px] font-black text-textPrimary">
                {entry.serviceName ?? 'Formula'}
              </div>
              <div className="shrink-0 text-[11px] font-semibold text-textSecondary">
                {entry.when
                  ? formatDate(
                      entry.when,
                      resolveAppointmentDisplayTimeZone(
                        entry.whenLocationTimeZone,
                        tz,
                      ),
                    )
                  : '—'}
              </div>
            </div>

            {specs.length ? (
              <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                {specs.join(' · ')}
              </div>
            ) : null}

            {entry.resultNotes ? (
              <div className="mt-2 whitespace-pre-wrap text-[12px] font-semibold text-textSecondary">
                {entry.resultNotes}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function ConsentList({
  consents,
  now,
  tz,
}: {
  consents: ConsentView[]
  now: Date
  tz: string
}) {
  if (consents.length === 0) {
    return (
      <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
        No consent or patch-test records yet.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {consents.map((record) => {
        const isPatch = record.kind === 'PATCH_TEST'
        const current = isPatchTestCurrent(record.validUntil, now)

        return (
          <div
            key={record.id}
            className="rounded-card border border-white/10 bg-bgPrimary p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-black text-textPrimary">
                  {record.kind.replace(/_/g, ' ')}
                </span>
                {isPatch && record.patchTestResult ? (
                  <Badge tone={patchResultTone(record.patchTestResult)}>
                    {record.patchTestResult}
                  </Badge>
                ) : null}
                {record.scope === 'safety' ? (
                  <Badge tone="info" size="sm">
                    {record.byName ?? 'Another pro'}
                  </Badge>
                ) : null}
              </div>
              <div className="shrink-0 text-[11px] font-semibold text-textSecondary">
                {record.when
                  ? formatDate(
                      record.when,
                      resolveAppointmentDisplayTimeZone(
                        record.whenLocationTimeZone,
                        tz,
                      ),
                    )
                  : '—'}
              </div>
            </div>

            {record.serviceScope ? (
              <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                Scope: {record.serviceScope}
              </div>
            ) : null}

            {isPatch && record.validUntil ? (
              <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                Valid until {formatDate(record.validUntil, tz)}{' '}
                <Badge tone={current ? 'success' : 'warn'} size="sm">
                  {current ? 'current' : 'expired'}
                </Badge>
              </div>
            ) : null}

            {record.scope === 'full' && (record.proofMethod || record.signedAt) ? (
              <div className="mt-1 text-[11px] font-semibold text-textSecondary/80">
                {record.proofMethod
                  ? `Proof: ${record.proofMethod.replace(/_/g, ' ').toLowerCase()}`
                  : ''}
                {record.signedAt ? ` • signed ${formatDate(record.signedAt, tz)}` : ''}
                {record.proofRef ? ` • ref ${record.proofRef}` : ''}
              </div>
            ) : null}

            {record.notes ? (
              <div className="mt-2 whitespace-pre-wrap text-[12px] font-semibold text-textSecondary">
                {record.notes}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function TechnicalRecordTab({
  clientId,
  data,
  now,
  tz,
}: {
  clientId: string
  data: TechnicalRecordData
  now: Date
  tz: string
}) {
  return (
    <>
      <SectionCard
        id="photo-release"
        title="Photo release"
        subtitle="The client's standing before/after photo-release decision. Public sharing still requires the client to promote a photo via a review."
        right={
          <Badge tone={photoReleaseTone(data.photoReleaseStatus)}>
            {data.photoReleaseStatus.replace(/_/g, ' ')}
          </Badge>
        }
      >
        <EditPhotoReleaseForm
          clientId={clientId}
          initialStatus={data.photoReleaseStatus}
        />
      </SectionCard>

      <SectionCard
        id="formula"
        title="Formula history"
        subtitle="Your craft record per visit — private to you, never public."
      >
        <div className="mb-4">
          <NewFormulaForm clientId={clientId} />
        </div>
        <FormulaList formula={data.formula} tz={tz} />
      </SectionCard>

      <SectionCard
        id="consent"
        title="Consent & patch tests"
        subtitle="Signed waivers stay private to you; patch-test results travel to any pro with access."
      >
        <div className="mb-4">
          <NewConsentForm clientId={clientId} />
        </div>
        <ConsentList consents={data.consents} now={now} tz={tz} />
      </SectionCard>
    </>
  )
}

function WindowCountdownBadge({
  accessUntil,
  now,
  tz,
}: {
  accessUntil: Date | null
  now: Date
  tz: string
}) {
  if (!accessUntil) {
    return <Badge tone="success">Access open</Badge>
  }

  const daysLeft = daysLeftInWindow(accessUntil, now)
  const tone: BadgeTone = daysLeft <= 7 ? 'warn' : 'info'
  const left =
    daysLeft === 0 ? 'closes today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`

  return (
    <Badge tone={tone}>
      <span aria-hidden>⏳</span>
      Access · {left} · closes {formatShortDate(accessUntil, tz)}
    </Badge>
  )
}

function ViewToggle({
  clientId,
  view,
  tab,
}: {
  clientId: string
  view: ChartView
  tab: ChartTab
}) {
  const segments: Array<{ value: ChartView; label: string; href: string }> = [
    { value: 'chart', label: 'Chart', href: chartHref({ clientId, view: 'chart', tab }) },
    { value: 'public', label: 'Public profile', href: chartHref({ clientId, view: 'public' }) },
  ]

  return (
    <div
      className="inline-flex rounded-full border border-white/10 bg-bgPrimary p-1"
      role="tablist"
      aria-label="Chart view"
    >
      {segments.map((segment) => {
        const active = segment.value === view
        return (
          <Link
            key={segment.value}
            href={segment.href}
            role="tab"
            aria-selected={active}
            className={[
              'rounded-full px-4 py-1.5 text-[12px] font-black transition',
              active
                ? 'bg-accentPrimary text-onAccent'
                : 'text-textSecondary hover:text-textPrimary',
            ].join(' ')}
          >
            {segment.label}
          </Link>
        )
      })}
    </div>
  )
}

function TabNav({
  clientId,
  activeTab,
  technicalEnabled,
}: {
  clientId: string
  activeTab: ChartTab
  technicalEnabled: boolean
}) {
  const tabs = CHART_TABS.filter(
    (tab) => tab.id !== 'technical' || technicalEnabled,
  )

  return (
    <nav className="flex flex-wrap gap-2" aria-label="Chart sections">
      {tabs.map((tab) => {
        const active = tab.id === activeTab
        return (
          <Link
            key={tab.id}
            href={chartHref({ clientId, tab: tab.id })}
            aria-current={active ? 'page' : undefined}
            className={buttonClassName({
              variant: active ? 'primary' : 'ghost',
              size: 'sm',
            })}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}

function SafetyStrip({ client }: { client: ClientDetailRecord }) {
  const hasAllergies = client.allergies.length > 0

  return (
    <section
      aria-label="Safety"
      className="tovis-glass rounded-card border border-toneWarn/30 bg-bgSecondary p-4"
    >
      <div className="text-[11px] font-black uppercase tracking-[0.1em] text-textSecondary">
        Safety
      </div>

      {client.alertBanner ? (
        <div className="mt-2 flex items-start gap-2 rounded-card border border-toneWarn/30 bg-bgPrimary p-3 text-[13px] font-black text-toneWarn">
          <span aria-hidden>⚠</span>
          <span className="min-w-0">{client.alertBanner}</span>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {hasAllergies ? (
          client.allergies.map((allergy) => (
            <Badge key={allergy.id} tone={allergyTone(allergy.severity)}>
              {allergy.label}
              <span className="opacity-70">
                · {String(allergy.severity || '').toUpperCase()}
              </span>
            </Badge>
          ))
        ) : (
          <span className="text-[12px] font-semibold text-textSecondary">
            {client.alertBanner
              ? 'No allergies on file.'
              : 'No allergies or alerts on file.'}
          </span>
        )}
      </div>
    </section>
  )
}

function DoNotRebookBanner({ note }: { note: ClientNoteRow | null }) {
  if (!note) return null

  return (
    <section
      aria-label="Do not rebook"
      className="rounded-card border border-toneDanger/40 bg-bgSecondary p-4"
    >
      <div className="flex items-center gap-2 text-[13px] font-black text-toneDanger">
        <span aria-hidden>⛔</span> Do not rebook
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-textSecondary">
          · private to you
        </span>
      </div>
      {note.body ? (
        <div className="mt-2 whitespace-pre-wrap text-[12px] font-semibold text-textSecondary">
          {note.body}
        </div>
      ) : null}
    </section>
  )
}

function SmartFlagsStrip({
  flags,
}: {
  flags: RelationshipIntelligence['flags']
}) {
  if (flags.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2" aria-label="Smart flags">
      {flags.map((flag) => (
        <Badge key={flag.key} tone={flag.tone}>
          {flag.label}
        </Badge>
      ))}
    </div>
  )
}

function IntelStat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.1em] text-textSecondary">
        {label}
      </div>
      <div className="mt-1 text-[15px] font-black text-textPrimary">{value}</div>
      {hint ? (
        <div className="mt-0.5 text-[11px] font-semibold text-textSecondary">
          {hint}
        </div>
      ) : null}
    </div>
  )
}

function RelationshipIntelligenceCard({
  intel,
  referralSource,
}: {
  intel: RelationshipIntelligence
  referralSource: string | null
}) {
  const cadence = formatCadence(intel.cadenceDays)
  const leadTime =
    intel.avgLeadTimeDays === null
      ? null
      : `${Math.max(1, Math.round(intel.avgLeadTimeDays))} day${
          Math.round(intel.avgLeadTimeDays) === 1 ? '' : 's'
        } ahead`
  const pattern = [intel.preferredDay, intel.preferredTimeOfDay]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card variant="glass" padding="md">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <IntelStat
          label="Lifetime value (you)"
          value={moneyLabel(intel.lifetimeValue.withYou)}
          hint={`${moneyLabel(intel.lifetimeValue.platform)} platform-wide`}
        />
        <IntelStat
          label="Visits with you"
          value={String(intel.completedVisitsWithYou)}
          hint={`${intel.completedVisits} platform-wide`}
        />
        <IntelStat
          label="Cadence"
          value={cadence ?? '—'}
          hint={
            intel.daysSinceLastVisit === null
              ? undefined
              : `${intel.daysSinceLastVisit} days since last visit`
          }
        />
        <IntelStat label="Lead time" value={leadTime ?? '—'} />
        <IntelStat
          label="Pattern"
          value={pattern || '—'}
          hint={intel.cancelCount ? `${intel.cancelCount} cancelled` : undefined}
        />
        <IntelStat
          label="Rebooking"
          value={
            intel.hasUpcoming
              ? 'Booked'
              : intel.retentionRisk
                ? 'At risk'
                : intel.lastVisitAt
                  ? 'Lapsing'
                  : '—'
          }
          hint={
            intel.daysUntilBirthday !== null && intel.daysUntilBirthday <= 30
              ? `Birthday in ${intel.daysUntilBirthday}d`
              : undefined
          }
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-textSecondary">
        {intel.preferredContactMethod ? (
          <span>
            Prefers{' '}
            <span className="font-black text-textPrimary">
              {intel.preferredContactMethod}
            </span>
          </span>
        ) : null}
        {referralSource ? (
          <span>
            Source:{' '}
            <span className="font-black text-textPrimary">{referralSource}</span>
          </span>
        ) : null}
      </div>
    </Card>
  )
}

function tabContent(args: {
  tab: ChartTab
  client: ClientDetailRecord
  proId: string
  bookingRowsAll: BookingRow[]
  bookingRowsFiltered: BookingRow[]
  bookingFilter: BookingFilter
  bookingQ: string
  productRecs: ProductRecommendationRow[]
  clientLeftReviews: ClientLeftReviewRow[]
  proFeedback: ProFeedbackRow[]
  photoVisits: TimelineVisit[]
  technicalRecord: TechnicalRecordData | null
  now: Date
  tz: string
}): ReactNode {
  const { tab, client, proId, tz } = args

  switch (tab) {
    case 'allergies':
      return (
        <SectionCard
          id="allergies"
          title="Allergies & sensitivities"
          subtitle="Anything that could cause a reaction or needs extra care. The “do not fry their scalp” section."
        >
          <div className="mb-4">
            <NewAllergyForm clientId={client.id} />
          </div>

          <ClientAllergiesList client={client} tz={tz} />
        </SectionCard>
      )
    case 'history':
      return (
        <SectionCard
          id="history"
          title="Service history"
          subtitle="Search and filter all bookings for this client."
          right={
            <BookingFilterForm
              clientId={client.id}
              bookingFilter={args.bookingFilter}
              bookingQ={args.bookingQ}
            />
          }
        >
          <ServiceHistoryList
            bookingRowsFiltered={args.bookingRowsFiltered}
            bookingRowsAll={args.bookingRowsAll}
            proId={proId}
            tz={tz}
          />
        </SectionCard>
      )
    case 'products':
      return (
        <SectionCard
          id="products"
          title="Products recommended"
          subtitle="Recommendations tied to aftercare entries."
        >
          <ProductRecommendationsList productRecs={args.productRecs} tz={tz} />
        </SectionCard>
      )
    case 'reviews-left':
      return (
        <SectionCard
          id="reviews-left"
          title="Reviews they left"
          subtitle="All reviews this client has left (across any professional)."
        >
          <ClientLeftReviewsList reviews={args.clientLeftReviews} tz={tz} />
        </SectionCard>
      )
    case 'pro-feedback':
      return (
        <SectionCard
          id="pro-feedback"
          title="Pro feedback"
          subtitle="Notes from professionals who serviced this client in the past (shared with pros)."
        >
          <ProFeedbackList feedback={args.proFeedback} tz={tz} />
        </SectionCard>
      )
    case 'photos':
      return (
        <SectionCard
          id="photos"
          title="Before / after photos"
          subtitle="Per-visit gallery. Your own craft is always here; another pro's photos appear only when the client has shared them publicly."
        >
          <PhotoTimeline visits={args.photoVisits} tz={tz} />
        </SectionCard>
      )
    case 'technical':
      return args.technicalRecord ? (
        <TechnicalRecordTab
          clientId={client.id}
          data={args.technicalRecord}
          now={args.now}
          tz={tz}
        />
      ) : null
    case 'notes':
    default:
      return (
        <SectionCard
          id="notes"
          title="Pro notes"
          subtitle="Private notes visible to you (and admins). Preferences, patterns, and anything you don’t want to forget."
        >
          <div className="mb-4">
            <NewNoteForm clientId={client.id} />
          </div>

          <ClientNotesList client={client} tz={tz} />
        </SectionCard>
      )
  }
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

  const accessUntil = gate.visibility.accessUntil
  const messageHref = buildProToClientMessageHref({ proId, clientId })

  // Display every date in the pro's business timezone (not the server zone,
  // which is UTC on Vercel and would render evening appointments on the wrong day).
  const scheduleTz = await resolveProScheduleTimeZone(
    proId,
    user.professionalProfile.timeZone,
  )

  const searchParams =
    (await props.searchParams?.catch(() => ({} as SearchParams))) ??
    ({} as SearchParams)

  const view = normalizeView(firstParam(searchParams.view))
  const technicalEnabled = isClientTechnicalRecordEnabled(proId)
  const requestedTab = normalizeTab(firstParam(searchParams.tab))
  // The technical tab only exists when the flag is on; otherwise fall back to notes
  // (so a stale deep-link never queries the not-yet-migrated tables).
  const tab: ChartTab =
    requestedTab === 'technical' && !technicalEnabled ? 'notes' : requestedTab
  const now = new Date()

  // ---- Public-profile mode: render what the world sees (or an empty state). ----
  if (view === 'public') {
    const publicData = await loadPublicClientProfileByClientId(clientId)

    return (
      <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8 text-textPrimary">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/pro/clients"
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
          >
            ← Back to clients
          </Link>

          <WindowCountdownBadge accessUntil={accessUntil} now={now} tz={scheduleTz} />
        </div>

        <div className="mb-6">
          <ViewToggle clientId={clientId} view={view} tab={tab} />
        </div>

        {publicData ? (
          <PublicProfileView
            data={publicData}
            followMode="hidden"
            loginHref=""
          />
        ) : (
          <Card variant="glass" padding="lg">
            <div className="grid gap-1 text-center">
              <div className="text-[15px] font-black text-textPrimary">
                No public profile yet
              </div>
              <div className="text-[12px] font-semibold text-textSecondary">
                This client hasn&apos;t made a public profile yet.
              </div>
            </div>
          </Card>
        )}
      </main>
    )
  }

  // ---- Chart mode. ----
  // One bookings query powers the header, relationship intelligence, AND the
  // history tab (filtered in-memory). Heavy per-tab list queries only run for the
  // active tab. Cheap counts run always (they feed the safety/intelligence zone).
  const [client, bookingRowsAll, reviewCount, referredCount, wasReferred] =
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
        where: { clientId },
        orderBy: { scheduledFor: 'desc' },
        take: 2000,
        select: BOOKING_ROW_SELECT,
      }),
      prisma.review.count({ where: { clientId, ...visibleReviewsWhere } }),
      prisma.referral.count({
        where: {
          referrerClientId: clientId,
          status: { in: ['CONFIRMED', 'CONVERTED', 'REWARDED'] },
        },
      }),
      prisma.referral
        .count({ where: { referredClientId: clientId } })
        .then((count) => count > 0),
    ])

  if (!client) redirect('/pro/clients')

  const intel = computeRelationshipIntelligence({
    bookings: toIntelBookings(bookingRowsAll, scheduleTz),
    proId,
    now,
    reviewCount,
    noteCount: client.notes.length,
    referredCount,
    wasReferred,
    dateOfBirth: client.dateOfBirth ?? null,
    preferredContactMethod: client.preferredContactMethod ?? null,
  })
  const referralSource = wasReferred ? 'Referred by a client' : null

  // Author-scoped extras (client.notes is already scoped to professionalId: proId).
  const { doNotRebook } = partitionNotesByKind(client.notes)
  const doNotRebookNote = doNotRebook[0] ?? null
  const occupation = readEncryptedNoteOrFallback(client.occupationEncrypted, null)
  const socialHandle = client.proCapturedSocialHandle ?? null

  const totalVisits = bookingRowsAll.length
  const lastVisit = totalVisits ? bookingRowsAll[0] : null
  const upcoming = upcomingBookingFromRows(bookingRowsAll)

  const email = client.user?.email || ''
  const phone = client.phone || ''

  // History-tab inputs (filter the already-loaded set; no extra query).
  const bookingQ = firstParam(searchParams.q).trim()
  const bookingFilter = normalizeBookingFilter(
    firstParam(searchParams.bookingFilter),
  )

  let myServiceIds: string[] = []
  let bookingRowsFiltered: BookingRow[] = []
  if (tab === 'history') {
    if (bookingFilter === 'MATCHES_MY_SERVICES') {
      const myOfferings = await prisma.professionalServiceOffering.findMany({
        where: { professionalId: proId, isActive: true },
        select: { serviceId: true },
        take: 500,
      })
      myServiceIds = myOfferings.map((o) => o.serviceId).filter(Boolean)
    }
    const matched = bookingRowsAll.filter((booking) =>
      bookingMatchesFilter(booking, { bookingFilter, proId, myServiceIds, now }),
    )
    bookingRowsFiltered = filterBookingsBySearch({
      rows: matched,
      query: bookingQ,
      tz: scheduleTz,
    })
  }

  // Per-tab heavy queries — only the active tab pays for its data.
  let productRecs: ProductRecommendationRow[] = []
  let clientLeftReviews: ClientLeftReviewRow[] = []
  let proFeedback: ProFeedbackRow[] = []
  let photoVisits: TimelineVisit[] = []
  let technicalRecord: TechnicalRecordData | null = null

  if (tab === 'products') {
    productRecs = await prisma.productRecommendation.findMany({
      where: { aftercareSummary: { booking: { clientId } } },
      select: PRODUCT_REC_SELECT,
      take: 2000,
    })
  } else if (tab === 'reviews-left') {
    clientLeftReviews = await prisma.review.findMany({
      where: { clientId, ...visibleReviewsWhere },
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: CLIENT_LEFT_REVIEW_SELECT,
    })
  } else if (tab === 'pro-feedback') {
    proFeedback = await prisma.clientProfessionalNote.findMany({
      where: { clientId, visibility: 'PROFESSIONALS_ONLY' },
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: PRO_FEEDBACK_SELECT,
    })
  } else if (tab === 'photos') {
    photoVisits = await loadPhotoTimeline(clientId, proId)
  } else if (tab === 'technical' && technicalEnabled) {
    // Flag-gated: only path that touches the PR4 tables/columns.
    technicalRecord = await loadTechnicalRecord(clientId, proId)
  }

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8 text-textPrimary">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/pro/clients"
          className={buttonClassName({ variant: 'ghost', size: 'sm' })}
        >
          ← Back to clients
        </Link>

        <WindowCountdownBadge accessUntil={accessUntil} now={now} tz={scheduleTz} />
      </div>

      <div className="mb-6">
        <ViewToggle clientId={clientId} view={view} tab={tab} />
      </div>

      <header className="tovis-glass mb-4 rounded-card border border-white/10 bg-bgSecondary p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-[22px] font-black text-textPrimary">
              <ClientNameLink canLink clientId={client.id}>
                {client.firstName} {client.lastName}
              </ClientNameLink>
            </h1>

            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              {email ? email : 'No email on file'}
              {phone ? ` • ${phone}` : ''}
            </div>
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
                    {formatDate(
                      lastVisit.scheduledFor,
                      resolveAppointmentDisplayTimeZone(
                        lastVisit.locationTimeZone,
                        scheduleTz,
                      ),
                    )}
                  </span>
                </div>
              ) : null}

              {upcoming ? (
                <div>
                  Next booking:{' '}
                  <span className="font-black text-textPrimary">
                    {formatDate(
                      upcoming.scheduledFor,
                      resolveAppointmentDisplayTimeZone(
                        upcoming.locationTimeZone,
                        scheduleTz,
                      ),
                    )}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 md:justify-end">
              <Link
                href={messageHref}
                className={buttonClassName({ variant: 'ghost', size: 'sm' })}
              >
                Message
              </Link>

              <Link
                href={`/pro/bookings/new?clientId=${encodeURIComponent(
                  client.id,
                )}`}
                className={buttonClassName({ variant: 'primary', size: 'sm' })}
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

      {/* Pinned safety strip — always above the tabs, regardless of active tab. */}
      <div className="mb-4">
        <SafetyStrip client={client} />
      </div>

      {doNotRebookNote ? (
        <div className="mb-4">
          <DoNotRebookBanner note={doNotRebookNote} />
        </div>
      ) : null}

      <div className="mb-4">
        <SmartFlagsStrip flags={intel.flags} />
      </div>

      <div className="mb-6">
        <RelationshipIntelligenceCard
          intel={intel}
          referralSource={referralSource}
        />
      </div>

      {/* Pro-captured context + author-only do-not-rebook control. */}
      <div className="mb-6">
        <Card variant="glass" padding="md">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-[11px] font-black uppercase tracking-[0.08em] text-textSecondary">
                Context
              </div>
              <EditProfileContextForm
                clientId={client.id}
                initialOccupation={occupation}
                initialSocialHandle={socialHandle}
              />
            </div>
            <div className="grid gap-2">
              <div className="text-[11px] font-black uppercase tracking-[0.08em] text-textSecondary">
                Rebooking
              </div>
              <EditDoNotRebookForm
                clientId={client.id}
                initialActive={Boolean(doNotRebookNote)}
                initialReason={doNotRebookNote?.body ?? null}
              />
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-6">
        <TabNav
          clientId={client.id}
          activeTab={tab}
          technicalEnabled={technicalEnabled}
        />
      </div>

      <div className="grid gap-6">
        {tabContent({
          tab,
          client,
          proId,
          bookingRowsAll,
          bookingRowsFiltered,
          bookingFilter,
          bookingQ,
          productRecs,
          clientLeftReviews,
          proFeedback,
          photoVisits,
          technicalRecord,
          now,
          tz: scheduleTz,
        })}
      </div>
    </main>
  )
}
