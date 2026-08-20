// app/_components/blocks/BlockPersonButton.tsx
//
// The one Block / Unblock control (App Store guideline 1.2), rendered from
// every public profile — a client's `/u/[handle]` and a pro's
// `/professionals/[id]`.
//
// Shared rather than written per surface for the same reason DeleteAccountPanel
// is: the confirm copy makes a promise about what a block DOES, and two copies
// of that promise drift into two different promises. What it actually does is
// in lib/blocks/userBlocks.ts — the block is symmetric, so it hides them from
// the viewer AND the viewer from them.
//
// The target is named the way the surface already names it: a client by handle,
// a pro by ProfessionalProfile id (a pro's handle is nullable, so id is the
// only key that always exists). The server resolves either to a person.

'use client'

import { useState } from 'react'

import Button from '@/app/_components/ui/Button'
import { isRecord } from '@/lib/guards'
import { readErrorMessage, safeJson } from '@/lib/http'

const ENDPOINT = '/api/v1/blocks'

export type BlockPersonTarget = { handle: string } | { professionalId: string }

export default function BlockPersonButton({
  target,
  displayName,
  initialBlockId,
  className,
}: {
  target: BlockPersonTarget
  /** What to call them in the confirm prompt — already display-safe. */
  displayName: string
  /** The existing block's row id when the viewer already blocks them. */
  initialBlockId: string | null
  className?: string
}) {
  const [blockId, setBlockId] = useState<string | null>(initialBlockId)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const blocked = blockId !== null

  async function block() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target),
      })
      const body = await safeJson(res)
      if (!res.ok) {
        setError(readErrorMessage(body) ?? 'Something went wrong.')
        return
      }
      // The row id is what makes Unblock possible without a reload, so a
      // response that somehow lacks one leaves the control in its old state
      // rather than claiming a block it cannot lift.
      if (isRecord(body) && typeof body.blockId === 'string') {
        setBlockId(body.blockId)
        setConfirming(false)
      } else {
        setError('Something went wrong.')
      }
    } catch {
      setError('Could not block this account. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function unblock() {
    if (!blockId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(blockId)}`, {
        method: 'DELETE',
      })
      const body = await safeJson(res)
      if (!res.ok) {
        setError(readErrorMessage(body) ?? 'Something went wrong.')
        return
      }
      setBlockId(null)
    } catch {
      setError('Could not unblock this account. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={className}>
      {blocked ? (
        <Button
          variant="neutral"
          size="sm"
          fill="soft"
          disabled={busy}
          onClick={() => void unblock()}
        >
          {busy ? 'Unblocking…' : 'Unblock'}
        </Button>
      ) : confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] leading-snug text-textSecondary">
            Block {displayName}? You won’t see their looks or comments, and they
            won’t see yours. You can undo this in Settings.
          </p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              fill="soft"
              disabled={busy}
              onClick={() => void block()}
            >
              {busy ? 'Blocking…' : 'Block'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          Block
        </Button>
      )}

      {error ? (
        <p
          role="alert"
          className="mt-2 text-[12px] font-semibold text-toneDanger"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
