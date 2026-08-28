// app/api/v1/pro/clients/[id]/chart/route.ts
//
// Aggregate READ API for the client chart. The web `/pro/clients/[id]` page
// server-renders this from a big Prisma query; native has no read API for it.
// This returns the same chart data (header + safety/alert + allergies + notes +
// booking history + product recs + client-left reviews + pro feedback + photos +
// technical-record gate), respecting `assertProCanViewClient` and the founder
// technical-record flag. Decryption is applied for occupation only; encrypted
// technical notes are intentionally NOT returned (kept web-only). PRO-only.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { chartRefusal } from '@/lib/clients/chartAccessCopy'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { readEncryptedNoteOrFallback } from '@/lib/security/notesPrivacy'
import { partitionNotesByKind } from '@/lib/clients/clientNoteKinds'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import {
  computeRelationshipIntelligence,
  formatRelationshipIntelligence,
} from '@/lib/clients/relationshipIntelligence'
import { deriveRelationshipBadge } from '@/lib/booking/relationshipLabel'
import {
  CHART_BOOKING_HISTORY_TAKE,
  CHART_BOOKING_SELECT,
  chartBookingWhere,
  chartNoShowCountWhere,
  isChartBookingFilterActive,
  parseChartBookingFilter,
} from '@/lib/clients/chartBookingSelect'
import { CHART_PHOTO_TAKE, chartPhotoWhere } from '@/lib/clients/chartPhotoQuery'
import { comparePhotoPhase } from '@/lib/proBookingMedia'
import { resolveAppointmentDisplayTimeZone } from '@/lib/booking/appointmentDisplayTimeZone'
import { resolveProScheduleTimeZone } from '@/lib/proLocations/resolveProScheduleTimeZone'
import { decimalToNullableNumber } from '@/lib/booking/snapshots'
import { moneyToString } from '@/lib/money'
import { pickString } from '@/lib/pick'
import { visibleReviewsWhere } from '@/lib/reviews/visibility'

export const dynamic = 'force-dynamic'

const CLIENT_SELECT = {
  id: true,
  firstName: true, // pii-plaintext-read-ok: authorized pro client chart; plaintext-by-schema.
  lastName: true, // pii-plaintext-read-ok: authorized pro client chart; plaintext-by-schema.
  phone: true, // pii-plaintext-read-ok: authorized pro client chart; plaintext-by-schema.
  alertBanner: true,
  dateOfBirth: true, // pii-plaintext-read-ok: birthday on the authorized pro chart; plaintext-by-schema (no encrypted column).
  preferredContactMethod: true,
  occupationEncrypted: true,
  proCapturedSocialHandle: true,
  user: { select: { email: true } },
  allergies: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      label: true,
      severity: true,
      description: true,
      createdAt: true,
      recordedBy: { select: { businessName: true, firstName: true, lastName: true } },
    },
  },
  notes: {
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, body: true, kind: true, createdAt: true },
  },
} satisfies Prisma.ClientProfileSelect

// Booking history rows come from the shared chart select — the web chart page
// reads the SAME shape, so a column added for one surface can't go missing on
// the other (that drift is how this route came to lack K5's mark).
const BOOKING_SELECT = CHART_BOOKING_SELECT

const PRODUCT_SELECT = {
  id: true,
  note: true,
  externalName: true,
  product: { select: { name: true, brand: true } },
} satisfies Prisma.ProductRecommendationSelect

const REVIEW_SELECT = {
  id: true,
  rating: true,
  headline: true,
  body: true,
  createdAt: true,
  professional: { select: { businessName: true, firstName: true, lastName: true } },
} satisfies Prisma.ReviewSelect

const FEEDBACK_SELECT = {
  id: true,
  title: true,
  body: true,
  createdAt: true,
  professional: { select: { businessName: true, firstName: true, lastName: true } },
} satisfies Prisma.ClientProfessionalNoteSelect

const PHOTO_SELECT = {
  id: true,
  bookingId: true,
  professionalId: true,
  phase: true,
  caption: true,
  createdAt: true,
  reviewId: true,
  storageBucket: true,
  storagePath: true,
  thumbBucket: true,
  thumbPath: true,
  url: true,
  thumbUrl: true,
  booking: { select: { scheduledFor: true, service: { select: { name: true } } } },
} satisfies Prisma.MediaAssetSelect

