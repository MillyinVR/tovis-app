'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  clientId: string
  initialAlertBanner: string | null
}

export default function EditAlertBannerForm({
  clientId,
  initialAlertBanner,
}: Props) {
  const router = useRouter()
  const [value, setValue] = useState(initialAlertBanner ?? '')
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/pro/clients/${clientId}/alert`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertBanner: value.trim() === '' ? null : value.trim(),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to save alert.')
        return
      }

      // Re-fetch server component so header + banner are in sync
      router.refresh()
      setEditing(false)
    } catch (err) {
      console.error(err)
      setError('Network error saving alert.')
    } finally {
      setLoading(false)
    }
  }

  // View mode (no editing)
  if (!editing) {
    return (
      <div style={{ textAlign: 'right' }}>
        {initialAlertBanner ? (
          <div
            style={{
              marginBottom: 6,
              display: 'inline-flex',
              padding: '4px 10px',
              borderRadius: 999,
              background: 'rgb(var(--tone-warn) / 0.12)',
              border: '1px solid rgb(var(--tone-warn) / 0.35)',
              fontSize: 12,
              color: 'rgb(var(--tone-warn))',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>⚠ {initialAlertBanner}</span>
          </div>
        ) : (
          <div
            style={{
              fontSize: 12,
              color: 'rgb(var(--text-muted))',
              marginBottom: 4,
            }}
          >
            No alert banner set.
          </div>
        )}

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
          {initialAlertBanner ? 'Edit alert' : 'Add alert'}
        </button>
      </div>
    )
  }

  // Edit mode
  return (
    <form
      onSubmit={handleSave}
      style={{
        textAlign: 'right',
        maxWidth: 260,
        marginLeft: 'auto',
      }}
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder="e.g. Very sensitive scalp. Confirm developer strength."
        style={{
          width: '100%',
          borderRadius: 8,
          border: '1px solid rgb(var(--text-primary) / 0.10)',
          padding: 6,
          fontSize: 12,
          fontFamily: 'inherit',
          marginBottom: 6,
        }}
      />
      {error && (
        <div style={{ fontSize: 11, color: 'rgb(var(--tone-danger))', marginBottom: 4 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        {initialAlertBanner && (
          <button
            type="button"
            onClick={() => {
              setValue('')
            }}
            disabled={loading}
            style={{
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid rgb(var(--text-primary) / 0.10)',
              background: 'rgb(var(--bg-surface))',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setValue(initialAlertBanner ?? '')
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
        <button
          type="submit"
          disabled={loading}
          style={{
            fontSize: 11,
            padding: '4px 12px',
            borderRadius: 999,
            border: 'none',
            background: 'rgb(var(--text-primary))',
            color: 'rgb(var(--bg-primary))',
            cursor: 'pointer',
          }}
        >
          {loading ? 'Saving…' : 'Save alert'}
        </button>
      </div>
    </form>
  )
}
