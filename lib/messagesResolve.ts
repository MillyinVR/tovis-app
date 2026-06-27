// lib/messagesResolve.ts
//
// Single thread-resolution path for messaging. The HTTP route
// (app/api/v1/messages/resolve) and server pages (app/messages/start) both go
// through resolveMessageThread, so context auth checks and thread creation
// never fork into separate implementations.

import { MessageThreadContextType, Role } from '@prisma/client'

import { prisma } from './prisma'

type JsonRecord = Record<string, unknown>

export type ResolveThreadViewer = {
  clientProfile?: { id?: string | null } | null
  professionalProfile?: { id?: string | null } | null
}

export type ResolveThreadInput = {
  contextType: MessageThreadContextType
  contextId: string
  createIfMissing: boolean
  professionalId?: string
  clientId?: string
}

export type ResolveThreadSuccess = {
  ok: true
  thread: { id: string } | null
}

export type ResolveThreadFailure = {
  ok: false
  status: number
  error: string
  details?: JsonRecord
}

export type ResolveThreadOutcome = ResolveThreadSuccess | ResolveThreadFailure

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

type SeedSuccess = {
  ok: true
  seed: ThreadSeed
}

type SeedResult = SeedSuccess | ResolveThreadFailure

type ParticipantSeed = {
  userId: string
  role: Role
}

function presentString(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function getViewerIds(viewer: ResolveThreadViewer): ViewerIds {
  return {
    clientId: viewer.clientProfile?.id ?? null,
    professionalId: viewer.professionalProfile?.id ?? null,
  }
}

function resolveFailure(
  status: number,
  error: string,
  details?: JsonRecord,
): ResolveThreadFailure {
  return { ok: false, status, error, details }
}

function buildParticipants(
  clientUserId: string,
  professionalUserId: string,
): ParticipantSeed[] {
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

async function resolveBookingThreadSeed(
  params: {
    contextType: MessageThreadContextType
    contextId: string
    viewerIds: ViewerIds
  },
): Promise<SeedResult> {
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

async function resolveServiceThreadSeed(
  params: {
    input: ResolveThreadInput
    viewerIds: ViewerIds
  },
): Promise<SeedResult> {
  const { input, viewerIds } = params

  if (!viewerIds.clientId) {
    return resolveFailure(403, 'Clients only.')
  }

  const professionalId = presentString(input.professionalId)

  if (!professionalId) {
    return resolveFailure(400, 'Missing professionalId for SERVICE thread.')
  }

  const service = await prisma.service.findUnique({
    where: { id: input.contextId },
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
      contextType: input.contextType,
      contextId: input.contextId,
      serviceId: service.id,
    }),
  }
}

async function resolveOfferingThreadSeed(
  params: {
    contextType: MessageThreadContextType
    contextId: string
    viewerIds: ViewerIds
  },
): Promise<SeedResult> {
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

async function resolveProProfileThreadSeed(
  params: {
    input: ResolveThreadInput
    viewerIds: ViewerIds
  },
): Promise<SeedResult> {
  const { input, viewerIds } = params
  const { contextType, contextId } = input

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

  const clientId = presentString(input.clientId)

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

async function resolveWaitlistThreadSeed(
  params: {
    contextType: MessageThreadContextType
    contextId: string
    viewerIds: ViewerIds
  },
): Promise<SeedResult> {
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

async function resolveThreadSeed(
  params: {
    input: ResolveThreadInput
    viewerIds: ViewerIds
  },
): Promise<SeedResult> {
  const { input, viewerIds } = params
  const { contextType, contextId } = input

  if (contextType === MessageThreadContextType.BOOKING) {
    return resolveBookingThreadSeed({ contextType, contextId, viewerIds })
  }

  if (contextType === MessageThreadContextType.SERVICE) {
    return resolveServiceThreadSeed({ input, viewerIds })
  }

  if (contextType === MessageThreadContextType.OFFERING) {
    return resolveOfferingThreadSeed({ contextType, contextId, viewerIds })
  }

  if (contextType === MessageThreadContextType.PRO_PROFILE) {
    return resolveProProfileThreadSeed({ input, viewerIds })
  }

  if (contextType === MessageThreadContextType.WAITLIST) {
    return resolveWaitlistThreadSeed({ contextType, contextId, viewerIds })
  }

  return resolveFailure(400, 'Unsupported message context.')
}

export async function resolveMessageThread(
  params: {
    viewer: ResolveThreadViewer
    input: ResolveThreadInput
  },
): Promise<ResolveThreadOutcome> {
  const { viewer, input } = params

  const seedResult = await resolveThreadSeed({
    input,
    viewerIds: getViewerIds(viewer),
  })

  if (!seedResult.ok) {
    return seedResult
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
    return resolveFailure(404, 'Client profile missing.')
  }

  const clientUserId = clientProfile.userId

  if (!clientUserId) {
    return resolveFailure(409, 'Client account has not been claimed yet.', {
      code: 'CLIENT_UNCLAIMED',
    })
  }

  if (!professionalProfile) {
    return resolveFailure(404, 'Professional profile missing.')
  }

  const professionalUserId = professionalProfile.userId

  if (!professionalUserId) {
    return resolveFailure(404, 'Professional profile missing.')
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

  if (!existingThread && !input.createIfMissing) {
    return { ok: true, thread: null }
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

  return { ok: true, thread: { id: thread.id } }
}
