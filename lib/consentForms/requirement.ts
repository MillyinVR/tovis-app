// lib/consentForms/requirement.ts
//
// K15 — THE one place that answers "does this appointment need a form the client
// hasn't signed?", for every surface that asks (the pro calendar card, the
// session-start banner, and the client chart's send control).
//
// 🔴 It WARNS. It never BLOCKS. Nothing on the booking path calls into this
// module, and `ProfessionalServiceOffering.consentFormId` is read nowhere else:
// refusing bookings on an unsigned waiver would strand real appointments the day
// a pro sets their first requirement, which is the failure the card's "warn,
// don't block, in v1" exists to prevent.
//
// ── Why the requirement points at a FORM, not a version ──────────────────────
// A version is resolved when the signature link is MINTED (see
// lib/consentForms/signatureRequest.ts). Binding a version here would freeze the
// requirement at whatever text was current the day the pro set it, so editing
// the waiver would leave every future client signing the old words — the exact
// inverse of K14's promise, which is that editing changes the FUTURE and never
// the past.
//
// ── The shape of the query ───────────────────────────────────────────────────
// Two loads, deliberately different in kind:
//
//   1. the pro's requirements, keyed on the PRO alone (`loadConsentRequirements
//      ByServiceId`) — independent of the bookings in view, so the calendar runs
//      it inside its existing Promise.all rather than adding a serial hop to a
//      route whose known performance problem is a fetch waterfall. This is the
//      K8 swatch-loader rule, and the same reason applies.
//   2. what those clients have already signed (`loadSignedConsentFormIds`) —
//      this one genuinely needs the bookings first, so it is one extra hop. It
//      is SKIPPED ENTIRELY when the pro has no requirements, which today is
//      every pro: a pro who never binds a form pays nothing.

// `Prisma` is named only in TYPE positions here (Prisma.TransactionClient,
// Prisma.ProfessionalServiceOfferingSelect), so the whole clause erases.
import type { Prisma, PrismaClient } from '@prisma/client'

import type { ClientConsentKind } from '@/lib/prismaEnums'

import type { BadgeTone } from '@/app/_components/ui'
import { CONSENT_KIND_LABELS } from '@/lib/consentForms/kindLabels'

type Db = PrismaClient | Prisma.TransactionClient

/** One service's consent requirement, resolved to words a surface can print. */
export type ConsentRequirement = {
  formId: string
  kind: ClientConsentKind
  /**
   * The CURRENT version's title. A form's title lives on its version (K14), so
   * this is "what the form is called today" — which is the right thing to show
   * a pro chasing a signature, and deliberately NOT what an already-signed
   * record resolves (that reads its own version, forever).
   */
  title: string
  /** False when the pro retired the form but left it bound to a service. */
  isActive: boolean
  /** Null when the form has no published version — nothing to sign yet. */
  currentVersionId: string | null
}

const REQUIREMENT_SELECT = {
  serviceId: true,
  consentFormId: true,
  consentForm: {
    select: {
      id: true,
      kind: true,
      isActive: true,
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true, title: true },
      },
    },
  },
} satisfies Prisma.ProfessionalServiceOfferingSelect

/**
 * Every consent requirement this pro has set, keyed by `serviceId`.
 *
 * The key is unambiguous because `ProfessionalServiceOffering` is
 * `@@unique([professionalId, serviceId])` — a pro has at most one offering per
 * service, so there is no tie to break.
 *
 * ⚠️ Deliberately NOT filtered to `isActive` on the OFFERING, for the reason the
 * swatch loader gives: a pro who retires a service still has bookings for it on
 * the calendar, and the waiver those appointments needed did not stop mattering.
 */
export async function loadConsentRequirementsByServiceId(args: {
  db: Db
  professionalId: string
}): Promise<ReadonlyMap<string, ConsentRequirement>> {
  const rows = await args.db.professionalServiceOffering.findMany({
    where: {
      professionalId: args.professionalId,
      consentFormId: { not: null },
    },
    select: REQUIREMENT_SELECT,
  })

  const map = new Map<string, ConsentRequirement>()

  for (const row of rows) {
    const form = row.consentForm
    if (!form) continue

    map.set(row.serviceId, {
      formId: form.id,
      kind: form.kind,
      title: form.versions[0]?.title ?? '',
      isActive: form.isActive,
      currentVersionId: form.versions[0]?.id ?? null,
    })
  }

  return map
}

/**
 * A booking, as far as consent requirements are concerned. Every field must
 * appear in the caller's Prisma select — that is the point of the type: a route
 * cannot forget one without failing `typecheck` (the K8 SwatchBookingRow rule).
 */
export type ConsentRequirementBookingRow = {
  /** `Booking.serviceId` — non-null in the schema. */
  serviceId: string
  /**
   * `Booking.serviceItems`. A visit can hold several services, and each one can
   * carry its own requirement — so unlike the COLOUR channel, which must pick a
   * single swatch, this collects ALL of them. A pro chasing signatures needs to
   * know about both waivers, not whichever one sorts first.
   */
  serviceItems: readonly { serviceId: string }[]
}

