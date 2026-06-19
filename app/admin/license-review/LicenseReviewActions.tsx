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
  initialExpiry: string // YYYY-MM-DD or ''
  hasLicenseDoc: boolean
}

function btn(kind: 'approve' | 'info' | 'reject', disabled: boolean) {
  const base =
    'inline-flex items-center justify-center rounded-xl px-3 py-1.5 text-xs font-black transition'
  const tone =
    kind === 'approve'
      ? 'border border-surfaceGlass/25 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'
      : kind === 'info'
        ? 'border border-toneWarn/70 text-toneWarn bg-bgSecondary hover:bg-surfaceGlass/10'
        : 'border border-toneDanger/70 text-toneDanger bg-bgSecondary hover:bg-surfaceGlass/10'
  return [base, tone, disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'].join(' ')
}

// Inline approve / needs-info / reject for one queued pro. Reuses the existing
// admin verification PATCH endpoint (audit-logged, search-index refreshed).
export default function LicenseReviewActions({
  professionalId,
  currentStatus,
  initialExpiry,
  hasLicenseDoc,
}: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [expiry, setExpiry] = useState(initialExpiry)

  // Approval needs an expiry on file + an uploaded license doc (server enforces;
  // we mirror it here so the button explains itself instead of erroring).
  const canApprove = Boolean(expiry) && hasLicenseDoc

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
            // Persist any admin correction to the expiry alongside the decision.
            ...(expiry ? { licenseExpiry: expiry } : {}),
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
      <label className="flex items-center justify-end gap-2 text-[11px] font-black text-textSecondary">
        Expiry
        <input
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          className="rounded-lg border border-surfaceGlass/14 bg-bgPrimary/20 px-2 py-1 text-xs text-textPrimary"
        />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={busy || !canApprove}
          onClick={() => setStatus('APPROVED', true)}
          className={btn('approve', busy || !canApprove)}
          title={
            canApprove
              ? undefined
              : 'Needs an expiration date and an uploaded license doc to approve'
          }
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
      {err ? <div className="text-[12px] text-toneDanger">{err}</div> : null}
    </div>
  )
}
