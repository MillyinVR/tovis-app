// lib/turnstileClient.ts
'use client'

type TurnstileClient = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
  reset: (widgetId: string) => void
  execute: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileClient
  }
}

const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

const TURNSTILE_TIMEOUT_MS = 120_000

let scriptLoadPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Captcha is unavailable.'))
  }

  if (window.turnstile) {
    return Promise.resolve()
  }

  if (scriptLoadPromise) {
    return scriptLoadPromise
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const fail = () => {
      scriptLoadPromise = null
      reject(new Error('Captcha is unavailable.'))
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
    )

    if (existing) {
      if (window.turnstile) {
        resolve()
        return
      }

      existing.addEventListener(
        'load',
        () => {
          if (window.turnstile) {
            resolve()
            return
          }

          fail()
        },
        { once: true },
      )

      existing.addEventListener('error', fail, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT_SRC
    script.async = true
    script.defer = true

    script.onload = () => {
      if (window.turnstile) {
        resolve()
        return
      }

      fail()
    }

    script.onerror = fail
    document.head.appendChild(script)
  })

  return scriptLoadPromise
}

function logTurnstileClientError(args: {
  code: string
  action: string
}): void {
  if (typeof window === 'undefined') return

  console.error('Turnstile captcha error', {
    code: args.code,
    action: args.action,
    host: window.location.hostname,
    href: window.location.href,
  })
}

export async function getTurnstileToken(action: string): Promise<string> {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()

  if (!siteKey) {
    throw new Error('Captcha is unavailable.')
  }

  await loadTurnstileScript()

  const turnstile = window.turnstile

  if (!turnstile) {
    throw new Error('Captcha is unavailable.')
  }

  const container = document.createElement('div')
  container.setAttribute('aria-hidden', 'true')
  container.style.position = 'absolute'
  container.style.left = '-9999px'
  container.style.width = '1px'
  container.style.height = '1px'
  document.body.appendChild(container)

  let widgetId: string | null = null
  let cleanedUp = false

  return await new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true

      if (widgetId) {
        try {
          turnstile.remove(widgetId)
        } catch {
          // Ignore cleanup errors.
        }
      }

      container.remove()
    }

    const timeout = window.setTimeout(() => {
      if (widgetId) {
        try {
          turnstile.reset(widgetId)
        } catch {
          // Ignore reset errors.
        }
      }

      cleanup()
      reject(new Error('Captcha timed out. Please try again.'))
    }, TURNSTILE_TIMEOUT_MS)

    const finishWithError = (message: string) => {
      window.clearTimeout(timeout)
      cleanup()
      reject(new Error(message))
    }

    try {
      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        action,
        size: 'invisible',

        callback(token: unknown) {
          window.clearTimeout(timeout)
          cleanup()

          if (typeof token === 'string' && token.trim()) {
            resolve(token.trim())
            return
          }

          reject(new Error('Captcha failed. Please try again.'))
        },

        'error-callback'(code: unknown) {
          const errorCode =
            typeof code === 'string' && code.trim()
              ? code.trim()
              : 'unknown'

          logTurnstileClientError({
            code: errorCode,
            action,
          })

          finishWithError('Captcha failed. Please try again.')
        },

        'expired-callback'() {
          finishWithError('Captcha expired. Please try again.')
        },
      })

      turnstile.execute(widgetId)
    } catch (error) {
      logTurnstileClientError({
        code:
          error instanceof Error && error.message
            ? error.message
            : 'render_or_execute_failed',
        action,
      })

      finishWithError('Captcha failed. Please try again.')
    }
  })
}