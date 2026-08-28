// lib/clients/proClientRelationship.ts
//
// THE single answer to "does this professional have a real relationship with
// this client?" — the question every pro-facing surface that reaches a client
// record has to ask before it acts.
//
// It used to be asked in one place only (the booking-less claim invite route,
// which spelled out `ownsByCreation || ownsByBooking` inline) and NOT asked at
// all on the path that mattered most: pro booking creation accepted a
// caller-supplied `clientId` — or a caller-supplied email/phone that
// `upsertProClient` matched onto a STRANGER's existing profile — and created an
// auto-ACCEPTED, future-dated booking from it. A future ACCEPTED booking is one
// of the clauses `proClientVisibilityWhere` accepts, so one POST from a pro who
// had never met the client, and whom the client had explicitly refused chart
// access to, opened that client's whole chart: allergies, notes, photos, date
// of birth, phone, service addresses.
//
// ## The four clauses, and why only these four
//
//   CREATED_BY_PRO       this pro authored the ClientProfile row
//                        (`createdByProfessionalId`) — the walk-in / phone-in /
//                        migration-import client. There is no third party's
//                        record to leak: the chart is the pro's own writing.
//   PRIOR_BOOKING        the pair already has a booking, in any status. A
//                        cancelled one still counts — a client who cancelled
//                        once and rebooks by phone is not a stranger.
//                        🔴 EXCEPT one flagged `proCreatedWithoutRelationship`.
//                        A booking written under this very refusal cannot be
//                        the history that lifts it, or the second pro-created
//                        booking would cite the first and the gate would open
//                        after two POSTs instead of never.
//   CHART_SHARE_GRANTED  the client said yes (`ClientChartShare.GRANTED`).
//                        Consent is as good a reason as history, and it is the
//                        route back for every pair this gate refuses.
//   WAITLIST_ENTRY       the client asked THIS pro for an appointment
//                        (`WaitlistEntry`). Written only by the client's own
//                        route — `app/api/v1/waitlist` runs `requireClient()`
//                        and takes `clientId` from the session, never from
//                        input — so a pro cannot manufacture one. This is the
//                        clause that keeps "message a waitlister, then offer
//                        them a time" working; `BookingCreateContent` calls
//                        that flow out as load-bearing.
//
// 🔴 A message REPLY is deliberately not a clause either, though it is
// unforgeable (`Message.senderUserId` is the sender's own account). Answering
// a cold approach with "who is this?" is not a request for an appointment, and
// making it one would turn any pro's DM into a lever. Wanting an appointment
// has its own signal, above.
//
// 🔴 A message thread is deliberately NOT a clause, even though
// `getProClientVisibility` accepts one for the CONTACT_ONLY tier. A pro can
// mint a thread against ANY claimed client with no consent at all — POST
// /api/v1/messages/resolve with contextType=PRO_PROFILE, their own profile id
// as contextId and any clientId (lib/messagesResolve.ts,
// resolveProProfileThreadSeed). A signal the actor can manufacture on demand
// cannot be the thing that authorizes them. Contact tier is exactly what it
// says: enough to hold a conversation and to ASK for the chart, nothing more.
//
// 🔴 Not to be confused with `establishedBookingCount` in
// lib/booking/resolveDiscoveryFinalize.ts. That one decides whether a discovery
// FEE applies and is deliberately generous (a bare thread counts toward it).
// This one is an authorization boundary. Same English word, different question
// — keep them apart.
//
// ## What a refusal actually does, and why it is not always a refusal
//
// Two different answers, because the two ways of naming a client are not the
// same act:
//
//   By `clientId` — POST /api/v1/pro/bookings and the recurring-series route
//   REFUSE outright (an indistinguishable 404). A raw profile id is a machine
//   key; every surface that offers one — the web form, the iOS picker, the
//   calendar deep links — sources it from the pro's own roster, which is
//   booking-or-creation scoped, so no legitimate caller can name a client this
//   predicate rejects. Refusing also keeps the endpoint from writing
//   appointments (and their notifications) onto arbitrary strangers.
//
//   By NAME + email/phone — ALLOWED, and the booking is stamped
//   `Booking.proCreatedWithoutRelationship`. This is how a human identifies a
//   walk-in, and client identity is global by design: one account across all
//   pros (see tests/integration/calendar-import-resync.test.ts, "cross-pro
//   import: same UID + same client ⇒ each pro gets its own booking"). Refusing
//   it would stop a second pro booking someone who already has an account, and
//   would silently drop a migrating pro's imported history. So the appointment
//   is real — and the CHART still isn't open, because that stamp is excluded
//   from every clause in `proClientVisibilityWhere`. The pro serves the client;
//   the client's record stays theirs to share.
//
// ## Where this is enforced
//
//   lib/booking/resolveProBookingClient.ts  the id-keyed refusal
//   lib/booking/writeBoundary.ts            the stamp (createProBooking) and
//                                           the series refusal
//   lib/clientVisibility.ts                 honours the stamp, and imports
//                                           `hasGrantedProClientChartShare`
//                                           from here so the consent clause has
//                                           one home rather than a private copy
//   app/pro/bookings/new/BookingCreateContent.tsx
//                                           the CONTROL: never pre-fill a client
//                                           the submit would refuse

