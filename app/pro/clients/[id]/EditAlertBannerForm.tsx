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
              background: '#fff4e5',
              border: '1px solid #f0b46a',
              fontSize: 12,
              color: '#8a4a00',
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
              color: '#999',
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
            border: '1px solid #ddd',
            background: '#fafafa',
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
          border: '1px solid #ddd',
          padding: 6,
          fontSize: 12,
          fontFamily: 'inherit',
          marginBottom: 6,
        }}
      />
      {error && (
        <div style={{ fontSize: 11, color: 'red', marginBottom: 4 }}>
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
              border: '1px solid #ddd',
              background: '#fff',
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
            border: '1px solid #ddd',
            background: '#fafafa',
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
            background: '#111',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {loading ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
