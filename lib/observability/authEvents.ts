// lib/observability/authEvents.ts

import crypto from 'crypto'
import * as Sentry from '@sentry/nextjs'

export type AuthEventLevel = 'info' | 'warn' | 'error'

type AuthEventInput = {
  level: AuthEventLevel
  event: string
  route: string
  provider?: string | null
  code?: string | null
  userId?: string | null
  email?: string | null
  phone?: string | null
  verificationId?: string | null
  message?: string | null
  meta?: Record<string, unknown>
}

type CaptureAuthExceptionInput = Omit<AuthEventInput, 'level' | 'message'> & {
  error: unknown
}

const MAX_STRING_LENGTH = 500
const MAX_META_DEPTH = 3

const REDACTED = '[redacted]'

function shortHash(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null

  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12)
}

function normalizeEmailForHash(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase()
  return normalized && normalized.length > 0 ? normalized : null
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()

  return (
    lower.includes('password') ||
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('apikey') ||
    lower.includes('api_key') ||
    lower.includes('authorization') ||
    lower.includes('cookie') ||
    lower.includes('session') ||
    lower.includes('jwt') ||
    lower.includes('code') ||
    lower.includes('email') ||
    lower.includes('phone') ||
    lower.includes('address') ||
    lower.includes('signedurl') ||
    lower.includes('signed_url') ||
    lower.includes('storagepath') ||
    lower.includes('storage_path') ||
    lower.includes('url') ||
    lower.includes('notes')
  )
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value
  return `${value.slice(0, MAX_STRING_LENGTH)}…`
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === undefined) return undefined
  if (value === null) return null

  if (typeof value === 'string') {
    return truncateString(value)
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeErrorMessage(value.message),
    }
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_META_DEPTH) return '[array]'
    return value.map((item) => sanitizeValue(item, depth + 1))
  }

  if (typeof value === 'object') {
    if (depth >= MAX_META_DEPTH) return '[object]'

    const out: Record<string, unknown> = {}

    for (const [key, nestedValue] of Object.entries(value)) {
      if (nestedValue === undefined) continue

      if (isSensitiveKey(key)) {
        out[key] = REDACTED
        continue
      }

      out[key] = sanitizeValue(nestedValue, depth + 1)
    }

    return out
  }

  return String(value)
}

function sanitizeMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!meta) return {}

  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue

    if (isSensitiveKey(key)) {
      out[key] = REDACTED
      continue
    }

    out[key] = sanitizeValue(value, 0)
  }

  return out
}

function sanitizeErrorMessage(message: string | null | undefined): string | null {
  const normalized = message?.trim()
  if (!normalized) return null

  // Avoid common accidental leaks. This is intentionally conservative.
  const redacted = normalized
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?[1-9]\d{1,14}\b/g, '[redacted-phone-or-id]')
    .replace(/token=[^&\s]+/gi, 'token=[redacted]')
    .replace(/code=[^&\s]+/gi, 'code=[redacted]')
    .replace(/secret=[^&\s]+/gi, 'secret=[redacted]')
    .replace(/password=[^&\s]+/gi, 'password=[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[redacted-url]')

  return truncateString(redacted)
}

function writeLine(level: AuthEventLevel, payload: Record<string, unknown>): void {
  const line = JSON.stringify(payload)

  if (level === 'info') {
    console.info(line)
    return
  }

  if (level === 'warn') {
    console.warn(line)
    return
  }

  console.error(line)
}

function sanitizeEventCode(code: string | null | undefined): string | null {
  const normalized = code?.trim()
  if (!normalized) return null

  if (/^[A-Z][A-Z0-9_:.:-]{1,80}$/.test(normalized)) {
    return normalized
  }

  return REDACTED
}

export function logAuthEvent(input: AuthEventInput): void {
  const safeCode = sanitizeEventCode(input.code)

  writeLine(input.level, {
    ts: new Date().toISOString(),
    app: 'tovis-app',
    namespace: 'auth',
    level: input.level,
    event: input.event,
    route: input.route,
    provider: input.provider ?? null,
    code: safeCode,
    userIdHash: shortHash(input.userId),
    emailHash: shortHash(normalizeEmailForHash(input.email)),
    phoneHash: shortHash(input.phone),
    verificationIdHash: shortHash(input.verificationId),
    message: sanitizeErrorMessage(input.message),
    ...sanitizeMeta(input.meta),
  })
}

export function captureAuthException(input: CaptureAuthExceptionInput): void {
  const err =
    input.error instanceof Error
      ? input.error
      : new Error(String(input.error))

  const sanitizedMeta = sanitizeMeta(input.meta)
  const safeCode = sanitizeEventCode(input.code)

  Sentry.withScope((scope) => {
    scope.setTag('area', 'auth')
    scope.setTag('auth.event', input.event)
    scope.setTag('auth.route', input.route)

    if (input.provider) scope.setTag('auth.provider', input.provider)
    if (safeCode) scope.setTag('auth.code', safeCode)

    scope.setContext('auth', {
      userIdHash: shortHash(input.userId),
      emailHash: shortHash(normalizeEmailForHash(input.email)),
      phoneHash: shortHash(input.phone),
      verificationIdHash: shortHash(input.verificationId),
      errorName: err.name,
      errorMessage: sanitizeErrorMessage(err.message),
      ...sanitizedMeta,
    })

    Sentry.captureException(err)
  })

  logAuthEvent({
    level: 'error',
    event: input.event,
    route: input.route,
    provider: input.provider,
    code: safeCode,
    userId: input.userId,
    email: input.email,
    phone: input.phone,
    verificationId: input.verificationId,
    message: err.message,
    meta: {
      errorName: err.name,
      errorMessage: sanitizeErrorMessage(err.message),
      ...sanitizedMeta,
    },
  })
}