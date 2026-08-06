// lib/clientVisibility.ts
import { prisma } from '@/lib/prisma'
import { BookingStatus, ClientChartShareStatus, Prisma } from '@prisma/client'
import {
  EMPTY_CLIENT_LINK_VIEWER,
  type ClientLinkViewer,
} from '@/lib/profiles/profileHrefs'

export type ClientVisibilityReason =
  | 'ACTIVE_BOOKING'
  | 'PENDING_BOOKING'
  | 'UPCOMING_ACCEPTED'
  | 'RECENT_COMPLETED'
  /** W5: the client explicitly granted this pro chart access (ClientChartShare). */
  | 'CHART_SHARE_GRANTED'
  /**
   * W5: a message thread and nothing else. This is now the CONTACT_ONLY tier —
   * it grants the pro the client's display name, avatar and the thread, and
   * NOTHING clinical.
   */
  | 'ACTIVE_THREAD'
  | 'NONE'

export type ClientVisibilityResult = {
  /**
   * Full chart: notes, allergies, formulas, consent records, photo release, the
   * technical record, service addresses, do-not-rebook, policy, date of birth.
   *
   * 🔴 W5: a bare message thread NO LONGER sets this. It used to, open-ended,
   * and no consumer branched on `reason` — so one message (or merely joining a
   * waitlist, which auto-creates a thread) handed over read AND write access to
   * a client's whole medical record.
   */
  canViewClient: boolean
  /**
   * W5 CONTACT_ONLY tier: may this pro see who the client IS — display name,
   * avatar — and hold a conversation with them? True whenever `canViewClient`
   * is, plus for a thread-only relationship.
   *
   * Kept as its own field rather than derived from `reason` at each call site,
   * because "which reasons count as contact" is precisely the judgement that
   * gets copied wrong.
   */
  canContactClient: boolean
  reason: ClientVisibilityReason
  /**
   * When access is time-bounded (RECENT_COMPLETED), the moment it closes — for
   * the UI to render a countdown. Open-ended access (active/pending/upcoming/
   * granted share) returns null.
   */
  accessUntil: Date | null
}

/**
 * After a visit COMPLETES, the pro keeps full chart access for this many days,
 * then a hard cutoff. Rebooking re-opens access automatically (a new
 * pending/upcoming booking matches the earlier clauses). Single source of truth
 * for the window — do NOT inline a second copy anywhere.
 */
export const RECENT_COMPLETED_WINDOW_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** Start of the recent-completed window: now − RECENT_COMPLETED_WINDOW_DAYS. */
function recentCompletedCutoff(now: Date): Date {
  return new Date(now.getTime() - RECENT_COMPLETED_WINDOW_DAYS * DAY_MS)
}

/**
 * THE single visibility rule. A pro can view/edit a client's chart when they
 * have, for that client, a booking that is:
 *  - currently in progress (startedAt set, not yet finished), OR
 *  - PENDING, OR
 *  - ACCEPTED and still upcoming, OR
 *  - COMPLETED within the last RECENT_COMPLETED_WINDOW_DAYS days
 *    (COALESCE(finishedAt, scheduledFor) >= cutoff). CANCELLED / no-show never
 *    count.
 *
 * The clients list, the clickable name, and the page gate ALL consume this so
 * they can never disagree. If you need this logic again, import it — never
 * re-inline the clauses (grep guard in clientVisibility.test.ts).
 */
export function proClientVisibilityWhere(now: Date): Prisma.BookingWhereInput {
  const cutoff = recentCompletedCutoff(now)

  return {
    OR: [
      // In progress.
      { startedAt: { not: null }, finishedAt: null },
      // Pending.
      { status: BookingStatus.PENDING },
      // Accepted + upcoming.
      { status: BookingStatus.ACCEPTED, scheduledFor: { gte: now } },
      // Completed within the post-visit window. COALESCE(finishedAt,
      // scheduledFor) >= cutoff, expressed as a fallback OR.
      {
        status: BookingStatus.COMPLETED,
        OR: [
          { finishedAt: { gte: cutoff } },
          { finishedAt: null, scheduledFor: { gte: cutoff } },
        ],
      },
    ],
  }
}

type VisibilityRow = {
  status: BookingStatus
  startedAt: Date | null
  finishedAt: Date | null
  scheduledFor: Date
}

// Lower rank = higher priority. A real booking always wins over a bare message
// thread, so ACTIVE_THREAD ranks last (it's only ever the reason when no booking
// qualifies — see getProClientVisibility).
const REASON_RANK: Record<Exclude<ClientVisibilityReason, 'NONE'>, number> = {
  ACTIVE_BOOKING: 0,
  PENDING_BOOKING: 1,
  UPCOMING_ACCEPTED: 2,
  RECENT_COMPLETED: 3,
  CHART_SHARE_GRANTED: 4,
  ACTIVE_THREAD: 5,
}