import { ClientChartShareStatus, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

/** Which clause admitted the pair. Ranked in the order declared above. */
export type ProClientRelationshipReason =
  | 'CREATED_BY_PRO'
  | 'PRIOR_BOOKING'
  | 'CHART_SHARE_GRANTED'
  | 'WAITLIST_ENTRY'

export type ProClientRelationship = {
  /**
   * Whether the ClientProfile exists at all. Callers that must not reveal
   * another pro's clients answer `found: false` and `established: false` with
   * the SAME response — see `PRO_CLIENT_RELATIONSHIP_REFUSAL`.
   */
  found: boolean
  established: boolean
  reason: ProClientRelationshipReason | null
}

const NOT_FOUND: ProClientRelationship = {
  found: false,
  established: false,
  reason: null,
}

/**
 * Whether the client has an active GRANTED chart share with this pro.
 *
 * Only GRANTED counts. REQUESTED is a pro asking and grants nothing; DECLINED
 * and REVOKED are the client's answer and must not be readable as "no row yet".
 *
 * Exported because `lib/clientVisibility.ts` needs exactly this predicate for
 * its `CHART_SHARE_GRANTED` reason, and a second private copy there is how the
 * two drift the day the statuses change.
 */
export async function hasGrantedProClientChartShare(args: {
  professionalId: string
  clientId: string
  tx?: Prisma.TransactionClient
}): Promise<boolean> {
  const share = await getDb(args.tx).clientChartShare.findUnique({
    where: {
      clientId_professionalId: {
        clientId: args.clientId,
        professionalId: args.professionalId,
      },
    },
    select: { status: true },
  })

  return share?.status === ClientChartShareStatus.GRANTED
}

/**
 * Resolve the relationship in one round trip, including WHY — the reason is
 * what makes a refusal debuggable without re-running the clauses by hand.
 */
export async function loadProClientRelationship(args: {
  professionalId: string
  clientId: string
  tx?: Prisma.TransactionClient
}): Promise<ProClientRelationship> {
  const client = await getDb(args.tx).clientProfile.findUnique({
    where: { id: args.clientId },
    select: {
      createdByProfessionalId: true,
      // `take: 1` throughout: this asks EXISTS, never "how many".
      bookings: {
        where: {
          professionalId: args.professionalId,
          proCreatedWithoutRelationship: false,
        },
        select: { id: true },
        take: 1,
      },
      chartShares: {
        where: {
          professionalId: args.professionalId,
          status: ClientChartShareStatus.GRANTED,
        },
        select: { id: true },
        take: 1,
      },
      // Any status: the client asked at some point, and a fulfilled or lapsed
      // request is still an approach they made.
      waitlistEntries: {
        where: { professionalId: args.professionalId },
        select: { id: true },
        take: 1,
      },
    },
  })

  if (!client) return NOT_FOUND

  if (client.createdByProfessionalId === args.professionalId) {
    return { found: true, established: true, reason: 'CREATED_BY_PRO' }
  }
  if (client.bookings.length > 0) {
    return { found: true, established: true, reason: 'PRIOR_BOOKING' }
  }
  if (client.chartShares.length > 0) {
    return { found: true, established: true, reason: 'CHART_SHARE_GRANTED' }
  }
  if (client.waitlistEntries.length > 0) {
    return { found: true, established: true, reason: 'WAITLIST_ENTRY' }
  }

  return { found: true, established: false, reason: null }
}

/** The boolean form, for call sites that don't render the reason. */
export async function hasEstablishedProClientRelationship(args: {
  professionalId: string
  clientId: string
  tx?: Prisma.TransactionClient
}): Promise<boolean> {
  return (await loadProClientRelationship(args)).established
}

/**
 * The refusal every caller returns, for BOTH "no such client" and "not this
 * pro's client".
 *
 * 🔴 One indistinguishable answer on purpose. Splitting them would turn any
 * pro-authenticated endpoint into an oracle for "does this client id exist",
 * which is the first half of the attack this module closes.
 */
export const PRO_CLIENT_RELATIONSHIP_REFUSAL = {
  status: 404,
  error: 'Client not found.',
  code: 'CLIENT_NOT_FOUND',
} as const
