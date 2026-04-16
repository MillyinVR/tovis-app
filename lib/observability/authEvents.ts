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

function shortHash(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12)
}

function sanitizeMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!meta) return {}

  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue

    const lower = key.toLowerCase()
    if (
      lower.includes('password') ||
      lower.includes('token') ||
      lower === 'code'
    ) {
      out[key] = '[redacted]'
      continue
    }

    out[key] = value
  }

  return out
}

function writeLine(level: AuthEventLevel, payload: Record<string, unknown>) {
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

export function logAuthEvent(input: AuthEventInput): void {
  writeLine(input.level, {
    ts: new Date().toISOString(),
    app: 'tovis-app',
    namespace: 'auth',
    level: input.level,
    event: input.event,
    route: input.route,
    provider: input.provider ?? null,
    code: input.code ?? null,
    userIdHash: shortHash(input.userId),
    emailHash: shortHash(input.email?.toLowerCase() ?? null),
    phoneHash: shortHash(input.phone),
    verificationIdHash: shortHash(input.verificationId),
    message: input.message ?? null,
    ...sanitizeMeta(input.meta),
  })
}

export function captureAuthException(
  input: CaptureAuthExceptionInput,
): void {
  const err =
    input.error instanceof Error
      ? input.error
      : new Error(String(input.error))

  Sentry.withScope((scope) => {
    scope.setTag('area', 'auth')
    scope.setTag('auth.event', input.event)
    scope.setTag('auth.route', input.route)

    if (input.provider) scope.setTag('auth.provider', input.provider)
    if (input.code) scope.setTag('auth.code', input.code)

    scope.setContext('auth', {
      userIdHash: shortHash(input.userId),
      emailHash: shortHash(input.email?.toLowerCase() ?? null),
      phoneHash: shortHash(input.phone),
      verificationIdHash: shortHash(input.verificationId),
      ...sanitizeMeta(input.meta),
    })

    Sentry.captureException(err)
  })

  logAuthEvent({
    level: 'error',
    event: input.event,
    route: input.route,
    provider: input.provider,
    code: input.code,
    userId: input.userId,
    email: input.email,
    phone: input.phone,
    verificationId: input.verificationId,
    message: err.message,
    meta: {
      errorName: err.name,
      ...sanitizeMeta(input.meta),
    },
  })
}