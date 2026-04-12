import { ClientClaimStatus, Prisma, Role } from '@prisma/client'

import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function normalizeRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized ? normalized : null
}

function normalizeOptionalPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
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
  phone: true,
  user: {
    select: {
      id: true,
      role: true,
      email: true,
      phone: true,
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
  phone: true,
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

async function findMatchedClientProfile(args: {
  db: DbClient
  email: string | null
  phone: string | null
}): Promise<FindMatchedClientProfileResult> {
  const [emailMatch, phoneMatch] = await Promise.all([
    args.email
      ? args.db.clientProfile.findUnique({
          where: { email: args.email },
          select: CLIENT_PROFILE_IDENTITY_SELECT,
        })
      : Promise.resolve(null),
    args.phone
      ? args.db.clientProfile.findUnique({
          where: { phone: args.phone },
          select: CLIENT_PROFILE_IDENTITY_SELECT,
        })
      : Promise.resolve(null),
  ])

  if (emailMatch && phoneMatch && emailMatch.id !== phoneMatch.id) {
    return { kind: 'conflict' }
  }

  if (emailMatch) {
    return { kind: 'profile', profile: emailMatch }
  }

  if (phoneMatch) {
    return { kind: 'profile', profile: phoneMatch }
  }

  return { kind: 'none' }
}

type FindMatchedClientUserResult =
  | { kind: 'none' }
  | { kind: 'conflict' }
  | { kind: 'non_client' }
  | { kind: 'client'; user: UserIdentityRecord }

async function findMatchedClientUser(args: {
  db: DbClient
  email: string | null
  phone: string | null
}): Promise<FindMatchedClientUserResult> {
  const orConditions: Prisma.UserWhereInput[] = []

  if (args.email) {
    orConditions.push({ email: args.email })
  }

  if (args.phone) {
    orConditions.push({ phone: args.phone })
  }

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

  if (users.length > 1) {
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

  return {
    ...(!hasMeaningfulValue(profile.firstName) ? { firstName } : {}),
    ...(!hasMeaningfulValue(profile.lastName) ? { lastName } : {}),
    ...(profile.email == null && email ? { email } : {}),
    ...(profile.phone == null && phone ? { phone } : {}),
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
  const email = normalizeEmail(args.email)
  const phone = normalizeOptionalPhone(args.phone)

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
      const createdProfile = await db.clientProfile.create({
        data: {
          userId: matchedUser.id,
          firstName,
          lastName,
          claimStatus: ClientClaimStatus.CLAIMED,
          claimedAt: new Date(),
          email: email ?? matchedUser.email ?? null,
          phone: phone ?? matchedUser.phone ?? null,
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
    const createdProfile = await db.clientProfile.create({
      data: {
        userId: null,
        firstName,
        lastName,
        claimStatus: ClientClaimStatus.UNCLAIMED,
        claimedAt: null,
        email: email ?? null,
        phone: phone ?? null,
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