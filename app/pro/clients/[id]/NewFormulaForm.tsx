'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = { clientId: string }

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 8,
  border: '1px solid rgb(var(--text-primary) / 0.10)',
  padding: 8,
  fontSize: 13,
  fontFamily: 'inherit',
}

export default function NewFormulaForm({ clientId }: Props) {
  const router = useRouter()
  const [brand, setBrand] = useState('')
  const [developer, setDeveloper] = useState('')
  const [ratio, setRatio] = useState('')
  const [processing, setProcessing] = useState('')
  const [resultNotes, setResultNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pro/clients/${clientId}/formula`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: brand.trim() || null,
          developer: developer.trim() || null,
          ratio: ratio.trim() || null,
          processingTimeMinutes: processing.trim() ? Number(processing) : null,
          resultNotes: resultNotes.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error || 'Failed to save.')
        return
      }
      setBrand('')
      setDeveloper('')
      setRatio('')
      setProcessing('')
      setResultNotes('')
      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        borderRadius: 10,
        border: '1px solid rgb(var(--text-primary) / 0.10)',
        padding: 12,
        background: 'rgb(var(--text-primary) / 0.04)',
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
        <input
          value={brand}
          disabled={loading}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="Brand / line"
          style={inputStyle}
        />
        <input
          value={developer}
          disabled={loading}
          onChange={(e) => setDeveloper(e.target.value)}
          placeholder="Developer (e.g. 20 vol)"
          style={inputStyle}
        />
        <input
          value={ratio}
          disabled={loading}
          onChange={(e) => setRatio(e.target.value)}
          placeholder="Ratio (e.g. 1:1.5)"
          style={inputStyle}
        />
        <input
          value={processing}
          disabled={loading}
          onChange={(e) => setProcessing(e.target.value)}
          placeholder="Processing (min)"
          inputMode="numeric"
          style={inputStyle}
        />
      </div>
      <textarea
        value={resultNotes}
        disabled={loading}
        onChange={(e) => setResultNotes(e.target.value)}
        rows={2}
        placeholder="Result / notes (encrypted)"
        style={{ ...inputStyle, resize: 'vertical' }}
      />
      {error ? (
        <div style={{ fontSize: 12, color: 'rgb(var(--tone-danger))' }}>{error}</div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '6px 14px',
            borderRadius: 999,
            border: 'none',
            background: 'rgb(var(--text-primary))',
            color: 'rgb(var(--bg-primary))',
            fontSize: 13,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Saving…' : 'Add formula'}
        </button>
      </div>
    </form>
  )
}
