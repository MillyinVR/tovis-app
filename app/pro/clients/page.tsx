// app/pro/clients/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import NewClientForm from './NewClientForm'
import ClientNameLink from '@/app/_components/ClientNameLink'
import { getVisibleClientIdSetForPro } from '@/lib/clientVisibility'

export const dynamic = 'force-dynamic'

function formatLastSeen(booking: { scheduledFor: Date } | null) {
  if (!booking) return 'No visits yet'
  const d = new Date(booking.scheduledFor)
  return `Last visit: ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export default async function ProClientsPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/clients')
  }

  const proId = user.professionalProfile.id

  const [clients, visibleClientIdSet] = await Promise.all([
    prisma.clientProfile.findMany({
      orderBy: { firstName: 'asc' },
      take: 2000,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        user: { select: { email: true } },
        bookings: {
          orderBy: { scheduledFor: 'desc' },
          take: 1,
          select: { scheduledFor: true },
        },
      },
    }),
    getVisibleClientIdSetForPro(proId),
  ])

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8 text-textPrimary">
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-black text-textPrimary">Clients</h1>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">Your client list inside TOVIS.</div>
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
              Names are clickable only when you currently have visibility.
            </div>
          </div>
          <div className="text-[12px] font-semibold text-textSecondary">{clients.length ? `${clients.length} total` : ''}</div>
        </div>

        {clients.length === 0 ? (
          <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[12px] font-semibold text-textSecondary">
            No clients yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {clients.map((c) => {
              const canLink = visibleClientIdSet.has(String(c.id))
              const lastBooking = c.bookings?.[0] ?? null

              return (
                <div key={c.id} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ClientNameLink canLink={canLink} clientId={c.id}>
                          {c.firstName} {c.lastName}
                        </ClientNameLink>

                        {!canLink ? (
                          <span className="rounded-full border border-white/10 bg-bgPrimary px-2 py-0.5 text-[10px] font-black text-textSecondary">
                            No active access
                          </span>
                        ) : null}
                      </div>

                      {/* ✅ Don’t leak contact info when no access */}
                      <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                        {canLink ? (
                          <>
                            {c.user?.email ? c.user.email : 'No email'}
                            {c.phone ? ` • ${c.phone}` : ''}
                          </>
                        ) : (
                          <span className="text-textSecondary/80">Contact info hidden until active access</span>
                        )}
                      </div>

                      <div className="mt-2 text-[11px] font-semibold text-textSecondary/80">{formatLastSeen(lastBooking)}</div>
                    </div>

                    <div className="shrink-0">
                      {canLink ? (
                        <a
                          href={`/pro/clients/${encodeURIComponent(c.id)}`}
                          className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
                        >
                          View chart
                        </a>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary/50 px-4 py-2 text-[12px] font-black text-textSecondary">
                          View chart
                        </span>
                      )}
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
