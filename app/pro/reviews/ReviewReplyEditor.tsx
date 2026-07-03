// app/pro/reviews/ReviewReplyEditor.tsx
//
// Compose/edit/remove the pro's single public response to a review.
// PUT/DELETE /api/v1/pro/reviews/[id]/reply, then router.refresh() so the
// server-rendered list re-reads canonical state.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  getViewerTimeZone,
} from '@/lib/time'

const MAX_REPLY_LENGTH = 1000

type ProReply = { body: string; repliedAtISO: string } | null

export default function ReviewReplyEditor({
  reviewId,
  reply,
}: {
  reviewId: string
  reply: ProReply
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(reply?.body ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const body = draft.trim()
    if (!body || busy) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pro/reviews/${reviewId}/reply`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!res.ok) {
        setError('Could not save your response. Try again.')
        return
      }
      setEditing(false)
      router.refresh()
    } catch {
      setError('Could not save your response. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy) return
    if (!window.confirm('Remove your public response?')) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pro/reviews/${reviewId}/reply`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        setError('Could not remove your response. Try again.')
        return
      }
      setDraft('')
      setEditing(false)
      router.refresh()
    } catch {
      setError('Could not remove your response. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const pillButtonStyle: React.CSSProperties = {
    fontSize: 12,
    color: 'rgb(var(--text-primary))',
    background: 'transparent',
    border: '1px solid rgb(var(--text-primary) / 0.10)',
    padding: '6px 10px',
    borderRadius: 999,
    cursor: 'pointer',
  }

  if (!editing) {
    return (
      <div style={{ marginTop: 10 }}>
        {reply ? (
          <div
            style={{
              borderLeft: '2px solid rgb(var(--text-primary) / 0.15)',
              paddingLeft: 10,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 650,
                color: 'rgb(var(--text-muted))',
              }}
            >
              Your public response ·{' '}
              {formatInTimeZone(
                reply.repliedAtISO,
                getViewerTimeZone() ?? DEFAULT_TIME_ZONE,
                { month: 'short', day: 'numeric', year: 'numeric' },
              )}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 12,
                color: 'rgb(var(--text-secondary))',
              }}
            >
              {reply.body}
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: 8, display: 'flex', gap: 10 }}>
          <button
            type="button"
            style={pillButtonStyle}
            onClick={() => {
              setDraft(reply?.body ?? '')
              setEditing(true)
            }}
          >
            {reply ? 'Edit response' : 'Reply publicly'}
          </button>

          {reply ? (
            <button
              type="button"
              style={pillButtonStyle}
              disabled={busy}
              onClick={remove}
            >
              Remove
            </button>
          ) : null}
        </div>

        {error ? (
          <div className="text-toneDanger" style={{ marginTop: 6, fontSize: 12 }}>
            {error}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div style={{ marginTop: 10 }}>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, MAX_REPLY_LENGTH))}
        rows={3}
        placeholder="Thank the client, add context, or address feedback — this response is public."
        style={{
          width: '100%',
          fontSize: 13,
          padding: 10,
          borderRadius: 10,
          border: '1px solid rgb(var(--text-primary) / 0.15)',
          background: 'rgb(var(--bg-surface))',
          color: 'rgb(var(--text-primary))',
          resize: 'vertical',
        }}
      />
      <div
        style={{
          marginTop: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <button
          type="button"
          style={pillButtonStyle}
          disabled={busy || !draft.trim()}
          onClick={save}
        >
          {busy ? 'Saving…' : 'Post response'}
        </button>
        <button
          type="button"
          style={pillButtonStyle}
          disabled={busy}
          onClick={() => {
            setEditing(false)
            setError(null)
          }}
        >
          Cancel
        </button>
        <span style={{ fontSize: 11, color: 'rgb(var(--text-muted))' }}>
          {draft.trim().length}/{MAX_REPLY_LENGTH}
        </span>
      </div>

      {error ? (
        <div className="text-toneDanger" style={{ marginTop: 6, fontSize: 12 }}>
          {error}
        </div>
      ) : null}
    </div>
  )
}
