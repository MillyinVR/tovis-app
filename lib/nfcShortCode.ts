// lib/nfcShortCode.ts
import { randomBytes } from 'crypto'

/**
 * Crockford-ish Base32 alphabet:
 * - excludes I, L, O, U to avoid confusion and accidental words
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function generateShortCode(length = 8): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return out
}

/**
 * Normalize user input:
 * - uppercase
 * - remove spaces/hyphens/anything non-alphanumeric
 * - allow formats like "TOV-ABCD-EFGH" or "ABCD EFGH"
 */
export function normalizeShortCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const upper = raw.trim().toUpperCase()
  if (!upper) return null

  // remove "TOV" prefix if user typed it
  const noPrefix = upper.startsWith('TOV') ? upper.replace(/^TOV/, '') : upper

  const cleaned = noPrefix.replace(/[^0-9A-Z]/g, '')
  if (!cleaned) return null
  return cleaned
}

export function formatShortCode(code: string): string {
  const s = code.toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (!s) return 'TOV-'
  if (s.length <= 4) return `TOV-${s}`
  return `TOV-${s.slice(0, 4)}-${s.slice(4)}`
}
