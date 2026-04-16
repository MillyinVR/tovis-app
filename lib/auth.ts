import bcrypt from 'bcryptjs'
import jwt, { type JwtPayload as JsonWebTokenPayload } from 'jsonwebtoken'

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

export type AuthRole = 'CLIENT' | 'PRO' | 'ADMIN'
export type AuthSessionKind = 'ACTIVE' | 'VERIFICATION'

type TokenSubject = {
  userId: string
  role: AuthRole
  authVersion: number
}

export type AuthTokenPayload = TokenSubject & {
  sessionKind: AuthSessionKind
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
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

  if (!isNonEmptyString(userId)) return null
  if (!isAuthRole(role)) return null
  if (!isAuthSessionKind(sessionKind)) return null
  if (!isPositiveInteger(authVersion)) return null

  return {
    userId,
    role,
    sessionKind,
    authVersion,
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

export function createToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET as string, {
    expiresIn: TOKEN_EXPIRES_IN,
  })
}

export function createActiveToken(payload: TokenSubject): string {
  return createToken({
    userId: payload.userId,
    role: payload.role,
    sessionKind: 'ACTIVE',
    authVersion: payload.authVersion,
  })
}

export function createVerificationToken(payload: TokenSubject): string {
  return createToken({
    userId: payload.userId,
    role: payload.role,
    sessionKind: 'VERIFICATION',
    authVersion: payload.authVersion,
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