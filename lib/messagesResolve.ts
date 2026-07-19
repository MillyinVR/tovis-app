// lib/messagesResolve.ts
//
// Single thread-resolution path for messaging. The HTTP route
// (app/api/v1/messages/resolve) and server pages (app/messages/start) both go
// through resolveMessageThread, so context auth checks and thread creation
// never fork into separate implementations.

import { MessageThreadContextType, Role } from '@prisma/client'

import { prisma } from './prisma'
import { clientCanBeMessaged } from './messages/clientThreadEligibility'

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

  // A single user account can hold BOTH profiles — "Switch to client" is a
  // first-class feature — so the branch cannot be chosen by asking which
  // profiles the viewer HAS. It has to ask which profile OWNS this context.
  // Testing `viewerIds.clientId` first seeded the thread with the viewer's own
  // client profile and left the pro branch below unreachable, so a pro tapping
  // "Message" on a client opened a thread with themselves and the client never
  // saw it.
  const viewerProfessionalId = viewerIds.professionalId
  const viewerOwnsContext =
    viewerProfessionalId !== null && viewerProfessionalId === contextId

  if (!viewerOwnsContext) {
    // Not the viewer's own profile, so they are acting as a client here —
    // including a pro messaging a DIFFERENT pro.
    if (!viewerIds.clientId) {
      return resolveFailure(403, 'Forbidden.')
    }

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

  const clientId = presentString(input.clientId)

  if (!clientId) {
    // Reachable from the pro's own public profile, where the Message CTA
    // renders for any signed-in viewer — so this copy is user-facing.
    return resolveFailure(400, 'Choose a client to message.')
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
      professionalId: viewerProfessionalId,
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

  // Same predicate the pro booking detail uses to decide whether to offer a
  // "Message client" affordance, so the button and this refusal cannot drift.
  // It is a type predicate, so `userId` is a real string from here on.
  if (!clientCanBeMessaged(clientProfile)) {
    return resolveFailure(409, 'Client account has not been claimed yet.', {
      code: 'CLIENT_UNCLAIMED',
    })
  }

  const clientUserId = clientProfile.userId

  if (!professionalProfile) {
    return resolveFailure(404, 'Professional profile missing.')
  }

  const professionalUserId = professionalProfile.userId

  if (!professionalUserId) {
    return resolveFailure(404, 'Professional profile missing.')
  }

  // A thread with two sides on the same user account is never legitimate, and
  // it is the shape every branch-selection bug on this path collapses into.
  // Refuse it here — once — so no context type can produce one, and so the
  // failure is loud instead of a thread with a blank counterparty. This is the
  // single home of that rule; `buildParticipants` used to quietly accommodate
  // the case by emitting one participant, which is what made A5 look like it
  // worked.
  if (clientUserId === professionalUserId) {
    return resolveFailure(409, 'You cannot start a message thread with yourself.', {
      code: 'SELF_THREAD',
    })
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
