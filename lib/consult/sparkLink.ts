// lib/consult/sparkLink.ts
//
// P7a-2 — "may this consult be LINKED to the booking being created right now?"
//
// The spark is not the proposal. `resolveConsultCommitScope` answers a
// different question — "may this COMPLETED consult's estimate size and price a
// booking?" — and its answer is no for every consult that is still mid-flow,
// which at the spark is all of them (`isFinalizeConsultAttributionOwned`
// requires `status === COMPLETED`). Booking at the spark happens ~100s before
// the analysis exists, so it must be able to say yes without one.
//
// What it therefore does NOT do, on purpose:
//   - it does not derive, price or size anything. The spark books the ordinary
//     look path at the pro's menu starting price; repricing is P9.
//   - it does not require a COMPLETED consult, an estimate, or a proposal.
//
// What it still does, because a link that isn't checked is a link that lies:
//   - takes the session lock FIRST, exactly as the commit scope does, so a
//     revocation writer cannot land between the read and the stamp;
//   - re-derives ownership from the row rather than trusting the wire;
//   - applies `evaluateConsultAnchorScope` — the SAME gate the thread the
//     client just pressed Book in had to pass. Not the C6 exposure gate: a
//     client who can see the CTA must not be refused at finalize (they resolve
//     identically only while the founder eval deferral is accepted, and a rule
//     that is right by coincidence is not a rule).
//   - refuses a booking whose pro, look or client disagrees with the consult.

import 'server-only'

import {
  BookingStatus,
  ConsultRevisionKind,
  ConsultSessionStatus,
  ProCategoryBookingGate,
  Prisma,
} from '@prisma/client'

import { consultRequiresLookChoice } from './lookPlanning'
import { CONSULT_ANCHOR_SELECT, evaluateConsultAnchorScope } from './anchor'
import { deriveConsultPrepState, CONSULT_PREP_SESSION_SELECT } from './prepDeadline'
import { consultSparkGateBlocked, loadConsultSparkGatePolicy } from './sparkGate'

/**
 * Bookings that still hold their consult's one link.
 *
 * A CANCELLED or COMPLETED booking releases it, and those two are together on
 * purpose (Tori, 2026-09-06). Cancelled-only would strand a client whose
 * appointment simply happened: the consult may not be re-linked, and she cannot
 * open a second one either — `ConsultSession` is unique per
 * (client, professional, anchorLookPostId). This set is deliberately the same
 * one `lib/consult/thread.ts` shows the booking confirmation for, so "the
 * thread says you are booked" and "the link is held" cannot disagree.
 */
export const CONSULT_SPARK_LINK_HOLDING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
]

/**
 * Consult states that can no longer take a booking.
 *
 * The same set `lib/consult/thread.ts` treats as STOPPED. The thread already
 * refuses to show a Book button for these, so this is not the control the
 * client meets — it is the control a hand-made request meets, and a link to a
 * consult nobody can reopen is a row that will confuse every later reader
 * (the Brief, aftercare, prep reminders) for no benefit.
 */
const SPARK_LINK_TERMINAL_STATUSES = new Set<ConsultSessionStatus>([
  ConsultSessionStatus.CANCELLED,
])

export type ConsultSparkLinkRefusal =
  /** Ownership, gate and vertical misses stay indistinguishable — no leak. */
  | 'HIDDEN'
  /** The booking's pro / look / client do not match the consult's. */
  | 'MISMATCH'
  /** The consult already holds a live booking. */
  | 'ALREADY_LINKED'
  /**
   * P7a-5. This pro asks for the safety answers before a slot is taken in this
   * service category, and they are not in yet.
   *
   * 🔴 This refusal is the POINT of the setting, not a nicety. The thread
   * disables its button, but a disabled button is not a control — the pro's
   * whole reason for switching this on is that she does not want the slot held,
   * and a slot taken by a hand-made POST is just as held. Refusing here aborts
   * the finalize transaction, so no booking is created at all.
   */
  | 'PREP_REQUIRED'

export type ConsultSparkLinkResult =
  | { ok: true; consultSessionId: string }
  | { ok: false; reason: ConsultSparkLinkRefusal }

