// app/pro/clients/[id]/NewAllergyForm.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { isAbortError, safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'

type Props = { clientId: string }

const SEVERITIES = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'] as const
type Severity = (typeof SEVERITIES)[number]

function getErrorMessage(data: unknown): string | null {
  if (!isRecord(data)) return null

  const error = data.error
  if (typeof error !== 'string') return null

  const trimmed = error.trim()
  return trimmed ? trimmed : null
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

function errorFromResponse(res: Response, data: unknown) {
  const apiError = getErrorMessage(data)
  if (apiError) return apiError

  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'

  return `Request failed (${res.status}).`
}

function isSeverity(value: string): value is Severity {
  return SEVERITIES.includes(value as Severity)
}

export default function NewAllergyForm({ clientId }: Props) {
  const router = useRouter()

  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<Severity>('MODERATE')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const l = label.trim()
    const d = description.trim()

    if (!clientId) {
      setError('Missing client id.')
      return
    }

    if (!l) {
      setError('Label is required.')
      return
    }

    if (loading) return

    abortRef.current?.abort()

    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)

    try {
      const res = await fetch(`/api/pro/clients/${encodeURIComponent(clientId)}/allergies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          label: l,
          description: d || null,
          severity,
        }),
      })

      if (res.status === 401) {
        redirectToLogin(router, 'new-allergy')
        return
      }

      const data = await safeJson(res)

      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      setLabel('')
      setDescription('')
      setSeverity('MODERATE')
      router.refresh()
    } catch (err: unknown) {
      if (isAbortError(err)) return

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
        border: '1px solid rgb(var(--text-primary) / 0.10)',
        padding: 12,
        background: 'rgb(var(--text-primary) / 0.04)',
        display: 'grid',
        gap: 8,
        fontSize: 13,
      }}
    >
      <div>
        <label
          htmlFor="allergy-label"
          style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}
        >
          Allergy / sensitivity *
        </label>

        <input
          id="allergy-label"
          value={label}
          disabled={loading}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Ex: PPD, latex, lash glue, fragrance"
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid rgb(var(--text-primary) / 0.10)',
            padding: 8,
            fontSize: 13,
            fontFamily: 'inherit',
            opacity: loading ? 0.85 : 1,
          }}
        />
      </div>

      <div>
        <label
          htmlFor="allergy-description"
          style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}
        >
          Description (optional)
        </label>

        <textarea
          id="allergy-description"
          value={description}
          disabled={loading}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Ex: scalp redness, swelling around eyes, prefers patch tests."
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid rgb(var(--text-primary) / 0.10)',
            padding: 8,
            fontSize: 13,
            fontFamily: 'inherit',
            resize: 'vertical',
            opacity: loading ? 0.85 : 1,
          }}
        />
      </div>

      <div>
        <label
          htmlFor="severity"
          style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}
        >
          Severity
        </label>

        <select
          id="severity"
          value={severity}
          disabled={loading}
          onChange={(e) => {
            const next = e.target.value
            if (isSeverity(next)) setSeverity(next)
          }}
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid rgb(var(--text-primary) / 0.10)',
            padding: 8,
            fontSize: 13,
            fontFamily: 'inherit',
            opacity: loading ? 0.85 : 1,
          }}
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {error ? <div style={{ fontSize: 12, color: 'rgb(var(--tone-danger))' }}>{error}</div> : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '6px 14px',
            borderRadius: 999,
            border: 'none',
            background: loading ? 'rgb(var(--text-secondary))' : 'rgb(var(--text-primary))',
            color: 'rgb(var(--bg-primary))',
            fontSize: 13,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Saving…' : 'Add allergy'}
        </button>
      </div>
    </form>
  )
}