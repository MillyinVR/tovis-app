// lib/auth/timingSafe.ts
import crypto from 'crypto'

function hexToBuffer(value: string): Buffer | null {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (normalized.length % 2 !== 0) return null
  if (!/^[0-9a-f]+$/.test(normalized)) return null
  return Buffer.from(normalized, 'hex')
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

/**
 * Generate a cryptographically-random token as a lowercase hex string.
 * Single source of truth for opaque secret/token generation (password-reset
 * secrets, email-verification tokens, client-action tokens, …).
 */
export function generateTokenHex(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('hex')
}

export function timingSafeEqualHex(left: string, right: string): boolean {
  const leftBuf = hexToBuffer(left)
  const rightBuf = hexToBuffer(right)

  if (!leftBuf || !rightBuf) return false
  if (leftBuf.length !== rightBuf.length) return false

  return crypto.timingSafeEqual(leftBuf, rightBuf)
}

/**
 * Constant-time comparison of two arbitrary UTF-8 strings. Unlike
 * timingSafeEqualHex this does not require hex input, so it is suitable for
 * comparing shared secrets / bearer tokens. (String length is not itself
 * secret, so the early length check is acceptable.)
 */
export function timingSafeEqualUtf8(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, 'utf8')
  const rightBuf = Buffer.from(right, 'utf8')

  if (leftBuf.length !== rightBuf.length) return false

  return crypto.timingSafeEqual(leftBuf, rightBuf)
}