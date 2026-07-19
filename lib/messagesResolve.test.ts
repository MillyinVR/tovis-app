// lib/messagesResolve.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageThreadContextType, Role } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const tx = {
    messageThread: {
      upsert: vi.fn(),
    },
    messageThreadParticipant: {
      upsert: vi.fn(),
    },
  }

  return {
    tx,
    prisma: {
      booking: {
        findUnique: vi.fn(),
      },
      service: {
        findUnique: vi.fn(),
      },
      professionalServiceOffering: {
        findUnique: vi.fn(),
      },
      professionalProfile: {
        findUnique: vi.fn(),
      },
      clientProfile: {
        findUnique: vi.fn(),
      },
      waitlistEntry: {
        findUnique: vi.fn(),
      },
      messageThread: {
        findUnique: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (innerTx: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    },
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import { resolveMessageThread } from './messagesResolve'

const clientViewer = {
  clientProfile: { id: 'client_1' },
  professionalProfile: null,
}

const bookingRow = {
  id: 'booking_1',
  clientId: 'client_1',
  professionalId: 'pro_1',
  serviceId: 'svc_1',
  offeringId: null,
}

describe('resolveMessageThread', () => {
  beforeEach(() => {
    mocks.prisma.$transaction.mockImplementation(
      async (fn: (innerTx: typeof mocks.tx) => Promise<unknown>) => fn(mocks.tx),
    )
  })

  it('creates a BOOKING thread with both participants for the booking client', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(bookingRow)
    mocks.prisma.clientProfile.findUnique.mockResolvedValue({
      id: 'client_1',
      userId: 'user_client',
    })
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue({
      id: 'pro_1',
      userId: 'user_pro',
    })
    mocks.prisma.messageThread.findUnique.mockResolvedValue(null)
    mocks.tx.messageThread.upsert.mockResolvedValue({ id: 'thread_1' })

    const outcome = await resolveMessageThread({
      viewer: clientViewer,
      input: {
        contextType: MessageThreadContextType.BOOKING,
        contextId: 'booking_1',
        createIfMissing: true,
      },
    })

    expect(outcome).toEqual({ ok: true, thread: { id: 'thread_1' } })

    expect(mocks.tx.messageThread.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.tx.messageThread.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          clientId: 'client_1',
          professionalId: 'pro_1',
          contextType: MessageThreadContextType.BOOKING,
          contextId: 'booking_1',
          bookingId: 'booking_1',
          serviceId: 'svc_1',
        }),
      }),
    )

    expect(mocks.tx.messageThreadParticipant.upsert).toHaveBeenCalledTimes(2)
    expect(mocks.tx.messageThreadParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: 'user_client',
          role: Role.CLIENT,
        }),
      }),
    )
    expect(mocks.tx.messageThreadParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: 'user_pro',
          role: Role.PRO,
        }),
      }),
    )
  })

  it('returns 403 when the viewer is not a booking participant', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(bookingRow)

    const outcome = await resolveMessageThread({
      viewer: {
        clientProfile: { id: 'client_other' },
        professionalProfile: null,
      },
      input: {
        contextType: MessageThreadContextType.BOOKING,
        contextId: 'booking_1',
        createIfMissing: true,
      },
    })

    expect(outcome).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden.',
      details: undefined,
    })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 404 when the booking does not exist', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(null)

    const outcome = await resolveMessageThread({
      viewer: clientViewer,
      input: {
        contextType: MessageThreadContextType.BOOKING,
        contextId: 'booking_missing',
        createIfMissing: true,
      },
    })

    expect(outcome).toEqual({
      ok: false,
      status: 404,
      error: 'Booking not found.',
      details: undefined,
    })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('does not create a thread when createIfMissing is false and none exists', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(bookingRow)
    mocks.prisma.clientProfile.findUnique.mockResolvedValue({
      id: 'client_1',
      userId: 'user_client',
    })
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue({
      id: 'pro_1',
      userId: 'user_pro',
    })
    mocks.prisma.messageThread.findUnique.mockResolvedValue(null)

    const outcome = await resolveMessageThread({
      viewer: clientViewer,
      input: {
        contextType: MessageThreadContextType.BOOKING,
        contextId: 'booking_1',
        createIfMissing: false,
      },
    })

    expect(outcome).toEqual({ ok: true, thread: null })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 409 CLIENT_UNCLAIMED when the client profile has no user', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(bookingRow)
    mocks.prisma.clientProfile.findUnique.mockResolvedValue({
      id: 'client_1',
      userId: null,
    })
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue({
      id: 'pro_1',
      userId: 'user_pro',
    })

    const outcome = await resolveMessageThread({
      viewer: {
        clientProfile: null,
        professionalProfile: { id: 'pro_1' },
      },
      input: {
        contextType: MessageThreadContextType.BOOKING,
        contextId: 'booking_1',
        createIfMissing: true,
      },
    })

    expect(outcome).toEqual({
      ok: false,
      status: 409,
      error: 'Client account has not been claimed yet.',
      details: { code: 'CLIENT_UNCLAIMED' },
    })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('resolves a PRO_PROFILE thread for a client viewer', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue({
      id: 'pro_1',
      userId: 'user_pro',
    })
    mocks.prisma.clientProfile.findUnique.mockResolvedValue({
      id: 'client_1',
      userId: 'user_client',
    })
    mocks.prisma.messageThread.findUnique.mockResolvedValue(null)
    mocks.tx.messageThread.upsert.mockResolvedValue({ id: 'thread_2' })

    const outcome = await resolveMessageThread({
      viewer: clientViewer,
      input: {
        contextType: MessageThreadContextType.PRO_PROFILE,
        contextId: 'pro_1',
        createIfMissing: true,
      },
    })

    expect(outcome).toEqual({ ok: true, thread: { id: 'thread_2' } })
    expect(mocks.tx.messageThread.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          clientId: 'client_1',
          professionalId: 'pro_1',
          contextType: MessageThreadContextType.PRO_PROFILE,
          contextId: 'pro_1',
        }),
      }),
    )
  })
})

