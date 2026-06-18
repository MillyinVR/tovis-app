// app/_components/WorkspaceSwitcher.tsx
'use client'

import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import type { WorkspaceOption } from '@/lib/auth/workspaces'
import SwitchAccountSheet from './AdminSessionFooter/SwitchAccountSheet'

/**
 * "Switch workspace" entry point for surfaces without the admin footer bar
 * (the Client "Me" page and Pro "Profile" page). Renders nothing unless the
 * user is entitled to more than one workspace. Opens the shared
 * SwitchAccountSheet, which performs the re-mint + navigation.
 */
export default function WorkspaceSwitcher({
  options,
}: {
  options: WorkspaceOption[]
}) {
  const [open, setOpen] = useState(false)

  // Only worth showing when there's somewhere else to go.
  if (options.length <= 1) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="tovis-focus"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderRadius: 999,
          border: '1px solid var(--line)',
          background: 'rgb(var(--bg-secondary))',
          color: 'rgb(var(--text-primary))',
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        <ArrowLeftRight size={16} aria-hidden="true" />
        Switch workspace
      </button>

      <SwitchAccountSheet
        open={open}
        onClose={() => setOpen(false)}
        options={options}
      />
    </>
  )
}
