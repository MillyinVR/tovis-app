import bcrypt from 'bcryptjs'
import jwt, { type JwtPayload as JsonWebTokenPayload } from 'jsonwebtoken'
import type { Role } from '@prisma/client'
import { isNonEmptyString, isRecord } from '@/lib/guards'

const JWT_SECRET = process.env.JWT_SECRET

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set in environment variables')
}

const PASSWORD_SALT_ROUNDS = 10
const TOKEN_EXPIRES_IN = '7d' as const

// Precomputed bcrypt hash for the fixed string "tovis-login-dummy-password-v1".
// Used only to normalize login timing when no matching user exists.
export const DUMMY_PASSWORD_HASH =
  '$2b$10$F.ZAIlXTg.PToRZemArB7emjC1dfwqWxYrOhbd4P0bFfPiM/m19/O'

// Source of truth is the Prisma Role enum (type-only import keeps it erased).
export type AuthRole = Role
export type AuthSessionKind = 'ACTIVE' | 'VERIFICATION'

type TokenSubject = {
  userId: string
  role: AuthRole
  authVersion: number
}

export type AuthTokenPayload = TokenSubject & {
  sessionKind: AuthSessionKind
  /**
   * Stable per-install device id, present only on tokens minted for a native
   * client that supplied one. Enables per-device revocation (see
   * `lib/auth/deviceSessions.ts`); web/cookie sessions omit it.
   */
  deviceId?: string
  /**
   * JWT `iat` (seconds since epoch), read back on verify. Used to decide whether
   * a per-device revocation (which stamps a `revokedAt`) predates this token.
   */
  issuedAtSeconds?: number
}

/** What a caller provides when minting a token (the signable claims). */
type CreateTokenInput = TokenSubject & {
  sessionKind: AuthSessionKind
  deviceId?: string | null
}

function isAuthRole(value: unknown): value is AuthRole {
  return value === 'CLIENT' || value === 'PRO' || value === 'ADMIN'
}

function isAuthSessionKind(value: unknown): value is AuthSessionKind {
  return value === 'ACTIVE' || value === 'VERIFICATION'
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function normalizeDecodedToken(
  decoded: string | JsonWebTokenPayload | null,
): AuthTokenPayload | null {
  if (!isRecord(decoded)) return null

  const userId = decoded.userId
  const role = decoded.role
  const sessionKind = decoded.sessionKind
  const authVersion = decoded.authVersion
  const deviceId = decoded.deviceId
  const iat = decoded.iat

  if (!isNonEmptyString(userId)) return null
  if (!isAuthRole(role)) return null
  if (!isAuthSessionKind(sessionKind)) return null
  if (!isPositiveInteger(authVersion)) return null

  return {
    userId,
    role,
    sessionKind,
    authVersion,
    ...(isNonEmptyString(deviceId) ? { deviceId } : {}),
    ...(typeof iat === 'number' && Number.isFinite(iat)
      ? { issuedAtSeconds: iat }
      : {}),
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_SALT_ROUNDS)
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

function createToken(input: CreateTokenInput): string {
  const deviceId =
    typeof input.deviceId === 'string' && input.deviceId.trim()
      ? input.deviceId.trim()
      : null

  return jwt.sign(
    {
      userId: input.userId,
      role: input.role,
      sessionKind: input.sessionKind,
      authVersion: input.authVersion,
      // Only embed the claim when a device id is actually present so web tokens
      // stay byte-for-byte unchanged.
      ...(deviceId ? { deviceId } : {}),
    },
    JWT_SECRET as string,
    {
      expiresIn: TOKEN_EXPIRES_IN,
    },
  )
}

export function createActiveToken(
  payload: TokenSubject & { deviceId?: string | null },
): string {
  return createToken({
    userId: payload.userId,
    role: payload.role,
    sessionKind: 'ACTIVE',
    authVersion: payload.authVersion,
    deviceId: payload.deviceId ?? null,
  })
}

export function createVerificationToken(
  payload: TokenSubject & { deviceId?: string | null },
): string {
  return createToken({
    userId: payload.userId,
    role: payload.role,
    sessionKind: 'VERIFICATION',
    authVersion: payload.authVersion,
    deviceId: payload.deviceId ?? null,
  })
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET as string)
    return normalizeDecodedToken(decoded)
  } catch {
    return null
  }
}