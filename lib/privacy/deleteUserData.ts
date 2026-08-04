// lib/privacy/deleteUserData.ts

import { Prisma, type PrismaClient } from '@prisma/client'

import {
  DELETE_RULES,
  type DeleteSubject,
  type PrivacyDb,
} from '@/lib/privacy/deleteRules'

export type DeleteUserDataMode = 'DRY_RUN' | 'ANONYMIZE'

export type DeleteUserDataInput = {
  db: PrismaClient | Prisma.TransactionClient
  userId: string
  mode: DeleteUserDataMode
  requestedByUserId: string
  reason: string
}

export type DeleteUserDataResult = {
  executedAt: string
  mode: DeleteUserDataMode
  subject: {
    userId: string
    clientProfileId: string | null
    professionalProfileId: string | null
  }
  requestedByUserId: string
  reason: string
  actions: DeleteUserDataActionResult[]
  limitations: readonly string[]
}

export type DeleteUserDataActionResult = {
  model: string
  action: 'WOULD_DELETE' | 'WOULD_ANONYMIZE' | 'DELETED' | 'ANONYMIZED' | 'SKIPPED'
  count: number
  notes?: string
}

type UserWithProfiles = Prisma.UserGetPayload<{
  include: {
    clientProfile: true
    professionalProfile: true
  }
}>

const EXPORTABLE_PRIVACY_DELETE_VERSION = 1

// Valid bcrypt hash for an intentionally unknown random password.
// Keeps deleted users unable to log in while preserving bcrypt-shaped data
// for auth code that expects User.password to be a bcrypt hash.
const DELETED_USER_PASSWORD_SENTINEL =
  '$2b$12$9NDZhwWiWa7NkQ1NA9w0/eRcYJ6HQtZUhlLk9d7uQdIKgMxHdKAri'

/**
 * Canonical user data deletion/anonymization boundary.
 *
 * This is intentionally conservative:
 * - default caller should use DRY_RUN first
 * - profile/user records are anonymized, not hard-deleted
 * - relationship-heavy models that need schema-specific traversal are listed as
 *   limitations instead of guessed
 *
 * Routes/admin tools should call this one function rather than deleting privacy
 * data ad hoc.
 */
export async function deleteUserData(
  input: DeleteUserDataInput,
): Promise<DeleteUserDataResult> {
  if (input.mode === 'ANONYMIZE' && canRunTransaction(input.db)) {
    return input.db.$transaction((tx) =>
      executeDeleteUserData({
        ...input,
        db: tx,
      }),
    )
  }

  return executeDeleteUserData(input)
}

async function executeDeleteUserData(
  input: DeleteUserDataInput,
): Promise<DeleteUserDataResult> {
  const user = await input.db.user.findUnique({
    where: { id: input.userId },
    include: {
      clientProfile: true,
      professionalProfile: true,
    },
  })

  if (!user) {
    throw new Error(`Cannot delete user data: user not found (${input.userId})`)
  }

  const clientProfileId = user.clientProfile?.id ?? null
  const professionalProfileId = user.professionalProfile?.id ?? null
  const subject: DeleteSubject = {
    userId: input.userId,
    clientProfileId,
    professionalProfileId,
  }
  const actions: DeleteUserDataActionResult[] = []

  // The rule table first, in declaration order: pre-steps inside a rule clear
  // the rows that would otherwise raise a foreign-key violation, so the order
  // within `DELETE_RULES` is load-bearing and must not be sorted.
  for (const rule of DELETE_RULES) {
    actions.push(await runRule(rule, input.db, subject, input.mode))
  }

  // Then the three subject rows, whose replacement values depend on the row.
  actions.push(
    await anonymizeClientProfile(input.db, input.mode, user),
    await anonymizeProfessionalProfile(input.db, input.mode, user),
    await anonymizeUser(input.db, input.mode, user),
  )

  return {
    executedAt: new Date().toISOString(),
    mode: input.mode,
    subject: {
      userId: input.userId,
      clientProfileId,
      professionalProfileId,
    },
    requestedByUserId: input.requestedByUserId,
    reason: input.reason,
    actions,
    limitations: DELETE_USER_DATA_LIMITATIONS,
  }
}

/**
 * Run one table rule in the requested mode.
 *
 * A rule whose `where` builder returns null does not apply to this subject —
 * a client-only model when the subject has no client profile, say — and is
 * reported SKIPPED rather than counted as zero, so "nothing to delete" stays
 * distinguishable from "not looked at".
 */
