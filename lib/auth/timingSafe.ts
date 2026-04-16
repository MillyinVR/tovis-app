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

export function timingSafeEqualHex(left: string, right: string): boolean {
  const leftBuf = hexToBuffer(left)
  const rightBuf = hexToBuffer(right)

  if (!leftBuf || !rightBuf) return false
  if (leftBuf.length !== rightBuf.length) return false

  return crypto.timingSafeEqual(leftBuf, rightBuf)
}