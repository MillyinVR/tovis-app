// app/client/bookings/[id]/ConsultationDecisionCard.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

async function safeJson(res: Response) {
  return res.json().catch(() => ({}))
}

function errorFrom(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (res.status === 401) return 'Please log in again.'
  if (res.status === 403) return 'You don’t have access to do that.'
  if (res.status === 409) return data?.error || 'This consultation can’t be changed right now.'
  return `Request failed (${res.status}).`
}

function asItems(proposedServicesJson: unknown): Array<{ label?: string; categoryName?: string | null; price?: any }> {
  const j: any = proposedServicesJson
  return Array.isArray(j?.items) ? j.items : []
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-surfaceGlass px-2 py-1 text-[11px] font-black text-textPrimary">
      {children}
    </span>
  )
}

export default function ConsultationDecisionCard(props: {
  bookingId: string
  appointmentTz: string
  notes: string
  proposedTotalLabel: string | null
  proposedServicesJson?: unknown
  disabled?: boolean
}) {
  const { bookingId, appointmentTz, notes, proposedTotalLabel, proposedServicesJson, disabled } = props
  const router = useRouter()

  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<'approve' | 'reject' | null>(null)

  const items = useMemo(() => asItems(proposedServicesJson), [proposedServicesJson])

  async function decide(action: 'approve' | 'reject') {
    if (disabled || loading) return
    setErr(null)
    setDone(null)
    setLoading(action)

    try {
      const url = `/api/client/bookings/${encodeURIComponent(bookingId)}/consultation/${action}`
      const res = await fetch(url, { method: 'POST' })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(errorFrom(res, data))

      setDone(action)
      router.refresh()
      router.push(`/client/bookings/${encodeURIComponent(bookingId)}?step=consult&consultation=${action}`)
    } catch (e: any) {
      setErr(e?.message || 'Something went wrong.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <section className="mt-3 rounded-card border border-white/10 bg-bgSecondary p-3 text-textPrimary">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="text-sm font-black text-accentPrimary">Approve this consultation?</div>
        <Pill>{appointmentTz}</Pill>
      </div>

      <div className="mt-3 text-xs font-black text-textSecondary">Proposed services</div>

      {items.length ? (
        <div className="mt-2 grid gap-2">
          {items.map((it, idx) => (
            <div key={idx} className="flex items-start justify-between gap-3 rounded-card border border-white/10 bg-bgPrimary p-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-textPrimary">{it?.label || 'Service'}</div>
                {it?.categoryName ? (
                  <div className="text-xs font-semibold text-textSecondary">{it.categoryName}</div>
                ) : null}
              </div>
              <div className="text-sm font-black text-textPrimary">
                {it?.price != null ? (
                  <span>{String(it.price).trim().startsWith('$') ? String(it.price).trim() : `$${String(it.price).trim()}`}</span>
                ) : (
                  '—'
                )}

              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-sm font-medium text-textSecondary">No line items provided.</div>
      )}

      <div className="mt-3 text-xs font-black text-textSecondary">Proposed total</div>
      <div className="mt-1 text-base font-black text-textPrimary">
        {proposedTotalLabel || 'Not provided'}
      </div>

      <div className="mt-3 text-xs font-black text-textSecondary">Notes</div>
      <div className="mt-1 whitespace-pre-wrap text-sm text-textPrimary">
        {notes?.trim() ? notes : 'No consultation notes provided.'}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => decide('approve')}
          disabled={disabled || loading !== null}
          className={[
            'rounded-full px-4 py-2 text-sm font-black transition',
            disabled || loading
              ? 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary'
              : 'border border-white/10 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
          ].join(' ')}
        >
          {loading === 'approve' ? 'Approving…' : 'Approve'}
        </button>

        <button
          type="button"
          onClick={() => decide('reject')}
          disabled={disabled || loading !== null}
          className={[
            'rounded-full px-4 py-2 text-sm font-black transition',
            disabled || loading
              ? 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary'
              : 'border border-white/10 bg-bgPrimary text-textPrimary hover:bg-surfaceGlass',
          ].join(' ')}
        >
          {loading === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>

      {done ? (
        <div className="mt-3 text-sm font-semibold text-textSecondary">
          {done === 'approve'
            ? 'Approved. Your pro can proceed.'
            : 'Rejected. Your pro will revise and resend.'}
        </div>
      ) : null}

      {err ? <div className="mt-3 text-sm font-semibold text-microAccent">{err}</div> : null}

      <div className="mt-3 text-xs font-medium text-textSecondary">
        If you reject, the pro gets kicked back to consultation to revise.
      </div>
    </section>
  )
}
