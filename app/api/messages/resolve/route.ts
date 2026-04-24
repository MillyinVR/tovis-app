// app/api/messages/resolve/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk, pickString, upper } from '@/app/api/_utils'
import { MessageThreadContextType, Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

type JsonRecord = Record<string, unknown>

type ViewerUser = {
  clientProfile?: { id?: string | null } | null
  professionalProfile?: { id?: string | null } | null
}

type ViewerIds = {
  clientId: string | null
  professionalId: string | null
}

type ThreadSeed = {
  clientId: string
  professionalId: string
  contextType: MessageThreadContextType
  contextId: string
  bookingId: string | null
  serviceId: string | null
  offeringId: string | null
  waitlistEntryId: string | null
}

type ResolveSuccess = {
  ok: true
  seed: ThreadSeed
}

type ResolveFailure = {
  ok: false
  status: number
  error: string
  details?: JsonRecord
}

type ResolveResult = ResolveSuccess | ResolveFailure

type ParticipantSeed = {
  userId: string
  role: Role
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJsonObject(req: Request): Promise<JsonRecord> {
  const raw: unknown = await req.json().catch(() => ({}))
  return isRecord(raw) ? raw : {}
}

function asContextType(value: unknown): MessageThreadContextType | null {
  const normalized = upper(value)

  if (normalized === MessageThreadContextType.BOOKING) {
    return MessageThreadContextType.BOOKING
  }

  if (normalized === MessageThreadContextType.SERVICE) {
    return MessageThreadContextType.SERVICE
  }

  if (normalized === MessageThreadContextType.OFFERING) {
    return MessageThreadContextType.OFFERING
  }

  if (normalized === MessageThreadContextType.PRO_PROFILE) {
    return MessageThreadContextType.PRO_PROFILE
  }

  if (normalized === MessageThreadContextType.WAITLIST) {
    return MessageThreadContextType.WAITLIST
  }

  return null
}

function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()

    return (
      normalized === '1' ||
      normalized === 'true' ||
      normalized === 'yes' ||
      normalized === 'on'
    )
  }

  if (typeof value === 'number') return value === 1

  return false
}

function getViewerIds(user: ViewerUser): ViewerIds {
  return {
    clientId: user.clientProfile?.id ?? null,
    professionalId: user.professionalProfile?.id ?? null,
  }
}

function resolveFailure(
  status: number,
  error: string,
  details?: JsonRecord,
): ResolveFailure {
  return { ok: false, status, error, details }
}

function sendResolveFailure(result: ResolveFailure) {
  if (result.details) {
    return jsonFail(result.status, result.error, result.details)
  }

  return jsonFail(result.status, result.error)
}

function buildParticipants(clientUserId: string, professionalUserId: string): ParticipantSeed[] {
  if (clientUserId === professionalUserId) {
    return [{ userId: clientUserId, role: Role.CLIENT }]
  }

  return [
    { userId: clientUserId, role: Role.CLIENT },
    { userId: professionalUserId, role: Role.PRO },
  ]
}

function makeSeed(params: {
  clientId: string
  professionalId: string
  contextType: MessageThreadContextType
  contextId: string
  bookingId?: string | null
  serviceId?: string | null
  offeringId?: string | null
  waitlistEntryId?: string | null
}): ThreadSeed {
  return {
    clientId: params.clientId,
    professionalId: params.professionalId,
    contextType: params.contextType,
    contextId: params.contextId,
    bookingId: params.bookingId ?? null,
    serviceId: params.serviceId ?? null,
    offeringId: params.offeringId ?? null,
    waitlistEntryId: params.waitlistEntryId ?? null,
  }
}

async function resolveBookingThreadSeed(params: {
  contextType: MessageThreadContextType
  contextId: string
  viewerIds: ViewerIds
}): Promise<ResolveResult> {
  const { contextType, contextId, viewerIds } = params

  const booking = await prisma.booking.findUnique({
    where: { id: contextId },
    select: {
      id: true,
      clientId: true,
      professionalId: true,
      serviceId: true,
      offeringId: true,
    },
  })

  if (!booking) {
    return resolveFailure(404, 'Booking not found.')
  }

  const allowed =
    viewerIds.clientId === booking.clientId ||
    viewerIds.professionalId === booking.professionalId

  if (!allowed) {
    return resolveFailure(403, 'Forbidden.')
  }

  return {
    ok: true,
    seed: makeSeed({
      clientId: booking.clientId,
      professionalId: booking.professionalId,
      contextType,
      contextId,
      bookingId: booking.id,
      serviceId: booking.serviceId,
      offeringId: booking.offeringId,
    }),
  }
}

