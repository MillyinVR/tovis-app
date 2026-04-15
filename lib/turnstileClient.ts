'use client'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string
      remove: (widgetId: string) => void
      execute: (widgetId: string) => void
    }
  }
}

const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

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
      // If the script tag is already present and Turnstile is now available,
      // resolve immediately instead of waiting on events that already fired.
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

export async function getTurnstileToken(action: string): Promise<string> {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()
  if (!siteKey) {
    throw new Error('Captcha is unavailable.')
  }

  await loadTurnstileScript()

  if (!window.turnstile) {
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

  return await new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId)
        } catch {
          // Ignore cleanup errors.
        }
      }
      container.remove()
    }

    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Captcha timed out. Please try again.'))
    }, 12000)

    try {
      widgetId = window.turnstile!.render(container, {
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
        'error-callback'() {
          window.clearTimeout(timeout)
          cleanup()
          reject(new Error('Captcha failed. Please try again.'))
        },
        'expired-callback'() {
          window.clearTimeout(timeout)
          cleanup()
          reject(new Error('Captcha expired. Please try again.'))
        },
      })

      window.turnstile!.execute(widgetId)
    } catch {
      window.clearTimeout(timeout)
      cleanup()
      reject(new Error('Captcha failed. Please try again.'))
    }
  })
}