/**
 * Classify a single matching booking row into the reason it grants access,
 * plus the access-close moment (only meaningful for RECENT_COMPLETED).
 * Mirrors the clauses in proClientVisibilityWhere — every row returned by that
 * filter classifies into exactly one non-NONE reason.
 */
function classifyRow(
  row: VisibilityRow,
  now: Date,
): { reason: Exclude<ClientVisibilityReason, 'NONE'>; accessUntil: Date | null } {
  if (row.startedAt && !row.finishedAt) {
    return { reason: 'ACTIVE_BOOKING', accessUntil: null }
  }
  if (row.status === BookingStatus.PENDING) {
    return { reason: 'PENDING_BOOKING', accessUntil: null }
  }
  if (row.status === BookingStatus.ACCEPTED && row.scheduledFor >= now) {
    return { reason: 'UPCOMING_ACCEPTED', accessUntil: null }
  }
  // Remaining matched case: COMPLETED within the window.
  const basis = row.finishedAt ?? row.scheduledFor
  return {
    reason: 'RECENT_COMPLETED',
    accessUntil: new Date(basis.getTime() + RECENT_COMPLETED_WINDOW_DAYS * DAY_MS),
  }
}

/**
 * Policy: see proClientVisibilityWhere. Priority is deterministic:
 * ACTIVE > PENDING > UPCOMING_ACCEPTED > RECENT_COMPLETED.
 *
 * Single query: fetch the matching bookings and reduce to the highest-priority
 * reason in JS (so priority is deterministic regardless of row order). For a
 * RECENT_COMPLETED winner, accessUntil is the latest (most generous) cutoff.
 */
export async function getProClientVisibility(
  proId: string,
  clientId: string,
): Promise<ClientVisibilityResult> {
  const now = new Date()

  const rows = await prisma.booking.findMany({
    where: {
      clientId,
      professionalId: proId,
      ...proClientVisibilityWhere(now),
    },
    select: {
      status: true,
      startedAt: true,
      finishedAt: true,
      scheduledFor: true,
    },
    take: 100,
  })

  if (rows.length > 0) {
    let bestRank = Number.POSITIVE_INFINITY
    let bestReason: ClientVisibilityReason = 'NONE'
    let accessUntil: Date | null = null

    for (const row of rows) {
      const c = classifyRow(row, now)
      const rank = REASON_RANK[c.reason]
      if (rank < bestRank) {
        bestRank = rank
        bestReason = c.reason
        accessUntil = c.accessUntil
      } else if (rank === bestRank && c.accessUntil && (!accessUntil || c.accessUntil > accessUntil)) {
        // Same tier (RECENT_COMPLETED): keep the most generous cutoff.
        accessUntil = c.accessUntil
      }
    }

    return {
      canViewClient: true,
      canContactClient: true,
      reason: bestReason,
      accessUntil,
    }
  }

  // No qualifying booking. Two things can still be true, and W5's whole point is
  // that they are DIFFERENT things.

  // 1. The client explicitly granted this pro chart access. Consent is as good a
  //    reason as a booking, and open-ended until they revoke it.
  if (await hasGrantedChartShare(proId, clientId)) {
    return {
      canViewClient: true,
      canContactClient: true,
      reason: 'CHART_SHARE_GRANTED',
      accessUntil: null,
    }
  }

  // 2. A message thread and nothing else — CONTACT ONLY.
  //
  // 🔴 This used to return `canViewClient: true` with `accessUntil: null`, and
  // no consumer branched on `reason`, so it granted read AND WRITE access to the
  // client's whole chart, forever. Joining a waitlist triggered it too, because
  // `seedWaitlistThread` auto-creates a thread — so a client who never messaged
  // anyone handed over their record by tapping "notify me".
  //
  // The pro keeps the conversation and the client's name. Everything clinical
  // now needs the client to say yes (case 1) or a real booking (above).
  if (await hasProClientThread(proId, clientId)) {
    return {
      canViewClient: false,
      canContactClient: true,
      reason: 'ACTIVE_THREAD',
      accessUntil: null,
    }
  }

  return {
    canViewClient: false,
    canContactClient: false,
    reason: 'NONE',
    accessUntil: null,
  }
}

/** Whether a message thread links this pro and client (any context). */
async function hasProClientThread(
  proId: string,
  clientId: string,
): Promise<boolean> {
  const thread = await prisma.messageThread.findFirst({
    where: { professionalId: proId, clientId },
    select: { id: true },
  })
  return thread !== null
}

/**
 * W5: whether the client has an active GRANTED chart share with this pro.
 *
 * Only GRANTED counts. REQUESTED is a pro asking and grants nothing; DECLINED
 * and REVOKED are the client's answer and must not be readable as "no row yet".
 */
async function hasGrantedChartShare(
  proId: string,
  clientId: string,
): Promise<boolean> {
  const share = await prisma.clientChartShare.findUnique({
    where: {
      clientId_professionalId: { clientId, professionalId: proId },
    },
    select: { status: true },
  })

  return share?.status === ClientChartShareStatus.GRANTED
}

