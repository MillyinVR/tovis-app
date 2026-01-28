// app/pro/clients/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import NewClientForm from './NewClientForm'
import ClientNameLink from '@/app/_components/ClientNameLink'

export const dynamic = 'force-dynamic'

function formatLastSeen(booking: { scheduledFor: Date } | null) {
  if (!booking) return 'No visits yet'
  const d = new Date(booking.scheduledFor)
  return `Last visit: ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function buildProToClientMessageHref(args: { proId: string; clientId: string }) {
  const { proId, clientId } = args
  // ✅ For PRO -> client, resolve expects clientId
  return `/messages/start?contextType=PRO_PROFILE&contextId=${encodeURIComponent(proId)}&clientId=${encodeURIComponent(
    clientId,
  )}`
}

export default async function ProClientsPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/clients')
  }

  const proId = user.professionalProfile.id
  const now = new Date()

  // ✅ Scalable: only return clients this PRO currently has visibility for
  // visibility criteria mirrors your clientVisibility.ts policy
  const visibleBookingWhere = {
    professionalId: proId,
    OR: [
      { status: 'PENDING' as any },
      { startedAt: { not: null }, finishedAt: null },
      { status: 'ACCEPTED' as any, scheduledFor: { gte: now } },
    ],
  }

  const clients = await prisma.clientProfile.findMany({
    where: {
      bookings: {
        some: visibleBookingWhere,
      },
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 500, // ✅ keep reasonable; later we’ll paginate/search
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      user: { select: { email: true } },

      // latest booking with THIS pro (for last seen)
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
            <h1 className="text-[22px] font-black text-textPrimary">Clients</h1>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              Only clients you currently have access to (pending/active/upcoming).
            </div>
          </div>
        </div>
      </header>

      <section className="mb-6">
        <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="mb-3">
            <div className="text-[15px] font-black text-textPrimary">Add a client</div>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              Add “shadow clients” and attach bookings + aftercare.
            </div>
          </div>
          <NewClientForm />
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-black text-textPrimary">Client list</h2>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              Only clients with active access are shown here.
            </div>
          </div>
          <div className="text-[12px] font-semibold text-textSecondary">{clients.length ? `${clients.length} visible` : ''}</div>
        </div>

        {clients.length === 0 ? (
          <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[12px] font-semibold text-textSecondary">
            No clients with active visibility right now.
          </div>
        ) : (
          <div className="grid gap-3">
            {clients.map((c) => {
              const lastBooking = c.bookings?.[0] ?? null
              const messageHref = buildProToClientMessageHref({ proId, clientId: String(c.id) })

              return (
                <div key={c.id} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ClientNameLink canLink={true} clientId={c.id}>
                          {c.firstName} {c.lastName}
                        </ClientNameLink>
                      </div>

                      {/* ✅ contact info is safe now because list is already visibility-scoped */}
                      <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                        {c.user?.email ? c.user.email : 'No email'}
                        {c.phone ? ` • ${c.phone}` : ''}
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
                          href={`/pro/clients/${encodeURIComponent(String(c.id))}`}
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
