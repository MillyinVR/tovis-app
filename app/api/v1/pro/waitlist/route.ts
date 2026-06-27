// app/api/v1/pro/waitlist/route.ts
//
// Pro-facing waitlist outreach feed: the clients waiting for this pro's
// services, grouped by service and ordered FIFO (join order). The pro works the
// list top-down to fill a spot from the waitlist — so the rank here is honest
// (it reflects who has been waiting longest), unlike a client-facing "in line"
// number, which the first-come last-minute engine doesn't honor.
import { WaitlistStatus } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { prismaRead } from '@/lib/prisma'
import { formatWaitlistPreferenceLabel } from '@/lib/waitlist/preferenceLabel'

export const dynamic = 'force-dynamic'

type WaitlistOutreachEntry = {
  rank: number
  waitlistEntryId: string
  clientName: string
  avatarUrl: string | null
  preferenceLabel: string
  joinedAt: string
}

type WaitlistOutreachServiceGroup = {
  serviceId: string
  serviceName: string
  entries: WaitlistOutreachEntry[]
}

function clientDisplayName(
  firstName: string | null,
  lastName: string | null,
): string {
  const name = [firstName, lastName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ')

  return name.length > 0 ? name : 'Client'
}

export async function GET() {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  try {
    const rows = await prismaRead.waitlistEntry.findMany({
      where: {
        professionalId: auth.professionalId,
        status: WaitlistStatus.ACTIVE,
      },
      // FIFO: the client who joined first is rank #1 within their service.
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: {
        id: true,
        createdAt: true,
        preferenceType: true,
        specificDate: true,
        timeOfDay: true,
        windowStartMin: true,
        windowEndMin: true,
        service: { select: { id: true, name: true } },
        client: {
          select: { firstName: true, lastName: true, avatarUrl: true },
        },
      },
    })

    const groups = new Map<string, WaitlistOutreachServiceGroup>()

    for (const row of rows) {
      const serviceId = row.service?.id
      if (!serviceId) continue

      let group = groups.get(serviceId)
      if (!group) {
        group = {
          serviceId,
          serviceName: row.service?.name ?? 'Service',
          entries: [],
        }
        groups.set(serviceId, group)
      }

      group.entries.push({
        // Rank within the service group; rows are already createdAt-ascending.
        rank: group.entries.length + 1,
        waitlistEntryId: row.id,
        clientName: clientDisplayName(
          row.client?.firstName ?? null,
          row.client?.lastName ?? null,
        ),
        avatarUrl: row.client?.avatarUrl ?? null,
        preferenceLabel: formatWaitlistPreferenceLabel({
          preferenceType: row.preferenceType,
          specificDate: row.specificDate,
          timeOfDay: row.timeOfDay,
          windowStartMin: row.windowStartMin,
          windowEndMin: row.windowEndMin,
        }),
        joinedAt: row.createdAt.toISOString(),
      })
    }

    const services = Array.from(groups.values())
    const total = rows.length

    return jsonOk({ services, total }, 200)
  } catch (err) {
    console.error('GET /api/v1/pro/waitlist', err)
    return jsonFail(500, 'Failed to load waitlist.')
  }
}
