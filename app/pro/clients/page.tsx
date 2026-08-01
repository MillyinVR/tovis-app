// app/pro/clients/page.tsx
import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { proClientVisibilityWhere } from '@/lib/clientVisibility'
import { formatLastBookingLabel } from '@/lib/clients/lastBookingLabel'
import { resolveProScheduleTimeZone } from '@/lib/proLocations/resolveProScheduleTimeZone'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import { PRO_CLIENT_POLICY_SELECT } from '@/lib/proClientPolicy/load'
import { summarizeProClientPolicy } from '@/lib/proClientPolicy/summary'

import NewClientForm from './NewClientForm'
import ClientsList, { type ProClientRow } from './ClientsList'
import { Card } from '@/app/_components/ui'

export const dynamic = 'force-dynamic'

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
        select: { scheduledFor: true, locationTimeZone: true },
      },
    },
  })

  // K16-B — the booking requirements this pro has set, for the whole roster in
  // one query (the model carries @@index([professionalId, updatedAt]) for it).
  //
  // Gated on the SAME flag as the control that sets them: while the
  // technical-record gate is off the chart page never renders the policy form,
  // so a roster badge would surface a requirement the pro has no way to reach.
  // Off ⇒ no query at all, not an empty render.
  //
  // 🔴 Reads the STORED switches, not `loadProClientPolicy` — the resolver
  // applies the card-on-file rail gate, and a client the pro restricted must
  // not read as unrestricted on the roster. The rail flag is passed to the
  // summary separately so that one requirement can be marked inactive instead.
  const technicalEnabled = isClientTechnicalRecordEnabled(proId)

  // Bounded by the roster above (which takes 500), not by the pro's whole
  // policy history — the rows for clients this pro can no longer see would be
  // fetched and then dropped.
  const policyRows =
    technicalEnabled && clients.length > 0
      ? await prisma.proClientPolicy.findMany({
          where: {
            professionalId: proId,
            clientId: { in: clients.map((client) => client.id) },
          },
          select: { clientId: true, ...PRO_CLIENT_POLICY_SELECT },
        })
      : []

  const cardOnFileRailEnabled = noShowProtectionEnabled()
  const policyByClientId = new Map(
    policyRows.map(({ clientId, ...policy }) => [clientId, policy]),
  )

  // Flatten to serializable display + search strings here (server-side) so the
  // client search list carries no raw PII fields and needs no extra fetch. The
  // last-booking label + message href are resolved in the pro's timezone.
  const clientRows: ProClientRow[] = clients.map((client) => {
    const email = client.user?.email ?? null // pii-plaintext-read-ok: pro reads own visible client contact for the clients list
    const phone = client.phone // pii-plaintext-read-ok: pro reads own visible client contact for the clients list
    const displayName = `${client.firstName} ${client.lastName}`.trim() || 'Client' // pii-plaintext-read-ok: pro reads own visible client name for the clients list

    return {
      id: client.id,
      displayName,
      contactLine: `${email ? email : 'No email'}${phone ? ` • ${phone}` : ''}`,
      searchText: `${displayName} ${email ?? ''} ${phone ?? ''}`
        .toLowerCase()
        .trim(),
      lastBookingLabel: formatLastBookingLabel(
        client.bookings[0] ?? null,
        scheduleTz,
      ),
      messageHref: buildProToClientMessageHref({ proId, clientId: client.id }),
      requirements: summarizeProClientPolicy({
        policy: policyByClientId.get(client.id) ?? null,
        cardOnFileRailEnabled,
      }),
    }
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

      <ClientsList clients={clientRows} />
    </main>
  )
}