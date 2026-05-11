// lib/auth/verification.ts

import 'server-only'

export type PhoneVerificationChannel = 'sms' | 'call'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function pickString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizePhoneForVerification(value: unknown): string {
  const phone = pickString(value)
  return phone.replace(/[^\d+]/g, '')
}

export function parsePhoneVerificationChannel(value: unknown): PhoneVerificationChannel {
  const raw = pickString(value).toLowerCase()
  if (raw === 'call') return 'call'
  return 'sms'
}

export function maskPhone(phone: string): string {
  const trimmed = phone.trim()
  if (trimmed.length <= 4) return '****'
  return `${'*'.repeat(Math.max(0, trimmed.length - 4))}${trimmed.slice(-4)}`
}