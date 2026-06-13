// app/messages/page.test.ts
//
// /messages must hand context params off to /messages/start instead of
// silently rendering the inbox (the Message CTA bug from the beta
// walk-through).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
)

const mockGetCurrentUser = vi.hoisted(() => vi.fn())

const mocks = vi.hoisted(() => ({
  prisma: {
    messageThread: {
      findMany: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
    },
    service: {
      findMany: vi.fn(),
    },
    professionalServiceOffering: {
      findMany: vi.fn(),
    },
    waitlistEntry: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mockGetCurrentUser,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import MessagesInboxPage from './page'

describe('MessagesInboxPage', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockResolvedValue({
      id: 'user_client',
      role: Role.CLIENT,
    })
    mocks.prisma.messageThread.findMany.mockResolvedValue([])
  })

  it('forwards context params to /messages/start', async () => {
    await expect(
      MessagesInboxPage({
        searchParams: {
          contextType: 'BOOKING',
          contextId: 'booking_1',
          professionalId: 'pro_1',
        },
      }),
    ).rejects.toThrow(
      'NEXT_REDIRECT:/messages/start?contextType=BOOKING&contextId=booking_1&professionalId=pro_1',
    )

    expect(mocks.prisma.messageThread.findMany).not.toHaveBeenCalled()
  })

  it('renders the inbox when no context params are present', async () => {
    const result = await MessagesInboxPage({ searchParams: {} })

    expect(result).toBeTruthy()
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mocks.prisma.messageThread.findMany).toHaveBeenCalledTimes(1)
  })
})
