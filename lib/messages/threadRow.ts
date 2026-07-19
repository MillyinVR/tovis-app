// lib/messages/threadRow.ts
//
// Single source of truth for serializing ONE message thread into the wire row
// the clients render (`MessageThreadListItemDTO`).
//
// Two routes need the identical row and must never drift:
//   • GET  /api/v1/messages/threads   — the inbox list (many rows)
//   • POST /api/v1/messages/resolve   — find-or-create, which returns the row it
//     resolved so a caller can open the thread from one round trip.
//
// Why resolve carries the row at all: a freshly created thread has no messages,
// and the inbox deliberately hides message-less threads (`whereForInboxFilter`
// filters `lastMessageAt: { not: null }`). A native client that resolved a
// thread and then looked it up in the inbox therefore found NOTHING on the very
// first message to a client — the thread it had just created was structurally
// invisible. Web never hit this because `/messages/start` redirects by id
// instead of searching the list.
//
// It is deliberately NOT bolted onto GET /messages/threads/{id}: that route is
// polled every 15s by an open thread view, and this row costs a client + pro
// join plus the eyebrow's context lookup. Resolve runs once per thread open,
// which is exactly when the row is needed.

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import type { MessageThreadListItemDTO } from '@/lib/dto/messaging'
import { resolveInboxEyebrow, type InboxEyebrow } from '@/lib/messages/inboxContext'

/**
 * The columns a thread row needs. Viewer-scoped: `participants` is filtered to
 * the viewer so `participants[0].lastReadAt` is *my* read state, which is the
 * only participant data the wire row carries (user ids stay off it).
 */
export function inboxThreadRowSelect(viewerUserId: string) {
  return Prisma.validator<Prisma.MessageThreadSelect>()({
    id: true,
    contextType: true,
    contextId: true,
    bookingId: true,
    serviceId: true,
    offeringId: true,
    waitlistEntryId: true,
    lastMessageAt: true,
    lastMessagePreview: true,
    updatedAt: true,
    client: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    professional: {
      select: {
        id: true,
        userId: true,
        businessName: true,
        firstName: true, // pii-plaintext-read-ok: pro public display name (formatProfessionalPublicDisplayName)
        lastName: true, // pii-plaintext-read-ok: pro public display name (formatProfessionalPublicDisplayName)
        handle: true,
        nameDisplay: true,
        avatarUrl: true,
      },
    },
    participants: {
      where: { userId: viewerUserId },
      select: { lastReadAt: true },
      take: 1,
    },
    _count: { select: { messages: true } },
  })
}

/** A thread row loaded with {@link inboxThreadRowSelect}. */
export type InboxThreadRow = Prisma.MessageThreadGetPayload<{
  select: ReturnType<typeof inboxThreadRowSelect>
}>

/**
 * Serialize one loaded row to its wire shape.
 *
 * `viewerUserId` decides `isViewerPro`, which is the clients' ONLY signal for
 * whose name and avatar to show — it is derived from the viewer's user id, not
 * their acting role, so a dual-role user never resolves to their own name.
 */
export function serializeInboxThreadRow(params: {
  row: InboxThreadRow
  viewerUserId: string
  eyebrow: InboxEyebrow
}): MessageThreadListItemDTO {
  const { row, viewerUserId, eyebrow } = params

  return {
    id: row.id,
    contextType: row.contextType,
    contextId: row.contextId,
    bookingId: row.bookingId,
    serviceId: row.serviceId,
    offeringId: row.offeringId,
    waitlistEntryId: row.waitlistEntryId,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: row.lastMessagePreview,
    updatedAt: row.updatedAt.toISOString(),
    client: row.client,
    // Rebuild the professional preview explicitly so raw firstName/lastName
    // (selected only to resolve the toggle-aware display name) never leak onto
    // the wire — the DTO carries only the resolved displayName.
    professional: {
      id: row.professional.id,
      businessName: row.professional.businessName,
      avatarUrl: row.professional.avatarUrl,
      displayName: formatProfessionalPublicDisplayName(row.professional, 'Your pro'),
    },
    participants: row.participants.map((participant) => ({
      lastReadAt: participant.lastReadAt?.toISOString() ?? null,
    })),
    // `ProfessionalProfile.userId` is non-nullable in the schema, so this is a
    // plain comparison — the list route's old `!= null &&` guard could never
    // fire and is not carried over.
    isViewerPro: row.professional.userId === viewerUserId,
    eyebrow: eyebrow.eyebrow,
    isAccentContext: eyebrow.isAccentContext,
    _count: row._count,
  }
}

/**
 * Load + serialize a single thread by id, exactly as the inbox list would.
 * Returns null when no such thread exists.
 *
 * Deliberately NOT an access check — callers reach this only after their own
 * authorization (resolve derives the thread from a context the viewer is proven
 * to belong to). The row it returns is viewer-scoped all the same: the
 * participant read state and `isViewerPro` are resolved against `viewerUserId`.
 */
export async function loadInboxThreadRow(params: {
  threadId: string
  viewerUserId: string
}): Promise<MessageThreadListItemDTO | null> {
  const { threadId, viewerUserId } = params

  const row = await prisma.messageThread.findUnique({
    where: { id: threadId },
    select: inboxThreadRowSelect(viewerUserId),
  })

  if (!row) return null

  return serializeInboxThreadRow({
    row,
    viewerUserId,
    eyebrow: await resolveInboxEyebrow(row),
  })
}
