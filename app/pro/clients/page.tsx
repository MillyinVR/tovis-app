// app/pro/clients/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BookingStatus, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

import NewClientForm from './NewClientForm'
import ClientNameLink from '@/app/_components/ClientNameLink'

export const dynamic = 'force-dynamic'

function formatLastSeen(booking: { scheduledFor: Date } | null) {
  if (!booking) return 'No visits yet'

  return `Last visit: ${booking.scheduledFor.toLocaleDateString(undefined, {
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

  const visibleBookingWhere: Prisma.BookingWhereInput = {
    professionalId: proId,
    OR: [
      { status: BookingStatus.PENDING },
      { startedAt: { not: null }, finishedAt: null },
      {
        status: { in: [BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS] },
        scheduledFor: { gte: now },
      },
    ],
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
        <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="mb-3">
            <div className="text-[15px] font-black text-textPrimary">
              Add a client
            </div>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              Add shadow clients and attach bookings + aftercare.
            </div>
          </div>

          <NewClientForm />
        </div>
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
          <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[12px] font-semibold text-textSecondary">
            No clients with active visibility right now.
          </div>
        ) : (
          <div className="grid gap-3">
            {clients.map((client) => {
              const lastBooking = client.bookings[0] ?? null
              const messageHref = buildProToClientMessageHref({
                proId,
                clientId: client.id,
              })

              return (
                <div
                  key={client.id}
                  className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4"
                >
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
                        {formatLastSeen(lastBooking)}
                      </div>
                    </div>

                    <div className="shrink-0">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Link
                          href={messageHref}
                          className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
                        >
                          Message
                        </Link>

                        <Link
                          href={`/pro/clients/${encodeURIComponent(client.id)}`}
                          className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
                        >
                          View chart
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}