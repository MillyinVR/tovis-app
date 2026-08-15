// lib/auth/verification.ts
import 'server-only'

import { normalizePhoneForVerification } from '@/lib/security/contactNormalization'
import { pickStringOrEmpty } from '@/lib/pick'

export type PhoneVerificationChannel = 'sms' | 'call'

/**
 * Returns the canonical phone value used by verification flows.
 *
 * Invalid or missing values return an empty string to preserve the existing
 * caller contract in this module.
 */
export function getVerificationPhoneLookupValue(value: unknown): string {
  return normalizePhoneForVerification(value) ?? ''
}

export function parsePhoneVerificationChannel(
  value: unknown,
): PhoneVerificationChannel {
  const raw = pickStringOrEmpty(value).toLowerCase()
  if (raw === 'call') return 'call'
  return 'sms'
}

export function maskPhone(phone: string): string {
  const trimmed = phone.trim()
  if (trimmed.length <= 4) return '****'
  return `${'*'.repeat(Math.max(0, trimmed.length - 4))}${trimmed.slice(-4)}`
}