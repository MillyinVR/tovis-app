// app/api/messages/resolve/route.ts

import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk, pickString, upper } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type CtxType = 'BOOKING' | 'SERVICE' | 'OFFERING' | 'PRO_PROFILE'

function asCtxType(v: unknown): CtxType | null {
  const s = upper(v)
  if (s === 'BOOKING' || s === 'SERVICE' || s === 'OFFERING' || s === 'PRO_PROFILE') return s as CtxType
  return null
}

function viewerIds(user: any) {
  const clientId = user?.clientProfile?.id ?? null
  const proId = user?.professionalProfile?.id ?? null
  return { clientId, proId }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const body = await req.json().catch(() => ({}))
    const contextType = asCtxType(body?.contextType)
    const contextId = pickString(body?.contextId)
    if (!contextType || !contextId) return jsonFail(400, 'Missing contextType/contextId.')

    const { clientId: viewerClientId, proId: viewerProId } = viewerIds(user)

    // Determine clientId + professionalId for the thread based on context
    let clientId: string | null = null
    let professionalId: string | null = null
    let bookingId: string | null = null
    let serviceId: string | null = null
    let offeringId: string | null = null

    if (contextType === 'BOOKING') {
      bookingId = contextId
      const b = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, clientId: true, professionalId: true, serviceId: true, offeringId: true },
      })
      if (!b) return jsonFail(404, 'Booking not found.')
      clientId = b.clientId
      professionalId = b.professionalId
      serviceId = b.serviceId
      offeringId = b.offeringId ?? null

      const allowed = (viewerClientId && viewerClientId === clientId) || (viewerProId && viewerProId === professionalId)
      if (!allowed) return jsonFail(403, 'Forbidden.')
    }

    if (contextType === 'SERVICE') {
      serviceId = contextId
      if (!viewerClientId) return jsonFail(403, 'Clients only.')

      const proId = pickString(body?.professionalId)
      if (!proId) return jsonFail(400, 'Missing professionalId for SERVICE thread.')
      clientId = viewerClientId
      professionalId = proId
    }

    if (contextType === 'OFFERING') {
      offeringId = contextId
      if (!viewerClientId) return jsonFail(403, 'Clients only.')

      const off = await prisma.professionalServiceOffering.findUnique({
        where: { id: offeringId },
        select: { id: true, professionalId: true, serviceId: true },
      })
      if (!off) return jsonFail(404, 'Offering not found.')
      clientId = viewerClientId
      professionalId = off.professionalId
      serviceId = off.serviceId
    }

    if (contextType === 'PRO_PROFILE') {
      if (!viewerClientId && !viewerProId) return jsonFail(403, 'Unauthorized.')
      professionalId = contextId
      if (viewerClientId) clientId = viewerClientId
      else {
        // Pro opening a profile thread with a client requires clientId supplied
        const cid = pickString(body?.clientId)
        if (!cid) return jsonFail(400, 'Missing clientId for PRO_PROFILE when opened by pro.')
        clientId = cid
      }
    }

    if (!clientId || !professionalId) return jsonFail(400, 'Could not resolve thread participants.')

    // upsert thread
    const thread = await prisma.messageThread.upsert({
      where: {
        clientId_professionalId_contextType_contextId: {
          clientId,
          professionalId,
          contextType: contextType as any,
          contextId,
        },
      },
      update: {
        bookingId,
        serviceId,
        offeringId,
      },
      create: {
        clientId,
        professionalId,
        contextType: contextType as any,
        contextId,
        bookingId,
        serviceId,
        offeringId,
        participants: {
          create: [
            { userId: user.id, role: user.role as any },
            // create the other participant too (deterministic)
          ],
        },
      },
      select: { id: true, contextType: true, contextId: true, clientId: true, professionalId: true },
    })

    // ensure both participants exist (client + pro userIds)
    const [clientUser, proUser] = await Promise.all([
      prisma.clientProfile.findUnique({ where: { id: clientId }, select: { userId: true } }),
      prisma.professionalProfile.findUnique({ where: { id: professionalId }, select: { userId: true } }),
    ])

    const needed = [clientUser?.userId, proUser?.userId].filter(Boolean) as string[]
    for (const uid of needed) {
      await prisma.messageThreadParticipant.upsert({
        where: { threadId_userId: { threadId: thread.id, userId: uid } },
        update: {},
        create: { threadId: thread.id, userId: uid, role: uid === proUser?.userId ? 'PRO' : 'CLIENT' },
      })
    }

    return jsonOk({ ok: true, thread })
  } catch (e: any) {
    console.error('POST /api/messages/resolve', e)
    return jsonFail(500, e?.message || 'Internal error')
  }
}
