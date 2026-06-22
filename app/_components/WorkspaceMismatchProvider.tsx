// app/_components/WorkspaceMismatchProvider.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Role } from '@prisma/client'

import { workspaceLabel } from '@/lib/auth/workspaces'
import {
  canReplayRequest,
  parseWorkspaceMismatch,
} from '@/lib/workspace/mismatch'
import { Z } from '@/lib/zIndex'

// Global guard for role-gated 403s. Any `fetch` whose response is tagged
// `WORKSPACE_MISMATCH` (see app/api/_utils/auth/requireUser.ts) is paused: we
// show a one-tap "switch workspace" prompt and, on confirm, re-mint the session
// then auto-retry the original request so the action just completes. Mounted
// once, app-wide, from the root layout — it's passive until a tagged 403 lands,
// so it costs nothing for guests or untagged responses.

type Outcome = 'switched' | 'dismissed'

type Pending = {
  target: Role
  resolve: (outcome: Outcome) => void
}

export default function WorkspaceMismatchProvider() {
  const router = useRouter()
  const [pending, setPending] = useState<Pending | null>(null)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // One prompt at a time: concurrent tagged 403s (almost always the same
  // target) share the in-flight prompt rather than stacking dialogs.
  const activeRef = useRef<{ target: Role; promise: Promise<Outcome> } | null>(
    null,
  )

  const requestSwitch = useCallback((target: Role): Promise<Outcome> => {
    if (activeRef.current) return activeRef.current.promise

    const promise = new Promise<Outcome>((resolve) => {
      setError(null)
      setSwitching(false)
      setPending({
        target,
        resolve: (outcome) => {
          activeRef.current = null
          setPending(null)
          setSwitching(false)
          setError(null)
          resolve(outcome)
        },
      })
    })

    activeRef.current = { target, promise }
    return promise
  }, [])

  useEffect(() => {
    const originalFetch = window.fetch
    let active = true

    const wrapped: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init)
      if (!active || response.status !== 403) return response

      let body: unknown
      try {
        body = await response.clone().json()
      } catch {
        return response
      }

      const target = parseWorkspaceMismatch(response.status, body)
      if (!target) return response

      // Decide replay-eligibility BEFORE the body stream is touched again.
      const replayable = canReplayRequest(input, init)

      const outcome = await requestSwitch(target)
      if (!active || outcome !== 'switched') return response

      if (replayable) {
        // Re-issue under the freshly minted session, then let server
        // components re-render against the new acting role.
        const retry = await originalFetch(input, init)
        router.refresh()
        return retry
      }

      // Body can't be safely replayed (upload/stream): hard reload into the
      // now-switched session so the user can redo the action.
      window.location.reload()
      return response
    }

    window.fetch = wrapped
    return () => {
      active = false
      if (window.fetch === wrapped) window.fetch = originalFetch
    }
  }, [requestSwitch, router])

  useEffect(() => {
    if (!pending) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !switching) {
        pending?.resolve('dismissed')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pending, switching])

  const onConfirm = useCallback(async () => {
    if (!pending || switching) return
    setSwitching(true)
    setError(null)

    try {
      const res = await fetch('/api/workspace/switch', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: pending.target }),
      })

      if (!res.ok) {
        setSwitching(false)
        setError('Could not switch workspace. Please try again.')
        return
      }

      pending.resolve('switched')
    } catch {
      setSwitching(false)
      setError('Could not switch workspace. Please try again.')
    }
  }, [pending, switching])

  if (!pending) return null

  const label = workspaceLabel(pending.target)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Switch workspace to continue"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: Z.modal,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => !switching && pending.resolve('dismissed')}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          border: 'none',
          padding: 0,
          cursor: switching ? 'default' : 'pointer',
        }}
      />

      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 340,
          background: 'rgb(var(--bg-surface))',
          border: '1px solid var(--line)',
          borderRadius: 18,
          padding: '20px 18px 16px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 16,
            color: 'rgb(var(--text-primary))',
          }}
        >
          Switch to {label} to continue
        </div>

        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: 'rgb(var(--text-muted))',
            marginTop: 8,
          }}
        >
          This action lives in your {label} view. Switch now and we&rsquo;ll
          pick up right where you left off.
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: 'rgb(var(--tone-danger))',
              marginTop: 12,
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 18,
          }}
        >
          <button
            type="button"
            onClick={() => pending.resolve('dismissed')}
            disabled={switching}
            className="tovis-focus tap-target"
            style={{
              flex: '0 0 auto',
              padding: '10px 14px',
              borderRadius: 12,
              border: '1px solid var(--line)',
              background: 'transparent',
              color: 'rgb(var(--text-secondary))',
              fontSize: 13,
              fontWeight: 600,
              cursor: switching ? 'not-allowed' : 'pointer',
              opacity: switching ? 0.6 : 1,
            }}
          >
            Not now
          </button>

          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={switching}
            className="tovis-focus tap-target"
            autoFocus
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 12,
              border: 'none',
              background: 'rgb(var(--accent-primary))',
              color: 'rgb(var(--on-accent))',
              fontSize: 13,
              fontWeight: 700,
              cursor: switching ? 'not-allowed' : 'pointer',
              opacity: switching ? 0.7 : 1,
            }}
          >
            {switching ? 'Switching…' : `Switch to ${label}`}
          </button>
        </div>
      </div>
    </div>
  )
}
