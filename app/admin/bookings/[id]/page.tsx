// app/admin/bookings/[id]/page.tsx — admin money-trail inspector for any
// booking. Gates on Role.ADMIN like the rest of /admin (and the /money-trail +
// action APIs re-check ADMIN). Reached by direct URL /admin/bookings/{id};
// surfaces the same MoneyTrailInspector pros see, but for any booking.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import { formatInTimeZone, DEFAULT_TIME_ZONE } from '@/lib/time'
import MoneyTrailInspector from '@/app/_components/booking/MoneyTrailInspector'

export const dynamic = 'force-dynamic'

export default async function AdminBookingMoneyTrailPage(props: {
  params: Promise<{ id: string }>
}) {
  const { id } = await props.params

  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login')
  if (user.role !== Role.ADMIN) redirect('/forbidden')

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      scheduledFor: true,
      locationTimeZone: true,
      service: { select: { name: true } },
      client: { select: { firstName: true, lastName: true } },
      professional: {
        select: {
          businessName: true,
        },
      },
    },
  })

  // Admin is an approved viewer of the parties on a booking they may refund.
  const clientFullName = booking ? `${booking.client.firstName ?? ''} ${booking.client.lastName ?? ''}`.trim() : '' // pii-plaintext-read-ok: admin operational money-trail inspector identifies the client whose booking is being refunded
  const clientName = clientFullName || 'Client'

  const shortId = id.slice(-6).toUpperCase()

  return (
    <main className="mx-auto w-full max-w-960px px-4 py-6 text-textPrimary">
      <div className="mb-5">
        <Link
          href="/admin"
          className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-textMuted transition hover:text-textSecondary"
        >
          ← Admin
        </Link>
        <h1 className="mt-2 text-[22px] font-black">Booking money trail</h1>
        <p className="mt-1 text-[13px] text-textSecondary">
          Every charge, fee, and refund on booking #{shortId}. Refund or waive
          from here — the same controls pros have, with full override.
        </p>
      </div>

      {!booking ? (
        <div className="rounded-card border border-toneDanger/30 bg-toneDanger/10 p-4 text-[13px] font-black text-toneDanger">
          No booking found for id{' '}
          <span className="font-mono">{id}</span>.
        </div>
      ) : (
        <div className="grid gap-3.5">
          <section className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accentPrimary">
              Booking · #{shortId}
            </div>
            <div className="mt-1.5 font-display text-[18px] font-bold">
              {booking.service?.name ?? 'Booking'}
            </div>
            <div className="mt-1 grid gap-0.5 text-[12.5px] text-textSecondary">
              <div>Client: {clientName}</div>
              <div>
                Pro: {booking.professional.businessName ?? 'Professional'}
              </div>
              <div>
                Scheduled:{' '}
                {formatInTimeZone(
                  booking.scheduledFor,
                  booking.locationTimeZone ?? DEFAULT_TIME_ZONE,
                  {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  },
                )}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-textMuted">
                Status: {booking.status}
              </div>
            </div>
          </section>

          <MoneyTrailInspector bookingId={booking.id} />
        </div>
      )}
    </main>
  )
}
