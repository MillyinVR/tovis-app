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
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { readEncryptedNoteOrFallback } from '@/lib/security/notesPrivacy'
import { partitionNotesByKind } from '@/lib/clients/clientNoteKinds'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import { moneyToString } from '@/lib/money'
import { pickString } from '@/lib/pick'

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

const BOOKING_SELECT = {
  id: true,
  status: true,
  scheduledFor: true,
  locationTimeZone: true,
  finishedAt: true,
  totalDurationMinutes: true,
  totalAmount: true,
  subtotalSnapshot: true,
  professionalId: true,
  service: { select: { name: true, category: { select: { name: true } } } },
  professional: { select: { businessName: true, firstName: true, lastName: true } },
  aftercareSummary: { select: { notes: true } },
} satisfies Prisma.BookingSelect

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

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const params = await resolveRouteParams(ctx)
    const clientId = pickString(params?.id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    const gate = await assertProCanViewClient(proId, clientId)
    if (!gate.ok) return jsonFail(404, 'Client not found.')

    const technicalEnabled = isClientTechnicalRecordEnabled(proId)

    const [client, bookings, reviewCount, products, clientLeftReviews, proFeedback, photoRows] =
      await Promise.all([
        prisma.clientProfile.findUnique({
          where: { id: clientId },
          select: {
            ...CLIENT_SELECT,
            // Only the authoring pro's own notes (mirrors the web chart query).
            notes: { where: { professionalId: proId }, orderBy: { createdAt: 'desc' }, select: CLIENT_SELECT.notes.select },
          },
        }),
        prisma.booking.findMany({ where: { clientId }, orderBy: { scheduledFor: 'desc' }, take: 500, select: BOOKING_SELECT }),
        prisma.review.count({ where: { clientId } }),
        prisma.productRecommendation.findMany({
          where: { aftercareSummary: { booking: { clientId, professionalId: proId } } },
          orderBy: { id: 'desc' },
          take: 200,
          select: PRODUCT_SELECT,
        }),
        prisma.review.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 200, select: REVIEW_SELECT }),
        prisma.clientProfessionalNote.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 200, select: FEEDBACK_SELECT }),
        prisma.mediaAsset.findMany({
          where: {
            booking: { clientId },
            OR: [{ professionalId: proId }, { reviewId: { not: null } }],
          },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: PHOTO_SELECT,
        }),
      ])

    if (!client) return jsonFail(404, 'Client not found.')

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
      history: bookings.map((b) => ({
        id: b.id,
        status: b.status,
        scheduledFor: b.scheduledFor.toISOString(),
        timeZone: b.locationTimeZone,
        serviceName: b.service?.name ?? null,
        categoryName: b.service?.category?.name ?? null,
        proName: proName(b.professional),
        isMine: b.professionalId === proId,
        total: moneyToString(b.totalAmount ?? b.subtotalSnapshot) ?? null,
        aftercareNotes: pickString(b.aftercareSummary?.notes),
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
