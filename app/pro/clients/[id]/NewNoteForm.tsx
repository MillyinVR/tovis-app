'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = { clientId: string }

function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/pro'
  return window.location.pathname + window.location.search + window.location.hash
}

function sanitizeFrom(from: string) {
  const trimmed = from.trim()
  if (!trimmed) return '/pro'
  if (!trimmed.startsWith('/')) return '/pro'
  if (trimmed.startsWith('//')) return '/pro'
  return trimmed
}

function redirectToLogin(router: ReturnType<typeof useRouter>, reason?: string) {
  const from = sanitizeFrom(currentPathWithQuery())
  const qs = new URLSearchParams({ from })
  if (reason) qs.set('reason', reason)
  router.push(`/login?${qs.toString()}`)
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function errorFromResponse(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

export default function NewNoteForm({ clientId }: Props) {
  const router = useRouter()

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const t = title.trim()
    const b = body.trim()

    if (!clientId) {
      setError('Missing client id.')
      return
    }

    if (!b) {
      setError('Note body is required.')
      return
    }

    if (loading) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    try {
      const res = await fetch(`/api/pro/clients/${clientId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          title: t || null,
          body: b,
        }),
      })

      if (res.status === 401) {
        redirectToLogin(router, 'new-note')
        return
      }

      const data = await safeJson(res)

      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      setTitle('')
      setBody('')
      router.refresh()
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error(err)
      setError('Network error.')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        borderRadius: 10,
        border: '1px solid #eee',
        padding: 12,
        background: '#fafafa',
        display: 'grid',
        gap: 8,
        fontSize: 13,
      }}
    >
      <div>
        <label
          htmlFor="note-title"
          style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}
        >
          Title (optional)
        </label>
        <input
          id="note-title"
          value={title}
          disabled={loading}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex: First visit, tricky blonde, very talkative"
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid #ddd',
            padding: 8,
            fontSize: 13,
            fontFamily: 'inherit',
            opacity: loading ? 0.85 : 1,
          }}
        />
      </div>

      <div>
        <label
          htmlFor="note-body"
          style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}
        >
          Note *
        </label>
        <textarea
          id="note-body"
          value={body}
          disabled={loading}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Ex: Prefers cooler tones, sensitive to strong fragrances, always books Saturday mornings."
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid #ddd',
            padding: 8,
            fontSize: 13,
            fontFamily: 'inherit',
            resize: 'vertical',
            opacity: loading ? 0.85 : 1,
          }}
        />
      </div>

      {error && <div style={{ fontSize: 12, color: 'red' }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '6px 14px',
            borderRadius: 999,
            border: 'none',
            background: loading ? '#374151' : '#111',
            color: '#fff',
            fontSize: 13,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Saving…' : 'Add note'}
        </button>
      </div>
    </form>
  )
}
