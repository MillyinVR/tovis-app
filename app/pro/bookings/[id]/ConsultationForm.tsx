'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  bookingId: string
  initialNotes: string
  initialPrice: string | number | null
}

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

export default function ConsultationForm({ bookingId, initialNotes, initialPrice }: Props) {
  const router = useRouter()

  const [notes, setNotes] = useState(initialNotes || '')
  const [price, setPrice] = useState(
    initialPrice !== null && initialPrice !== undefined ? String(initialPrice) : '',
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)

    if (!bookingId) {
      setError('Missing booking id.')
      return
    }

    if (saving) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setSaving(true)

    try {
      const res = await fetch(`/api/pro/bookings/${bookingId}/consultation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          notes,
          // keep as string for now (your API can decide how to parse)
          price: price.trim() || null,
        }),
      })

      if (res.status === 401) {
        redirectToLogin(router, 'consultation')
        return
      }

      const data = await safeJson(res)

      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      setMessage('Consultation saved.')
      router.refresh()
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error(err)
      setError('Network error saving consultation.')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        borderRadius: 12,
        border: '1px solid #eee',
        padding: 16,
        background: '#fff',
        display: 'grid',
        gap: 12,
        fontSize: 13,
      }}
    >
      <div>
        <label
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 4,
          }}
        >
          Consultation notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          disabled={saving}
          placeholder="Goals, techniques, color formulas, anything you agreed on before starting…"
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid #ddd',
            padding: 8,
            fontSize: 13,
            fontFamily: 'inherit',
            resize: 'vertical',
            opacity: saving ? 0.85 : 1,
          }}
        />
      </div>

      <div>
        <label
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 4,
          }}
        >
          Agreed price (total)
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 13 }}>$</span>
          <input
            type="text"
            inputMode="decimal"
            value={price}
            disabled={saving}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g. 350"
            style={{
              flex: 1,
              borderRadius: 8,
              border: '1px solid #ddd',
              padding: '6px 8px',
              fontSize: 13,
              fontFamily: 'inherit',
              opacity: saving ? 0.85 : 1,
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>
          This doesn&apos;t charge the client, it just records what you both agreed before starting.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: '6px 16px',
            borderRadius: 999,
            border: 'none',
            fontSize: 13,
            background: saving ? '#374151' : '#111',
            color: '#fff',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save consultation'}
        </button>

        {message && <span style={{ fontSize: 11, color: '#16a34a' }}>{message}</span>}
        {error && <span style={{ fontSize: 11, color: '#ef4444' }}>{error}</span>}
      </div>
    </form>
  )
}
