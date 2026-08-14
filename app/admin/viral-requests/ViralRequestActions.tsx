'use client'

// The three decisions a reviewer can make on a viral look submission. Talks to
// the moderation endpoint that has existed all along
// (`POST /api/v1/admin/viral-service-requests/[id]/moderate`) and had no caller.
//
// Shape follows LicenseReviewActions: fetch → router.refresh(), no server
// actions (nothing under /admin uses them).

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  errorMessageFromUnknown,
  readErrorMessage,
  safeJsonRecord,
} from '@/lib/http'

type ModerationAction = 'mark_in_review' | 'approve' | 'reject'

function btn(kind: 'approve' | 'warn' | 'danger', disabled: boolean): string {
  const base =
    'rounded-full px-3.5 py-1.5 text-[12px] font-black transition disabled:opacity-50'
  if (kind === 'approve') {
    return `${base} bg-accentPrimary text-bgPrimary hover:opacity-90${
      disabled ? ' cursor-not-allowed' : ''
    }`
  }
  if (kind === 'warn') {
    return `${base} border border-toneWarn/70 text-toneWarn hover:bg-toneWarn/10${
      disabled ? ' cursor-not-allowed' : ''
    }`
  }
  return `${base} border border-toneDanger/70 text-toneDanger hover:bg-toneDanger/10${
    disabled ? ' cursor-not-allowed' : ''
  }`
}

export default function ViralRequestActions({
  requestId,
  canAct,
  hasCover,
}: {
  requestId: string
  /** False once the request is APPROVED or REJECTED — both are terminal. */
  canAct: boolean
  /** Drives the confirm below; approving with no picture is allowed, not silent. */
  hasCover: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function run(action: ModerationAction) {
    // Approval fans the look out to every matching pro and is terminal — there
    // is no "unapprove". A reviewer who has not set a picture is about to
    // publish a gradient, so say so once rather than letting it through
    // silently.
    if (action === 'approve' && !hasCover) {
      const proceed = window.confirm(
        'This look has no cover image. Approving publishes it without a picture, and approval cannot be undone. Continue?',
      )
      if (!proceed) return
    }

    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(
        `/api/v1/admin/viral-service-requests/${encodeURIComponent(requestId)}/moderate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      )
      const data = await safeJsonRecord(res)
      if (!res.ok) {
        throw new Error(
          readErrorMessage(data) ?? `Moderation failed (${res.status}).`,
        )
      }
      router.refresh()
    } catch (e: unknown) {
      setErr(errorMessageFromUnknown(e, 'Moderation failed.'))
    } finally {
      setBusy(false)
    }
  }

  if (!canAct) {
    return (
      <span className="text-[11px] text-textMuted">Decision is final</span>
    )
  }

  return (
    <div className="grid justify-items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run('mark_in_review')}
          className={btn('warn', busy)}
        >
          In review
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run('reject')}
          className={btn('danger', busy)}
        >
          Reject
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run('approve')}
          className={btn('approve', busy)}
        >
          Approve
        </button>
      </div>
      {err ? <div className="text-[12px] text-toneDanger">{err}</div> : null}
    </div>
  )
}