/**
 * The distinct forms a booking requires. Deduped by form id: two services
 * sharing one waiver is one signature, not two.
 */
export function collectBookingConsentRequirements(
  booking: ConsentRequirementBookingRow,
  byServiceId: ReadonlyMap<string, ConsentRequirement>,
): ConsentRequirement[] {
  const serviceIds = [
    booking.serviceId,
    ...booking.serviceItems.map((item) => item.serviceId),
  ]

  const seen = new Set<string>()
  const out: ConsentRequirement[] = []

  for (const serviceId of serviceIds) {
    const requirement = byServiceId.get(serviceId)
    if (!requirement) continue
    if (seen.has(requirement.formId)) continue
    seen.add(requirement.formId)
    out.push(requirement)
  }

  return out
}

/**
 * Which of these forms each client has already signed with this pro.
 *
 * "Signed" = a `ClientConsentRecord` of this pro's pointing at ANY version of
 * the form. Deliberately not "the CURRENT version": a client who signed v1 has
 * signed. Re-asking every client because the pro fixed a typo would make the
 * warning worthless, and K14's whole model says the old record still stands.
 *
 * ⚠️ A record whose `validUntil` has passed does NOT count. That column means
 * exactly "this consent is no longer current" (patch tests carry it), so an
 * expired patch test must go back to warning — that is the case where the
 * warning is worth the most.
 *
 * `signedAt` is NOT required. It is nullable because a pro recording a paper
 * waiver may not know the date; absence means "date unknown", never "unsigned".
 */
export async function loadSignedConsentFormIds(args: {
  db: Db
  professionalId: string
  clientIds: readonly string[]
  formIds: readonly string[]
  now: Date
}): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const byClient = new Map<string, Set<string>>()

  if (args.clientIds.length === 0 || args.formIds.length === 0) return byClient

  const rows = await args.db.clientConsentRecord.findMany({
    where: {
      professionalId: args.professionalId,
      clientId: { in: [...args.clientIds] },
      formVersion: { formId: { in: [...args.formIds] } },
      OR: [{ validUntil: null }, { validUntil: { gt: args.now } }],
    },
    select: {
      clientId: true,
      formVersion: { select: { formId: true } },
    },
  })

  for (const row of rows) {
    const formId = row.formVersion?.formId
    if (!formId) continue

    const set = byClient.get(row.clientId) ?? new Set<string>()
    set.add(formId)
    byClient.set(row.clientId, set)
  }

  return byClient
}

// ─── The unsigned list (session-start surfaces) ──────────────────────────────
//
// 🔴 Deliberately NOT the badge below, and this is the distinction to keep.
//
// `deriveConsentRequirementBadge` sets `significant: false` once the appointment
// has started, because a chip warning a pro about a visit that already happened
// is noise they cannot act on. A SESSION-START surface is the opposite case: the
// pro is standing in front of the client at, or just after, the scheduled time,
// which is precisely when `scheduledFor <= now` is true. Running the unsigned
// list through the badge's time gate would therefore blank the warning exactly
// when it is worth the most.
//
// Web's session page already got this right by construction — it renders the
// banner on the PRE-SERVICE screens only, so WHICH SCREEN carries the decision
// and the list itself is ungated. Anything else consuming this list (the native
// session hub) must make the same choice about its own surface; it must not
// reach for `significant`, which answers a different question.

/** One unsigned form, in the words a session-start surface prints. */
export type UnsignedConsentForm = {
  formId: string
  title: string
  /** `kind` as words, from the one label table (K14). */
  kindLabel: string
}

/**
 * The unsigned forms for a SET of bookings, in two queries regardless of how
 * many bookings are passed.
 *
 * Batched rather than per-booking on purpose: the session route's picker mode
 * resolves several eligible bookings at once, and a per-booking helper would
 * turn that into 2N queries on a surface the pro hits on every app open.
 *
 * Returns a map keyed by the caller's booking id. A booking with nothing
 * outstanding is ABSENT from the map rather than present with an empty array —
 * so "nothing to sign" has one representation, not two.
 */
