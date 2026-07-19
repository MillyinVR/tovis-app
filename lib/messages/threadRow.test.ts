// lib/messages/threadRow.test.ts
//
// The row serializer shared by GET /api/v1/messages/threads and
// POST /api/v1/messages/resolve. The route tests cover each caller's wiring;
// this covers what the serializer itself owes the wire — Dates rendered as
// ISO-8601 strings, and a missing thread loading as null rather than throwing.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageThreadContextType, ProNameDisplay } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prisma: {
    messageThread: { findUnique: vi.fn() },
    booking: { findMany: vi.fn() },
    service: { findMany: vi.fn() },
    professionalServiceOffering: { findMany: vi.fn() },
    waitlistEntry: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import {
  inboxThreadRowSelect,
  loadInboxThreadRow,
  serializeInboxThreadRow,
  type InboxThreadRow,
} from './threadRow'

function makeRow(overrides: Partial<InboxThreadRow> = {}): InboxThreadRow {
  return {
    id: 'thread_1',
    contextType: MessageThreadContextType.PRO_PROFILE,
    contextId: 'pro_1',
    bookingId: null,
    serviceId: null,
    offeringId: null,
    waitlistEntryId: null,
    lastMessageAt: new Date('2026-07-08T12:00:00.000Z'),
    lastMessagePreview: 'See you then',
    updatedAt: new Date('2026-07-08T12:00:30.000Z'),
    client: { id: 'client_1', firstName: 'Test', lastName: 'Client', avatarUrl: null },
    professional: {
      id: 'pro_1',
      userId: 'pro_user_1',
      businessName: 'Studio',
      firstName: 'Grace',
      lastName: 'Hopper',
      handle: 'studio',
      nameDisplay: ProNameDisplay.BUSINESS_NAME,
      avatarUrl: null,
    },
    participants: [{ lastReadAt: new Date('2026-07-08T12:01:00.000Z') }],
    _count: { messages: 3 },
    ...overrides,
  }
}

const EYEBROW = { eyebrow: 'Pro', isAccentContext: false }

describe('serializeInboxThreadRow', () => {
  it('renders every Date as an ISO-8601 string', () => {
    const dto = serializeInboxThreadRow({
      row: makeRow(),
      viewerUserId: 'pro_user_1',
      eyebrow: EYEBROW,
    })

    expect(dto.lastMessageAt).toBe('2026-07-08T12:00:00.000Z')
    expect(dto.updatedAt).toBe('2026-07-08T12:00:30.000Z')
    expect(dto.participants).toEqual([{ lastReadAt: '2026-07-08T12:01:00.000Z' }])
  })

  it('keeps null timestamps null — a thread nobody has read or written', () => {
    const dto = serializeInboxThreadRow({
      row: makeRow({ lastMessageAt: null, participants: [{ lastReadAt: null }] }),
      viewerUserId: 'pro_user_1',
      eyebrow: EYEBROW,
    })

    expect(dto.lastMessageAt).toBeNull()
    expect(dto.participants).toEqual([{ lastReadAt: null }])
  })

  it('resolves isViewerPro from the viewer user id, not the acting role', () => {
    const row = makeRow()

    expect(
      serializeInboxThreadRow({ row, viewerUserId: 'pro_user_1', eyebrow: EYEBROW })
        .isViewerPro,
    ).toBe(true)
    expect(
      serializeInboxThreadRow({ row, viewerUserId: 'client_user_1', eyebrow: EYEBROW })
        .isViewerPro,
    ).toBe(false)
  })

  // No "professional has no user account" case: ProfessionalProfile.userId is
  // non-nullable in the schema, so it cannot be constructed — the list route's
  // old `!= null` guard was unreachable and typecheck rejects a null here.
})

describe('inboxThreadRowSelect', () => {
  it('scopes the participant read state to the viewer', () => {
    const select = inboxThreadRowSelect('viewer_1')

    expect(select.participants.where).toEqual({ userId: 'viewer_1' })
    expect(select.participants.take).toBe(1)
  })
})

describe('loadInboxThreadRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.booking.findMany.mockResolvedValue([])
    mocks.prisma.service.findMany.mockResolvedValue([])
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([])
    mocks.prisma.waitlistEntry.findMany.mockResolvedValue([])
  })

  it('returns null for a thread that does not exist', async () => {
    mocks.prisma.messageThread.findUnique.mockResolvedValue(null)

    await expect(
      loadInboxThreadRow({ threadId: 'nope', viewerUserId: 'viewer_1' }),
    ).resolves.toBeNull()
  })

  it('serializes the row with its resolved eyebrow', async () => {
    mocks.prisma.messageThread.findUnique.mockResolvedValue(makeRow())

    const dto = await loadInboxThreadRow({
      threadId: 'thread_1',
      viewerUserId: 'pro_user_1',
    })

    expect(dto).toMatchObject({
      id: 'thread_1',
      // Resolved by the real inboxContext, not passed in — a PRO_PROFILE
      // thread's eyebrow is the literal "Pro", and it is not an accent context.
      eyebrow: 'Pro',
      isAccentContext: false,
      isViewerPro: true,
    })
  })
})
