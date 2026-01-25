// app/client/components/UpcomingBookings.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import type { BookingLike } from './_helpers'
import { prettyWhen, bookingLocationLabel, statusUpper } from './_helpers'
import ProProfileLink from './ProProfileLink'
import CardLink from './CardLink'

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-surfaceGlass px-2 py-1 text-[11px] font-black text-textPrimary">
      {children}
    </span>
  )
}

function statusLabel(statusRaw: unknown) {
  const s = statusUpper(statusRaw)
  if (s === 'PENDING') return 'Requested'
  if (s === 'ACCEPTED') return 'Confirmed'
  if (s === 'COMPLETED') return 'Completed'
  if (s === 'CANCELLED') return 'Cancelled'
  return s || 'Upcoming'
}



export default function UpcomingBookings({ items }: { items: BookingLike[] }) {
  const list = useMemo(() => items ?? [], [items])

  return (
    <section className="mt-5">
      <h2 className="text-sm font-black text-textPrimary">Upcoming</h2>

      <div className="mt-2 grid gap-3">
        {list.map((b) => {
          const href = `/client/bookings/${encodeURIComponent(b.id)}`
          const svc = b?.display?.title || b?.display?.baseName || 'Appointment'
          const when = prettyWhen(b?.scheduledFor, b?.timeZone)
          const loc = bookingLocationLabel(b)

          const proId = b?.professional?.id || null
          const proLabel = b?.professional?.businessName || 'Professional'

          return (
            <CardLink
              key={b.id}
              href={href}
              className="cursor-pointer rounded-card border border-white/10 bg-bgPrimary p-3 text-textPrimary"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-black">{svc}</div>
                <div className="text-xs font-semibold text-textSecondary">{when}</div>
              </div>

              <div className="mt-2 text-sm">
                {/* ✅ This is now safe: no outer <a> exists */}
                <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                  <ProProfileLink proId={proId} label={proLabel} className="text-textSecondary font-semibold" />
                </span>

                {loc ? <span className="text-textSecondary"> · {loc}</span> : null}
              </div>

              <div className="mt-3">
                <Pill>{statusLabel(b?.status)}</Pill>
              </div>
            </CardLink>
          )
        })}

        {list.length === 0 ? <div className="text-sm font-medium text-textSecondary">No upcoming bookings.</div> : null}
      </div>
    </section>
  )
}
