// lib/privacy/accountDeletion.ts

import {
  AccountDeletionRequestStatus,
  BookingDepositStatus,
  BookingStatus,
  Prisma,
  Role,
  type PrismaClient,
} from '@prisma/client'

import { deleteUserData } from '@/lib/privacy/deleteUserData'
import { summarizeDeleteUserDataResult } from '@/lib/privacy/deleteUserDataSummary'

/**
 * Self-serve account deletion (App Store guideline 5.1.1(v)).
 *
 * The shape is request → grace window → sweep, not delete-on-tap:
 *
 * - the request is recorded and scheduled `ACCOUNT_DELETION_GRACE_PERIOD_DAYS`
 *   out, which is the user's chance to change their mind and the reason a
 *   mis-tap is not an unrecoverable event;
 * - the cron sweep executes anything due through the ONE canonical boundary,
 *   `deleteUserData`, so self-serve and admin deletion can never diverge;
 * - obligations BLOCK the request rather than cascading, because cancelling a
 *   stranger's appointment or abandoning a held deposit is not the user's call
 *   to make silently.
 *
 * Every blocker is clearable by the user themselves, which is what keeps the
 * block from being a dead end: cancel the appointment, let the deposit settle,
 * then delete. Apple requires the path to EXIST and be reachable, not to ignore
 * money and other people's calendars.
 */

/**
 * How long a user has to change their mind.
 *
 * 14 days sits inside the 30-day completion target for account deletion in
 * docs/security/user-data-export-delete.md while being long enough to cover a
 * holiday or a lost phone.
 */
export const ACCOUNT_DELETION_GRACE_PERIOD_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

/** Statuses that mean an appointment is still going to happen. */
const LIVE_BOOKING_STATUSES = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
] as const

/** Statuses that mean an appointment is over, one way or another. */
const TERMINAL_BOOKING_STATUSES = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.NO_SHOW,
] as const

export type AccountDeletionBlockerCode =
  | 'UPCOMING_BOOKINGS_AS_CLIENT'
  | 'UPCOMING_BOOKINGS_AS_PRO'
  | 'DEPOSIT_HELD'
  | 'ADMIN_ACCOUNT'

export type AccountDeletionBlocker = {
  readonly code: AccountDeletionBlockerCode
  /** User-facing copy. Rendered verbatim on web and iOS — never a raw error. */
  readonly message: string
  readonly count: number
}

export type AccountDeletionEligibility = {
  readonly eligible: boolean
  readonly blockers: readonly AccountDeletionBlocker[]
}

export type AccountDeletionRequestView = {
  readonly id: string
  readonly status: AccountDeletionRequestStatus
  readonly requestedAt: string
  readonly scheduledFor: string
}

export type AccountDeletionStatus = {
  readonly gracePeriodDays: number
  readonly eligibility: AccountDeletionEligibility
  /** The open request, when one exists. */
  readonly pendingRequest: AccountDeletionRequestView | null
}

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Why deletion cannot proceed right now.
 *
 * Read-only: safe to call from a GET so the UI can show the obligations BEFORE
 * the user commits to anything.
 */
