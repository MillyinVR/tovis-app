// app/client/components/UpcomingBookings.tsx
'use client'

import Link from 'next/link'
import type { BookingLike } from './_helpers'
import { prettyWhen } from './_helpers'

function prettyWhere(b: BookingLike) {
  const p = b.professional
  const bits = [p?.location, p?.city, p?.state].filter(Boolean)
  return bits.length ? bits.join(', ') : null
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-surfaceGlass px-2 py-1 text-[11px] font-black text-textPrimary">
      {children}
    </span>
  )
}

export default function UpcomingBookings({ items }: { items: BookingLike[] }) {
  if (!items?.length) return null

  return (
    <section className="mt-5">
      <h2 className="mb-2 text-base font-black text-textPrimary">Upcoming</h2>

      <div className="grid gap-3">
        {items.map((b) => {
          const when = prettyWhen(b.scheduledFor)
          const serviceName = b.service?.name || 'Appointment'
          const proName = b.professional?.businessName || 'Professional'
          const where = prettyWhere(b)

          return (
            <Link
              key={b.id}
              href={`/client/bookings/${encodeURIComponent(b.id)}`}
              className="block no-underline"
            >
              <div className="cursor-pointer rounded-card border border-white/10 bg-bgPrimary p-3 text-textPrimary">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-sm font-black">{serviceName}</div>
                  <Pill>Confirmed</Pill>
                </div>

                <div className="mt-2 text-sm">
                  <span className="font-black">{when}</span>
                  <span className="text-textSecondary"> · {proName}</span>
                  {where ? <span className="text-textSecondary"> · {where}</span> : null}
                </div>

                <div className="mt-2 text-xs font-medium text-textSecondary">
                  Tap to view details.
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
