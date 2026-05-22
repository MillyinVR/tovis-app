import { createHash, randomBytes } from 'node:crypto'

const INVITE_TOKEN_BYTES = 32

export function createProClientInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString('base64url')
}

export function hashProClientInviteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex')
}

export function normalizeProClientInviteToken(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const token = value.trim()
  return token.length > 0 ? token : null
}