'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  clientId: string
  initialOccupation: string | null
  initialSocialHandle: string | null
}

// Pro-captured chart context. Occupation is encrypted at rest server-side; the
// social handle is for tagging the client on socials (distinct from their own
// creator handle).
export default function EditProfileContextForm({
  clientId,
  initialOccupation,
  initialSocialHandle,
}: Props) {
  const router = useRouter()
  const [occupation, setOccupation] = useState(initialOccupation ?? '')
  const [socialHandle, setSocialHandle] = useState(initialSocialHandle ?? '')
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pro/clients/${clientId}/profile-context`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          occupation: occupation.trim() || null,
          proCapturedSocialHandle: socialHandle.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error || 'Failed to save.')
        return
      }
      setEditing(false)
      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  if (!editing) {
    const hasAny = Boolean(initialOccupation || initialSocialHandle)
    return (
      <div style={{ display: 'grid', gap: 4 }}>
        {hasAny ? (
          <div style={{ fontSize: 12, color: 'rgb(var(--text-secondary))' }}>
            {initialOccupation ? (
              <span>
                Occupation:{' '}
                <span style={{ fontWeight: 700, color: 'rgb(var(--text-primary))' }}>
                  {initialOccupation}
                </span>
              </span>
            ) : null}
            {initialOccupation && initialSocialHandle ? ' · ' : ''}
            {initialSocialHandle ? (
              <span>
                Social:{' '}
                <span style={{ fontWeight: 700, color: 'rgb(var(--text-primary))' }}>
                  @{initialSocialHandle}
                </span>
              </span>
            ) : null}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'rgb(var(--text-muted))' }}>
            No occupation or social handle on file.
          </div>
        )}
        <div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid rgb(var(--text-primary) / 0.10)',
              background: 'rgb(var(--text-primary) / 0.04)',
              cursor: 'pointer',
            }}
          >
            {hasAny ? 'Edit context' : 'Add context'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 320, display: 'grid', gap: 8 }}>
      <div>
        <label
          htmlFor="ctx-occupation"
          style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
        >
          Occupation
        </label>
        <input
          id="ctx-occupation"
          value={occupation}
          onChange={(e) => setOccupation(e.target.value)}
          disabled={loading}
          placeholder="e.g. Nurse (rotating shifts)"
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid rgb(var(--text-primary) / 0.10)',
            padding: 8,
            fontSize: 13,
            fontFamily: 'inherit',
          }}
        />
      </div>
      <div>
        <label
          htmlFor="ctx-social"
          style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
        >
          Social handle (for tagging)
        </label>
        <input
          id="ctx-social"
          value={socialHandle}
          onChange={(e) => setSocialHandle(e.target.value)}
          disabled={loading}
          placeholder="@theirhandle"
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid rgb(var(--text-primary) / 0.10)',
            padding: 8,
            fontSize: 13,
            fontFamily: 'inherit',
          }}
        />
      </div>
      {error ? (
        <div style={{ fontSize: 11, color: 'rgb(var(--tone-danger))' }}>{error}</div>
      ) : null}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={save}
          disabled={loading}
          style={{
            fontSize: 11,
            padding: '4px 12px',
            borderRadius: 999,
            border: 'none',
            background: 'rgb(var(--text-primary))',
            color: 'rgb(var(--bg-primary))',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOccupation(initialOccupation ?? '')
            setSocialHandle(initialSocialHandle ?? '')
            setEditing(false)
            setError(null)
          }}
          disabled={loading}
          style={{
            fontSize: 11,
            padding: '4px 10px',
            borderRadius: 999,
            border: '1px solid rgb(var(--text-primary) / 0.10)',
            background: 'rgb(var(--text-primary) / 0.04)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
