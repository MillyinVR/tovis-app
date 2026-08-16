'use client'

// K15: "send it now" from the session-start warning.
//
// Posts to the same route the client chart's control uses, but with an explicit
// bookingId — the pro is standing in front of THIS appointment, so the link must
// hang off it rather than off whichever booking happens to be next.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { readErrorMessageOr } from '@/lib/http'

type Props = {
  clientId: string
  bookingId: string
  formId: string
  formTitle: string
}

export function SendConsentLinkButton(props: Props) {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<
    { tone: 'ok' | 'bad'; text: string } | null
  >(null)

  const busy = sending || pending

  async function send() {
    if (busy) return

    setSending(true)
    setMessage(null)

    try {
      const res = await fetch(
        `/api/v1/pro/clients/${props.clientId}/consent-requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            formId: props.formId,
            bookingId: props.bookingId,
          }),
        },
      )

      const payload: unknown = await res.json().catch(() => ({}))

      if (!res.ok) {
        setMessage({
          tone: 'bad',
          text: readErrorMessageOr(payload, 'Could not send the form.'),
        })
        return
      }

      setMessage({ tone: 'ok', text: 'Sent' })

      // The banner clears itself only once the client actually signs, so the
      // refresh is about anything else that moved — not about hiding the ask.
      startTransition(() => {
        router.refresh()
      })
    } catch {
      setMessage({ tone: 'bad', text: 'Network error.' })
    } finally {
      setSending(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={send}
        disabled={busy}
        aria-label={`Send “${props.formTitle}” to the client to sign`}
        className="inline-flex h-7 items-center rounded-full border border-surfaceGlass/15 bg-bgPrimary/70 px-3 text-[11px] font-black text-textPrimary transition hover:border-surfaceGlass/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Sending…' : 'Send to sign'}
      </button>

      {message ? (
        <span
          className={
            message.tone === 'ok'
              ? 'text-[11px] font-black text-toneSuccess'
              : 'text-[11px] font-black text-toneDanger'
          }
        >
          {message.text}
        </span>
      ) : null}
    </span>
  )
}
