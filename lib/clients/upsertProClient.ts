// lib/clients/upsertProClient.ts

import { ClientClaimStatus, Prisma, Role } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  emailLookupHash,
  phoneLookupHash,
} from '@/lib/security/crypto/hashLookup'
import {
  buildClientProfileContactLookupData,
  buildEmailLookupHashV2ForContactInput,
  buildPhoneLookupHashV2ForContactInput,
} from '@/lib/security/contactLookup'
import { normalizeContactInput } from '@/lib/security/contactNormalization'

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function normalizeRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function hasMeaningfulValue(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isUniqueViolation(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

const CLIENT_PROFILE_IDENTITY_SELECT = {
  id: true,
  userId: true,
  claimStatus: true,
  claimedAt: true,
  firstName: true,
  lastName: true,
  email: true,
  emailHash: true,
  emailHashV2: true,
  emailHashKeyVersion: true,
  phone: true,
  phoneHash: true,
  phoneHashV2: true,
  phoneHashKeyVersion: true,
  user: {
    select: {
      id: true,
      role: true,
      email: true,
      emailHash: true,
      emailHashV2: true,
      emailHashKeyVersion: true,
      phone: true,
      phoneHash: true,
      phoneHashV2: true,
      phoneHashKeyVersion: true,
    },
  },
} satisfies Prisma.ClientProfileSelect

type ClientProfileIdentityRecord = Prisma.ClientProfileGetPayload<{
  select: typeof CLIENT_PROFILE_IDENTITY_SELECT
}>

const USER_IDENTITY_SELECT = {
  id: true,
  role: true,
  email: true,
  emailHash: true,
  emailHashV2: true,
  emailHashKeyVersion: true,
  phone: true,
  phoneHash: true,
  phoneHashV2: true,
  phoneHashKeyVersion: true,
  clientProfile: {
    select: CLIENT_PROFILE_IDENTITY_SELECT,
  },
} satisfies Prisma.UserSelect

type UserIdentityRecord = Prisma.UserGetPayload<{
  select: typeof USER_IDENTITY_SELECT
}>

type FindMatchedClientProfileResult =
  | { kind: 'none' }
  | { kind: 'conflict' }
  | { kind: 'profile'; profile: ClientProfileIdentityRecord }

type FindMatchedClientUserResult =
  | { kind: 'none' }
  | { kind: 'conflict' }
  | { kind: 'non_client' }
  | { kind: 'client'; user: UserIdentityRecord }

function buildClientProfileLookupOrConditions(args: {
  email: string | null
  phone: string | null
}): Prisma.ClientProfileWhereInput[] {
  const lookupEmail =
    args.email // pii-plaintext-read-ok: pro-client contact matching passes canonical email into security blind-index helper
  const lookupPhone =
    args.phone // pii-plaintext-read-ok: pro-client contact matching passes canonical phone into security blind-index helper

  const emailHashV2 = buildEmailLookupHashV2ForContactInput(lookupEmail)
  const phoneHashV2 = buildPhoneLookupHashV2ForContactInput(lookupPhone)
  const emailHash = emailLookupHash(lookupEmail)
  const phoneHash = phoneLookupHash(lookupPhone)

  const orConditions: Prisma.ClientProfileWhereInput[] = []

  if (emailHashV2) {
    orConditions.push({
      emailHashV2: emailHashV2.hash,
      emailHashKeyVersion: emailHashV2.keyVersion,
    })
  }

  if (phoneHashV2) {
    orConditions.push({
      phoneHashV2: phoneHashV2.hash,
      phoneHashKeyVersion: phoneHashV2.keyVersion,
    })
  }

  /**
   * Legacy SHA-256 fallback for rows created before HMAC v2 backfill.
   * Remove after burn-in and legacy hash column drop.
   */
  if (emailHash) {
    orConditions.push({ emailHash })
  }

  if (phoneHash) {
    orConditions.push({ phoneHash })
  }

  return orConditions
}

function buildUserLookupOrConditions(args: {
  email: string | null
  phone: string | null
}): Prisma.UserWhereInput[] {
  const lookupEmail =
    args.email // pii-plaintext-read-ok: user contact matching passes canonical email into security blind-index helper
  const lookupPhone =
    args.phone // pii-plaintext-read-ok: user contact matching passes canonical phone into security blind-index helper

  const emailHashV2 = buildEmailLookupHashV2ForContactInput(lookupEmail)
  const phoneHashV2 = buildPhoneLookupHashV2ForContactInput(lookupPhone)
  const emailHash = emailLookupHash(lookupEmail)
  const phoneHash = phoneLookupHash(lookupPhone)

  const orConditions: Prisma.UserWhereInput[] = []

  if (emailHashV2) {
    orConditions.push({
      emailHashV2: emailHashV2.hash,
      emailHashKeyVersion: emailHashV2.keyVersion,
    })
  }

  if (phoneHashV2) {
    orConditions.push({
      phoneHashV2: phoneHashV2.hash,
      phoneHashKeyVersion: phoneHashV2.keyVersion,
    })
  }

  /**
   * Legacy SHA-256 fallback for rows created before HMAC v2 backfill.
   * Remove after burn-in and legacy hash column drop.
   */
  if (emailHash) {
    orConditions.push({ emailHash })
  }

  if (phoneHash) {
    orConditions.push({ phoneHash })
  }

  return orConditions
}

async function findMatchedClientProfile(args: {
  db: DbClient
  email: string | null
  phone: string | null
}): Promise<FindMatchedClientProfileResult> {
  const orConditions = buildClientProfileLookupOrConditions({
    email: args.email,
    phone: args.phone,
  })

  if (orConditions.length === 0) {
    return { kind: 'none' }
  }

  const profiles = await args.db.clientProfile.findMany({
    where: {
      OR: orConditions,
    },
    select: CLIENT_PROFILE_IDENTITY_SELECT,
    take: 2,
  })

  if (profiles.length === 0) {
    return { kind: 'none' }
  }

  const uniqueProfileIds = new Set(profiles.map((profile) => profile.id))

  if (uniqueProfileIds.size > 1) {
    return { kind: 'conflict' }
  }

  const profile = profiles[0]
  if (!profile) {
    return { kind: 'none' }
  }

  return { kind: 'profile', profile }
}

async function findMatchedClientUser(args: {
  db: DbClient
  email: string | null
  phone: string | null
}): Promise<FindMatchedClientUserResult> {
  const orConditions = buildUserLookupOrConditions({
    email: args.email,
    phone: args.phone,
  })

  if (orConditions.length === 0) {
    return { kind: 'none' }
  }

  const users = await args.db.user.findMany({
    where: {
      OR: orConditions,
    },
    select: USER_IDENTITY_SELECT,
    take: 2,
  })

  if (users.length === 0) {
    return { kind: 'none' }
  }

  const uniqueUserIds = new Set(users.map((user) => user.id))

  if (uniqueUserIds.size > 1) {
    return { kind: 'conflict' }
  }

  const user = users[0]
  if (!user) {
    return { kind: 'none' }
  }

  if (user.role !== Role.CLIENT) {
    return { kind: 'non_client' }
  }

  return { kind: 'client', user }
}

function buildMatchedProfileUpdateData(args: {
  profile: ClientProfileIdentityRecord
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
}): Prisma.ClientProfileUpdateInput {
  const { profile, firstName, lastName, email, phone } = args
  const now = new Date()

  const emailContactData =
    email != null ? buildClientProfileContactLookupData({ email }) : {}

  const phoneContactData =
    phone != null ? buildClientProfileContactLookupData({ phone }) : {}

  const emailPatch =
    email &&
    (profile.email == null || // pii-plaintext-read-ok: expand-phase contact repair only checks whether profile email is already populated
      profile.emailHash == null ||
      profile.emailHashV2 == null ||
      profile.emailHashKeyVersion == null)
      ? {
          ...(profile.email == null ? { email } : {}), // pii-plaintext-read-ok: expand-phase contact repair writes email only when profile email is missing
          ...emailContactData,
        }
      : {}

  const phonePatch =
    phone &&
    (profile.phone == null || // pii-plaintext-read-ok: expand-phase contact repair only checks whether profile phone is already populated
      profile.phoneHash == null ||
      profile.phoneHashV2 == null ||
      profile.phoneHashKeyVersion == null)
      ? {
          ...(profile.phone == null ? { phone } : {}), // pii-plaintext-read-ok: expand-phase contact repair writes phone only when profile phone is missing
          ...phoneContactData,
        }
      : {}

  return {
    ...(!hasMeaningfulValue(profile.firstName) ? { firstName } : {}),
    ...(!hasMeaningfulValue(profile.lastName) ? { lastName } : {}),
    ...emailPatch,
    ...phonePatch,
    ...(profile.userId != null &&
    profile.claimStatus !== ClientClaimStatus.CLAIMED
      ? {
          claimStatus: ClientClaimStatus.CLAIMED,
          claimedAt: now,
        }
      : {}),
    ...(profile.userId != null &&
    profile.claimStatus === ClientClaimStatus.CLAIMED &&
    profile.claimedAt == null
      ? {
          claimedAt: now,
        }
      : {}),
    ...(profile.userId == null &&
    profile.claimStatus !== ClientClaimStatus.UNCLAIMED
      ? {
          claimStatus: ClientClaimStatus.UNCLAIMED,
          claimedAt: null,
        }
      : {}),
  }
}

function toSuccessfulResult(profile: {
  id: string
  userId: string | null
  claimStatus: ClientClaimStatus
  email: string | null
  user?: {
    email: string | null
  } | null
}): UpsertProClientResult {
  return {
    ok: true,
    clientId: profile.id,
    userId: profile.userId,
    email: profile.email ?? profile.user?.email ?? null,
    claimStatus: profile.claimStatus,
  }
}

export type UpsertProClientArgs = {
  firstName: unknown
  lastName: unknown
  email?: unknown
  phone?: unknown
  tx?: Prisma.TransactionClient
}

export type UpsertProClientResult =
  | {
      ok: true
      clientId: string
      userId: string | null
      email: string | null
      claimStatus: ClientClaimStatus
    }
  | {
      ok: false
      status: number
      error: string
      code:
        | 'VALIDATION_ERROR'
        | 'IDENTITY_CONFLICT'
        | 'CONTACT_IN_USE_BY_NON_CLIENT'
        | 'DATA_INTEGRITY_ERROR'
    }

export async function upsertProClient(
  args: UpsertProClientArgs,
): Promise<UpsertProClientResult> {
  const db = getDb(args.tx)

  const firstName = normalizeRequiredString(args.firstName)
  const lastName = normalizeRequiredString(args.lastName)
  const { email, phone } = normalizeContactInput(args)

  if (!firstName || !lastName || (!email && !phone)) {
    return {
      ok: false,
      status: 400,
      error: 'First name, last name, and either email or phone are required.',
      code: 'VALIDATION_ERROR',
    }
  }

  const matchedProfileResult = await findMatchedClientProfile({
    db,
    email,
    phone,
  })

  if (matchedProfileResult.kind === 'conflict') {
    return {
      ok: false,
      status: 409,
      error:
        'That email and phone match different client profiles. Please double check with the client before continuing.',
      code: 'IDENTITY_CONFLICT',
    }
  }

  if (matchedProfileResult.kind === 'profile') {
    const profile = matchedProfileResult.profile

    if (profile.user && profile.user.role !== Role.CLIENT) {
      return {
        ok: false,
        status: 409,
        error:
          'Matched client profile is linked to a non-client user. Please resolve this before continuing.',
        code: 'DATA_INTEGRITY_ERROR',
      }
    }

    const updateData = buildMatchedProfileUpdateData({
      profile,
      firstName,
      lastName,
      email,
      phone,
    })

    const updatedProfile =
      Object.keys(updateData).length > 0
        ? await db.clientProfile.update({
            where: { id: profile.id },
            data: updateData,
            select: CLIENT_PROFILE_IDENTITY_SELECT,
          })
        : profile

    return toSuccessfulResult(updatedProfile)
  }

  const matchedUserResult = await findMatchedClientUser({
    db,
    email,
    phone,
  })

  if (matchedUserResult.kind === 'conflict') {
    return {
      ok: false,
      status: 409,
      error:
        'That email and phone match different user accounts. Please double check with the client before continuing.',
      code: 'IDENTITY_CONFLICT',
    }
  }

  if (matchedUserResult.kind === 'non_client') {
    return {
      ok: false,
      status: 409,
      error: 'That email or phone is already used by a non-client account.',
      code: 'CONTACT_IN_USE_BY_NON_CLIENT',
    }
  }

  if (matchedUserResult.kind === 'client') {
    const matchedUser = matchedUserResult.user

    if (matchedUser.clientProfile) {
      const profile = matchedUser.clientProfile

      const updateData = buildMatchedProfileUpdateData({
        profile,
        firstName,
        lastName,
        email: email ?? matchedUser.email ?? null,
        phone: phone ?? matchedUser.phone ?? null,
      })

      const updatedProfile =
        Object.keys(updateData).length > 0
          ? await db.clientProfile.update({
              where: { id: profile.id },
              data: updateData,
              select: CLIENT_PROFILE_IDENTITY_SELECT,
            })
          : profile

      return toSuccessfulResult(updatedProfile)
    }

    try {
      const profileEmail = email ?? matchedUser.email ?? null
      const profilePhone = phone ?? matchedUser.phone ?? null

      const createdProfile = await db.clientProfile.create({
        data: {
          userId: matchedUser.id,
          firstName,
          lastName,
          claimStatus: ClientClaimStatus.CLAIMED,
          claimedAt: new Date(),
          email: profileEmail,
          phone: profilePhone,
          ...buildClientProfileContactLookupData({
            email: profileEmail,
            phone: profilePhone,
          }),
        },
        select: CLIENT_PROFILE_IDENTITY_SELECT,
      })

      return toSuccessfulResult(createdProfile)
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) {
        throw error
      }

      const racedProfile = await db.clientProfile.findUnique({
        where: { userId: matchedUser.id },
        select: CLIENT_PROFILE_IDENTITY_SELECT,
      })

      if (!racedProfile) {
        throw error
      }

      return toSuccessfulResult(racedProfile)
    }
  }

  try {
    const profileEmail = email ?? null
    const profilePhone = phone ?? null

    const createdProfile = await db.clientProfile.create({
      data: {
        userId: null,
        firstName,
        lastName,
        claimStatus: ClientClaimStatus.UNCLAIMED,
        claimedAt: null,
        email: profileEmail,
        phone: profilePhone,
        ...buildClientProfileContactLookupData({
          email: profileEmail,
          phone: profilePhone,
        }),
      },
      select: CLIENT_PROFILE_IDENTITY_SELECT,
    })

    return toSuccessfulResult(createdProfile)
  } catch (error: unknown) {
    if (!isUniqueViolation(error)) {
      throw error
    }

    const racedProfileResult = await findMatchedClientProfile({
      db,
      email,
      phone,
    })

    if (racedProfileResult.kind === 'profile') {
      return toSuccessfulResult(racedProfileResult.profile)
    }

    if (racedProfileResult.kind === 'conflict') {
      return {
        ok: false,
        status: 409,
        error:
          'That email and phone match different client profiles. Please double check with the client before continuing.',
        code: 'IDENTITY_CONFLICT',
      }
    }

    throw error
  }
}