function proName(p: { businessName: string | null; firstName: string | null; lastName: string | null } | null): string {
  if (!p) return 'Professional'
  const business = pickString(p.businessName)
  if (business) return business
  const name = [pickString(p.firstName), pickString(p.lastName)].filter(Boolean).join(' ').trim() // pii-plaintext-read-ok: pro display name; plaintext-by-schema.
  return name || 'Professional'
}

export async function GET(req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const params = await resolveRouteParams(ctx)
    const clientId = pickString(params?.id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    const gate = await assertProCanViewClient(proId, clientId)
    if (!gate.ok) {
      const refusal = chartRefusal(gate.visibility, 404)
      return jsonFail(refusal.status, refusal.message, { code: refusal.code })
    }

    // Optional history narrowing (`?status=COMPLETED&withMe=true`). Parsed
    // AFTER the access gate so a malformed param can never be an oracle about a
    // client this pro cannot see. Absent params ⇒ the whole history, exactly as
    // before this route learned to filter.
    const url = new URL(req.url)
    const parsedFilter = parseChartBookingFilter((key) => url.searchParams.get(key))
    if (!parsedFilter.ok) return jsonFail(400, parsedFilter.error)
    const filter = parsedFilter.filter
    const filterActive = isChartBookingFilterActive(filter)

    const technicalEnabled = isClientTechnicalRecordEnabled(proId)

    const [
      client,
      bookings,
      filteredBookings,
      noShowCount,
      reviewCount,
      products,
      clientLeftReviews,
      proFeedback,
      photoRows,
      referredCount,
      wasReferred,
      scheduleTz,
    ] = await Promise.all([
        prisma.clientProfile.findUnique({
          where: { id: clientId },
          select: {
            ...CLIENT_SELECT,
            // Only the authoring pro's own notes (mirrors the web chart query).
            notes: { where: { professionalId: proId }, orderBy: { createdAt: 'desc' }, select: CLIENT_SELECT.notes.select },
          },
        }),
        // The WHOLE history, unnarrowed, always. `header.bookingCount` and every
        // relationship-intelligence tile are statements about the client's
        // complete record — computing them off a filtered set would report a
        // lifetime value of one visit because the caller asked for one status.
        prisma.booking.findMany({
          where: { clientId },
          orderBy: { scheduledFor: 'desc' },
          take: CHART_BOOKING_HISTORY_TAKE,
          select: BOOKING_SELECT,
        }),
        // The narrowed list that `history[]` renders — a real Prisma `where`, not
        // an in-memory pass. Only runs when something was actually asked for, so
        // an unfiltered request still costs exactly one booking query.
        filterActive
          ? prisma.booking.findMany({
              where: chartBookingWhere({ clientId, proId, filter }),
              orderBy: { scheduledFor: 'desc' },
              take: CHART_BOOKING_HISTORY_TAKE,
              select: BOOKING_SELECT,
            })
          : Promise.resolve(null),
        // App-wide, on purpose: NO `professionalId` — see `chartNoShowCountWhere`.
        // The web chart's header renders the same number from the same `where`.
        prisma.booking.count({ where: chartNoShowCountWhere({ clientId }) }),
        prisma.review.count({ where: { clientId, ...visibleReviewsWhere } }),
        prisma.productRecommendation.findMany({
          where: { aftercareSummary: { booking: { clientId, professionalId: proId } } },
          orderBy: { id: 'desc' },
          take: 200,
          select: PRODUCT_SELECT,
        }),
        prisma.review.findMany({ where: { clientId, ...visibleReviewsWhere }, orderBy: { createdAt: 'desc' }, take: 200, select: REVIEW_SELECT }),
        prisma.clientProfessionalNote.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 200, select: FEEDBACK_SELECT }),
        prisma.mediaAsset.findMany({
          where: chartPhotoWhere({ clientId, proId }),
          orderBy: { createdAt: 'desc' },
          take: CHART_PHOTO_TAKE,
          select: PHOTO_SELECT,
        }),
        // Relationship-intelligence inputs (mirror the web chart loader).
        prisma.referral.count({
          where: {
            referrerClientId: clientId,
            status: { in: ['CONFIRMED', 'CONVERTED', 'REWARDED'] },
          },
        }),
        prisma.referral
          .count({ where: { referredClientId: clientId } })
          .then((count) => count > 0),
        resolveProScheduleTimeZone(proId, auth.user.professionalProfile?.timeZone),
      ])

    if (!client) return jsonFail(404, 'Client not found.')

    // Derived relationship intelligence — same module + inputs as the web page,
    // formatted server-side so native renders identical copy (no native math).
    const now = new Date()
    const intel = computeRelationshipIntelligence({
      bookings: bookings.map((b) => ({
        status: b.status,
        scheduledFor: b.scheduledFor,
        createdAt: b.createdAt,
        finishedAt: b.finishedAt,
        professionalId: b.professionalId,
        amount:
          decimalToNullableNumber(b.totalAmount) ??
          decimalToNullableNumber(b.subtotalSnapshot),
        timeZone: resolveAppointmentDisplayTimeZone(b.locationTimeZone, scheduleTz),
      })),
      proId,
      now,
      reviewCount,
      noteCount: client.notes.length,
      referredCount,
      wasReferred,
      dateOfBirth: client.dateOfBirth ?? null, // pii-plaintext-read-ok: birthday math for the authorized pro chart; plaintext-by-schema.
      preferredContactMethod: client.preferredContactMethod ?? null,
    })
    const referralSource = wasReferred ? 'Referred by a client' : null
    const relationshipIntelligence = formatRelationshipIntelligence(intel, referralSource)

    const { groups, doNotRebook } = partitionNotesByKind(client.notes)
    const doNotRebookNote = doNotRebook[0] ?? null
    const occupation = readEncryptedNoteOrFallback(client.occupationEncrypted, null)

    const fullName = [pickString(client.firstName), pickString(client.lastName)].filter(Boolean).join(' ').trim() || 'Client' // pii-plaintext-read-ok: authorized pro client chart; plaintext-by-schema.

    const photos = (
      await Promise.all(
        photoRows.map(async (m) => {
          const rendered = await renderMediaUrls({
            storageBucket: m.storageBucket,
            storagePath: m.storagePath,
            thumbBucket: m.thumbBucket,
            thumbPath: m.thumbPath,
            url: m.url,
            thumbUrl: m.thumbUrl,
          })
          const imageUrl = pickString(rendered.renderThumbUrl) ?? pickString(rendered.renderUrl)
          if (!imageUrl) return null
          return {
            id: m.id,
            bookingId: m.bookingId,
            phase: m.phase,
            caption: pickString(m.caption),
            isMine: m.professionalId === proId,
            serviceName: m.booking?.service?.name ?? null,
            when: m.booking?.scheduledFor ? m.booking.scheduledFor.toISOString() : m.createdAt.toISOString(),
            imageUrl,
          }
        }),
      )
    ).filter((p): p is NonNullable<typeof p> => p !== null)

    // `history[]` renders the narrowed list when one was asked for; everything
    // else on this response stays whole-record.
    const historyRows = filteredBookings ?? bookings

    // Per-visit photos, grouped from the SAME MediaAsset rows already fetched and
    // rendered above — one query for the whole chart, never one per booking. A
    // photo with no `bookingId` (a Look, a portfolio upload) belongs to no visit
    // and is correctly absent here; it still appears in the flat `photos` array.
    const photosByBooking = new Map<string, typeof photos>()
    for (const photo of photos) {
      if (!photo.bookingId) continue
      const bucket = photosByBooking.get(photo.bookingId)
      if (bucket) bucket.push(photo)
      else photosByBooking.set(photo.bookingId, [photo])
    }
    for (const bucket of photosByBooking.values()) {
      bucket.sort((a, b) => comparePhotoPhase(a.phase, b.phase))
    }

    return jsonOk({
      header: {
        id: client.id,
        fullName,
        email: client.user?.email ?? null,
        phone: client.phone ?? null,
        dateOfBirth: client.dateOfBirth ? client.dateOfBirth.toISOString() : null,
        preferredContactMethod: client.preferredContactMethod ?? null,
        occupation,
        socialHandle: pickString(client.proCapturedSocialHandle),
        accessUntil: gate.visibility.accessUntil ? gate.visibility.accessUntil.toISOString() : null,
        bookingCount: bookings.length,
        reviewCount,
      },
      relationshipIntelligence,
      // Cross-professional, by design — see the count query above.
      noShowCount,
      alertBanner: pickString(client.alertBanner),
      doNotRebook: doNotRebookNote ? { reason: pickString(doNotRebookNote.body), createdAt: doNotRebookNote.createdAt.toISOString() } : null,
      allergies: client.allergies.map((a) => ({
        id: a.id,
        label: a.label,
        severity: String(a.severity ?? '').toUpperCase(),
        description: pickString(a.description),
        recordedBy: proName(a.recordedBy),
        createdAt: a.createdAt.toISOString(),
      })),
      noteGroups: groups.map((g) => ({
        kind: g.kind,
        label: g.label,
        notes: g.notes.map((n) => ({
          id: n.id,
          title: pickString(n.title),
          body: n.body ?? '',
          createdAt: n.createdAt.toISOString(),
        })),
      })),
      history: historyRows.map((b) => ({
        id: b.id,
        status: b.status,
        scheduledFor: b.scheduledFor.toISOString(),
        timeZone: b.locationTimeZone,
        serviceName: b.service?.name ?? null,
        categoryName: b.service?.category?.name ?? null,
        proName: proName(b.professional),
        isMine: b.professionalId === proId,
        // K5 mark, sent ONLY on the viewing pro's own rows — it answers "did
        // this client request ME, and had I seen them before?", so on another
        // pro's booking it would misread. Web's chart page gates the same way
        // at render; the API gates at the SOURCE so no client can render a mark
        // that was never about them. null ⇒ nothing to show.
        relationshipBadge:
          b.professionalId === proId ? deriveRelationshipBadge(b) : null,
        total: moneyToString(b.totalAmount ?? b.subtotalSnapshot) ?? null,
        // The web card prints "90 min • $180" on one line; without this the
        // native card could only ever show half of that pair.
        durationMinutes: b.totalDurationMinutes ?? null,
        aftercareNotes: pickString(b.aftercareSummary?.notes),
        // The visit's own before/after frames, BEFORE-first — the same rows and
        // the same order as the web timeline's card for this booking. Empty when
        // the visit has no photos this pro is allowed to see.
        photos: photosByBooking.get(b.id) ?? [],
      })),
      products: products.map((p) => ({
        id: p.id,
        name: p.product?.name ?? pickString(p.externalName) ?? 'Product',
        brand: pickString(p.product?.brand),
        note: pickString(p.note),
      })),
      reviewsLeft: clientLeftReviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        headline: pickString(r.headline),
        body: pickString(r.body),
        proName: proName(r.professional),
        createdAt: r.createdAt.toISOString(),
      })),
      proFeedback: proFeedback.map((f) => ({
        id: f.id,
        title: pickString(f.title),
        body: f.body ?? '',
        proName: proName(f.professional),
        createdAt: f.createdAt.toISOString(),
      })),
      // LEGACY, and a second projection of the SAME `photos` computed above —
      // never a second query or a second access decision, so there is still one
      // source of truth for "which frames may this pro see".
      //
      // `history[].photos` is what both surfaces now render: the web chart puts
      // a visit's frames on that visit's card, and the native chart does the
      // same. This flat copy stays ONLY because a build already in Apple's hands
      // decodes it as a required field — dropping it would fail that build's
      // whole chart, not just its photo tab. Remove it once no shipped build
      // reads it (Tori's call, tracked with the App Store state).
      photos,
      // Technical record (formulas/consents) is founder-flag-gated and its free
      // text is encrypted at rest; native reads the gate only and links to web.
      technicalEnabled,
    })
  } catch (e) {
    console.error('GET /api/v1/pro/clients/[id]/chart error:', e)
    return jsonFail(500, 'Failed to load the client chart.')
  }
}
