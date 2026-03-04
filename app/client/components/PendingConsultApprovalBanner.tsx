// app/client/components/PendingConsultApprovalBanner.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import ProProfileLink from '@/app/client/components/ProProfileLink'
import type { BookingLike } from '@/app/client/components/_helpers'
import { prettyWhen, bookingLocationLabel } from '@/app/client/components/_helpers'
import { safeJson, readErrorMessage } from '@/lib/http'
import { isRecord } from '@/lib/guards'

type Buckets = {
  upcoming?: BookingLike[]
  pending?: BookingLike[]
  prebooked?: BookingLike[]
  past?: BookingLike[]
  waitlist?: unknown[]
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function bookingTitle(b: BookingLike) {
  return b?.display?.title || b?.display?.baseName || 'A booking'
}

export default function PendingConsultApprovalBanner() {
  const [loading, setLoading] = useState(true)
  const [item, setItem] = useState<BookingLike | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)

      try {
        const res = await fetch('/api/client/bookings', { cache: 'no-store' })
        const data = await safeJson(res)

        if (!res.ok) {
          const msg = readErrorMessage(data) ?? `Failed to load bookings (${res.status}).`
          throw new Error(msg)
        }

        // Safely read buckets from unknown JSON
        const bucketsRaw =
          isRecord(data) && isRecord(data.buckets)
            ? data.buckets
            : null

        const upcoming = asArray<BookingLike>(bucketsRaw?.upcoming)
        const pending = asArray<BookingLike>(bucketsRaw?.pending)
        const prebooked = asArray<BookingLike>(bucketsRaw?.prebooked)

        const all = [...upcoming, ...pending, ...prebooked]
        const found = all.find((b) => b?.hasPendingConsultationApproval === true)

        if (!cancelled) setItem(found ?? null)
      } catch {
        if (!cancelled) setItem(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const href = useMemo(() => {
    if (!item?.id) return null
    return `/client/bookings/${encodeURIComponent(item.id)}?step=consult`
  }, [item?.id])

  if (loading) return null
  if (!item || !href) return null

  const svc = bookingTitle(item)
  const proLabel = item.professional?.businessName || 'Your pro'
  const when = item.scheduledFor ? prettyWhen(item.scheduledFor, item.timeZone) : ''
  const loc = bookingLocationLabel(item)

  return (
    <section className="rounded-card border border-white/10 bg-surfaceGlass p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-xs font-black text-microAccent">Action required</div>
          <div className="text-sm font-black text-textPrimary">Consultation approval needed</div>

          <div className="text-xs font-medium text-textSecondary">
            {svc}
            {' · '}
            <ProProfileLink
              proId={item.professional?.id ?? null}
              label={proLabel}
              className="text-textSecondary"
            />
            {when ? ` · ${when}` : ''}
            {loc ? ` · ${loc}` : ''}
          </div>
        </div>

        <a
          href={href}
          className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-3 py-2 text-xs font-black text-bgPrimary shadow-sm transition hover:bg-accentPrimaryHover"
        >
          Review &amp; approve
        </a>
      </div>
    </section>
  )
}