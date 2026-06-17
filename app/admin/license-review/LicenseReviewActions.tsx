// app/admin/license-review/LicenseReviewActions.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { VerificationStatus } from '@prisma/client'
import {
  safeJsonRecord,
  readErrorMessage,
  errorMessageFromUnknown,
} from '@/lib/http'

type Props = {
  professionalId: string
  currentStatus: VerificationStatus
}

function btn(kind: 'approve' | 'info' | 'reject', disabled: boolean) {
  const base =
    'inline-flex items-center justify-center rounded-xl px-3 py-1.5 text-xs font-black transition'
  const tone =
    kind === 'approve'
      ? 'border border-surfaceGlass/25 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'
      : kind === 'info'
        ? 'border border-amber-700/70 text-amber-600 bg-bgSecondary hover:bg-surfaceGlass/10'
        : 'border border-red-700/70 text-red-500 bg-bgSecondary hover:bg-surfaceGlass/10'
  return [base, tone, disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'].join(' ')
}

// Inline approve / needs-info / reject for one queued pro. Reuses the existing
// admin verification PATCH endpoint (audit-logged, search-index refreshed).
export default function LicenseReviewActions({ professionalId, currentStatus }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function setStatus(
    next: VerificationStatus,
    licenseVerified?: boolean,
  ) {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(
        `/api/admin/professionals/${encodeURIComponent(professionalId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            verificationStatus: next,
            ...(typeof licenseVerified === 'boolean' ? { licenseVerified } : {}),
          }),
        },
      )
      const data = await safeJsonRecord(res)
      if (!res.ok) {
        throw new Error(readErrorMessage(data) ?? `Update failed (${res.status}).`)
      }
      router.refresh()
    } catch (e: unknown) {
      setErr(errorMessageFromUnknown(e, 'Update failed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => setStatus('APPROVED', true)}
          className={btn('approve', busy)}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy || currentStatus === 'NEEDS_INFO'}
          onClick={() => setStatus('NEEDS_INFO')}
          className={btn('info', busy || currentStatus === 'NEEDS_INFO')}
        >
          Needs info
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setStatus('REJECTED')}
          className={btn('reject', busy)}
        >
          Reject
        </button>
      </div>
      {err ? <div className="text-[12px] text-red-500">{err}</div> : null}
    </div>
  )
}
