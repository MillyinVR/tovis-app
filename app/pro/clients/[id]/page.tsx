// app/pro/clients/[id]/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import type { PhotoReleaseStatus } from '@prisma/client'
import type { ReactNode } from 'react'

import ClientProfileLink from '@/app/_components/ClientProfileLink'
import {
  CLIENT_LINK_SELECT,
  clientPublicHandle,
  clientPublicProfileHref,
} from '@/lib/profiles/profileHrefs'
import { prisma } from '@/lib/prisma'
import { visibleReviewsWhere } from '@/lib/reviews/visibility'
import { getCurrentUser } from '@/lib/currentUser'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import {
  computeRelationshipIntelligence,
  daysLeftInWindow,
  formatRelationshipIntelligence,
  type IntelBooking,
  type RelationshipIntelligence,
} from '@/lib/clients/relationshipIntelligence'
import { renderMediaUrlsBatch } from '@/lib/media/renderUrls'
import { readEncryptedNoteOrFallback } from '@/lib/security/notesPrivacy'
import {
  CHART_TABS,
  normalizeChartTab,
  type ChartTab,
} from '@/lib/clients/chartTabs'
import {
  CHART_BOOKING_FILTER_NONE,
  CHART_BOOKING_HISTORY_TAKE,
  chartBookingWhere,
  chartNoShowCountWhere,
  isChartBookingFilterActive,
  parseChartBookingFilter,
  type ChartBookingFilter,
} from '@/lib/clients/chartBookingSelect'
import {
  CHART_VISIT_SELECT,
  normalizeVisitFilter,
  resolveVisitChartFilter,
  retiredVisitFilterParams,
  visitMatchesFilter,
  type ChartVisitRow,
  type VisitFilter,
} from '@/lib/clients/chartVisitFilters'
import { CHART_PHOTO_TAKE, chartPhotoWhere } from '@/lib/clients/chartPhotoQuery'
import { comparePhotoPhase } from '@/lib/proBookingMedia'
import { partitionNotesByKind } from '@/lib/clients/clientNoteKinds'
import {
  isClientTechnicalRecordEnabled,
  isPatchTestCurrent,
} from '@/lib/clients/technicalRecord'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import {
  loadTechnicalRecord,
  type FormulaView,
  type ConsentView,
  type TechnicalRecordData,
} from '@/lib/clients/technicalRecordLoader'
import { formatDateShortInTimeZone, formatInTimeZone } from '@/lib/time'
import { resolveProScheduleTimeZone } from '@/lib/proLocations/resolveProScheduleTimeZone'
import { resolveAppointmentDisplayTimeZone } from '@/lib/booking/appointmentDisplayTimeZone'
import { formatProfessionalPublicSearchText } from '@/lib/privacy/professionalDisplayName'
import {
  formatClientName,
  formatPublicProfileDisplayName,
} from '@/lib/profiles/publicProfileFormatting'
import { loadChartShare } from '@/lib/clients/chartShare'
import { loadPublicClientProfileByClientId } from '@/app/u/[handle]/_data/loadPublicClientProfile'
import PublicProfileView from '@/app/u/[handle]/_components/PublicProfileView'
import ProConsultBrief from '@/app/pro/_components/consult/ProConsultBrief'
import {
  loadAuthorizedProConsultBriefs,
  ProConsultBriefError,
} from '@/lib/consult/proBrief'
import type { ConsultProBriefDTO } from '@/lib/dto/consult'

import ChartAccessRefusedView from './ChartAccessRefusedView'
import VisitFilterForm from './VisitFilterForm'
import VisitHistoryList, {
  type VisitPhoto,
  type VisitPhotosByBooking,
} from './VisitHistoryList'
import EditAlertBannerForm from './EditAlertBannerForm'
import EditDoNotRebookForm from './EditDoNotRebookForm'
import EditClientPolicyForm from './EditClientPolicyForm'
import EditPhotoReleaseForm from './EditPhotoReleaseForm'
import EditProfileContextForm from './EditProfileContextForm'
import NewAllergyForm from './NewAllergyForm'
import NewConsentForm from './NewConsentForm'
import SendConsentFormButton from './SendConsentFormButton'
import NewFormulaForm from './NewFormulaForm'
import NewNoteForm from './NewNoteForm'
import { Badge, Card, buttonClassName } from '@/app/_components/ui'
import type { BadgeTone } from '@/app/_components/ui'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

