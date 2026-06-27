// app/pro/clients/NewClientForm.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { isAbortError, safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { Button } from '@/app/_components/ui'

type ApiErrorPayload = {
  error?: unknown
}

function currentPathWithQuery(): string {
  if (typeof window === 'undefined') return '/pro'
  return window.location.pathname + window.location.search + window.location.hash
}

function sanitizeFrom(from: string): string {
  const trimmed = from.trim()
  if (!trimmed) return '/pro'
  if (!trimmed.startsWith('/')) return '/pro'
  if (trimmed.startsWith('//')) return '/pro'
  return trimmed
}

function redirectToLogin(
  router: ReturnType<typeof useRouter>,
  reason?: string,
): void {
  const from = sanitizeFrom(currentPathWithQuery())
  const qs = new URLSearchParams({ from })

  if (reason) {
    qs.set('reason', reason)
  }

  router.push(`/login?${qs.toString()}`)
}

function errorFromResponse(res: Response, data: unknown): string {
  const payload: ApiErrorPayload = isRecord(data) ? data : {}

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error.trim()
  }

  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'

  return `Request failed (${res.status}).`
}

export default function NewClientForm() {
  const router = useRouter()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (loading) return

    setError(null)
    setSuccess(false)

    const trimmedFirstName = firstName.trim()
    const trimmedLastName = lastName.trim()
    const trimmedEmail = email.trim()
    const trimmedPhone = phone.trim()

    if (!trimmedFirstName || !trimmedLastName || !trimmedEmail) {
      setError('First name, last name, and email are required.')
      return
    }

    abortRef.current?.abort()

    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)

    try {
      const res = await fetch('/api/v1/pro/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          firstName: trimmedFirstName,
          lastName: trimmedLastName,
          email: trimmedEmail,
          phone: trimmedPhone || null,
        }),
      })

      if (res.status === 401) {
        redirectToLogin(router, 'new-client')
        return
      }

      const data: unknown = await safeJson(res)

      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      setSuccess(true)
      setFirstName('')
      setLastName('')
      setEmail('')
      setPhone('')

      router.refresh()
    } catch (err: unknown) {
      if (isAbortError(err)) return

      console.error(err)
      setError('Network error while creating client.')
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }

      setLoading(false)
    }
  }

  const fieldClassName =
    'w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none placeholder:text-textSecondary disabled:opacity-60'
  const labelClassName = 'mb-1 block text-xs font-semibold text-textSecondary'

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-3 rounded-card border border-white/10 bg-bgSurface p-4"
    >
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label htmlFor="firstName" className={labelClassName}>
            First name *
          </label>

          <input
            id="firstName"
            value={firstName}
            disabled={loading}
            onChange={(event) => setFirstName(event.target.value)}
            className={fieldClassName}
          />
        </div>

        <div>
          <label htmlFor="lastName" className={labelClassName}>
            Last name *
          </label>

          <input
            id="lastName"
            value={lastName}
            disabled={loading}
            onChange={(event) => setLastName(event.target.value)}
            className={fieldClassName}
          />
        </div>
      </div>

      <div>
        <label htmlFor="email" className={labelClassName}>
          Email *
        </label>

        <input
          id="email"
          type="email"
          value={email}
          disabled={loading}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="client@email.com"
          className={fieldClassName}
        />
      </div>

      <div>
        <label htmlFor="phone" className={labelClassName}>
          Phone (optional)
        </label>

        <input
          id="phone"
          value={phone}
          disabled={loading}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="For reminders later"
          className={fieldClassName}
        />
      </div>

      {error ? (
        <div className="text-xs font-semibold text-toneDanger">{error}</div>
      ) : null}

      {success ? (
        <div className="text-xs font-semibold text-toneSuccess">
          Client added.
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={loading}>
          {loading ? 'Saving…' : 'Add client'}
        </Button>
      </div>
    </form>
  )
}