// A user account can hold BOTH a ClientProfile and a ProfessionalProfile —
// "Switch to client" is a first-class feature — so PRO_PROFILE resolution has
// to pick its branch on *which* profile owns the context, not on which
// profiles the viewer happens to have. These profiles share `user_pro` across
// the pro profile and its owner's own client profile, which is the shape that
// made a pro messaging a client land in a thread with themselves.
const DUAL_CLIENT_PROFILES: Record<string, { id: string; userId: string | null }> = {
  // The pro's OWN client profile — same user account as pro_1.
  client_pro_own: { id: 'client_pro_own', userId: 'user_pro' },
  // A real, separate client the pro is trying to message.
  client_x: { id: 'client_x', userId: 'user_client_x' },
}

const DUAL_PRO_PROFILES: Record<string, { id: string; userId: string | null }> = {
  pro_1: { id: 'pro_1', userId: 'user_pro' },
  pro_other: { id: 'pro_other', userId: 'user_pro_other' },
}

describe('resolveMessageThread — PRO_PROFILE branch selection', () => {
  beforeEach(() => {
    mocks.prisma.$transaction.mockImplementation(
      async (fn: (innerTx: typeof mocks.tx) => Promise<unknown>) => fn(mocks.tx),
    )
    // Look the profile up by the id actually requested, so a test cannot pass
    // by resolving the wrong profile.
    mocks.prisma.clientProfile.findUnique.mockImplementation(
      async (args: { where: { id: string } }) =>
        DUAL_CLIENT_PROFILES[args.where.id] ?? null,
    )
    mocks.prisma.professionalProfile.findUnique.mockImplementation(
      async (args: { where: { id: string } }) =>
        DUAL_PRO_PROFILES[args.where.id] ?? null,
    )
    mocks.prisma.messageThread.findUnique.mockResolvedValue(null)
    mocks.tx.messageThread.upsert.mockResolvedValue({ id: 'thread_pro' })
  })

  const proWithClientProfile = {
    clientProfile: { id: 'client_pro_own' },
    professionalProfile: { id: 'pro_1' },
  }

  it('seeds the thread with the TARGET client when a pro who also has a client profile messages a client', async () => {
    const outcome = await resolveMessageThread({
      viewer: proWithClientProfile,
      input: {
        contextType: MessageThreadContextType.PRO_PROFILE,
        contextId: 'pro_1',
        clientId: 'client_x',
        createIfMissing: true,
      },
    })

    expect(outcome).toEqual({ ok: true, thread: { id: 'thread_pro' } })

    // The bug seeded `client_pro_own` here — the viewer's own client profile.
    expect(mocks.tx.messageThread.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          clientId: 'client_x',
          professionalId: 'pro_1',
          contextType: MessageThreadContextType.PRO_PROFILE,
          contextId: 'pro_1',
        }),
      }),
    )

    // Two distinct participants: a self-thread collapses to one.
    expect(mocks.tx.messageThreadParticipant.upsert).toHaveBeenCalledTimes(2)
    expect(mocks.tx.messageThreadParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: 'user_client_x',
          role: Role.CLIENT,
        }),
      }),
    )
    expect(mocks.tx.messageThreadParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: 'user_pro', role: Role.PRO }),
      }),
    )
  })

  it('still takes the CLIENT branch when that same pro messages a DIFFERENT pro', async () => {
    // The genuine case a naive "always take the pro branch" fix would break:
    // a pro acting as a client toward someone else's profile.
    const outcome = await resolveMessageThread({
      viewer: proWithClientProfile,
      input: {
        contextType: MessageThreadContextType.PRO_PROFILE,
        contextId: 'pro_other',
        createIfMissing: true,
      },
    })

    expect(outcome).toEqual({ ok: true, thread: { id: 'thread_pro' } })
    expect(mocks.tx.messageThread.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          clientId: 'client_pro_own',
          professionalId: 'pro_other',
          contextId: 'pro_other',
        }),
      }),
    )
  })

  it('refuses to open a thread whose two sides are the same user account', async () => {
    const outcome = await resolveMessageThread({
      viewer: proWithClientProfile,
      input: {
        contextType: MessageThreadContextType.PRO_PROFILE,
        contextId: 'pro_1',
        clientId: 'client_pro_own',
        createIfMissing: true,
      },
    })

    expect(outcome).toEqual({
      ok: false,
      status: 409,
      error: 'You cannot start a message thread with yourself.',
      details: { code: 'SELF_THREAD' },
    })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('refuses with 400 when a pro opens their own PRO_PROFILE context without naming a client', async () => {
    const outcome = await resolveMessageThread({
      viewer: proWithClientProfile,
      input: {
        contextType: MessageThreadContextType.PRO_PROFILE,
        contextId: 'pro_1',
        createIfMissing: true,
      },
    })

    expect(outcome).toEqual({
      ok: false,
      status: 400,
      error: 'Choose a client to message.',
      details: undefined,
    })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('keeps refusing a pro with no client profile who opens another pro profile', async () => {
    const outcome = await resolveMessageThread({
      viewer: { clientProfile: null, professionalProfile: { id: 'pro_1' } },
      input: {
        contextType: MessageThreadContextType.PRO_PROFILE,
        contextId: 'pro_other',
        createIfMissing: true,
      },
    })

    expect(outcome).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden.',
      details: undefined,
    })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
})
