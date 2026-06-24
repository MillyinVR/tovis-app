// app/pro/clients/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { proClientVisibilityWhere } from '@/lib/clientVisibility'
import { formatInTimeZone } from '@/lib/time'
import { resolveProScheduleTimeZone } from '@/lib/proLocations/resolveProScheduleTimeZone'

import NewClientForm from './NewClientForm'
import ClientNameLink from '@/app/_components/ClientNameLink'
import EmptyState from '@/app/_components/boundaries/EmptyState'
import { Card, buttonClassName } from '@/app/_components/ui'

export const dynamic = 'force-dynamic'

function formatLastSeen(
  booking: { scheduledFor: Date } | null,
  tz: string,
) {
  if (!booking) return 'No bookings yet'

  return `Last booking: ${formatInTimeZone(booking.scheduledFor, tz, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`
}

function buildProToClientMessageHref(args: {
  proId: string
  clientId: string
}) {
  const { proId, clientId } = args

  return `/messages/start?contextType=PRO_PROFILE&contextId=${encodeURIComponent(
    proId,
  )}&clientId=${encodeURIComponent(clientId)}`
}

export default async function ProClientsPage() {
  const user = await getCurrentUser().catch(() => null)

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/clients')
  }

  const proId = user.professionalProfile.id
  const now = new Date()

  // Render the "Last booking" date in the pro's business timezone, not the
  // server zone (UTC on Vercel), so evening appointments show the right day.
  const scheduleTz = await resolveProScheduleTimeZone(
    proId,
    user.professionalProfile.timeZone,
  )

  // Single source of truth for chart access — same rule the page gate and the
  // clickable name use, so the list can never disagree with them.
  const visibleBookingWhere: Prisma.BookingWhereInput = {
    professionalId: proId,
    ...proClientVisibilityWhere(now),
  }

  const clients = await prisma.clientProfile.findMany({
    where: {
      bookings: {
        some: visibleBookingWhere,
      },
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 500,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      user: { select: { email: true } },
      bookings: {
        where: { professionalId: proId },
        orderBy: { scheduledFor: 'desc' },
        take: 1,
        select: { scheduledFor: true },
      },
    },
  })

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8 text-textPrimary">
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-black text-textPrimary">
              Clients
            </h1>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              Only clients you currently have access to
              (pending/active/upcoming).
            </div>
          </div>
        </div>
      </header>

      <section className="mb-6">
        <Card variant="glass" padding="md">
          <div className="mb-3">
            <div className="text-[15px] font-black text-textPrimary">
              Add a client
            </div>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              Add shadow clients and attach bookings + aftercare.
            </div>
          </div>

          <NewClientForm />
        </Card>
      </section>

      <section className="grid gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-black text-textPrimary">
              Client list
            </h2>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              Only clients with active access are shown here.
            </div>
          </div>

          <div className="text-[12px] font-semibold text-textSecondary">
            {clients.length ? `${clients.length} visible` : ''}
          </div>
        </div>

        {clients.length === 0 ? (
          <EmptyState
            title="No clients with active visibility right now."
            description="Only clients with active access appear here. Share your booking link to bring clients on."
            action={{ label: 'View profile', href: '/pro/profile' }}
          />
        ) : (
          <div className="grid gap-3">
            {clients.map((client) => {
              const lastBooking = client.bookings[0] ?? null
              const messageHref = buildProToClientMessageHref({
                proId,
                clientId: client.id,
              })

              return (
                <Card key={client.id} variant="glass" padding="md">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ClientNameLink canLink={true} clientId={client.id}>
                          {client.firstName} {client.lastName}
                        </ClientNameLink>
                      </div>

                      <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                        {client.user?.email ? client.user.email : 'No email'}
                        {client.phone ? ` • ${client.phone}` : ''}
                      </div>

                      <div className="mt-2 text-[11px] font-semibold text-textSecondary/80">
                        {formatLastSeen(lastBooking, scheduleTz)}
                      </div>
                    </div>

                    <div className="shrink-0">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Link
                          href={messageHref}
                          className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                        >
                          Message
                        </Link>

                        <Link
                          href={`/pro/clients/${encodeURIComponent(client.id)}`}
                          className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                        >
                          View chart
                        </Link>
                      </div>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}