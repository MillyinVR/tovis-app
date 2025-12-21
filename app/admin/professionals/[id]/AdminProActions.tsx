// app/admin/professionals/[id]/AdminProActions.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { VerificationStatus } from '@prisma/client'

type Props = {
  professionalId: string
  currentStatus: VerificationStatus
  licenseVerified: boolean
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function btnStyle(kind: 'primary' | 'warn' | 'danger') {
  if (kind === 'primary') {
    return { border: '1px solid #111', background: '#111', color: '#fff' }
  }
  if (kind === 'warn') {
    return { border: '1px solid #b45309', background: '#fff', color: '#b45309' }
  }
  return { border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c' }
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
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Update failed.')

      router.refresh()
    } catch (e: any) {
      setErr(e?.message || 'Update failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => setStatus('APPROVED', true)}
          style={{
            padding: '10px 12px',
            borderRadius: 12,
            fontWeight: 1000,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
            ...btnStyle('primary'),
          }}
        >
          Approve
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => setStatus('PENDING')}
          style={{
            padding: '10px 12px',
            borderRadius: 12,
            fontWeight: 1000,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
            ...btnStyle('warn'),
          }}
        >
          Mark Pending
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => setStatus('REJECTED')}
          style={{
            padding: '10px 12px',
            borderRadius: 12,
            fontWeight: 1000,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
            ...btnStyle('danger'),
          }}
        >
          Reject
        </button>
      </div>

      <div style={{ fontSize: 12, color: '#6b7280' }}>
        Current: <b style={{ color: '#111' }}>{currentStatus}</b> · License verified:{' '}
        <b style={{ color: '#111' }}>{String(licenseVerified)}</b>
      </div>

      {err ? <div style={{ fontSize: 12, color: '#b91c1c' }}>{err}</div> : null}
    </div>
  )
}
