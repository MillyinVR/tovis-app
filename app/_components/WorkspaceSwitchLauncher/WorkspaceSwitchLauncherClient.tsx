// app/_components/WorkspaceSwitchLauncher/WorkspaceSwitchLauncherClient.tsx
'use client'

import { useEffect, useState } from 'react'
import {
  ArrowLeftRight,
  LayoutDashboard,
  Scissors,
  User,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Role } from '@prisma/client'

import SwitchAccountSheet from '@/app/_components/AdminSessionFooter/SwitchAccountSheet'
import { workspaceLabel } from '@/lib/auth/workspaces'
import type { WorkspaceOption } from '@/lib/auth/workspaces'
import { Z } from '@/lib/zIndex'

const WORKSPACE_ICON: Record<Role, LucideIcon> = {
  CLIENT: User,
  PRO: Scissors,
  ADMIN: LayoutDashboard,
}

/**
 * CSS custom property holding the horizontal space the launcher occupies in the
 * top-right corner. Surfaces that place their own control in that corner read
 * it (`margin-right: var(--ws-switch-reserve, 0px)`) so they shift clear only
 * when the launcher is actually mounted.
 */
export const WS_SWITCH_RESERVE_VAR = '--ws-switch-reserve'

/**
 * The floating top-right button. Shows the workspace the user is acting in now
 * with a swap affordance; tapping opens the shared SwitchAccountSheet (the same
 * sheet the admin footer uses), which handles the actual switch + sign out.
 */
export default function WorkspaceSwitchLauncherClient({
  options,
  current,
}: {
  options: WorkspaceOption[]
  current: Role
}) {
  const [open, setOpen] = useState(false)

  // Reserve top-right corner space so surfaces with their own corner control
  // (e.g. the Looks search toggle) can shift clear of this pill. Only set while
  // the launcher is mounted, so client-only accounts reserve nothing. Mirrors
  // the footer's `--app-footer-space` pattern.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty(
      WS_SWITCH_RESERVE_VAR,
      'calc(env(safe-area-inset-right, 0px) + 84px)',
    )
    return () => {
      root.style.setProperty(WS_SWITCH_RESERVE_VAR, '0px')
    }
  }, [])

  const Icon = WORKSPACE_ICON[current]
  const label = workspaceLabel(current)

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top) + 10px)',
          right: 'calc(env(safe-area-inset-right) + 12px)',
          zIndex: Z.header,
          // Only the button is interactive; never block page content.
          pointerEvents: 'none',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Switch workspace — acting as ${label}`}
          title="Switch workspace"
          className="tovis-focus tap-target"
          style={{
            pointerEvents: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 36,
            padding: '0 11px 0 9px',
            borderRadius: 999,
            border: '1px solid var(--line)',
            background: 'rgb(var(--bg-surface) / 0.85)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            color: 'rgb(var(--text-primary))',
            boxShadow: '0 6px 20px rgba(0,0,0,0.22)',
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'rgb(var(--bg-secondary))',
              color: 'rgb(var(--accent-primary))',
            }}
          >
            <Icon size={13} aria-hidden="true" />
          </span>
          <ArrowLeftRight
            size={13}
            aria-hidden="true"
            style={{ color: 'rgb(var(--text-muted))' }}
          />
        </button>
      </div>

      <SwitchAccountSheet
        open={open}
        onClose={() => setOpen(false)}
        options={options}
      />
    </>
  )
}