async function runRule(
  rule: (typeof DELETE_RULES)[number],
  db: PrivacyDb,
  subject: DeleteSubject,
  mode: DeleteUserDataMode,
): Promise<DeleteUserDataActionResult> {
  if (mode === 'DRY_RUN') {
    const count = await rule.count(db, subject)
    if (count === null) {
      return skipped(rule.model, 'Not applicable to this subject.')
    }
    return {
      model: rule.model,
      action: rule.action === 'DELETE' ? 'WOULD_DELETE' : 'WOULD_ANONYMIZE',
      count,
      ...(rule.notes ? { notes: rule.notes } : {}),
    }
  }

  const count = await rule.apply(db, subject)
  if (count === null) {
    return skipped(rule.model, 'Not applicable to this subject.')
  }

  return {
    model: rule.model,
    action: rule.action === 'DELETE' ? 'DELETED' : 'ANONYMIZED',
    count,
    ...(rule.notes ? { notes: rule.notes } : {}),
  }
}

async function anonymizeClientProfile(
  db: PrismaClient | Prisma.TransactionClient,
  mode: DeleteUserDataMode,
  user: UserWithProfiles,
): Promise<DeleteUserDataActionResult> {
  if (!user.clientProfile) {
    return skipped('ClientProfile', 'No client profile.')
  }

  if (mode === 'DRY_RUN') {
    return {
      model: 'ClientProfile',
      action: 'WOULD_ANONYMIZE',
      count: 1,
    }
  }

  await db.clientProfile.update({
    where: { id: user.clientProfile.id },
    data: {
      firstName: 'Deleted',
      lastName: 'User',
      email: null,
      phone: null,
      dateOfBirth: null,

      // HMAC v2 lookup fields. These must be cleared during anonymization so
      // deleted users do not retain contact blind-index identifiers.
      emailHashV2: null,
      emailHashKeyVersion: null,
      phoneHashV2: null,
      phoneHashKeyVersion: null,
    },
  })

  return {
    model: 'ClientProfile',
    action: 'ANONYMIZED',
    count: 1,
  }
}

async function anonymizeProfessionalProfile(
  db: PrismaClient | Prisma.TransactionClient,
  mode: DeleteUserDataMode,
  user: UserWithProfiles,
): Promise<DeleteUserDataActionResult> {
  if (!user.professionalProfile) {
    return skipped('ProfessionalProfile', 'No professional profile.')
  }

  if (mode === 'DRY_RUN') {
    return {
      model: 'ProfessionalProfile',
      action: 'WOULD_ANONYMIZE',
      count: 1,
    }
  }

  await db.professionalProfile.update({
    where: { id: user.professionalProfile.id },
    data: {
      firstName: 'Deleted',
      lastName: 'Professional',
      phone: null,
      bio: null,
    },
  })

  return {
    model: 'ProfessionalProfile',
    action: 'ANONYMIZED',
    count: 1,
  }
}

async function anonymizeUser(
  db: PrismaClient | Prisma.TransactionClient,
  mode: DeleteUserDataMode,
  user: UserWithProfiles,
): Promise<DeleteUserDataActionResult> {
  if (mode === 'DRY_RUN') {
    return {
      model: 'User',
      action: 'WOULD_ANONYMIZE',
      count: 1,
    }
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      email: deletedEmail(user.id),
      phone: null,

      // HMAC v2 lookup fields. These must be cleared during anonymization so
      // deleted users do not retain contact blind-index identifiers.
      emailHashV2: null,
      emailHashKeyVersion: null,
      phoneHashV2: null,
      phoneHashKeyVersion: null,

      password: DELETED_USER_PASSWORD_SENTINEL,
    },
  })

  return {
    model: 'User',
    action: 'ANONYMIZED',
    count: 1,
  }
}

function deletedEmail(userId: string): string {
  return `deleted-${userId}@deleted.tovis.local`
}

/**
 * What a completed deletion still does NOT do.
 *
 * Every entry here is a decision recorded in `lib/privacy/deleteBoundary.ts`,
 * not an oversight — read that registry for the per-model reasoning.
 */
export const DELETE_USER_DATA_LIMITATIONS: readonly string[] = [
  'Bookings, refunds, product sales and payout settings are RETAINED as financial records; the subject is de-identified through the User/profile anonymization rather than by deleting them. Booking-level field anonymization (address snapshots, free-text notes) is still deferred.',
  'Messages and conversation threads are RETAINED for the other participant; the departed participant is de-identified. Message body deletion is deferred pending a product/legal call.',
  'Verification documents are RETAINED pending an explicit product decision, so licence/ID imagery outlives a self-serve deletion.',
  'Storage object bytes are not deleted here. MediaAsset and PracticeShot DB rows are removed, but Supabase object deletion requires a separate storage write boundary.',
  'Payment methods are removed from our database, but detaching them at Stripe is a separate provider-side boundary.',
  'Audit, admin and moderation records are RETAINED by design.',
  'Tenant-level deletion/export is a separate workflow.',
]

function canRunTransaction(
  db: PrismaClient | Prisma.TransactionClient,
): db is PrismaClient {
  return '$transaction' in db && typeof db.$transaction === 'function'
} 

function skipped(model: string, notes: string): DeleteUserDataActionResult {
  return {
    model,
    action: 'SKIPPED',
    count: 0,
    notes,
  }
}

export const USER_DATA_DELETE_VERSION = EXPORTABLE_PRIVACY_DELETE_VERSION