/**
 * For list pages: which client ids get a chart LINK for this pro.
 *
 * ⚠️ NOT "getProClientVisibility, batched" — it is deliberately NARROWER. This
 * one is **booking-based only**; the per-client gate also accepts a bare message
 * thread (`ACTIVE_THREAD`). That is the same split described on
 * getProClientVisibility: the clients LIST stays booking-based so inquiry-only
 * contacts don't flood the CRM, while the gate has to let the pro open someone
 * they are only messaging.
 *
 * So a client can legitimately be absent here and still be viewable — a waitlist
 * client the pro has only messaged is exactly that. Consumers must pick the
 * right one: use this to decide whether to render a link, and
 * getProClientVisibility to decide whether access is allowed. Making the two
 * agree is a regression, and `clientVisibility.test.ts` fails if you try.
 */
export async function getVisibleClientIdSetForPro(proId: string): Promise<Set<string>> {
  const now = new Date()

  const rows = await prisma.booking.findMany({
    where: {
      professionalId: proId,
      ...proClientVisibilityWhere(now),
    },
    select: { clientId: true },
    distinct: ['clientId'],
    take: 5000,
  })

  return new Set(rows.map((r) => r.clientId))
}

/**
 * `getProClientVisibility(...).canViewClient`, BATCHED over a known candidate
 * list — for a roster whose rows are NOT all inside the booking window.
 *
 * ⚠️ Not interchangeable with {@link getVisibleClientIdSetForPro}. That one
 * answers "which clients get a chart LINK in a list" and is booking-based on
 * purpose. This one answers the CHART GATE's question for a bounded set of ids,
 * so a list can label each row with the same answer `/pro/clients/[id]` will
 * give — the invariant that breaks the moment a roster query widens past
 * `proClientVisibilityWhere` (booking-less claims union in the pro's own
 * created clients) while its rows still claim to be openable.
 *
 * Chart access is exactly: a qualifying booking OR a GRANTED chart share.
 * A bare thread is deliberately absent — it is CONTACT_ONLY, and
 * `getProClientVisibility` returns `canViewClient: false` for it, so this
 * helper must not ask about threads either (clientVisibility.test.ts asserts
 * the two agree row-for-row).
 */
export async function getChartVisibleClientIdSetForPro(
  proId: string,
  candidateClientIds: readonly string[],
): Promise<Set<string>> {
  if (candidateClientIds.length === 0) return new Set<string>()

  const now = new Date()
  const clientIdIn = { in: [...candidateClientIds] }

  const [bookingRows, shareRows] = await Promise.all([
    prisma.booking.findMany({
      where: {
        professionalId: proId,
        clientId: clientIdIn,
        ...proClientVisibilityWhere(now),
      },
      select: { clientId: true },
      distinct: ['clientId'],
      take: 5000,
    }),
    prisma.clientChartShare.findMany({
      where: {
        professionalId: proId,
        clientId: clientIdIn,
        status: ClientChartShareStatus.GRANTED,
      },
      select: { clientId: true },
      take: 5000,
    }),
  ])

  return new Set([
    ...bookingRows.map((r) => r.clientId),
    ...shareRows.map((r) => r.clientId),
  ])
}

/**
 * Hard-gate for the CHART — everything clinical. Use this in server pages and
 * API routes. Returns a result so the page can choose redirect vs notFound.
 *
 * 🔴 W5: this is the gate that a bare message thread no longer passes. Its ~23
 * call sites did not need editing — the policy change lands here, which is
 * exactly why the rule was funnelled through one function in the first place.
 */
export async function assertProCanViewClient(proId: string, clientId: string) {
  const visibility = await getProClientVisibility(proId, clientId)
  return visibility.canViewClient ? { ok: true as const, visibility } : { ok: false as const, visibility }
}

/**
 * Hard-gate for CONTACT — the client's display name, avatar, and the
 * conversation. Strictly weaker than {@link assertProCanViewClient}.
 *
 * Use this on messaging surfaces. Gating those on the chart assert would trap
 * the pro in the opposite failure: a client who messaged them, and whose chart
 * they correctly cannot see, would also become unanswerable.
 */
export async function assertProCanContactClient(proId: string, clientId: string) {
  const visibility = await getProClientVisibility(proId, clientId)
  return visibility.canContactClient
    ? { ok: true as const, visibility }
    : { ok: false as const, visibility }
}

/**
 * Build the {@link ClientLinkViewer} context for resolving client-name links.
 * A viewing pro gets the batched set of clients they may open (so links upgrade
 * to the chart tab view); everyone else gets an empty set (public links only).
 */
export async function loadClientLinkViewer(
  viewer:
    | { role: string; professionalProfile?: { id: string } | null }
    | null
    | undefined,
): Promise<ClientLinkViewer> {
  if (viewer?.role === 'PRO' && viewer.professionalProfile) {
    return {
      proVisibleClientIds: await getVisibleClientIdSetForPro(
        viewer.professionalProfile.id,
      ),
    }
  }
  return EMPTY_CLIENT_LINK_VIEWER
}
