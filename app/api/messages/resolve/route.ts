// app/api/messages/resolve/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk, pickString, upper } from '@/app/api/_utils'
import { MessageThreadContextType, Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

type JsonRecord = Record<string, unknown>

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asContextType(v: unknown): MessageThreadContextType | null {
  const s = upper(v)
  if (s === MessageThreadContextType.BOOKING) return MessageThreadContextType.BOOKING
  if (s === MessageThreadContextType.SERVICE) return MessageThreadContextType.SERVICE
  if (s === MessageThreadContextType.OFFERING) return MessageThreadContextType.OFFERING
  if (s === MessageThreadContextType.PRO_PROFILE) return MessageThreadContextType.PRO_PROFILE
  return null
}

function asBool(v: unknown) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === '1' || s === 'true' || s === 'yes' || s === 'on'
  }
  if (typeof v === 'number') return v === 1
  return false
}

function viewerIds(user: {
  clientProfile?: { id?: string | null } | null
  professionalProfile?: { id?: string | null } | null
}) {
  const clientId = user.clientProfile?.id ?? null
  const proId = user.professionalProfile?.id ?? null
  return { clientId, proId }
}

export async function POST(req: Request) {
  const debugId = Math.random().toString(36).slice(2, 9)

  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const raw: unknown = await req.json().catch(() => ({}))
    const body: JsonRecord = isRecord(raw) ? raw : {}

    const contextType = asContextType(body.contextType)
    const contextId = pickString(body.contextId)
    const createIfMissing = asBool(body.createIfMissing) // default false

    if (!contextType || !contextId) {
      console.warn('[messages/resolve] missing context', { debugId, contextType, contextId })
      return jsonFail(400, 'Missing contextType/contextId.')
    }

    const { clientId: viewerClientId, proId: viewerProId } = viewerIds(user)

    let clientId: string | null = null
    let professionalId: string | null = null
    let bookingId: string | null = null
    let serviceId: string | null = null
    let offeringId: string | null = null

    if (contextType === MessageThreadContextType.BOOKING) {
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

      const allowed =
        (viewerClientId && viewerClientId === clientId) || (viewerProId && viewerProId === professionalId)
      if (!allowed) return jsonFail(403, 'Forbidden.')
    }

    if (contextType === MessageThreadContextType.SERVICE) {
      serviceId = contextId
      if (!viewerClientId) return jsonFail(403, 'Clients only.')

      const proId = pickString(body.professionalId)
      if (!proId) return jsonFail(400, 'Missing professionalId for SERVICE thread.')

      clientId = viewerClientId
      professionalId = proId
    }

    if (contextType === MessageThreadContextType.OFFERING) {
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

    if (contextType === MessageThreadContextType.PRO_PROFILE) {
      if (!viewerClientId && !viewerProId) return jsonFail(403, 'Unauthorized.')

      professionalId = contextId

      if (viewerClientId) {
        clientId = viewerClientId
      } else {
        // Pro is opening it — do NOT allow spoofing another pro’s profile
        if (viewerProId !== professionalId) return jsonFail(403, 'Forbidden.')

        const cid = pickString(body.clientId)
        if (!cid) return jsonFail(400, 'Missing clientId for PRO_PROFILE when opened by pro.')
        clientId = cid
      }
    }

    if (!clientId || !professionalId) return jsonFail(400, 'Could not resolve thread participants.')

    // Validate both profiles exist (prevents “threads to nowhere”)
    const [clientProfile, proProfile] = await Promise.all([
      prisma.clientProfile.findUnique({ where: { id: clientId }, select: { id: true, userId: true } }),
      prisma.professionalProfile.findUnique({ where: { id: professionalId }, select: { id: true, userId: true } }),
    ])
    if (!clientProfile?.userId) return jsonFail(404, 'Client profile missing.')
    if (!proProfile?.userId) return jsonFail(404, 'Professional profile missing.')

    // Find existing thread first (do NOT create by default)
    const existing = await prisma.messageThread.findUnique({
      where: {
        clientId_professionalId_contextType_contextId: {
          clientId,
          professionalId,
          contextType,
          contextId,
        },
      },
      select: { id: true },
    })

    if (existing?.id) {
      // Ensure both participants exist (idempotent)
      await prisma.$transaction([
        prisma.messageThreadParticipant.upsert({
          where: { threadId_userId: { threadId: existing.id, userId: clientProfile.userId } },
          update: {},
          create: { threadId: existing.id, userId: clientProfile.userId, role: Role.CLIENT },
        }),
        prisma.messageThreadParticipant.upsert({
          where: { threadId_userId: { threadId: existing.id, userId: proProfile.userId } },
          update: {},
          create: { threadId: existing.id, userId: proProfile.userId, role: Role.PRO },
        }),
      ])

      return jsonOk({ thread: { id: existing.id } })
    }

    if (!createIfMissing) {
      console.info('[messages/resolve] no existing thread; not creating', { debugId, contextType, contextId })
      return jsonOk({ thread: null })
    }

    const created = await prisma.$transaction(async (tx) => {
      const t = await tx.messageThread.create({
        data: {
          clientId,
          professionalId,
          contextType,
          contextId,
          bookingId,
          serviceId,
          offeringId,
        },
        select: { id: true },
      })

      await tx.messageThreadParticipant.createMany({
        data: [
          { threadId: t.id, userId: clientProfile.userId, role: Role.CLIENT },
          { threadId: t.id, userId: proProfile.userId, role: Role.PRO },
        ],
        skipDuplicates: true,
      })

      return t
    })

    return jsonOk({ thread: { id: created.id } })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error'
    console.error('POST /api/messages/resolve', { debugId, err: msg })
    return jsonFail(500, msg)
  }
}