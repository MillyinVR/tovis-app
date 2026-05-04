// lib/auth/turnstile.ts
import { getTrustedClientIpFromRequest } from '@/lib/trustedClientIp'

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const AUTH_TURNSTILE_FAIL_OPEN_ENV = 'AUTH_TURNSTILE_FAIL_OPEN'

export const AUTH_TURNSTILE_FAIL_OPEN_EVENT = 'auth.turnstile.fail_open'

type VerifyTurnstileResult =
  | { ok: true; failOpen: false }
  | { ok: true; failOpen: true; eventName: string; reason: string }
  | {
      ok: false
      code: 'CAPTCHA_REQUIRED' | 'CAPTCHA_FAILED' | 'CAPTCHA_UNAVAILABLE'
      message: string
    }

function envOrNull(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function isTurnstileFailOpenAllowed(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    envOrNull(AUTH_TURNSTILE_FAIL_OPEN_ENV) === '1'
  )
}

function turnstileUnavailableResult(reason: string): VerifyTurnstileResult {
  if (isTurnstileFailOpenAllowed()) {
    return {
      ok: true,
      failOpen: true,
      eventName: AUTH_TURNSTILE_FAIL_OPEN_EVENT,
      reason,
    }
  }

  return {
    ok: false,
    code: 'CAPTCHA_UNAVAILABLE',
    message: 'Captcha is temporarily unavailable. Please try again.',
  }
}

type TurnstileVerifyPayload = {
  success?: boolean
}

export async function verifyTurnstileOrFailOpen(args: {
  request: Request
  token: string | null
}): Promise<VerifyTurnstileResult> {
  if (!args.token) {
    return {
      ok: false,
      code: 'CAPTCHA_REQUIRED',
      message: 'Complete the captcha and try again.',
    }
  }

  const secret = envOrNull('TURNSTILE_SECRET_KEY')
  if (!secret) {
    return turnstileUnavailableResult('turnstile_secret_missing')
  }

  const body = new URLSearchParams({
    secret,
    response: args.token,
  })

  const remoteIp = getTrustedClientIpFromRequest(args.request)
  if (remoteIp) {
    body.set('remoteip', remoteIp)
  }

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })

    if (response.status >= 500) {
      return turnstileUnavailableResult(`turnstile_http_${response.status}`)
    }

    const payload =
      (await response.json().catch(() => null)) as TurnstileVerifyPayload | null

    if (!response.ok) {
      return {
        ok: false,
        code: 'CAPTCHA_FAILED',
        message: 'Captcha verification failed. Please try again.',
      }
    }

    if (payload?.success === true) {
      return { ok: true, failOpen: false }
    }

    return {
      ok: false,
      code: 'CAPTCHA_FAILED',
      message: 'Captcha verification failed. Please try again.',
    }
  } catch {
    return turnstileUnavailableResult('turnstile_network_or_timeout')
  }
}