type ChartView = 'chart' | 'public'

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

// A visit's before/after frames. Own craft (professionalId === pro) is always
// visible to the authoring pro; another pro's craft photos stay private to their
// author and only surface here once the CLIENT promotes them via a review
// (reviewId set → PUBLIC), which is world-public anyway — `chartPhotoWhere`
// holds that matrix. See design doc access matrix + lib/media/publicShareGuard.ts.
//
// Only the columns a rendered tile needs: the visit's date, service and pro all
// come from the booking row the photos now hang off, so re-reading them here
// would be a second copy that could disagree with the card it sits inside.
const VISIT_MEDIA_SELECT = {
  id: true,
  bookingId: true,
  phase: true,
  caption: true,
  storageBucket: true,
  storagePath: true,
  thumbBucket: true,
  thumbPath: true,
  url: true,
  thumbUrl: true,
} satisfies Prisma.MediaAssetSelect

type ClientDetailRecord = Prisma.ClientProfileGetPayload<{
  select: typeof CLIENT_DETAIL_SELECT
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

function normalizeView(raw: unknown): ChartView {
  return String(raw || '').trim().toLowerCase() === 'public' ? 'public' : 'chart'
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

function formatShortDate(value: Date, tz: string): string {
  return formatInTimeZone(value, tz, { month: 'short', day: 'numeric' })
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

function allergyTone(severity: unknown): BadgeTone {
  const value = safeUpper(severity)
  return value === 'CRITICAL' || value === 'HIGH' ? 'danger' : 'warn'
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

function buildBookingSearchIndex(booking: ChartVisitRow, tz: string): string {
  const parts = [
    booking.service?.name,
    booking.service?.category?.name,
    formatProfessionalPublicSearchText(booking.professional),
    booking.status,
    booking.aftercareSummary?.notes,
    String(booking.totalDurationMinutes ?? ''),
    String(booking.totalAmount ?? booking.subtotalSnapshot ?? ''),
    booking.scheduledFor
      ? formatDateShortInTimeZone(
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

function upcomingBookingFromRows(rows: ChartVisitRow[]): ChartVisitRow | null {
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
  rows: ChartVisitRow[]
  query: string
  tz: string
}): ChartVisitRow[] {
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
  rows: ChartVisitRow[],
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

// The client's before/after frames, grouped onto the visit each belongs to.
//
// ONE query for the whole chart — never one per booking — and the same
// `chartPhotoWhere` the native chart API uses, so the access matrix (own craft
// always; another pro's only once the CLIENT promoted it) cannot be enforced by
// half the app. A photo with no `bookingId` (a Look, a portfolio upload) belongs
// to no visit and is correctly absent.
async function loadVisitPhotosByBooking(
  clientId: string,
  proId: string,
): Promise<VisitPhotosByBooking> {
  const rows = await prisma.mediaAsset.findMany({
    where: chartPhotoWhere({ clientId, proId }),
    orderBy: { createdAt: 'desc' },
    take: CHART_PHOTO_TAKE,
    select: VISIT_MEDIA_SELECT,
  })

  // ONE `createSignedUrls` round-trip per private bucket, not two per asset.
  // The per-item `renderMediaUrls` this used to call is an N+1 waterfall at a
  // take of CHART_PHOTO_TAKE, and it now runs on the visits view a pro opens to
  // read history rather than on an opt-in Photos tab.
  const rendered = await renderMediaUrlsBatch(rows)

  const byBooking = new Map<string, VisitPhoto[]>()

  for (const [index, row] of rows.entries()) {
    const bookingId = row.bookingId
    if (!bookingId) continue

    // No renderable URL ⇒ no tile. The old timeline rendered a "No preview"
    // placeholder box instead, which said nothing the pro could act on.
    const urls = rendered[index]
    const imageUrl = urls?.renderThumbUrl ?? urls?.renderUrl
    if (!imageUrl) continue

    const photo: VisitPhoto = {
      id: row.id,
      phase: row.phase,
      caption: row.caption,
      imageUrl,
    }

    const bucket = byBooking.get(bookingId)
    if (bucket) bucket.push(photo)
    else byBooking.set(bookingId, [photo])
  }

  for (const bucket of byBooking.values()) {
    bucket.sort((a, b) => comparePhotoPhase(a.phase, b.phase))
  }

  return byBooking
}

type ClientNoteRow = ClientDetailRecord['notes'][number]

function NoteCard({ note, tz }: { note: ClientNoteRow; tz: string }) {
  return (
    <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 truncate text-[13px] font-black text-textPrimary">
          {note.title || 'Note'}
        </div>

        <div className="shrink-0 text-[11px] font-semibold text-textSecondary">
          {formatDateShortInTimeZone(note.createdAt, tz)}
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
      <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
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
      <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
        No allergies recorded yet.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {client.allergies.map((allergy) => (
        <div
          key={allergy.id}
          className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4"
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
            Recorded {formatDateShortInTimeZone(allergy.createdAt, tz)}
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

function ProductRecommendationsList({
  productRecs,
  tz,
}: {
  productRecs: ProductRecommendationRow[]
  tz: string
}) {
  if (productRecs.length === 0) {
    return (
      <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
        No product recommendations recorded yet.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {sortProductRecommendations(productRecs).map((recommendation) => (
        <div
          key={recommendation.id}
          className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4"
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
              {formatDateShortInTimeZone(
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
      <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
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
            className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4"
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
                {formatDateShortInTimeZone(review.createdAt, tz)}
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
      <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
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
            className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4"
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
                {formatDateShortInTimeZone(note.createdAt, tz)}
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
      <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
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
            className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4"
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0 truncate text-[13px] font-black text-textPrimary">
                {entry.serviceName ?? 'Formula'}
              </div>
              <div className="shrink-0 text-[11px] font-semibold text-textSecondary">
                {entry.when
                  ? formatDateShortInTimeZone(
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
      <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
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
            className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4"
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
                  ? formatDateShortInTimeZone(
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
                Valid until {formatDateShortInTimeZone(record.validUntil, tz)}{' '}
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
                {record.signedAt ? ` • signed ${formatDateShortInTimeZone(record.signedAt, tz)}` : ''}
                {record.proofRef ? ` • ref ${record.proofRef}` : ''}
              </div>
            ) : null}

            {record.formVersion ? (
              <details className="mt-2 rounded-card border border-surfaceGlass/10 bg-bgSecondary p-2">
                <summary className="cursor-pointer text-[12px] font-black text-textPrimary">
                  {record.formVersion.title}{' '}
                  <span className="font-semibold text-textSecondary">
                    · v{record.formVersion.version} ·{' '}
                    {record.formVersion.originLabel}
                  </span>
                </summary>
                {/* The words as signed. This version can never be edited — the
                    pro publishes a new one, and this record keeps pointing here. */}
                <div className="mt-2 whitespace-pre-wrap text-[12px] font-semibold text-textSecondary">
                  {record.formVersion.body}
                </div>
              </details>
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
        {/* K15 — the pro sends the form; the CLIENT signs it. Above the manual
            record entry because it is the honest path: this one produces a
            signature the platform witnessed, that one records one the pro did. */}
        <div className="mb-4">
          <SendConsentFormButton
            clientId={clientId}
            forms={data.consentForms}
          />
        </div>

        <div className="mb-4">
          <NewConsentForm clientId={clientId} forms={data.consentForms} />
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
      className="inline-flex rounded-full border border-surfaceGlass/10 bg-bgPrimary p-1"
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
      <div className="text-[11px] font-black uppercase tracking-widest text-textSecondary">
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
  hint?: string | null
}) {
  return (
    <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-3">
      <div className="text-[10px] font-black uppercase tracking-widest text-textSecondary">
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
  // Shared formatter — the same bundle the native chart's wire block carries, so
  // both platforms render identical copy from one source of truth.
  const labels = formatRelationshipIntelligence(intel, referralSource)

  return (
    <Card variant="glass" padding="md">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <IntelStat
          label="Lifetime value (you)"
          value={labels.lifetimeValue.value}
          hint={labels.lifetimeValue.hint}
        />
        <IntelStat
          label="Visits with you"
          value={labels.visits.value}
          hint={labels.visits.hint}
        />
        <IntelStat
          label="Cadence"
          value={labels.cadence.value}
          hint={labels.cadence.hint}
        />
        <IntelStat label="Lead time" value={labels.leadTime.value} />
        <IntelStat
          label="Pattern"
          value={labels.pattern.value}
          hint={labels.pattern.hint}
        />
        <IntelStat
          label="Rebooking"
          value={labels.rebooking.value}
          hint={labels.rebooking.hint}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-textSecondary">
        {labels.preferredContactMethod ? (
          <span>
            Prefers{' '}
            <span className="font-black text-textPrimary">
              {labels.preferredContactMethod}
            </span>
          </span>
        ) : null}
        {labels.referralSource ? (
          <span>
            Source:{' '}
            <span className="font-black text-textPrimary">
              {labels.referralSource}
            </span>
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
  bookingRowsAll: ChartVisitRow[]
  bookingRowsFiltered: ChartVisitRow[]
  visitFilter: VisitFilter
  chartFilter: ChartBookingFilter
  bookingQ: string
  photosByBooking: VisitPhotosByBooking
  productRecs: ProductRecommendationRow[]
  clientLeftReviews: ClientLeftReviewRow[]
  proFeedback: ProFeedbackRow[]
  technicalRecord: TechnicalRecordData | null
  consultBriefs: ConsultProBriefDTO[]
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
        <div className="grid gap-6">
          {args.consultBriefs.length ? (
            <SectionCard
              id="consult-history"
              title="Consult history"
              subtitle="Dated client-owned consult briefs, newest first."
            >
              <div className="grid gap-6">
                {args.consultBriefs.map((brief) => (
                  <ProConsultBrief
                    key={brief.consultId}
                    brief={brief}
                    timeZone={tz}
                    showDate
                    feedbackEnabled={brief.professionalId === proId}
                  />
                ))}
              </div>
            </SectionCard>
          ) : null}
          <SectionCard
            id="history"
            title="Visits"
            subtitle="Every booking for this client, with that visit's before/after photos on the card. Your own craft is always here; another pro's photos appear only when the client has shared them publicly."
            right={
              <VisitFilterForm
                clearHref={chartHref({ clientId: client.id, tab: 'history' })}
                visitFilter={args.visitFilter}
                chartFilter={args.chartFilter}
                bookingQ={args.bookingQ}
              />
            }
          >
            <VisitHistoryList
              bookingRowsFiltered={args.bookingRowsFiltered}
              bookingRowsAll={args.bookingRowsAll}
              photosByBooking={args.photosByBooking}
              proId={proId}
              tz={tz}
            />
          </SectionCard>
        </div>
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

  if (!gate.ok) {
    // CONTACT_ONLY: this pro knows the client (a thread, a booking) but the
    // chart isn't shared. They get an honest refusal WITH a way to ask, instead
    // of the silent bounce this page used to do. A pro with no relationship at
    // all still gets the flat redirect — naming the client would confirm the id.
    if (!gate.visibility.canContactClient) redirect('/pro/clients')

    const contactClient = await prisma.clientProfile.findUnique({
      where: { id: clientId },
      select: {
        firstName: true, // pii-plaintext-read-ok: CONTACT tier IS "may see who they are"
        lastName: true, // pii-plaintext-read-ok: CONTACT tier IS "may see who they are"
        ...CLIENT_LINK_SELECT,
      },
    })

    // The gate said contact is allowed, so the row exists; a race that deletes
    // it between the two reads degrades to the stranger path, not to a screen
    // that names nobody.
    if (!contactClient) redirect('/pro/clients')

    return (
      <ChartAccessRefusedView
        clientId={clientId}
        clientName={formatClientName(contactClient)}
        share={await loadChartShare({ clientId, professionalId: proId })}
        messageHref={buildProToClientMessageHref({ proId, clientId })}
        // The chart is refused; the client's PUBLIC page is a different thing
        // and the whole internet can already read it. Offering it here is what
        // stops this screen being a dead end for a pro who tapped a name — and
        // it is null, so nothing renders, for a client with no public profile.
        publicProfileHref={clientPublicProfileHref(contactClient)}
        now={new Date()}
      />
    )
  }

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
  const requestedTab = normalizeChartTab(firstParam(searchParams.tab))
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
            // No Block control here. This is the pro's own CLIENT CHART — an
            // existing working relationship, reached from their client list,
            // not a discovery surface. Blocking a client you have bookings
            // with is a support/relationship question, not a one-tap feed
            // control. The pro can still block from the public /u/[handle].
            block={null}
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
  // The unnarrowed bookings query powers the header AND relationship
  // intelligence, and doubles as the visits list when nothing was filtered.
  // Heavy per-tab list queries only run for the active tab. Cheap counts run
  // always (they feed the safety/intelligence zone).
  const [
    client,
    bookingRowsAll,
    noShowCount,
    reviewCount,
    referredCount,
    wasReferred,
  ] = await Promise.all([
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
    // The WHOLE history — it powers the header counts and relationship
    // intelligence as well as the history tab, so it must never be narrowed.
    prisma.booking.findMany({
      where: { clientId },
      orderBy: { scheduledFor: 'desc' },
      take: CHART_BOOKING_HISTORY_TAKE,
      select: CHART_VISIT_SELECT,
    }),
    // Cross-professional by design — see `chartNoShowCountWhere`. Counted in
    // Prisma rather than off `bookingRowsAll`, which is capped at
    // CHART_BOOKING_HISTORY_TAKE and would under-report on a long record.
    prisma.booking.count({ where: chartNoShowCountWhere({ clientId }) }),
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

  // K16 — this pro's booking requirements for this client. Read raw (not through
  // `loadProClientPolicy`) because the CONTROL must show what is STORED: the
  // resolver applies the card-on-file rail gate, and a switch the pro turned on
  // must not silently read as off in the very form they set it in. The rail flag
  // is passed separately so the control can disable that one row instead.
  const clientPolicy = technicalEnabled
    ? await prisma.proClientPolicy.findUnique({
        where: {
          professionalId_clientId: { professionalId: proId, clientId: client.id },
        },
        select: {
          requireDeposit: true,
          prepayScope: true,
          requireCardOnFile: true,
          blockSelfServeBooking: true,
        },
      })
    : null

  const totalVisits = bookingRowsAll.length
  const lastVisit = totalVisits ? bookingRowsAll[0] : null
  const upcoming = upcomingBookingFromRows(bookingRowsAll)

  const email = client.user?.email || ''
  const phone = client.phone || ''

  // Visits-view inputs. `status` / `withMe` are the SERVER-side pair the native
  // chart shares, and the view's own Status select / "Only with me" checkbox now
  // submit them, so those two axes narrow in Prisma. `q` and what is left of
  // `bookingFilter` still filter in memory — none of the three has a
  // `chartBookingWhere` equivalent. An unrecognized status has no way to be
  // answered with a 400 here, so the page falls back to showing everything.
  const bookingQ = firstParam(searchParams.q).trim()
  const rawVisitFilter = firstParam(searchParams.bookingFilter)
  const visitFilter = normalizeVisitFilter(rawVisitFilter)
  const parsedChartFilter = parseChartBookingFilter((key) =>
    firstParam(searchParams[key]),
  )
  // A `bookingFilter` that MOVED to the server params still has to mean what it
  // meant — a saved `?bookingFilter=COMPLETED` link must not hand back every
  // visit under a heading that says completed.
  const chartFilter: ChartBookingFilter = resolveVisitChartFilter({
    parsed: parsedChartFilter.ok
      ? parsedChartFilter.filter
      : CHART_BOOKING_FILTER_NONE,
    retired: retiredVisitFilterParams(rawVisitFilter),
  })

  let myServiceIds: string[] = []
  let bookingRowsFiltered: ChartVisitRow[] = []
  if (tab === 'history') {
    if (visitFilter === 'MATCHES_MY_SERVICES') {
      const myOfferings = await prisma.professionalServiceOffering.findMany({
        where: { professionalId: proId, isActive: true },
        select: { serviceId: true },
        take: 500,
      })
      myServiceIds = myOfferings.map((o) => o.serviceId).filter(Boolean)
    }
    // Narrowed in Prisma when asked for; otherwise the set already in hand.
    const historyRows = isChartBookingFilterActive(chartFilter)
      ? await prisma.booking.findMany({
          where: chartBookingWhere({ clientId, proId, filter: chartFilter }),
          orderBy: { scheduledFor: 'desc' },
          take: CHART_BOOKING_HISTORY_TAKE,
          select: CHART_VISIT_SELECT,
        })
      : bookingRowsAll
    const matched = historyRows.filter((booking) =>
      visitMatchesFilter(booking, {
        filter: visitFilter,
        myServiceIds,
        now,
      }),
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
  let photosByBooking: VisitPhotosByBooking = new Map()
  let technicalRecord: TechnicalRecordData | null = null
  let consultBriefs: ConsultProBriefDTO[] = []

  if (tab === 'history') {
    // In parallel: the photo fan-out signs one URL per frame over the network,
    // so running it behind the brief query would make the merged visits view
    // slower than either of the two tabs it replaced.
    ;[consultBriefs, photosByBooking] = await Promise.all([
      loadAuthorizedProConsultBriefs({
        professionalId: proId,
        clientId,
      }).catch((error: unknown) => {
        if (
          error instanceof ProConsultBriefError &&
          (error.code === 'HIDDEN' || error.code === 'NOT_FOUND')
        ) {
          return []
        }
        throw error
      }),
      loadVisitPhotosByBooking(clientId, proId),
    ])
  }

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

      <header className="tovis-glass mb-4 rounded-card border border-surfaceGlass/10 bg-bgSecondary p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-[22px] font-black text-textPrimary">
              {/* The chart IS this page, so linking the name back to it was a
                  self-link that did nothing. It now leads to the client's
                  public profile — or renders as plain text when they have
                  none, which is most clients. */}
              <ClientProfileLink
                href={clientPublicProfileHref(client)}
                label={formatClientName(client)}
                // Only when there IS one — `title` is rendered in the inert
                // case too, and a tooltip promising a profile that doesn't
                // exist is exactly the dead end this change removes.
                title={
                  clientPublicHandle(client)
                    ? `View @${clientPublicHandle(client)}'s public profile`
                    : undefined
                }
              >
                {client.firstName} {client.lastName}
              </ClientProfileLink>
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

              {/* Cross-professional, like the native chart's `noShowCount`: a
                  client who has stood up five OTHER pros must not read here as
                  never having no-showed. Tinted only when there is something to
                  flag — a zero in danger red would cry wolf on every chart. */}
              <div>
                No-shows:{' '}
                <span
                  className={
                    noShowCount > 0
                      ? 'font-black text-toneDanger'
                      : 'font-black text-textPrimary'
                  }
                >
                  {noShowCount}
                </span>
              </div>

              {lastVisit ? (
                <div>
                  Last booking:{' '}
                  <span className="font-black text-textPrimary">
                    {formatDateShortInTimeZone(
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
                    {formatDateShortInTimeZone(
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

              <div className="rounded-full border border-surfaceGlass/10 bg-bgPrimary px-3 py-2">
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
            {/* K16 — omitted entirely when the technical-record gate is off, the
                same way the technical tab is: the kill switch reaches the
                CONTROL, not only the write route. */}
            {technicalEnabled ? (
              <div className="grid gap-2">
                <div className="text-[11px] font-black uppercase tracking-[0.08em] text-textSecondary">
                  Booking requirements
                </div>
                <EditClientPolicyForm
                  clientId={client.id}
                  initialPolicy={clientPolicy}
                  cardOnFileRailEnabled={noShowProtectionEnabled()}
                />
              </div>
            ) : null}
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
          visitFilter,
          chartFilter,
          bookingQ,
          photosByBooking,
          productRecs,
          clientLeftReviews,
          proFeedback,
          technicalRecord,
          consultBriefs,
          now,
          tz: scheduleTz,
        })}
      </div>
    </main>
  )
}
