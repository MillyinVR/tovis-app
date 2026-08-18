// lib/shortLink/generateCode.ts
//
// Unguessable public codes for ShortLink — base62 rather than
// lib/nfcShortCode.ts's base32, because these are tapped from a link, never
// hand-typed, so there is no reason to spend characters on a human-friendly
// alphabet. 8 chars of base62 is ~47.6 bits of entropy (62^8 ≈ 2.18e14).

import { randomBytes } from 'crypto'

import { requireDefined } from '@/lib/guards'

const ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const ALPHABET_LEN = ALPHABET.length // 62

// Rejection-sampling threshold: the largest multiple of 62 that fits in a
// byte. Drawing a byte >= this and redrawing keeps every code character
// uniformly distributed instead of slightly favoring the first 8 symbols
// (256 % 62 === 8) the way a plain `byte % 62` would.
const MAX_UNBIASED_BYTE = 256 - (256 % ALPHABET_LEN)

export const SHORT_LINK_CODE_LENGTH = 8

export function generateShortLinkCode(
  length: number = SHORT_LINK_CODE_LENGTH,
): string {
  let out = ''

  while (out.length < length) {
    const bytes = randomBytes(length)

    for (let i = 0; i < bytes.length && out.length < length; i++) {
      const byte = requireDefined(bytes[i], 'short link code random byte')
      if (byte >= MAX_UNBIASED_BYTE) continue
      out += ALPHABET.charAt(byte % ALPHABET_LEN)
    }
  }

  return out
}

const CODE_PATTERN = /^[0-9A-Za-z]{8,16}$/

/**
 * Validate a code read off an incoming request. Case-sensitive (unlike
 * lib/nfcShortCode.ts's normalizer) — base62 codes are copy/tapped, not
 * transcribed by hand, so folding case would collapse distinct codes.
 */
export function normalizeShortLinkCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return CODE_PATTERN.test(trimmed) ? trimmed : null
}
