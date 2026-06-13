// app/messages/start/page.test.ts
//
// Param-driven resolve path: the Message CTA links to
// /messages/start?contextType=...&contextId=..., and this page must land the
// viewer in the resolved thread. Uses the real resolveMessageThread (single
// thread-creation path) against a mocked prisma.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
)

const mockGetCurrentUser = vi.hoisted(() => vi.fn())

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

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mockGetCurrentUser,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import MessagesStartPage from './page'

const clientUser = {
  id: 'user_client',
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

describe('MessagesStartPage', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockResolvedValue(clientUser)
  })

  it('resolves the booking context params and redirects into the thread', async () => {
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

    await expect(
      MessagesStartPage({
        searchParams: {
          contextType: 'BOOKING',
          contextId: 'booking_1',
        },
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/messages/thread/thread_1')

    expect(mocks.tx.messageThread.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.tx.messageThreadParticipant.upsert).toHaveBeenCalledTimes(2)
  })

  it('falls back to the inbox when the viewer is not a booking participant', async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: 'user_other',
      clientProfile: { id: 'client_other' },
      professionalProfile: null,
    })
    mocks.prisma.booking.findUnique.mockResolvedValue(bookingRow)

    await expect(
      MessagesStartPage({
        searchParams: {
          contextType: 'BOOKING',
          contextId: 'booking_1',
        },
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/messages')

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('falls back to the inbox when context params are missing', async () => {
    await expect(MessagesStartPage({ searchParams: {} })).rejects.toThrow(
      'NEXT_REDIRECT:/messages',
    )

    expect(mocks.prisma.booking.findUnique).not.toHaveBeenCalled()
  })

  it('sends signed-out viewers to login', async () => {
    mockGetCurrentUser.mockResolvedValue(null)

    await expect(
      MessagesStartPage({
        searchParams: {
          contextType: 'BOOKING',
          contextId: 'booking_1',
        },
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/login?from=/messages/start')
  })

  it('passes professionalId through for SERVICE contexts', async () => {
    mocks.prisma.service.findUnique.mockResolvedValue({ id: 'svc_1' })
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

    await expect(
      MessagesStartPage({
        searchParams: {
          contextType: 'SERVICE',
          contextId: 'svc_1',
          professionalId: 'pro_1',
        },
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/messages/thread/thread_2')
  })
})