async function resolveServiceThreadSeed(params: {
  body: JsonRecord
  contextType: MessageThreadContextType
  contextId: string
  viewerIds: ViewerIds
}): Promise<ResolveResult> {
  const { body, contextType, contextId, viewerIds } = params

  if (!viewerIds.clientId) {
    return resolveFailure(403, 'Clients only.')
  }

  const professionalId = pickString(body.professionalId)

  if (!professionalId) {
    return resolveFailure(400, 'Missing professionalId for SERVICE thread.')
  }

  const service = await prisma.service.findUnique({
    where: { id: contextId },
    select: { id: true },
  })

  if (!service) {
    return resolveFailure(404, 'Service not found.')
  }

  const professional = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: { id: true },
  })

  if (!professional) {
    return resolveFailure(404, 'Professional profile missing.')
  }

  return {
    ok: true,
    seed: makeSeed({
      clientId: viewerIds.clientId,
      professionalId: professional.id,
      contextType,
      contextId,
      serviceId: service.id,
    }),
  }
}

async function resolveOfferingThreadSeed(params: {
  contextType: MessageThreadContextType
  contextId: string
  viewerIds: ViewerIds
}): Promise<ResolveResult> {
  const { contextType, contextId, viewerIds } = params

  if (!viewerIds.clientId) {
    return resolveFailure(403, 'Clients only.')
  }

  const offering = await prisma.professionalServiceOffering.findUnique({
    where: { id: contextId },
    select: {
      id: true,
      professionalId: true,
      serviceId: true,
    },
  })

  if (!offering) {
    return resolveFailure(404, 'Offering not found.')
  }

  return {
    ok: true,
    seed: makeSeed({
      clientId: viewerIds.clientId,
      professionalId: offering.professionalId,
      contextType,
      contextId,
      serviceId: offering.serviceId,
      offeringId: offering.id,
    }),
  }
}

async function resolveProProfileThreadSeed(params: {
  body: JsonRecord
  contextType: MessageThreadContextType
  contextId: string
  viewerIds: ViewerIds
}): Promise<ResolveResult> {
  const { body, contextType, contextId, viewerIds } = params

  if (!viewerIds.clientId && !viewerIds.professionalId) {
    return resolveFailure(403, 'Unauthorized.')
  }

  if (viewerIds.clientId) {
    const professional = await prisma.professionalProfile.findUnique({
      where: { id: contextId },
      select: { id: true },
    })

    if (!professional) {
      return resolveFailure(404, 'Professional profile missing.')
    }

    return {
      ok: true,
      seed: makeSeed({
        clientId: viewerIds.clientId,
        professionalId: professional.id,
        contextType,
        contextId,
      }),
    }
  }

  if (viewerIds.professionalId !== contextId) {
    return resolveFailure(403, 'Forbidden.')
  }

  const clientId = pickString(body.clientId)

  if (!clientId) {
    return resolveFailure(
      400,
      'Missing clientId for PRO_PROFILE when opened by pro.',
    )
  }

  const client = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: { id: true },
  })

  if (!client) {
    return resolveFailure(404, 'Client profile missing.')
  }

  return {
    ok: true,
    seed: makeSeed({
      clientId: client.id,
      professionalId: viewerIds.professionalId,
      contextType,
      contextId,
    }),
  }
}

async function resolveWaitlistThreadSeed(params: {
  contextType: MessageThreadContextType
  contextId: string
  viewerIds: ViewerIds
}): Promise<ResolveResult> {
  const { contextType, contextId, viewerIds } = params

  const waitlistEntry = await prisma.waitlistEntry.findUnique({
    where: { id: contextId },
    select: {
      id: true,
      clientId: true,
      professionalId: true,
      serviceId: true,
    },
  })

  if (!waitlistEntry) {
    return resolveFailure(404, 'Waitlist entry not found.')
  }

  const allowed =
    viewerIds.clientId === waitlistEntry.clientId ||
    viewerIds.professionalId === waitlistEntry.professionalId

  if (!allowed) {
    return resolveFailure(403, 'Forbidden.')
  }

  return {
    ok: true,
    seed: makeSeed({
      clientId: waitlistEntry.clientId,
      professionalId: waitlistEntry.professionalId,
      contextType,
      contextId,
      serviceId: waitlistEntry.serviceId,
      waitlistEntryId: waitlistEntry.id,
    }),
  }
}

