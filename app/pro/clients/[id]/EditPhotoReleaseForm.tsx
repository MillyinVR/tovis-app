'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PhotoReleaseStatus } from '@prisma/client'

type Props = {
  clientId: string
  initialStatus: PhotoReleaseStatus
}

const STATUS_LABELS: Record<PhotoReleaseStatus, string> = {
  NOT_SET: 'Not set',
  GRANTED: 'Granted',
  DECLINED: 'Declined',
}

export default function EditPhotoReleaseForm({ clientId, initialStatus }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<PhotoReleaseStatus>(initialStatus)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(next: PhotoReleaseStatus) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pro/clients/${clientId}/photo-release`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error || 'Failed to save.')
        return
      }
      setStatus(next)
      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div
        role="group"
        aria-label="Photo release"
        style={{
          display: 'inline-flex',
          gap: 6,
          border: '1px solid rgb(var(--text-primary) / 0.10)',
          borderRadius: 999,
          padding: 4,
          width: 'fit-content',
        }}
      >
        {(Object.keys(STATUS_LABELS) as PhotoReleaseStatus[]).map((value) => {
          const active = value === status
          return (
            <button
              key={value}
              type="button"
              disabled={loading || active}
              onClick={() => save(value)}
              aria-pressed={active}
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '4px 10px',
                borderRadius: 999,
                border: 'none',
                cursor: active ? 'default' : 'pointer',
                background: active
                  ? 'rgb(var(--text-primary))'
                  : 'transparent',
                color: active
                  ? 'rgb(var(--bg-primary))'
                  : 'rgb(var(--text-secondary))',
              }}
            >
              {STATUS_LABELS[value]}
            </button>
          )
        })}
      </div>
      <div style={{ fontSize: 11, color: 'rgb(var(--text-muted))', lineHeight: 1.4 }}>
        The client&apos;s standing release decision. Public sharing still requires
        the client to promote a photo via a review — this flag does not publish
        anything on its own.
      </div>
      {error ? (
        <div style={{ fontSize: 11, color: 'rgb(var(--tone-danger))' }}>{error}</div>
      ) : null}
    </div>
  )
}