const SPARK_LINK_SELECT = {
  // 🔴 The prep rule's OWN select, not a hand-listed twin of it: the boundary
  // and the thread's CTA have to be reading the same columns, or the button and
  // the refusal can disagree about whether prep is done — which is exactly the
  // bug a server-side gate exists to prevent.
  ...CONSULT_PREP_SESSION_SELECT,
  ...CONSULT_ANCHOR_SELECT,
  id: true,
  status: true,
  // 🔴 The two NESTED selects are MERGED, not replaced. Spreading one relation
  // select on top of another keeps only the last one's fields, and the compiler
  // caught exactly that here: the anchor's `booking` dropped `id`,
  // `locationTimeZone` and `totalDurationMinutes`, which is the whole prep
  // deadline. Same discipline `thread.ts` and `prepDeadline.ts` already record.
  serviceCategory: {
    select: {
      ...CONSULT_ANCHOR_SELECT.serviceCategory.select,
      ...CONSULT_PREP_SESSION_SELECT.serviceCategory.select,
    },
  },
  booking: {
    select: {
      ...CONSULT_ANCHOR_SELECT.booking.select,
      ...CONSULT_PREP_SESSION_SELECT.booking.select,
    },
  },
} satisfies Prisma.ConsultSessionSelect

/**
 * Lock, load, check identity, check the link is free.
 *
 * `lookPostId` is the look the BOOKING is being created from, as the write
 * boundary resolved it (`resolveDiscoveryFinalize` — a validated, published,
 * viewable LookPost, never the raw client claim). It must equal the consult's
 * own anchor: that is the whole content of "this booking is for this consult's
 * look", and without it a spark id could attach a consult to any appointment
 * the client happened to be making with that pro.
 */
export async function resolveConsultSparkLink(
  tx: Prisma.TransactionClient,
  args: {
    consultId: string
    clientId: string
    professionalId: string
    /** The booking's server-validated source look. Null = not look-sourced. */
    lookPostId: string | null
  },
): Promise<ConsultSparkLinkResult> {
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "ConsultSession"
    WHERE "id" = ${args.consultId}
    FOR UPDATE
  `)

  const consult = await tx.consultSession.findUnique({
    where: { id: args.consultId },
    select: SPARK_LINK_SELECT,
  })

  if (!consult || consult.clientId !== args.clientId) {
    return { ok: false, reason: 'HIDDEN' }
  }

  if (SPARK_LINK_TERMINAL_STATUSES.has(consult.status)) {
    return { ok: false, reason: 'MISMATCH' }
  }

  // The gate the thread already passed. Scope, not the booking-window arm:
  // a spark consult is look-anchored and has no appointment to be inside of.
  if (await consultRequiresLookChoice(tx, consult.id)) return { ok: false, reason: 'PREP_REQUIRED' }

  const scope = evaluateConsultAnchorScope(consult)
  if (!scope.eligible) return { ok: false, reason: 'HIDDEN' }

  // A booking-anchored consult already HAS its appointment. Linking it to a
  // second one is not a spark, it is a bug with an id attached.
  if (!consult.anchorLookPostId) return { ok: false, reason: 'MISMATCH' }

  if (consult.professionalId !== args.professionalId) {
    return { ok: false, reason: 'MISMATCH' }
  }

  // 🔴 The look is compared against the booking's SERVER-RESOLVED source, not
  // against anything the client sent. A null source means the booking is not
  // provably from this look — refused rather than linked on trust.
  if (
    !args.lookPostId ||
    consult.anchorLookPostId !== args.lookPostId
  ) {
    return { ok: false, reason: 'MISMATCH' }
  }

  // One live booking per consult. The database's partial unique index is the
  // real guarantee (it also holds under a race this read cannot see); this
  // check exists so the ordinary case refuses with a reason instead of a
  // constraint violation.
  const held = await tx.booking.findFirst({
    where: {
      sourceConsultSessionId: consult.id,
      status: { in: CONSULT_SPARK_LINK_HOLDING_STATUSES },
    },
    select: { id: true },
  })
  if (held) return { ok: false, reason: 'ALREADY_LINKED' }

  // P7a-5 — the pro's per-category gate, checked LAST because it is the only
  // refusal the client can clear herself: everything above is a fact about the
  // request, this is a step she has not finished yet.
  const gatePolicy = await loadConsultSparkGatePolicy(tx, {
    professionalId: consult.professionalId,
    serviceCategoryId: consult.serviceCategoryId,
  })

  // Skip the intake read entirely when the pro has not asked for the gate,
  // which is every pro until one turns it on.
  if (gatePolicy?.bookingGate === ProCategoryBookingGate.AFTER_PREP) {
    const intakeRevisions = await tx.consultRevision.findMany({
      where: { consultSessionId: consult.id, kind: ConsultRevisionKind.INTAKE },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: { payload: true },
    })

    const prep = deriveConsultPrepState({
      session: consult,
      intakePayloads: intakeRevisions.map((revision) => revision.payload),
    })

    if (consultSparkGateBlocked({ policy: gatePolicy, prepComplete: prep.complete })) {
      return { ok: false, reason: 'PREP_REQUIRED' }
    }
  }

  return { ok: true, consultSessionId: consult.id }
}