export async function evaluateAccountDeletionEligibility(args: {
  db: Db
  userId: string
  now?: Date
}): Promise<AccountDeletionEligibility> {
  const now = args.now ?? new Date()

  const user = await args.db.user.findUnique({
    where: { id: args.userId },
    select: {
      id: true,
      role: true,
      clientProfile: { select: { id: true } },
      professionalProfile: { select: { id: true } },
    },
  })

  if (!user) {
    throw new Error(`Cannot evaluate deletion: user not found (${args.userId})`)
  }

  const blockers: AccountDeletionBlocker[] = []

  // An admin deleting themselves through the self-serve path would strip the
  // platform of an operator without anyone approving it. Mirrors
  // SELF_DELETE_BLOCKED on the internal admin route.
  if (user.role === Role.ADMIN) {
    blockers.push({
      code: 'ADMIN_ACCOUNT',
      message:
        'Admin accounts cannot be deleted from the app. Contact support so the change can be reviewed.',
      count: 1,
    })
  }

  const clientProfileId = user.clientProfile?.id ?? null
  const professionalProfileId = user.professionalProfile?.id ?? null

  if (clientProfileId) {
    const upcoming = await args.db.booking.count({
      where: {
        clientId: clientProfileId,
        status: { in: [...LIVE_BOOKING_STATUSES] },
        scheduledFor: { gte: now },
      },
    })

    if (upcoming > 0) {
      blockers.push({
        code: 'UPCOMING_BOOKINGS_AS_CLIENT',
        message:
          upcoming === 1
            ? 'You have 1 upcoming appointment. Cancel it first, then you can delete your account.'
            : `You have ${upcoming} upcoming appointments. Cancel them first, then you can delete your account.`,
        count: upcoming,
      })
    }
  }

  if (professionalProfileId) {
    const upcoming = await args.db.booking.count({
      where: {
        professionalId: professionalProfileId,
        status: { in: [...LIVE_BOOKING_STATUSES] },
        scheduledFor: { gte: now },
      },
    })

    if (upcoming > 0) {
      blockers.push({
        code: 'UPCOMING_BOOKINGS_AS_PRO',
        message:
          upcoming === 1
            ? 'You have 1 upcoming client appointment. Cancel or complete it first — deleting your account will not tell your client.'
            : `You have ${upcoming} upcoming client appointments. Cancel or complete them first — deleting your account will not tell your clients.`,
        count: upcoming,
      })
    }
  }

  // Money still in flight. Deliberately NOT limited to future appointments: a
  // deposit taken on an appointment whose date has passed but which was never
  // closed out is exactly the case that would otherwise be stranded.
  const depositSides = [
    clientProfileId ? { clientId: clientProfileId } : null,
    professionalProfileId ? { professionalId: professionalProfileId } : null,
  ].filter((side): side is NonNullable<typeof side> => side !== null)

  if (depositSides.length > 0) {
    const held = await args.db.booking.count({
      where: {
        OR: depositSides,
        depositStatus: BookingDepositStatus.PAID,
        status: { notIn: [...TERMINAL_BOOKING_STATUSES] },
      },
    })

    if (held > 0) {
      blockers.push({
        code: 'DEPOSIT_HELD',
        message:
          held === 1
            ? 'A deposit is still being held on 1 appointment. It needs to settle or be refunded before your account can be deleted.'
            : `Deposits are still being held on ${held} appointments. They need to settle or be refunded before your account can be deleted.`,
        count: held,
      })
    }
  }

  return { eligible: blockers.length === 0, blockers }
}

function toView(row: {
  id: string
  status: AccountDeletionRequestStatus
  requestedAt: Date
  scheduledFor: Date
}): AccountDeletionRequestView {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    scheduledFor: row.scheduledFor.toISOString(),
  }
}

export async function loadAccountDeletionStatus(args: {
  db: Db
  userId: string
  now?: Date
}): Promise<AccountDeletionStatus> {
  const pending = await args.db.accountDeletionRequest.findFirst({
    where: { userId: args.userId, status: AccountDeletionRequestStatus.PENDING },
    select: {
      id: true,
      status: true,
      requestedAt: true,
      scheduledFor: true,
    },
  })

  return {
    gracePeriodDays: ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
    eligibility: await evaluateAccountDeletionEligibility(args),
    pendingRequest: pending ? toView(pending) : null,
  }
}

export type RequestAccountDeletionResult =
  | { ok: true; request: AccountDeletionRequestView }
  | { ok: false; code: 'BLOCKED'; blockers: readonly AccountDeletionBlocker[] }
  | { ok: false; code: 'ALREADY_PENDING'; request: AccountDeletionRequestView }
  | { ok: false; code: 'CONFIRMATION_MISMATCH' }

