// app/client/components/PastBookings.tsx
'use client'

import Link from 'next/link'
import type { BookingLike } from './_helpers'
import { prettyWhen, locationLabel } from './_helpers'

function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-surfaceGlass px-2 py-1 text-[11px] font-black text-textPrimary">
      {label}
    </span>
  )
}

export default function PastBookings({ items }: { items: BookingLike[] }) {
  const list = items || []

  function statusLabel(statusRaw: any) {
    const s = String(statusRaw || '').toUpperCase()
    if (s === 'COMPLETED') return 'Completed'
    if (s === 'CANCELLED') return 'Cancelled'
    if (s === 'ACCEPTED') return 'Confirmed'
    if (s === 'PENDING') return 'Requested'
    return s || 'Unknown'
  }

  return (
    <div className="grid gap-2">
      <div className="text-sm font-black text-textPrimary">Past</div>

      {list.map((b) => {
        const svc = b?.service?.name || 'Appointment'
        const pro = b?.professional?.businessName || 'Professional'
        const when = prettyWhen(b?.scheduledFor)
        const loc = locationLabel(b?.professional)
        const hasUnreadAftercare = Boolean((b as any)?.hasUnreadAftercare)

        return (
          <Link
            key={b.id}
            href={`/client/bookings/${encodeURIComponent(b.id)}`}
            className="block no-underline"
          >
            <div className="cursor-pointer rounded-card border border-white/10 bg-bgPrimary p-3 text-textPrimary">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-black">{svc}</div>
                <div className="text-xs font-semibold text-textSecondary">{when}</div>
              </div>

              <div className="mt-1 text-sm">
                <span className="font-black">{pro}</span>
                {loc ? <span className="text-textSecondary"> · {loc}</span> : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusPill label={statusLabel(b?.status)} />
                {hasUnreadAftercare ? <StatusPill label="New aftercare" /> : null}
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
