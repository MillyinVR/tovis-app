import crypto from 'crypto'
import { Prisma, Role } from '@prisma/client'

import { hashPassword } from '@/lib/auth'
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

function normalizeOptionalPhone(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  return normalized ? normalized : null
}

function isUniqueViolation(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

async function createClientUser(db: DbClient, email: string) {
  const generatedPassword = crypto.randomBytes(32).toString('hex')
  const passwordHash = await hashPassword(generatedPassword)

  return db.user.create({
    data: {
      email,
      password: passwordHash,
      role: Role.CLIENT,
    },
    select: {
      id: true,
      email: true,
      role: true,
    },
  })
}

export type UpsertProClientArgs = {
  firstName: unknown
  lastName: unknown
  email: unknown
  phone?: unknown
  tx?: Prisma.TransactionClient
}

export type UpsertProClientResult =
  | {
      ok: true
      clientId: string
      userId: string
      email: string
    }
  | {
      ok: false
      status: number
      error: string
      code: 'VALIDATION_ERROR' | 'EMAIL_IN_USE_BY_NON_CLIENT'
    }

export async function upsertProClient(
  args: UpsertProClientArgs,
): Promise<UpsertProClientResult> {
  const db = getDb(args.tx)

  const firstName = normalizeRequiredString(args.firstName)
  const lastName = normalizeRequiredString(args.lastName)
  const email = normalizeEmail(args.email)
  const phone = normalizeOptionalPhone(args.phone)

  if (!firstName || !lastName || !email) {
    return {
      ok: false,
      status: 400,
      error: 'First name, last name, and email are required.',
      code: 'VALIDATION_ERROR',
    }
  }

  let clientUser = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      role: true,
    },
  })

  if (clientUser && clientUser.role !== Role.CLIENT) {
    return {
      ok: false,
      status: 409,
      error: 'This email is already used by a non-client account.',
      code: 'EMAIL_IN_USE_BY_NON_CLIENT',
    }
  }

  if (!clientUser) {
    try {
      clientUser = await createClientUser(db, email)
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error

      const racedUser = await db.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          role: true,
        },
      })

      if (!racedUser) throw error

      if (racedUser.role !== Role.CLIENT) {
        return {
          ok: false,
          status: 409,
          error: 'This email is already used by a non-client account.',
          code: 'EMAIL_IN_USE_BY_NON_CLIENT',
        }
      }

      clientUser = racedUser
    }
  }

  const clientProfile = await db.clientProfile.upsert({
    where: { userId: clientUser.id },
    update: {
      firstName,
      lastName,
      ...(phone !== undefined ? { phone } : {}),
    },
    create: {
      userId: clientUser.id,
      firstName,
      lastName,
      phone: phone ?? null,
    },
    select: {
      id: true,
      userId: true,
    },
  })

  return {
    ok: true,
    clientId: clientProfile.id,
    userId: clientProfile.userId,
    email: clientUser.email,
  }
}