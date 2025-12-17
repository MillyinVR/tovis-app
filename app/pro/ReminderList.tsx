'use client'

import { useState } from 'react'

type Reminder = {
  id: string
  title: string
  body: string | null
  type: 'GENERAL' | 'AFTERCARE' | 'REBOOK' | 'PRODUCT_FOLLOWUP' | 'LICENSE'
  dueAt: string // ISO
  clientName: string | null
  serviceName: string | null
}

type Props = {
  initialReminders: Reminder[]
}

function formatDue(dueAt: string) {
  const d = new Date(dueAt)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function typeLabel(type: Reminder['type']) {
  switch (type) {
    case 'AFTERCARE':
      return 'Aftercare'
    case 'REBOOK':
      return 'Rebook'
    case 'PRODUCT_FOLLOWUP':
      return 'Product follow-up'
    case 'LICENSE':
      return 'License'
    default:
      return 'Reminder'
  }
}

export default function ReminderList({ initialReminders }: Props) {
  const [items, setItems] = useState<Reminder[]>(initialReminders)
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  async function handleComplete(id: string) {
    setError(null)
    setLoadingIds((prev) => new Set(prev).add(id))

    try {
      const res = await fetch(`/api/pro/reminders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: true }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        console.error('Failed to complete reminder', data)
        setError(data.error || 'Failed to update reminder.')
        return
      }

      // Optimistically remove from list
      setItems((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      console.error(e)
      setError('Network error updating reminder.')
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  if (items.length === 0) {
    return (
      <div
        style={{
          borderRadius: 10,
          border: '1px solid #eee',
          padding: 10,
          fontSize: 13,
          color: '#777',
          background: '#fff',
        }}
      >
        No reminders for today or tomorrow.
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {error && (
        <div style={{ fontSize: 12, color: 'red' }}>{error}</div>
      )}

      {items.map((r) => {
        const badgeColor =
          r.type === 'AFTERCARE'
            ? '#e0f2fe'
            : r.type === 'REBOOK'
            ? '#dcfce7'
            : r.type === 'PRODUCT_FOLLOWUP'
            ? '#fef9c3'
            : r.type === 'LICENSE'
            ? '#fee2e2'
            : '#f3f4f6'

        const badgeBorder =
          r.type === 'AFTERCARE'
            ? '#38bdf8'
            : r.type === 'REBOOK'
            ? '#22c55e'
            : r.type === 'PRODUCT_FOLLOWUP'
            ? '#eab308'
            : r.type === 'LICENSE'
            ? '#f97316'
            : '#9ca3af'

        return (
          <div
            key={r.id}
            style={{
              borderRadius: 10,
              border: '1px solid #eee',
              padding: 10,
              fontSize: 13,
              background: '#fff',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              alignItems: 'flex-start',
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 999,
                    background: badgeColor,
                    border: `1px solid ${badgeBorder}`,
                    textTransform: 'uppercase',
                    letterSpacing: 0.2,
                  }}
                >
                  {typeLabel(r.type)}
                </span>
                <span style={{ fontWeight: 600 }}>{r.title}</span>
              </div>
              {r.body && (
                <div
                  style={{
                    fontSize: 12,
                    color: '#555',
                    marginBottom: 2,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {r.body}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>
                {r.clientName && <span>{r.clientName}</span>}
                {r.clientName && r.serviceName && <span> • </span>}
                {r.serviceName && <span>{r.serviceName}</span>}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 11, minWidth: 110 }}>
              <div style={{ marginBottom: 4, color: '#555' }}>
                Due {formatDue(r.dueAt)}
              </div>
              <button
                type="button"
                onClick={() => handleComplete(r.id)}
                disabled={loadingIds.has(r.id)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: 'none',
                  fontSize: 11,
                  background: '#111',
                  color: '#fff',
                  cursor: 'pointer',
                  opacity: loadingIds.has(r.id) ? 0.7 : 1,
                }}
              >
                {loadingIds.has(r.id) ? 'Updating…' : 'Mark done'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
