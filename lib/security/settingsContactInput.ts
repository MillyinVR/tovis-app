// lib/security/settingsContactInput.ts

import { isRecord } from '@/lib/guards'
import { normalizePhone } from '@/lib/security/contactNormalization'

export type NormalizedSettingsPhone = string | null | undefined | 'invalid'

export function normalizeSettingsPhoneFromBody(
  body: unknown,
): NormalizedSettingsPhone {
  if (!isRecord(body)) return undefined

  const value = body.phone

  if (value === undefined) return undefined
  if (value === null) return null

  if (typeof value !== 'string') return 'invalid'

  if (value.trim().length === 0) return null
  if (value.length > 40) return 'invalid'

  return normalizePhone(value) ?? 'invalid'
}