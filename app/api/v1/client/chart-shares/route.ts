// app/api/v1/client/chart-shares/route.ts
//
// W5 — the CLIENT's side of chart consent: who can see my chart, and take it
// back.
//
// This is the surface the whole feature exists for. It answers a question a
// client previously had no way to ask ("who can read my allergies and my
// notes?") and gives them the only answer that matters ("nobody I haven't
// said yes to").
//
// GET  — every professional with a share row, plus what state it is in.
// PATCH — { professionalId, action: 'GRANT' | 'DECLINE' | 'REVOKE' }
//
// ⚠️ REVOKE is never refused. A consent control that can say no to its own
// subject is not a consent control — see [[a-kill-switch-must-not-trap-its-user]].
// Gate the GRANT, never the undo.

import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  respondToChartShare,
  revokeChartShare,
} from '@/lib/clients/chartShare'
import { notifyChartAccessGranted } from '@/lib/notifications/chartAccessNotifications'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { prisma } from '@/lib/prisma'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'

export const dynamic = 'force-dynamic'

const ACTIONS = ['GRANT', 'DECLINE', 'REVOKE'] as const
type ShareAction = (typeof ACTIONS)[number]

function parseAction(value: unknown): ShareAction | null {
  const raw = pickString(value)?.toUpperCase()
  return ACTIONS.find((action) => action === raw) ?? null
}

export async function GET() {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const rows = await prisma.clientChartShare.findMany({
      where: { clientId: auth.clientId },
      orderBy: { updatedAt: 'desc' },
      select: {
        status: true,
        requestedAt: true,
        respondedAt: true,
        revokedAt: true,
        professional: {
          select: {
            id: true,
            businessName: true,
            firstName: true, // pii-plaintext-read-ok: pro public display name (formatProfessionalPublicDisplayName)
            lastName: true, // pii-plaintext-read-ok: pro public display name (formatProfessionalPublicDisplayName)
            handle: true,
            nameDisplay: true,
            avatarUrl: true,
          },
        },
      },
      take: 200,
    })

    return jsonOk(
      {
        shares: rows.map((row) => ({
          professionalId: row.professional.id,
          professionalName: formatProfessionalPublicDisplayName(
            row.professional,
            'Professional',
          ),
          avatarUrl: row.professional.avatarUrl ?? null,
          status: row.status,
          requestedAt: row.requestedAt?.toISOString() ?? null,
          respondedAt: row.respondedAt?.toISOString() ?? null,
          revokedAt: row.revokedAt?.toISOString() ?? null,
        })),
      },
      200,
    )
  } catch (error) {
    console.error('GET /api/v1/client/chart-shares error', error)
    return jsonFail(500, 'Failed to load chart sharing.')
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const body = await readJsonRecord(req)
    const professionalId = pickString(body.professionalId)
    const action = parseAction(body.action)

    if (!professionalId) return jsonFail(400, 'Missing professionalId.')
    if (!action) {
      return jsonFail(400, 'action must be GRANT, DECLINE or REVOKE.')
    }

    if (action === 'REVOKE') {
      // Deliberately BEFORE the existence check below. Revoking is always
      // allowed and always lands in the same end state, including for a pair
      // with no row — the client asked for "this pro cannot see my chart", and
      // that is what they get.
      const result = await revokeChartShare({
        clientId: auth.clientId,
        professionalId,
      })
      return jsonOk({ chartShare: { professionalId, status: result.status } }, 200)
    }

    // GRANT / DECLINE name a professional, so that professional has to exist.
    // Revoke does not need this — see above.
    const professional = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { id: true },
    })

    if (!professional) return jsonFail(404, 'Professional not found.')

    const result = await respondToChartShare({
      clientId: auth.clientId,
      professionalId,
      grant: action === 'GRANT',
    })

    // GRANT only. A DECLINE is never announced to the pro who asked — see the
    // ⚠️ block in lib/notifications/chartAccessNotifications.ts. Best-effort for
    // the same reason as the request side: the consent row already committed,
    // and it, not the notification, is what opens the chart.
    if (action === 'GRANT') {
      await notifyChartAccessGranted({
        clientId: auth.clientId,
        professionalId,
      }).catch((error) => {
        console.error('PATCH /api/v1/client/chart-shares notify error', error)
      })
      kickNotificationDrain()
    }

    return jsonOk({ chartShare: { professionalId, status: result.status } }, 200)
  } catch (error) {
    console.error('PATCH /api/v1/client/chart-shares error', error)
    return jsonFail(500, 'Failed to update chart sharing.')
  }
}
