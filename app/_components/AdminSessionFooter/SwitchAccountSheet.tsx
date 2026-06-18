// app/_components/AdminSessionFooter/SwitchAccountSheet.tsx
'use client'

import { useState } from 'react'
import { LayoutDashboard, LogOut, Scissors, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Role } from '@prisma/client'
import { hardNavigate } from '@/lib/hardNavigate'
import type { WorkspaceOption } from '@/lib/auth/workspaces'

const WORKSPACE_ICON: Record<Role, LucideIcon> = {
  CLIENT: User,
  PRO: Scissors,
  ADMIN: LayoutDashboard,
}

/** Read a string `href` off an unknown JSON response, cast-free. */
function readHref(data: unknown): string | null {
  if (
    typeof data === 'object' &&
    data !== null &&
    'href' in data &&
    typeof data.href === 'string'
  ) {
    return data.href
  }
  return null
}

/**
 * Bottom sheet for switching the active workspace and signing out.
 * `options` are the workspaces the user is genuinely entitled to (resolved
 * server-side); selecting one POSTs the switch endpoint (which re-mints the
 * session) and hard-navigates into that workspace. Sign out lives here too.
 */
export default function SwitchAccountSheet({
  open,
  onClose,
  options,
}: {
  open: boolean
  onClose: () => void
  options: WorkspaceOption[]
}) {
  const [signingOut, setSigningOut] = useState(false)
  const [switchingTo, setSwitchingTo] = useState<Role | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const busy = signingOut || switchingTo !== null

  async function onSwitch(option: WorkspaceOption) {
    if (busy || option.current) return
    setError(null)
    setSwitchingTo(option.role)

    try {
      const res = await fetch('/api/workspace/switch', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: option.role }),
      })

      if (!res.ok) {
        setSwitchingTo(null)
        setError('Could not switch workspace. Please try again.')
        return
      }

      const data: unknown = await res.json().catch(() => null)

      // Hard nav: server components re-evaluate with the re-minted cookie.
      hardNavigate(readHref(data) ?? option.href)
    } catch {
      setSwitchingTo(null)
      setError('Could not switch workspace. Please try again.')
    }
  }

  async function onSignOut() {
    if (busy) return
    setSigningOut(true)

    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
    }).catch(() => null)

    // Hard nav: guarantees server components re-evaluate with cleared cookie
    hardNavigate('/login')
  }

  const mono = {
    fontFamily: 'var(--font-mono)',
  } as const

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Switch account"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
        }}
      />

      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 380,
          margin: '0 16px calc(16px + env(safe-area-inset-bottom))',
          background: 'rgb(var(--bg-surface))',
          border: '1px solid var(--line)',
          borderRadius: 18,
          padding: '18px 16px 12px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 4px',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 15,
              color: 'rgb(var(--text-primary))',
            }}
          >
            Switch account
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: '1px solid var(--line)',
              background: 'transparent',
              color: 'rgb(var(--text-muted))',
              fontSize: 13,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            fontSize: 12,
            color: 'rgb(var(--text-muted))',
            padding: '6px 4px 12px',
          }}
        >
          Jump between the workspaces you have access to.
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: 'rgb(var(--tone-danger))',
              padding: '0 4px 10px',
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((opt) => {
            const Icon = WORKSPACE_ICON[opt.role]
            const isSwitching = switchingTo === opt.role
            return (
              <button
                key={opt.role}
                type="button"
                onClick={() => void onSwitch(opt)}
                disabled={opt.current || busy}
                aria-current={opt.current ? 'true' : undefined}
                className="tovis-focus"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  textAlign: 'left',
                  border: opt.current
                    ? '1.5px solid rgb(var(--accent-primary))'
                    : '1px solid var(--line)',
                  borderRadius: 12,
                  padding: '11px 13px',
                  background: 'rgb(var(--bg-secondary))',
                  cursor: opt.current ? 'default' : busy ? 'not-allowed' : 'pointer',
                  opacity: busy && !opt.current && !isSwitching ? 0.6 : 1,
                }}
              >
                <span
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: opt.current ? '#0A1413' : 'rgb(var(--bg-surface))',
                    border: opt.current ? 'none' : '1px solid var(--line)',
                    color: opt.current
                      ? 'rgb(var(--accent-primary))'
                      : 'rgb(var(--text-secondary))',
                  }}
                >
                  <Icon size={18} aria-hidden="true" />
                </span>

                <span style={{ flex: 1 }}>
                  <span
                    style={{
                      display: 'block',
                      fontFamily: 'var(--font-display)',
                      fontWeight: 600,
                      fontSize: 14,
                      color: 'rgb(var(--text-primary))',
                    }}
                  >
                    {opt.label}
                  </span>
                  <span
                    style={{
                      ...mono,
                      display: 'block',
                      fontSize: 10,
                      color: 'rgb(var(--text-muted))',
                      marginTop: 1,
                    }}
                  >
                    {isSwitching ? 'Switching…' : opt.sub}
                  </span>
                </span>

                {opt.current ? (
                  <span
                    style={{
                      ...mono,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'rgb(var(--on-accent))',
                      background: 'rgb(var(--accent-primary))',
                      padding: '4px 9px',
                      borderRadius: 999,
                    }}
                  >
                    Active
                  </span>
                ) : (
                  <span style={{ color: 'rgb(var(--text-muted))', fontSize: 18 }}>›</span>
                )}
              </button>
            )
          })}
        </div>

        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--line)',
          }}
        >
          <button
            type="button"
            onClick={onSignOut}
            disabled={busy}
            className="tovis-focus"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '10px 9px',
              borderRadius: 10,
              border: 'none',
              background: 'transparent',
              color: 'rgb(var(--tone-danger))',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: signingOut ? 0.6 : 1,
            }}
          >
            <LogOut size={18} aria-hidden="true" />
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
