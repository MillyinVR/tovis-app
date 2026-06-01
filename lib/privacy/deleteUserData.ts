// lib/privacy/deleteUserData.ts

import { Prisma, type PrismaClient } from '@prisma/client'

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
  limitations: string[]
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
  const actions: DeleteUserDataActionResult[] = []

  actions.push(
    await deleteClientAddresses(input.db, input.mode, clientProfileId),
    await deleteProfessionalLocations(
      input.db,
      input.mode,
      professionalProfileId,
    ),
    await deleteBookingHolds(
      input.db,
      input.mode,
      clientProfileId,
      professionalProfileId,
    ),
    await deleteClientActionTokens(input.db, input.mode, clientProfileId),
    await deleteMediaAssets(
      input.db,
      input.mode,
      input.userId,
      clientProfileId,
      professionalProfileId,
    ),
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
    limitations: [
      'Bookings are not hard-deleted because they are financial/operational records; implement booking-level anonymization after legal retention policy is finalized.',
      'Messages are not deleted in this first boundary because conversation ownership and retention policy need explicit product/legal review.',
      'Notifications and notification deliveries are not deleted until their real recipient relation is wired into this boundary.',
      'AftercareSummary export/delete is temporarily omitted until wired through the real Booking/Aftercare relation.',
      'AttributionEvent export/delete is temporarily omitted until wired through the real attribution identity fields.',
      'AdminActionLog export/delete is temporarily omitted until wired through the real admin audit schema fields.',
      'Storage object bytes are not deleted here; MediaAsset DB rows are handled, but Supabase object deletion requires a separate storage write boundary.',
      'Tenant-level deletion/export is a separate workflow.',
    ],
  }
}

async function deleteClientAddresses(
  db: PrismaClient | Prisma.TransactionClient,
  mode: DeleteUserDataMode,
  clientProfileId: string | null,
): Promise<DeleteUserDataActionResult> {
  if (!clientProfileId) {
    return skipped('ClientAddress', 'No client profile.')
  }

  const where = { clientId: clientProfileId }
  const count = await db.clientAddress.count({ where })

  if (mode === 'DRY_RUN') {
    return {
      model: 'ClientAddress',
      action: 'WOULD_DELETE',
      count,
    }
  }

  const result = await db.clientAddress.deleteMany({ where })

  return {
    model: 'ClientAddress',
    action: 'DELETED',
    count: result.count,
  }
}

async function deleteProfessionalLocations(
  db: PrismaClient | Prisma.TransactionClient,
  mode: DeleteUserDataMode,
  professionalProfileId: string | null,
): Promise<DeleteUserDataActionResult> {
  if (!professionalProfileId) {
    return skipped('ProfessionalLocation', 'No professional profile.')
  }

  const where = { professionalId: professionalProfileId }
  const count = await db.professionalLocation.count({ where })

  if (mode === 'DRY_RUN') {
    return {
      model: 'ProfessionalLocation',
      action: 'WOULD_DELETE',
      count,
    }
  }

  const result = await db.professionalLocation.deleteMany({ where })

  return {
    model: 'ProfessionalLocation',
    action: 'DELETED',
    count: result.count,
  }
}

async function deleteBookingHolds(
  db: PrismaClient | Prisma.TransactionClient,
  mode: DeleteUserDataMode,
  clientProfileId: string | null,
  professionalProfileId: string | null,
): Promise<DeleteUserDataActionResult> {
  const where = {
    OR: compactWhere([
      clientProfileId ? { clientId: clientProfileId } : null,
      professionalProfileId ? { professionalId: professionalProfileId } : null,
    ]),
  }

  if (where.OR.length === 0) {
    return skipped('BookingHold', 'No client/professional profile.')
  }

  const count = await db.bookingHold.count({ where })

  if (mode === 'DRY_RUN') {
    return {
      model: 'BookingHold',
      action: 'WOULD_DELETE',
      count,
    }
  }

  const result = await db.bookingHold.deleteMany({ where })

  return {
    model: 'BookingHold',
    action: 'DELETED',
    count: result.count,
  }
}

async function deleteClientActionTokens(
  db: PrismaClient | Prisma.TransactionClient,
  mode: DeleteUserDataMode,
  clientProfileId: string | null,
): Promise<DeleteUserDataActionResult> {
  if (!clientProfileId) {
    return skipped('ClientActionToken', 'No client profile.')
  }

  const where = { clientId: clientProfileId }
  const count = await db.clientActionToken.count({ where })

  if (mode === 'DRY_RUN') {
    return {
      model: 'ClientActionToken',
      action: 'WOULD_DELETE',
      count,
    }
  }

  const result = await db.clientActionToken.deleteMany({ where })

  return {
    model: 'ClientActionToken',
    action: 'DELETED',
    count: result.count,
  }
}

async function deleteMediaAssets(
  db: PrismaClient | Prisma.TransactionClient,
  mode: DeleteUserDataMode,
  userId: string,
  clientProfileId: string | null,
  professionalProfileId: string | null,
): Promise<DeleteUserDataActionResult> {
  const where = {
    OR: compactWhere([
      { ownerUserId: userId },
      clientProfileId ? { clientId: clientProfileId } : null,
      professionalProfileId ? { professionalId: professionalProfileId } : null,
    ]),
  }

  const count = await db.mediaAsset.count({ where })

  if (mode === 'DRY_RUN') {
    return {
      model: 'MediaAsset',
      action: 'WOULD_DELETE',
      count,
      notes:
        'Deletes DB rows only. Storage object deletion must run through the media/storage write boundary.',
    }
  }

  const result = await db.mediaAsset.deleteMany({ where })

  return {
    model: 'MediaAsset',
    action: 'DELETED',
    count: result.count,
    notes:
      'Deleted DB rows only. Storage object deletion must run through the media/storage write boundary.',
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

      // Legacy SHA-256 lookup fields.
      emailHash: null,
      phoneHash: null,

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

      // Legacy SHA-256 lookup fields.
      emailHash: null,
      phoneHash: null,

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

function compactWhere<T>(items: Array<T | null>): T[] {
  return items.filter((item): item is T => item !== null)
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