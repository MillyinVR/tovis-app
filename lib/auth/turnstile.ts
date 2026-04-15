// lib/auth/turnstile.ts
const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify'

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

function getRemoteIp(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for')
  if (!xff) return null

  const first = xff.split(',')[0]?.trim()
  return first || null
}

type TurnstileVerifyPayload = {
  success?: boolean
}

export async function verifyTurnstileOrFailOpen(args: {
  request: Request
  token: string | null
}): Promise<VerifyTurnstileResult> {
  const secret = envOrNull('TURNSTILE_SECRET_KEY')
  if (!secret) {
    return {
      ok: false,
      code: 'CAPTCHA_UNAVAILABLE',
      message: 'Captcha is not configured.',
    }
  }

  if (!args.token) {
    return {
      ok: false,
      code: 'CAPTCHA_REQUIRED',
      message: 'Complete the captcha and try again.',
    }
  }

  const body = new URLSearchParams({
    secret,
    response: args.token,
  })

  const remoteIp = getRemoteIp(args.request)
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
      return {
        ok: true,
        failOpen: true,
        eventName: AUTH_TURNSTILE_FAIL_OPEN_EVENT,
        reason: `turnstile_http_${response.status}`,
      }
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
    return {
      ok: true,
      failOpen: true,
      eventName: AUTH_TURNSTILE_FAIL_OPEN_EVENT,
      reason: 'turnstile_network_or_timeout',
    }
  }
}