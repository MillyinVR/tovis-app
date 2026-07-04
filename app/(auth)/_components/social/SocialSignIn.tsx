'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import {
  sanitizeInternalPath,
  sanitizeRedirectTarget,
} from '../postAuthRedirect'
import { submitSocialToken } from './submitSocialToken'
import { appleWebClientId, googleWebClientId } from './socialProviders'

const GOOGLE_GSI_SRC = 'https://accounts.google.com/gsi/client'
const APPLE_JS_SRC =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'

// Minimal typings for the two vendor globals — only the surface we call.
type GoogleCredentialResponse = { credential?: string }
type GoogleIdApi = {
  initialize(config: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
  }): void
  renderButton(
    parent: HTMLElement,
    options: Record<string, string | number>,
  ): void
}
type AppleAuthApi = {
  init(config: {
    clientId: string
    scope: string
    redirectURI: string
    usePopup: boolean
  }): void
  signIn(): Promise<{
    authorization?: { id_token?: string }
    user?: { name?: { firstName?: string; lastName?: string } }
  }>
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } }
    AppleID?: { auth?: AppleAuthApi }
  }
}

const scriptPromises = new Map<string, Promise<void>>()

function loadScript(src: string): Promise<void> {
  const existing = scriptPromises.get(src)
  if (existing) return existing

  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(el)
  })

  scriptPromises.set(src, promise)
  return promise
}

/**
 * Web social sign-in buttons (Google + Apple), each gated on its public client
 * id. Renders nothing when no provider is configured, so it can be dropped onto
 * the login and client-signup surfaces unconditionally. Both providers route
 * through the same verification gate as password login via submitSocialToken.
 */
export default function SocialSignIn() {
  const searchParams = useSearchParams()

  const { nextSafe, fromSafe } = useMemo(() => {
    const next = sanitizeRedirectTarget(
      sanitizeInternalPath(searchParams.get('next')),
    )
    const from = sanitizeRedirectTarget(
      sanitizeInternalPath(searchParams.get('from')),
    )
    return { nextSafe: next, fromSafe: from }
  }, [searchParams])

  const googleClientId = useMemo(() => googleWebClientId(), [])
  const appleClientId = useMemo(() => appleWebClientId(), [])

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const googleButtonRef = useRef<HTMLDivElement | null>(null)

  const handleResult = useCallback(
    async (
      provider: 'google' | 'apple',
      identityToken: string,
      name?: { firstName?: string | null; lastName?: string | null },
    ) => {
      setError(null)
      setBusy(true)
      try {
        const result = await submitSocialToken({
          provider,
          identityToken,
          firstName: name?.firstName ?? null,
          lastName: name?.lastName ?? null,
          nextSafe,
          fromSafe,
        })
        if (!result.ok) {
          setError(result.error)
          return
        }
        window.location.assign(result.url)
      } catch {
        setError('Network error. Please try again.')
      } finally {
        setBusy(false)
      }
    },
    [nextSafe, fromSafe],
  )

  // Render the Google Identity Services button (GIS draws its own branded
  // button, so we don't hand-style Google's mark).
  useEffect(() => {
    if (!googleClientId) return
    let cancelled = false

    loadScript(GOOGLE_GSI_SRC)
      .then(() => {
        if (cancelled) return
        const api = window.google?.accounts?.id
        const host = googleButtonRef.current
        if (!api || !host) return

        api.initialize({
          client_id: googleClientId,
          callback: (response) => {
            if (response.credential) {
              void handleResult('google', response.credential)
            }
          },
        })
        host.replaceChildren()
        api.renderButton(host, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: 320,
        })
      })
      .catch(() => {
        if (!cancelled) setError('Could not load Google sign-in.')
      })

    return () => {
      cancelled = true
    }
  }, [googleClientId, handleResult])

  const handleApple = useCallback(async () => {
    if (!appleClientId || busy) return
    setError(null)
    try {
      await loadScript(APPLE_JS_SRC)
      const api = window.AppleID?.auth
      if (!api) {
        setError('Could not load Apple sign-in.')
        return
      }
      api.init({
        clientId: appleClientId,
        scope: 'name email',
        redirectURI: window.location.origin,
        usePopup: true,
      })
      const response = await api.signIn()
      const idToken = response.authorization?.id_token
      if (!idToken) {
        setError('Apple sign-in was cancelled.')
        return
      }
      await handleResult('apple', idToken, {
        firstName: response.user?.name?.firstName ?? null,
        lastName: response.user?.name?.lastName ?? null,
      })
    } catch {
      // Apple throws on user-cancel too; keep the message soft.
      setError('Apple sign-in did not complete.')
    }
  }, [appleClientId, busy, handleResult])

  if (!googleClientId && !appleClientId) return null

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-surfaceGlass/12" />
        <span className="text-[11px] font-black uppercase tracking-wide text-textSecondary/70">
          or continue with
        </span>
        <div className="h-px flex-1 bg-surfaceGlass/12" />
      </div>

      <div className="grid gap-2" aria-busy={busy}>
        {googleClientId ? (
          <div ref={googleButtonRef} className="flex justify-center" />
        ) : null}

        {appleClientId ? (
          <button
            type="button"
            onClick={() => void handleApple()}
            disabled={busy}
            className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-full border border-surfaceGlass/20 bg-bgPrimary/30 px-4 py-2.5 text-sm font-black text-textPrimary transition hover:enabled:border-surfaceGlass/35 hover:enabled:bg-bgPrimary/40 focus:outline-none focus:ring-2 focus:ring-accentPrimary/20 disabled:cursor-not-allowed disabled:opacity-65"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 384 512"
              className="h-4 w-4 fill-current"
            >
              <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
            </svg>
            <span>Continue with Apple</span>
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
          {error}
        </div>
      ) : null}
    </div>
  )
}