/**
 * Does the text the user typed match the address on their account?
 *
 * Lives here rather than in the route so the account email is read inside an
 * approved privacy helper — the `check:pii-plaintext-reads` guard exists to
 * keep exactly this comparison from spreading into handlers.
 *
 * Re-confirmation is typed email, deliberately NOT a password: Apple and Google
 * sign-in accounts are created with a random password the user never learns
 * (lib/auth/findOrCreateAppleUser.ts), so a password gate would make deletion
 * impossible for precisely the users whose app store requires it.
 */
async function confirmationMatchesAccount(args: {
  db: Db
  userId: string
  typed: string
}): Promise<boolean> {
  const user = await args.db.user.findUnique({
    where: { id: args.userId },
    select: { email: true },
  })

  if (!user) return false

  return user.email.trim().toLowerCase() === args.typed.trim().toLowerCase()
}

/**
 * Open a deletion window.
 *
 * Re-checks eligibility inside the same call rather than trusting whatever the
 * client last read — the appointment could have been booked between the GET
 * and the POST.
 */
export async function requestAccountDeletion(args: {
  db: PrismaClient
  userId: string
  /** The address the user typed to confirm. Omitted only by tests/internals. */
  confirmEmail?: string
  reason?: string | null
  now?: Date
}): Promise<RequestAccountDeletionResult> {
  const now = args.now ?? new Date()

  if (args.confirmEmail !== undefined) {
    const matches = await confirmationMatchesAccount({
      db: args.db,
      userId: args.userId,
      typed: args.confirmEmail,
    })
    if (!matches) return { ok: false, code: 'CONFIRMATION_MISMATCH' }
  }

  const eligibility = await evaluateAccountDeletionEligibility({
    db: args.db,
    userId: args.userId,
    now,
  })

  if (!eligibility.eligible) {
    return { ok: false, code: 'BLOCKED', blockers: eligibility.blockers }
  }

  const scheduledFor = new Date(
    now.getTime() + ACCOUNT_DELETION_GRACE_PERIOD_DAYS * DAY_MS,
  )

  try {
    const created = await args.db.accountDeletionRequest.create({
      data: {
        userId: args.userId,
        status: AccountDeletionRequestStatus.PENDING,
        requestedAt: now,
        scheduledFor,
        reason: args.reason?.trim() ? args.reason.trim().slice(0, 500) : null,
      },
      select: {
        id: true,
        status: true,
        requestedAt: true,
        scheduledFor: true,
      },
    })

    return { ok: true, request: toView(created) }
  } catch (error: unknown) {
    // The partial unique index is the real guard against a double-tap opening
    // two windows; catching its violation is how a race reports cleanly
    // instead of 500ing.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await args.db.accountDeletionRequest.findFirst({
        where: {
          userId: args.userId,
          status: AccountDeletionRequestStatus.PENDING,
        },
        select: {
          id: true,
          status: true,
          requestedAt: true,
          scheduledFor: true,
        },
      })

      if (existing) {
        return { ok: false, code: 'ALREADY_PENDING', request: toView(existing) }
      }
    }

    throw error
  }
}

export type CancelAccountDeletionResult =
  | { ok: true; request: AccountDeletionRequestView }
  | { ok: false; code: 'NOT_PENDING' }

export async function cancelAccountDeletion(args: {
  db: Db
  userId: string
  now?: Date
}): Promise<CancelAccountDeletionResult> {
  const now = args.now ?? new Date()

  const pending = await args.db.accountDeletionRequest.findFirst({
    where: { userId: args.userId, status: AccountDeletionRequestStatus.PENDING },
    select: { id: true },
  })

  if (!pending) return { ok: false, code: 'NOT_PENDING' }

  const cancelled = await args.db.accountDeletionRequest.update({
    where: { id: pending.id },
    data: {
      status: AccountDeletionRequestStatus.CANCELLED,
      cancelledAt: now,
    },
    select: { id: true, status: true, requestedAt: true, scheduledFor: true },
  })

  return { ok: true, request: toView(cancelled) }
}

