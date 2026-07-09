import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NotificationChannel,
  NotificationEventKey,
  NotificationRecipientKind,
  Prisma,
} from '@prisma/client'

const mockEnqueueDispatch = vi.hoisted(() => vi.fn())

vi.mock('./dispatch/enqueueDispatch', () => ({
  enqueueDispatch: mockEnqueueDispatch,
}))

// adminNotifications only touches prisma directly when no tx is supplied; every
// test passes a tx, so this mock just prevents a real client from loading.
vi.mock('@/lib/prisma', () => ({
  prisma: {},
}))

import {
  emitAdminSupportTicketCreated,
  emitAdminVerificationReviewNeeded,
  emitAdminViralRequestPending,
} from './adminNotifications'
import {
  ADMIN_NOTIFICATION_EVENT_KEYS,
  getDefaultChannelsForRecipient,
  isRecipientSupportedForEvent,
} from './eventKeys'

type AdminRow = { id: string }
type AdminUserRow = {
  id: string
  email: string | null
  emailVerifiedAt: Date | null
}

const findMany = vi.fn<() => Promise<AdminRow[]>>()
const findUnique = vi.fn<() => Promise<AdminUserRow | null>>()
const updateMany = vi.fn<() => Promise<{ count: number }>>()
const create =
  vi.fn<
    (args: { data: { dedupeKey?: string | null } }) => Promise<{ id: string }>
  >()
const findFirst = vi.fn<() => Promise<{ id: string } | null>>()

function makeTx() {
  return {
    user: { findMany, findUnique },
    adminNotification: { updateMany, create, findFirst },
  } as unknown as Prisma.TransactionClient
}

beforeEach(() => {
  mockEnqueueDispatch.mockReset()
  mockEnqueueDispatch.mockResolvedValue({ created: true })
  findMany.mockReset()
  findUnique.mockReset()
  updateMany.mockReset()
  create.mockReset()
  findFirst.mockReset()

  // Two admins by default; no pre-existing inbox row; create returns a fresh id.
  findMany.mockResolvedValue([{ id: 'admin_1' }, { id: 'admin_2' }])
  findUnique.mockImplementation(() =>
    Promise.resolve({
      id: 'admin_1',
      email: 'admin@example.com',
      emailVerifiedAt: null,
    }),
  )
  updateMany.mockResolvedValue({ count: 0 })
  create.mockResolvedValue({ id: 'an_1' })
  findFirst.mockResolvedValue({ id: 'an_1' })
})

describe('admin event channel policy', () => {
  it('every admin event is in-app + email + push (never SMS), ADMIN-only recipient', () => {
    for (const key of ADMIN_NOTIFICATION_EVENT_KEYS) {
      const channels = getDefaultChannelsForRecipient({
        key,
        recipientKind: NotificationRecipientKind.ADMIN,
      })

      // §12 NC2: admin ops now include PUSH (inert until APNs creds land); still
      // never SMS.
      expect([...channels].sort()).toEqual(
        [
          NotificationChannel.IN_APP,
          NotificationChannel.EMAIL,
          NotificationChannel.PUSH,
        ].sort(),
      )
      expect(channels).not.toContain(NotificationChannel.SMS)

      expect(
        isRecipientSupportedForEvent(key, NotificationRecipientKind.ADMIN),
      ).toBe(true)
      expect(
        isRecipientSupportedForEvent(key, NotificationRecipientKind.PRO),
      ).toBe(false)
      expect(
        isRecipientSupportedForEvent(key, NotificationRecipientKind.CLIENT),
      ).toBe(false)
    }
  })
})

describe('emitAdminSupportTicketCreated', () => {
  it('fans out to every admin with an ADMIN, email-capable, SMS-incapable recipient', async () => {
    await emitAdminSupportTicketCreated({
      tx: makeTx(),
      ticketId: 't1',
      subject: 'Booking not confirming',
    })

    // One dispatch per admin.
    expect(mockEnqueueDispatch).toHaveBeenCalledTimes(2)

    const args = mockEnqueueDispatch.mock.calls[0]?.[0]
    expect(args.key).toBe(NotificationEventKey.ADMIN_SUPPORT_TICKET_CREATED)
    expect(args.recipient.kind).toBe(NotificationRecipientKind.ADMIN)
    expect(args.recipient.adminUserId).toBe('admin_1')
    expect(args.recipient.email).toBe('admin@example.com')
    // No phone is ever supplied for admins → SMS can never be selected.
    expect(args.recipient.phone).toBeUndefined()
    // Links back to the inbox row it just created.
    expect(args.adminNotificationId).toBe('an_1')
    expect(args.sourceKey).toBe('admin-notification:an_1')
    expect(args.href).toBe('/admin/support/t1')

    // The inbox row carries a stable, source-derived dedupeKey.
    const createArg = create.mock.calls[0]?.[0]
    expect(createArg?.data.dedupeKey).toBe('ADMIN_SUPPORT_TICKET_CREATED:t1')
  })

  it('is idempotent: an already-seen row refreshes only and never re-dispatches', async () => {
    // Simulate the dedupe row already existing for every admin.
    updateMany.mockResolvedValue({ count: 1 })

    await emitAdminSupportTicketCreated({ tx: makeTx(), ticketId: 't1' })

    expect(updateMany).toHaveBeenCalledTimes(2) // one per admin
    expect(create).not.toHaveBeenCalled()
    expect(mockEnqueueDispatch).not.toHaveBeenCalled()
  })

  it('no-ops when there are no admins', async () => {
    findMany.mockResolvedValue([])

    await emitAdminSupportTicketCreated({ tx: makeTx(), ticketId: 't1' })

    expect(create).not.toHaveBeenCalled()
    expect(mockEnqueueDispatch).not.toHaveBeenCalled()
  })
})

describe('emitAdminVerificationReviewNeeded', () => {
  it('keys on the document id when a verification doc was uploaded', async () => {
    await emitAdminVerificationReviewNeeded({
      tx: makeTx(),
      professionalId: 'pro_1',
      verificationDocumentId: 'doc_9',
    })

    const args = mockEnqueueDispatch.mock.calls[0]?.[0]
    expect(args.key).toBe(
      NotificationEventKey.ADMIN_VERIFICATION_REVIEW_NEEDED,
    )
    expect(args.href).toBe('/admin/professionals/pro_1')

    const createArg = create.mock.calls[0]?.[0]
    expect(createArg?.data.dedupeKey).toBe(
      'ADMIN_VERIFICATION_REVIEW_NEEDED:doc:doc_9',
    )
  })

  it('keys on the professional for a license re-review (no document id)', async () => {
    await emitAdminVerificationReviewNeeded({
      tx: makeTx(),
      professionalId: 'pro_1',
    })

    const createArg = create.mock.calls[0]?.[0]
    expect(createArg?.data.dedupeKey).toBe(
      'ADMIN_VERIFICATION_REVIEW_NEEDED:license:pro_1',
    )
  })
})

describe('emitAdminViralRequestPending', () => {
  it('keys on the request id', async () => {
    await emitAdminViralRequestPending({
      tx: makeTx(),
      requestId: 'vr_5',
      name: 'Glass skin facial',
    })

    const args = mockEnqueueDispatch.mock.calls[0]?.[0]
    expect(args.key).toBe(NotificationEventKey.ADMIN_VIRAL_REQUEST_PENDING)

    const createArg = create.mock.calls[0]?.[0]
    expect(createArg?.data.dedupeKey).toBe('ADMIN_VIRAL_REQUEST_PENDING:vr_5')
  })
})
