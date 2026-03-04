// app/admin/professionals/[id]/AdminProActions.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { VerificationStatus } from '@prisma/client'
import { safeJsonRecord, readErrorMessage, errorMessageFromUnknown } from '@/lib/http'

type Props = {
  professionalId: string
  currentStatus: VerificationStatus
  licenseVerified: boolean
}

function btnBase(disabled: boolean) {
  return [
    'inline-flex items-center justify-center',
    'px-3 py-2 rounded-xl',
    'font-black',
    'transition',
    disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
  ].join(' ')
}

function btnVariant(kind: 'primary' | 'warn' | 'danger') {
  if (kind === 'primary') {
    return 'border border-surfaceGlass/25 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'
  }
  // Keep warn/danger readable without introducing new token work right now.
  if (kind === 'warn') {
    return 'border border-amber-700/70 text-amber-600 bg-bgSecondary hover:bg-surfaceGlass/10'
  }
  return 'border border-red-700/70 text-red-500 bg-bgSecondary hover:bg-surfaceGlass/10'
}

export default function AdminProActions({ professionalId, currentStatus, licenseVerified }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function setStatus(next: VerificationStatus, setLicenseVerified?: boolean) {
    if (busy) return
    setBusy(true)
    setErr(null)

    try {
      const res = await fetch(`/api/admin/professionals/${encodeURIComponent(professionalId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verificationStatus: next,
          ...(typeof setLicenseVerified === 'boolean' ? { licenseVerified: setLicenseVerified } : {}),
        }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        const msg = readErrorMessage(data) ?? `Update failed (${res.status}).`
        throw new Error(msg)
      }

      router.refresh()
    } catch (e: unknown) {
      setErr(errorMessageFromUnknown(e, 'Update failed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => setStatus('APPROVED', true)}
          className={[btnBase(busy), btnVariant('primary')].join(' ')}
        >
          Approve
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => setStatus('PENDING')}
          className={[btnBase(busy), btnVariant('warn')].join(' ')}
        >
          Mark Pending
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => setStatus('REJECTED')}
          className={[btnBase(busy), btnVariant('danger')].join(' ')}
        >
          Reject
        </button>
      </div>

      <div className="text-[12px] text-textSecondary">
        Status: <span className="font-bold text-textPrimary">{currentStatus}</span>
        {' · '}
        License verified: <span className="font-bold text-textPrimary">{licenseVerified ? 'Yes' : 'No'}</span>
      </div>

      {err ? <div className="text-[13px] text-red-500">{err}</div> : null}
    </div>
  )
}