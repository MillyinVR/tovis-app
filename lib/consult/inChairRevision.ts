// lib/consult/inChairRevision.ts
//
// Book the Look, slice B6 — the REVISION the client is being asked to accept.
//
// Decision 8 says the approved number is the final price, "no checkout
// surprise". Tori settled the other half on 2026-08-31: when the pro's
// correction raises the price by more than ~10%, or lengthens the appointment
// by 30 minutes or more, the client is TOLD it is a big change and offered a
// cancel with a full refund. Smaller adjustments stay quiet.
//
// ── WHEN the client is told, and why it is here rather than at B5's write ────
//
// B5 records the pro's numbers and promises her, in as many words, that the
// client is not told about them. That promise is right: a recorded correction
// is her working figure, not an ask. It BECOMES an ask the moment she sends the
// consultation for approval (decision 8's own verb), and that send already
// notifies the client — `CONSULTATION_PROPOSAL_SENT`, which deliberately
// carries no dollar amount (§12 NC1 #10).
//
// So the notice is derived HERE, on the surfaces where she answers the number,
// against the same pending proposal she is looking at. The alternative —
// notifying at B5's write — would tell a client her price moved 40% about a
// figure her pro is still working out, possibly days early and possibly not the
// number she is finally asked for. One ask, one notice, one moment.
//
// ── WHAT it is measured against ─────────────────────────────────────────────
//
// The baseline is `ConsultBookingProposal` — `startingAtPrice` and
// `totalDurationMinutes`, the figures a person was actually shown and agreed
// to at 3 AM. Not the booking's own subtotal, which for a look-anchored booking
// covers ONLY the floor offering it was finalized through and is deliberately
// narrower (lib/booking/writeBoundary.ts).
//
// Both sides of the comparison are read off the PROPOSAL the pro authored:
// `proposedTotal` is the exact number on the client's screen, and the durations
// are the ones she typed into the same form. Measuring the price from one
// document and the time from another is how a notice comes to disagree with the
// screen it is printed on.

import 'server-only'

import { ConsultationApprovalStatus, Prisma } from '@prisma/client'

import { moneyToCentsInt, moneyToFixed2String } from '@/lib/money'
import { prisma } from '@/lib/prisma'

import {
  buildConsultationItemsFromProposalJson,
  deriveConsultRevisionNotice,
  type ConsultRevisionNotice,
} from './inChairFinalization'

const REVISION_BOOKING_SELECT = {
  id: true,
  clientId: true,
  consultBookingProposal: {
    select: { startingAtPrice: true, totalDurationMinutes: true },
  },
  consultationApproval: {
    select: {
      id: true,
      status: true,
      proposedTotal: true,
      proposedServicesJson: true,
    },
  },
} satisfies Prisma.BookingSelect

type RevisionBookingRow = Prisma.BookingGetPayload<{
  select: typeof REVISION_BOOKING_SELECT
}>

/** Minimal client surface: the notice plus the id of the proposal it judges. */
export type ConsultRevisionState = {
  consultationApprovalId: string
  notice: ConsultRevisionNotice
}

/**
 * Judge the PENDING proposal on this booking against what the client committed
 * to, from rows only. Pure once the row is in hand, so both the page and the
 * cancel route can be given the same answer without asking twice.
 *
 * Null — not a "no big change" — in every state where the question cannot be
 * asked: no look-anchored proposal, no proposal awaiting an answer, or an
 * unreadable figure on either side. A caller must never render a reassuring
 * sentence off a comparison nobody made.
 */
export function deriveConsultRevisionState(
  booking: RevisionBookingRow,
): ConsultRevisionState | null {
  const committed = booking.consultBookingProposal
  const approval = booking.consultationApproval

  if (!committed || !approval) return null
  if (approval.status !== ConsultationApprovalStatus.PENDING) return null

  const committedPriceCents = moneyToCentsInt(
    moneyToFixed2String(committed.startingAtPrice) ?? '',
  )
  const finalPriceCents = moneyToCentsInt(
    moneyToFixed2String(approval.proposedTotal) ?? '',
  )
  if (committedPriceCents === null || finalPriceCents === null) return null

  // The pro's own typed durations, read back through the same narrowing the
  // pro's form seed uses. One unusable line refuses the whole read there, and
  // that refusal is inherited here on purpose: a duration summed over half a
  // proposal is a smaller number than the truth, and a notice that understates
  // the change is worse than no notice.
  const lines = buildConsultationItemsFromProposalJson(
    approval.proposedServicesJson,
  )
  if (!lines) return null

  let finalDurationMinutes = 0
  for (const line of lines) {
    const minutes = Number.parseInt(line.durationMinutes, 10)
    if (!Number.isFinite(minutes)) return null
    finalDurationMinutes += minutes
  }

  return {
    consultationApprovalId: approval.id,
    notice: deriveConsultRevisionNotice({
      committedPriceCents,
      committedDurationMinutes: committed.totalDurationMinutes,
      finalPriceCents,
      finalDurationMinutes,
    }),
  }
}

/**
 * The same answer, loaded for one client's own booking.
 *
 * Deliberately NOT founder-gated. The gate is the existence of a
 * `ConsultBookingProposal`, which only a pilot booking has — and a promise of a
 * refund must never depend on an allowlist of PROS, which is a fact about
 * somebody else entirely.
 */
export async function loadConsultRevisionForClient(args: {
  bookingId: string
  clientId: string
}): Promise<ConsultRevisionState | null> {
  const booking = await prisma.booking.findFirst({
    where: { id: args.bookingId, clientId: args.clientId },
    select: REVISION_BOOKING_SELECT,
  })

  if (!booking) return null

  return deriveConsultRevisionState(booking)
}
