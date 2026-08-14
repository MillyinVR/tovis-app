// app/api/v1/pro/bookings/[id]/care-sections/route.ts
//
// The pro authoring the labelled blocks of a client's care plan.
//
// 🔴 PROFESSION-NEUTRAL BY CONSTRUCTION (Tori, 2026-08-14: *"we need to find a
// different way to do it since it wont just be hairstylist on the app this is
// for all beauty pros"*). The reference design hardcoded "Wash" and "Heat &
// styling"; here the LABEL is the pro's own text. `careSectionSuggestions`
// offers starting labels for their profession and nothing validates against
// them — a nail tech writes "Cuticle oil", a lash artist "First 24 hours".
//
// Deliberately its OWN endpoint rather than another field threaded through
// POST /pro/bookings/[id]/aftercare: that route also moves the booking's
// session step and touches the rebook/product paths, and prose blocks have no
// business widening its blast radius. Same shape as /api/v1/pro/prep.
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { careSectionSuggestions } from '@/lib/aftercare/careSectionSuggestions'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_SECTIONS = 8
const MAX_LABEL_LENGTH = 60
const MAX_BODY_LENGTH = 1500

type SectionInput = { label: string; body: string }

function normalizeSections(
  raw: unknown,
): SectionInput[] | { error: string } {
  if (!Array.isArray(raw)) return { error: 'sections must be an array.' }
  if (raw.length > MAX_SECTIONS) {
    return { error: `A care plan can hold at most ${MAX_SECTIONS} sections.` }
  }

  const out: SectionInput[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      return { error: 'Every section must be an object.' }
    }
    const record = entry as Record<string, unknown>
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    const body = typeof record.body === 'string' ? record.body.trim() : ''

    // A section the pro emptied entirely is one they deleted — drop it rather
    // than refusing the save and losing their other edits.
    if (label.length === 0 && body.length === 0) continue

    // A half-filled one IS an error: the database refuses a blank label or a
    // blank body (CHECK constraints), so saying so here beats a 500.
    if (label.length === 0) return { error: 'Every section needs a heading.' }
    if (body.length === 0) {
      return { error: `“${label}” has a heading but nothing under it.` }
    }
    if (label.length > MAX_LABEL_LENGTH) {
      return { error: `A heading can be at most ${MAX_LABEL_LENGTH} characters.` }
    }
    if (body.length > MAX_BODY_LENGTH) {
      return { error: `“${label}” is longer than ${MAX_BODY_LENGTH} characters.` }
    }
    out.push({ label, body })
  }
  return out
}

/** The pro's own aftercare summary for this booking, or a refusal. */
async function requireOwnSummary(bookingId: string, professionalId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, professionalId },
    select: {
      id: true,
      aftercareSummary: { select: { id: true } },
      professional: { select: { professionType: true } },
    },
  })
  if (!booking) return null
  return booking
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const { professionalId } = auth

    const { id: rawId } = await resolveRouteParams(ctx)
    const bookingId = pickString(rawId)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const booking = await requireOwnSummary(bookingId, professionalId)
    if (!booking) return jsonFail(404, 'Booking not found.')

    const sections = booking.aftercareSummary
      ? await prisma.aftercareCareSection.findMany({
          where: { aftercareSummaryId: booking.aftercareSummary.id },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, label: true, body: true, sortOrder: true },
        })
      : []

    return jsonOk({
      ok: true,
      sections,
      // Starting points, in this pro's vocabulary. Prefill only — the pro may
      // ignore every one.
      suggestedLabels: careSectionSuggestions(booking.professional.professionType),
    })
  } catch (err) {
    console.error('[pro care sections GET]', safeError(err))
    return jsonFail(500, 'Could not load the care plan.')
  }
}

export async function PUT(req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const { professionalId } = auth

    const { id: rawId } = await resolveRouteParams(ctx)
    const bookingId = pickString(rawId)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const body = (await req.json().catch(() => ({}))) as { sections?: unknown }
    const sections = normalizeSections(body?.sections)
    if (!Array.isArray(sections)) return jsonFail(400, sections.error)

    const result = await prisma.$transaction(async (tx) => {
      // Re-read under the transaction: ownership was true a moment ago, and
      // this is the read the write is actually keyed on.
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, professionalId },
        select: { id: true, aftercareSummary: { select: { id: true } } },
      })
      if (!booking) return { kind: 'GONE' as const }

      // The care plan may not exist yet — the pro can write the prose before
      // they have photos or a rebook window. Create the shell if so.
      const summaryId =
        booking.aftercareSummary?.id ??
        (
          await tx.aftercareSummary.create({
            data: { bookingId: booking.id },
            select: { id: true },
          })
        ).id

      await tx.aftercareCareSection.deleteMany({
        where: { aftercareSummaryId: summaryId },
      })
      if (sections.length > 0) {
        await tx.aftercareCareSection.createMany({
          data: sections.map((section, index) => ({
            aftercareSummaryId: summaryId,
            label: section.label,
            body: section.body,
            sortOrder: index,
          })),
        })
      }

      const saved = await tx.aftercareCareSection.findMany({
        where: { aftercareSummaryId: summaryId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, label: true, body: true, sortOrder: true },
      })
      return { kind: 'OK' as const, sections: saved }
    })

    if (result.kind === 'GONE') return jsonFail(404, 'Booking not found.')
    return jsonOk({ ok: true, sections: result.sections })
  } catch (err) {
    console.error('[pro care sections PUT]', safeError(err))
    return jsonFail(500, 'Could not save the care plan.')
  }
}
