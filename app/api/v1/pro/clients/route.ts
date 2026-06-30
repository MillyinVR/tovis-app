// app/api/v1/pro/clients/route.ts
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { upsertProClient } from '@/lib/clients/upsertProClient'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { proClientVisibilityWhere } from '@/lib/clientVisibility'
import { formatLastBookingLabel } from '@/lib/clients/lastBookingLabel'
import { resolveProScheduleTimeZone } from '@/lib/proLocations/resolveProScheduleTimeZone'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DIRECTORY_SELECT = {
  id: true,
  firstName: true, // pii-plaintext-read-ok: authorized pro client directory; plaintext-by-schema.
  lastName: true, // pii-plaintext-read-ok: authorized pro client directory; plaintext-by-schema.
  phone: true, // pii-plaintext-read-ok: authorized pro client directory; plaintext-by-schema.
  user: { select: { email: true } },
} satisfies Prisma.ClientProfileSelect

/**
 * GET /api/v1/pro/clients — the native port of the web `/pro/clients` directory.
 * Lists every client this pro currently has access to (pending / active /
 * upcoming / recently-completed), the same scoped set the web page renders,
 * ordered by name, with a "Last booking: …" label per client. Native filters
 * client-side; there is no server search here (the web page has none either).
 * PRO-only; the list IS the visible set, so every row is openable.
 */
export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const proId = auth.professionalId
    const now = new Date()

    // Render "Last booking" in the pro's business zone, not the server zone
    // (UTC on Vercel), so evening appointments show the right day.
    const scheduleTz = await resolveProScheduleTimeZone(
      proId,
      auth.user.professionalProfile?.timeZone,
    )

    // Same single-source visibility rule as the page gate and the clickable
    // name — the list can never disagree with them.
    const visibleBookingWhere: Prisma.BookingWhereInput = {
      professionalId: proId,
      ...proClientVisibilityWhere(now),
    }

    const clients = await prisma.clientProfile.findMany({
      where: { bookings: { some: visibleBookingWhere } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 500,
      select: {
        ...DIRECTORY_SELECT,
        bookings: {
          where: { professionalId: proId },
          orderBy: { scheduledFor: 'desc' },
          take: 1,
          select: { scheduledFor: true, locationTimeZone: true },
        },
      },
    })

    const rows = clients.map((c) => {
      const fullName =
        `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.user?.email || 'Client' // pii-plaintext-read-ok: authorized pro client directory display name; plaintext-by-schema.

      return {
        id: String(c.id),
        fullName,
        // The directory is the visible set, so every client is openable.
        canViewClient: true,
        email: c.user?.email ?? null,
        phone: c.phone ?? null,
        lastBookingLabel: formatLastBookingLabel(c.bookings[0] ?? null, scheduleTz),
      }
    })

    return jsonOk({ clients: rows, count: rows.length }, 200)
  } catch (error) {
    console.error('GET /api/v1/pro/clients error', error)
    return jsonFail(500, 'Failed to load clients.')
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const body = await readJsonRecord(request)

    const result = await upsertProClient({
      professionalId: auth.professionalId,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
    })

    if (!result.ok) {
      return jsonFail(result.status, result.error, { code: result.code })
    }

    return jsonOk(
      {
        id: result.clientId,
        clientId: result.clientId,
        userId: result.userId,
        email: result.email,
      },
      200,
    )
  } catch (error) {
    console.error('POST /api/v1/pro/clients error', error)
    return jsonFail(500, 'Internal server error')
  }
}