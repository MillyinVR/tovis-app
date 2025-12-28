// app/pro/bookings/[id]/ConsultationForm.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  bookingId: string
  initialNotes: string
  initialPrice: string | number | null
}

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
}

function errorFromResponse(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (typeof data?.message === 'string') return data.message
  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

function normalizeMoneyInput(raw: string) {
  const s = String(raw || '')
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .trim()

  if (!s) return { value: null as string | null, ok: true }

  // allow "350", "350.00", ".99"
  if (!/^\d*\.?\d{0,2}$/.test(s)) return { value: s, ok: false }

  const normalized = s.startsWith('.') ? `0${s}` : s
  if (normalized === '.' || normalized === '0.') return { value: null, ok: false }

  return { value: normalized, ok: true }
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

  const parsed = useMemo(() => normalizeMoneyInput(price), [price])
  const canSubmit = Boolean(bookingId && !saving && parsed.ok && parsed.value)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)

    if (!bookingId) return setError('Missing booking id.')
    if (saving) return

    const normalized = normalizeMoneyInput(price)
    if (!normalized.ok || !normalized.value) {
      setError('Enter a valid price (numbers only, up to 2 decimals).')
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setSaving(true)

    try {
      // 1) Save consultation notes + price (your existing endpoint)
      const res1 = await fetch(`/api/pro/bookings/${bookingId}/consultation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          notes,
          // backend route converts dollars -> cents
          price: normalized.value,
        }),
      })

      const data1 = await safeJson(res1)
      if (!res1.ok) {
        setError(errorFromResponse(res1, data1))
        return
      }

      // 2) Create/update consultation approval (PENDING) + advance sessionStep
      const proposedTotal = normalized.value
      const proposedServicesJson = {
        items: [
          {
            label: 'Service (from booking)',
            price: proposedTotal,
          },
        ],
      }

      const res2 = await fetch(`/api/pro/bookings/${bookingId}/consultation-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          proposedServicesJson,
          proposedTotal,
          notes,
        }),
      })

      const data2 = await safeJson(res2)
      if (!res2.ok) {
        setError(errorFromResponse(res2, data2))
        return
      }

      setMessage('Sent to client for approval.')
      router.refresh()
      router.push(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error(err)
      setError('Network error sending consultation.')
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
        <label style={{ display: 'block', fontSize: 13, fontWeight: 800, marginBottom: 4 }}>
          Consultation notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          disabled={saving}
          placeholder="Goals, techniques, anything you agreed on…"
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
        <label style={{ display: 'block', fontSize: 13, fontWeight: 800, marginBottom: 4 }}>
          Agreed price (total)
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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

        {!parsed.ok ? (
          <div style={{ fontSize: 11, color: '#ef4444', marginTop: 6 }}>
            Price must be a number with up to 2 decimals.
          </div>
        ) : (
          <div style={{ fontSize: 11, color: '#777', marginTop: 6 }}>
            Submitting sends this to the client to approve.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            padding: '8px 16px',
            borderRadius: 999,
            border: 'none',
            fontSize: 13,
            fontWeight: 900,
            background: !canSubmit ? '#374151' : '#111',
            color: '#fff',
            cursor: !canSubmit ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.9 : 1,
          }}
        >
          {saving ? 'Sending…' : 'Send to client for approval'}
        </button>

        {message ? <span style={{ fontSize: 11, color: '#16a34a' }}>{message}</span> : null}
        {error ? <span style={{ fontSize: 11, color: '#ef4444' }}>{error}</span> : null}
      </div>
    </form>
  )
}
