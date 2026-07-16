import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  emitAdminSupportTicketCreated: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { supportTicket: { create: mocks.create } },
}))

vi.mock('@/lib/notifications/adminNotifications', () => ({
  emitAdminSupportTicketCreated: mocks.emitAdminSupportTicketCreated,
}))

import {
  SUPPORT_MESSAGE_MAX_LEN,
  SUPPORT_SUBJECT_MAX_LEN,
  createSupportTicket,
} from './createSupportTicket'

const TICKET = {
  id: 'tkt_1',
  subject: 'Booking not confirming',
  status: 'OPEN',
  createdAt: new Date('2026-07-16T00:00:00.000Z'),
}

describe('createSupportTicket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    mocks.create.mockResolvedValue(TICKET)
    mocks.emitAdminSupportTicketCreated.mockResolvedValue(undefined)
  })

  it('attributes the ticket to a signed-in author and their acting role', async () => {
    const result = await createSupportTicket({
      author: { id: 'user_7', role: 'PRO' },
      subject: 'Booking not confirming',
      message: 'It spins forever.',
    })

    expect(result).toEqual({ ok: true, ticket: TICKET })
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdByUserId: 'user_7',
          createdByRole: 'PRO',
          subject: 'Booking not confirming',
          message: 'It spins forever.',
          status: 'OPEN',
        }),
      }),
    )
  })

  it('files an anonymous web visitor as a GUEST with no user', async () => {
    await createSupportTicket({
      author: null,
      subject: 'Help',
      message: 'Cannot sign in.',
    })

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdByUserId: null,
          createdByRole: 'GUEST',
        }),
      }),
    )
  })

  it('trims the stored text', async () => {
    await createSupportTicket({
      author: null,
      subject: '  Padded  ',
      message: '  Body  ',
    })

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subject: 'Padded', message: 'Body' }),
      }),
    )
  })

  it('alerts admins with the new ticket', async () => {
    await createSupportTicket({
      author: null,
      subject: 'Booking not confirming',
      message: 'It spins forever.',
    })

    expect(mocks.emitAdminSupportTicketCreated).toHaveBeenCalledWith({
      ticketId: 'tkt_1',
      subject: 'Booking not confirming',
    })
  })

  it('still succeeds when the admin alert fails', async () => {
    // The ticket is already durable — a dropped notification must never fail a
    // submission the user was told went through.
    mocks.emitAdminSupportTicketCreated.mockRejectedValue(new Error('notify down'))

    const result = await createSupportTicket({
      author: null,
      subject: 'Help',
      message: 'Cannot sign in.',
    })

    expect(result.ok).toBe(true)
  })

  describe('validation (no ticket is written)', () => {
    it.each([
      ['a blank subject', { subject: '   ', message: 'Body' }],
      ['a blank message', { subject: 'Subject', message: '   ' }],
    ])('rejects %s', async (_label, fields) => {
      const result = await createSupportTicket({ author: null, ...fields })

      expect(result).toEqual({
        ok: false,
        error: { code: 'MISSING_FIELDS', message: 'Subject and message are required.' },
      })
      expect(mocks.create).not.toHaveBeenCalled()
    })

    it('rejects an over-long subject', async () => {
      const result = await createSupportTicket({
        author: null,
        subject: 'x'.repeat(SUPPORT_SUBJECT_MAX_LEN + 1),
        message: 'Body',
      })

      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error.code).toBe('SUBJECT_TOO_LONG')
      expect(mocks.create).not.toHaveBeenCalled()
    })

    it('rejects an over-long message', async () => {
      const result = await createSupportTicket({
        author: null,
        subject: 'Subject',
        message: 'x'.repeat(SUPPORT_MESSAGE_MAX_LEN + 1),
      })

      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error.code).toBe('MESSAGE_TOO_LONG')
      expect(mocks.create).not.toHaveBeenCalled()
    })

    it('accepts text exactly at the limit', async () => {
      const result = await createSupportTicket({
        author: null,
        subject: 'x'.repeat(SUPPORT_SUBJECT_MAX_LEN),
        message: 'x'.repeat(SUPPORT_MESSAGE_MAX_LEN),
      })

      expect(result.ok).toBe(true)
    })
  })
})
