// app/(main)/booking/add-ons/ui/AddOnsClient.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  holdId: string
  offeringId: string
  locationType: 'SALON' | 'MOBILE'
  source: 'REQUESTED' | 'DISCOVERY' | 'AFTERCARE'
  mediaId: string | null

  // server-provided add-ons from OfferingAddOn
  addOns: AddOnDTO[]
}

type AddOnDTO = {
  id: string // OfferingAddOn.id ✅
  serviceId: string
  title: string
  group: string | null
  price: string // "25.00"
  minutes: number
  sortOrder: number
  isRecommended: boolean
}

export default function AddOnsClient({ holdId, offeringId, locationType, source, mediaId, addOns }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const defaultSelected = useMemo(() => {
    const rec = addOns.find((a) => a.isRecommended)
    return rec ? new Set([rec.id]) : new Set<string>()
  }, [addOns])

  const [selectedIds, setSelectedIds] = useState<Set<string>>(defaultSelected)

  const totals = useMemo(() => {
    const chosen = addOns.filter((a) => selectedIds.has(a.id))
    const extraMinutes = chosen.reduce((sum, a) => sum + (a.minutes || 0), 0)
    const extraPrice = chosen.reduce((sum, a) => sum + (Number(a.price) || 0), 0)
    return { extraPrice, extraMinutes, chosenCount: chosen.length }
  }, [addOns, selectedIds])

  const grouped = useMemo(() => {
    const m = new Map<string, AddOnDTO[]>()
    for (const a of addOns) {
      const key = (a.group || 'Add-ons').trim()
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(a)
    }
    return Array.from(m.entries()).map(([group, items]) => ({
      group,
      items: items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    }))
  }, [addOns])

  async function finalize() {
    if (submitting) return
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/bookings/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holdId,
          offeringId,
          locationType,
          source,
          mediaId,

          // ✅ submit OfferingAddOn IDs
          addOnIds: Array.from(selectedIds),
        }),
      })

      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Failed (${res.status})`)

      router.push(`/booking/${encodeURIComponent(body.booking.id)}`)
    } catch (e: any) {
      setError(e?.message || 'Could not finalize booking.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto max-w-180 px-4 pb-24 pt-10 text-textPrimary">
      <div className="text-[12px] font-black text-textSecondary">Almost done</div>
      <h1 className="mt-1 text-[26px] font-black">Complete your look</h1>
      <div className="mt-1 text-[13px] text-textSecondary">Quick upgrades clients often add for better results.</div>

      {addOns.length === 0 ? (
        <div className="tovis-glass mt-4 rounded-card border border-white/10 bg-bgSecondary p-4 text-[12px] font-semibold text-textSecondary">
          No add-ons available for this service.
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {grouped.map(({ group, items }) => (
            <div key={group} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
              <div className="text-[12px] font-black text-textSecondary">{group}</div>

              <div className="mt-3 grid gap-2">
                {items.map((a) => {
                  const active = selectedIds.has(a.id)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev)
                          if (next.has(a.id)) next.delete(a.id)
                          else next.add(a.id)
                          return next
                        })
                      }}
                      className={[
                        'rounded-card border px-4 py-3 text-left transition',
                        'border-white/10 bg-bgPrimary/35 hover:bg-white/10',
                        active ? 'ring-1 ring-accentPrimary' : '',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[13px] font-black">
                          {a.title}{' '}
                          {a.isRecommended ? (
                            <span className="ml-2 rounded-full border border-white/10 bg-bgPrimary/35 px-2 py-1 text-[10px] font-black text-textPrimary">
                              Recommended
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[12px] font-black text-textPrimary">${a.price}</div>
                      </div>

                      <div className="mt-2 text-[11px] font-semibold text-textSecondary">+{a.minutes} min</div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="tovis-glass-soft rounded-card border border-white/10 px-4 py-3 text-[12px] font-semibold text-textSecondary">
            Selected: <span className="font-black text-textPrimary">{totals.chosenCount}</span> · Extra time:{' '}
            <span className="font-black text-textPrimary">{totals.extraMinutes} min</span> · Est. add:{' '}
            <span className="font-black text-textPrimary">${totals.extraPrice.toFixed(2)}</span>
          </div>
        </div>
      )}

      {error ? (
        <div className="tovis-glass-soft mt-3 rounded-card p-3 text-[12px] font-semibold text-toneDanger">{error}</div>
      ) : null}

      <div className="tovis-glass-soft mt-4 rounded-card border border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={() => void finalize()}
          disabled={submitting}
          className="flex h-12 w-full items-center justify-center rounded-full border border-white/10 bg-accentPrimary text-[14px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-70"
        >
          {submitting ? 'Confirming…' : 'Confirm request'}
        </button>

        <button
          type="button"
          onClick={() => router.back()}
          disabled={submitting}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-full border border-white/10 bg-bgPrimary/35 text-[14px] font-black text-textPrimary hover:bg-white/10 disabled:opacity-70"
        >
          Skip
        </button>

        <div className="mt-2 text-center text-[11px] font-semibold text-textSecondary">No charge yet. The pro confirms next.</div>
      </div>
    </main>
  )
}
