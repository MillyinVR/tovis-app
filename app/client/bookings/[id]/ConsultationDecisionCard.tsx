// app/client/bookings/[id]/ConsultationDecisionCard.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { moneyToString } from '@/lib/money'
import { COPY } from '@/lib/copy'

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

type ProposedItem = {
  label?: string
  categoryName?: string | null
  price?: unknown
}

function asItems(proposedServicesJson: unknown): ProposedItem[] {
  const j: any = proposedServicesJson
  return Array.isArray(j?.items) ? (j.items as ProposedItem[]) : []
}

function formatMoneyLike(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'string') return moneyToString(v)
  return null
}

function moneyLabel(v: unknown): string {
  const normalized = formatMoneyLike(v)
  const s = typeof normalized === 'string' ? normalized.trim() : ''
  if (!s) return COPY.common.emDash
  return s.startsWith('$') ? s : `$${s}`
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-surfaceGlass px-2 py-1 text-[11px] font-black text-textPrimary">
      {children}
    </span>
  )
}

type DecisionAction = 'APPROVE' | 'REJECT'

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

  const [loading, setLoading] = useState<DecisionAction | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<DecisionAction | null>(null)

  const items = useMemo(() => asItems(proposedServicesJson), [proposedServicesJson])

  const totalLabel = useMemo(() => {
    if (typeof proposedTotalLabel === 'string') {
      const t = proposedTotalLabel.trim()
      if (t) return t.startsWith('$') ? t : `$${t}`
    }
    return COPY.common.notProvided
  }, [proposedTotalLabel])

  async function decide(action: DecisionAction) {
    if (disabled || loading) return
    setErr(null)
    setDone(null)
    setLoading(action)

    try {
      const res = await fetch(`/api/client/bookings/${encodeURIComponent(bookingId)}/consultation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(errorFrom(res, data))

      setDone(action)

      // Make the page re-fetch server data (status/sessionStep/etc)
      router.refresh()

      // Keep your existing UX
      const qp = action === 'APPROVE' ? 'approve' : 'reject'
      router.push(`/client/bookings/${encodeURIComponent(bookingId)}?step=consult&consultation=${qp}`)
    } catch (e: any) {
      setErr(e?.message || 'Something went wrong.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <section className="mt-3 rounded-card border border-white/10 bg-bgSecondary p-3 text-textPrimary">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="text-sm font-black text-accentPrimary">{COPY.consultationDecisionCard.title}</div>
        <Pill>{appointmentTz}</Pill>
      </div>

      <div className="mt-3 text-xs font-black text-textSecondary">{COPY.consultationDecisionCard.proposedServices}</div>

      {items.length ? (
        <div className="mt-2 grid gap-2">
          {items.map((it, idx) => {
            const label =
              typeof it?.label === 'string' && it.label.trim()
                ? it.label.trim()
                : COPY.consultationDecisionCard.serviceFallback

            const category =
              typeof it?.categoryName === 'string' && it.categoryName.trim() ? it.categoryName.trim() : null

            const key = `${label}:${category ?? ''}:${idx}`

            return (
              <div
                key={key}
                className="flex items-start justify-between gap-3 rounded-card border border-white/10 bg-bgPrimary p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-black text-textPrimary">{label}</div>
                  {category ? <div className="text-xs font-semibold text-textSecondary">{category}</div> : null}
                </div>

                <div className="text-sm font-black text-textPrimary">{moneyLabel(it?.price)}</div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mt-2 text-sm font-medium text-textSecondary">{COPY.consultationDecisionCard.noLineItems}</div>
      )}

      <div className="mt-3 text-xs font-black text-textSecondary">{COPY.consultationDecisionCard.proposedTotal}</div>
      <div className="mt-1 text-base font-black text-textPrimary">{totalLabel}</div>

      <div className="mt-3 text-xs font-black text-textSecondary">{COPY.consultationDecisionCard.notes}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm text-textPrimary">
        {notes?.trim() ? notes : COPY.consultationDecisionCard.noNotes}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => decide('APPROVE')}
          disabled={disabled || loading !== null}
          className={[
            'rounded-full px-4 py-2 text-sm font-black transition',
            disabled || loading
              ? 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary'
              : 'border border-white/10 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
          ].join(' ')}
        >
          {loading === 'APPROVE' ? COPY.consultationDecisionCard.approving : COPY.consultationDecisionCard.approve}
        </button>

        <button
          type="button"
          onClick={() => decide('REJECT')}
          disabled={disabled || loading !== null}
          className={[
            'rounded-full px-4 py-2 text-sm font-black transition',
            disabled || loading
              ? 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary'
              : 'border border-white/10 bg-bgPrimary text-textPrimary hover:bg-surfaceGlass',
          ].join(' ')}
        >
          {loading === 'REJECT' ? COPY.consultationDecisionCard.rejecting : COPY.consultationDecisionCard.reject}
        </button>
      </div>

      {done ? (
        <div className="mt-3 text-sm font-semibold text-textSecondary">
          {done === 'APPROVE' ? COPY.consultationDecisionCard.approvedDone : COPY.consultationDecisionCard.rejectedDone}
        </div>
      ) : null}

      {err ? <div className="mt-3 text-sm font-semibold text-microAccent">{err}</div> : null}

      <div className="mt-3 text-xs font-medium text-textSecondary">{COPY.consultationDecisionCard.rejectHelp}</div>
    </section>
  )
}
