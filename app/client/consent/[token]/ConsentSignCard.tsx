'use client'

// K15: the interactive half of the public consent-signing page.
//
// Signing is NEVER one tap from the link. Anyone holding the SMS holds the
// token (the K12 premise), so the act is deliberate: the client types their
// name and presses "I agree" — the click-wrap norm, and the typed name is the
// signature the record stores.
//
// On success the page is refreshed inside a transition rather than re-rendered
// from local state, so what the client sees afterwards is the SERVER's reading
// of their signature. K13-web's bug was re-enabling controls before
// router.refresh() committed; useTransition is the fix, and the button stays
// disabled through both halves.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { isRecord } from '@/lib/guards'
import {
  CONSENT_SIGNATURE_NAME_MAX,
  parseConsentSignatureName,
} from '@/lib/consentForms/signatureName'

type Props = {
  token: string
  formTitle: string
  professionalLabel: string
}

function readErrorMessage(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.error === 'string'
    ? payload.error
    : fallback
}

export function ConsentSignCard(props: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // The SAME rule the route enforces, imported rather than restated — a button
  // that enables on input the server then refuses is a control that lies.
  const signature = parseConsentSignatureName(name)
  const busy = submitting || pending
  const canSign = agreed && signature !== null && !busy

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSign) return

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(
        `/api/v1/public/consent/${encodeURIComponent(props.token)}/sign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signatureName: signature }),
        },
      )

      const payload: unknown = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(
          readErrorMessage(payload, 'We could not record your signature.'),
        )
        return
      }

      // Let the server tell the page what happened. The signed state, its
      // timestamp and the text on file all come back from the reload.
      startTransition(() => {
        router.refresh()
      })
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-card border border-white/10 bg-bgSecondary p-5"
    >
      <div className="text-sm font-black text-textPrimary">Sign this form</div>

      <label className="mt-4 grid gap-1.5">
        <span className="text-[11px] font-black text-textSecondary">
          Your full name
        </span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
          maxLength={CONSENT_SIGNATURE_NAME_MAX}
          autoComplete="name"
          placeholder="Type your full name"
          className="w-full rounded-xl border border-white/10 bg-bgPrimary/70 px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary/70 focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
        />
      </label>

      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={agreed}
          disabled={busy}
          onChange={(event) => setAgreed(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-accentPrimary"
        />
        <span className="text-[12px] leading-relaxed text-textSecondary">
          I have read “{props.formTitle}” above and I agree to it. Typing my name
          counts as my signature, and {props.professionalLabel} keeps a copy of
          this exact text on file.
        </span>
      </label>

      {error ? (
        <div className="mt-4 rounded-xl border border-toneDanger/20 bg-toneDanger/5 px-3 py-2 text-[12px] font-semibold text-toneDanger">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={!canSign}
        className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-full bg-textPrimary text-[13px] font-black text-bgPrimary transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Signing…' : 'I agree — sign'}
      </button>
    </form>
  )
}
