'use client'

// K15: the pro's control for "send this form to the client to sign".
//
// This is the missing half K14-B named. Until now the pro could only RECORD
// that a client signed something; the one option that implied the platform had
// sent a link ("Client link") had no link behind it. This button is that link.
//
// The client's next upcoming appointment is what the signature is attached to,
// resolved server-side — a pro thinking "send them the waiver" is not thinking
// about which booking id it hangs off. When there is no upcoming appointment
// the server refuses and says so, rather than sending nothing quietly.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Select } from '@/app/_components/ui'
import type { ConsentFormOption } from '@/lib/consentForms/loader'
import { readErrorMessageOr } from '@/lib/http'

type Props = {
  clientId: string
  forms: ConsentFormOption[]
}

export default function SendConsentFormButton({ clientId, forms }: Props) {
  const router = useRouter()
  const [formId, setFormId] = useState('')
  const [sending, setSending] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  const busy = sending || pending

  if (forms.length === 0) return null

  async function send() {
    if (!formId || busy) return

    setSending(true)
    setError(null)
    setSent(null)

    try {
      const res = await fetch(`/api/v1/pro/clients/${clientId}/consent-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId }),
      })

      const payload: unknown = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(readErrorMessageOr(payload, 'Could not send the form.'))
        return
      }

      setSent('Sent — the client has a link to read and sign it.')
      setFormId('')

      // The record only appears once the client signs, but a refresh keeps this
      // panel honest about anything that changed while the pro was here.
      startTransition(() => {
        router.refresh()
      })
    } catch {
      setError('Network error.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="grid gap-2 rounded-card border border-white/10 bg-bgPrimary p-3">
      <div className="text-[12px] font-black text-textPrimary">
        Send a form to sign
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* 🔴 This is the one field in either family whose container is
            `bg-bgPrimary` (the panel above), and `bg-bgPrimary/70` over
            `bg-bgPrimary` IS `bg-bgPrimary` — so it already renders at Δ=0
            against its own panel, which is the exact defect that keeps the
            `raised` family off `solid`. `raised` is the fix, but changing it
            here would be a restyle of a surface nobody can currently render
            (the seeded pro owns no ConsentForm rows, so it never appears), so
            it keeps its appearance and the bug is written up in the register.

            `w-auto` cancels the kit's `w-full`: this is a `flex-1` item in a
            row, and `width:100%` would fight its own flex basis. `py-2` is its
            own shorter box. */}
        <Select
          surface="translucent"
          className="w-auto min-w-[200px] flex-1 py-2"
          value={formId}
          disabled={busy}
          onChange={(event) => setFormId(event.target.value)}
          aria-label="Form to send"
        >
          <option value="">Choose a form…</option>
          {forms.map((form) => (
            <option key={form.formId} value={form.formId}>
              {form.title} (v{form.version})
            </option>
          ))}
        </Select>

        <button
          type="button"
          onClick={send}
          disabled={!formId || busy}
          className="inline-flex h-9 items-center rounded-full bg-textPrimary px-4 text-[12px] font-black text-bgPrimary transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>

      {error ? (
        <div className="text-[12px] font-semibold text-toneDanger">{error}</div>
      ) : null}
      {sent ? (
        <div className="text-[12px] font-semibold text-toneSuccess">{sent}</div>
      ) : null}

      <div className="text-[11px] text-textSecondary/70">
        Goes to their next upcoming appointment with you, by email or text. The
        record appears here once they sign — pinned to the exact wording they
        were shown.
      </div>
    </div>
  )
}