async function resolveThreadSeed(params: {
  body: JsonRecord
  contextType: MessageThreadContextType
  contextId: string
  viewerIds: ViewerIds
}): Promise<ResolveResult> {
  const { body, contextType, contextId, viewerIds } = params

  if (contextType === MessageThreadContextType.BOOKING) {
    return resolveBookingThreadSeed({ contextType, contextId, viewerIds })
  }

  if (contextType === MessageThreadContextType.SERVICE) {
    return resolveServiceThreadSeed({ body, contextType, contextId, viewerIds })
  }

  if (contextType === MessageThreadContextType.OFFERING) {
    return resolveOfferingThreadSeed({ contextType, contextId, viewerIds })
  }

  if (contextType === MessageThreadContextType.PRO_PROFILE) {
    return resolveProProfileThreadSeed({ body, contextType, contextId, viewerIds })
  }

  if (contextType === MessageThreadContextType.WAITLIST) {
    return resolveWaitlistThreadSeed({ contextType, contextId, viewerIds })
  }

  return resolveFailure(400, 'Unsupported message context.')
}

export async function POST(req: Request) {
  const debugId = Math.random().toString(36).slice(2, 9)

  try {
    const user = await getCurrentUser().catch(() => null)

    if (!user) {
      return jsonFail(401, 'Unauthorized.')
    }

    const body = await readJsonObject(req)

    const contextType = asContextType(body.contextType)
    const contextId = pickString(body.contextId)
    const createIfMissing = asBool(body.createIfMissing)

    if (!contextType || !contextId) {
      console.warn('[messages/resolve] missing context', {
        debugId,
        contextType,
        contextId,
      })

      return jsonFail(400, 'Missing contextType/contextId.')
    }

    const seedResult = await resolveThreadSeed({
      body,
      contextType,
      contextId,
      viewerIds: getViewerIds(user),
    })

    if (!seedResult.ok) {
      console.warn('[messages/resolve] blocked', {
        debugId,
        status: seedResult.status,
        error: seedResult.error,
      })

      return sendResolveFailure(seedResult)
    }

    const seed = seedResult.seed

    const [clientProfile, professionalProfile] = await Promise.all([
      prisma.clientProfile.findUnique({
        where: { id: seed.clientId },
        select: { id: true, userId: true },
      }),
      prisma.professionalProfile.findUnique({
        where: { id: seed.professionalId },
        select: { id: true, userId: true },
      }),
    ])

    if (!clientProfile) {
      return jsonFail(404, 'Client profile missing.')
    }

    const clientUserId = clientProfile.userId

    if (!clientUserId) {
      return jsonFail(409, 'Client account has not been claimed yet.', {
        code: 'CLIENT_UNCLAIMED',
      })
    }

    if (!professionalProfile) {
      return jsonFail(404, 'Professional profile missing.')
    }

    const professionalUserId = professionalProfile.userId

    if (!professionalUserId) {
      return jsonFail(404, 'Professional profile missing.')
    }

    const existingThread = await prisma.messageThread.findUnique({
      where: {
        clientId_professionalId_contextType_contextId: {
          clientId: seed.clientId,
          professionalId: seed.professionalId,
          contextType: seed.contextType,
          contextId: seed.contextId,
        },
      },
      select: { id: true },
    })

    if (!existingThread && !createIfMissing) {
      console.info('[messages/resolve] no existing thread; not creating', {
        debugId,
        contextType: seed.contextType,
        contextId: seed.contextId,
      })

      return jsonOk({ thread: null })
    }

    const thread = await prisma.$transaction(async (tx) => {
      const resolvedThread = await tx.messageThread.upsert({
        where: {
          clientId_professionalId_contextType_contextId: {
            clientId: seed.clientId,
            professionalId: seed.professionalId,
            contextType: seed.contextType,
            contextId: seed.contextId,
          },
        },
        update: {},
        create: {
          clientId: seed.clientId,
          professionalId: seed.professionalId,
          contextType: seed.contextType,
          contextId: seed.contextId,
          bookingId: seed.bookingId,
          serviceId: seed.serviceId,
          offeringId: seed.offeringId,
          waitlistEntryId: seed.waitlistEntryId,
        },
        select: { id: true },
      })

      const participants = buildParticipants(clientUserId, professionalUserId)

      for (const participant of participants) {
        await tx.messageThreadParticipant.upsert({
          where: {
            threadId_userId: {
              threadId: resolvedThread.id,
              userId: participant.userId,
            },
          },
          update: {},
          create: {
            threadId: resolvedThread.id,
            userId: participant.userId,
            role: participant.role,
          },
        })
      }

      return resolvedThread
    })

    return jsonOk({ thread: { id: thread.id } })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal error'

    console.error('POST /api/messages/resolve', {
      debugId,
      err: message,
    })

    return jsonFail(500, message)
  }
}