export async function loadUnsignedConsentFormsForBookings(args: {
  db: Db
  professionalId: string
  bookings: readonly (ConsentRequirementBookingRow & {
    id: string
    clientId: string
  })[]
  now: Date
}): Promise<ReadonlyMap<string, UnsignedConsentForm[]>> {
  const out = new Map<string, UnsignedConsentForm[]>()
  if (args.bookings.length === 0) return out

  const byServiceId = await loadConsentRequirementsByServiceId({
    db: args.db,
    professionalId: args.professionalId,
  })

  // A pro who has bound no form pays for exactly one query and stops here —
  // which today is every pro (the ship-dark default this rides on).
  if (byServiceId.size === 0) return out

  const requiredByBooking = new Map<string, ConsentRequirement[]>()
  const formIds = new Set<string>()
  const clientIds = new Set<string>()

  for (const booking of args.bookings) {
    const required = collectBookingConsentRequirements(booking, byServiceId)
    if (required.length === 0) continue

    requiredByBooking.set(booking.id, required)
    clientIds.add(booking.clientId)
    for (const requirement of required) formIds.add(requirement.formId)
  }

  if (requiredByBooking.size === 0) return out

  const signedByClient = await loadSignedConsentFormIds({
    db: args.db,
    professionalId: args.professionalId,
    clientIds: [...clientIds],
    formIds: [...formIds],
    now: args.now,
  })

  for (const booking of args.bookings) {
    const required = requiredByBooking.get(booking.id)
    if (!required) continue

    const signed = signedByClient.get(booking.clientId) ?? new Set<string>()
    const unsigned = required
      .filter((requirement) => !signed.has(requirement.formId))
      .map((requirement) => ({
        formId: requirement.formId,
        // A form whose current version has no title still needs naming — the pro
        // has to know something is outstanding even if they left it blank.
        title: requirement.title || 'Consent form',
        kindLabel: CONSENT_KIND_LABELS[requirement.kind],
      }))

    if (unsigned.length > 0) out.set(booking.id, unsigned)
  }

  return out
}

/** The single-booking case, over the same chain. */
export async function loadUnsignedConsentFormsForBooking(args: {
  db: Db
  professionalId: string
  booking: ConsentRequirementBookingRow & { id: string; clientId: string }
  now: Date
}): Promise<UnsignedConsentForm[]> {
  const byBooking = await loadUnsignedConsentFormsForBookings({
    db: args.db,
    professionalId: args.professionalId,
    bookings: [args.booking],
    now: args.now,
  })

  return byBooking.get(args.booking.id) ?? []
}

// ─── The badge ───────────────────────────────────────────────────────────────

export type ConsentRequirementBadge = {
  kind: 'UNSIGNED_CONSENT'
  /** What a chip prints. Kind-neutral: a patch test is not a "waiver". */
  label: string
  /**
   * The plain-words expansion, for tooltips and accessible names. The calendar
   * card renders a chip, but the words are what a screen reader gets (K5's
   * rule), and they NAME the form — "which waiver?" is the pro's next question.
   */
  description: string
  tone: BadgeTone
  /**
   * 🔴 False for a booking that is already OVER.
   *
   * A pro who sets their first requirement today would otherwise light up every
   * past appointment for that service in amber — warnings about visits that
   * already happened, which nobody can act on. The DECISION lives here so no
   * surface can drift on it (the K1 `significant` rule).
   */
  significant: boolean
}

/** The words for one unsigned form, e.g. "Corrective colour waiver not signed". */
function describeUnsigned(requirements: readonly ConsentRequirement[]): string {
  if (requirements.length === 1) {
    const only = requirements[0]
    const name = only?.title.trim()
    return name ? `${name} not signed` : 'Consent form not signed'
  }

  return `${requirements.length} consent forms not signed`
}

/**
 * READ-time mapping: a booking's unmet requirements → the badge, or null when
 * there is nothing to say. Null is the honest display for a booking whose forms
 * are all signed AND for every booking of every pro who has set no requirement —
 * which is the ship-dark default this step lands on.
 */
export function deriveConsentRequirementBadge(args: {
  unsigned: readonly ConsentRequirement[]
  /** `Booking.finishedAt` — set once the pro closes the appointment out. */
  finishedAt: Date | null
  /** The booking's start, and the clock to compare it against. */
  scheduledFor: Date
  now: Date
}): ConsentRequirementBadge | null {
  if (args.unsigned.length === 0) return null

  const isOver =
    args.finishedAt !== null ||
    args.scheduledFor.getTime() <= args.now.getTime()

  return {
    kind: 'UNSIGNED_CONSENT',
    label: 'Form due',
    description: describeUnsigned(args.unsigned),
    tone: 'warn',
    significant: !isOver,
  }
}

function isUnsignedConsentKind(value: unknown): value is 'UNSIGNED_CONSENT' {
  return value === 'UNSIGNED_CONSENT'
}

/**
 * Normalize a badge that arrived over the wire (the calendar client re-parses
 * its JSON defensively).
 *
 * Unlike the K5/K11 marks, `description` is NOT reconstructed from a table —
 * it names the pro's own form, so the server is the only thing that can know
 * it. Everything a table CAN own (label, tone) still comes from here, so the
 * presentation cannot drift with the payload. A malformed value yields null →
 * the card renders no chip, never a made-up warning.
 */
export function parseConsentRequirementBadgeWire(
  value: unknown,
): ConsentRequirementBadge | null {
  if (typeof value !== 'object' || value === null) return null

  const record = value as Record<string, unknown>
  if (!isUnsignedConsentKind(record.kind)) return null

  const description =
    typeof record.description === 'string' && record.description.trim()
      ? record.description.trim()
      : 'Consent form not signed'

  return {
    kind: 'UNSIGNED_CONSENT',
    label: 'Form due',
    description,
    tone: 'warn',
    significant: record.significant === true,
  }
}
