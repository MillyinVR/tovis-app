// app/client/(gated)/_components/SubmitViralLookForm.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import TovisEye from '@/lib/brand/TovisEye'
import { readErrorMessage, safeJsonRecord } from '@/lib/http'

export default function SubmitViralLookForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const trimmedName = name.trim()
    const trimmedSourceUrl = sourceUrl.trim()

    setError(null)
    setNotice(null)

    if (!trimmedName) {
      setError('Name the look so pros know what to match.')
      return
    }

    try {
      setSubmitting(true)

      const res = await fetch('/api/viral-service-requests', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: trimmedName,
          sourceUrl: trimmedSourceUrl || undefined,
        }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        throw new Error(
          readErrorMessage(data) ?? 'Couldn’t submit your look. Try again.',
        )
      }

      setName('')
      setSourceUrl('')
      setNotice('Submitted — our team is reviewing it now.')
      router.refresh()
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error && submitError.message.trim()
          ? submitError.message
          : 'Couldn’t submit your look. Try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex flex-col overflow-hidden rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[30px] -top-10 h-[150px] w-[150px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgb(var(--iris) / 0.20), transparent 70%)',
        }}
      />
      <div className="relative flex flex-1 flex-col">
        <div className="mb-2.5 flex items-center gap-2">
          <TovisEye size={18} />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-textMuted">
            Spotted a new one?
          </span>
        </div>
        <h3 className="mb-1.5 font-display text-[18px] font-semibold tracking-[-0.015em] text-textPrimary">
          Submit a viral look
        </h3>
        <p className="mb-3 text-[12.5px] leading-relaxed text-textSecondary">
          Paste the link and name it. Our team vets it and shares it with pros
          before it goes live.
        </p>

        {notice ? (
          <div className="mb-2.5 rounded-[12px] border border-terra/25 bg-terra/10 px-3.5 py-2.5 text-[12px] font-semibold text-terra">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="mb-2.5 rounded-[12px] border border-toneDanger/25 bg-toneDanger/10 px-3.5 py-2.5 text-[12px] font-semibold text-toneDanger">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
          <label className="mb-2.5 flex items-center gap-2.5 rounded-[12px] border border-textPrimary/10 bg-[rgb(var(--surface-glass)/0.05)] px-3 py-[11px]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-textMuted">
              <path d="M9 15l6-6" />
              <path d="M11 6.5l1-1a3.5 3.5 0 0 1 5 5l-1 1" />
              <path d="M13 17.5l-1 1a3.5 3.5 0 0 1-5-5l1-1" />
            </svg>
            <input
              type="url"
              name="sourceUrl"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              disabled={submitting}
              placeholder="Paste TikTok / Instagram / Pinterest link…"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-textPrimary outline-none placeholder:text-textMuted/70 disabled:opacity-60"
            />
          </label>
          <label className="mb-3 flex items-center gap-2.5 rounded-[12px] border border-textPrimary/10 bg-[rgb(var(--surface-glass)/0.05)] px-3 py-[11px]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-textMuted">
              <path d="M4 7h16M7 7l1 13h8l1-13" />
              <path d="M9 7V4h6v3" />
            </svg>
            <input
              type="text"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={submitting}
              maxLength={160}
              placeholder="Name this look…"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-textPrimary outline-none placeholder:text-textMuted/70 disabled:opacity-60"
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="mt-auto flex h-11 items-center justify-center rounded-[13px] bg-cta font-display text-[13.5px] font-bold text-onCta transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit for review →'}
          </button>
        </form>
      </div>
    </div>
  )
}
