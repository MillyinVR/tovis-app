'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  clientId: string
  initialActive: boolean
  initialReason: string | null
}

// Author-only flag. Copy is deliberately factual: the reason must describe
// conduct/safety facts, never protected characteristics (discrimination
// liability). The helper text below states that to the pro.
export default function EditDoNotRebookForm({
  clientId,
  initialActive,
  initialReason,
}: Props) {
  const router = useRouter()
  const [active, setActive] = useState(initialActive)
  const [reason, setReason] = useState(initialReason ?? '')
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pro/clients/${clientId}/do-not-rebook`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error || 'Failed to save.')
        return
      }
      setActive(true)
      setEditing(false)
      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  async function clear() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pro/clients/${clientId}/do-not-rebook`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error || 'Failed to clear.')
        return
      }
      setActive(false)
      setReason('')
      setEditing(false)
      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  const helper = (
    <div
      style={{
        fontSize: 11,
        color: 'rgb(var(--text-muted))',
        marginTop: 6,
        lineHeight: 1.4,
      }}
    >
      Private to you — never shown to other pros or the client. Keep the reason
      strictly factual (conduct or safety), not personal characteristics.
    </div>
  )

  if (!editing) {
    return (
      <div>
        {active ? (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'rgb(var(--tone-danger) / 0.12)',
              border: '1px solid rgb(var(--tone-danger) / 0.35)',
              fontSize: 12,
              color: 'rgb(var(--tone-danger))',
              fontWeight: 700,
            }}
          >
            <span aria-hidden>⛔</span> Do not rebook
          </div>
        ) : null}

        <div style={{ marginTop: active ? 6 : 0 }}>
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
            {active ? 'Edit do-not-rebook' : 'Flag do not rebook'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 320 }}>
      <label
        htmlFor="dnr-reason"
        style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
      >
        Reason (factual)
      </label>
      <textarea
        id="dnr-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        disabled={loading}
        placeholder="e.g. No-showed twice without notice; aggressive toward staff."
        style={{
          width: '100%',
          borderRadius: 8,
          border: '1px solid rgb(var(--text-primary) / 0.10)',
          padding: 8,
          fontSize: 13,
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />
      {helper}
      {error ? (
        <div style={{ fontSize: 11, color: 'rgb(var(--tone-danger))', marginTop: 4 }}>
          {error}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button
          type="button"
          onClick={save}
          disabled={loading}
          style={{
            fontSize: 11,
            padding: '4px 12px',
            borderRadius: 999,
            border: 'none',
            background: 'rgb(var(--tone-danger))',
            color: 'rgb(var(--bg-primary))',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Saving…' : 'Save flag'}
        </button>
        {active ? (
          <button
            type="button"
            onClick={clear}
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
            Remove flag
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setReason(initialReason ?? '')
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
