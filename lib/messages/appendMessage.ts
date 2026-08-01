// lib/messages/appendMessage.ts
//
// THE write for "a message was added to a thread". Appending a message is never
// one row — it is three, and getting any of them wrong is invisible until a real
// inbox is looked at:
//
//   1. the Message itself,
//   2. the thread's `lastMessageAt` / `lastMessagePreview`, which is the ONLY
//      thing the inbox sorts and renders by — a thread with a null
//      `lastMessageAt` does not appear in the inbox at all, and
//   3. the SENDER's `lastReadAt`, so their own message does not come back at
//      them as unread.
//
// This existed twice, inline, and had already drifted: `POST
// /api/v1/messages/threads/[id]` computed the preview as
// `text ? text.slice(0,140) : '📷 Photo'`, while the waitlist seed used a bare
// `body.slice(0,140)` with no attachment case. Same intent, two spellings, and
// the next caller would have written a third. A drifted duplicate is a bug
// report — see [[drifted-duplicate-is-a-bug-report]].
//
// ⚠️ AUTHORIZATION IS NOT HERE, deliberately. The two callers gate differently
// (the send route checks thread participation; the waitlist seed has just
// resolved the thread as the client). A helper that took an opinion on who may
// write would either be bypassed or would quietly weaken one of them.
//
// The live/notification fan-out is also NOT here: it must run AFTER the
// transaction commits, and the callers genuinely want different things from it
// (the send route fires MESSAGE_RECEIVED; the waitlist seed deliberately does
// not, because WAITLIST_JOINED already covers that act). See
// `broadcastThreadMessage` below for the part they DO share.

import { Prisma, type MediaType } from '@prisma/client'

import { broadcastLive, liveChannelForUser } from '@/lib/live/broadcast'
import { prisma } from '@/lib/prisma'

/** Inbox preview for a message with no text of its own. */
export const ATTACHMENT_ONLY_PREVIEW = '📷 Photo'

/** How much of a message body the inbox row shows. */
export const MESSAGE_PREVIEW_LENGTH = 140

export type MessageAttachmentInput = {
  storageBucket: string
  storagePath: string
  mediaType: MediaType
}

/**
 * The inbox preview for a message. One definition, so an attachment-only
 * message reads the same wherever it was sent from.
 */
export function buildMessagePreview(
  body: string | null,
  attachmentCount = 0,
): string {
  const trimmed = body?.trim()
  if (trimmed) return trimmed.slice(0, MESSAGE_PREVIEW_LENGTH)
  return attachmentCount > 0 ? ATTACHMENT_ONLY_PREVIEW : ''
}

/**
 * Append a message to an existing thread: the message row, the thread's inbox
 * pointers, and the sender's own read receipt.
 *
 * MUST be called inside a transaction — the three writes are one fact. A message
 * that committed without its `lastMessageAt` is a message nobody will ever see.
 *
 * `select` lets a caller ask for more of the created row (e.g. attachments) than
 * the default id/body/createdAt.
 */
export async function appendMessageToThread<
  S extends Prisma.MessageSelect = typeof DEFAULT_MESSAGE_SELECT,
>(args: {
  tx: Prisma.TransactionClient
  threadId: string
  senderUserId: string
  body: string | null
  attachments?: readonly MessageAttachmentInput[]
  select?: S
}): Promise<Prisma.MessageGetPayload<{ select: S }>> {
  const attachments = args.attachments ?? []

  const message = await args.tx.message.create({
    data: {
      threadId: args.threadId,
      senderUserId: args.senderUserId,
      body: args.body || null,
      ...(attachments.length
        ? {
            attachments: {
              create: attachments.map((attachment) => ({
                storageBucket: attachment.storageBucket,
                storagePath: attachment.storagePath,
                mediaType: attachment.mediaType,
              })),
            },
          }
        : {}),
    },
    select: (args.select ?? DEFAULT_MESSAGE_SELECT) as S,
  })

  const createdAt = (message as { createdAt: Date }).createdAt

  await args.tx.messageThread.update({
    where: { id: args.threadId },
    data: {
      lastMessageAt: createdAt,
      lastMessagePreview: buildMessagePreview(args.body, attachments.length),
    },
  })

  // The sender has, by definition, read what they just sent.
  await args.tx.messageThreadParticipant.update({
    where: {
      threadId_userId: { threadId: args.threadId, userId: args.senderUserId },
    },
    data: { lastReadAt: createdAt },
  })

  return message as Prisma.MessageGetPayload<{ select: S }>
}

const DEFAULT_MESSAGE_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  senderUserId: true,
} satisfies Prisma.MessageSelect

/**
 * Ping the OTHER participants' devices so a new message lands without a reload.
 * The sender already has it.
 *
 * Call AFTER the transaction commits. Best-effort by contract: a live-sync
 * failure must never fail a send that already succeeded.
 */
export async function broadcastThreadMessage(args: {
  threadId: string
  senderUserId: string
}): Promise<void> {
  const recipients = await prisma.messageThreadParticipant.findMany({
    where: { threadId: args.threadId, userId: { not: args.senderUserId } },
    select: { userId: true },
  })

  await broadcastLive(
    recipients.map((participant) => liveChannelForUser(participant.userId)),
    'messages',
  )
}