/**
 * Widen the summary into Prisma's JSON input type by rebuilding it field by
 * field.
 *
 * Deliberately explicit rather than a cast: the house rule bans type escapes,
 * and a `JSON.parse(JSON.stringify(...))` round-trip would launder the shape
 * through `any` just as effectively while hiding it better. Written out, a
 * field added to the summary that is not JSON-safe fails to compile here.
 */
function summaryToJson(
  summary: ReturnType<typeof summarizeDeleteUserDataResult>,
): Prisma.InputJsonObject {
  return {
    version: summary.version,
    executedAt: summary.executedAt,
    mode: summary.mode,
    subject: {
      userId: summary.subject.userId,
      clientProfileId: summary.subject.clientProfileId,
      professionalProfileId: summary.subject.professionalProfileId,
    },
    requestedByUserId: summary.requestedByUserId,
    actionCounts: { ...summary.actionCounts },
    actions: summary.actions.map((action) => ({
      model: action.model,
      action: action.action,
      count: action.count,
    })),
    limitations: summary.limitations,
    limitationsCount: summary.limitationsCount,
    requiresManualFollowUp: summary.requiresManualFollowUp,
  }
}

export type ExecuteDueDeletionsResult = {
  readonly considered: number
  readonly completed: number
  readonly failed: number
  /** Due, but an obligation appeared during the window. Left PENDING. */
  readonly deferred: number
}

/**
 * Execute every request whose grace window has closed.
 *
 * Each request runs in its OWN transaction. A refusal or error on one account
 * must not poison the rest of the sweep — a caught error still aborts the
 * surrounding transaction, so batching them would silently roll back the
 * deletions that did succeed.
 *
 * ⚠️ Eligibility is re-checked HERE, not just at request time. Nothing stops a
 * user from booking an appointment during the grace window, so a request that
 * was eligible on day 0 can be ineligible on day 14 — and executing it anyway
 * would anonymize a client into an appointment a pro is about to work. A
 * request that has acquired an obligation stays PENDING and is retried on the
 * next sweep rather than being failed or forced through: the user still leaves,
 * just after the appointment they made does.
 */
export async function executeDueAccountDeletions(args: {
  db: PrismaClient
  now?: Date
  limit?: number
}): Promise<ExecuteDueDeletionsResult> {
  const now = args.now ?? new Date()
  const limit = args.limit ?? 25

  const due = await args.db.accountDeletionRequest.findMany({
    where: {
      status: AccountDeletionRequestStatus.PENDING,
      scheduledFor: { lte: now },
    },
    orderBy: { scheduledFor: 'asc' },
    take: limit,
    select: { id: true, userId: true },
  })

  let completed = 0
  let failed = 0
  let deferred = 0

  for (const request of due) {
    const eligibility = await evaluateAccountDeletionEligibility({
      db: args.db,
      userId: request.userId,
      now,
    })

    if (!eligibility.eligible) {
      deferred += 1
      continue
    }

    try {
      await args.db.$transaction(async (tx) => {
        const result = await deleteUserData({
          db: tx,
          userId: request.userId,
          mode: 'ANONYMIZE',
          requestedByUserId: request.userId,
          reason: `Self-serve account deletion request ${request.id}`,
        })

        await tx.accountDeletionRequest.update({
          where: { id: request.id },
          data: {
            status: AccountDeletionRequestStatus.COMPLETED,
            completedAt: new Date(),
            resultJson: summaryToJson(summarizeDeleteUserDataResult(result)),
          },
        })
      })
      completed += 1
    } catch (error: unknown) {
      failed += 1
      // Recorded, not retried forever: a request that keeps failing is an
      // operator problem, and a silent retry loop would hide it.
      await args.db.accountDeletionRequest.update({
        where: { id: request.id },
        data: {
          status: AccountDeletionRequestStatus.FAILED,
          failureCount: { increment: 1 },
          lastFailureAt: new Date(),
          lastFailureMessage:
            error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
        },
      })
    }
  }

  return { considered: due.length, completed, failed, deferred }
}
